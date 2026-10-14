/**
 * Android App 生命週期：返回鍵與進背景時的存檔＋推送順序。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { getCapacitorPlugin } from '../js/capacitor-plugins.mjs'
import { EXIT_CONFIRM_WINDOW_MS, initializeMobileApp } from '../js/mobile-app.mjs'

class FakeApp {
  constructor({ minimize = true } = {}) {
    this.listeners = new Map()
    this.calls = []
    if (!minimize) delete this.minimizeApp
  }
  async addListener(name, listener) {
    this.listeners.set(name, listener)
    return { remove: async () => { this.listeners.delete(name) } }
  }
  async minimizeApp() { this.calls.push('minimize') }
  async exitApp() { this.calls.push('exit') }
  emit(name, payload) { this.listeners.get(name)?.(payload) }
}

class FakeDialog extends EventTarget {
  open = true
  close() { this.open = false; this.closed = true }
}

class FakeDocument extends EventTarget {
  visibilityState = 'visible'
  dialogs = []
  querySelectorAll(selector) {
    assert.equal(selector, 'dialog[open]')
    return this.dialogs.filter(dialog => dialog.open)
  }
}

function nativeWindow() {
  const windowRef = new EventTarget()
  windowRef.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }
  windowRef.location = { href: 'editor.html?id=doc_1' }
  windowRef.Event = Event
  return windowRef
}

function setup({ page = 'editor', onBack, canLeave, app = new FakeApp(), clock = { value: 0 } } = {}) {
  const windowRef = nativeWindow()
  const documentRef = new FakeDocument()
  const log = []
  const toasts = []
  const controller = initializeMobileApp({
    page,
    windowRef,
    documentRef,
    app,
    now: () => clock.value,
    saveNow: () => log.push('save'),
    getSyncApi: () => ({ flush: reason => log.push(`flush:${reason}`) }),
    onBack,
    canLeave,
    showToast: message => toasts.push(message)
  })
  return { controller, app, windowRef, documentRef, log, toasts, clock }
}

test('web and desktop builds get no mobile lifecycle', () => {
  const app = new FakeApp()
  assert.equal(initializeMobileApp({ page: 'editor', windowRef: new EventTarget(), documentRef: new FakeDocument(), app }), null)
  assert.equal(app.listeners.size, 0)
})

test('editor back button: closes an open dialog first, then ends text editing, then saves, pushes and goes home', async () => {
  let editing = true
  const env = setup({ onBack: () => { if (!editing) return false; editing = false; return true } })
  await env.controller.ready
  const dialog = new FakeDialog()
  env.documentRef.dialogs.push(dialog)

  env.app.emit('backButton', { canGoBack: false })
  assert.equal(dialog.closed, true)
  assert.deepEqual(env.log, [])

  env.app.emit('backButton', { canGoBack: false })
  assert.equal(editing, false, '第二下結束文字編輯（commit，不是取消）')
  assert.equal(env.windowRef.location.href, 'editor.html?id=doc_1')

  env.app.emit('backButton', { canGoBack: false })
  assert.deepEqual(env.log, ['save', 'flush:back-button'], '先存檔再推送')
  assert.equal(env.windowRef.location.href, 'index.html')
})

test('a dialog that cancels its own close keeps the back button from navigating', async () => {
  const env = setup()
  await env.controller.ready
  const dialog = new FakeDialog()
  dialog.addEventListener('cancel', event => event.preventDefault())
  env.documentRef.dialogs.push(dialog)
  env.app.emit('backButton', {})
  assert.equal(dialog.closed, undefined)
  assert.equal(env.windowRef.location.href, 'editor.html?id=doc_1')
})

test('dashboard back button needs a second press within 2 seconds, then minimizes after pushing', async () => {
  const env = setup({ page: 'dashboard' })
  await env.controller.ready
  env.app.emit('backButton', {})
  assert.equal(env.toasts.length, 1)
  assert.deepEqual(env.app.calls, [])

  env.clock.value += EXIT_CONFIRM_WINDOW_MS + 1
  env.app.emit('backButton', {})
  assert.equal(env.toasts.length, 2, '超過 2 秒要重新確認')
  assert.deepEqual(env.app.calls, [])

  env.clock.value += 500
  env.app.emit('backButton', {})
  await Promise.resolve()
  assert.deepEqual(env.log, ['flush:exit'])
  assert.deepEqual(env.app.calls, ['minimize'])
})

test('older App plugins without minimizeApp fall back to exitApp', async () => {
  const app = new FakeApp({ minimize: false })
  app.minimizeApp = undefined
  const env = setup({ page: 'dashboard', app })
  await env.controller.ready
  env.app.emit('backButton', {})
  env.app.emit('backButton', {})
  await Promise.resolve()
  assert.deepEqual(app.calls, ['exit'])
})

test('pausing the app saves and pushes immediately (appStateChange, visibilitychange and pagehide)', async () => {
  const env = setup()
  await env.controller.ready
  env.app.emit('appStateChange', { isActive: true })
  assert.deepEqual(env.log, [])
  env.app.emit('appStateChange', { isActive: false })
  assert.deepEqual(env.log, ['save', 'flush:app-pause'])

  env.documentRef.visibilityState = 'hidden'
  env.documentRef.dispatchEvent(new Event('visibilitychange'))
  env.windowRef.dispatchEvent(new Event('pagehide'))
  assert.deepEqual(env.log, ['save', 'flush:app-pause', 'save', 'flush:hidden', 'save', 'flush:pagehide'])

  await env.controller.dispose()
  assert.equal(env.app.listeners.size, 0)
  env.windowRef.dispatchEvent(new Event('pagehide'))
  assert.equal(env.log.length, 6, 'dispose 後不再監聽')
})

test('a failing save still pushes whatever is already stored', async () => {
  const windowRef = nativeWindow()
  const app = new FakeApp()
  const log = []
  const originalError = console.error
  console.error = () => {}
  try {
    const controller = initializeMobileApp({
      page: 'editor', windowRef, documentRef: new FakeDocument(), app,
      saveNow: () => { throw new Error('quota') },
      getSyncApi: () => ({ flush: reason => log.push(reason) })
    })
    await controller.ready
    app.emit('appStateChange', { isActive: false })
    assert.deepEqual(log, ['app-pause'])
  } finally {
    console.error = originalError
  }
})

test('getCapacitorPlugin only returns plugins the native side really has', () => {
  const app = { addListener() {} }
  const windowRef = {
    Capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: name => name === 'App',
      Plugins: { App: app },
      registerPlugin: () => new Proxy({}, { get: () => () => {} })
    }
  }
  assert.equal(getCapacitorPlugin('App', ['addListener'], windowRef), app)
  assert.equal(getCapacitorPlugin('Filesystem', ['writeFile'], windowRef), null)
  assert.equal(getCapacitorPlugin('App', ['addListener'], {}), null)
})

test('scanPairingCode: unsupported device, first-time module download, cancel, foreign QR, success', async () => {
  const { scanPairingCode } = await import('../js/mobile-settings.mjs')
  const { encodePairingPayload } = await import('../js/pairing.mjs')
  const token = 'TEST-ONLY-NOT-A-REAL-TOKEN-scan-0123456789'
  const payload = encodePairingPayload({ repo: 'chenrui/mindflow-data', branch: 'sync', token })
  const scanner = overrides => ({
    isSupported: async () => ({ supported: true }),
    isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
    installGoogleBarcodeScannerModule: async () => {},
    scan: async options => {
      assert.deepEqual(options, { formats: ['QR_CODE'] })
      return { barcodes: [{ rawValue: payload }] }
    },
    ...overrides
  })

  await assert.rejects(scanPairingCode({ scanner: null }), { name: 'PairingError' })
  await assert.rejects(scanPairingCode({ scanner: scanner({ isSupported: async () => ({ supported: false }) }) }), { name: 'PairingError' })

  let installs = 0
  assert.deepEqual(await scanPairingCode({ scanner: scanner({
    isGoogleBarcodeScannerModuleAvailable: async () => ({ available: false }),
    installGoogleBarcodeScannerModule: async () => { installs += 1 },
    scan: async () => assert.fail('元件還沒下載好不能開掃描')
  }) }), { status: 'installing' })
  assert.equal(installs, 1)

  assert.deepEqual(await scanPairingCode({ scanner: scanner({ scan: async () => { throw new Error('scan canceled.') } }) }), { status: 'cancelled' })
  assert.deepEqual(await scanPairingCode({ scanner: scanner({ scan: async () => ({ barcodes: [] }) }) }), { status: 'cancelled' })
  await assert.rejects(
    scanPairingCode({ scanner: scanner({ scan: async () => ({ barcodes: [{ rawValue: 'https://example.com' }] }) }) }),
    error => error.name === 'PairingError' && !error.message.includes(token)
  )
  assert.deepEqual(await scanPairingCode({ scanner: scanner() }), {
    status: 'ok',
    pairing: { repo: 'chenrui/mindflow-data', branch: 'sync', token }
  })
})

test('審查 HIGH 3：存檔被擋住（衝突橫幅或空間不足）時返回鍵不離開編輯器', async () => {
  let blocked = true
  const env = setup({ canLeave: () => !blocked })
  await env.controller.ready
  env.app.emit('backButton', {})
  assert.deepEqual(env.log, ['save', 'flush:back-button'], '仍然先嘗試存檔與推送')
  assert.equal(env.windowRef.location.href, 'editor.html?id=doc_1', '沒存好就不離開')
  assert.match(env.toasts.at(-1), /沒有存好/)
  blocked = false
  env.app.emit('backButton', {})
  assert.equal(env.windowRef.location.href, 'index.html')
})
