// 真 GitHub repo 雙實例同步實測（主 session 驗收用）：
// 實例 A（隔離 profile）設定同步→建文件→syncNow→驗遠端；實例 B（另一隔離 profile）同設定→syncNow→驗文件出現。
// token 由環境變數 MF_TEST_TOKEN 傳入，全程不列印。
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const pwRoot = process.env.MF_PW_PATH
const token = process.env.MF_TEST_TOKEN
const repo = process.env.MF_TEST_REPO || 'jason4233/mindflow-data'
if (!token) { console.log('FAIL: no token'); process.exit(1) }
const { chromium } = await import(pathToFileURL(join(pwRoot, 'index.mjs')).href)

const exe = 'C:/Users/ASUS/AppData/Local/Programs/MindFlow/MindFlow.exe'
const wait = ms => new Promise(r => setTimeout(r, ms))
const results = { aConfig: 'SKIP', aSync: 'SKIP', remote: 'SKIP', bSync: 'SKIP', bDocVisible: 'SKIP' }
const tempDirs = []
const apps = []
const DOC_TITLE = `真repo實測-${Date.now().toString(36)}`

async function launchInstance(port) {
  const userData = mkdtempSync(join(tmpdir(), 'mf-realsync-'))
  tempDirs.push(userData)
  const app = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore', detached: true })
  apps.push(app)
  await wait(4500)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find(p => p.url().startsWith('mindflow://'))
  for (let i = 0; !page && i < 10; i++) { await wait(1000); page = ctx.pages().find(p => p.url().startsWith('mindflow://')) }
  if (!page) throw new Error('no page')
  await wait(1200)
  return { page, app }
}

async function configureSync(page) {
  return page.evaluate(async ({ t, r }) => {
    if (!window.mindflowSync) return 'NO_BRIDGE'
    const set = await window.mindflowSync.setConfig({ token: t, repo: r, enabled: true })
    return set && set.ok ? 'OK' : 'SET_FAIL:' + (set && set.error || '?')
  }, { t: token, r: repo })
}

async function syncNow(page) {
  return page.evaluate(async () => {
    const res = await window.mindflowSync.syncNow()
    return res && res.ok ? 'OK' : 'SYNC_FAIL:' + (res && res.error || '?')
  })
}

try {
  // ===== 實例 A =====
  const a = await launchInstance(9351)
  const cfgA = await configureSync(a.page)
  results.aConfig = cfgA === 'OK' ? 'PASS' : cfgA
  // 建一份可識別文件
  await a.page.evaluate(title => {
    if (!location.href.includes('editor')) {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('新增'))
      if (btn) btn.click()
    }
    return title
  }, DOC_TITLE)
  await wait(2500)
  await a.page.evaluate(title => {
    // 直接改標題透過 store 正規路徑：改 title input 或 localStorage 後觸發存檔——用 UI 改名最真實
    const t = document.querySelector('#doc-title, [data-doc-title], .doc-title')
    if (t) { t.textContent = title }
    // 保底：直接改最新文件 title
    const idx = JSON.parse(localStorage.getItem('mindflow.docs.index'))
    const doc = idx.docs[idx.docs.length - 1]
    const blobKey = 'mindflow.doc.' + doc.id
    const blob = JSON.parse(localStorage.getItem(blobKey))
    blob.title = title; doc.title = title
    localStorage.setItem(blobKey, JSON.stringify(blob))
    localStorage.setItem('mindflow.docs.index', JSON.stringify(idx))
  }, DOC_TITLE)
  const syncA = await syncNow(a.page)
  results.aSync = syncA === 'OK' ? 'PASS' : syncA
  await wait(2000)
  // 記下 A 的文件 id（標題會被編輯器自動存檔覆蓋，改用 id 斷言）
  var docId = await a.page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('mindflow.docs.index'))
    return idx.docs[idx.docs.length - 1].id
  })
  console.log('A-DOC-ID:', docId)

  // ===== 遠端驗證（gh api，不經 app）=====
  try {
    const manifest = execSync(`gh api repos/${repo}/contents/manifest.json --jq .name`, { encoding: 'utf8' }).trim()
    results.remote = manifest === 'manifest.json' ? 'PASS' : 'NO_MANIFEST'
  } catch { results.remote = 'REMOTE_CHECK_FAIL' }

  // ===== 實例 B =====
  const b = await launchInstance(9352)
  const cfgB = await configureSync(b.page)
  const syncB = await syncNow(b.page)
  results.bSync = syncB === 'OK' ? 'PASS' : syncB
  await wait(2500)
  const visible = await b.page.evaluate(id => {
    const idx = JSON.parse(localStorage.getItem('mindflow.docs.index') || '{}')
    const inIndex = (idx.docs || []).some(d => d.id === id)
    const hasBlob = !!localStorage.getItem('mindflow.doc.' + id)
    return inIndex && hasBlob
  }, docId)
  results.bDocVisible = visible ? 'PASS' : 'FAIL'
} catch (e) {
  console.log('runner-error:', String(e).slice(0, 140))
} finally {
  console.log('A-CONFIG:', results.aConfig)
  console.log('A-SYNC:', results.aSync)
  console.log('REMOTE-MANIFEST:', results.remote)
  console.log('B-SYNC:', results.bSync)
  console.log('B-DOC-VISIBLE:', results.bDocVisible)
  for (const app of apps) { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
  process.exitCode = Object.values(results).every(v => v === 'PASS') ? 0 : 1
}
