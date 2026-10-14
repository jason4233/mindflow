/**
 * 手機平台（Capacitor）：設定存 Preferences，PAT 存 Android Keystore 加密的 MindflowSecureStorage，
 * HTTP 直接帶權杖呼叫 GitHub（WebView 裡沒有更安全的地方，權杖只留在這個閉包）。
 * 舊版留在 Preferences 的明文 PAT 會搬進安全儲存並刪除（同 M1）。
 */
import { createFetchRequester } from './transport-github.mjs'

export const MOBILE_SYNC_CONFIG_KEY = 'mindflow.sync.mobile.config'
export const MOBILE_SYNC_TOKEN_KEY = 'mindflow.sync.mobile.token'
export const MOBILE_SYNC_STATE_KEY = 'mindflow.sync.mobile.state'
const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/u
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/u

function hasMethods(value, methods) {
  return Boolean(value) && methods.every(method => typeof value[method] === 'function')
}

function parseJson(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    enabled: source.enabled === true,
    repo: typeof source.repo === 'string' ? source.repo.trim() : '',
    branch: typeof source.branch === 'string' && source.branch.trim() ? source.branch.trim() : 'main'
  }
}

/**
 * @param {object} options
 * @param {object} options.preferences    Capacitor Preferences（get/set/remove）
 * @param {object} [options.secureStorage] MindflowSecureStorage（isAvailable/get/set/remove）
 */
export function createMobilePlatform({
  preferences,
  secureStorage = null,
  fetchFn = globalThis.fetch,
  apiBase = 'https://api.github.com'
} = {}) {
  if (!hasMethods(preferences, ['get', 'set'])) throw new TypeError('Capacitor Preferences is required')
  const secure = hasMethods(secureStorage, ['get', 'set', 'remove']) ? secureStorage : null
  let token = ''
  let tokenStorage = 'preferences'
  let config = normalizeConfig(null)

  async function removePlaintextToken() {
    if (typeof preferences.remove === 'function') await preferences.remove({ key: MOBILE_SYNC_TOKEN_KEY })
    else await preferences.set({ key: MOBILE_SYNC_TOKEN_KEY, value: '' })
  }

  async function secureAvailable() {
    if (!secure) return false
    try {
      if (typeof secure.isAvailable !== 'function') return true
      return (await secure.isAvailable())?.available === true
    } catch {
      return false
    }
  }

  async function loadToken(plaintext) {
    if (!(await secureAvailable())) {
      tokenStorage = 'preferences'
      return plaintext
    }
    try {
      const stored = (await secure.get({ key: MOBILE_SYNC_TOKEN_KEY }))?.value
      if (typeof stored === 'string' && stored) {
        tokenStorage = 'secure'
        if (plaintext) await removePlaintextToken().catch(() => {})
        return stored
      }
      if (!plaintext) {
        tokenStorage = 'secure'
        return ''
      }
      // 搬移：寫進安全儲存並讀回確認後才刪明文；任何一步失敗都保留明文、照常同步。
      await secure.set({ key: MOBILE_SYNC_TOKEN_KEY, value: plaintext })
      const verified = (await secure.get({ key: MOBILE_SYNC_TOKEN_KEY }))?.value
      if (verified !== plaintext) {
        tokenStorage = 'preferences'
        return plaintext
      }
      tokenStorage = 'secure'
      await removePlaintextToken()
      return plaintext
    } catch {
      tokenStorage = 'preferences'
      return plaintext
    }
  }

  async function saveToken(nextToken) {
    if (await secureAvailable()) {
      try {
        if (nextToken) await secure.set({ key: MOBILE_SYNC_TOKEN_KEY, value: nextToken })
        else await secure.remove({ key: MOBILE_SYNC_TOKEN_KEY })
        tokenStorage = 'secure'
        await removePlaintextToken()
        return
      } catch {
        // 安全儲存寫入失敗：退回 Preferences，不能讓使用者剛輸入的 PAT 消失。
      }
    }
    tokenStorage = 'preferences'
    if (nextToken) await preferences.set({ key: MOBILE_SYNC_TOKEN_KEY, value: nextToken })
    else await removePlaintextToken()
  }

  return Object.freeze({
    kind: 'android',
    label: '手機',

    async loadConfig() {
      const [configResult, tokenResult] = await Promise.all([
        preferences.get({ key: MOBILE_SYNC_CONFIG_KEY }),
        preferences.get({ key: MOBILE_SYNC_TOKEN_KEY })
      ])
      config = normalizeConfig(parseJson(configResult?.value))
      token = await loadToken(tokenResult?.value || '')
      return { ...config, hasToken: Boolean(token), tokenStorage }
    },

    async saveConfig(patch = {}) {
      const next = normalizeConfig({
        enabled: Object.hasOwn(patch, 'enabled') ? patch.enabled : config.enabled,
        repo: Object.hasOwn(patch, 'repo') ? patch.repo : config.repo,
        branch: Object.hasOwn(patch, 'branch') ? patch.branch : config.branch
      })
      const nextToken = Object.hasOwn(patch, 'token') ? String(patch.token || '').trim() : token
      if (next.repo && !REPO_PATTERN.test(next.repo)) return { ok: false, error: 'Repo 請使用 owner/name 格式' }
      if (!BRANCH_PATTERN.test(next.branch) || next.branch.includes('..')) return { ok: false, error: '分支名稱不正確' }
      if (next.enabled && (!next.repo || !nextToken)) return { ok: false, error: '啟用同步需要 repo 與 PAT' }
      try {
        await preferences.set({ key: MOBILE_SYNC_CONFIG_KEY, value: JSON.stringify(next) })
        if (Object.hasOwn(patch, 'token')) await saveToken(nextToken)
        config = next
        token = nextToken
        return { ok: true }
      } catch (error) {
        const message = String(error?.message || '設定儲存失敗')
        return { ok: false, error: nextToken ? message.split(nextToken).join('[已隱藏]') : message }
      }
    },

    createRequest() {
      return createFetchRequester({ fetchFn, apiBase, token })
    },

    /** M1 的同步 base（Preferences）：第一次啟動 v2 引擎時搬進 IndexedDB 一次。 */
    async loadLegacyState() {
      const result = await preferences.get({ key: MOBILE_SYNC_STATE_KEY })
      return parseJson(result?.value)
    },

    secretForRedaction() {
      return token
    }
  })
}
