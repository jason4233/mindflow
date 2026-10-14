import assert from 'node:assert/strict'
import test from 'node:test'

import { getCapacitorPreferences } from '../../js/capacitor-plugins.mjs'
import { detectSyncEnvironment } from '../../js/settings.js'
import { createSyncEngine } from '../../js/sync/engine.mjs'
import { createMemoryKv } from '../../js/sync/kv.mjs'
import {
  MOBILE_SYNC_CONFIG_KEY,
  MOBILE_SYNC_STATE_KEY,
  MOBILE_SYNC_TOKEN_KEY,
  createMobilePlatform
} from '../../js/sync/platform-mobile.mjs'

class MemoryPreferences {
  constructor() { this.values = new Map() }
  async get({ key }) { return { value: this.values.get(key) ?? null } }
  async set({ key, value }) { this.values.set(key, String(value)) }
  async remove({ key }) { this.values.delete(key) }
}

class FakeSecureStorage {
  constructor({ available = true, failSet = false, failRemove = false } = {}) {
    this.values = new Map()
    this.available = available
    this.failSet = failSet
    this.failRemove = failRemove
  }
  async isAvailable() { return { available: this.available } }
  async get({ key }) { return { value: this.values.get(key) ?? null } }
  async set({ key, value }) { if (this.failSet) throw new Error('UNAVAILABLE'); this.values.set(key, String(value)) }
  async remove({ key }) { if (this.failRemove) throw new Error('UNAVAILABLE'); this.values.delete(key) }
}

class MemoryStorage {
  constructor() { this.values = new Map() }
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(String(key)) ?? null }
  setItem(key, value) { this.values.set(String(key), String(value)) }
  removeItem(key) { this.values.delete(String(key)) }
  snapshot() { return Object.fromEntries(this.values) }
}

function engineFor({ preferences = new MemoryPreferences(), secureStorage = null, storage = new MemoryStorage(), kv = createMemoryKv() } = {}) {
  const engine = createSyncEngine({
    platform: createMobilePlatform({ preferences, secureStorage, fetchFn: async () => { throw new Error('disabled sync must not fetch') } }),
    storage,
    kv,
    autoStart: false,
    documentRef: null,
    windowRef: null,
    observeLocalChanges: () => () => {}
  })
  return { engine, preferences, secureStorage, storage, kv }
}

test('settings environment routing prefers Electron, enables native Capacitor, and disables plain web', () => {
  assert.equal(detectSyncEnvironment({ mindflowSync: { getConfig() {} }, Capacitor: { isNativePlatform: () => true } }), 'electron')
  assert.equal(detectSyncEnvironment({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }), 'capacitor')
  assert.equal(detectSyncEnvironment({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }), 'web')
  assert.equal(detectSyncEnvironment({}), 'web')
})

test('native Capacitor registers Preferences without requiring a bundled bare-module import', () => {
  const preferences = new MemoryPreferences()
  const registrations = []
  const windowRef = { Capacitor: { isNativePlatform: () => true, registerPlugin(name) { registrations.push(name); return preferences } } }
  assert.equal(getCapacitorPreferences(windowRef), preferences)
  assert.deepEqual(registrations, ['Preferences'])
})

test('the PAT lives only in the Keystore-backed secure storage; getConfig exposes hasToken and where it is', async () => {
  const env = engineFor({ secureStorage: new FakeSecureStorage() })
  const token = 'github_pat_mobile_secret'
  assert.deepEqual(await env.engine.setConfig({ enabled: false, repo: 'chenrui/mindflow-data', token }), { ok: true })
  assert.deepEqual(await env.engine.getConfig(), { enabled: false, repo: 'chenrui/mindflow-data', hasToken: true, tokenStorage: 'secure' })
  assert.equal(env.secureStorage.values.get(MOBILE_SYNC_TOKEN_KEY), token)
  assert.equal(env.preferences.values.has(MOBILE_SYNC_TOKEN_KEY), false)
  assert.equal(JSON.stringify([...env.preferences.values.values()]).includes(token), false)
  assert.equal(JSON.stringify(env.storage.snapshot()).includes(token), false)
  assert.equal(JSON.stringify(env.kv.snapshot()).includes(token), false)
  assert.deepEqual(await env.engine.setConfig({ token: '' }), { ok: true })
  assert.equal(env.secureStorage.values.has(MOBILE_SYNC_TOKEN_KEY), false)
  await env.engine.dispose()
})

