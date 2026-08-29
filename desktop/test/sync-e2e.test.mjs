import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

const servers = new Set()
const instances = new Set()
const ENGINE_URL = new URL('../sync-engine.mjs', import.meta.url)
const GITHUB_URL = new URL('../sync-github.mjs', import.meta.url)

async function startServer(options) {
  const { startFakeGitHubServer } = await import('./fake-github-server.mjs')
  const server = await startFakeGitHubServer(options)
  servers.add(server)
  return server
}

afterEach(async () => {
  await Promise.all([...instances].map((instance) => instance.close()))
  instances.clear()
  await Promise.all([...servers].map((server) => server.close()))
  servers.clear()
})

async function getRef(server, headers) {
  return fetch(`${server.apiBase}/repos/${server.owner}/${server.repo}/git/ref/heads/${server.branch}`, { headers })
}

async function createCommitOn(server, { parentSha, files, message = 'sync' }) {
  const gitApi = `${server.apiBase}/repos/${server.owner}/${server.repo}/git`
  const parent = await fetch(`${gitApi}/commits/${parentSha}`).then((response) => response.json())
  const entries = []
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      entries.push({ path, sha: null })
      continue
    }
    const blobResponse = await fetch(`${gitApi}/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'utf-8' })
    })
    assert.equal(blobResponse.status, 201)
    const blob = await blobResponse.json()
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const treeResponse = await fetch(`${gitApi}/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries })
  })
  assert.equal(treeResponse.status, 201)
  const tree = await treeResponse.json()
  const commitResponse = await fetch(`${gitApi}/commits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] })
  })
  assert.equal(commitResponse.status, 201)
  return commitResponse.json()
}

test('fake GitHub 的 8 個 Git Data 端點可完成 commit/ref round-trip', async () => {
  const server = await startServer({ owner: 'acme', repo: 'mindflow', branch: 'main' })
  const api = `${server.apiBase}/repos/acme/mindflow/git`

  const initialRef = await fetch(`${api}/ref/heads/main`).then((response) => response.json())
  const initialCommit = await fetch(`${api}/commits/${initialRef.object.sha}`).then((response) => response.json())
  const initialTree = await fetch(`${api}/trees/${initialCommit.tree.sha}?recursive=1`).then((response) => response.json())
  assert.deepEqual(initialTree.tree, [])

  const blobResponse = await fetch(`${api}/blobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '{"schemaVersion":1}', encoding: 'utf-8' })
  })
  assert.equal(blobResponse.status, 201)
  const blob = await blobResponse.json()

  const treeResponse = await fetch(`${api}/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      base_tree: initialCommit.tree.sha,
      tree: [{ path: 'manifest.json', mode: '100644', type: 'blob', sha: blob.sha }]
    })
  })
  assert.equal(treeResponse.status, 201)
  const tree = await treeResponse.json()

  const commitResponse = await fetch(`${api}/commits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'sync', tree: tree.sha, parents: [initialRef.object.sha] })
  })
  assert.equal(commitResponse.status, 201)
  const commit = await commitResponse.json()

  const updateResponse = await fetch(`${api}/refs/heads/main`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false })
  })
  assert.equal(updateResponse.status, 200)

  const updatedRef = await fetch(`${api}/ref/heads/main`).then((response) => response.json())
  assert.equal(updatedRef.object.sha, commit.sha)
  const updatedTree = await fetch(`${api}/trees/${tree.sha}?recursive=1`).then((response) => response.json())
  assert.deepEqual(updatedTree.tree.map(({ path, sha }) => ({ path, sha })), [
    { path: 'manifest.json', sha: blob.sha }
  ])
  const storedBlob = await fetch(`${api}/blobs/${blob.sha}`).then((response) => response.json())
  assert.equal(Buffer.from(storedBlob.content, 'base64').toString('utf8'), '{"schemaVersion":1}')
})

test('If-None-Match 命中時回 304 且不消耗 rate limit', async () => {
  const server = await startServer({ rateRemaining: 9 })
  const first = await getRef(server)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('x-ratelimit-remaining'), '8')
  const etag = first.headers.get('etag')
  assert.ok(etag)

  const cached = await getRef(server, { 'if-none-match': etag })
  assert.equal(cached.status, 304)
  assert.equal(cached.headers.get('etag'), etag)
  assert.equal(cached.headers.get('x-ratelimit-remaining'), '8')
})

