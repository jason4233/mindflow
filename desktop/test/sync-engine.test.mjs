import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import vm from 'node:vm'

import {
  CHANGE_DEBOUNCE_MS,
  CLOSE_FLUSH_TIMEOUT_MS,
  FINGERPRINT_INTERVAL_MS,
  FOCUS_THROTTLE_MS,
  PULL_INTERVAL_MS,
  createRendererStorageAdapter,
  createStorageQueue,
  createSyncEngineForTest,
  registerSyncIpc
} from '../sync-engine.mjs'
import { startFakeGitHubServer } from './fake-github-server.mjs'

const cleanupTasks = []

afterEach(async () => {
  await Promise.allSettled(cleanupTasks.splice(0).map(task => task()))
})

function emptyIndex() {
  return JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] })
}

function documentEntries(id = 'alpha') {
  const createdAt = '2026-08-30T01:00:00.000Z'
  const document = {
    version: 1,
    id,
    title: 'Alpha',
    createdAt,
    updatedAt: createdAt,
    root: { id: `${id}-root`, text: 'Alpha', children: [] }
  }
  return {
    'mindflow.docs.index': JSON.stringify({
      version: 2,
      docs: [{ id, title: 'Alpha', createdAt, updatedAt: createdAt, thumbnail: '' }],
      trash: [],
      favorites: []
    }),
    [`mindflow.doc.${id}`]: JSON.stringify(document)
  }
}

async function engineFixture({ entries = documentEntries(), applyWrites } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mindflow-sync-engine-'))
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow', branch: 'main' })
  cleanupTasks.push(() => rm(directory, { recursive: true, force: true }))
  cleanupTasks.push(() => server.close())
  const renderer = new Map(Object.entries(entries))
  const statuses = []
  const engine = createSyncEngineForTest({
    cfg: {
      apiBase: server.apiBase,
      token: 'github_pat_UNIT_SECRET',
      repo: 'chenrui/mindflow',
      branch: 'main'
    },
    userDataPath: directory,
    machineId: 'unit-machine',
    now: () => new Date('2026-08-30T05:00:00.000Z'),
    readEntries: async () => Object.fromEntries(renderer),
    applyWrites: applyWrites || (async writes => {
      for (const key of writes.removeKeys) renderer.delete(key)
      for (const [key, value] of Object.entries(writes.setKeys)) renderer.set(key, value)
    }),
    onStatus: status => statuses.push(status)
  })
  cleanupTasks.push(() => engine.dispose())
  return { directory, server, renderer, statuses, engine }
}

test('storageQueue serializes backup capture, sync capture, and sync apply after a rejected task', async () => {
  const queue = createStorageQueue()
  const order = []
  let release
  let markStarted
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { markStarted = resolve })

  const first = queue.run(async () => {
    order.push('backup:start')
    markStarted()
    await gate
    order.push('backup:end')
    throw new Error('backup failed')
  })
  const second = queue.run(async () => { order.push('sync:capture') })
  const third = queue.run(async () => { order.push('sync:apply') })

  await started
  assert.deepEqual(order, ['backup:start'])
  release()
  await assert.rejects(first, /backup failed/)
  await Promise.all([second, third])
  assert.deepEqual(order, ['backup:start', 'backup:end', 'sync:capture', 'sync:apply'])
})

test('successful sync persists only the frozen sync-state schema and never persists the token', async () => {
  const fixture = await engineFixture()
  assert.deepEqual(await fixture.engine.syncNow(), { ok: true })

  const stateText = await readFile(join(fixture.directory, 'sync-state.json'), 'utf8')
  const state = JSON.parse(stateText)
  assert.deepEqual(Object.keys(state).sort(), [
    'baseManifest', 'etag', 'lastSyncAt', 'lastSyncedCommitSha', 'machineId', 'perDoc'
  ])
  assert.equal(state.lastSyncAt, '2026-08-30T05:00:00.000Z')
  assert.equal(state.machineId, 'unit-machine')
  assert.equal(state.baseManifest.docs.alpha.title, 'Alpha')
  assert.equal(stateText.includes('github_pat_UNIT_SECRET'), false)
  assert.equal(fixture.engine.getStatus().state, 'idle')
  assert.equal(fixture.engine.getStatus().docCount, 1)
})

test('a public repository remains non-blocking but returns and persists a visible warning', async t => {
  const fixture = await engineFixture()
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (url, init) => {
    const response = await originalFetch(url, init)
    if ((init?.method || 'GET') === 'GET' && /\/repos\/chenrui\/mindflow$/u.test(String(url))) {
      const body = await response.json()
      return Response.json({ ...body, private: false }, { status: response.status, headers: response.headers })
    }
    return response
  }

  const result = await fixture.engine.syncNow()
  assert.equal(result.ok, true)
  assert.match(result.warning, /public|公開/u)
  assert.equal(fixture.engine.getStatus().state, 'idle')
  assert.match(fixture.engine.getStatus().warning, /public|公開/u)
})

test('quarantined local blobs complete the sync but are reported in status', async () => {
  const entries = documentEntries()
  entries['mindflow.doc.damaged'] = '{broken'
  const fixture = await engineFixture({ entries })

  const result = await fixture.engine.syncNow()
  assert.equal(result.ok, true)
  assert.match(result.warning, /damaged|隔離|損壞/u)
  assert.match(fixture.engine.getStatus().warning, /damaged|隔離|損壞/u)
})

