/**
 * 手機 App 內檢查新版：找 MindFlow-<versionCode>.apk、比版號、節流與稍後提醒。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_SNOOZE_MS,
  createUpdateChecker,
  latestApkFromRelease
} from '../js/mobile-update.mjs'

class MemoryStorage {
  #data = new Map()
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null }
  setItem(key, value) { this.#data.set(key, String(value)) }
}

const release = (...codes) => ({
  html_url: 'https://github.com/jason4233/mindflow/releases/tag/latest',
  assets: [
    { name: 'MindFlow.apk', browser_download_url: 'https://github.com/jason4233/mindflow/releases/download/latest/MindFlow.apk' },
    { name: 'MindFlow-Setup.exe', browser_download_url: 'https://github.com/jason4233/mindflow/releases/download/latest/MindFlow-Setup.exe' },
    ...codes.map(code => ({ name: `MindFlow-${code}.apk`, browser_download_url: `https://github.com/jason4233/mindflow/releases/download/latest/MindFlow-${code}.apk` }))
  ]
})

function setup({ build = '41', body = release(42), status = 200 } = {}) {
  const clock = { value: 1_000_000 }
  const requests = []
  const checker = createUpdateChecker({
    app: { getInfo: async () => ({ build, version: '1.1.41' }) },
    storage: new MemoryStorage(),
    now: () => clock.value,
    fetchFn: async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    }
  })
  return { checker, clock, requests }
}

test('latestApkFromRelease picks the highest versioned APK and ignores other assets and foreign hosts', () => {
  assert.deepEqual(latestApkFromRelease(release(40, 45, 43)), {
    versionCode: 45,
    name: 'MindFlow-45.apk',
    url: 'https://github.com/jason4233/mindflow/releases/download/latest/MindFlow-45.apk',
    pageUrl: 'https://github.com/jason4233/mindflow/releases/tag/latest'
  })
  assert.equal(latestApkFromRelease(release()), null)
  assert.equal(latestApkFromRelease({ assets: [{ name: 'MindFlow-99.apk', browser_download_url: 'https://evil.example/MindFlow-99.apk' }] }), null)
  assert.equal(latestApkFromRelease(null), null)
})

test('a newer versionCode is reported as an update; the request bypasses the HTTP cache', async () => {
  const { checker, requests } = setup()
  const result = await checker.check()
  assert.equal(result.status, 'update')
  assert.equal(result.latest.versionCode, 42)
  assert.equal(result.current.versionCode, 41)
  assert.equal(requests[0].init.cache, 'no-store')
  assert.equal(requests[0].url, 'https://api.github.com/repos/jason4233/mindflow/releases/tags/latest')
})

test('same or older release is current', async () => {
  assert.equal((await setup({ build: '42' }).checker.check()).status, 'current')
  assert.equal((await setup({ build: '50' }).checker.check()).status, 'current')
})

test('checks are throttled to once per interval but keep showing a known update', async () => {
  const { checker, clock, requests } = setup()
  await checker.check()
  clock.value += 60_000
  const again = await checker.check()
  assert.equal(requests.length, 1, '節流期間不再呼叫 GitHub')
  assert.equal(again.status, 'update', '回首頁時提示仍在')
  clock.value += UPDATE_CHECK_INTERVAL_MS
  await checker.check()
  assert.equal(requests.length, 2)
  await checker.check({ force: true })
  assert.equal(requests.length, 3, '手動檢查不受節流')
})

test('"later" snoozes this version for a few days, but a newer version shows right away', async () => {
  const env = setup()
  const first = await env.checker.check()
  env.checker.snooze(first.latest)
  env.clock.value += UPDATE_CHECK_INTERVAL_MS + 1
  assert.equal((await env.checker.check()).status, 'snoozed')
  env.clock.value += UPDATE_SNOOZE_MS
  assert.equal((await env.checker.check()).status, 'update')
})

test('network and API errors are reported without throwing', async () => {
  const { checker } = setup({ status: 403, body: { message: 'rate limited' } })
  const result = await checker.check()
  assert.equal(result.status, 'error')
})
