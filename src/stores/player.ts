import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useContentStore } from './content'

export interface NowPlaying {
  title:     string  // raw "Artist - Title" string
  artist:    string
  song:      string
  listeners: number
}

const EMPTY: NowPlaying = { title: '', artist: '', song: '', listeners: 0 }

// ── ICY metadata parser ───────────────────────────────────────────────────────
// Opens a fresh connection to the stream, reads until the first ICY metadata
// block (at byte offset `icy-metaint`), parses StreamTitle, then closes.
// Returns null if the stream doesn't advertise icy-metaint or blocks CORS.
async function readIcyMetadata(streamUrl: string): Promise<NowPlaying | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    const res = await fetch(streamUrl, {
      headers: { 'Icy-MetaData': '1' },
      cache: 'no-store',
    })

    const metaint = parseInt(res.headers.get('icy-metaint') ?? '0', 10)
    if (!metaint || !res.body) return null

    reader = res.body.getReader()

    // Collect chunks until we have metaint bytes of audio + 1 length byte
    // + up to 16 * 255 = 4080 bytes of metadata (the practical ceiling is ~100 bytes)
    const needed = metaint + 1 + 4080
    const chunks: Uint8Array[] = []
    let total = 0

    while (total < needed) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      total += value.length
    }

    // Flatten
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }

    if (buf.length < metaint + 1) return null

    const metaLen = buf[metaint] * 16
    if (metaLen === 0 || buf.length < metaint + 1 + metaLen) return null

    const metaStr = new TextDecoder().decode(buf.slice(metaint + 1, metaint + 1 + metaLen))
      .replace(/\0/g, '')
      .trim()

    const m = metaStr.match(/StreamTitle='([^']*)'/i)
    if (!m) return null

    return parseTitle(m[1].trim(), 0)
  } catch {
    return null
  } finally {
    reader?.cancel().catch(() => {})
  }
}

// ── Worker metadata endpoint ──────────────────────────────────────────────────
// Polls the Worker's /metadata route. `source` tells the Worker which stream
// to read titles from, so they match the audio the listener hears.
async function readStatsMetadata(metadataUrl: string, source: StreamSource): Promise<NowPlaying | null> {
  try {
    const url = new URL(metadataUrl)
    url.searchParams.set('source', source)
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.title && !data.song) return null
    return {
      title:     data.title     ?? '',
      artist:    data.artist    ?? '',
      song:      data.song      ?? '',
      listeners: data.listeners ?? 0,
    }
  } catch {
    return null
  }
}

// ── Stream selection ──────────────────────────────────────────────────────────
// settings.json holds both streams; `streamSource` picks one. It's switched by
// hand in Admin → Settings. There is deliberately no automatic failover: the
// two streams run at different delays, so switching mid-listen would jump.
export type StreamSource = 'aiir' | 'local'

export function activeStream(settings: any): { source: StreamSource; url: string } | null {
  const source: StreamSource = settings?.streamSource === 'local' ? 'local' : 'aiir'
  // `streamUrl` is the single-stream field used before Nov 2026
  const url: string | undefined = settings?.streams?.[source] || settings?.streamUrl
  return url ? { source, url } : null
}

function parseTitle(raw: string, listeners: number): NowPlaying {
  const dashIdx = raw.indexOf(' - ')
  return {
    title:     raw,
    artist:    dashIdx > -1 ? raw.slice(0, dashIdx).trim() : '',
    song:      dashIdx > -1 ? raw.slice(dashIdx + 3).trim() : raw,
    listeners,
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const usePlayerStore = defineStore('player', () => {
  const audio = new Audio()
  audio.preload = 'none'

  const isPlaying    = ref(false)
  const isLoading    = ref(false)
  const hasError     = ref(false)
  const errorMessage = ref('')
  const volume       = ref(parseFloat(localStorage.getItem('kteq-volume') || '0.8'))
  const nowPlaying   = ref<NowPlaying>({ ...EMPTY })

  audio.volume = volume.value

  audio.addEventListener('playing', () => {
    isPlaying.value = true
    isLoading.value = false
    hasError.value  = false
    fetchMetadata()
  })

  audio.addEventListener('pause', () => {
    isPlaying.value = false
    isLoading.value = false
    stopPolling()
  })

  audio.addEventListener('waiting', () => { isLoading.value = true })

  audio.addEventListener('error', () => {
    isPlaying.value    = false
    isLoading.value    = false
    hasError.value     = true
    errorMessage.value = 'Stream unavailable'
    stopPolling()
  })

  watch(volume, (v) => {
    audio.volume = v
    localStorage.setItem('kteq-volume', v.toString())
  })

  // ── Metadata ────────────────────────────────────────────────────────────────
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function fetchMetadata() {
    const settings = useContentStore().settings as any
    const active = activeStream(settings)
    if (!active) return

    // The Worker's /metadata route is the main source for both streams.
    let result = settings.metadataUrl
      ? await readStatsMetadata(settings.metadataUrl as string, active.source)
      : null

    // On the station stream, the browser can also read titles straight from the
    // audio (the Worker adds CORS headers). Aiir's stream doesn't allow that.
    if (!result?.title && active.source === 'local') {
      const icy = await readIcyMetadata(active.url)
      if (icy?.title) result = icy
    }

    // Only update if we actually got a title — don't wipe good data with empty
    if (result?.title) nowPlaying.value = result
  }

  function startPolling() {
    fetchMetadata()
    if (!pollTimer) {
      // ICY: poll every 20 s (fast enough; 320kbps downloads 16 KB in ~0.4 s)
      // Stats fallback: same cadence
      pollTimer = setInterval(fetchMetadata, 20_000)
    }
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    nowPlaying.value = { ...EMPTY }
  }

  // ── Playback ────────────────────────────────────────────────────────────────
  async function tryPlay(url: string): Promise<boolean> {
    audio.src = url
    audio.load()
    try {
      await audio.play()
      startPolling()
      return true
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        isLoading.value    = false
        hasError.value     = true
        errorMessage.value = 'Click play to start listening'
      }
      return false
    }
  }

  async function play() {
    const active = activeStream(useContentStore().settings)

    if (!active) {
      hasError.value = true; errorMessage.value = 'No stream URL configured'; return
    }

    hasError.value  = false
    isLoading.value = true

    if (await tryPlay(active.url)) return
    if (errorMessage.value === 'Click play to start listening') return

    isLoading.value    = false
    hasError.value     = true
    errorMessage.value = 'Could not connect to stream'
  }

  function stop() {
    audio.pause()
    audio.src = ''
    audio.removeAttribute('src')
    isPlaying.value = false
    isLoading.value = false
    stopPolling()
  }

  function toggle() {
    if (isPlaying.value || isLoading.value) stop()
    else play()
  }

  function setVolume(v: number) { volume.value = Math.max(0, Math.min(1, v)) }

  return { isPlaying, isLoading, hasError, errorMessage, volume, nowPlaying, play, stop, toggle, setVolume }
})
