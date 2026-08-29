// 在真機 profile 啟用同步（主 session 驗收用）：連上已啟動的真 profile 實例（CDP 9353），
// 用真實 preload 橋 setConfig + syncNow，回報結果。token 由 MF_TEST_TOKEN 傳入，不列印。
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(join(process.env.MF_PW_PATH, 'index.mjs')).href)
const token = process.env.MF_TEST_TOKEN
const repo = 'jason4233/mindflow-data'
const wait = ms => new Promise(r => setTimeout(r, ms))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9353')
const ctx = browser.contexts()[0]
let page = ctx.pages().find(p => p.url().startsWith('mindflow://'))
for (let i = 0; !page && i < 10; i++) { await wait(1000); page = ctx.pages().find(p => p.url().startsWith('mindflow://')) }
if (!page) { console.log('FAIL: no page'); process.exit(1) }
await wait(1500)

const cfg = await page.evaluate(async ({ t, r }) => {
  const set = await window.mindflowSync.setConfig({ token: t, repo: r, enabled: true })
  return set && set.ok ? 'OK' : 'FAIL:' + (set && set.error || '?')
}, { t: token, r: repo })
console.log('REAL-CONFIG:', cfg)

const sync = await page.evaluate(async () => {
  const res = await window.mindflowSync.syncNow()
  return res && res.ok ? 'OK' : 'FAIL:' + (res && res.error || '?')
})
console.log('REAL-SYNC:', sync)

const status = await page.evaluate(async () => {
  const s = await window.mindflowSync.getStatus()
  return JSON.stringify({ state: s.state, docCount: s.docCount, lastSyncAt: s.lastSyncAt ? 'set' : null, warning: s.warning || null })
})
console.log('REAL-STATUS:', status)
process.exit(cfg === 'OK' && sync === 'OK' ? 0 : 1)
