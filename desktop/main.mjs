import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveStaticRoot } from './app-paths.mjs'
import {
  BACKUP_INTERVAL_MS,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  clearRestorePending,
  ensureRestoreSourceProtected,
  markRestorePending,
  preserveFailedRestoreSource,
  readLatestMindflowBackup,
  rendererRestoreScript,
  restoreScriptOutcome,
  writeMindflowBackup
} from './backup-store.mjs'
import { newStoreEpoch } from './sync-plan.mjs'
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
import {
  createRendererStorageAdapter,
  createStorageQueue,
  createSyncEngine,
  registerSyncIpc
} from './sync-engine.mjs'
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

let mainWindow = null
let backupTimer = null
// 還原失敗、還沒另存成功的來源備份路徑（見 protectPendingRestoreSource）
let pendingRestoreSource = null
const storageQueue = createStorageQueue()
let syncEngine = null
let syncIpcRegistration = null
let pairingIpcRegistration = null
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

// 備份還原與舊資料搬入共用：寫入前先換掉本機儲存區識別碼，讓同步不信任較新的 base（見 rendererRestoreScript）。
async function restoreRendererStorage(window, entries) {
  return restoreScriptOutcome(await window.webContents.executeJavaScript(rendererRestoreScript(entries, { storeEpoch: newStoreEpoch() }), true))
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

// preservedBackupPath：字串＝另存成功的位置；null＝備份還原失敗且另存也失敗；undefined＝舊資料搬入失敗（來源沒被動到）
async function showRecoveryFailedDialog(window, { preservedBackupPath, rollbackIncomplete = false } = {}) {
  if (!window || window.isDestroyed()) return
  const where = preservedBackupPath
    ? `還沒救回的那份備份已另存在：\n${preservedBackupPath}`
    : preservedBackupPath === null
      ? `備份檔仍在：\n${join(app.getPath('userData'), 'backups')}\n（另存失敗，空間恢復前會暫停本機備份的輪替，避免把它擠掉）`
      : '舊版 MindFlow 的資料沒有被動到。'
  const partial = rollbackIncomplete ? '\n撤回沒有完全成功：首頁可能只出現部分文件，其餘仍在上面的備份裡。' : ''
  await dialog.showMessageBox(window, {
    type: 'warning',
    title: 'MindFlow',
    message: '本機資料不見了，但自動還原失敗',
    detail: `可能是儲存空間不足。已寫入的部分已撤回。${partial}\n${where}\n請清出空間後重新開啟 MindFlow，會再自動還原一次；若同步已先把雲端的文件拉回來，只存在備份裡的文件需要從上面的位置找回。`
  }).catch(() => {})
}

async function restoreLatestBackupIfEmpty(window, userDataPath) {
  const current = await captureMindflowStorage(window)
  // 索引消失或損毀、且文件掉光才發動救援；偏好設定殘留不阻止還原，
  // 但使用者刻意清空（合法空索引）不得被自動復活。
  if (hasIntentionalMindflowState(current)) return false

  const backup = await readLatestMindflowBackup({ userDataPath })
  if (!backup) return false
  // 先記下這份來源：還原若失敗、另存又失敗，之後的備份輪替會先停下來（跨重開也有效）。
  // 記錄本身也可能因磁碟滿而失敗，所以同時記在記憶體裡，這次開啟期間一樣暫停輪替。
  pendingRestoreSource = backup.path
  await markRestorePending({ userDataPath, sourcePath: backup.path })
    .catch(error => console.error('MindFlow could not record the pending restore source:', error))
  let restored
  try {
    restored = await restoreRendererStorage(window, backup.entries)
  } catch (error) {
    // 還原腳本已回滾（回滾沒完成時錯誤上有 rollbackIncomplete）；來源另存到不會被輪替的檔名，成功才解除暫停
    const protection = await protectPendingRestoreSource(userDataPath)
    error.preservedBackupPath = protection.path
    throw error
  }
  pendingRestoreSource = null
  await clearRestorePending({ userDataPath }).catch(() => {})
  // 讀備份期間使用者已新建文件（或同步已拉回內容）：腳本取消了還原，不重新載入
  if (!restored) return false
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
  // 讀舊資料期間使用者已新建文件：腳本取消了搬入，不重新載入（呼叫端也不會再接著還原備份）
  if (!importedCount) return 0
  await reloadWindow(window)
  await showRendererToast(window, '已匯入舊版 MindFlow 資料')
  return importedCount
}

// 還原失敗、來源還沒另存成功：保護好之前，開機、定期、關窗的備份都不輪替（同步照常）。
async function protectPendingRestoreSource(userDataPath) {
  let path = null
  if (pendingRestoreSource) {
    try {
      path = await preserveFailedRestoreSource({ userDataPath, sourcePath: pendingRestoreSource })
      pendingRestoreSource = null
      await clearRestorePending({ userDataPath })
    } catch {
      return { ok: false, path: null }
    }
  }
  const pending = await ensureRestoreSourceProtected({ userDataPath })
  return { ok: pending.ok, path: path || pending.path }
}

function enqueueBackup(window, userDataPath, { flush = false, reason = 'interval' } = {}) {
  return storageQueue.run(async () => {
      const entries = await captureMindflowStorage(window, { flush })
      return writeMindflowBackup({ userDataPath, entries, reason, protectRestoreSource: () => protectPendingRestoreSource(userDataPath) })
  })
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

function bindCloseFlush(window, userDataPath, engine) {
  window.on('close', event => {
    if (allowWindowClose) return
    event.preventDefault()
    if (closeInProgress) return
    closeInProgress = true
    clearInterval(backupTimer)
    backupTimer = null

    void engine.flush({
      beforeSync: () => enqueueBackup(window, userDataPath, { flush: true, reason: 'window-close' })
    })
      .catch(error => console.error('MindFlow close flush failed:', error))
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
  const rendererStorage = createRendererStorageAdapter(mainWindow)
  const savedSyncSettings = loadSyncSettings(userDataPath)
  let token = ''
  try {
    token = getDecryptedToken(savedSyncSettings) || ''
  } catch (error) {
    // 加密金鑰不可用時不做任何 fallback；也不把密文或 token 寫入 log。
    console.error('MindFlow secure sync token is unavailable:', error?.message || 'secure storage unavailable')
  }
  // 開機救援（舊資料搬入／備份還原）結束前，聚焦、手動、設定觸發的同步都先等：同步若先拉回內容，
  // 救援的空庫檢查與寫入之間就會被插隊。
  let releaseRecoveryGate
  const recoveryGate = new Promise(resolve => { releaseRecoveryGate = resolve })
  syncEngine = createSyncEngine({
    userDataPath,
    storageQueue,
    startGate: recoveryGate,
    cfg: {
      enabled: savedSyncSettings.enabled,
      repo: savedSyncSettings.repo,
      branch: savedSyncSettings.branch,
      token
    },
    readEntries: options => rendererStorage.readEntries(options),
    applyWrites: writes => rendererStorage.applyWrites(writes)
  })
  syncIpcRegistration = registerSyncIpc({
    ipcMain,
    engine: syncEngine,
    webContents: mainWindow.webContents,
    userDataPath
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
  bindCloseFlush(mainWindow, userDataPath, syncEngine)
  mainWindow.on('focus', () => syncEngine?.handleFocus())
  mainWindow.once('closed', () => {
    clearInterval(backupTimer)
    backupTimer = null
    syncIpcRegistration?.dispose()
    syncIpcRegistration = null
    pairingIpcRegistration?.dispose()
    pairingIpcRegistration = null
    void syncEngine?.dispose()
    syncEngine = null
    mainWindow = null
    app.quit()
  })

  await mainWindow.loadURL(APP_START_URL)

  try {
    const imported = await migrateLegacyStorageIfEmpty(mainWindow, legacyUserDataPaths)
    if (!imported) await restoreLatestBackupIfEmpty(mainWindow, userDataPath)
  } catch (error) {
    // 救援失敗不可阻擋主程式，但不能跟「不需要救援」混成同一個結果：明確告訴使用者。
    // 還原腳本已回滾，來源備份已另存成不會被輪替的檔案，後續 2 分鐘備份照常運作。
    console.error('MindFlow startup recovery failed:', error)
    void showRecoveryFailedDialog(mainWindow, {
      preservedBackupPath: error?.preservedBackupPath,
      rollbackIncomplete: error?.rollbackIncomplete === true
    })
  } finally {
    releaseRecoveryGate()
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

  // startup sync 必須在 legacy migration 與 backup restore 都完成後才可讀 renderer。
  syncEngine.start({ startup: true })
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
