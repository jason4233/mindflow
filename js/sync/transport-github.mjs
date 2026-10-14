/**
 * GitHub 傳輸（Git Data API）：讀分支頭（ETag）、讀樹與 blob、一次 commit 寫入多個檔案。
 * HTTP 由注入的 request() 執行：手機直接帶權杖 fetch；電腦經 IPC 交給 main process 加權杖，
 * 所以這一層從來看不到也不保存 PAT。
 *
 * request 契約：async ({ method, path, body, headers }) => { status, etag, data, rateRemaining }
 * - path 以 `/` 開頭（例如 `/repos/o/r/git/ref/heads/main`），body 為可 JSON 序列化的物件。
 * - 網路錯誤丟 TransportError（status 0、retryable）。
 */
export const API_VERSION = '2022-11-28'
const WRITE_PERMISSION_GUIDANCE = 'PAT 需要 Metadata: Read 與 Contents: Read and write 權限'

export class TransportError extends Error {
  constructor(message, { status = 0, retryable = false, code = null } = {}) {
    super(message)
    this.name = 'TransportError'
    this.status = status
    this.retryable = retryable
    this.code = code
  }
}

/** 分支頭在我們讀取之後被別台推進：整輪重來。 */
export class TransportConflictError extends TransportError {
  constructor(message = '雲端在同步期間被另一台裝置更新') {
    super(message, { status: 422, retryable: true, code: 'REF_CONFLICT' })
    this.name = 'TransportConflictError'
  }
}

export function redactSecret(value, secret) {
  const message = String(value ?? '')
  return secret ? message.split(secret).join('[已隱藏]') : message
}

function retryableStatus(status) {
  return status === 0 || status === 429 || status >= 500
}

function encodePath(value) {
  return String(value).split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/** 手機／測試用：直接帶權杖呼叫 GitHub。權杖只存在這個閉包裡。 */
export function createFetchRequester({ fetchFn = globalThis.fetch, apiBase = 'https://api.github.com', token } = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetch is required')
  const base = String(apiBase).replace(/\/+$/u, '')
  return async function request({ method = 'GET', path, body, headers = {} }) {
    const init = {
      method,
      // WebView 的 HTTP 快取可能回舊的分支頭（M1 R15）。
      cache: 'no-store',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': API_VERSION,
        ...headers
      }
    }
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let response
    try {
      response = await fetchFn(`${base}${path}`, init)
    } catch (error) {
      throw new TransportError(`GitHub request failed: ${redactSecret(error?.message || 'network error', token)}`, { status: 0, retryable: true })
    }
    let data = null
    if (response.status !== 204 && response.status !== 304) {
      try { data = await response.json() } catch { data = null }
    }
    const remaining = Number(response.headers.get('x-ratelimit-remaining'))
    return {
      status: response.status,
      etag: response.headers.get('etag'),
      data,
      rateRemaining: Number.isFinite(remaining) ? remaining : null
    }
  }
}

