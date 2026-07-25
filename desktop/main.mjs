import { app, BrowserWindow, protocol } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveStaticRoot } from './app-paths.mjs'
import {
  BACKUP_INTERVAL_MS,
  readLatestMindflowBackup,
  writeMindflowBackup
} from './backup-store.mjs'
import {
  discoverLegacyOrigins,
  mergeLegacyMindflowEntries,
  readLegacyOriginEntries
} from './legacy-storage.mjs'
import {
  APP_SCHEME,
  APP_START_URL,
  createProtocolHandler
} from './protocol.mjs'

const DESKTOP_DIR = dirname(fileURLToPath(import.meta.url))
const CLOSE_FLUSH_TIMEOUT_MS = 8000

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

let mainWindow = null
let backupTimer = null
let backupQueue = Promise.resolve()
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
  if (Object.keys(current).length !== 0) return false

  const backup = await readLatestMindflowBackup({ userDataPath })
  if (!backup) return false
  await restoreRendererStorage(window, backup.entries)
  await reloadWindow(window)
  await showRendererToast(window, '已從備份還原')
  return true
}

async function migrateLegacyStorageIfEmpty(window, userDataPaths) {
  const current = await captureMindflowStorage(window)
  if (Object.keys(current).length !== 0) return 0

  const origins = await discoverLegacyOrigins(userDataPaths)
  const candidates = await readLegacyOriginEntries(window.webContents, origins)
  const merged = mergeLegacyMindflowEntries(candidates)
  if (!merged['mindflow.docs.index']) return 0

  const importedCount = await restoreRendererStorage(window, merged)
  await reloadWindow(window)
  await showRendererToast(window, '已匯入舊版 MindFlow 資料')
  return importedCount
}

function enqueueBackup(window, userDataPath, { flush = false, reason = 'interval' } = {}) {
  backupQueue = backupQueue
    .catch(() => {})
    .then(async () => {
      const entries = await captureMindflowStorage(window, { flush })
      return writeMindflowBackup({ userDataPath, entries, reason })
    })
  return backupQueue
}

async function withTimeout(promise, timeoutMs) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function bindCloseFlush(window, userDataPath) {
  window.on('close', event => {
    if (allowWindowClose) return
    event.preventDefault()
    if (closeInProgress) return
    closeInProgress = true
    clearInterval(backupTimer)
    backupTimer = null

    void withTimeout(
      enqueueBackup(window, userDataPath, { flush: true, reason: 'window-close' }),
      CLOSE_FLUSH_TIMEOUT_MS
    )
      .catch(error => console.error('MindFlow close backup failed:', error))
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('page-title-updated', event => event.preventDefault())

  const userDataPath = app.getPath('userData')
  const legacyUserDataPaths = [
    userDataPath,
    join(app.getPath('appData'), 'mindflow-desktop'),
    join(app.getPath('appData'), 'MindFlow')
  ]
  bindCloseFlush(mainWindow, userDataPath)
  mainWindow.once('closed', () => {
    clearInterval(backupTimer)
    backupTimer = null
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

  await enqueueBackup(mainWindow, userDataPath, { reason: 'startup' })
  backupTimer = setInterval(() => {
    void enqueueBackup(mainWindow, userDataPath, { reason: 'interval' })
      .catch(error => console.error('MindFlow interval backup failed:', error))
  }, BACKUP_INTERVAL_MS)
}

app.whenReady()
  .then(launch)
  .catch(error => {
    console.error('MindFlow desktop failed to start:', error)
    app.exit(1)
  })
