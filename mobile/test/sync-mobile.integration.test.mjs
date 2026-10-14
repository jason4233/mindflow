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
  const desktop = createSyncEngineForTest({
    userDataPath,
    machineId: 'desktop-M1',
    now: () => new Date(clock.desktop),
    cfg: { apiBase: server.apiBase, token, repo: 'chenrui/mindflow-data', branch: 'main', enabled: true },
    readEntries: async () => desktopStorage.snapshot(),
    applyWrites: async writes => desktopStorage.applyWrites(writes)
  })
  const mobile = createMobileSyncApi({
    preferences: new MemoryPreferences(),
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