test('authoritative renderer failure leaves sync-state base unadvanced', async () => {
  const entries = documentEntries()
  entries['mindflow.docs.index'] = '{broken'
  const fixture = await engineFixture({
    entries,
    applyWrites: async () => { throw new Error('renderer quota failure') }
  })
  const result = await fixture.engine.syncNow()

  assert.equal(result.ok, false)
  assert.match(result.error, /renderer quota failure/)
  await assert.rejects(readFile(join(fixture.directory, 'sync-state.json'), 'utf8'), { code: 'ENOENT' })
  assert.equal(fixture.engine.getStatus().state, 'error')
})

test('network failure transitions to offline without leaking the token in status', async () => {
  const fixture = await engineFixture({ entries: { 'mindflow.docs.index': emptyIndex() } })
  fixture.server.setOffline(true)

  const result = await fixture.engine.syncNow()
  assert.equal(result.ok, false)
  assert.equal(fixture.engine.getStatus().state, 'offline')
  assert.equal(JSON.stringify(fixture.engine.getStatus()).includes('github_pat_UNIT_SECRET'), false)
})

test('renderer adapter applies one authoritative transaction and rolls back when index write fails', async () => {
  const values = new Map([
    ['mindflow.doc.old', '{"id":"old"}'],
    ['mindflow.docs.index', '{"old":true}']
  ])
  let failIndex = false
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (failIndex && key === 'mindflow.docs.index') throw new Error('quota')
      values.set(key, String(value))
    },
    removeItem: key => values.delete(key)
  }
  const scripts = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      async executeJavaScript(script) {
        scripts.push(script)
        return vm.runInNewContext(script, {
          localStorage,
          window: { dispatchEvent() {} },
          CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } }
        })
      }
    }
  }
  const adapter = createRendererStorageAdapter(window)
  const writes = {
    removeKeys: ['mindflow.doc.old'],
    setKeys: {
      'mindflow.doc.new': '{"id":"new"}',
      'mindflow.docs.index': '{"new":true}'
    }
  }

  await adapter.applyWrites(writes)
  assert.equal(scripts.length, 1)
  assert.equal(values.has('mindflow.doc.old'), false)
  assert.equal(values.get('mindflow.doc.new'), '{"id":"new"}')
  assert.equal(values.get('mindflow.docs.index'), '{"new":true}')

  values.clear()
  values.set('mindflow.doc.old', '{"id":"old"}')
  values.set('mindflow.docs.index', '{"old":true}')
  failIndex = true
  await assert.rejects(adapter.applyWrites(writes), /quota/)
  assert.equal(scripts.length, 2)
  assert.deepEqual(Object.fromEntries(values), {
    'mindflow.doc.old': '{"id":"old"}',
    'mindflow.docs.index': '{"old":true}'
  })
})

test('registerSyncIpc owns the frozen five channels and status push', async () => {
  const expectedHandlerChannels = [
    'mindflow-sync:get-config',
    'mindflow-sync:get-status',
    'mindflow-sync:set-config',
    'mindflow-sync:sync-now'
  ]
  const handlers = new Map()
  const removed = []
  const sent = []
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler) },
    removeHandler(channel) { removed.push(channel); handlers.delete(channel) }
  }
  let statusListener
  const engine = {
    getStatus: () => ({ state: 'idle', lastSyncAt: null, lastError: null, docCount: 2 }),
    syncNow: async () => ({ ok: true }),
    updateConfig() {},
    onStatus(listener) { statusListener = listener; return () => { statusListener = null } }
  }
  const settings = {
    enabled: true,
    repo: 'owner/repo',
    branch: 'main',
    tokenCipher: 'cipher',
    warning: '同步設定檔損壞，原檔已隔離保留。'
  }
  const registration = registerSyncIpc({
    ipcMain,
    engine,
    webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) },
    userDataPath: 'X:\\user-data',
    loadSettings: () => settings,
    saveSettings: (_path, patch) => Object.assign(settings, patch),
    getToken: () => 'secret'
  })

  assert.deepEqual([...handlers.keys()].sort(), expectedHandlerChannels)
  assert.deepEqual(await handlers.get('mindflow-sync:get-config')(), {
    enabled: true,
    repo: 'owner/repo',
    hasToken: true,
    warning: '同步設定檔損壞，原檔已隔離保留。'
  })
  assert.deepEqual(await handlers.get('mindflow-sync:sync-now')(), { ok: true })
  statusListener({ state: 'syncing', lastSyncAt: null, lastError: null, docCount: 2 })
  assert.deepEqual(sent, [[
    'mindflow-sync:status-changed',
    { state: 'syncing', lastSyncAt: null, lastError: null, docCount: 2 }
  ]])
  removed.length = 0
  registration.dispose()
  assert.deepEqual(removed.sort(), expectedHandlerChannels)
})

test('trigger timing constants match the frozen SYNC-E contract', () => {
  assert.equal(FINGERPRINT_INTERVAL_MS, 15_000)
  assert.equal(CHANGE_DEBOUNCE_MS, 45_000)
  assert.equal(PULL_INTERVAL_MS, 5 * 60_000)
  assert.equal(FOCUS_THROTTLE_MS, 10_000)
  assert.equal(CLOSE_FLUSH_TIMEOUT_MS, 10_000)
})
