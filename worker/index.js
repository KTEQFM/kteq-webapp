/**
 * KTEQ Stream Proxy — Cloudflare Worker
 *
 * Proxies the university Icecast server (HTTP-only) to HTTPS so the site
 * can load the backup stream without mixed-content errors, and serves
 * now-playing info for whichever stream the site is using.
 *
 * Routes:
 *   GET /                       → audio proxy for the station's own Icecast (backup stream)
 *   GET /metadata?source=aiir   → current track, read from the Aiir stream itself
 *   GET /metadata?source=local  → current track, from the station Icecast's JSON stats
 *   GET /metadata               → same as source=local (what older site versions call)
 *   OPTIONS *                   → CORS preflight
 *
 * Why the Worker reads the Aiir titles: Aiir's stream carries the titles
 * Audio Engine embeds (icy-metaint), but it doesn't send CORS headers, so a
 * browser on kteq.org can't read them directly. Reading them here keeps
 * the titles coming from the same audio the listener hears.
 *
 * Deploy:
 *   wrangler deploy  (or paste into the Cloudflare dashboard editor)
 */

const UPSTREAM_STREAM = 'http://kteq-streamer.sdsmt.edu:8000/kteq'
const UPSTREAM_STATS  = 'http://kteq-streamer.sdsmt.edu:8000/status-json.xsl'
// Base address only. Aiir redirects it to a short-lived tokenized address,
// which fetch follows fresh on every request.
const AIIR_STREAM     = 'https://stream.aiir.com/0gmznstk33kuv'

// Each Aiir title read opens a brief connection to the stream, so reads are
// shared for this long within a Worker instance.
const AIIR_CACHE_MS = 10_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Icy-MetaData',
  'Access-Control-Expose-Headers': [
    'icy-br', 'icy-description', 'icy-genre', 'icy-metaint',
    'icy-name', 'icy-pub', 'icy-sr', 'icy-url', 'Content-Type',
  ].join(', '),
}

const EMPTY = { title: '', artist: '', song: '', listeners: 0, bitrate: 0 }

// Most automation systems encode titles as "Artist - Title"
function splitTitle(rawTitle) {
  const raw = (rawTitle ?? '').trim()
  const dashIdx = raw.indexOf(' - ')
  return {
    title:  raw,
    artist: dashIdx > -1 ? raw.slice(0, dashIdx).trim() : '',
    song:   dashIdx > -1 ? raw.slice(dashIdx + 3).trim() : raw,
  }
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200, // never surface 5xx to the player
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// ── Station Icecast: JSON stats ───────────────────────────────────────────────
async function localMetadata() {
  const statsRes = await fetch(UPSTREAM_STATS, {
    headers: { 'User-Agent': 'KTEQ-Proxy/1.0' },
    cf: { cacheEverything: true, cacheTtl: 10 },
  })
  const data = await statsRes.json()

  // Icecast returns source as an object (single mount) or array (multiple)
  const src = Array.isArray(data?.icestats?.source)
    ? data.icestats.source.find(s => s.listenurl?.endsWith('/kteq')) ?? data.icestats.source[0]
    : data?.icestats?.source ?? null

  // Icecast 2.5+ puts ICY title in metadata.x_icy_title; older versions use title
  const rawTitle = src?.metadata?.x_icy_title ?? src?.title ?? ''
  return {
    ...splitTitle(rawTitle),
    listeners: src?.listeners ?? 0,
    bitrate:   src?.['ice-bitrate'] ?? src?.bitrate ?? 0,
  }
}

// ── Aiir stream: read the embedded title ──────────────────────────────────────
// Connects with Icy-MetaData: 1, reads up to the first metadata block
// (at byte offset icy-metaint), parses StreamTitle, then disconnects.
// Icecast sends the current title in the first block of every new connection.
async function readIcyTitle(streamUrl) {
  const res = await fetch(streamUrl, {
    headers: { 'Icy-MetaData': '1', 'User-Agent': 'KTEQ-Metadata/1.0' },
    redirect: 'follow',
  })
  const metaint = parseInt(res.headers.get('icy-metaint') ?? '0', 10)
  const bitrate = parseInt(res.headers.get('icy-br') ?? '0', 10)
  if (!metaint || !res.body) {
    res.body?.cancel().catch(() => {})
    return { ...EMPTY, bitrate, error: 'stream sent no icy-metaint' }
  }

  const reader = res.body.getReader()
  let buf = new Uint8Array(0)
  const readUntil = async (n) => {
    while (buf.length < n) {
      const { done, value } = await reader.read()
      if (done || !value) return
      const next = new Uint8Array(buf.length + value.length)
      next.set(buf); next.set(value, buf.length)
      buf = next
    }
  }

  try {
    await readUntil(metaint + 1)
    if (buf.length < metaint + 1) return { ...EMPTY, bitrate }
    const metaLen = buf[metaint] * 16
    if (metaLen === 0) return { ...EMPTY, bitrate }
    await readUntil(metaint + 1 + metaLen)
    if (buf.length < metaint + 1 + metaLen) return { ...EMPTY, bitrate }

    const metaStr = new TextDecoder()
      .decode(buf.slice(metaint + 1, metaint + 1 + metaLen))
      .replace(/\0/g, '')
    const m = metaStr.match(/StreamTitle='(.*?)';/i)
    // Aiir doesn't report a listener count in the stream itself
    return { ...splitTitle(m ? m[1] : ''), listeners: 0, bitrate }
  } finally {
    reader.cancel().catch(() => {})
  }
}

let aiirCache = { at: 0, data: null }

async function aiirMetadata() {
  if (aiirCache.data && Date.now() - aiirCache.at < AIIR_CACHE_MS) return aiirCache.data
  const data = await readIcyTitle(AIIR_STREAM)
  if (data.title) aiirCache = { at: Date.now(), data }
  return data
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── /metadata — current track for the requested stream ───────────────────
    if (url.pathname === '/metadata') {
      const source = url.searchParams.get('source') === 'aiir' ? 'aiir' : 'local'
      try {
        return json(source === 'aiir' ? await aiirMetadata() : await localMetadata())
      } catch (err) {
        return json({ ...EMPTY, error: String(err) })
      }
    }

    // ── Default — proxy the station Icecast audio (backup stream) ────────────
    try {
      const upstreamReq = new Request(UPSTREAM_STREAM, {
        method:  request.method,
        headers: {
          // Only pass ICY metadata through if the client explicitly requested it.
          // The <Audio> element does NOT send this header, so it defaults to '0'
          // (clean audio data).
          'Icy-MetaData':  request.headers.get('Icy-MetaData') ?? '0',
          'User-Agent':    'KTEQ-Proxy/1.0',
        },
      })

      const upstream = await fetch(upstreamReq)

      const headers = new Headers(CORS_HEADERS)
      for (const [key, value] of upstream.headers.entries()) {
        const lower = key.toLowerCase()
        if (
          lower === 'content-type'        ||
          lower === 'transfer-encoding'   ||
          lower.startsWith('icy-')
        ) {
          headers.set(key, value)
        }
      }

      return new Response(upstream.body, {
        status:     upstream.status,
        statusText: upstream.statusText,
        headers,
      })
    } catch (err) {
      return new Response(`Upstream error: ${err}`, { status: 502, headers: CORS_HEADERS })
    }
  },
}
