/**
 * 電腦版同步的 main process 端（M2a 起同步引擎在 renderer 執行）：
 * - 設定與 PAT 以 safeStorage 加密保存（sync-settings.mjs）。
 * - 代理 GitHub 請求：renderer 只送方法、路徑與內容，main 檢查白名單後加上權杖送出。
 *   PAT 永遠不進 renderer（同步紅線）。
 * - 啟動救援（舊資料遷移／備份還原）完成前，renderer 的引擎不開始同步。
 * - 提供 M1 留在 userData 的同步 base，讓 renderer 引擎第一次啟動時搬過去。
 */
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { getDecryptedToken, loadSyncSettings, saveSyncSettings } from './sync-settings.mjs'

export const SYNC_BRIDGE_CHANNELS = Object.freeze({
  getConfig: 'mindflow-sync:get-config',
  setConfig: 'mindflow-sync:set-config',
  githubRequest: 'mindflow-sync:github-request',
  getLegacyState: 'mindflow-sync:get-legacy-state',
  startupReady: 'mindflow-sync:startup-ready'
})
export const LEGACY_STATE_FILENAME = 'sync-state.json'
const API_VERSION = '2022-11-28'
const MAX_BODY_BYTES = 32 * 1024 * 1024
const ALLOWED_HEADERS = new Set(['if-none-match'])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function redact(value, token) {
  const message = String(value ?? '')
  return token ? message.split(token).join('[已隱藏]') : message
}

