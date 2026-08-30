#!/usr/bin/env node
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_ID = 'touch-e2e-doc'
const STORAGE_KEY = `mindflow.doc.${FIXTURE_ID}`
const FIXTURE = createFixture()
let browser
let server
let baseURL

before(async () => {
  const { chromium } = await loadPlaywright()
  server = await ensureServer()
  baseURL = server.baseURL
  browser = await chromium.launch({ headless: true, executablePath: findSystemChromium() })
})

after(async () => {
  await browser?.close()
  await server?.close()
})

test('375×812 touch 實測', async t => {
  await t.test('touch 模式啟用，tap 選取後顯示兩個節點快捷按鈕並可新增子節點', async () => {
    await withPage(async page => {
      assert.equal(await page.locator('html').getAttribute('class').then(value => Boolean(value?.includes('mindflow-touch'))), true)

      const nodeA = page.locator('.mind-node[data-node-id="a"]')
      await tapLocator(page, nodeA)
      assert.equal(await nodeA.getAttribute('class').then(value => value.includes('is-selected')), true)

      const actions = page.locator('[data-touch-node-actions]')
      await actions.waitFor({ state: 'visible' })
      assert.equal(await actions.locator('button').count(), 2)

      const beforeCount = await page.locator('.mind-node').count()
      await tapLocator(page, actions.locator('[data-touch-action="insertChild"]'))
      await page.waitForFunction(count => document.querySelectorAll('.mind-node').length === count + 1, beforeCount)
      assert.equal(await page.locator('.mind-node').count(), beforeCount + 1)
    })
  })

  await t.test('單指拖空白平移，雙指以中點 pinch 縮放', async () => {
    await withPage(async page => {
      const cdp = await page.context().newCDPSession(page)
      const blank = await findBlankPoint(page)
      const beforePan = await page.locator('#world').getAttribute('style')
      await touchDrag(cdp, blank, { x: blank.x + 54, y: blank.y + 42 })
      const afterPan = await page.locator('#world').getAttribute('style')
      assert.notEqual(afterPan, beforePan)

      const [left, right] = await findPinchPoints(page)
      const beforeZoom = await readZoom(page)
      await dispatchTouch(cdp, 'touchStart', [touchPoint(left, 1), touchPoint(right, 2)])
      await dispatchTouch(cdp, 'touchMove', [
        touchPoint({ x: left.x - 38, y: left.y }, 1),
        touchPoint({ x: right.x + 38, y: right.y }, 2)
      ])
      await dispatchTouch(cdp, 'touchEnd', [])
      assert.ok(await readZoom(page) > beforeZoom)
    })
  })

  await t.test('double-tap 節點進入編輯，double-tap 空白新增懸浮節點', async () => {
    await withPage(async page => {
      const node = page.locator('.mind-node[data-node-id="a"]')
      await tapLocator(page, node)
      await page.waitForTimeout(90)
      await tapLocator(page, node)
      await page.locator('.mind-node[data-node-id="a"].is-editing').waitFor({ state: 'visible' })
    })

    await withPage(async page => {
      const blank = await findBlankPoint(page)
      const beforeCount = await page.locator('.mind-node').count()
      await page.touchscreen.tap(blank.x, blank.y)
      await page.waitForTimeout(90)
      await page.touchscreen.tap(blank.x, blank.y)
      await page.waitForFunction(count => document.querySelectorAll('.mind-node').length === count + 1, beforeCount)
      assert.equal(await page.locator('.mind-node--floating.is-editing').count(), 1)
    })
  })

  await t.test('long-press 節點開啟既有節點選單', async () => {
    await withPage(async page => {
      const cdp = await page.context().newCDPSession(page)
      const point = await locatorCenter(page.locator('.mind-node[data-node-id="a"]'))
      await dispatchTouch(cdp, 'touchStart', [touchPoint(point, 1)])
      await page.waitForTimeout(620)
      await dispatchTouch(cdp, 'touchEnd', [])
      const menu = page.locator('.context-menu')
      await menu.waitFor({ state: 'visible' })
      assert.match(await menu.textContent(), /添加下級節點/u)
    })
  })

  await t.test('單指拖節點沿既有 dnd command path 重掛', async () => {
    await withPage(async page => {
      const cdp = await page.context().newCDPSession(page)
      const source = await locatorCenter(page.locator('.mind-node[data-node-id="b"]'))
      const target = await locatorCenter(page.locator('.mind-node[data-node-id="a"]'))
      await touchDrag(cdp, source, target, 8)
      await page.waitForTimeout(650)
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY)
      assert.equal(findNode(saved.root, 'a').children.some(node => node.id === 'b'), true)
    })
  })
})

test('1280×800 desktop 不啟用 touch engine，既有 mouse 選取與平移維持有效', async () => {
  await withPage(async page => {
    assert.equal(await page.locator('html').getAttribute('class').then(value => Boolean(value?.includes('mindflow-touch'))), false)
    assert.equal(await page.locator('[data-touch-node-actions]').count(), 0)

    const node = page.locator('.mind-node[data-node-id="c"]')
    await node.click()
    assert.equal(await node.getAttribute('class').then(value => value.includes('is-selected')), true)

    const blank = await findBlankPoint(page)
    const beforePan = await page.locator('#world').getAttribute('style')
    await page.mouse.move(blank.x, blank.y)
    await page.mouse.down()
    await page.mouse.move(blank.x + 58, blank.y + 36, { steps: 5 })
    await page.mouse.up()
    assert.notEqual(await page.locator('#world').getAttribute('style'), beforePan)
  }, {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false
  })
})

