import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function gitObjectSha(type, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content)
  return createHash('sha1')
    .update(`${type} ${body.length}\0`)
    .update(body)
    .digest('hex')
}

function mapToObject(map, convert = (value) => value) {
  return Object.fromEntries([...map].map(([key, value]) => [key, convert(value)]))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024 * 1024) {
      const error = new Error('request body is too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('invalid JSON')
    error.status = 400
    throw error
  }
}

function treeEntries(tree) {
  return [...tree.values()]
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export class FakeGitHubServer {
  constructor({ owner = 'owner', repo = 'repo', branch = 'main', rateRemaining = 5000 } = {}) {
    this.owner = owner
    this.repo = repo
    this.branch = branch
    this.rateRemaining = rateRemaining
    this.requests = []
    this.offline = false
    this.updateRefFailuresRemaining = 0
    this.server = null
    this.apiBase = null
    this.blobs = new Map()
    this.trees = new Map()
    this.commits = new Map()
    this.refs = new Map()
    this.#seedRepository()
  }

  #seedRepository() {
    const emptyTree = new Map()
    const treeSha = gitObjectSha('tree', '[]')
    this.trees.set(treeSha, emptyTree)

    const commitData = { message: 'Initial commit', tree: treeSha, parents: [] }
    const commitSha = gitObjectSha('commit', JSON.stringify(commitData))
    this.commits.set(commitSha, { sha: commitSha, ...commitData })
    this.refs.set(`heads/${this.branch}`, commitSha)
  }

  async start() {
    if (this.server) return this
    this.server = createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        if (response.destroyed) return
        this.#sendJson(request, response, error.status || 500, {
          message: error.status ? error.message : 'fake GitHub internal error'
        })
      })
    })
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    this.apiBase = `http://127.0.0.1:${address.port}`
    return this
  }

  async close() {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.apiBase = null
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections?.()
    })
  }

  setOffline(offline = true) {
    this.offline = Boolean(offline)
    return this
  }

  injectUpdateRef422(count = 1) {
    this.updateRefFailuresRemaining = Math.max(0, Number(count) || 0)
    return this
  }

  failNextUpdateRef(count = 1) {
    return this.injectUpdateRef422(count)
  }

  snapshot() {
    return {
      refs: mapToObject(this.refs),
      commits: mapToObject(this.commits, (commit) => structuredClone(commit)),
      trees: mapToObject(this.trees, (tree) => treeEntries(tree)),
      blobs: mapToObject(this.blobs, (blob) => blob.toString('utf8')),
      requests: structuredClone(this.requests)
    }
  }

  #sendJson(request, response, status, payload, headers = {}, { consumeRate = true } = {}) {
    if (consumeRate) this.rateRemaining = Math.max(0, this.rateRemaining - 1)
    const body = status === 304 ? null : JSON.stringify(payload)
    response.writeHead(status, {
      ...JSON_HEADERS,
      'x-ratelimit-remaining': String(this.rateRemaining),
      ...headers
    })
    response.end(body)
    // 安全紅線：診斷只記路由結果，Authorization 與 request body 永不留存。
    this.requests.push({ method: request.method, path: new URL(request.url, 'http://fake').pathname, status })
  }

  async #handle(request, response) {
    if (this.offline) {
      request.socket.destroy()
      return
    }

    const url = new URL(request.url, 'http://fake')
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const repoPrefix = segments[0] === 'repos' && segments[1] === this.owner && segments[2] === this.repo

    if (request.method === 'GET' && repoPrefix && segments.length === 3) {
      this.#sendJson(request, response, 200, {
        name: this.repo,
        full_name: `${this.owner}/${this.repo}`,
        private: true,
        default_branch: this.branch,
        permissions: { admin: true, push: true, pull: true }
      })
      return
    }

    if (!repoPrefix || segments[3] !== 'git') {
      this.#sendJson(request, response, 404, { message: 'Not Found' })
      return
    }

    const resource = segments[4]
    if (request.method === 'GET' && resource === 'ref' && segments[5] === 'heads' && segments[6]) {
      const refName = `heads/${segments.slice(6).join('/')}`
      const sha = this.refs.get(refName)
      if (!sha) {
        this.#sendJson(request, response, 404, { message: 'Reference not found' })
        return
      }
      const etag = `"${sha}"`
      if (request.headers['if-none-match'] === etag) {
        this.#sendJson(request, response, 304, null, { etag }, { consumeRate: false })
        return
      }
      this.#sendJson(request, response, 200, {
        ref: `refs/${refName}`,
        object: { type: 'commit', sha, url: `${this.apiBase}/repos/${this.owner}/${this.repo}/git/commits/${sha}` }
      }, { etag })
      return
    }

    if (request.method === 'GET' && resource === 'commits' && segments[5]) {
      const commit = this.commits.get(segments[5])
      if (!commit) {
        this.#sendJson(request, response, 404, { message: 'Commit not found' })
        return
      }
      this.#sendJson(request, response, 200, {
        sha: commit.sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((sha) => ({ sha }))
      })
      return
    }

    if (request.method === 'GET' && resource === 'trees' && segments[5]) {
      const tree = this.trees.get(segments[5])
      if (!tree) {
        this.#sendJson(request, response, 404, { message: 'Tree not found' })
        return
      }
      this.#sendJson(request, response, 200, {
        sha: segments[5],
        url: `${this.apiBase}${url.pathname}`,
        tree: treeEntries(tree),
        truncated: false
      })
      return
    }

    if (request.method === 'GET' && resource === 'blobs' && segments[5]) {
      const blob = this.blobs.get(segments[5])
      if (!blob) {
        this.#sendJson(request, response, 404, { message: 'Blob not found' })
        return
      }
      this.#sendJson(request, response, 200, {
        sha: segments[5],
        size: blob.length,
        encoding: 'base64',
        content: blob.toString('base64')
      })
      return
    }

    if (request.method === 'POST' && resource === 'blobs' && segments.length === 5) {
      const body = await readJson(request)
      if (typeof body.content !== 'string') {
        this.#sendJson(request, response, 422, { message: 'content must be a string' })
        return
      }
      const blob = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')
      const sha = gitObjectSha('blob', blob)
      this.blobs.set(sha, blob)
      this.#sendJson(request, response, 201, { sha, url: `${this.apiBase}${url.pathname}/${sha}` })
      return
    }

    if (request.method === 'POST' && resource === 'trees' && segments.length === 5) {
      const body = await readJson(request)
      const base = body.base_tree == null ? new Map() : this.trees.get(body.base_tree)
      if (!base || !Array.isArray(body.tree)) {
        this.#sendJson(request, response, 422, { message: 'invalid base_tree or tree' })
        return
      }
      const next = new Map([...base].map(([path, entry]) => [path, { ...entry }]))
      for (const entry of body.tree) {
        if (typeof entry?.path !== 'string') {
          this.#sendJson(request, response, 422, { message: 'tree entry path is required' })
          return
        }
        if (entry.sha == null) {
          next.delete(entry.path)
          continue
        }
        const blob = this.blobs.get(entry.sha)
        if (!blob) {
          this.#sendJson(request, response, 422, { message: `blob ${entry.sha} not found` })
          return
        }
        next.set(entry.path, {
          path: entry.path,
          mode: entry.mode || '100644',
          type: entry.type || 'blob',
          sha: entry.sha,
          size: blob.length,
          url: `${this.apiBase}/repos/${this.owner}/${this.repo}/git/blobs/${entry.sha}`
        })
      }
      const entries = treeEntries(next)
      const sha = gitObjectSha('tree', JSON.stringify(entries.map(({ path, mode, type, sha: entrySha }) => ({ path, mode, type, sha: entrySha }))))
      this.trees.set(sha, next)
      this.#sendJson(request, response, 201, { sha, url: `${this.apiBase}${url.pathname}/${sha}`, tree: entries })
      return
    }

    if (request.method === 'POST' && resource === 'commits' && segments.length === 5) {
      const body = await readJson(request)
      if (typeof body.message !== 'string' || !this.trees.has(body.tree) || !Array.isArray(body.parents)) {
        this.#sendJson(request, response, 422, { message: 'invalid commit' })
        return
      }
      if (body.parents.some((sha) => !this.commits.has(sha))) {
        this.#sendJson(request, response, 422, { message: 'parent commit not found' })
        return
      }
      const commitData = { message: body.message, tree: body.tree, parents: [...body.parents] }
      const sha = gitObjectSha('commit', JSON.stringify(commitData))
      const commit = { sha, ...commitData }
      this.commits.set(sha, commit)
      this.#sendJson(request, response, 201, {
        sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((parentSha) => ({ sha: parentSha }))
      })
      return
    }

    if (request.method === 'PATCH' && resource === 'refs' && segments[5] === 'heads' && segments[6]) {
      const body = await readJson(request)
      const refName = `heads/${segments.slice(6).join('/')}`
      if (this.updateRefFailuresRemaining > 0) {
        this.updateRefFailuresRemaining -= 1
        this.#sendJson(request, response, 422, { message: 'Reference update conflict (injected)' })
        return
      }
      if (!this.refs.has(refName) || !this.commits.has(body.sha)) {
        this.#sendJson(request, response, 422, { message: 'invalid reference update' })
        return
      }
      this.refs.set(refName, body.sha)
      this.#sendJson(request, response, 200, {
        ref: `refs/${refName}`,
        object: { type: 'commit', sha: body.sha }
      })
      return
    }

    this.#sendJson(request, response, 404, { message: 'Not Found' })
  }
}

export async function startFakeGitHubServer(options) {
  return new FakeGitHubServer(options).start()
}
