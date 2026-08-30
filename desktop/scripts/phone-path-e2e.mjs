// 手機同步代碼路徑 × 真 GitHub repo E2E（主 session 驗收用）：
// 以 Chromium 模擬 Capacitor 環境（addInitScript 裝 shim），讓生產版 js/sync-mobile.mjs
// 在瀏覽器 context 直接對 api.github.com 收發——驗證 CORS 與手機路徑端到端。
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(join(process.env.MF_PW_PATH, 'index.mjs')).href)
const token = process.env.MF_TEST_TOKEN
if (!token) { console.log('FAIL: no token'); process.exit(1) }

const browser = await chromium.launch({ headless: false, channel: 'chrome' })
const ctx = await browser.newContext()
await ctx.addInitScript(() => {
  const mem = new Map()
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      Preferences: {
        async get({ key }) { return { value: mem.has(key) ? mem.get(key) : null } },
        async set({ key, value }) { mem.set(key, value) },
        async remove({ key }) { mem.delete(key) }
      }
    }
  }
})
const page = await ctx.newPage()
// 打 mobile/www 副本 = APK 實際出貨內容（含 copy-web 改寫後的 CSP）
await page.goto('http://127.0.0.1:8931/mobile/www/index.html', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

const result = await page.evaluate(async ({ t, repo }) => {
  const out = {}
  // 清空本地文件再同步：避免測試的預設/歡迎文件被推上真 repo（純拉驗證）
  for (const k of Object.keys(localStorage)) if (k.startsWith('mindflow.')) localStorage.removeItem(k)
  const mod = await import('/mobile/www/js/sync-mobile.mjs')
  out.nativeDetected = mod.isNativeCapacitor()
  const prefs = mod.getCapacitorPreferences()
  out.prefsAvailable = !!prefs
  if (!prefs) return out
  await prefs.set({ key: mod.MOBILE_SYNC_CONFIG_KEY, value: JSON.stringify({ enabled: true, repo, branch: 'main' }) })
  await prefs.set({ key: mod.MOBILE_SYNC_TOKEN_KEY, value: t })
  const api = mod.createMobileSyncApi({ preferences: prefs })
  const sync = await api.syncNow({ reason: 'test' })
  out.syncOk = !!(sync && (sync.ok === true || sync.state === 'idle' || sync.status === 'ok'))
  out.syncRaw = JSON.stringify(sync).slice(0, 120)
  const idx = JSON.parse(localStorage.getItem('mindflow.docs.index') || '{}')
  out.pulledDocs = (idx.docs || []).length
  out.blobsPresent = (idx.docs || []).every(d => !!localStorage.getItem('mindflow.doc.' + d.id))
  return out
}, { t: token, repo: 'jason4233/mindflow-data' })

console.log('NATIVE-DETECTED:', result.nativeDetected)
console.log('PREFS:', result.prefsAvailable)
console.log('SYNC:', result.syncOk, result.syncRaw || '')
console.log('PULLED-DOCS:', result.pulledDocs)
console.log('BLOBS-PRESENT:', result.blobsPresent)
await browser.close()
process.exitCode = result.nativeDetected && result.prefsAvailable && result.syncOk && result.pulledDocs >= 2 && result.blobsPresent ? 0 : 1
