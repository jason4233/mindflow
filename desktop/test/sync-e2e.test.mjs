import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import vm from 'node:vm'

import { normalizeMindflowEntries, rendererRestoreScript } from '../backup-store.mjs'
import { CONFLICT_COPY_CANDIDATES, buildConflictCopy } from '../sync-plan.mjs'

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
    // 模擬 renderer 套用腳本的原子比對：同步讀快照後本機若又改了要被覆蓋的 key，整批不寫。
    if (writes.expected) {
      const changedKeys = Object.keys(writes.expected).filter((key) => (this.entries.get(key) ?? null) !== writes.expected[key])
      if (changedKeys.length) return { conflict: true, changedKeys }
    }
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

async function createSyncInstance({ name, server, token, clock, engineOptions = {} }) {
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
  // hooks 讓測試在「同步讀完快照之後」或「套用之前」插入使用者的存檔，重現同步期間的競爭。
  const hooks = {}
  let readCount = 0
  const readEntries = async () => {
    const snapshot = storage.snapshot()
    readCount += 1
    hooks.afterRead?.(readCount)
    return snapshot
  }
  const applyWrites = async (writes) => {
    await hooks.beforeApply?.(writes)
    return storage.applyAuthoritativeWrites(writes)
  }
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
    applyLocalWrites: applyWrites,
    ...engineOptions
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
    engine,
    storage,
    logs,
    hooks,
    readCount: () => readCount,
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


function conflictCopies(instance) {
  return instance.storage.activeDocs().filter((doc) => doc.title.includes('衝突副本'))
}

test('競爭：同步讀完快照、推送前使用者又存了同一份圖 → 重跑一輪，推上去的是最新版、不產生副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'plan', title: 'v1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await pair.b.syncNow()

  pair.a.storage.editDoc('plan', { title: 'v2', updatedAt: '2026-08-30T01:05:00.000Z' })
  let armed = true
  pair.a.hooks.afterRead = () => {
    // 這次同步第一次讀完快照後，使用者又改了一次（v3）
    if (!armed) return
    armed = false
    pair.a.storage.editDoc('plan', { title: 'v3', updatedAt: '2026-08-30T01:05:30.000Z' })
  }
  await pair.a.syncNow()
  pair.a.hooks.afterRead = null
  await pair.b.syncNow()

  assert.equal(pair.a.storage.doc('plan').title, 'v3')
  assert.equal(pair.b.storage.doc('plan').title, 'v3', 'B 必須拿到推送前最後一次的修改')
  assert.equal(conflictCopies(pair.a).length, 0)
  assert.equal(conflictCopies(pair.b).length, 0)
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('競爭：同步要把遠端版本寫進本機前，使用者剛好在本機改了同一份圖 → 本機修改不會被蓋掉', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'notes', title: '共同版本', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await pair.b.syncNow()

  pair.clockB.set('2026-08-30T02:00:00.000Z')
  pair.b.storage.editDoc('notes', { title: 'B 的修改', updatedAt: '2026-08-30T02:00:00.000Z' })
  await pair.b.syncNow()

  let injected = false
  pair.clockA.set('2026-08-30T02:10:00.000Z')
  pair.a.hooks.beforeApply = () => {
    if (injected) return
    injected = true
    // 同步已經走完網路、正要套用 B 的版本：使用者在 A 上剛存了一筆
    pair.a.storage.editDoc('notes', { title: 'A 剛存的修改', updatedAt: '2026-08-30T02:10:00.000Z' })
  }
  await pair.a.syncNow()
  pair.a.hooks.beforeApply = null
  await pair.b.syncNow()

  // 真正的同時修改：A 較新所以勝出，B 的版本保留成衝突副本；重點是 A 的修改沒有被默默蓋掉。
  for (const instance of [pair.a, pair.b]) {
    assert.equal(instance.storage.doc('notes').title, 'A 剛存的修改')
    const copies = conflictCopies(instance)
    assert.equal(copies.length, 1)
    assert.ok(copies[0].title.includes('B 的修改'))
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('推送成功但本機套用失敗（base 沒前進）→ 下一次同步不會產生內容相同的衝突副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'alpha', title: 'alpha v1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'beta', title: 'beta v1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await pair.b.syncNow()

  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.clockB.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.editDoc('alpha', { title: 'alpha v2', updatedAt: '2026-08-30T02:00:00.000Z' })
  pair.b.storage.editDoc('beta', { title: 'beta v2', updatedAt: '2026-08-30T02:00:01.000Z' })
  await pair.b.syncNow()

  let failed = false
  pair.a.hooks.beforeApply = () => {
    if (failed) return
    failed = true
    throw new Error('renderer quota failure')
  }
  await assert.rejects(pair.a.syncNow(), /quota/)
  pair.a.hooks.beforeApply = null
  await pair.a.syncNow()
  await pair.b.syncNow()

  for (const instance of [pair.a, pair.b]) {
    assert.equal(instance.storage.doc('alpha').title, 'alpha v2')
    assert.equal(instance.storage.doc('beta').title, 'beta v2')
    assert.equal(conflictCopies(instance).length, 0, `${instance.name} 不應出現內容相同的衝突副本`)
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

function remoteManifest(server) {
  const remote = server.snapshot()
  const headCommit = remote.commits[remote.refs['heads/main']]
  const manifestEntry = remote.trees[headCommit.tree].find(entry => entry.path === 'manifest.json')
  return JSON.parse(remote.blobs[manifestEntry.sha])
}

async function savedSyncState(instance) {
  return JSON.parse(await readFile(join(instance.userDataPath, 'sync-state.json'), 'utf8'))
}

test('複審 HIGH：同步把遠端內容寫進本機後、localStorage 落盤前程式被殺 → 重開後不刪雲端文件、不回退遠端修改', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'kept', title: 'kept v1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await pair.b.syncNow()
  // Chromium 約 5 秒後才把 localStorage 寫到磁碟：先記下 B「磁碟上」的內容（含當時的識別碼）
  const diskBeforeSync = pair.b.storage.snapshot()

  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.editDoc('kept', { title: 'kept v2（A 的修改）', updatedAt: '2026-08-30T02:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'fresh', title: 'A 新建', createdAt: '2026-08-30T02:00:00.000Z', updatedAt: '2026-08-30T02:00:00.000Z' })
  await pair.a.syncNow()

  pair.clockB.set('2026-08-30T02:05:00.000Z')
  await pair.b.syncNow()
  assert.equal(pair.b.storage.doc('fresh')?.title, 'A 新建')
  // 同步狀態已立刻寫入，localStorage 卻還沒落盤就被殺：重開後是舊內容與舊識別碼
  pair.b.storage.entries = new Map(Object.entries(diskBeforeSync))

  pair.clockB.set('2026-08-30T02:10:00.000Z')
  await pair.b.syncNow()
  await pair.a.syncNow()

  assert.deepEqual(remoteManifest(pair.server).tombstones, {}, '沒有任何文件被記成刪除')
  for (const instance of [pair.a, pair.b]) {
    assert.equal(instance.storage.doc('fresh')?.title, 'A 新建', `${instance.name} 的 fresh 必須還在`)
    assert.equal(instance.storage.doc('kept')?.title, 'kept v2（A 的修改）', `${instance.name} 的 kept 不能被回退成 v1`)
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('複審 HIGH 缺口：只推送、本機沒有其他寫入的一輪也要把新識別碼寫進本機，下一輪 base 才可信', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'solo', title: 'solo v1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.editDoc('solo', { title: 'solo v2', updatedAt: '2026-08-30T02:00:00.000Z' })
  await pair.a.syncNow()

  const marker = pair.a.storage.snapshot()['mindflow.sync.storeEpoch']
  assert.equal(typeof marker, 'string')
  assert.equal(marker, (await savedSyncState(pair.a)).storeEpoch, '本機標記必須與同步狀態的識別碼一致')
  // base 可信時永久刪除才會傳到雲端；若被當成首次同步（只做聯集），文件會從雲端被拉回來
  pair.clockA.set('2026-08-30T03:00:00.000Z')
  pair.a.storage.purgeDoc('solo')
  await pair.a.syncNow()
  assert.equal(typeof remoteManifest(pair.server).tombstones.solo, 'string', '刪除必須傳到雲端')
  assert.equal(pair.a.storage.doc('solo'), null, '文件不能被當成首次同步拉回來')
  assert.equal(conflictCopies(pair.a).length, 0)
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a] })
})

test('複審 MEDIUM：base 不可信、本機套用一直失敗時，每次重試不會再多推一份衝突副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '雲端版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  // B 第一次同步（base 不可信），本機已有同 id、內容不同的文件 → 一定會產生一份衝突副本
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  let failures = 0
  pair.b.hooks.beforeApply = () => {
    if (failures >= 2) return
    failures += 1
    throw new Error('renderer quota failure')
  }
  // 推送成功、套用失敗兩次（base 一直沒前進）；每次重試的時間都不同
  for (const at of ['2026-08-30T02:00:00.000Z', '2026-08-30T02:05:00.000Z']) {
    pair.clockB.set(at)
    await assert.rejects(pair.b.syncNow(), /quota/)
  }
  pair.b.hooks.beforeApply = null
  pair.clockB.set('2026-08-30T02:10:00.000Z')
  await pair.b.syncNow()
  await pair.a.syncNow()

  const remoteCopies = Object.values(remoteManifest(pair.server).docs).filter(doc => doc.title.includes('衝突副本'))
  assert.equal(remoteCopies.length, 1, JSON.stringify(remoteCopies.map(doc => doc.title)))
  for (const instance of [pair.a, pair.b]) {
    assert.equal(conflictCopies(instance).length, 1, `${instance.name} 只有一份衝突副本`)
    assert.ok(conflictCopies(instance)[0].title.includes('B 本機版本'))
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('複審（id 不含時間後的保護）：同一份輸方內容再次衝突時，使用者改過的衝突副本不會被蓋掉', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '雲端版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.clockB.set('2026-08-30T02:00:00.000Z')
  await pair.b.syncNow()
  const [copy] = conflictCopies(pair.b)
  assert.ok(copy, '第一次衝突產生副本')

  // 使用者在副本上繼續編輯並同步
  pair.clockB.set('2026-08-30T03:00:00.000Z')
  pair.b.storage.editDoc(copy.id, { title: '副本（使用者改過）', updatedAt: '2026-08-30T03:00:00.000Z' })
  await pair.b.syncNow()
  // 之後同一份「B 本機版本」又回到 B（例如從舊的匯出檔還原），base 也因還原而不可信
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.b.storage.entries.set('mindflow.sync.storeEpoch', 'restored-from-export')
  pair.clockB.set('2026-08-30T04:00:00.000Z')
  await pair.b.syncNow()
  await pair.a.syncNow()

  for (const instance of [pair.a, pair.b]) {
    assert.equal(instance.storage.doc(copy.id)?.title, '副本（使用者改過）', `${instance.name} 上使用者改過的副本必須保留`)
    const copies = conflictCopies(instance).filter(doc => doc.title.includes('B 本機版本'))
    assert.equal(copies.length, 1, '這一次的輸方內容另存成一份新的副本')
    assert.notEqual(copies[0].id, copy.id)
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

async function stripStoreEpoch(instance) {
  // 模擬 M1 以前的版本留下的狀態：同步狀態與本機都沒有識別碼
  const state = await savedSyncState(instance)
  delete state.storeEpoch
  await writeFile(join(instance.userDataPath, 'sync-state.json'), JSON.stringify(state))
  instance.storage.entries.delete('mindflow.sync.storeEpoch')
}

test('複審 MEDIUM：升級前、沒有識別碼的 base，本機每份文件都還在 → 信任一次：別台的刪除照常套用、不會復活、不多出副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'keep', title: '留著', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'drop', title: '別台刪掉的', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await pair.b.syncNow()
  await stripStoreEpoch(pair.a)

  pair.clockB.set('2026-08-30T02:00:00.000Z')
  pair.b.storage.purgeDoc('drop')
  await pair.b.syncNow()
  pair.clockA.set('2026-08-30T02:10:00.000Z')
  await pair.a.syncNow()

  assert.equal(typeof remoteManifest(pair.server).tombstones.drop, 'string', '刪除維持在雲端')
  assert.equal(pair.a.storage.doc('drop'), null, '信任 base：別台的刪除照常套用，沒有被當成首次同步復活')
  assert.equal(conflictCopies(pair.a).length, 0)
  const marker = pair.a.storage.snapshot()['mindflow.sync.storeEpoch']
  assert.equal(typeof marker, 'string', '升級後第一次同步補上識別碼')
  assert.equal(marker, (await savedSyncState(pair.a)).storeEpoch)
})

test('Sol #2 的代價：升級前的 base、本機已刪掉其中一份但還沒同步出去 → 當首次同步，刪除不會傳出去、文件被加回來，但雲端一份都不會被刪', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'keep', title: '留著', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'drop', title: '本機刪掉的', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await stripStoreEpoch(pair.a)
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.purgeDoc('drop')
  await pair.a.syncNow()

  const manifest = remoteManifest(pair.server)
  assert.deepEqual(manifest.tombstones, {})
  assert.ok(manifest.docs.drop)
  assert.equal(pair.a.storage.doc('drop')?.title, '本機刪掉的', '本機刪除分不出是不是資料遺失：寧可加回來')
})

test('複審（legacy 例外的破口）：升級前的 base＋WebView 資料遺失後先新建文件 → 不能把雲端文件全記成刪除', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'a', title: 'A', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'b', title: 'B', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await stripStoreEpoch(pair.a)

  // 升級後、第一次同步之前 renderer 資料遺失，使用者先新建了一份文件（索引存在，不算「儲存區整個遺失」）
  pair.a.storage.entries = new Map([['mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] })]])
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.putDoc({ id: 'n', title: '遺失後新建的', createdAt: '2026-08-30T02:00:00.000Z', updatedAt: '2026-08-30T02:00:00.000Z' })
  await pair.a.syncNow()

  const manifest = remoteManifest(pair.server)
  assert.deepEqual(manifest.tombstones, {}, '沒有任何文件被記成刪除')
  assert.deepEqual(Object.keys(manifest.docs).sort(), ['a', 'b', 'n'])
  assert.deepEqual(pair.a.storage.index().docs.map(doc => doc.id).sort(), ['a', 'b', 'n'])
})

test('複審（id 不含時間後的保護）：同內容的舊副本已被永久刪除 → 再次衝突時另建一份，不跟 tombstone 打架', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '雲端版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.clockB.set('2026-08-30T02:00:00.000Z')
  await pair.b.syncNow()
  const [oldCopy] = conflictCopies(pair.b)
  assert.ok(oldCopy, '第一次衝突產生副本')

  // A 把那份副本永久刪除，tombstone 傳到 B
  await pair.a.syncNow()
  pair.clockA.set('2026-08-30T03:00:00.000Z')
  pair.a.storage.purgeDoc(oldCopy.id)
  await pair.a.syncNow()
  pair.clockB.set('2026-08-30T03:30:00.000Z')
  await pair.b.syncNow()
  assert.equal(pair.b.storage.doc(oldCopy.id), null)

  // 同一份「B 本機版本」又回到 B（例如從舊的匯出檔還原），base 也因還原而不可信
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.b.storage.entries.set('mindflow.sync.storeEpoch', 'restored-from-export')
  pair.clockB.set('2026-08-30T04:00:00.000Z')
  await pair.b.syncNow()
  await pair.a.syncNow()

  const manifest = remoteManifest(pair.server)
  const both = Object.keys(manifest.docs).filter(id => Object.hasOwn(manifest.tombstones, id))
  assert.deepEqual(both, [], 'manifest 不能同時有同一個 id 的文件與 tombstone')
  assert.equal(typeof manifest.tombstones[oldCopy.id], 'string', '舊副本的刪除維持不變')
  for (const instance of [pair.a, pair.b]) {
    const copies = conflictCopies(instance).filter(doc => doc.title.includes('B 本機版本'))
    assert.equal(copies.length, 1, `${instance.name} 上這一次的輸方內容另存成一份新的副本`)
    assert.notEqual(copies[0].id, oldCopy.id)
  }
  await assertSyncSafety({ token: pair.token, server: pair.server, instances: [pair.a, pair.b] })
})

test('複審 MEDIUM＋LOW：升級前的 base 加上從備份還原較舊的內容 → 不信任 base，雲端文件不被刪、不被回退', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'old', title: 'old v1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  const backupEntries = normalizeMindflowEntries(pair.a.storage.snapshot())
  assert.equal(backupEntries['mindflow.sync.storeEpoch'], undefined, '識別碼不進備份')

  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.editDoc('old', { title: 'old v2（較新）', updatedAt: '2026-08-30T02:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'later', title: '備份之後才建立', createdAt: '2026-08-30T02:00:00.000Z', updatedAt: '2026-08-30T02:00:00.000Z' })
  await pair.a.syncNow()
  await stripStoreEpoch(pair.a)

  // renderer 資料不見 → main 用和正式程式相同的還原腳本把備份寫回 localStorage
  pair.a.storage.entries = new Map()
  const localStorage = {
    setItem: (key, value) => { pair.a.storage.entries.set(String(key), String(value)) },
    getItem: key => pair.a.storage.entries.get(String(key)) ?? null
  }
  vm.runInNewContext(rendererRestoreScript(backupEntries, { storeEpoch: 'restored-epoch' }), { localStorage })
  pair.clockA.set('2026-08-30T03:00:00.000Z')
  await pair.a.syncNow()

  const manifest = remoteManifest(pair.server)
  assert.deepEqual(manifest.tombstones, {}, '沒有任何文件被記成刪除')
  assert.ok(manifest.docs.later, 'later 還在雲端')
  assert.equal(pair.a.storage.doc('later')?.title, '備份之後才建立')
  assert.equal(pair.a.storage.doc('old')?.title, 'old v2（較新）', 'old 沒有被回退成 v1')
})

test('Sol #1：推送成功但沒套用、立刻重試且兩邊內容已相同 → base 前進時也要換識別碼，之後被殺不會把較新版本蓋回', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'plan', title: 'plan t1', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  // 磁碟上是 t1（含當時的識別碼）；記憶體裡又改成 t2，還沒落盤
  const disk = pair.a.storage.snapshot()
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.editDoc('plan', { title: 'plan t2', updatedAt: '2026-08-30T02:00:00.000Z' })

  // 推送成功，但本機沒套用（等同 updateRef 回應遺失）：同步狀態與 localStorage 都沒前進
  let failed = false
  pair.a.hooks.beforeApply = () => {
    if (failed) return
    failed = true
    throw new Error('renderer quota failure')
  }
  await assert.rejects(pair.a.syncNow(), /quota/)
  pair.a.hooks.beforeApply = null
  // 使用者立刻重試：兩邊內容相同、沒有東西要推或要寫，但 base 會前進到 t2
  pair.clockA.set('2026-08-30T02:01:00.000Z')
  await pair.a.syncNow()
  // 程式在 localStorage 落盤前被殺：磁碟回到 t1
  pair.a.storage.entries = new Map(Object.entries(disk))
  pair.clockA.set('2026-08-30T02:10:00.000Z')
  await pair.a.syncNow()

  assert.equal(remoteManifest(pair.server).docs.plan.updatedAt, '2026-08-30T02:00:00.000Z', '雲端的 t2 不能被舊的 t1 蓋回')
  const titles = pair.a.storage.activeDocs().map(doc => doc.title)
  assert.ok(titles.includes('plan t2'), JSON.stringify(titles))
})

test('Sol #2：升級前的 base，本機索引仍列著某份文件但內容遺失 → 不能把它當成刪除推上雲端', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'kept', title: '還在', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'lost', title: '內容遺失', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await stripStoreEpoch(pair.a)
  // 索引還在、kept 還在，lost 的文件本體不見（例如寫入一半）
  pair.a.storage.entries.delete('mindflow.doc.lost')
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  await pair.a.syncNow()

  const manifest = remoteManifest(pair.server)
  assert.deepEqual(manifest.tombstones, {}, '沒有明確的刪除證據，不能記成刪除')
  assert.ok(manifest.docs.lost, '雲端的 lost 還在')
  assert.equal(pair.a.storage.doc('lost')?.title, '內容遺失', '本機從雲端拉回來')
})

test('Sol #3：本機原封不動的舊副本不能遮住雲端已被修改的同 id 副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '雲端版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.clockB.set('2026-08-30T02:00:00.000Z')
  await pair.b.syncNow()
  const [copy] = conflictCopies(pair.b)
  assert.ok(copy)

  // A 拿到副本後修改它（較新）並推上雲端；B 還沒同步，本機仍是原封不動的副本
  await pair.a.syncNow()
  pair.clockA.set('2026-08-30T03:00:00.000Z')
  pair.a.storage.editDoc(copy.id, { title: '副本（A 改過）', updatedAt: '2026-08-30T03:00:00.000Z' })
  await pair.a.syncNow()
  // B 的 shared 又回到舊內容（例如舊快照還原），base 也因此不可信
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.b.storage.entries.set('mindflow.sync.storeEpoch', 'restored-snapshot')
  pair.clockB.set('2026-08-30T04:00:00.000Z')
  await pair.b.syncNow()
  await pair.a.syncNow()

  const remote = pair.server.snapshot()
  const tree = remote.trees[remote.commits[remote.refs['heads/main']].tree]
  const remoteCopy = JSON.parse(remote.blobs[tree.find(entry => entry.path === `docs/${copy.id}.json`).sha])
  assert.equal(remoteCopy.title, '副本（A 改過）', '雲端那份被改過的副本不能被重新產生的副本蓋掉')
  for (const instance of [pair.a, pair.b]) {
    assert.equal(instance.storage.doc(copy.id)?.title, '副本（A 改過）', `${instance.name}`)
    assert.ok(conflictCopies(instance).some(doc => doc.id !== copy.id && doc.title.includes('B 本機版本')), `${instance.name} 這一次的輸方內容另存一份`)
  }
})

test('Sol #4：開機救援（備份還原／舊資料搬入）完成前，聚焦、手動、設定觸發的同步都要等', async () => {
  const server = await startServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  let openGate
  const startGate = new Promise(resolve => { openGate = resolve })
  const instance = await createSyncInstance({
    name: 'machine-gate',
    server,
    token: 'TEST-ONLY-NOT-A-REAL-TOKEN-gate',
    clock: createClock('2026-08-30T01:00:00.000Z'),
    engineOptions: { startGate }
  })
  instance.storage.putDoc({ id: 'doc', title: '文件', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  const before = server.requests.length
  const pending = instance.syncNow()
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(server.requests.length, before, '救援還沒結束：一個 GitHub 請求都不能發')
  openGate()
  await pending
  assert.ok(server.requests.length > before, '救援結束後照常同步')
})

test('Sol #5：穩定 id 不能沿用時另建的副本，在推送成功、套用失敗的重試之間不能越積越多', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '雲端版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.clockB.set('2026-08-30T02:00:00.000Z')
  await pair.b.syncNow()
  const [copy] = conflictCopies(pair.b)
  // 穩定 id 的副本被使用者改過 → 之後同一份輸方內容不能沿用它
  pair.clockB.set('2026-08-30T03:00:00.000Z')
  pair.b.storage.editDoc(copy.id, { title: '副本（使用者改過）', updatedAt: '2026-08-30T03:00:00.000Z' })
  await pair.b.syncNow()

  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  pair.b.storage.entries.set('mindflow.sync.storeEpoch', 'restored-from-export')
  let failures = 0
  pair.b.hooks.beforeApply = () => {
    if (failures >= 2) return
    failures += 1
    throw new Error('renderer quota failure')
  }
  for (const at of ['2026-08-30T04:00:00.000Z', '2026-08-30T04:05:00.000Z']) {
    pair.clockB.set(at)
    await assert.rejects(pair.b.syncNow(), /quota/)
  }
  pair.b.hooks.beforeApply = null
  pair.clockB.set('2026-08-30T04:10:00.000Z')
  await pair.b.syncNow()
  await pair.a.syncNow()

  const newCopies = Object.entries(remoteManifest(pair.server).docs)
    .filter(([id, doc]) => id !== copy.id && doc.title.includes('B 本機版本'))
  assert.equal(newCopies.length, 1, JSON.stringify(newCopies.map(([id, doc]) => `${id} ${doc.title}`)))
  assert.equal(pair.b.storage.doc(copy.id)?.title, '副本（使用者改過）')
})

test('Sol 2-#1：32 個候選 id 都不能用時，退路的 id 也要過安全檢查；同一輪重試不能拿輸方內容蓋掉別台剛改過的副本', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '雲端版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.b.storage.putDoc({ id: 'shared', title: 'B 本機版本', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:30:00.000Z' })
  const loserRaw = pair.b.storage.entries.get('mindflow.doc.shared')
  // 32 個候選 id 都已被別的內容佔用（被改過的副本）→ 一個都不能沿用
  for (let attempt = 0; attempt < CONFLICT_COPY_CANDIDATES; attempt += 1) {
    const { id } = buildConflictCopy(loserRaw, 'machine-B', new Date('2026-08-30T02:00:00.000Z'), { attempt })
    pair.a.storage.putDoc({ id, title: `佔用 ${attempt}`, createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  }
  await pair.a.syncNow()

  // B 第一次同步：推送了退路副本 F 之後、套用之前，B 本機新建一份文件（套用的 CAS 被拒、同一輪重跑），
  // 而 A 在重跑之前拉到 F、改了它並推上雲端
  const before = new Set(Object.keys(remoteManifest(pair.server).docs))
  let injected = false
  pair.b.hooks.beforeApply = async () => {
    if (injected) return
    injected = true
    pair.b.storage.putDoc({ id: 'other', title: 'B 剛新建', createdAt: '2026-08-30T02:00:00.000Z', updatedAt: '2026-08-30T02:00:00.000Z' })
    const fallbackId = Object.keys(remoteManifest(pair.server).docs).find(id => !before.has(id) && id !== 'shared')
    assert.ok(fallbackId, '退路副本已推上雲端')
    await pair.a.syncNow()
    pair.clockA.set('2026-08-30T03:00:00.000Z')
    pair.a.storage.editDoc(fallbackId, { title: 'F（A 剛改過）', updatedAt: '2026-08-30T03:00:00.000Z' })
    await pair.a.syncNow()
    pair.fallbackId = fallbackId
  }
  pair.clockB.set('2026-08-30T02:00:00.000Z')
  await pair.b.syncNow().catch(() => {})
  pair.b.hooks.beforeApply = null

  const remote = pair.server.snapshot()
  const tree = remote.trees[remote.commits[remote.refs['heads/main']].tree]
  const fallback = JSON.parse(remote.blobs[tree.find(entry => entry.path === `docs/${pair.fallbackId}.json`).sha])
  assert.equal(fallback.title, 'F（A 剛改過）', 'A 對退路副本的修改不能被重跑的同步蓋掉')
})

test('Sol 2-#3：識別碼相符、base 可信，索引仍列著某份文件但內容遺失 → 不能當成永久刪除推上雲端；從雲端拉回修復並保留收藏', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'kept', title: '還在', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.putDoc({ id: 'lost', title: '內容遺失', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  pair.a.storage.setFavorite('lost', true)
  await pair.a.syncNow()
  await pair.b.syncNow()
  // 索引與識別碼都還在，只有 lost 的文件本體不見
  pair.a.storage.entries.delete('mindflow.doc.lost')
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  await pair.a.syncNow()
  await pair.b.syncNow()

  const manifest = remoteManifest(pair.server)
  assert.deepEqual(manifest.tombstones, {}, '沒有明確的刪除證據，不能記成刪除')
  assert.ok(manifest.docs.lost)
  assert.deepEqual(manifest.favorites, ['lost'], '收藏狀態保留')
  for (const instance of [pair.a, pair.b]) {
    assert.equal(instance.storage.doc('lost')?.title, '內容遺失', `${instance.name} 上 lost 還在`)
    assert.deepEqual(instance.storage.index().favorites, ['lost'])
  }
})

test('Sol 2-#3：完整的永久刪除（索引也已移除）照常傳出去', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'gone', title: '要刪的', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  pair.clockA.set('2026-08-30T02:00:00.000Z')
  pair.a.storage.purgeDoc('gone')
  await pair.a.syncNow()
  assert.equal(typeof remoteManifest(pair.server).tombstones.gone, 'string')
})

test('Sol 2-LOW：開機救援還沒結束時，就算計時器已經裝好，輪詢也不能讀本機或打 GitHub', async () => {
  const server = await startServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  let openGate
  const startGate = new Promise(resolve => { openGate = resolve })
  const instance = await createSyncInstance({
    name: 'machine-poll-gate',
    server,
    token: 'TEST-ONLY-NOT-A-REAL-TOKEN-poll',
    clock: createClock('2026-08-30T01:00:00.000Z'),
    engineOptions: { startGate }
  })
  // 救援期間使用者在設定裡啟用同步：start({ startup: false }) 會先裝好計時器
  instance.engine.start({ startup: false })
  const requests = server.requests.length
  const reads = instance.readCount()
  // 不 await：修正前的 pollRemote 會先打 GitHub、再卡在等閘門的 syncNow 上
  const polls = [instance.engine.pollRemote(), instance.engine.pollFingerprint()]
  await new Promise(resolve => setTimeout(resolve, 80))
  const requestsDuringRecovery = server.requests.length - requests
  const readsDuringRecovery = instance.readCount() - reads
  openGate()
  await Promise.all(polls)
  assert.equal(requestsDuringRecovery, 0, '救援還沒結束：輪詢不能打 GitHub')
  assert.equal(readsDuringRecovery, 0, '救援還沒結束：輪詢不能讀本機')
  await instance.engine.pollRemote()
  assert.ok(server.requests.length > requests, '救援結束後輪詢照常')
})

test('版本閘門：雲端 manifest 是較新格式 → 停止同步、不寫本機、不推送', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'mine', title: '本機文件', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  const head = (await getRef(pair.server).then((response) => response.json())).object.sha
  const newer = await createCommitOn(pair.server, {
    parentSha: head,
    files: { 'manifest.json': JSON.stringify({ schemaVersion: 2, docs: {}, favorites: [], tombstones: {}, lastWriter: 'future' }) }
  })
  await fetch(`${pair.server.apiBase}/repos/${pair.server.owner}/${pair.server.repo}/git/refs/heads/${pair.server.branch}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: newer.sha, force: false })
  })
  const before = JSON.stringify(pair.a.storage.snapshot())
  const requestStart = pair.server.requests.length

  await assert.rejects(pair.a.syncNow(), /較新版本的 MindFlow/)

  assert.equal(JSON.stringify(pair.a.storage.snapshot()), before, '本機資料不得被改動')
  const writes = pair.server.requests.slice(requestStart).filter((request) => ['POST', 'PATCH'].includes(request.method))
  assert.equal(writes.length, 0, '較新格式時不得對雲端寫入任何東西')
})

test('版本閘門：manifest 仍是 v1 但某份文件是較新格式 → 停止同步、不寫本機', async () => {
  const pair = await createPair()
  pair.a.storage.putDoc({ id: 'shared', title: '共同', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z' })
  await pair.a.syncNow()
  await pair.b.syncNow()
  const head = (await getRef(pair.server).then((response) => response.json())).object.sha
  const futureDoc = { schemaVersion: 2, version: 1, id: 'shared', title: '未來格式', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T05:00:00.000Z', root: { id: 'r', text: '未來格式', children: [] }, conflicts: [] }
  const manifest = {
    schemaVersion: 1,
    docs: { shared: { title: '未來格式', createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T05:00:00.000Z', state: 'active' } },
    favorites: [],
    tombstones: {},
    lastWriter: 'future-device'
  }
  const newer = await createCommitOn(pair.server, {
    parentSha: head,
    files: { 'manifest.json': JSON.stringify(manifest), 'docs/shared.json': JSON.stringify(futureDoc) }
  })
  await fetch(`${pair.server.apiBase}/repos/${pair.server.owner}/${pair.server.repo}/git/refs/heads/${pair.server.branch}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: newer.sha, force: false })
  })
  const before = JSON.stringify(pair.b.storage.snapshot())

  await assert.rejects(pair.b.syncNow(), /較新版本的 MindFlow/)
  assert.equal(JSON.stringify(pair.b.storage.snapshot()), before)
  assert.equal(pair.b.storage.doc('shared').title, '共同')
})
