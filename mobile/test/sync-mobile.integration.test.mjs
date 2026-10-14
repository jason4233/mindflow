import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createSyncEngineForTest } from '../../desktop/sync-engine.mjs'
import { startFakeGitHubServer } from '../../desktop/test/fake-github-server.mjs'
import { createMobileSyncApi } from '../../js/sync-mobile.mjs'

class MemoryPreferences {
  constructor() {
    this.values = new Map()
  }

  async get({ key }) {
    return { value: this.values.get(key) ?? null }
  }

  async set({ key, value }) {
    this.values.set(key, String(value))
  }

  async remove({ key }) {
    this.values.delete(key)
  }
}

class MemoryStorage {
  constructor() {
    this.values = new Map([
      ['mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] })]
    ])
  }

  get length() {
    return this.values.size
  }

  key(index) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key) {
    return this.values.get(String(key)) ?? null
  }

  setItem(key, value) {
    this.values.set(String(key), String(value))
  }

  removeItem(key) {
    this.values.delete(String(key))
  }

  clear() {
    this.values.clear()
  }

  snapshot() {
    return Object.fromEntries(this.values)
  }

  applyWrites(writes) {
    for (const key of writes.removeKeys || []) this.removeItem(key)
    for (const [key, value] of Object.entries(writes.setKeys || {})) this.setItem(key, value)
  }

  putDoc(document) {
    const index = JSON.parse(this.getItem('mindflow.docs.index'))
    index.docs.push({
      id: document.id,
      title: document.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      thumbnail: ''
    })
    this.setItem(`mindflow.doc.${document.id}`, JSON.stringify(document))
    this.setItem('mindflow.docs.index', JSON.stringify(index))
  }

  editDoc(id, { title, updatedAt }) {
    const document = JSON.parse(this.getItem(`mindflow.doc.${id}`))
    const index = JSON.parse(this.getItem('mindflow.docs.index'))
    document.title = title
    document.updatedAt = updatedAt
    const metadata = index.docs.find(item => item.id === id)
    metadata.title = title
    metadata.updatedAt = updatedAt
    this.setItem(`mindflow.doc.${id}`, JSON.stringify(document))
    this.setItem('mindflow.docs.index', JSON.stringify(index))
  }

  purgeDoc(id) {
    const index = JSON.parse(this.getItem('mindflow.docs.index'))
    index.docs = index.docs.filter(item => item.id !== id)
    index.trash = index.trash.filter(item => item.id !== id)
    index.favorites = index.favorites.filter(favoriteId => favoriteId !== id)
    this.removeItem(`mindflow.doc.${id}`)
    this.setItem('mindflow.docs.index', JSON.stringify(index))
  }

  // 模擬程式被殺、localStorage 回到磁碟上較舊的內容
  replaceAll(snapshot) {
    this.values = new Map(Object.entries(snapshot))
  }
}

function createTimers() {
  let nextId = 0
  const pending = new Map()
  return {
    setTimeout(callback) {
      const id = ++nextId
      pending.set(id, callback)
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    async runAll() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) await callback()
    },
    get size() {
      return pending.size
    }
  }
}

test('fake server: desktop push is pulled by the mobile WebView through the shared sync plan', async () => {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-c3-desktop-'))
  const token = 'github_pat_C3_FAKE_SERVER_SECRET'
  const desktopStorage = new MemoryStorage()
  const mobileStorage = new MemoryStorage()
  const preferences = new MemoryPreferences()
  const applied = []
  const now = () => new Date('2026-08-30T10:00:00.000Z')
  let mobileNow = '2026-08-30T10:00:00.000Z'
  const timers = createTimers()
  let desktop
  let mobile

  try {
    desktopStorage.putDoc({
      version: 1,
      id: 'c3-roadmap',
      title: 'C3 行動同步',
      createdAt: '2026-08-30T09:00:00.000Z',
      updatedAt: '2026-08-30T09:30:00.000Z',
      root: { id: 'root', text: 'C3 行動同步', children: [] }
    })
    desktop = createSyncEngineForTest({
      userDataPath,
      machineId: 'desktop-C3',
      now,
      cfg: {
        apiBase: server.apiBase,
        token,
        repo: 'chenrui/mindflow-data',
        branch: 'main',
        enabled: true
      },
      readEntries: async () => desktopStorage.snapshot(),
      applyWrites: async writes => desktopStorage.applyWrites(writes)
    })
    assert.deepEqual(await desktop.syncNow({ reason: 'test-desktop-push' }), { ok: true })

    mobile = createMobileSyncApi({
      preferences,
      storage: mobileStorage,
      fetchFn: fetch,
      apiBase: server.apiBase,
      machineId: 'android-C3',
      now: () => new Date(mobileNow),
      autoStart: true,
      setTimeoutFn: callback => timers.setTimeout(callback),
      clearTimeoutFn: id => timers.clearTimeout(id),
      dispatchSyncApplied(detail) {
        applied.push(detail)
      }
    })
    assert.deepEqual(await mobile.setConfig({
      enabled: true,
      repo: 'chenrui/mindflow-data',
      token
    }), { ok: true })

    const pulled = JSON.parse(mobileStorage.getItem('mindflow.doc.c3-roadmap'))
    const index = JSON.parse(mobileStorage.getItem('mindflow.docs.index'))
    assert.equal(pulled.title, 'C3 行動同步')
    assert.deepEqual(index.docs.map(document => document.id), ['c3-roadmap'])
    assert.deepEqual(applied, [{ changedDocIds: ['c3-roadmap'] }])
    assert.equal(JSON.stringify(mobileStorage.snapshot()).includes(token), false)
    assert.equal(JSON.stringify(server.snapshot()).includes(token), false)
    assert.equal(server.requests.some(request => request.path.includes('/contents/')), false)

    mobileNow = '2026-08-30T11:00:00.000Z'
    mobileStorage.editDoc('c3-roadmap', {
      title: 'C3 手機存檔版本',
      updatedAt: mobileNow
    })
    assert.equal(timers.size, 1, 'doc 與 index 連續存檔只應保留一個 debounce timer')
    await timers.runAll()
    assert.deepEqual(await desktop.syncNow({ reason: 'test-desktop-pull-mobile-save' }), { ok: true })
    assert.equal(JSON.parse(desktopStorage.getItem('mindflow.doc.c3-roadmap')).title, 'C3 手機存檔版本')
  } finally {
    await mobile?.dispose()
    await desktop?.dispose()
    await rm(userDataPath, { recursive: true, force: true })
    await server.close()
  }
})

