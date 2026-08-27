import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DOCUMENT_INDEX_KEY = 'mindflow.docs.index'
export const DOCUMENT_KEY_PREFIX = 'mindflow.doc.'
export const BACKUP_DIRECTORY = 'backups'
export const BACKUP_FILENAME = 'mindflow-backup.json'
export const BACKUP_LIMIT = 10
export const BACKUP_INTERVAL_MS = 2 * 60 * 1000

export function backupFilePaths(userDataPath, limit = BACKUP_LIMIT) {
  const directory = join(userDataPath, BACKUP_DIRECTORY)
  return Array.from({ length: limit }, (_, index) => (
    index === 0
      ? join(directory, BACKUP_FILENAME)
      : join(directory, `mindflow-backup-${index}.json`)
  ))
}

// 判斷「這份 localStorage 有沒有真正的心智圖」。偏好設定 key 會讓「有沒有任何 mindflow.* key」
// 這種判斷永遠為真，於是文件全掉光時反而不會觸發救援——所以一律以文件索引為準。
export function hasMindflowDocuments(entries) {
  if (!entries || typeof entries !== 'object') return false

  const raw = entries[DOCUMENT_INDEX_KEY]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        // 索引讀得動就以索引為準。
        const docs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.docs) ? parsed.docs : []
        const trash = Array.isArray(parsed.trash) ? parsed.trash : []
        return docs.length + trash.length > 0
      }
    } catch {
      // 索引壞掉不代表文件不見，往下改看文件本體。
    }
  }

  // 索引壞掉或不存在，但文件本體還在時必須算「有資料」：
  // 否則救援會拿舊備份蓋掉現存文件，那比不還原更糟。
  return Object.keys(entries).some(key => key.startsWith(DOCUMENT_KEY_PREFIX))
}

/**
 * 「儲存區處於使用者刻意維護的狀態」：索引解析得動（包含刻意清空後的空索引）或仍有文件本體。
 * 救援與舊版遷移只該在索引消失／損毀且文件掉光時發動——把使用者剛清空的庫自動復活回來不是救援。
 */
export function hasIntentionalMindflowState(entries) {
  if (!entries || typeof entries !== 'object') return false
  const raw = entries[DOCUMENT_INDEX_KEY]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return true
    } catch { /* 壞索引不算刻意狀態 */ }
  }
  return Object.keys(entries).some(key => key.startsWith(DOCUMENT_KEY_PREFIX))
}

export function normalizeMindflowEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {}

  return Object.fromEntries(
    Object.entries(entries)
      .filter(([key, value]) => key.startsWith('mindflow.') && typeof value === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

export async function writeMindflowBackup({
  userDataPath,
  entries,
  reason = 'interval',
  now = new Date(),
  limit = BACKUP_LIMIT
}) {
  if (!userDataPath) throw new TypeError('A userData path is required')
  const normalized = normalizeMindflowEntries(entries)
  // 沒有文件就不寫（含完全空白的來源）：偏好設定殘留不足以蓋掉一份含資料的備份。
  if (!hasMindflowDocuments(normalized)) return null

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