async function withPage(run, contextOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    ...contextOptions
  })
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: STORAGE_KEY,
    value: JSON.stringify(FIXTURE)
  })
  const page = await context.newPage()
  try {
    await page.goto(`${baseURL}/editor.html?id=${FIXTURE_ID}`)
    await page.locator('.mind-node').first().waitFor({ state: 'visible' })
    await page.waitForTimeout(100)
    // ViewportController 首次載入固定 100%；行動 E2E 先走既有 Fit，確保測試座標真的落在 375px 視口內。
    await page.evaluate(() => document.querySelector('#fit-button').click())
    await page.waitForTimeout(50)
    await run(page)
  } finally {
    await context.close()
  }
}

async function tapLocator(page, locator) {
  const point = await locatorCenter(locator)
  await page.touchscreen.tap(point.x, point.y)
}

async function locatorCenter(locator) {
  const box = await locator.boundingBox()
  assert.ok(box, '觸控目標必須可見')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function findBlankPoint(page) {
  return page.evaluate(() => {
    const canvasElement = document.querySelector('#canvas')
    const canvas = canvasElement.getBoundingClientRect()
    for (let y = canvas.top + 24; y < canvas.bottom - 24; y += 28) {
      for (let x = canvas.left + 24; x < canvas.right - 24; x += 28) {
        const target = document.elementFromPoint(x, y)
        if (canvasElement.contains(target) && !target?.closest('.mind-node, button, input, select, textarea, [contenteditable="true"], .context-menu')) {
          return { x, y }
        }
      }
    }
    throw new Error('找不到空白畫布觸控點')
  })
}

async function findPinchPoints(page) {
  return page.evaluate(() => {
    const canvasElement = document.querySelector('#canvas')
    const canvas = canvasElement.getBoundingClientRect()
    for (let y = canvas.top + 60; y < canvas.bottom - 60; y += 36) {
      for (let x = canvas.left + 78; x < canvas.right - 78; x += 36) {
        const points = [{ x: x - 32, y }, { x: x + 32, y }]
        if (points.every(point => {
          const target = document.elementFromPoint(point.x, point.y)
          return canvasElement.contains(target) && !target?.closest('.mind-node, button, input, select, textarea')
        })) {
          return points
        }
      }
    }
    throw new Error('找不到 pinch 空白區域')
  })
}

async function touchDrag(cdp, start, end, steps = 5) {
  await dispatchTouch(cdp, 'touchStart', [touchPoint(start, 1)])
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps
    await dispatchTouch(cdp, 'touchMove', [touchPoint({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio
    }, 1)])
  }
  await dispatchTouch(cdp, 'touchEnd', [])
}

function touchPoint(point, id) {
  return { x: point.x, y: point.y, id, radiusX: 3, radiusY: 3, force: 1 }
}

async function dispatchTouch(cdp, type, touchPoints) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
}

async function readZoom(page) {
  return page.locator('#zoom-display').textContent().then(text => Number.parseInt(text, 10))
}

function createFixture() {
  const now = '2026-08-30T00:00:00.000Z'
  const node = (id, text, children = []) => ({
    id, text, children, collapsed: false, side: null, style: {}, richText: null,
    notes: null, link: null, icons: [], image: null
  })
  return {
    id: FIXTURE_ID,
    title: 'Touch E2E',
    createdAt: now,
    updatedAt: now,
    root: node('root', 'ROOT', [
      { ...node('a', 'Alpha', [node('a1', 'Alpha child')]), side: 'right' },
      { ...node('b', 'Beta'), side: 'right' },
      { ...node('c', 'Charlie'), side: 'left' }
    ]),
    layout: 'mindmap-both',
    themeId: 'classic-blue',
    relations: [],
    summaries: [],
    canvas: {
      background: '#f5f5f5',
      watermark: { enabled: false, text: 'MindFlow', color: '#64748b', rotation: 'left', opacity: 12, size: 18 },
      spacingH: 30,
      spacingV: 30
    }
  }
}

function findNode(root, id) {
  if (root.id === id) return root
  for (const child of root.children || []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

async function loadPlaywright() {
  const cacheRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  let candidates = findCachedPlaywright(cacheRoot)
  if (candidates.length === 0) {
    const result = runNpx(['-y', 'playwright', '--version'])
    if (result.status !== 0) throw new Error(`無法準備 Playwright runtime：${result.stderr || result.stdout}`)
    candidates = findCachedPlaywright(cacheRoot)
  }
  if (candidates.length === 0) throw new Error('找不到 Playwright runtime')
  return import(pathToFileURL(candidates[0]).href)
}

function findCachedPlaywright(cacheRoot) {
  if (!existsSync(cacheRoot)) return []
  return readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(cacheRoot, entry.name, 'node_modules', 'playwright', 'index.mjs'))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
}

function findSystemChromium() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ]
  const executable = candidates.find(existsSync)
  if (!executable) throw new Error('找不到 Chrome / Edge executable')
  return executable
}

async function ensureServer() {
  const port = 4193
  const serverURL = `http://127.0.0.1:${port}`
  if (await responds(`${serverURL}/editor.html`)) return { baseURL: serverURL, close: async () => {} }
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(port)], {
    cwd: ROOT,
    windowsHide: true,
    stdio: 'ignore'
  })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await responds(`${serverURL}/editor.html`)) {
      return { baseURL: serverURL, close: async () => child.kill() }
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  child.kill()
  throw new Error('Touch E2E server 啟動逾時')
}

async function responds(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok
  } catch {
    return false
  }
}

function runNpx(args) {
  if (process.platform !== 'win32') return spawnSync('npx', args, { cwd: ROOT, encoding: 'utf8' })
  const npxCLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  return spawnSync(process.execPath, [npxCLI, ...args], { cwd: ROOT, encoding: 'utf8' })
}