test('updateRef 422 可精確注入並在額度用完後恢復', async () => {
  const server = await startServer()
  const currentRef = await getRef(server).then((response) => response.json())
  const commit = await createCommitOn(server, {
    parentSha: currentRef.object.sha,
    files: { 'manifest.json': '{"schemaVersion":1}' }
  })
  server.injectUpdateRef422(2)
  const url = `${server.apiBase}/repos/owner/repo/git/refs/heads/main`
  const request = () => fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false })
  })

  assert.equal((await request()).status, 422)
  assert.equal((await request()).status, 422)
  assert.equal((await request()).status, 200)
  const updated = await getRef(server).then((response) => response.json())
  assert.equal(updated.object.sha, commit.sha)
})

test('offline 開關造成真實 fetch 網路錯誤，關閉後可恢復', async () => {
  const server = await startServer()
  server.setOffline(true)
  await assert.rejects(getRef(server), TypeError)

  server.setOffline(false)
  assert.equal((await getRef(server)).status, 200)
})

test('createTree 的 sha:null 會從 base tree 永久移除路徑', async () => {
  const server = await startServer()
  const firstRef = await getRef(server).then((response) => response.json())
  const firstCommit = await createCommitOn(server, {
    parentSha: firstRef.object.sha,
    files: { 'docs/a.json': '{"id":"a"}', 'manifest.json': '{}' }
  })
  const secondCommit = await createCommitOn(server, {
    parentSha: firstCommit.sha,
    files: { 'docs/a.json': null }
  })
  const tree = await fetch(
    `${server.apiBase}/repos/owner/repo/git/trees/${secondCommit.tree.sha}?recursive=1`
  ).then((response) => response.json())

  assert.deepEqual(tree.tree.map((entry) => entry.path), ['manifest.json'])
})

test('Authorization token 不會進入 request log 或 repo snapshot', async () => {
  const server = await startServer()
  const token = 'github_pat_NEVER_PERSIST_THIS'
  const response = await getRef(server, { authorization: `Bearer ${token}` })
  assert.equal(response.status, 200)

  const serialized = JSON.stringify(server.snapshot())
  assert.equal(serialized.includes(token), false)
  assert.deepEqual(server.requests.at(-1), {
    method: 'GET',
    path: '/repos/owner/repo/git/ref/heads/main',
    status: 200
  })
})

test('大於 1MB 的文件仍由 git/blobs 端點完整往返', async () => {
  const server = await startServer()
  const content = JSON.stringify({ id: 'large', text: '外'.repeat(400_000) })
  assert.ok(Buffer.byteLength(content) > 1024 * 1024)
  const ref = await getRef(server).then((response) => response.json())
  const commit = await createCommitOn(server, {
    parentSha: ref.object.sha,
    files: { 'docs/large.json': content }
  })
  const tree = await fetch(
    `${server.apiBase}/repos/owner/repo/git/trees/${commit.tree.sha}?recursive=1`
  ).then((response) => response.json())
  const blobSha = tree.tree.find((entry) => entry.path === 'docs/large.json').sha
  const blob = await fetch(`${server.apiBase}/repos/owner/repo/git/blobs/${blobSha}`).then((response) => response.json())

  assert.equal(Buffer.from(blob.content, 'base64').toString('utf8'), content)
  assert.equal(server.requests.some((request) => request.path.includes('/contents/')), false)
})

