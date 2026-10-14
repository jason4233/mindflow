import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveStaticRoot } from './app-paths.mjs'
import {
  BACKUP_INTERVAL_MS,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  readLatestMindflowBackup,
  writeMindflowBackup
} from './backup-store.mjs'
import {
  discoverLegacyOrigins,
  mergeLegacyMindflowEntries,
  readLegacyOriginEntries
} from './legacy-storage.mjs'
import {
  APP_HOST,
  APP_SCHEME,
  APP_START_URL,
  createProtocolHandler
} from './protocol.mjs'
import { registerSyncBridgeIpc } from './sync-bridge.mjs'
import {
  getDecryptedToken,
  loadSyncSettings
} from './sync-settings.mjs'
import { registerPairingIpc } from './pairing-window.mjs'
import { initUpdater } from './updater.mjs'
import { bringWindowToFront } from './window-focus.mjs'

const DESKTOP_DIR = dirname(fileURLToPath(import.meta.url))
const APP_URL_PREFIX = `${APP_SCHEME}://${APP_HOST}/`

// 煙霧測試用完即丟的 userData，避免測試把使用者真正的十份備份輪替掉。必須在 ready 前設定。
if (process.env.MINDFLOW_USER_DATA_DIR) {
  app.setPath('userData', resolve(process.env.MINDFLOW_USER_DATA_DIR))
}

// 必須在 ready 前宣告為 standard scheme，relative URL、ES modules 與 localStorage 才共享固定 origin。
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}])

const CLOSE_FLUSH_TIMEOUT_MS = 10_000

let mainWindow = null
let backupTimer = null
let syncIpcRegistration = null
let pairingIpcRegistration = null
// 備份一次只跑一個（計時器、關窗可能同時觸發）。
let backupChain = Promise.resolve()
let allowWindowClose = false
let closeInProgress = false

function rendererStorageScript({ flush = false } = {}) {
  return `(() => {
    ${flush ? "window.dispatchEvent(new Event('beforeunload'));" : ''}
    return Object.fromEntries(
      Object.keys(localStorage)
        .filter(key => key.startsWith('mindflow.'))
        .sort()
        .map(key => [key, localStorage.getItem(key)])
    );
  })()`
}

async function captureMindflowStorage(window, { flush = false } = {}) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return {}
  return window.webContents.executeJavaScript(rendererStorageScript({ flush }), true)
}

async function restoreRendererStorage(window, entries) {
  const serialized = JSON.stringify(JSON.stringify(entries))
  return window.webContents.executeJavaScript(`(() => {
    const entries = JSON.parse(${serialized});
    for (const [key, value] of Object.entries(entries)) {
      if (key.startsWith('mindflow.') && typeof value === 'string') localStorage.setItem(key, value);
    }
    return Object.keys(entries).length;
  })()`, true)
}

async function reloadWindow(window) {
  const finished = new Promise((resolve, reject) => {
    const onFinish = () => {
      cleanup()
      resolve()
    }
    const onFailure = (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return
      cleanup()
      reject(new Error(`Reload failed (${code}): ${description} at ${url}`))
    }
    const cleanup = () => {
      window.webContents.off('did-finish-load', onFinish)
      window.webContents.off('did-fail-load', onFailure)
    }
    window.webContents.once('did-finish-load', onFinish)
    window.webContents.on('did-fail-load', onFailure)
  })
  window.webContents.reload()
  await finished
}

async function showRendererToast(window, message) {
  const serialized = JSON.stringify(String(message))
  await window.webContents.executeJavaScript(`(() => {
    const toast = document.querySelector('#dashboard-toast') || document.querySelector('[data-mindflow-toast]');
    if (!toast) return false;
    toast.textContent = ${serialized};
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 4200);
    return true;
  })()`, true)
}

async function restoreLatestBackupIfEmpty(window, userDataPath) {
  const current = await captureMindflowStorage(window)
  // 索引消失或損毀、且文件掉光才發動救援；偏好設定殘留不阻止還原，
  // 但使用者刻意清空（合法空索引）不得被自動復活。
  if (hasIntentionalMindflowState(current)) return false

  const backup = await readLatestMindflowBackup({ userDataPath })
  if (!backup) return false
  await restoreRendererStorage(window, backup.entries)
  await reloadWindow(window)
  await showRendererToast(window, '已從備份還原')
  return true
}

async function migrateLegacyStorageIfEmpty(window, userDataPaths) {
  const current = await captureMindflowStorage(window)
  if (hasIntentionalMindflowState(current)) return 0

  const origins = await discoverLegacyOrigins(userDataPaths)
  const candidates = await readLegacyOriginEntries(window.webContents, origins)
  const merged = mergeLegacyMindflowEntries(candidates)
  // 索引存在但零文件不算遷移成功，否則會吃掉後面的備份還原機會。
  if (!hasMindflowDocuments(merged)) return 0

  const importedCount = await restoreRendererStorage(window, merged)
  await reloadWindow(window)
  await showRendererToast(window, '已匯入舊版 MindFlow 資料')
  return importedCount
}

function enqueueBackup(window, userDataPath, { flush = false, reason = 'interval' } = {}) {
  const run = backupChain.then(async () => {
    const entries = await captureMindflowStorage(window, { flush })
    return writeMindflowBackup({ userDataPath, entries, reason })
  })
  backupChain = run.catch(() => {})
  return run
}

