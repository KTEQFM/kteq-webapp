import { ref } from 'vue'

// Repo location: the KTEQFM organization under the university's GitHub
// Enterprise account. The org uses SSO, so admin tokens must be authorized
// for KTEQFM ("Configure SSO") before they can read or save content.
export const OWNER = 'KTEQFM'
export const REPO = 'kteq-webapp'
const BRANCH = 'main'

interface GitHubFile {
  content: any
  sha: string
}

function getToken(): string | null {
  return localStorage.getItem('kteq-admin-token')
}

function headers(): Record<string, string> {
  const token = getToken()
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  }
}

export interface VerifyResult {
  ok: boolean
  login?: string
  error?: string
}

/**
 * Verify a GitHub token before storing it.
 *
 * Works with fine-grained tokens (github_pat_...) and classic tokens (ghp_...).
 * Checks three things, in order:
 *   1. GitHub recognizes the token (GET /user) — also gives us the username
 *   2. The token can see this repo
 *   3. The token's owner has write (push) access to the repo
 *
 * What this cannot detect: a fine-grained token still waiting for org
 * approval, or one created without Contents: Read and write. Because the
 * repo is public, both still pass these reads; they fail on first save,
 * and saveErrorMessage() explains that case.
 */
export async function verifyToken(token: string): Promise<VerifyResult> {
  const h = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json'
  }
  try {
    const userRes = await fetch('https://api.github.com/user', { headers: h })
    if (userRes.status === 401) {
      return { ok: false, error: 'GitHub did not recognize this token. Check for a copy/paste error, or it may have expired or been revoked.' }
    }
    if (!userRes.ok) {
      return { ok: false, error: `GitHub returned an error (${userRes.status}). Try again in a minute.` }
    }
    const user = await userRes.json()

    const repoRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: h })
    if (!repoRes.ok) {
      return { ok: false, login: user.login, error: `Signed in as @${user.login}, but this token can't see ${OWNER}/${REPO}. When creating the token, set Resource owner to "${OWNER}" and select the ${REPO} repository.` }
    }
    const repo = await repoRes.json()
    if (!repo.permissions?.push) {
      return { ok: false, login: user.login, error: `@${user.login} doesn't have write access to ${OWNER}/${REPO}. Ask station leadership to add you.` }
    }
    return { ok: true, login: user.login }
  } catch {
    return { ok: false, error: "Couldn't reach GitHub. Check your internet connection." }
  }
}

/**
 * Turn a failed save response into a message an admin user can act on.
 */
function saveErrorMessage(status: number, apiMessage: string | undefined, path: string): string {
  if (status === 401) return 'Your token has expired or been revoked. Sign out and sign in with a new token.'
  if (status === 403 || status === 404) {
    return 'GitHub refused the save. If you just created your token, it may still be waiting for approval from station leadership. Otherwise the token is missing Contents: Read and write.'
  }
  if (status === 409 || status === 422) {
    return `Someone else changed ${path} since you opened it. Reload the page and make your edit again.`
  }
  return apiMessage || `Failed to save ${path} (${status})`
}

/**
 * Read a content file from the repo
 */
export async function getContent(path: string): Promise<GitHubFile> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`)
  const data = await res.json()
  // atob() produces a binary (Latin-1) string. Use the escape/decodeURIComponent
  // trick to correctly reconstruct the UTF-8 text before parsing JSON.
  // This is the exact inverse of the btoa(unescape(encodeURIComponent(...))) write path.
  const content = JSON.parse(decodeURIComponent(escape(atob(data.content))))
  return { content, sha: data.sha }
}

/**
 * Write/update a content file in the repo
 */
export async function putContent(
  path: string,
  content: any,
  sha: string,
  message: string
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
        sha,
        branch: BRANCH
      })
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(saveErrorMessage(res.status, err.message, path))
  }
  const data = await res.json()
  return data.content.sha
}

/**
 * Create a new file in the repo
 */
export async function createContent(
  path: string,
  content: any,
  message: string
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
        branch: BRANCH
      })
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(saveErrorMessage(res.status, err.message, path))
  }
  const data = await res.json()
  return data.content.sha
}

/**
 * Delete a file from the repo
 */
export async function deleteContent(
  path: string,
  sha: string,
  message: string
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
    {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({
        message,
        sha,
        branch: BRANCH
      })
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(saveErrorMessage(res.status, err.message, path))
  }
}

/**
 * List files in a directory
 */
export async function listContent(path: string): Promise<{ name: string; path: string; sha: string }[]> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Failed to list ${path}`)
  const data = await res.json()
  return Array.isArray(data) ? data.map((f: any) => ({ name: f.name, path: f.path, sha: f.sha })) : []
}

/**
 * Composable for use in admin components
 */
export function useGitHub() {
  const saving = ref(false)
  const error = ref<string | null>(null)
  const lastSaved = ref<Date | null>(null)

  async function save(path: string, content: any, sha: string, message: string): Promise<string | null> {
    saving.value = true
    error.value = null
    try {
      const newSha = await putContent(path, content, sha, message)
      lastSaved.value = new Date()
      return newSha
    } catch (e: any) {
      error.value = e.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function create(path: string, content: any, message: string): Promise<string | null> {
    saving.value = true
    error.value = null
    try {
      const newSha = await createContent(path, content, message)
      lastSaved.value = new Date()
      return newSha
    } catch (e: any) {
      error.value = e.message
      return null
    } finally {
      saving.value = false
    }
  }

  async function destroy(path: string, sha: string, message: string): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      await deleteContent(path, sha, message)
      return true
    } catch (e: any) {
      error.value = e.message
      return false
    } finally {
      saving.value = false
    }
  }

  return { saving, error, lastSaved, save, create, destroy, getContent, putContent, createContent, deleteContent, listContent }
}