function encodeRepo(repo) {
  return String(repo).split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * 只允許同步需要的請求：設定的 repo 底下的 Git Data API、讀 repo 資訊，以及建立 repo。
 * 回傳 null 代表合法；否則回傳拒絕原因。
 */
export function validateGitHubRequest(spec, repo) {
  if (!isObject(spec)) return 'invalid request'
  const method = String(spec.method || 'GET').toUpperCase()
  if (!['GET', 'POST', 'PATCH'].includes(method)) return `method ${method} is not allowed`
  const path = spec.path
  // %2e%2e 會被 URL 解析成 ..，一樣擋掉，免得繞出 repo 的路徑範圍。
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..') || /%2e|[\s#\\]/iu.test(path)) return 'invalid path'
  if (!repo) return 'sync repository is not configured'
  const repoPath = `/repos/${encodeRepo(repo)}`.toLowerCase()
  const lower = path.toLowerCase()
  const inRepo = lower === repoPath || lower.startsWith(`${repoPath}/git/`)
  const createRepo = method === 'POST' && path === '/user/repos'
  if (!inRepo && !createRepo) return 'path is outside the sync repository'
  if (lower === repoPath && method !== 'GET') return 'only GET is allowed on the repository'
  if (spec.headers !== undefined) {
    if (!isObject(spec.headers)) return 'invalid headers'
    for (const name of Object.keys(spec.headers)) {
      if (!ALLOWED_HEADERS.has(name.toLowerCase())) return `header ${name} is not allowed`
    }
  }
  if (spec.body !== undefined && !isObject(spec.body)) return 'invalid body'
  return null
}

function publicConfig(settings) {
  const config = {
    enabled: settings.enabled === true,
    repo: settings.repo || '',
    branch: settings.branch || 'main',
    hasToken: Boolean(settings.tokenCipher)
  }
  if (typeof settings.warning === 'string' && settings.warning) config.warning = settings.warning
  return config
}

export async function loadLegacySyncState(userDataPath) {
  try {
    const parsed = JSON.parse(await readFile(join(userDataPath, LEGACY_STATE_FILENAME), 'utf8'))
    if (!isObject(parsed)) return null
    // 只交出比對需要的欄位（這個檔案從來不含權杖）。
    return {
      lastSyncedCommitSha: typeof parsed.lastSyncedCommitSha === 'string' ? parsed.lastSyncedCommitSha : null,
      baseManifest: isObject(parsed.baseManifest) ? parsed.baseManifest : null,
      perDoc: isObject(parsed.perDoc) ? parsed.perDoc : {},
      machineId: typeof parsed.machineId === 'string' ? parsed.machineId : null
    }
  } catch {
    return null
  }
}

export function registerSyncBridgeIpc({
  ipcMain,
  userDataPath,
  fetchFn = globalThis.fetch,
  apiBase = 'https://api.github.com',
  loadSettings = loadSyncSettings,
  saveSettings = saveSyncSettings,
  getToken = getDecryptedToken,
  startupReady = Promise.resolve(),
  defaultMachineId = () => `pc-${hostname().trim() || 'mindflow'}-${randomBytes(2).toString('hex')}`
}) {
  if (!ipcMain || !userDataPath) throw new TypeError('ipcMain and userDataPath are required')
  const base = String(apiBase).replace(/\/+$/u, '')

  const handlers = {
    [SYNC_BRIDGE_CHANNELS.getConfig]: async () => publicConfig(loadSettings(userDataPath)),

    [SYNC_BRIDGE_CHANNELS.setConfig]: async (_event, patch = {}) => {
      const clean = {}
      if (isObject(patch)) {
        if (Object.hasOwn(patch, 'enabled')) clean.enabled = patch.enabled
        if (Object.hasOwn(patch, 'repo')) clean.repo = patch.repo
        if (Object.hasOwn(patch, 'token')) clean.token = patch.token
      }
      try {
        saveSettings(userDataPath, clean)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: redact(error?.message || '設定儲存失敗', clean.token) }
      }
    },

    [SYNC_BRIDGE_CHANNELS.githubRequest]: async (_event, spec) => {
      let settings
      try {
        settings = loadSettings(userDataPath)
      } catch {
        return { status: 0, etag: null, data: { message: '無法讀取同步設定' }, rateRemaining: null }
      }
      const rejected = validateGitHubRequest(spec, settings.repo)
      if (rejected) return { status: 403, etag: null, data: { message: `MindFlow 拒絕這個請求：${rejected}` }, rateRemaining: null }
      let token = ''
      try {
        token = getToken(settings) || ''
      } catch {
        return { status: 401, etag: null, data: { message: '這台電腦的安全儲存無法解密 PAT，請重新輸入。' }, rateRemaining: null }
      }
      if (!token) return { status: 401, etag: null, data: { message: '尚未設定 PAT' }, rateRemaining: null }
      const method = String(spec.method || 'GET').toUpperCase()
      const init = {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': API_VERSION,
          ...(spec.headers || {})
        }
      }
      if (spec.body !== undefined) {
        const body = JSON.stringify(spec.body)
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { status: 413, etag: null, data: { message: 'request body is too large' }, rateRemaining: null }
        init.headers['content-type'] = 'application/json'
        init.body = body
      }
      let response
      try {
        response = await fetchFn(`${base}${spec.path}`, init)
      } catch (error) {
        return { status: 0, etag: null, data: { message: redact(error?.message || 'network error', token) }, rateRemaining: null }
      }
      let data = null
      if (response.status !== 204 && response.status !== 304) {
        try { data = await response.json() } catch { data = null }
      }
      if (data && typeof data.message === 'string') data.message = redact(data.message, token)
      const remaining = Number(response.headers.get('x-ratelimit-remaining'))
      return {
        status: response.status,
        etag: response.headers.get('etag'),
        data,
        rateRemaining: Number.isFinite(remaining) ? remaining : null
      }
    },

    [SYNC_BRIDGE_CHANNELS.getLegacyState]: async () => {
      const legacy = await loadLegacySyncState(userDataPath)
      if (legacy) return legacy
      return { lastSyncedCommitSha: null, baseManifest: null, perDoc: {}, machineId: defaultMachineId() }
    },

    // 舊資料遷移、備份還原做完才回覆；renderer 的同步引擎以它當 startGate。
    [SYNC_BRIDGE_CHANNELS.startupReady]: async () => {
      await startupReady
      return true
    }
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler?.(channel)
    ipcMain.handle(channel, handler)
  }
  return Object.freeze({
    dispose() {
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel)
    }
  })
}
