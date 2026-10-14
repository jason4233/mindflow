/**
 * 手機 App 的檔案備份：每 2 分鐘把 localStorage 的心智圖寫進 App 私有目錄（輪替 10 份，內容沒變不寫），
 * 儲存區整個不見時自動還原，並可匯出（分享）或從備份／檔案還原。
 * 備份格式與電腦版 desktop/backup-store.mjs 相同（version 1 + entries）。
 */
import {
  DOCUMENT_INDEX_KEY,
  DOCUMENT_KEY_PREFIX,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  normalizeMindflowEntries
} from './backup-rules.mjs'
import { getCapacitorPlugin } from './capacitor-plugins.mjs'
import { STORE_EPOCH_KEY, assertSupportedDocument, newStoreEpoch } from './sync-plan.mjs'

export const MOBILE_BACKUP_DIRECTORY = 'backups'
export const MOBILE_BACKUP_LIMIT = 10
export const MOBILE_BACKUP_INTERVAL_MS = 2 * 60_000
export const MOBILE_BACKUP_FS_DIRECTORY = 'DATA'
// 自動還原失敗時另存的備份：不在輪替名單裡，定期備份不會把它擠掉；一律不覆蓋不同的內容，
// 不同次的失敗依序存到下一個位置（restore-failed.json、restore-failed-2.json …）
const RESTORE_FAILED_PATHS = [
  `${MOBILE_BACKUP_DIRECTORY}/restore-failed.json`,
  ...Array.from({ length: 9 }, (_, index) => `${MOBILE_BACKUP_DIRECTORY}/restore-failed-${index + 2}.json`)
]
// 還原失敗、來源還沒另存成功時記下來源；保護好之前暫停輪替
const RESTORE_PENDING_PATH = `${MOBILE_BACKUP_DIRECTORY}/restore-pending.json`
const RESTORE_FAILED_NOTICE_KEY = 'mindflow.backup.restoreFailed'
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

