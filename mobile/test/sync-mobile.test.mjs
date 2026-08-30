import assert from 'node:assert/strict'
import test from 'node:test'

import { detectSyncEnvironment } from '../../js/settings.js'
import {
  MOBILE_SYNC_CONFIG_KEY,
  MOBILE_SYNC_TOKEN_KEY,
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
