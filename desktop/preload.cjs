'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// M2a 起同步引擎在 renderer 執行；這座橋只提供設定、GitHub 請求代理（權杖由 main 加上）、
// M1 同步 base 與配對 QR。PAT 不會出現在任何回傳值裡。
const CHANNELS = Object.freeze({
  getConfig: 'mindflow-sync:get-config',
  setConfig: 'mindflow-sync:set-config',
  githubRequest: 'mindflow-sync:github-request',
  getLegacyState: 'mindflow-sync:get-legacy-state',
  startupReady: 'mindflow-sync:startup-ready',
  showPairingQr: 'mindflow-sync:show-pairing-qr'
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function publicConfig(value) {
  // main process 即使日後誤回 token/tokenCipher，preload 仍是最後一道資料邊界。
  const config = {
    enabled: value?.enabled === true,
    repo: typeof value?.repo === 'string' ? value.repo : '',
    branch: typeof value?.branch === 'string' && value.branch ? value.branch : 'main',
    hasToken: value?.hasToken === true
  }
  if (typeof value?.warning === 'string' && value.warning) config.warning = value.warning
  return config
}

function configPatch(value) {
  if (!isObject(value)) return {}
  const patch = {}
  if (Object.hasOwn(value, 'token')) patch.token = value.token
  if (Object.hasOwn(value, 'repo')) patch.repo = value.repo
  if (Object.hasOwn(value, 'enabled')) patch.enabled = value.enabled
  return patch
}

function actionResult(value) {
  if (value?.ok === true) return { ok: true }
  return {
    ok: false,
    ...(typeof value?.error === 'string' ? { error: value.error } : {})
  }
}

function requestSpec(value) {
  if (!isObject(value)) return {}
  const spec = { method: typeof value.method === 'string' ? value.method : 'GET', path: String(value.path || '') }
  if (isObject(value.headers)) spec.headers = { ...value.headers }
  if (value.body !== undefined) spec.body = value.body
  return spec
}

function githubResponse(value) {
  return {
    status: Number.isInteger(value?.status) ? value.status : 0,
    etag: typeof value?.etag === 'string' ? value.etag : null,
    data: value?.data ?? null,
    rateRemaining: Number.isFinite(value?.rateRemaining) ? value.rateRemaining : null
  }
}

function legacyState(value) {
  if (!isObject(value)) return null
  return {
    lastSyncedCommitSha: typeof value.lastSyncedCommitSha === 'string' ? value.lastSyncedCommitSha : null,
    baseManifest: isObject(value.baseManifest) ? value.baseManifest : null,
    perDoc: isObject(value.perDoc) ? value.perDoc : {},
    machineId: typeof value.machineId === 'string' ? value.machineId : null
  }
}

const mindflowSync = Object.freeze({
  async getConfig() {
    return publicConfig(await ipcRenderer.invoke(CHANNELS.getConfig))
  },

  async setConfig(value) {
    return actionResult(await ipcRenderer.invoke(CHANNELS.setConfig, configPatch(value)))
  },

  async githubRequest(value) {
    return githubResponse(await ipcRenderer.invoke(CHANNELS.githubRequest, requestSpec(value)))
  },

  async getLegacyState() {
    return legacyState(await ipcRenderer.invoke(CHANNELS.getLegacyState))
  },

  async waitForStartup() {
    return (await ipcRenderer.invoke(CHANNELS.startupReady)) === true
  },

  // 只回 { ok, error }：含 PAT 的 QR 由 main process 畫在獨立視窗，renderer 永遠拿不到內容。
  async showPairingQr() {
    return actionResult(await ipcRenderer.invoke(CHANNELS.showPairingQr))
  }
})

contextBridge.exposeInMainWorld('mindflowSync', mindflowSync)
