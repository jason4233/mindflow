import assert from 'node:assert/strict'
import test from 'node:test'

import { detectSyncEnvironment } from '../../js/settings.js'
import {
  MOBILE_SYNC_CONFIG_KEY,
  MOBILE_SYNC_TOKEN_KEY,
  MOBILE_SYNC_RETRY_INITIAL_MS,
  MOBILE_SYNC_RETRY_MAX_MS,
  createMobileSyncApi,
  createMobileSyncLifecycle,
  getCapacitorPreferences
} from '../../js/sync-mobile.mjs'

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
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries))
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
}

class FakeDocument extends EventTarget {
  visibilityState = 'visible'
}

function createTimers() {
  let nextId = 0
  const pending = new Map()
  const delays = new Map()
  return {
    setTimeout(callback, delay) {
      const id = ++nextId
      pending.set(id, callback)
      delays.set(id, delay)
      return id
    },
    delays() {
      return [...pending.keys()].map(id => delays.get(id))
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

test('settings environment routing prefers Electron, enables native Capacitor, and disables plain web', () => {
  const electronApi = { getConfig() {} }
  assert.equal(detectSyncEnvironment({
    mindflowSync: electronApi,
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }
  }), 'electron')
  assert.equal(detectSyncEnvironment({
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }
  }), 'capacitor')
  assert.equal(detectSyncEnvironment({
    Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }
  }), 'web')
  assert.equal(detectSyncEnvironment({}), 'web')
})

test('native Capacitor registers Preferences without requiring a bundled bare-module import', () => {
  const preferences = new MemoryPreferences()
  const registrations = []
  const windowRef = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      registerPlugin(name) {
        registrations.push(name)
        return preferences
      }
    }
  }

  assert.equal(getCapacitorPreferences(windowRef), preferences)
  assert.deepEqual(registrations, ['Preferences'])
})

test('mobile config keeps the PAT only in Capacitor Preferences and exposes hasToken instead', async () => {
  const preferences = new MemoryPreferences()
  const storage = new MemoryStorage()
  const api = createMobileSyncApi({
    preferences,
    storage,
    autoStart: false,
    fetchFn: async () => { throw new Error('disabled sync must not fetch') }
  })
  const token = 'github_pat_mobile_secret'

  assert.deepEqual(await api.setConfig({
    enabled: false,
    repo: 'chenrui/mindflow-data',
    token
  }), { ok: true })
  assert.deepEqual(await api.getConfig(), {
    enabled: false,
    repo: 'chenrui/mindflow-data',
    hasToken: true
  })

  assert.equal(preferences.values.get(MOBILE_SYNC_TOKEN_KEY), token)
  assert.equal(preferences.values.get(MOBILE_SYNC_CONFIG_KEY)?.includes(token), false)
  assert.equal(JSON.stringify(storage.snapshot()).includes(token), false)
  assert.equal(JSON.stringify(await api.getConfig()).includes(token), false)
  await api.dispose()
})

test('mobile lifecycle pulls on startup and visibility, while local saves collapse into one debounced push', async () => {
  const documentRef = new FakeDocument()
  const timers = createTimers()
  const reasons = []
  let notifyLocalSave
  const lifecycle = createMobileSyncLifecycle({
    syncNow: async ({ reason }) => { reasons.push(reason) },
    documentRef,
    debounceMs: 45_000,
    setTimeoutFn: callback => timers.setTimeout(callback),
    clearTimeoutFn: id => timers.clearTimeout(id),
    observeLocalChanges(callback) {
      notifyLocalSave = callback
      return () => { notifyLocalSave = null }
    }
  })

  await lifecycle.start()
  assert.deepEqual(reasons, ['startup'])

  notifyLocalSave()
  notifyLocalSave()
  assert.equal(timers.size, 1)
  await timers.runAll()
  assert.deepEqual(reasons, ['startup', 'local-change'])

  documentRef.visibilityState = 'hidden'
  documentRef.dispatchEvent(new Event('visibilitychange'))
  await Promise.resolve()
  assert.deepEqual(reasons, ['startup', 'local-change'])

  documentRef.visibilityState = 'visible'
  documentRef.dispatchEvent(new Event('visibilitychange'))
  await Promise.resolve()
  assert.deepEqual(reasons, ['startup', 'local-change', 'visibility'])

  lifecycle.stop()
  assert.equal(notifyLocalSave, null)
})