test('frozen sync-github adapter 可經 fake HTTP server 完成 8 端點流程', async () => {
  const github = await import(GITHUB_URL)
  const server = await startServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'feature/sync' })
  const cfg = {
    apiBase: server.apiBase,
    token: 'github_pat_adapter_integration',
    repo: 'chenrui/mindflow-data',
    branch: 'feature/sync'
  }

  const initialRef = await github.getRef(cfg)
  const initialCommit = await github.getCommit(cfg, initialRef.sha)
  assert.deepEqual((await github.getTreeRecursive(cfg, initialCommit.treeSha)).byPath, {})

  const manifestSha = await github.createBlob(cfg, '{"schemaVersion":1}')
  const treeSha = await github.createTree(cfg, {
    baseTreeSha: initialCommit.treeSha,
    entries: [{ path: 'manifest.json', sha: manifestSha }]
  })
  const commitSha = await github.createCommit(cfg, {
    message: 'MindFlow sync',
    treeSha,
    parentSha: initialRef.sha
  })
  server.injectUpdateRef422(1)
  await assert.rejects(
    github.updateRef(cfg, commitSha),
    (error) => error instanceof github.SyncHttpError && error.status === 422 && error.retryable === true
  )
  await github.updateRef(cfg, commitSha)

  const updatedRef = await github.getRef(cfg)
  assert.equal(updatedRef.sha, commitSha)
  assert.equal(await github.getBlobRaw(cfg, manifestSha), '{"schemaVersion":1}')
  const rateBeforeConditionalGet = server.rateRemaining
  assert.deepEqual(await github.getRef(cfg, { etag: updatedRef.etag }), {
    sha: null,
    etag: updatedRef.etag,
    notModified: true,
    rateRemaining: rateBeforeConditionalGet
  })
  assert.equal(JSON.stringify(server.snapshot()).includes(cfg.token), false)
})

class MemoryRendererStorage {
  constructor() {
    this.entries = new Map()
    this.authoritativeWrites = []
    this.#writeIndex({ version: 2, docs: [], trash: [], favorites: [] })
  }

  snapshot() {
    return Object.fromEntries(this.entries)
  }

  index() {
    return JSON.parse(this.entries.get('mindflow.docs.index'))
  }

  doc(id) {
    const value = this.entries.get(`mindflow.doc.${id}`)
    return value == null ? null : JSON.parse(value)
  }

  activeDocs() {
    return this.index().docs.map((meta) => this.doc(meta.id)).filter(Boolean)
  }

  putDoc({ id, title, createdAt, updatedAt }) {
    const document = {
      version: 1,
      id,
      title,
      createdAt,
      updatedAt,
      root: { id: `${id}-root`, text: title, children: [] }
    }
    const index = this.index()
    const metadata = { id, title, createdAt, updatedAt, thumbnail: '' }
    const position = index.docs.findIndex((item) => item.id === id)
    if (position === -1) index.docs.push(metadata)
    else index.docs[position] = metadata
    index.trash = index.trash.filter((item) => item.id !== id)
    this.entries.set(`mindflow.doc.${id}`, JSON.stringify(document))
    this.#writeIndex(index)
  }

  editDoc(id, { title, updatedAt }) {
    const current = this.doc(id)
    assert.ok(current, `cannot edit missing document ${id}`)
    this.putDoc({ id, title, createdAt: current.createdAt, updatedAt })
  }

  purgeDoc(id) {
    const index = this.index()
    index.docs = index.docs.filter((item) => item.id !== id)
    index.trash = index.trash.filter((item) => item.id !== id)
    index.favorites = index.favorites.filter((favoriteId) => favoriteId !== id)
    this.entries.delete(`mindflow.doc.${id}`)
    this.#writeIndex(index)
  }

  setFavorite(id, favorite) {
    const index = this.index()
    const favorites = new Set(index.favorites)
    if (favorite) favorites.add(id)
    else favorites.delete(id)
    index.favorites = [...favorites]
    this.#writeIndex(index)
  }

  applyAuthoritativeWrites(writes) {
    this.authoritativeWrites.push(structuredClone(writes))
    for (const key of writes.removeKeys || []) this.entries.delete(key)
    // sync 是權威寫入：測試 seam 只接受 frozen computeLocalWrites 的 set/remove 形狀。
    for (const [key, value] of Object.entries(writes.setKeys || {})) this.entries.set(key, value)
  }

  #writeIndex(index) {
    this.entries.set('mindflow.docs.index', JSON.stringify(index))
  }
}

function createClock(initialIso) {
  let current = new Date(initialIso)
  return {
    now: () => new Date(current),
    set(iso) { current = new Date(iso) }
  }
}

