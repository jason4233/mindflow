import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DOCUMENT_INDEX_KEY,
  DOCUMENT_KEY_PREFIX,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  normalizeMindflowEntries
} from './backup-rules.mjs'

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
