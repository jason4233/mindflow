// 診斷「已安裝版」快捷鍵：以 CDP 連上真實安裝的 MindFlow.exe，實測 Tab / IME-Ctrl+Alt+M / console 錯誤
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { pathToFileURL } from 'node:url'
const pwRoot = process.env.MF_PW_PATH
let chromium
try {
  const mod = await import(pathToFileURL(join(pwRoot, 'index.mjs')).href)
  chromium = mod.chromium || mod.default.chromium
} catch (e) { console.log('NEED_PLAYWRIGHT: ' + e.message.slice(0, 120)); process.exit(2) }

const exe = 'C:/Users/ASUS/AppData/Local/Programs/MindFlow/MindFlow.exe'
const userData = mkdtempSync(join(tmpdir(), 'mf-diag-'))
const port = 9345
const useReal = process.env.MF_REAL_PROFILE === '1'
const args = [`--remote-debugging-port=${port}`]
if (!useReal) args.push(`--user-data-dir=${userData}`)
const app = spawn(exe, args, { stdio: 'ignore', detached: true })

const wait = ms => new Promise(r => setTimeout(r, ms))
await wait(4000)

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const ctx = browser.contexts()[0]
let page = ctx.pages().find(p => p.url().startsWith('mindflow://'))
for (let i = 0; !page && i < 10; i++) { await wait(1000); page = ctx.pages().find(p => p.url().startsWith('mindflow://')) }
if (!page) { console.log('FAIL: no mindflow page'); process.exit(1) }

const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
await wait(1500)
console.log('URL:', page.url())

// 進入編輯器（首頁 → 新建或開啟第一份文件）
if (!page.url().includes('editor')) {
  // 開啟使用者最近編輯的「真實文件」而非新建
  const target = await page.evaluate(() => {
    try {
      const idx = JSON.parse(localStorage.getItem('mindflow.docs.index') || '{}')
      const docs = idx.docs || idx || []
      const list = Array.isArray(docs) ? docs : Object.values(docs)
      list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      return list[0] ? (list[0].id || list[0]) : null
    } catch (e) { return 'ERR:' + e.message }
  })
  console.log('most-recent doc:', JSON.stringify(target))
  if (target && !String(target).startsWith('ERR')) {
    await page.evaluate(id => { location.href = 'mindflow://app/editor.html?id=' + id }, target)
    await wait(2500)
  } else {
    const btn = page.locator('text=新增空白心智圖').first()
    if (await btn.count()) { await btn.click(); await wait(2000) }
  }
}
console.log('after-nav URL:', page.url())

// 測 1：選節點按 Tab（真實鍵盤事件）
const nodeCountBefore = await page.evaluate(() => document.querySelectorAll('#nodes-layer [data-node-id]').length)
await page.evaluate(() => { const n = document.querySelector('#nodes-layer [data-node-id]'); n.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); n.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); n.click() })
await page.keyboard.press('Tab')
await wait(600)
const nodeCountAfter = await page.evaluate(() => document.querySelectorAll('#nodes-layer [data-node-id]').length)
console.log(`TAB: ${nodeCountBefore} -> ${nodeCountAfter} ${nodeCountAfter > nodeCountBefore ? 'PASS' : 'FAIL'}`)
if (nodeCountAfter > nodeCountBefore) { await page.keyboard.press('Control+z'); await wait(400) }

// 測 2：IME 變體 Ctrl+Alt+M（合成 Process 事件）
const imeResult = await page.evaluate(() => {
  const n = document.querySelector('#nodes-layer [data-node-id]')
  n.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); n.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); n.click()
  const ev = new KeyboardEvent('keydown', {key:'Process', code:'KeyM', keyCode:229, which:229, ctrlKey:true, altKey:true, bubbles:true, cancelable:true})
  document.dispatchEvent(ev)
  return new Promise(r => setTimeout(() => { const ta = document.querySelector('textarea'); r(ta && ta.getBoundingClientRect().width > 0 ? 'PASS' : 'FAIL') }, 300))
})
console.log('IME-CTRL-ALT-M:', imeResult)

// 測 3：真實鍵盤 Ctrl+Alt+M（英數模式路徑）
await page.keyboard.press('Escape'); await wait(300)
await page.evaluate(() => { const n = document.querySelectorAll('#nodes-layer [data-node-id]')[1] || document.querySelector('#nodes-layer [data-node-id]'); n.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); n.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); n.click() })
await page.keyboard.press('Control+Alt+m'); await wait(400)
const realKey = await page.evaluate(() => { const ta = document.querySelector('textarea'); return ta && ta.getBoundingClientRect().width > 0 ? 'PASS' : 'FAIL' })
console.log('REAL-CTRL-ALT-M:', realKey)

console.log('CONSOLE-ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none')
try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }) } catch {}
process.exit(0)