async function createSyncInstance({ name, server, token, clock }) {
  const module = await import(ENGINE_URL)
  const factory = module.createSyncEngineForTest || module.createSyncEngine
  assert.equal(
    typeof factory,
    'function',
    'SYNC-E 必須提供 createSyncEngineForTest 或 createSyncEngine，讓純 Node E2E 注入 renderer I/O'
  )

  const userDataPath = await mkdtemp(join(tmpdir(), `mindflow-sync-${name}-`))
  const storage = new MemoryRendererStorage()
  const logs = []
  const cfg = {
    apiBase: server.apiBase,
    token,
    repo: `${server.owner}/${server.repo}`,
    branch: server.branch
  }
  const readEntries = async () => storage.snapshot()
  const applyWrites = async (writes) => storage.applyAuthoritativeWrites(writes)
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
    level,
    (...args) => logs.push({ level, args })
  ]))
  const options = {
    cfg,
    config: cfg,
    userDataPath,
    machineId: name,
    now: clock.now,
    logger,
    readEntries,
    readLocalEntries: readEntries,
    getLocalEntries: readEntries,
    applyWrites,
    applyLocalWrites: applyWrites
  }
  let engine
  try {
    engine = await factory(options)
  } catch (error) {
    if (!/class constructor/i.test(String(error?.message))) throw error
    engine = new factory(options)
  }
  const run = engine?.syncNow || engine?.sync || engine?.run
  assert.equal(typeof run, 'function', 'SYNC-E test instance 必須提供 syncNow、sync 或 run')

  const instance = {
    name,
    storage,
    logs,
    userDataPath,
    async syncNow() {
      const originalConsole = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, console[level]]))
      for (const level of Object.keys(originalConsole)) {
        console[level] = (...args) => logs.push({ level: `console.${level}`, args })
      }
      try {
        const result = await run.call(engine)
        if (result?.ok === false) throw new Error(result.error || `${name} sync failed`)
        return result
      } finally {
        for (const [level, method] of Object.entries(originalConsole)) console[level] = method
      }
    },
    async getConfig() {
      if (typeof engine?.getConfig !== 'function') return null
      return engine.getConfig()
    },
    async close() {
      await engine?.close?.()
      await engine?.dispose?.()
      await rm(userDataPath, { recursive: true, force: true })
    }
  }
  instances.add(instance)
  return instance
}

async function readUserDataText(directory) {
  const chunks = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else chunks.push(await readFile(path, 'utf8').catch(() => ''))
    }
  }
  await visit(directory)
  return chunks.join('\n')
}

async function assertSyncSafety({ token, server, instances: syncInstances }) {
  assert.equal(JSON.stringify(server.snapshot()).includes(token), false, 'token 不得進 repo commit 或 fake server log')
  for (const instance of syncInstances) {
    assert.equal(
      JSON.stringify(instance.storage.snapshot()).includes(token),
      false,
      `${instance.name} 的 localStorage 不得出現 token`
    )
    assert.equal(
      JSON.stringify(instance.logs).includes(token),
      false,
      `${instance.name} 的 console/logger 不得出現 token`
    )
    assert.equal(
      (await readUserDataText(instance.userDataPath)).includes(token),
      false,
      `${instance.name} 的 backup/settings/state 不得出現明文 token`
    )
    assert.equal(
      JSON.stringify(await instance.getConfig()).includes(token),
      false,
      `${instance.name} 的 getConfig 不得回傳 token`
    )
    assert.equal(
      JSON.stringify(instance.storage.authoritativeWrites).includes('expectedUpdatedAt'),
      false,
      `${instance.name} 的同步 renderer 寫入不可攜帶 expectedUpdatedAt`
    )
  }
}

function assertPullBeforePush(requests) {
  const pull = requests.findIndex((request) => request.method === 'GET' && request.path.includes('/git/ref/'))
  const push = requests.findIndex((request) => ['POST', 'PATCH'].includes(request.method))
  assert.ok(pull >= 0, '同步必須先讀 remote ref')
  assert.ok(push >= 0, '有本地變更時同步必須 push')
  assert.ok(pull < push, 'pull 必須發生在任何 push request 之前')
}

async function createPair() {
  const token = 'github_pat_E2E_SECRET_NEVER_PERSIST'
  const server = await startServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const clockA = createClock('2026-08-30T01:00:00.000Z')
  const clockB = createClock('2026-08-30T01:00:00.000Z')
  const a = await createSyncInstance({ name: 'machine-A', server, token, clock: clockA })
  const b = await createSyncInstance({ name: 'machine-B', server, token, clock: clockB })
  return { token, server, clockA, clockB, a, b }
}

