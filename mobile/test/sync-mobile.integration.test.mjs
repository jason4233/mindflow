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
