/**
 * 手機 App 的檔案備份：每 2 分鐘把 localStorage 的心智圖寫進 App 私有目錄（輪替 10 份，內容沒變不寫），
 * 儲存區整個不見時自動還原，並可匯出（分享）或從備份／檔案還原。
 * 備份格式與電腦版 desktop/backup-store.mjs 相同（version 1 + entries）。
 */
import {
  DOCUMENT_KEY_PREFIX,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  normalizeMindflowEntries
} from './backup-rules.mjs'
import { getCapacitorPlugin } from './capacitor-plugins.mjs'
import { assertSupportedDocument } from './sync-plan.mjs'

export const MOBILE_BACKUP_DIRECTORY = 'backups'
export const MOBILE_BACKUP_LIMIT = 10
export const MOBILE_BACKUP_INTERVAL_MS = 2 * 60_000
export const MOBILE_BACKUP_FS_DIRECTORY = 'DATA'
const EXPORT_FS_DIRECTORY = 'CACHE'
const HISTORY_KEY_PREFIX = 'mindflow.history.'

export function mobileBackupPaths(limit = MOBILE_BACKUP_LIMIT) {
  return Array.from({ length: limit }, (_, index) => (
    index === 0
      ? `${MOBILE_BACKUP_DIRECTORY}/mindflow-backup.json`
      : `${MOBILE_BACKUP_DIRECTORY}/mindflow-backup-${index}.json`
  ))
}

export function readStorageEntries(storage) {
  const entries = {}
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (typeof key !== 'string' || !key.startsWith('mindflow.')) continue
    const value = storage.getItem(key)
    if (typeof value === 'string') entries[key] = value
  }
  return entries
}

/** 解析一份備份（自動備份或匯出的檔案）；格式不對回傳 null。 */
export function parseBackupPayload(text) {
  let parsed
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null
  const entries = normalizeMindflowEntries(parsed.entries)
  if (!hasMindflowDocuments(entries)) return null
  return {
    version: 1,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    entries
  }
}

export function backupDocuments(entries) {
  const documents = []
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(DOCUMENT_KEY_PREFIX) || key.startsWith(HISTORY_KEY_PREFIX)) continue
    try {
      const document = JSON.parse(value)
      if (document && typeof document === 'object' && document.id === key.slice(DOCUMENT_KEY_PREFIX.length)) {
        documents.push({ key, raw: value, document })
      }
    } catch { /* 壞掉的單份文件略過，不影響其他文件還原 */ }
  }
  return documents
}