function createIntervals() {
  let nextId = 0
  const active = new Map()
  return {
    setInterval(callback, delay) {
      const id = ++nextId
      active.set(id, { callback, delay })
      return id
    },
    clearInterval(id) {
      active.delete(id)
    },
    async tick() {
      for (const { callback } of [...active.values()]) await callback()
    },
    get size() {
      return active.size
    },
    get delays() {
      return [...active.values()].map(item => item.delay)
    }
  }
}

function createLifecycleHarness({ pollRemote } = {}) {
  const documentRef = new FakeDocument()
  const windowRef = new EventTarget()
  const timers = createTimers()
  const intervals = createIntervals()
  const reasons = []
  let notifyLocalSave
  const lifecycle = createMobileSyncLifecycle({
    syncNow: async ({ reason }) => { reasons.push(reason) },
    pollRemote,
    documentRef,
    windowRef,
    debounceMs: 45_000,
    pullIntervalMs: 300_000,
    setTimeoutFn: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeoutFn: id => timers.clearTimeout(id),
    setIntervalFn: (callback, delay) => intervals.setInterval(callback, delay),
    clearIntervalFn: id => intervals.clearInterval(id),
    observeLocalChanges(callback) {
      notifyLocalSave = callback
      return () => { notifyLocalSave = null }
    }
  })
  return {
    documentRef,
    windowRef,
    timers,
    intervals,
    reasons,
    lifecycle,
    save: () => notifyLocalSave(),
    setVisibility(state) {
      documentRef.visibilityState = state
      documentRef.dispatchEvent(new Event('visibilitychange'))
    }
  }
}

test('mobile lifecycle syncs as soon as the network comes back', async () => {
  const harness = createLifecycleHarness()
  await harness.lifecycle.start()
  harness.windowRef.dispatchEvent(new Event('online'))
  await Promise.resolve()
  assert.deepEqual(harness.reasons, ['startup', 'online'])
  harness.lifecycle.stop()
  harness.windowRef.dispatchEvent(new Event('online'))
  await Promise.resolve()
  assert.deepEqual(harness.reasons, ['startup', 'online'], 'stop() 後不再監聽網路恢復')
})

test('mobile lifecycle polls the remote only while the app is in the foreground', async () => {
  let polls = 0
  const harness = createLifecycleHarness({ pollRemote: async () => { polls += 1 } })
  await harness.lifecycle.start()
  assert.deepEqual(harness.intervals.delays, [300_000])
  await harness.intervals.tick()
  assert.equal(polls, 1)
  assert.deepEqual(harness.reasons, ['startup'], '輪詢走 pollRemote（先比 ETag），不直接跑完整同步')

  harness.setVisibility('hidden')
  assert.equal(harness.intervals.size, 0, '進背景停止輪詢')
  harness.setVisibility('visible')
  await Promise.resolve()
  assert.equal(harness.intervals.size, 1, '回前景恢復輪詢')
  assert.deepEqual(harness.reasons, ['startup', 'visibility'])

  harness.lifecycle.stop()
  assert.equal(harness.intervals.size, 0)
})

test('mobile lifecycle starts without polling when launched in the background', async () => {
  const harness = createLifecycleHarness()
  harness.documentRef.visibilityState = 'hidden'
  await harness.lifecycle.start()
  assert.equal(harness.intervals.size, 0)
  harness.lifecycle.stop()
})

test('going to the background pushes a pending local save immediately instead of waiting 45 seconds', async () => {
  const harness = createLifecycleHarness()
  await harness.lifecycle.start()
  harness.save()
  assert.equal(harness.timers.size, 1)
  harness.setVisibility('hidden')
  await Promise.resolve()
  assert.equal(harness.timers.size, 0, '背景 flush 會取消 debounce timer')
  assert.deepEqual(harness.reasons, ['startup', 'hidden'])
  harness.lifecycle.stop()
})

