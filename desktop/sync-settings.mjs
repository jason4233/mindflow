import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const SETTINGS_FILENAME = 'sync-settings.json'
const CORRUPT_PREFIX = `${SETTINGS_FILENAME}.corrupt`
const CORRUPT_WARNING = '同步設定檔損壞，原檔已隔離保留。同步已安全停用，請重新確認 repo 並輸入 PAT。'

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  repo: '',
  branch: 'main',
  tokenCipher: null
})

function settingsPath(userDataPath) {
  if (typeof userDataPath !== 'string' || userDataPath.length === 0) {
    throw new TypeError('A userData path is required')
  }
  return join(userDataPath, SETTINGS_FILENAME)
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS }
  }

  return {
    enabled: value.enabled === true,
    repo: typeof value.repo === 'string' ? value.repo.trim() : '',
    branch: typeof value.branch === 'string' && value.branch.trim()
      ? value.branch.trim()
      : 'main',
    tokenCipher: typeof value.tokenCipher === 'string' && value.tokenCipher
      ? value.tokenCipher
      : null
  }
}

function corruptSettingsExist(userDataPath) {
  try {
    return readdirSync(userDataPath).some(name => name === CORRUPT_PREFIX || name.startsWith(`${CORRUPT_PREFIX}.`))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function defaultSettingsWithWarning(userDataPath) {
  const settings = { ...DEFAULT_SETTINGS }
  if (corruptSettingsExist(userDataPath)) settings.warning = CORRUPT_WARNING
  return settings
}

function quarantineCorruptSettings(path) {
  const basePath = `${path}.corrupt`
  let destination = basePath
  let suffix = 0
  while (existsSync(destination)) {
    suffix += 1
    destination = `${basePath}.${suffix}`
  }
  // 損壞內容可能仍含唯一 tokenCipher；只搬移、不覆寫也不刪除，保留人工救援可能。
  renameSync(path, destination)
}

function electronSafeStorage() {
  const electron = require('electron')
  const safeStorage = electron && typeof electron === 'object'
    ? electron.safeStorage
    : null

  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' ||
      safeStorage.isEncryptionAvailable() !== true) {
    // 絕不退回明文或自製弱加密；平台金鑰不可用時讓 main process 明確回報失敗。
    throw new Error('Secure token storage is unavailable on this device')
  }
  return safeStorage
}

export function loadSyncSettings(userDataPath) {
  const path = settingsPath(userDataPath)
  try {
    return normalizeSettings(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return defaultSettingsWithWarning(userDataPath)
    }
    if (error instanceof SyntaxError) {
      quarantineCorruptSettings(path)
      return { ...DEFAULT_SETTINGS, warning: CORRUPT_WARNING }
    }
    throw error
  }
}

export function saveSyncSettings(userDataPath, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('A settings patch is required')
  }

  const current = loadSyncSettings(userDataPath)
  const next = { ...current }

  if (Object.hasOwn(patch, 'enabled')) {
    if (typeof patch.enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
    next.enabled = patch.enabled
  }
  if (Object.hasOwn(patch, 'repo')) {
    if (typeof patch.repo !== 'string') throw new TypeError('repo must be a string')
    next.repo = patch.repo.trim()
  }
  if (Object.hasOwn(patch, 'branch')) {
    if (typeof patch.branch !== 'string' || !patch.branch.trim()) {
      throw new TypeError('branch must be a non-empty string')
    }
    next.branch = patch.branch.trim()
  }
  if (Object.hasOwn(patch, 'token')) {
    if (typeof patch.token !== 'string') throw new TypeError('token must be a string')
    const encrypted = electronSafeStorage().encryptString(patch.token)
    if (!Buffer.isBuffer(encrypted)) {
      throw new Error('Secure token storage returned an invalid encrypted value')
    }
    next.tokenCipher = encrypted.toString('base64')
  }

  const normalized = normalizeSettings(next)
  const path = settingsPath(userDataPath)
  const temporaryPath = `${path}.tmp`
  mkdirSync(userDataPath, { recursive: true })

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    // tokenCipher 不能留下半份 JSON；同目錄 rename 讓替換維持原子性。
    renameSync(temporaryPath, path)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }

  return normalized
}

export function getDecryptedToken(settings) {
  const normalized = normalizeSettings(settings)
  if (!normalized.tokenCipher) return null

  const encrypted = Buffer.from(normalized.tokenCipher, 'base64')
  return electronSafeStorage().decryptString(encrypted)
}