function contentHash(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${value.length}:${hash.toString(16)}`
}

function missingFile(error) {
  return /not exist|no such file|does not exist|not found|ENOENT/iu.test(String(error?.message || error))
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function formatBackupStamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '時間不明'
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * @param {object} options
 * @param {object} options.filesystem  Capacitor Filesystem（writeFile/readFile/stat/copy，可選 getUri）
 * @param {Storage} options.storage
 * @param {(source: object, title: string) => object} options.importCopy  以新 id 另存一份文件（store.js）
 */
export function createMobileBackupStore({
  filesystem,
  storage,
  importCopy,
  share = null,
  now = () => new Date(),
  limit = MOBILE_BACKUP_LIMIT,
  directory = MOBILE_BACKUP_FS_DIRECTORY
} = {}) {
  if (!filesystem || typeof filesystem.writeFile !== 'function') throw new TypeError('filesystem is required')
  if (!storage) throw new TypeError('storage is required')
  const paths = mobileBackupPaths(limit)
  let lastHash = null
  let queue = Promise.resolve()

  const exists = async path => {
    try {
      await filesystem.stat({ path, directory })
      return true
    } catch (error) {
      if (missingFile(error)) return false
      throw error
    }
  }

  const readText = async (path, fsDirectory = directory) => {
    try {
      const result = await filesystem.readFile({ path, directory: fsDirectory, encoding: 'utf8' })
      return typeof result?.data === 'string' ? result.data : null
    } catch (error) {
      if (missingFile(error)) return null
      throw error
    }
  }

  // 寫入一律排隊：計時器、進背景與手動匯出可能同時觸發，輪替不能交錯。
  const enqueue = task => {
    const run = queue.then(task, task)
    queue = run.catch(() => {})
    return run
  }

  async function initializeHash() {
    if (lastHash !== null) return
    const latest = parseBackupPayload(await readText(paths[0]))
    lastHash = latest ? contentHash(JSON.stringify(latest.entries)) : ''
  }

  function writeBackup({ reason = 'interval' } = {}) {
    return enqueue(async () => {
      const entries = normalizeMindflowEntries(readStorageEntries(storage))
      // 沒有文件就不寫：空白或只剩偏好設定的狀態不能把含資料的備份輪替掉。
      if (!hasMindflowDocuments(entries)) return null
      await initializeHash()
      const serialized = JSON.stringify(entries)
      const hash = contentHash(serialized)
      if (hash === lastHash) return null

      // 由舊到新反向複製，任何時刻至少仍留有一份可讀的上一版備份。
      for (let index = paths.length - 1; index >= 1; index -= 1) {
        if (await exists(paths[index - 1])) {
          await filesystem.copy({ from: paths[index - 1], to: paths[index], directory, toDirectory: directory })
        }
      }
      const payload = { version: 1, createdAt: now().toISOString(), reason, entries }
      await filesystem.writeFile({
        path: paths[0],
        data: JSON.stringify(payload),
        directory,
        encoding: 'utf8',
        recursive: true
      })
      lastHash = hash
      return { path: paths[0], createdAt: payload.createdAt }
    })
  }

  async function readBackup(path) {
    return parseBackupPayload(await readText(path))
  }

  async function readLatestBackup() {
    for (const path of paths) {
      const backup = await readBackup(path)
      if (backup) return { ...backup, path }
    }
    return null
  }

  async function listBackups() {
    const list = []
    for (const path of paths) {
      const backup = await readBackup(path)
      if (backup) list.push({ path, createdAt: backup.createdAt, reason: backup.reason, docCount: backupDocuments(backup.entries).length })
    }
    return list
  }

  /**
   * 儲存區整個不見（沒有索引也沒有文件）才自動還原；使用者刻意清空（空索引）不復活。
   * 回傳 true 代表已寫回 localStorage，呼叫端應重新載入頁面。
   */
  async function restoreLatestIfEmpty() {
    if (hasIntentionalMindflowState(readStorageEntries(storage))) return false
    const backup = await readLatestBackup()
    if (!backup) return false
    for (const [key, value] of Object.entries(backup.entries)) storage.setItem(key, value)
    lastHash = contentHash(JSON.stringify(backup.entries))
    return true
  }

  /**
   * 手動還原：備份裡的文件一律以「副本」加入（新 id），內容與現有文件完全相同的略過。
   * 不覆蓋、不刪除任何現有文件，所以不會讓同步把雲端較新的版本蓋掉或刪掉。
   */
  function restoreAsCopies(backup, { onCopy = () => {} } = {}) {
    if (typeof importCopy !== 'function') throw new TypeError('importCopy is required')
    const stamp = formatBackupStamp(backup.createdAt)
    let restored = 0
    let unchanged = 0
    let skipped = 0
    for (const { key, raw, document } of backupDocuments(backup.entries)) {
      if (storage.getItem(key) === raw) {
        unchanged += 1
        continue
      }
      try {
        assertSupportedDocument(raw, document.id)
      } catch {
        // 較新版本寫的文件這版讀不完整，還原會丟掉新格式資料：略過並回報。
        skipped += 1
        continue
      }
      const title = typeof document.title === 'string' && document.title.trim() ? document.title.trim() : '未命名'
      onCopy(importCopy(document, `${title}（備份還原 ${stamp}）`))
      restored += 1
    }
    return { restored, unchanged, skipped }
  }

  async function exportBackup() {
    const entries = normalizeMindflowEntries(readStorageEntries(storage))
    if (!hasMindflowDocuments(entries)) return { ok: false, error: '目前沒有可以匯出的心智圖。' }
    const created = now()
    const stamp = `${created.getFullYear()}${pad(created.getMonth() + 1)}${pad(created.getDate())}-${pad(created.getHours())}${pad(created.getMinutes())}${pad(created.getSeconds())}`
    const path = `exports/MindFlow-backup-${stamp}.json`
    const payload = { version: 1, createdAt: created.toISOString(), reason: 'export', entries }
    await filesystem.writeFile({ path, data: JSON.stringify(payload), directory: EXPORT_FS_DIRECTORY, encoding: 'utf8', recursive: true })
    if (!share || typeof filesystem.getUri !== 'function') {
      return { ok: false, error: '這個版本的 App 不支援分享檔案，請更新後再試。' }
    }
    const { uri } = await filesystem.getUri({ path, directory: EXPORT_FS_DIRECTORY })
    try {
      await share.share({ title: 'MindFlow 備份', files: [uri], dialogTitle: '匯出 MindFlow 備份' })
    } catch (error) {
      // 使用者在分享選單按取消不算錯誤
      if (/cancel/iu.test(String(error?.message || error))) return { ok: true, cancelled: true }
      throw error
    }
    return { ok: true, docCount: backupDocuments(entries).length }
  }

  return Object.freeze({
    paths,
    writeBackup,
    readBackup,
    readLatestBackup,
    listBackups,
    restoreLatestIfEmpty,
    restoreAsCopies,
    exportBackup
  })
}

/**
 * 在原生 App 裡啟動備份：先檢查是否需要自動還原（完成前不讓同步開始），再每 2 分鐘備份一次、進背景時也備份。
 * 回傳 { ready, store }；ready 解析為 false 表示照常啟動，已還原時頁面會重新載入、ready 不再解析。
 */
/** 自動還原後重新載入的頁面呼叫一次：回傳 true 表示剛從備份還原，應提示使用者。 */
export function consumeRestoredNotice(windowRef = globalThis.window) {
  try {
    if (windowRef?.sessionStorage?.getItem('mindflow.backup.restored') !== '1') return false
    windowRef.sessionStorage.removeItem('mindflow.backup.restored')
    return true
  } catch {
    return false
  }
}

export function startMobileBackups({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  filesystem = getCapacitorPlugin('Filesystem', ['writeFile', 'readFile', 'stat', 'copy'], windowRef),
  share = getCapacitorPlugin('Share', ['share'], windowRef),
  storage = windowRef?.localStorage,
  importCopy,
  intervalMs = MOBILE_BACKUP_INTERVAL_MS,
  setIntervalFn = globalThis.setInterval,
  reload = () => windowRef.location.reload()
} = {}) {
  if (!filesystem || !storage) return null
  const store = createMobileBackupStore({ filesystem, storage, share, importCopy })
  const backup = reason => store.writeBackup({ reason }).catch(error => console.error('MindFlow 手機備份失敗', error))

  const ready = store.restoreLatestIfEmpty().then(restored => {
    if (restored) {
      try { windowRef.sessionStorage?.setItem('mindflow.backup.restored', '1') } catch { /* 只影響提示 */ }
      reload()
      return new Promise(() => {})
    }
    void backup('startup')
    setIntervalFn(() => { void backup('interval') }, intervalMs)
    documentRef?.addEventListener?.('visibilitychange', () => {
      // 延到所有 visibilitychange 監聽者跑完：編輯器會在進背景時先存檔，備份要拿到存檔後的內容。
      if (documentRef.visibilityState === 'hidden') setTimeout(() => { void backup('hidden') }, 0)
    })
    return false
  }).catch(error => {
    console.error('MindFlow 備份還原檢查失敗', error)
    return false
  })
  return { ready, store }
}