// M2a 起同步引擎在 renderer：關窗前請它把等待中的修改推上去（有逾時，不能讓視窗關不掉）。
function flushRendererSync(window) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve()
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(resolve, CLOSE_FLUSH_TIMEOUT_MS) })
  const flush = window.webContents
    .executeJavaScript('window.__mindflowSyncFlush ? window.__mindflowSyncFlush() : null', true)
    .catch(error => console.error('MindFlow close flush failed:', error?.message || error))
  return Promise.race([flush, timeout]).finally(() => clearTimeout(timer))
}

function urlProtocol(url) {
  try {
    return new URL(url).protocol
  } catch {
    return ''
  }
}

function bindNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 匯出列印靠 window.open('', '_blank') 拿到 about:blank 視窗，擋掉等於拿掉列印功能。
    // 空字串 URL 在 Chromium 內部不會被補成文件網址，Electron 兩種形式都可能回報，都要放行。
    if (url === '' || url === 'about:blank') return { action: 'allow' }
    if (['http:', 'https:'].includes(urlProtocol(url))) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_URL_PREFIX)) return
    event.preventDefault()
    if (['http:', 'https:'].includes(urlProtocol(url))) void shell.openExternal(url)
  })

  // 這個離線應用不需要任何裝置權限；一律拒絕，網頁分屏也拿不到定位或相機。
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

function bindCloseFlush(window, userDataPath) {
  window.on('close', event => {
    if (allowWindowClose) return
    event.preventDefault()
    if (closeInProgress) return
    closeInProgress = true
    clearInterval(backupTimer)
    backupTimer = null

    // 先讓編輯器存檔並寫備份（flush 會觸發 beforeunload），再請 renderer 的同步引擎推送。
    void enqueueBackup(window, userDataPath, { flush: true, reason: 'window-close' })
      .catch(error => console.error('MindFlow close backup failed:', error))
      .then(() => flushRendererSync(window))
      .finally(() => {
        allowWindowClose = true
        if (!window.isDestroyed()) window.close()
      })
  })
}

async function launch() {
  const root = resolveStaticRoot({
    isPackaged: app.isPackaged,
    desktopDir: DESKTOP_DIR,
    resourcesPath: process.resourcesPath
  })
  await protocol.handle(APP_SCHEME, createProtocolHandler({ root }))

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'MindFlow',
    icon: join(DESKTOP_DIR, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(DESKTOP_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('page-title-updated', event => event.preventDefault())
  bindNavigationGuards(mainWindow)

  const userDataPath = app.getPath('userData')
  const legacyUserDataPaths = [
    userDataPath,
    join(app.getPath('appData'), 'mindflow-desktop'),
    join(app.getPath('appData'), 'MindFlow')
  ]
  let markStartupReady
  const startupReady = new Promise(resolve => { markStartupReady = resolve })
  // 同步引擎在 renderer；main 只保管加密的 PAT、代理 GitHub 請求，並在啟動救援完成後才放行同步。
  syncIpcRegistration = registerSyncBridgeIpc({
    ipcMain,
    userDataPath,
    startupReady,
    // 只在開發模式允許指向本機的假 GitHub 伺服器做端到端測試；安裝版一律是 api.github.com。
    ...(!app.isPackaged && process.env.MINDFLOW_GITHUB_API_BASE ? { apiBase: process.env.MINDFLOW_GITHUB_API_BASE } : {})
  })
  // 配對 QR 在 main process 讀出並解密 PAT、直接畫在獨立視窗；renderer 只會收到 { ok }。
  pairingIpcRegistration = registerPairingIpc({
    ipcMain,
    BrowserWindow,
    getParent: () => mainWindow,
    getPairing: () => {
      const settings = loadSyncSettings(userDataPath)
      return { repo: settings.repo, branch: settings.branch, token: getDecryptedToken(settings) || '' }
    }
  })
  bindCloseFlush(mainWindow, userDataPath)
  mainWindow.once('closed', () => {
    clearInterval(backupTimer)
    backupTimer = null
    syncIpcRegistration?.dispose()
    syncIpcRegistration = null
    pairingIpcRegistration?.dispose()
    pairingIpcRegistration = null
    mainWindow = null
    app.quit()
  })

  await mainWindow.loadURL(APP_START_URL)

  try {
    const imported = await migrateLegacyStorageIfEmpty(mainWindow, legacyUserDataPaths)
    if (!imported) await restoreLatestBackupIfEmpty(mainWindow, userDataPath)
  } catch (error) {
    // 救援失敗不可阻擋主程式；錯誤留在 log，後續 2 分鐘備份仍會運作。
    console.error('MindFlow startup recovery failed:', error)
  }

  try {
    await enqueueBackup(mainWindow, userDataPath, { reason: 'startup' })
  } catch (error) {
    // 開機備份失敗只降級，不能讓整個 app 起不來——使用者的資料還在 localStorage 裡。
    console.error('MindFlow startup backup failed:', error)
  }

  backupTimer = setInterval(() => {
    void enqueueBackup(mainWindow, userDataPath, { reason: 'interval' })
      .catch(error => console.error('MindFlow interval backup failed:', error))
  }, BACKUP_INTERVAL_MS)

  // renderer 的同步引擎等這一刻才開始：legacy migration 與 backup restore 都完成後才可讀本機。
  markStartupReady()
  void initUpdater(mainWindow).catch(() => {})
}

// 第二個實例會用同一份 localStorage 與同一組備份檔，兩邊各寫各的必然互相覆蓋；只准一個。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    bringWindowToFront(mainWindow)
  })

  app.whenReady()
    .then(launch)
    .catch(error => {
      console.error('MindFlow desktop failed to start:', error)
      app.exit(1)
    })
}