export function decodeBase64Utf8(value) {
  const binary = globalThis.atob(String(value).replace(/\s/gu, ''))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function createGitHubTransport({ request, repo, branch = 'main', clientLabel = 'MindFlow' } = {}) {
  if (typeof request !== 'function') throw new TypeError('request is required')
  if (!/^[^/\s]+\/[^/\s]+$/u.test(String(repo || ''))) throw new TypeError('repo must use owner/name format')
  const repoPath = `/repos/${encodePath(repo)}`
  const refPath = `${repoPath}/git/ref/heads/${encodePath(branch)}`

  async function call(spec, { accepted = [] } = {}) {
    const response = await request(spec)
    if ((response.status >= 200 && response.status < 300) || accepted.includes(response.status)) return response
    const detail = typeof response.data?.message === 'string' ? `: ${response.data.message}` : ''
    throw new TransportError(`GitHub API request failed (${response.status})${detail}`, {
      status: response.status,
      retryable: retryableStatus(response.status)
    })
  }

  function requireData(response, check, what) {
    if (!response.data || !check(response.data)) {
      throw new TransportError(`GitHub returned an unexpected ${what} response (${response.status})`, { status: response.status, retryable: response.status >= 500 })
    }
    return response.data
  }

  return Object.freeze({
    kind: 'github',
    repo,
    branch,

    /** 確認 repo 存在且可寫；不存在就建立 private repo（並初始化分支）。 */
    async ensureRepo() {
      let response
      try {
        response = await call({ path: repoPath }, { accepted: [404] })
      } catch (error) {
        if ([401, 403].includes(error.status)) throw new TransportError(`無法存取 GitHub repo ${repo}。${WRITE_PERMISSION_GUIDANCE}。`, { status: error.status })
        throw error
      }
      if (response.status !== 404) {
        const body = requireData(response, data => typeof data === 'object', 'repository')
        if (!body.permissions?.push) throw new TransportError(`無法寫入 GitHub repo ${repo}。${WRITE_PERMISSION_GUIDANCE}。`, { status: 403 })
        return { private: Boolean(body.private), created: false }
      }
      let created
      try {
        created = await call({
          method: 'POST',
          path: '/user/repos',
          body: { name: String(repo).split('/').at(-1), private: true, auto_init: true, default_branch: branch }
        })
      } catch (error) {
        if (error.status === 422) {
          throw new TransportError(`GitHub repo ${repo} 可能已存在，但 PAT 尚未授權存取。請在 PAT 的 Repository access 勾選該 repo，並保留 Contents: Read and write。`, { status: 422 })
        }
        if ([401, 403].includes(error.status)) throw new TransportError(`無法建立 GitHub repo ${repo}。${WRITE_PERMISSION_GUIDANCE}。`, { status: error.status })
        throw error
      }
      const fullName = String(created.data?.full_name || '').toLowerCase()
      if (fullName !== String(repo).toLowerCase()) {
        throw new TransportError(`GitHub 建立的 repo ${fullName || '(unknown)'} 與設定的 ${repo} 不一致。請確認 owner 與 PAT 的 Repository access。`, { status: 409 })
      }
      return { private: Boolean(created.data?.private), created: true }
    },

    /** 分支頭；帶 etag 時沒變化回 { notModified: true }（304 不算 GitHub 限額）。 */
    async getHead({ etag } = {}) {
      let response
      try {
        response = await call({ path: refPath, headers: etag ? { 'if-none-match': etag } : {} }, { accepted: [304] })
      } catch (error) {
        if (error.status === 409) throw new TransportError(`GitHub repo ${repo} 是空的。請先建立第一個 commit，或刪除空 repo 後讓 MindFlow 重新建立。`, { status: 409 })
        throw error
      }
      if (response.status === 304) return { sha: null, etag: response.etag || etag || null, notModified: true }
      const body = requireData(response, data => typeof data.object?.sha === 'string', 'ref')
      return { sha: body.object.sha, etag: response.etag || null, notModified: false }
    },

    /** commit 的整棵樹：{ treeSha, byPath: { path: { sha, size } } }。 */
    async getTree(commitSha) {
      const commit = requireData(await call({ path: `${repoPath}/git/commits/${encodeURIComponent(commitSha)}` }), data => typeof data.tree?.sha === 'string', 'commit')
      const tree = requireData(await call({ path: `${repoPath}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1` }), data => Array.isArray(data.tree), 'tree')
      // 截斷的樹不是完整狀態：繼續會把沒列出的檔案誤判成不存在。
      if (tree.truncated) throw new TransportError('GitHub recursive tree response was truncated', { status: 200 })
      const byPath = {}
      for (const entry of tree.tree) {
        if (entry?.type === 'blob' && typeof entry.path === 'string' && typeof entry.sha === 'string') {
          byPath[entry.path] = { sha: entry.sha, size: entry.size ?? null }
        }
      }
      return { treeSha: commit.tree.sha, byPath }
    },

    async readBlob(blobSha) {
      const body = requireData(await call({ path: `${repoPath}/git/blobs/${encodeURIComponent(blobSha)}` }), data => data.encoding === 'base64' && typeof data.content === 'string', 'blob')
      return decodeBase64Utf8(body.content)
    },

    /**
     * 一個 commit 寫入多個檔案（content 為 null 代表刪除），並以 force:false 推進分支（compare-and-swap）。
     * 分支頭已被別台推進時丟 TransportConflictError。
     */
    async writeCommit({ parentSha, baseTreeSha, files, message }) {
      const tree = []
      for (const { path, content } of files) {
        if (content === null) {
          tree.push({ path, mode: '100644', type: 'blob', sha: null })
          continue
        }
        const blob = requireData(await call({
          method: 'POST',
          path: `${repoPath}/git/blobs`,
          body: { content, encoding: 'utf-8' }
        }), data => typeof data.sha === 'string', 'blob')
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
      }
      const newTree = requireData(await call({ method: 'POST', path: `${repoPath}/git/trees`, body: { base_tree: baseTreeSha, tree } }), data => typeof data.sha === 'string', 'tree')
      const commit = requireData(await call({
        method: 'POST',
        path: `${repoPath}/git/commits`,
        body: { message: message || `${clientLabel} sync`, tree: newTree.sha, parents: [parentSha] }
      }), data => typeof data.sha === 'string', 'commit')
      try {
        await call({ method: 'PATCH', path: `${repoPath}/git/refs/heads/${encodePath(branch)}`, body: { sha: commit.sha, force: false } })
      } catch (error) {
        if (error.status === 422) throw new TransportConflictError()
        throw error
      }
      return commit.sha
    }
  })
}
