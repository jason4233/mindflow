/**
 * 電腦平台（Electron renderer）：設定與 PAT 由 main process 以 safeStorage 加密保存；
 * GitHub 請求經 IPC 交給 main process 加上權杖後送出。renderer 永遠拿不到 PAT。
 *
 * window.mindflowSync（preload）契約：
 * - getConfig() → { enabled, repo, branch, hasToken, warning? }
 * - setConfig(patch) → { ok, error? }
 * - githubRequest({ method, path, body, headers }) → { status, etag, data, rateRemaining }
 * - getLegacyState() → M1 的 sync-state（不含權杖）或 null
 */
import { TransportError } from './transport-github.mjs'

export function createDesktopPlatform(bridge) {
  if (!bridge || typeof bridge.getConfig !== 'function' || typeof bridge.githubRequest !== 'function') {
    throw new TypeError('window.mindflowSync with githubRequest is required')
  }
  return Object.freeze({
    kind: 'pc',
    label: '電腦',

    async loadConfig() {
      const value = await bridge.getConfig()
      return {
        enabled: value?.enabled === true,
        repo: typeof value?.repo === 'string' ? value.repo : '',
        branch: typeof value?.branch === 'string' && value.branch ? value.branch : 'main',
        hasToken: value?.hasToken === true,
        tokenStorage: 'secure',
        ...(typeof value?.warning === 'string' && value.warning ? { warning: value.warning } : {})
      }
    },

    async saveConfig(patch = {}) {
      return bridge.setConfig(patch)
    },

    createRequest() {
      return async spec => {
        let response
        try {
          response = await bridge.githubRequest(spec)
        } catch (error) {
          throw new TransportError(`GitHub request failed: ${String(error?.message || 'IPC error')}`, { status: 0, retryable: true })
        }
        if (!response || typeof response.status !== 'number') throw new TransportError('GitHub request failed: invalid IPC response', { status: 0, retryable: true })
        return response
      }
    },

    async loadLegacyState() {
      return typeof bridge.getLegacyState === 'function' ? bridge.getLegacyState() : null
    },

    secretForRedaction() {
      return ''
    }
  })
}
