import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DOCUMENT_INDEX_KEY,
  DOCUMENT_KEY_PREFIX,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  normalizeMindflowEntries
} from './backup-rules.mjs'
import { STORE_EPOCH_KEY } from './sync-plan.mjs'

export {
  DOCUMENT_INDEX_KEY,
  DOCUMENT_KEY_PREFIX,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  normalizeMindflowEntries
}

export const BACKUP_DIRECTORY = 'backups'
export const BACKUP_FILENAME = 'mindflow-backup.json'
export const BACKUP_LIMIT = 10
export const BACKUP_INTERVAL_MS = 2 * 60 * 1000

/**
 * 備份還原與舊資料搬入在 renderer 執行的寫入腳本。寫入還原內容之前先換掉本機儲存區識別碼：
 * userData 的 sync-state.json 裡的 base 屬於較新的那份資料，識別碼對不上才會被當成首次同步（只做聯集）。
 * 不能只移除標記——升級前沒有識別碼的 base 在「本機也沒有標記」時會被信任一次。
 * 標記先寫：還原內容落盤時，新標記一定已經在磁碟上。
 */
export function rendererRestoreScript(entries, { storeEpoch }) {
  if (typeof storeEpoch !== 'string' || !storeEpoch) throw new TypeError('storeEpoch is required')
  const serialized = JSON.stringify(JSON.stringify(entries))
  return `(() => {
    const entries = JSON.parse(${serialized});
    const indexKey = ${JSON.stringify(DOCUMENT_INDEX_KEY)};
    const docPrefix = ${JSON.stringify(DOCUMENT_KEY_PREFIX)};
    // 讀備份／舊資料是非同步的，這段期間使用者可能已新建文件、或同步已拉回內容：
    // 在同一段執行裡重新確認仍是空的（與 hasIntentionalMindflowState 相同的判斷），否則取消、一個 key 都不寫。
    let intentional = false;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (typeof key === 'string' && key.startsWith(docPrefix)) intentional = true;
    }
    if (!intentional) {
      try {
        const parsed = JSON.parse(localStorage.getItem(indexKey));
        intentional = Boolean(parsed && typeof parsed === 'object');
      } catch {}
    }
    if (intentional) return 0;

    const written = [];
    const write = (key, value) => {
      written.push({ key, previous: localStorage.getItem(key) });
      localStorage.setItem(key, value);
    };
    try {
      write(${JSON.stringify(STORE_EPOCH_KEY)}, ${JSON.stringify(storeEpoch)});
      let count = 0;
      for (const [key, value] of Object.entries(entries)) {
        if (key.startsWith('mindflow.') && !key.startsWith('mindflow.sync.') && typeof value === 'string') {
          write(key, value);
          count += 1;
        }
      }
      return count;
    } catch (error) {
      // 寫到一半失敗（多半是空間不足）：回滾已寫的，儲存區維持「空的」，下次開啟才會再自動還原。
      // 回滾本身失敗不能吞掉：標在錯誤上，呼叫端才知道本機留著半套內容。
      let rollbackIncomplete = false;
      for (const item of written.reverse()) {
        try {
          if (item.previous === null) localStorage.removeItem(item.key);
          else localStorage.setItem(item.key, item.previous);
        } catch {
          rollbackIncomplete = true;
        }
      }
      // executeJavaScript 只帶得回錯誤訊息、帶不回自訂欄位：失敗改用結構化結果回傳，由 main 轉成錯誤。
      return {
        restoreFailed: true,
        name: String(error && error.name || 'Error'),
        message: String(error && error.message || error),
        rollbackIncomplete
      };
    }
  })()`
}

/** 把還原腳本的結構化失敗結果轉回錯誤（帶著 rollbackIncomplete）；成功或取消時原樣回傳筆數。 */
export function restoreScriptOutcome(result) {
  if (result && typeof result === 'object' && result.restoreFailed) {
    const error = new Error(result.message || 'Restore failed')
    error.name = result.name || 'Error'
    error.rollbackIncomplete = result.rollbackIncomplete === true
    throw error
  }
  return result
}

const RESTORE_PENDING_FILENAME = 'restore-pending.json'

function restorePendingPath(userDataPath) {
  return join(userDataPath, BACKUP_DIRECTORY, RESTORE_PENDING_FILENAME)
}

/** 開始自動還原前記下來源：還原若失敗、來源又還沒另存成功，之後的備份輪替會先停下來。 */
export async function markRestorePending({ userDataPath, sourcePath }) {
  await mkdir(join(userDataPath, BACKUP_DIRECTORY), { recursive: true })
  await writeFile(restorePendingPath(userDataPath), JSON.stringify({ version: 1, source: sourcePath }), 'utf8')
}