async function createDesktopAndMobile({ fetchFn = fetch } = {}) {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-m1-desktop-'))
  const token = 'github_pat_M1_FAKE_SERVER_SECRET'
  const desktopStorage = new MemoryStorage()
  const mobileStorage = new MemoryStorage()
  const clock = { desktop: '2026-09-01T10:00:00.000Z', mobile: '2026-09-01T10:00:00.000Z' }
  const timers = createTimers()
  const mobilePreferences = new MemoryPreferences()
  const desktop = createSyncEngineForTest({
    userDataPath,
    machineId: 'desktop-M1',
    now: () => new Date(clock.desktop),
    cfg: { apiBase: server.apiBase, token, repo: 'chenrui/mindflow-data', branch: 'main', enabled: true },
    readEntries: async () => desktopStorage.snapshot(),
    applyWrites: async writes => desktopStorage.applyWrites(writes)
  })
  const mobile = createMobileSyncApi({
    preferences: mobilePreferences,
    storage: mobileStorage,
    fetchFn: (url, init) => fetchFn(url, init),
    apiBase: server.apiBase,
    machineId: 'android-M1',
    now: () => new Date(clock.mobile),
    autoStart: false,
    setTimeoutFn: callback => timers.setTimeout(callback),
    clearTimeoutFn: id => timers.clearTimeout(id),
    dispatchSyncApplied() {}
  })
  assert.deepEqual(await mobile.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token }), { ok: true })
  return {
    server,
    desktop,
    mobile,
    desktopStorage,
    mobileStorage,
    mobilePreferences,
    clock,
    async close() {
      await mobile.dispose()
      await desktop.dispose()
      await rm(userDataPath, { recursive: true, force: true })
      await server.close()
    }
  }
}

function seedDoc(storage, { id, title, at }) {
  storage.putDoc({ version: 1, id, title, createdAt: at, updatedAt: at, root: { id: `${id}-root`, text: title, children: [] } })
}

