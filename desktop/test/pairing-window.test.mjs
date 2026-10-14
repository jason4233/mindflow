import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { PAIRING_IPC_CHANNEL, pairingWindowHtml, registerPairingIpc } from '../pairing-window.mjs'
import { decodePairingPayload, encodePairingPayload } from '../pairing.mjs'

const TOKEN = 'TEST-ONLY-NOT-A-REAL-TOKEN-0123456789abcdef'

class FakeWindow extends EventEmitter {
  static created = []
  constructor(options) {
    super()
    this.options = options
    this.destroyed = false
    this.webContents = new EventEmitter()
    this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler }
    FakeWindow.created.push(this)
  }
  setMenuBarVisibility() {}
  setContentProtection(value) { this.contentProtection = value }
  isDestroyed() { return this.destroyed }
  focus() { this.focused = (this.focused || 0) + 1 }
  close() { this.destroyed = true; this.emit('closed') }
  async loadURL(url) { this.url = url }
}

function setup(pairing = { repo: 'chenrui/mindflow-data', branch: 'main', token: TOKEN }) {
  FakeWindow.created = []
  const handlers = new Map()
  const timers = []
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler) },
    removeHandler(channel) { handlers.delete(channel) }
  }
  const registration = registerPairingIpc({
    ipcMain,
    BrowserWindow: FakeWindow,
    getPairing: typeof pairing === 'function' ? pairing : () => pairing,
    setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    clearTimeoutFn: () => {}
  })
  return { handlers, registration, timers, invoke: () => handlers.get(PAIRING_IPC_CHANNEL)() }
}

test('the pairing window is isolated: no preload, no JavaScript, no devtools, no navigation, screenshot-protected', async () => {
  const env = setup()
  assert.deepEqual(await env.invoke(), { ok: true }, 'renderer 只拿到 { ok }')
  const [window] = FakeWindow.created
  assert.equal(window.options.webPreferences.preload, undefined)
  assert.equal(window.options.webPreferences.javascript, false)
  assert.equal(window.options.webPreferences.devTools, false)
  assert.equal(window.options.webPreferences.sandbox, true)
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  assert.equal(window.contentProtection, true)
  assert.deepEqual(window.openHandler(), { action: 'deny' })
  let prevented = false
  window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.ok(window.url.startsWith('data:text/html;charset=utf-8,'))
  const html = decodeURIComponent(window.url.slice('data:text/html;charset=utf-8,'.length))
  assert.match(html, /default-src 'none'/)
  assert.equal(html.includes(TOKEN), false, 'PAT 只以 QR 圖形出現，不以文字出現在頁面裡')
  assert.match(html, /<svg[^>]+viewBox/)
})

test('the window auto-closes after two minutes and a second request just focuses it', async () => {
  const env = setup()
  await env.invoke()
  await env.invoke()
  assert.equal(FakeWindow.created.length, 1)
  assert.equal(FakeWindow.created[0].focused, 1)
  assert.equal(env.timers[0].delay, 120_000)
  env.timers[0].callback()
  assert.equal(FakeWindow.created[0].destroyed, true)
  await env.invoke()
  assert.equal(FakeWindow.created.length, 2, '關閉後可以再開新的')
  env.registration.dispose()
  assert.equal(FakeWindow.created[1].destroyed, true)
  assert.equal(env.handlers.has(PAIRING_IPC_CHANNEL), false)
})

test('missing settings or an unavailable key never opens a window and never leaks the token', async () => {
  assert.deepEqual(Object.keys(await setup({ repo: '', token: TOKEN }).invoke()), ['ok', 'error'])
  assert.equal(FakeWindow.created.length, 0)
  const failing = setup(() => { throw new Error(`decrypt failed for ${TOKEN}`) })
  const result = await failing.invoke()
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.equal(FakeWindow.created.length, 0)
})

test('pairing payload round-trips and rejects foreign or malformed codes without echoing the token', () => {
  const payload = encodePairingPayload({ repo: 'chenrui/mindflow-data', token: TOKEN })
  assert.deepEqual(decodePairingPayload(payload), { repo: 'chenrui/mindflow-data', branch: 'main', token: TOKEN })
  assert.deepEqual(decodePairingPayload(`  ${payload}\n`), { repo: 'chenrui/mindflow-data', branch: 'main', token: TOKEN })
  for (const bad of ['https://example.com', 'mindflow-pair:{', 'mindflow-pair:{"v":2}', `mindflow-pair:{"v":1,"repo":"no-slash","token":"${TOKEN}"}`, 'mindflow-pair:{"v":1,"repo":"a/b","token":"short"}']) {
    assert.throws(() => decodePairingPayload(bad), error => error.name === 'PairingError' && !error.message.includes(TOKEN))
  }
  assert.throws(() => encodePairingPayload({ repo: 'a/b', branch: '../x', token: TOKEN }), /分支/)
})

test('pairingWindowHtml escapes the repo name', () => {
  const html = pairingWindowHtml({ payload: encodePairingPayload({ repo: 'a/b', token: TOKEN }), repo: '<img src=x>' })
  assert.equal(html.includes('<img src=x>'), false)
  assert.match(html, /&lt;img src=x&gt;/)
})

test('a failed load closes the window and returns no details (the error text would contain the data: URL)', async () => {
  const env = setup()
  const original = FakeWindow.prototype.loadURL
  FakeWindow.prototype.loadURL = async function (url) { throw new Error(`ERR_ABORTED loading ${url.slice(0, 2048)}`) }
  try {
    const result = await env.invoke()
    assert.deepEqual(result, { ok: false, error: '無法顯示配對 QR，請再試一次。' })
    assert.equal(FakeWindow.created[0].destroyed, true)
  } finally {
    FakeWindow.prototype.loadURL = original
  }
})