export async function clearRestorePending({ userDataPath }) {
  await rm(restorePendingPath(userDataPath), { force: true })
}

/**
 * 輪替備份之前呼叫：有還原失敗、還沒保護好的來源（restore-pending.json）就先另存；
 * 另存成功才清掉標記，回傳 { ok: true, path }。另存失敗回傳 { ok: false }，呼叫端這一次不能輪替，
 * 否則唯一含未上雲資料的來源會被擠掉。來源檔已經不存在（沒有東西可保護）或標記壞掉時清掉標記。
 */
export async function ensureRestoreSourceProtected({ userDataPath, copy = copyFile, now = new Date() }) {
  let pending
  try {
    pending = JSON.parse(await readFile(restorePendingPath(userDataPath), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, path: null }
    if (!(error instanceof SyntaxError)) return { ok: false, path: null }
    pending = null
  }
  const source = typeof pending?.source === 'string' && pending.source ? pending.source : null
  if (!source) {
    await clearRestorePending({ userDataPath })
    return { ok: true, path: null }
  }
  try {
    const path = await preserveFailedRestoreSource({ userDataPath, sourcePath: source, now, copy })
    await clearRestorePending({ userDataPath })
    return { ok: true, path }
  } catch (error) {
    if (error?.code === 'ENOENT' && error?.path === source) {
      await clearRestorePending({ userDataPath })
      return { ok: true, path: null }
    }
    return { ok: false, path: null }
  }
}

/**
 * 自動還原失敗時，把來源備份另存成不在輪替名單裡的檔案（restore-failed-<時間>.json），
 * 之後的定期備份才不會把還沒救回的那份擠掉。回傳另存的路徑。
 */
export async function preserveFailedRestoreSource({ userDataPath, sourcePath, now = new Date(), copy = copyFile }) {
  if (!userDataPath || !sourcePath) throw new TypeError('userDataPath and sourcePath are required')
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const target = join(userDataPath, BACKUP_DIRECTORY, `restore-failed-${stamp}.json`)
  await mkdir(join(userDataPath, BACKUP_DIRECTORY), { recursive: true })
  await copy(sourcePath, target)
  return target
}

export function backupFilePaths(userDataPath, limit = BACKUP_LIMIT) {
  const directory = join(userDataPath, BACKUP_DIRECTORY)
  return Array.from({ length: limit }, (_, index) => (
    index === 0
      ? join(directory, BACKUP_FILENAME)
      : join(directory, `mindflow-backup-${index}.json`)
  ))
}

export async function writeMindflowBackup({
  userDataPath,
  entries,
  reason = 'interval',
  now = new Date(),
  limit = BACKUP_LIMIT,
  protectRestoreSource = () => ensureRestoreSourceProtected({ userDataPath })
}) {
  if (!userDataPath) throw new TypeError('A userData path is required')
  const normalized = normalizeMindflowEntries(entries)
  // 沒有文件就不寫（含完全空白的來源）：偏好設定殘留不足以蓋掉一份含資料的備份。
  if (!hasMindflowDocuments(normalized)) return null
  // 還原失敗、來源還沒另存成功：這一次不輪替（開機、定期、關窗的備份都走這裡）。
  if (!(await protectRestoreSource())?.ok) return null

  const paths = backupFilePaths(userDataPath, limit)
  const serialized = JSON.stringify(normalized)
  // 閒置時每兩分鐘寫一次同樣的快照，十份歷史會被同一版洗光；內容沒變就不輪替也不重寫。
  try {
    const previous = JSON.parse(await readFile(paths[0], 'utf8'))
    if (JSON.stringify(normalizeMindflowEntries(previous?.entries)) === serialized) return null
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }

  await mkdir(join(userDataPath, BACKUP_DIRECTORY), { recursive: true })

  // 由舊到新反向複製，任何時刻至少仍留有一份可讀的上一版備份。
  for (let index = paths.length - 1; index >= 1; index -= 1) {
    try {
      await copyFile(paths[index - 1], paths[index])
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const payload = {
    version: 1,
    createdAt: now.toISOString(),
    reason,
    entries: normalized
  }
  await writeFile(paths[0], `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { path: paths[0], payload }
}

export async function readLatestMindflowBackup({
  userDataPath,
  limit = BACKUP_LIMIT
}) {
  if (!userDataPath) throw new TypeError('A userData path is required')

  for (const path of backupFilePaths(userDataPath, limit)) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      const entries = normalizeMindflowEntries(parsed?.entries)
      // 只認得含文件的備份；純偏好設定的快照救不回心智圖，往更舊的版本繼續找。
      if (parsed?.version !== 1 || !hasMindflowDocuments(entries)) continue
      return { ...parsed, entries, path }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
  }
  return null
}