test('M1 競爭（手機）：同步下載遠端版本的那幾秒內手機又存檔 → 手機的修改不會被蓋掉', async () => {
  let injectAfterBlob = null
  let blobGets = 0
  const env = await createDesktopAndMobile({
    async fetchFn(url, init = {}) {
      const response = await fetch(url, init)
      if (injectAfterBlob && (init.method || 'GET') === 'GET' && String(url).includes('/git/blobs/')) {
        blobGets += 1
        // 第 1 個 blob 是 manifest、第 2 個是文件本體：文件下載完、還沒寫回本機時，使用者在手機上存檔
        if (blobGets === 2) {
          const inject = injectAfterBlob
          injectAfterBlob = null
          inject()
        }
      }
      return response
    }
  })
  try {
    seedDoc(env.desktopStorage, { id: 'shared', title: '共同版本', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.desktop.syncNow({ reason: 'seed' }), { ok: true })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })

    env.clock.desktop = '2026-09-01T11:00:00.000Z'
    env.desktopStorage.editDoc('shared', { title: '電腦的修改', updatedAt: env.clock.desktop })
    assert.deepEqual(await env.desktop.syncNow({ reason: 'desktop-edit' }), { ok: true })

    env.clock.mobile = '2026-09-01T11:05:00.000Z'
    blobGets = 0
    injectAfterBlob = () => env.mobileStorage.editDoc('shared', { title: '手機剛存的修改', updatedAt: '2026-09-01T11:05:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'race' }), { ok: true })
    assert.deepEqual(await env.desktop.syncNow({ reason: 'pull' }), { ok: true })

    for (const storage of [env.mobileStorage, env.desktopStorage]) {
      assert.equal(JSON.parse(storage.getItem('mindflow.doc.shared')).title, '手機剛存的修改')
      const titles = JSON.parse(storage.getItem('mindflow.docs.index')).docs.map(doc => doc.title)
      assert.equal(titles.filter(title => title.includes('衝突副本') && title.includes('電腦的修改')).length, 1, '電腦的版本保留成衝突副本')
    }
  } finally {
    await env.close()
  }
})

test('M1 版本閘門（手機）：雲端是較新格式 → 停止同步、顯示更新提示、本機不變', async () => {
  const env = await createDesktopAndMobile()
  try {
    seedDoc(env.mobileStorage, { id: 'mine', title: '手機文件', at: '2026-09-01T09:00:00.000Z' })
    const api = `${env.server.apiBase}/repos/chenrui/mindflow-data/git`
    const head = (await fetch(`${api}/ref/heads/main`).then(response => response.json())).object.sha
    const parent = await fetch(`${api}/commits/${head}`).then(response => response.json())
    const blob = await fetch(`${api}/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: JSON.stringify({ schemaVersion: 2, docs: {}, favorites: [], tombstones: {}, lastWriter: 'future' }), encoding: 'utf-8' })
    }).then(response => response.json())
    const tree = await fetch(`${api}/trees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_tree: parent.tree.sha, tree: [{ path: 'manifest.json', mode: '100644', type: 'blob', sha: blob.sha }] })
    }).then(response => response.json())
    const commit = await fetch(`${api}/commits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'future', tree: tree.sha, parents: [head] })
    }).then(response => response.json())
    await fetch(`${api}/refs/heads/main`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha, force: false })
    })
    const before = JSON.stringify(env.mobileStorage.snapshot())

    const result = await env.mobile.syncNow({ reason: 'gate' })
    assert.equal(result.ok, false)
    assert.match(result.error, /較新版本的 MindFlow/)
    const status = await env.mobile.getStatus()
    assert.equal(status.state, 'error')
    assert.match(status.lastError, /請先更新 MindFlow/)
    assert.equal(JSON.stringify(env.mobileStorage.snapshot()), before)
  } finally {
    await env.close()
  }
})

test('M1 前景輪詢（手機）：分支頭沒變只花一個 304 請求；電腦推送後下一次輪詢就拉回來', async () => {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-m1-poll-'))
  const token = 'github_pat_M1_POLL_SECRET'
  const desktopStorage = new MemoryStorage()
  const mobileStorage = new MemoryStorage()
  const pollers = []
  const documentRef = new EventTarget()
  documentRef.visibilityState = 'visible'
  const desktop = createSyncEngineForTest({
    userDataPath,
    machineId: 'desktop-poll',
    now: () => new Date('2026-09-02T10:00:00.000Z'),
    cfg: { apiBase: server.apiBase, token, repo: 'chenrui/mindflow-data', branch: 'main', enabled: true },
    readEntries: async () => desktopStorage.snapshot(),
    applyWrites: async writes => desktopStorage.applyWrites(writes)
  })
  const mobile = createMobileSyncApi({
    preferences: new MemoryPreferences(),
    storage: mobileStorage,
    fetchFn: fetch,
    apiBase: server.apiBase,
    machineId: 'android-poll',
    now: () => new Date('2026-09-02T10:00:00.000Z'),
    autoStart: true,
    documentRef,
    windowRef: new EventTarget(),
    observeLocalChanges: () => () => {},
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
    setIntervalFn: callback => { pollers.push(callback); return pollers.length },
    clearIntervalFn: () => {},
    dispatchSyncApplied() {}
  })
  try {
    seedDoc(desktopStorage, { id: 'first', title: '第一份', at: '2026-09-02T09:00:00.000Z' })
    assert.deepEqual(await desktop.syncNow({ reason: 'seed' }), { ok: true })
    assert.deepEqual(await mobile.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token }), { ok: true })
    assert.equal(JSON.parse(mobileStorage.getItem('mindflow.doc.first')).title, '第一份')
    assert.equal(pollers.length, 1)

    // 啟動同步之後第一次輪詢：上次存的 ETag 已是現在的分支頭 → 一個 304，不做完整同步
    const before = server.requests.length
    await pollers[0]()
    const pollRequests = server.requests.slice(before)
    assert.deepEqual(pollRequests.map(request => [request.method, request.status]), [['GET', 304]])

    seedDoc(desktopStorage, { id: 'second', title: '電腦新增', at: '2026-09-02T09:30:00.000Z' })
    assert.deepEqual(await desktop.syncNow({ reason: 'desktop-edit' }), { ok: true })
    await pollers[0]()
    assert.equal(JSON.parse(mobileStorage.getItem('mindflow.doc.second')).title, '電腦新增')
    const diagnostics = await mobile.getDiagnostics()
    assert.ok(diagnostics.some(entry => entry.reason === 'etag-pull' && entry.ok))
    assert.equal(JSON.stringify(diagnostics).includes(token), false)
  } finally {
    await mobile.dispose()
    await desktop.dispose()
    await rm(userDataPath, { recursive: true, force: true })
    await server.close()
  }
})

function remoteState(server) {
  const snapshot = server.snapshot()
  const commit = snapshot.commits[snapshot.refs['heads/main']]
  const tree = snapshot.trees[commit.tree]
  const read = path => {
    const entry = tree.find(item => item.path === path)
    return entry ? JSON.parse(snapshot.blobs[entry.sha]) : null
  }
  return { manifest: read('manifest.json'), doc: id => read(`docs/${id}.json`), paths: tree.map(item => item.path) }
}

test('審查 BLOCKER 1：自動還原較舊的備份後，留著的同步 base 不能讓雲端文件被刪或回退', async () => {
  const { createMobileBackupStore } = await import('../../js/mobile-backup.mjs')
  const env = await createDesktopAndMobile()
  const files = new Map()
  const filesystem = {
    async writeFile({ path, data }) { files.set(path, data) },
    async readFile({ path }) { if (!files.has(path)) throw Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' }); return { data: files.get(path) } },
    async stat({ path }) { if (!files.has(path)) throw Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' }); return {} },
    async copy({ from, to }) { files.set(to, files.get(from)) }
  }
  try {
    seedDoc(env.mobileStorage, { id: 'A', title: 'A v1', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    // 2 分鐘的備份拍到 A v1
    const backups = createMobileBackupStore({ filesystem, storage: env.mobileStorage, importCopy: () => ({}) })
    await backups.writeBackup()
    assert.equal(JSON.parse(files.get('backups/mindflow-backup.json')).entries['mindflow.sync.storeEpoch'], undefined, '識別碼不進備份')
    // 之後改了 A、新增 B，而且已經同步上雲端
    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    env.mobileStorage.editDoc('A', { title: 'A v2（較新）', updatedAt: env.clock.mobile })
    seedDoc(env.mobileStorage, { id: 'B', title: 'B 備份之後才建立', at: env.clock.mobile })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'edit' }), { ok: true })

    // WebView 資料不見（Preferences 裡的 base 還在）→ 自動從備份還原 → 同步
    env.mobileStorage.clear()
    assert.equal(await createMobileBackupStore({ filesystem, storage: env.mobileStorage, importCopy: () => ({}) }).restoreLatestIfEmpty(), true)
    env.clock.mobile = '2026-09-01T10:05:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-restore' }), { ok: true })

    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {}, '沒有任何文件被記成刪除')
    assert.ok(remote.paths.includes('docs/B.json'), 'B 還在雲端')
    assert.equal(remote.doc('A').title, 'A v2（較新）', 'A 沒有被回退成 v1')
    const local = JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.title)
    assert.ok(local.includes('A v2（較新）') && local.includes('B 備份之後才建立'), JSON.stringify(local))
  } finally {
    await env.close()
  }
})

test('審查 BLOCKER 2：資料遺失後、第一次同步前先新增了文件，也不能把雲端其他文件全刪掉', async () => {
  const env = await createDesktopAndMobile()
  try {
    seedDoc(env.mobileStorage, { id: 'A', title: 'A', at: '2026-09-01T09:00:00.000Z' })
    seedDoc(env.mobileStorage, { id: 'B', title: 'B', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    env.mobileStorage.clear()
    env.mobileStorage.setItem('mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] }))
    env.clock.mobile = '2026-09-01T11:00:00.000Z'
    seedDoc(env.mobileStorage, { id: 'C', title: '遺失後新建的', at: env.clock.mobile })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-loss' }), { ok: true })
    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {})
    assert.deepEqual(Object.keys(remote.manifest.docs).sort(), ['A', 'B', 'C'])
    const local = JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.id).sort()
    assert.deepEqual(local, ['A', 'B', 'C'])
  } finally {
    await env.close()
  }
})

test('M1_NOTES 6-#13（手機）：自動還原寫到一半失敗、撤回只成功一部分 → 沒還原到的文件不能被當成本機刪除推上雲端', async () => {
  const { createMobileBackupStore } = await import('../../js/mobile-backup.mjs')
  const env = await createDesktopAndMobile()
  const files = new Map()
  const missing = () => Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' })
  const filesystem = {
    async writeFile({ path, data }) { files.set(path, data) },
    async readFile({ path }) { if (!files.has(path)) throw missing(); return { data: files.get(path) } },
    async stat({ path }) { if (!files.has(path)) throw missing(); return {} },
    async copy({ from, to }) { files.set(to, files.get(from)) }
  }
  try {
    for (const id of ['A', 'B', 'C']) seedDoc(env.mobileStorage, { id, title: `${id} 雲端健康`, at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    await createMobileBackupStore({ filesystem, storage: env.mobileStorage, importCopy: () => ({}) }).writeBackup()

    // WebView 的文件與索引不見，本機儲存區識別碼還在（和 Preferences 裡的同步狀態相符）
    const epoch = env.mobileStorage.getItem('mindflow.sync.storeEpoch')
    assert.equal(typeof epoch, 'string')
    env.mobileStorage.clear()
    env.mobileStorage.setItem('mindflow.sync.storeEpoch', epoch)

    // 自動還原依序寫識別碼、A、B、C…：寫到 C 時空間不足；撤回時 A 刪不掉，其餘都撤回成功
    let writes = 0
    const storage = new Proxy(env.mobileStorage, {
      get(object, property) {
        if (property === 'setItem') {
          return (key, value) => {
            // 只數文件內容的寫入：識別碼可能先被開機還原檢查換掉一次（M1-A21）
            if (key !== 'mindflow.sync.storeEpoch') writes += 1
            if (key !== 'mindflow.sync.storeEpoch' && writes === 3) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
            object.setItem(key, value)
          }
        }
        if (property === 'removeItem') {
          return key => {
            if (key === 'mindflow.doc.A') throw new Error('storage unavailable')
            object.removeItem(key)
          }
        }
        const value = Reflect.get(object, property, object)
        return typeof value === 'function' ? value.bind(object) : value
      }
    })
    const error = await createMobileBackupStore({ filesystem, storage, importCopy: () => ({}) })
      .restoreLatestIfEmpty()
      .then(() => null, caught => caught)
    assert.equal(error?.rollbackIncomplete, true, '情境：撤回沒有完全成功')
    assert.ok(env.mobileStorage.getItem('mindflow.doc.A'), '情境：A 殘留在本機')
    assert.equal(env.mobileStorage.getItem('mindflow.doc.B'), null)
    assert.equal(env.mobileStorage.getItem('mindflow.docs.index'), null)

    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-failed-restore' }), { ok: true })

    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {}, '沒有任何文件被記成刪除')
    assert.deepEqual(Object.keys(remote.manifest.docs).sort(), ['A', 'B', 'C'], '雲端的 B、C 還在')
    for (const id of ['B', 'C']) {
      assert.equal(JSON.parse(env.mobileStorage.getItem(`mindflow.doc.${id}`) ?? 'null')?.title, `${id} 雲端健康`, `${id} 從雲端拉回本機`)
    }
  } finally {
    await env.close()
  }
})

test('M1_NOTES 6-#13 補完（手機）：自動還原失敗、完整回滾後，離線時先建了新文件 D → 恢復連線同步也不能把雲端的 A、B、C 記成刪除', async () => {
  const { createMobileBackupStore } = await import('../../js/mobile-backup.mjs')
  const env = await createDesktopAndMobile()
  const files = new Map()
  const missing = () => Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' })
  const filesystem = {
    async writeFile({ path, data }) { files.set(path, data) },
    async readFile({ path }) { if (!files.has(path)) throw missing(); return { data: files.get(path) } },
    async stat({ path }) { if (!files.has(path)) throw missing(); return {} },
    async copy({ from, to }) { files.set(to, files.get(from)) }
  }
  try {
    for (const id of ['A', 'B', 'C']) seedDoc(env.mobileStorage, { id, title: `${id} 雲端健康`, at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    await createMobileBackupStore({ filesystem, storage: env.mobileStorage, importCopy: () => ({}) }).writeBackup()

    // WebView 的文件與索引不見，本機儲存區識別碼還在（和 Preferences 裡的同步狀態相符）
    const epoch = env.mobileStorage.getItem('mindflow.sync.storeEpoch')
    assert.equal(typeof epoch, 'string')
    env.mobileStorage.clear()
    env.mobileStorage.setItem('mindflow.sync.storeEpoch', epoch)

    // 離線開機，自動還原寫到 C 時空間不足；回滾全部成功
    let writes = 0
    const storage = new Proxy(env.mobileStorage, {
      get(object, property) {
        if (property === 'setItem') {
          return (key, value) => {
            // 只數文件內容的寫入：識別碼可能先被開機還原檢查換掉一次（M1-A21）
            if (key !== 'mindflow.sync.storeEpoch') writes += 1
            if (key !== 'mindflow.sync.storeEpoch' && writes === 3) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
            object.setItem(key, value)
          }
        }
        const value = Reflect.get(object, property, object)
        return typeof value === 'function' ? value.bind(object) : value
      }
    })
    const error = await createMobileBackupStore({ filesystem, storage, importCopy: () => ({}) })
      .restoreLatestIfEmpty()
      .then(() => null, caught => caught)
    assert.ok(error, '情境：自動還原失敗')
    assert.notEqual(error.rollbackIncomplete, true, '情境：回滾全部成功')
    assert.equal(env.mobileStorage.getItem('mindflow.docs.index'), null, '情境：沒有留下半套內容')

    // 使用者先建了一份新文件 D（App 建立新的索引）
    env.mobileStorage.setItem('mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] }))
    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    seedDoc(env.mobileStorage, { id: 'D', title: 'D 離線新建', at: env.clock.mobile })

    // 恢復連線後同步
    env.clock.mobile = '2026-09-01T10:05:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'back-online' }), { ok: true })

    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {}, '沒有任何文件被記成刪除')
    assert.deepEqual(Object.keys(remote.manifest.docs).sort(), ['A', 'B', 'C', 'D'], '雲端的 A、B、C 還在，D 推上去')
    const local = JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.id).sort()
    assert.deepEqual(local, ['A', 'B', 'C', 'D'], 'A、B、C 從雲端拉回本機')
  } finally {
    await env.close()
  }
})

function memoryFilesystem() {
  const files = new Map()
  const missing = () => Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' })
  return {
    files,
    async writeFile({ path, data }) { files.set(path, data) },
    async readFile({ path }) { if (!files.has(path)) throw missing(); return { data: files.get(path) } },
    async stat({ path }) { if (!files.has(path)) throw missing(); return {} },
    async copy({ from, to }) { files.set(to, files.get(from)) }
  }
}

test('M1_NOTES 6-#13 根治（手機）：文件與索引不見、識別碼還在、沒有任何備份可還原 → 先建了新文件 D 再同步，也不能把雲端的 A、B、C 記成刪除', async () => {
  const { createMobileBackupStore } = await import('../../js/mobile-backup.mjs')
  const env = await createDesktopAndMobile()
  try {
    for (const id of ['A', 'B', 'C']) seedDoc(env.mobileStorage, { id, title: `${id} 雲端健康`, at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })

    // WebView 的文件與索引不見，本機儲存區識別碼還在（和 Preferences 裡的同步狀態相符）；App 裡沒有任何備份
    const epoch = env.mobileStorage.getItem('mindflow.sync.storeEpoch')
    assert.equal(typeof epoch, 'string')
    env.mobileStorage.clear()
    env.mobileStorage.setItem('mindflow.sync.storeEpoch', epoch)

    // 開機時的還原檢查：沒有備份可還原
    assert.equal(await createMobileBackupStore({ filesystem: memoryFilesystem(), storage: env.mobileStorage, importCopy: () => ({}) }).restoreLatestIfEmpty(), false)

    // 使用者先建了一份新文件 D，之後才同步
    env.mobileStorage.setItem('mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] }))
    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    seedDoc(env.mobileStorage, { id: 'D', title: 'D 遺失後新建', at: env.clock.mobile })
    env.clock.mobile = '2026-09-01T10:05:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-loss' }), { ok: true })

    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {}, '沒有任何文件被記成刪除')
    assert.deepEqual(Object.keys(remote.manifest.docs).sort(), ['A', 'B', 'C', 'D'], '雲端的 A、B、C 還在，D 推上去')
    const local = JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.id).sort()
    assert.deepEqual(local, ['A', 'B', 'C', 'D'], 'A、B、C 從雲端拉回本機')
  } finally {
    await env.close()
  }
})

test('M1_NOTES 6-#13 根治（手機）：索引不見、只剩部分文件（A）、識別碼還在 → 同步不能把沒留下來的 B、C 記成刪除', async () => {
  const { createMobileBackupStore } = await import('../../js/mobile-backup.mjs')
  const env = await createDesktopAndMobile()
  try {
    for (const id of ['A', 'B', 'C']) seedDoc(env.mobileStorage, { id, title: `${id} 雲端健康`, at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })

    // 部分遺失：索引和 B、C 不見，A 的內容與識別碼還在
    const kept = Object.fromEntries(['mindflow.sync.storeEpoch', 'mindflow.doc.A'].map(key => [key, env.mobileStorage.getItem(key)]))
    env.mobileStorage.clear()
    for (const [key, value] of Object.entries(kept)) env.mobileStorage.setItem(key, value)

    // 開機時的還原檢查：本機還有文件，不自動還原
    assert.equal(await createMobileBackupStore({ filesystem: memoryFilesystem(), storage: env.mobileStorage, importCopy: () => ({}) }).restoreLatestIfEmpty(), false)

    env.clock.mobile = '2026-09-01T10:05:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-partial-loss' }), { ok: true })

    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {}, '沒有任何文件被記成刪除')
    assert.deepEqual(Object.keys(remote.manifest.docs).sort(), ['A', 'B', 'C'], '雲端的 B、C 還在')
    const local = JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.id).sort()
    assert.deepEqual(local, ['A', 'B', 'C'], 'B、C 從雲端拉回本機')
  } finally {
    await env.close()
  }
})

test('複審 HIGH（手機）：同步把遠端內容寫進本機後、localStorage 落盤前 App 被殺 → 重開後不刪雲端文件、不回退遠端修改', async () => {
  const env = await createDesktopAndMobile()
  try {
    seedDoc(env.desktopStorage, { id: 'kept', title: 'kept v1', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.desktop.syncNow({ reason: 'seed' }), { ok: true })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    // WebView 約 5 秒後才把 localStorage 寫到磁碟：先記下手機「磁碟上」的內容（含當時的識別碼）
    const diskBeforeSync = env.mobileStorage.snapshot()

    env.clock.desktop = '2026-09-01T10:00:00.000Z'
    env.desktopStorage.editDoc('kept', { title: 'kept v2（電腦的修改）', updatedAt: env.clock.desktop })
    seedDoc(env.desktopStorage, { id: 'fresh', title: '電腦新建', at: env.clock.desktop })
    assert.deepEqual(await env.desktop.syncNow({ reason: 'desktop-edit' }), { ok: true })

    env.clock.mobile = '2026-09-01T10:05:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'pull' }), { ok: true })
    assert.equal(JSON.parse(env.mobileStorage.getItem('mindflow.doc.fresh')).title, '電腦新建')
    // Preferences 裡的同步狀態已立刻寫入，localStorage 卻還沒落盤就被滑掉：重開後是舊內容與舊識別碼
    env.mobileStorage.replaceAll(diskBeforeSync)

    env.clock.mobile = '2026-09-01T10:10:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-kill' }), { ok: true })
    assert.deepEqual(await env.desktop.syncNow({ reason: 'pull' }), { ok: true })

    const remote = remoteState(env.server)
    assert.deepEqual(remote.manifest.tombstones, {}, '沒有任何文件被記成刪除')
    assert.equal(remote.doc('fresh')?.title, '電腦新建', 'fresh 還在雲端')
    assert.equal(remote.doc('kept').title, 'kept v2（電腦的修改）', 'kept 沒有被回退成 v1')
    for (const storage of [env.mobileStorage, env.desktopStorage]) {
      assert.equal(JSON.parse(storage.getItem('mindflow.doc.fresh')).title, '電腦新建')
      assert.equal(JSON.parse(storage.getItem('mindflow.doc.kept')).title, 'kept v2（電腦的修改）')
    }
  } finally {
    await env.close()
  }
})

test('複審 HIGH 缺口（手機）：只推送、本機沒有其他寫入的一輪也要把新識別碼寫進本機，下一輪 base 才可信', async () => {
  const env = await createDesktopAndMobile()
  try {
    const assertMarkerMatchesState = async label => {
      const marker = env.mobileStorage.getItem('mindflow.sync.storeEpoch')
      const saved = JSON.parse((await env.mobilePreferences.get({ key: 'mindflow.sync.mobile.state' })).value)
      assert.equal(typeof marker, 'string', label)
      assert.equal(marker, saved.storeEpoch, `${label}：本機標記必須與同步狀態的識別碼一致`)
    }
    const conflictTitles = () => JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.title).filter(title => title.includes('衝突副本'))

    // 第一次同步只推送（雲端是空的）、第二次也只推送本機的修改：兩輪本機都沒有文件要寫入
    seedDoc(env.mobileStorage, { id: 'solo', title: 'solo v1', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    await assertMarkerMatchesState('第一次同步後')
    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    env.mobileStorage.editDoc('solo', { title: 'solo v2', updatedAt: env.clock.mobile })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'local-change' }), { ok: true })
    await assertMarkerMatchesState('第二次同步後')
    assert.deepEqual(conflictTitles(), [], '自己的修改不能被當成首次同步的衝突')
    // base 可信時永久刪除才會傳到雲端；若被當成首次同步（只做聯集），文件會從雲端被拉回來
    env.clock.mobile = '2026-09-01T11:00:00.000Z'
    env.mobileStorage.purgeDoc('solo')
    assert.deepEqual(await env.mobile.syncNow({ reason: 'local-change' }), { ok: true })
    assert.equal(typeof remoteState(env.server).manifest.tombstones.solo, 'string', '刪除必須傳到雲端')
    assert.equal(env.mobileStorage.getItem('mindflow.doc.solo'), null, '文件不能被當成首次同步拉回來')
  } finally {
    await env.close()
  }
})

test('Sol #1（手機）：推送成功但沒套用、立刻重試且兩邊內容已相同 → base 前進時也要換識別碼，之後被殺不會把較新版本蓋回', async () => {
  const env = await createDesktopAndMobile()
  try {
    seedDoc(env.mobileStorage, { id: 'plan', title: 'plan t1', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    // 磁碟上是 t1（含當時的識別碼）；記憶體裡又改成 t2，還沒落盤
    const disk = env.mobileStorage.snapshot()
    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    env.mobileStorage.editDoc('plan', { title: 'plan t2', updatedAt: env.clock.mobile })

    // 推送成功，但本機套用失敗（等同 updateRef 回應遺失）：同步狀態與 localStorage 都沒前進
    const originalSetItem = env.mobileStorage.setItem
    let failed = false
    env.mobileStorage.setItem = function (key, value) {
      if (!failed && key === 'mindflow.sync.storeEpoch') {
        failed = true
        throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
      }
      return originalSetItem.call(this, key, value)
    }
    assert.equal((await env.mobile.syncNow({ reason: 'local-change' })).ok, false)
    delete env.mobileStorage.setItem
    // 使用者立刻重試：兩邊內容相同、沒有東西要推或要寫，但 base 會前進到 t2
    env.clock.mobile = '2026-09-01T10:01:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'manual' }), { ok: true })
    // App 在 localStorage 落盤前被滑掉：磁碟回到 t1
    env.mobileStorage.replaceAll(disk)
    env.clock.mobile = '2026-09-01T10:10:00.000Z'
    assert.deepEqual(await env.mobile.syncNow({ reason: 'after-kill' }), { ok: true })

    assert.equal(remoteState(env.server).doc('plan').title, 'plan t2', '雲端的 t2 不能被舊的 t1 蓋回')
    const titles = JSON.parse(env.mobileStorage.getItem('mindflow.docs.index')).docs.map(item => item.title)
    assert.ok(titles.includes('plan t2'), JSON.stringify(titles))
  } finally {
    await env.close()
  }
})

test('複審 LOW：設定變更觸發的同步撞上進行中的一輪 → 不會結束後再多跑一次', async () => {
  let gate = null
  const env = await createDesktopAndMobile({
    async fetchFn(url, init = {}) {
      if (gate && String(url).includes('/git/ref/')) {
        const wait = gate
        gate = null
        await wait
      }
      return fetch(url, init)
    }
  })
  try {
    seedDoc(env.mobileStorage, { id: 'A', title: 'A', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    let release
    gate = new Promise(resolve => { release = resolve })
    const running = env.mobile.syncNow({ reason: 'poll' })
    await new Promise(resolve => setTimeout(resolve, 20))
    const joined = env.mobile.syncNow({ reason: 'config' })
    release()
    await running
    await joined
    await new Promise(resolve => setTimeout(resolve, 100))
    const runs = (await env.mobile.getDiagnostics()).filter(entry => entry.reason !== 'seed')
    assert.deepEqual(runs.map(entry => entry.reason), ['poll'], JSON.stringify(runs))
  } finally {
    await env.close()
  }
})

test('審查 MEDIUM 4：同步進行中又有「本機修改要推送」的請求 → 這一輪結束後再跑一次，修改確實推上去', async () => {
  let gate = null
  const env = await createDesktopAndMobile({
    async fetchFn(url, init = {}) {
      if (gate && String(url).includes('/git/ref/')) {
        const wait = gate
        gate = null
        await wait
      }
      return fetch(url, init)
    }
  })
  try {
    seedDoc(env.mobileStorage, { id: 'A', title: 'A v1', at: '2026-09-01T09:00:00.000Z' })
    assert.deepEqual(await env.mobile.syncNow({ reason: 'seed' }), { ok: true })
    let release
    gate = new Promise(resolve => { release = resolve })
    const running = env.mobile.syncNow({ reason: 'poll' })
    await new Promise(resolve => setTimeout(resolve, 20))
    // 這一輪還卡在讀分支頭（快照會是修改之前的狀態）時，使用者在背景存了檔
    env.clock.mobile = '2026-09-01T10:00:00.000Z'
    env.mobileStorage.editDoc('A', { title: 'A v2 背景存檔', updatedAt: env.clock.mobile })
    const joined = env.mobile.syncNow({ reason: 'hidden-change' })
    release()
    await running
    await joined
    await new Promise(resolve => setTimeout(resolve, 50))
    for (let i = 0; i < 20 && remoteState(env.server).doc('A')?.title !== 'A v2 背景存檔'; i += 1) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(remoteState(env.server).doc('A').title, 'A v2 背景存檔')
  } finally {
    await env.close()
  }
})

test('審查 LOW 8：同步已在運作時重新配對（換 PAT／repo）會立刻同步，不是等下一次輪詢', async () => {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const storage = new MemoryStorage()
  const api = createMobileSyncApi({
    preferences: new MemoryPreferences(),
    storage,
    fetchFn: fetch,
    apiBase: server.apiBase,
    machineId: 'android-pair',
    autoStart: true,
    documentRef: null,
    windowRef: null,
    observeLocalChanges: () => () => {},
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
    dispatchSyncApplied() {}
  })
  try {
    assert.deepEqual(await api.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token: 'github_pat_FIRST_PAIRING_TOKEN' }), { ok: true })
    const before = server.requests.length
    assert.deepEqual(await api.setConfig({ token: 'github_pat_SECOND_PAIRING_TOKEN' }), { ok: true })
    assert.ok(server.requests.slice(before).some(request => request.path.includes('/git/ref/')), '重新配對後立刻同步')
  } finally {
    await api.dispose()
    await server.close()
  }
})