test('雙實例：A 建圖並 push 後，B 只經 GitHub 中樞 pull 看見同一份圖', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({
    id: 'roadmap',
    title: '產品路線圖',
    createdAt: '2026-08-30T01:00:00.000Z',
    updatedAt: '2026-08-30T01:00:00.000Z'
  })

  const requestStart = pair.server.requests.length
  await pair.a.syncNow()
  assertPullBeforePush(pair.server.requests.slice(requestStart))
  await pair.b.syncNow()

  assert.equal(pair.b.storage.doc('roadmap')?.title, '產品路線圖')
  assert.deepEqual(pair.b.storage.index().docs.map((doc) => doc.id), ['roadmap'])
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('雙實例：離線雙編後重連，較新版本勝出且輸方保留為衝突副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({
    id: 'campaign',
    title: '共同初稿',
    createdAt: '2026-08-30T01:00:00.000Z',
    updatedAt: '2026-08-30T01:00:00.000Z'
  })
  await pair.a.syncNow()
  await pair.b.syncNow()

  pair.server.setOffline(true)
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.clockB.set('2026-08-30T03:00:00.000Z')
  pair.a.storage.editDoc('campaign', { title: 'A 離線版本', updatedAt: '2026-08-30T02:00:00.000Z' })
  pair.b.storage.editDoc('campaign', { title: 'B 離線版本', updatedAt: '2026-08-30T03:00:00.000Z' })
  pair.server.setOffline(false)

  pair.server.injectUpdateRef422(1)
  const retryStart = pair.server.requests.length
  await pair.a.syncNow()
  const retryRequests = pair.server.requests.slice(retryStart)
  const injectedPatch = retryRequests.findIndex((request) => request.method === 'PATCH' && request.status === 422)
  assert.ok(injectedPatch >= 0, '必須命中一次注入的 updateRef 422')
  assert.ok(
    retryRequests.slice(injectedPatch + 1).some((request) => request.method === 'GET' && request.path.includes('/git/ref/')),
    'updateRef 422 後必須重拉 remote ref 再合併'
  )
  assert.ok(
    retryRequests.slice(injectedPatch + 1).some((request) => request.method === 'PATCH' && request.status === 200),
    'updateRef 422 後必須在三次上限內重推成功'
  )
  await pair.b.syncNow()
  await pair.a.syncNow()

  for (const instance of [pair.a, pair.b]) {
    const documents = instance.storage.activeDocs()
    assert.equal(instance.storage.doc('campaign')?.title, 'B 離線版本')
    assert.equal(documents.length, 2)
    assert.ok(documents.some((doc) => doc.title.includes('A 離線版本') && doc.title.includes('衝突副本')))
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('雙實例：A 永久刪除後，tombstone 經中樞讓 B 徹底移除文件', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({
    id: 'obsolete',
    title: '待永久刪除',
    createdAt: '2026-08-30T01:00:00.000Z',
    updatedAt: '2026-08-30T01:00:00.000Z'
  })
  await pair.a.syncNow()
  await pair.b.syncNow()
  pair.clockA.set('2026-08-30T04:00:00.000Z')
  pair.a.storage.purgeDoc('obsolete')

  await pair.a.syncNow()
  await pair.b.syncNow()

  assert.equal(pair.b.storage.doc('obsolete'), null)
  assert.equal(pair.b.storage.index().docs.some((doc) => doc.id === 'obsolete'), false)
  const remote = pair.server.snapshot()
  const headCommit = remote.commits[remote.refs['heads/main']]
  const manifestEntry = remote.trees[headCommit.tree].find(entry => entry.path === 'manifest.json')
  const manifest = JSON.parse(remote.blobs[manifestEntry.sha])
  assert.equal(typeof manifest.tombstones.obsolete, 'string')
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('雙實例：B 收藏後，favorite delta 經中樞傳回 A', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({
    id: 'favorite-me',
    title: '重要專案',
    createdAt: '2026-08-30T01:00:00.000Z',
    updatedAt: '2026-08-30T01:00:00.000Z'
  })
  await pair.a.syncNow()
  await pair.b.syncNow()
  pair.b.storage.setFavorite('favorite-me', true)

  await pair.b.syncNow()
  await pair.a.syncNow()

  assert.deepEqual(pair.a.storage.index().favorites, ['favorite-me'])
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})
