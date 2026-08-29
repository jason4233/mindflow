const DEFAULT_API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const WRITE_PERMISSION_GUIDANCE = 'PAT must grant Metadata: Read and Contents: Read and write access'

export class SyncHttpError extends Error {
  constructor(message, { status = 0, retryable = false, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SyncHttpError'
    this.status = status
    this.retryable = retryable
  }
}

function encodePathSegments(value) {
  return String(value)
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function repoPath(cfg) {
  return encodePathSegments(cfg.repo)
}

function branchPath(cfg) {
  return encodePathSegments(cfg.branch ?? 'main')
}

function apiUrl(cfg, path) {
  const apiBase = String(cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '')
  return `${apiBase}${path}`
}

function requestHeaders(cfg, extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${cfg.token}`,
    'x-github-api-version': API_VERSION,
    ...extra
  }
}

function retryableStatus(status, extraRetryableStatuses) {
  return status === 429 || status >= 500 || extraRetryableStatuses.includes(status)
}

function redactToken(value, token) {
  const message = String(value ?? '')
  const secret = String(token ?? '')
  return secret ? message.replaceAll(secret, '[redacted]') : message
}

async function errorFromResponse(cfg, response, extraRetryableStatuses) {
  let detail = ''
  try {
    const body = await response.json()
    if (typeof body?.message === 'string') {
      detail = `: ${redactToken(body.message, cfg.token)}`
    }
  } catch {
    // 錯誤頁不一定是 JSON；分類仍以 HTTP status 為準，不能讓 parse error 蓋掉原始狀態。
  }

  return new SyncHttpError(`GitHub API request failed (${response.status})${detail}`, {
    status: response.status,
    retryable: retryableStatus(response.status, extraRetryableStatuses)
  })
}

async function request(cfg, path, {
  method = 'GET',
  headers = {},
  json,
  acceptedStatuses = [],
  retryableStatuses = []
} = {}) {
  const init = { method, headers: requestHeaders(cfg, headers) }
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(json)
  }

  let response
  try {
    response = await globalThis.fetch(apiUrl(cfg, path), init)
  } catch (cause) {
    // 原始 exception 可能回顯 request 細節；只帶已遮蔽文字，避免 logger 展開 cause 洩漏 PAT。
    const detail = redactToken(cause?.message ?? 'network error', cfg.token)
    throw new SyncHttpError(`GitHub request failed: ${detail}`, {
      status: 0,
      retryable: true
    })
  }

  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw await errorFromResponse(cfg, response, retryableStatuses)
  }
  return response
}

async function responseJson(response) {
  try {
    return await response.json()
  } catch (cause) {
    throw new SyncHttpError(`GitHub API returned invalid JSON (${response.status})`, {
      status: response.status,
      retryable: response.status >= 500
    })
  }
}

function attachRateRemaining(value, response) {
  const header = response.headers.get('x-ratelimit-remaining')
  if (header === null) return value

  const numeric = Number(header)
  value.rateRemaining = Number.isFinite(numeric) ? numeric : header
  return value
}

function writeAccessError(cfg, cause) {
  const status = cause instanceof SyncHttpError && cause.status ? cause.status : 403
  return new SyncHttpError(
    `Cannot write GitHub repository ${cfg.repo}. ${WRITE_PERMISSION_GUIDANCE}.`,
    { status, retryable: false }
  )
}

export async function getRef(cfg, { etag } = {}) {
  let response
  try {
    response = await request(
      cfg,
      `/repos/${repoPath(cfg)}/git/ref/heads/${branchPath(cfg)}`,
      {
        headers: etag ? { 'if-none-match': etag } : {},
        acceptedStatuses: [304]
      }
    )
  } catch (error) {
    if (error instanceof SyncHttpError && error.status === 409) {
      throw new SyncHttpError(
        `GitHub repository ${cfg.repo} 是空的。請先建立第一個 commit，或刪除空 repo 後讓 MindFlow 重新建立。`,
        { status: 409, retryable: false }
      )
    }
    throw error
  }

  // 304 規格上沒有 response body；沿用送出的 ETag 才能保留 pull 輪詢狀態。
  if (response.status === 304) {
    return attachRateRemaining({
      sha: null,
      etag: response.headers.get('etag') ?? etag ?? null,
      notModified: true
    }, response)
  }

  const body = await responseJson(response)
  return attachRateRemaining({
    sha: body.object.sha,
    etag: response.headers.get('etag'),
    notModified: false
  }, response)
}

export async function getCommit(cfg, sha) {
  const response = await request(
    cfg,
    `/repos/${repoPath(cfg)}/git/commits/${encodeURIComponent(sha)}`
  )
  const body = await responseJson(response)
  return attachRateRemaining({ treeSha: body.tree.sha }, response)
}

export async function getTreeRecursive(cfg, treeSha) {
  const response = await request(
    cfg,
    `/repos/${repoPath(cfg)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`
  )
  const body = await responseJson(response)

  // truncated tree 不是完整遠端狀態；繼續同步可能把未列出的資料誤判為不存在。
  if (body.truncated) {
    throw new SyncHttpError('GitHub recursive tree response was truncated', {
      status: response.status,
      retryable: false
    })
  }

  const byPath = Object.fromEntries(
    (Array.isArray(body.tree) ? body.tree : [])
      .filter(entry => entry.type === 'blob')
      .map(entry => [entry.path, { sha: entry.sha, size: entry.size }])
  )
  return attachRateRemaining({ byPath }, response)
}

export async function getBlobRaw(cfg, blobSha) {
  const response = await request(
    cfg,
    `/repos/${repoPath(cfg)}/git/blobs/${encodeURIComponent(blobSha)}`
  )
  const body = await responseJson(response)
  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new SyncHttpError('GitHub blob response is not base64 encoded', {
      status: response.status,
      retryable: false
    })
  }

  // Contents API 有 1 MB JSON 限制；Git blobs API 的 base64 payload 可安全處理大型文件。
  return Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf8')
}

export async function createBlob(cfg, content) {
  const response = await request(cfg, `/repos/${repoPath(cfg)}/git/blobs`, {
    method: 'POST',
    json: { content, encoding: 'utf-8' }
  })
  const body = await responseJson(response)
  return body.sha
}

export async function createTree(cfg, { baseTreeSha, entries }) {
  const response = await request(cfg, `/repos/${repoPath(cfg)}/git/trees`, {
    method: 'POST',
    json: {
      base_tree: baseTreeSha,
      tree: entries.map(({ path, sha }) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha
      }))
    }
  })
  const body = await responseJson(response)
  return body.sha
}

export async function createCommit(cfg, { message, treeSha, parentSha }) {
  const response = await request(cfg, `/repos/${repoPath(cfg)}/git/commits`, {
    method: 'POST',
    json: { message, tree: treeSha, parents: [parentSha] }
  })
  const body = await responseJson(response)
  return body.sha
}

export async function updateRef(cfg, commitSha) {
  // force:false 是 push 的 compare-and-swap；422 必須交給 engine 重拉、重合、重推。
  await request(cfg, `/repos/${repoPath(cfg)}/git/refs/heads/${branchPath(cfg)}`, {
    method: 'PATCH',
    json: { sha: commitSha, force: false },
    retryableStatuses: [422]
  })
}

export async function validateRepo(cfg) {
  const response = await request(cfg, `/repos/${repoPath(cfg)}`, {
    acceptedStatuses: [404]
  })

  // validate 是首次設定探測；只有這裡把 404 當正常的「尚未建立」。
  if (response.status === 404) {
    return attachRateRemaining({
      exists: false,
      private: false,
      canWrite: false
    }, response)
  }

  const body = await responseJson(response)
  return attachRateRemaining({
    exists: true,
    private: Boolean(body.private),
    canWrite: Boolean(body.permissions?.push)
  }, response)
}

export async function ensureRepo(cfg) {
  let existing
  try {
    existing = await validateRepo(cfg)
  } catch (error) {
    if (error instanceof SyncHttpError && [401, 403].includes(error.status)) {
      throw writeAccessError(cfg, error)
    }
    throw error
  }

  if (existing.exists) {
    if (!existing.canWrite) throw writeAccessError(cfg)
    return existing
  }

  const repoName = String(cfg.repo).split('/').at(-1)
  let response
  try {
    response = await request(cfg, '/user/repos', {
      method: 'POST',
      // Git Database API 無法在零 commit repo 建 ref；建立時直接 seed branch 才能讓首次同步走 frozen 流程。
      json: {
        name: repoName,
        private: true,
        auto_init: true,
        default_branch: cfg.branch || 'main'
      }
    })
  } catch (error) {
    if (error instanceof SyncHttpError && [401, 403].includes(error.status)) {
      throw writeAccessError(cfg, error)
    }
    if (error instanceof SyncHttpError && error.status === 422) {
      // GitHub 對未授權的既有 repo 先回 404，接著個人 repo 建立端點才以 name exists 回 422。
      throw new SyncHttpError(
        `GitHub repo ${cfg.repo} 可能已存在，但 fine-grained PAT 尚未授權存取。請在 PAT 的 Repository access 勾選該 repo，並保留 Contents: Read and write。`,
        { status: 422, retryable: false }
      )
    }
    throw error
  }

  const body = await responseJson(response)
  const createdFullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  if (!createdFullName || createdFullName.toLocaleLowerCase('en-US') !== String(cfg.repo).trim().toLocaleLowerCase('en-US')) {
    throw new SyncHttpError(
      `GitHub 建立的 repo ${createdFullName || '(unknown)'} 與設定的 ${cfg.repo} 不一致。請確認 owner 與 fine-grained PAT 的 Repository access。`,
      { status: 409, retryable: false }
    )
  }
  const result = attachRateRemaining({
    exists: true,
    private: Boolean(body.private),
    canWrite: body.permissions?.push !== false
  }, response)

  if (!result.canWrite) throw writeAccessError(cfg)
  return result
}