test('a plaintext PAT left by an older app is moved into secure storage and deleted', async () => {
  const preferences = new MemoryPreferences()
  preferences.values.set(MOBILE_SYNC_TOKEN_KEY, 'github_pat_legacy_plaintext')
  preferences.values.set(MOBILE_SYNC_CONFIG_KEY, JSON.stringify({ enabled: false, repo: 'chenrui/mindflow-data' }))
  const env = engineFor({ preferences, secureStorage: new FakeSecureStorage() })
  assert.deepEqual(await env.engine.getConfig(), { enabled: false, repo: 'chenrui/mindflow-data', hasToken: true, tokenStorage: 'secure' })
  assert.equal(env.secureStorage.values.get(MOBILE_SYNC_TOKEN_KEY), 'github_pat_legacy_plaintext')
  assert.equal(preferences.values.has(MOBILE_SYNC_TOKEN_KEY), false)
  await env.engine.dispose()
})

test('if secure storage cannot be written the plaintext PAT is kept, and a stale secure value is cleared', async () => {
  const preferences = new MemoryPreferences()
  preferences.values.set(MOBILE_SYNC_TOKEN_KEY, 'github_pat_keep_me')
  const secureStorage = new FakeSecureStorage({ failSet: true })
  secureStorage.values.set('unrelated', 'x')
  const env = engineFor({ preferences, secureStorage })
  const config = await env.engine.getConfig()
  assert.equal(config.hasToken, true)
  assert.equal(config.tokenStorage, 'preferences')
  assert.deepEqual(await env.engine.setConfig({ token: 'github_pat_new_one' }), { ok: true })
  assert.equal(preferences.values.get(MOBILE_SYNC_TOKEN_KEY), 'github_pat_new_one', '新輸入的 PAT 不能因安全儲存失敗而消失')
  await env.engine.dispose()
})

test('without the secure storage plugin (older APK) the PAT stays in Preferences, never in localStorage or getConfig', async () => {
  const env = engineFor()
  assert.deepEqual(await env.engine.setConfig({ enabled: false, repo: 'chenrui/mindflow-data', token: 'github_pat_no_plugin' }), { ok: true })
  assert.deepEqual(await env.engine.getConfig(), { enabled: false, repo: 'chenrui/mindflow-data', hasToken: true, tokenStorage: 'preferences' })
  assert.equal(env.preferences.values.get(MOBILE_SYNC_TOKEN_KEY), 'github_pat_no_plugin')
  assert.equal(env.preferences.values.get(MOBILE_SYNC_CONFIG_KEY)?.includes('github_pat_no_plugin'), false)
  await env.engine.dispose()
})

test('a Keystore key lost after restore (secure get returns null) just asks for the PAT again', async () => {
  const preferences = new MemoryPreferences()
  preferences.values.set(MOBILE_SYNC_CONFIG_KEY, JSON.stringify({ enabled: true, repo: 'chenrui/mindflow-data' }))
  const env = engineFor({ preferences, secureStorage: new FakeSecureStorage() })
  const config = await env.engine.getConfig()
  assert.equal(config.hasToken, false)
  assert.equal(config.tokenStorage, 'secure')
  assert.equal((await env.engine.getStatus()).state, 'disabled', '沒有 PAT 就不同步')
  await env.engine.dispose()
})

test('invalid repo or branch names are rejected before anything is saved', async () => {
  const env = engineFor({ secureStorage: new FakeSecureStorage() })
  assert.equal((await env.engine.setConfig({ repo: 'no-slash' })).ok, false)
  assert.equal((await env.engine.setConfig({ repo: 'a/b', branch: '../evil' })).ok, false)
  assert.equal((await env.engine.setConfig({ enabled: true, repo: 'a/b' })).ok, false, '啟用需要 PAT')
  assert.equal(env.preferences.values.has(MOBILE_SYNC_CONFIG_KEY), false)
  await env.engine.dispose()
})

test('the M1 sync base in Preferences is offered for migration and the M1 state key is untouched', async () => {
  const preferences = new MemoryPreferences()
  preferences.values.set(MOBILE_SYNC_STATE_KEY, JSON.stringify({ lastSyncedCommitSha: 'c1', baseManifest: { docs: {} }, perDoc: {}, machineId: 'mobile-legacy-1', storeEpoch: 'e1' }))
  const platform = createMobilePlatform({ preferences, fetchFn: async () => { throw new Error('no fetch') } })
  assert.deepEqual(await platform.loadLegacyState(), { lastSyncedCommitSha: 'c1', baseManifest: { docs: {} }, perDoc: {}, machineId: 'mobile-legacy-1', storeEpoch: 'e1' })
})