test('a save that happens while the app is already hidden is pushed right away', async () => {
  const harness = createLifecycleHarness()
  await harness.lifecycle.start()
  harness.setVisibility('hidden')
  harness.save()
  await Promise.resolve()
  assert.equal(harness.timers.size, 0)
  assert.deepEqual(harness.reasons, ['startup', 'hidden-change'])
  harness.lifecycle.stop()
})

test('flush() pushes a pending save now and is a no-op when nothing is pending', async () => {
  const harness = createLifecycleHarness()
  await harness.lifecycle.start()
  harness.lifecycle.flush('back-button')
  assert.deepEqual(harness.reasons, ['startup'])
  harness.save()
  harness.lifecycle.flush('back-button')
  await Promise.resolve()
  assert.deepEqual(harness.reasons, ['startup', 'back-button'])
  assert.equal(harness.timers.size, 0)
  harness.lifecycle.stop()
})

function createFailingApi(fetchFn) {
  const timers = createTimers()
  const intervals = createIntervals()
  const requests = []
  const api = createMobileSyncApi({
    preferences: new MemoryPreferences(),
    storage: new MemoryStorage({ 'mindflow.docs.index': JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] }) }),
    fetchFn: async (url, init) => {
      requests.push({ url, init })
      return fetchFn(url, init)
    },
    machineId: 'android-retry',
    autoStart: true,
    documentRef: new FakeDocument(),
    windowRef: new EventTarget(),
    observeLocalChanges: () => () => {},
    setTimeoutFn: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeoutFn: id => timers.clearTimeout(id),
    setIntervalFn: (callback, delay) => intervals.setInterval(callback, delay),
    clearIntervalFn: id => intervals.clearInterval(id)
  })
  return { api, timers, intervals, requests }
}

test('network failures retry with backoff (30 s doubling to 5 min) and never bypass the HTTP cache rule', async () => {
  const token = 'github_pat_RETRY_SECRET_VALUE'
  const { api, timers, requests } = createFailingApi(async () => {
    throw new Error(`socket hang up for ${token}`)
  })
  assert.deepEqual(await api.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token }), { ok: true })
  assert.equal((await api.getStatus()).state, 'offline')
  assert.ok(requests.length > 0)
  assert.ok(requests.every(request => request.init.cache === 'no-store'), '每個 GitHub 請求都要繞過 WebView HTTP 快取')
  assert.deepEqual(timers.delays(), [MOBILE_SYNC_RETRY_INITIAL_MS])

  const seen = []
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await timers.runAll()
    await api.syncNow({ reason: 'settle' })
    seen.push(...timers.delays())
  }
  assert.equal(timers.size, 1, '同一時間最多一個重試計時器')
  assert.equal(Math.max(...seen), MOBILE_SYNC_RETRY_MAX_MS)
  assert.ok(seen.every(delay => delay <= MOBILE_SYNC_RETRY_MAX_MS))

  const diagnostics = await api.getDiagnostics()
  assert.ok(diagnostics.length > 0)
  assert.ok(diagnostics.some(entry => entry.reason === 'retry' && entry.ok === false))
  assert.equal(JSON.stringify(diagnostics).includes(token), false, '診斷紀錄不能含權杖')
  await api.dispose()
  assert.equal(timers.size, 0, 'dispose 取消排著的重試')
})

test('authentication failures do not retry in a loop', async () => {
  const { api, timers } = createFailingApi(async () => new Response(JSON.stringify({ message: 'Bad credentials' }), {
    status: 401,
    headers: { 'content-type': 'application/json' }
  }))
  assert.deepEqual(await api.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token: 'github_pat_bad' }), { ok: true })
  assert.equal((await api.getStatus()).state, 'error')
  assert.equal(timers.size, 0)
  await api.dispose()
})