// Capacitor Filesystem 8：檔案不存在是 code OS-PLUG-FILE-0008、訊息 "... does not exist."
function missingFile(error) {
  if (error?.code === 'OS-PLUG-FILE-0008') return true
  return /not exist|no such file|does not exist|not found|ENOENT/iu.test(String(error?.message || error))
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * 本機讀不到文件索引（不存在或損壞）時清掉本機儲存區識別碼；回傳是否讀不到索引。
 * 同步過的儲存區一定有索引，讀不到就是本機資料遺失。識別碼留著的話，同步會信任舊 base，
 * 把本機少掉的文件當成本機刪除推上雲端：不管有沒有備份可還原、還原成不成功、使用者有沒有先建了新文件。
 * 清掉後下一次同步是首次同步（只做聯集）；之後還原或同步成功會再寫入新的識別碼。
 * 要在偵測的當下、await 任何東西之前呼叫，免得中間使用者先建了文件。
 * 先 removeItem（不受空間限制），再盡量寫一個新的隨機識別碼：只移除的話，升級前沒有識別碼的 base
 * 在「本機也沒有標記」時，只要 base 的文件 key 都還在（例如索引不見、內容都在）仍會被信任一次（M1-A15）。
 */
export function forgetStoreEpochIfStorageLost(storage) {
  let readable = false
  try {
    const parsed = JSON.parse(storage.getItem(DOCUMENT_INDEX_KEY))
    readable = Boolean(parsed && typeof parsed === 'object')
  } catch { /* 損壞的索引和不存在一樣 */ }
  if (readable) return false
  try {
    storage.removeItem(STORE_EPOCH_KEY)
  } catch (error) {
    console.error('MindFlow could not clear the local store epoch', error)
  }
  try { storage.setItem(STORE_EPOCH_KEY, newStoreEpoch()) } catch { /* 空間不足：維持移除的狀態 */ }
  return true
}

/**
 * 自動還原失敗時要丟出的錯誤：回滾沒完成就標 rollbackIncomplete。丟出的值掛不上旗標時
 * （原始值、null、不可擴充的物件）改丟一個帶 cause 的新 Error。回滾與來源保護都做完才呼叫。
 */
function restoreFailure(error, rollbackIncomplete) {
  if (!rollbackIncomplete) return error
  try {
    error.rollbackIncomplete = true
    if (error.rollbackIncomplete === true) return error
  } catch { /* 掛不上旗標 */ }
  const wrapped = new Error('MindFlow backup restore failed and the rollback was incomplete', { cause: error })
  wrapped.rollbackIncomplete = true
  return wrapped
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
  // 還原失敗、還沒另存成功的來源（也寫在 restore-pending.json，跨重開有效）
  let pendingRestoreSource = null
  const parseJsonText = text => {
    try { return typeof text === 'string' ? JSON.parse(text) : null } catch { return null }
  }

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
      // 還原失敗、來源還沒另存成功：這一次不輪替（同步照常）
      if (!(await ensureRestoreSourceProtected())) return null

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
    for (const path of RESTORE_FAILED_PATHS) {
      const preserved = await readBackup(path)
      if (preserved) {
        list.push({ path, createdAt: preserved.createdAt, reason: preserved.reason, docCount: backupDocuments(preserved.entries).length, preserved: true })
      }
    }
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
    // 偵測的當下、await 之前：讀不到索引就先清掉識別碼（沒有備份、還原失敗或使用者先建文件時，同步都不信任舊 base）
    forgetStoreEpochIfStorageLost(storage)
    if (hasIntentionalMindflowState(readStorageEntries(storage))) return false
    const backup = await readLatestBackup()
    if (!backup) return false
    // 先記下這份來源：還原若失敗、另存又失敗，之後的備份輪替會先停下來（跨重開也有效）。
    // 記錄本身也可能因空間不足而失敗，所以同時記在記憶體裡，這次開啟期間一樣暫停輪替。
    pendingRestoreSource = backup.path
    await writePendingMarker(backup.path).catch(() => {})
    // 讀備份與記錄的這段時間使用者可能已經新增了文件：寫入前在同一段執行裡再確認一次，免得備份的索引蓋掉新文件。
    if (hasIntentionalMindflowState(readStorageEntries(storage))) {
      pendingRestoreSource = null
      await writePendingMarker(null).catch(() => {})
      return false
    }
    // 寫入還原內容之前先換掉本機儲存區識別碼：Preferences 裡的同步 base 是較新的那一份，
    // 識別碼對不上才會被當成首次同步（只做聯集）。不能只移除標記——升級前沒有識別碼的 base
    // 在「本機也沒有標記」時會被信任一次。標記先寫：還原內容落盤時，新標記一定已經在磁碟上。
    const written = []
    const write = (key, value) => {
      written.push({ key, previous: storage.getItem(key) })
      storage.setItem(key, value)
    }
    try {
      // 識別碼不列入回滾（見下方 catch），直接寫
      storage.setItem(STORE_EPOCH_KEY, newStoreEpoch())
      for (const [key, value] of Object.entries(backup.entries)) write(key, value)
    } catch (error) {
      // 寫到一半失敗（多半是空間不足）：回滾已寫的，儲存區維持「空的」，下次開啟才會再自動還原；
      // 半套內容會讓之後的檢查以為不需要還原，剩下的文件就再也不會自動救回。回滾本身失敗不能吞掉。
      // 識別碼不撤回，完整回滾也一樣：舊識別碼配上 Preferences 裡的同步狀態會讓舊 base 被信任，
      // 之後本機少掉的 base 文件（有內容撤回失敗，或回滾後使用者先建了新文件）會被當成本機刪除推上雲端。
      // 寫新識別碼本身失敗時什麼都還沒寫、值也沒變過，不必寫回。
      let rollbackIncomplete = false
      for (const item of written.reverse()) {
        try {
          if (item.previous === null) storage.removeItem(item.key)
          else storage.setItem(item.key, item.previous)
        } catch {
          rollbackIncomplete = true
        }
      }
      // 這份備份另存到不會被輪替的位置（「從自動備份還原」也找得到）；另存成功才解除輪替暫停
      await ensureRestoreSourceProtected()
      throw restoreFailure(error, rollbackIncomplete)
    }
    pendingRestoreSource = null
    await writePendingMarker(null).catch(() => {})
    lastHash = contentHash(JSON.stringify(backup.entries))
    return true
  }

  function writePendingMarker(source) {
    return filesystem.writeFile({
      path: RESTORE_PENDING_PATH,
      data: JSON.stringify({ version: 1, source }),
      directory,
      encoding: 'utf8',
      recursive: true
    })
  }

  /**
   * 把來源備份另存到保留檔。保留檔一律不覆蓋不同的內容：已有一份內容相同的就算保護好了（重試不重寫），
   * 其餘依序找第一個空的位置。讀不到某個位置的狀態就丟錯，交給呼叫端當成「沒保護好」，不冒險覆蓋。
   * 回傳保留檔路徑；來源檔已經不在時回傳 null（沒有東西可以保護）。
   */
  async function preserveRestoreSource(source) {
    const sourceText = await readText(source)
    if (sourceText === null) return null
    for (const slot of RESTORE_FAILED_PATHS) {
      const existing = await readText(slot)
      if (existing === sourceText) return slot
      if (existing === null) {
        await filesystem.writeFile({ path: slot, data: sourceText, directory, encoding: 'utf8', recursive: true })
        return slot
      }
    }
    throw new Error('All restore-failed slots hold other preserved backups')
  }

  /**
   * 輪替備份之前呼叫：有還原失敗、還沒保護好的來源就先另存；回傳 true 才可以輪替。
   * 不變式：只有在「沒有待保護標記」或「這一次已另存並成功清掉標記」時才輪替。標記還在，來源就還沒被輪替，
   * 重試只會複製到同一份內容（已存在就略過），保留檔不會被已輪替的新內容覆蓋。
   * - 標記不存在（檔案不存在）＝沒有待保護的來源，可以輪替。
   * - 標記存在但讀不出來（讀取錯誤）＝不能當成沒有，這一次不輪替。標記內容損壞則和電腦版一樣，當成沒有。
   * - 另存失敗，或另存成功但清標記失敗＝這一次不輪替。
   */
  async function ensureRestoreSourceProtected() {
    let source = pendingRestoreSource
    if (!source) {
      let markerText
      try {
        markerText = await readText(RESTORE_PENDING_PATH)
      } catch {
        return false
      }
      const marker = parseJsonText(markerText)
      source = typeof marker?.source === 'string' && marker.source ? marker.source : null
      if (!source) return true
    }
    try {
      await preserveRestoreSource(source)
    } catch {
      return false
    }
    pendingRestoreSource = null
    try {
      await writePendingMarker(null)
    } catch {
      return false
    }
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
    // 還原失敗不能跟「不需要還原」混成同一個結果：留下提示，也不啟動定期備份（避免把還沒救回的那份輪替掉）。
    console.error('MindFlow 備份還原檢查失敗', error)
    try { windowRef?.sessionStorage?.setItem(RESTORE_FAILED_NOTICE_KEY, error?.rollbackIncomplete ? 'partial' : '1') } catch { /* 只影響提示 */ }
    return false
  })
  return { ready, store }
}

/**
 * 啟動時的自動還原失敗過：回傳一次（true；撤回沒完成時回傳 'partial'），讓頁面提示使用者到「手機備份」手動還原。
 */
export function consumeRestoreFailedNotice(windowRef = globalThis.window) {
  try {
    const value = windowRef?.sessionStorage?.getItem(RESTORE_FAILED_NOTICE_KEY)
    if (value !== '1' && value !== 'partial') return false
    windowRef.sessionStorage.removeItem(RESTORE_FAILED_NOTICE_KEY)
    return value === 'partial' ? 'partial' : true
  } catch {
    return false
  }
}
