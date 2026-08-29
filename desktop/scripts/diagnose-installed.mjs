// 診斷「已安裝版」快捷鍵：以 CDP 連上真實安裝的 MindFlow.exe，實測 Tab / IME-合成 / CDP注入 Ctrl+Alt+M。
// 誠實性（依 CODEX_REVIEW_OF_CLAUDE 修正）：exit code 反映結果；try/finally 清理程序與暫存 profile；
// keyCode 229 用 defineProperty 強制（constructor 會忽略 deprecated 欄位）；派發目標用 activeElement。
// 已知限制（文件化，非 CI gate）：CDP 注入不等於 OS 實體鍵盤/真實 IME；console 監聽掛上前的啟動錯誤
// 與 main-process stderr 不在捕捉範圍；固定 port 9345 假設無殘留 debug instance；真實 profile 模式
// 有寫入副作用（Tab 後以 Ctrl+Z 還原，但不驗證完整回復）——正式回歸請以 tests/e2e/shortcuts.matrix.mjs 為準。
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const pwRoot = process.env.MF_PW_PATH
let chromium
try {
  const mod = await import(pathToFileURL(join(pwRoot, 'index.mjs')).href)
  chromium = mod.chromium || mod.default.chromium
} catch (e) { console.log('NEED_PLAYWRIGHT: ' + e.message.slice(0, 120)); process.exit(2) }

const exe = 'C:/Users/ASUS/AppData/Local/Programs/MindFlow/MindFlow.exe'
const useReal = process.env.MF_REAL_PROFILE === '1'
const userData = useReal ? null : mkdtempSync(join(tmpdir(), 'mf-diag-'))
const port = 9345
const args = [`--remote-debugging-port=${port}`]
if (userData) args.push(`--user-data-dir=${userData}`)

const wait = ms => new Promise(r => setTimeout(r, ms))
const results = { tab: 'SKIP', ime: 'SKIP', cdpKey: 'SKIP' }
const errors = []
let app = null

try {
  app = spawn(exe, args, { stdio: 'ignore', detached: true })
  await wait(4000)

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find(p => p.url().startsWith('mindflow://'))
  for (let i = 0; !page && i < 10; i++) { await wait(1000); page = ctx.pages().find(p => p.url().startsWith('mindflow://')) }
  if (!page) throw new Error('no mindflow page')

  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 160)))
  await wait(1500)
  console.log('URL:', page.url())

  if (!page.url().includes('editor')) {
    const target = await page.evaluate(() => {
      try {
        const idx = JSON.parse(localStorage.getItem('mindflow.docs.index') || '{}')
        const docs = idx.docs || idx || []
        const list = Array.isArray(docs) ? docs : Object.values(docs)
        list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
        return list[0] ? (list[0].id || list[0]) : null
      } catch { return null }
    })
    if (target) {
      await page.evaluate(id => { location.href = 'mindflow://app/editor.html?id=' + encodeURIComponent(id) }, target)
    } else {
      const btn = page.locator('text=新增空白心智圖').first()
      if (await btn.count()) await btn.click()
    }
    await wait(2500)
  }
  console.log('doc URL:', page.url())

  // 測 1：Tab 新增子節點（CDP 注入鍵盤），成功後 Ctrl+Z 還原
  const before = await page.evaluate(() => document.querySelectorAll('#nodes-layer [data-node-id]').length)
  await page.evaluate(() => { const n = document.querySelector('#nodes-layer [data-node-id]'); n.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); n.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); n.click() })
  await page.keyboard.press('Tab')
  await wait(600)
  const after = await page.evaluate(() => document.querySelectorAll('#nodes-layer [data-node-id]').length)
  results.tab = after > before ? 'PASS' : 'FAIL'
  if (after > before) { await page.keyboard.press('Control+z'); await wait(400) }

  // 測 2：合成 IME 事件（keyCode 以 defineProperty 強制 229；派發到 activeElement）
  results.ime = await page.evaluate(() => {
    const n = document.querySelector('#nodes-layer [data-node-id]')
    n.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); n.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); n.click()
    const ev = new KeyboardEvent('keydown', {key:'Process', code:'KeyM', ctrlKey:true, altKey:true, bubbles:true, cancelable:true})
    Object.defineProperty(ev, 'keyCode', { get: () => 229 })
    Object.defineProperty(ev, 'which', { get: () => 229 })
    ;(document.activeElement || document).dispatchEvent(ev)
    return new Promise(r => setTimeout(() => {
      const ta = document.querySelector('.feature-drawer textarea, textarea')
      r(ta && ta.getBoundingClientRect().width > 0 ? 'PASS' : 'FAIL')
    }, 300))
  })
  await page.keyboard.press('Escape'); await wait(300)

  // 測 3：CDP 注入 Ctrl+Alt+M（英數模式路徑；非 OS 實體鍵）
  await page.evaluate(() => { const n = document.querySelectorAll('#nodes-layer [data-node-id]')[1] || document.querySelector('#nodes-layer [data-node-id]'); n.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); n.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); n.click() })
  await page.keyboard.press('Control+Alt+m'); await wait(400)
  results.cdpKey = await page.evaluate(() => { const ta = document.querySelector('.feature-drawer textarea, textarea'); return ta && ta.getBoundingClientRect().width > 0 ? 'PASS' : 'FAIL' })
} catch (e) {
  errors.push('runner: ' + String(e).slice(0, 160))
} finally {
  console.log(`TAB: ${results.tab}`)
  console.log(`IME-SYNTH: ${results.ime}`)
  console.log(`CDP-CTRL-ALT-M: ${results.cdpKey}`)
  console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none')
  if (app?.pid) { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
  if (userData) { try { rmSync(userData, { recursive: true, force: true }) } catch {} }
  const allPass = Object.values(results).every(v => v === 'PASS') && errors.length === 0
  process.exitCode = allPass ? 0 : 1
}
