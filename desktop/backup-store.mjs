import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  if (Object.keys(normalized).length === 0) return null

  const paths = backupFilePaths(userDataPath, limit)
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
      if (parsed?.version !== 1 || Object.keys(entries).length === 0) continue
      return { ...parsed, entries, path }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
  }
  return null
}
