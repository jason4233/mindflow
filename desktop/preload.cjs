'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = Object.freeze({
  getConfig: 'mindflow-sync:get-config',
  setConfig: 'mindflow-sync:set-config',
  syncNow: 'mindflow-sync:sync-now',
  getStatus: 'mindflow-sync:get-status',
  statusChanged: 'mindflow-sync:status-changed'
})

const STATUS_STATES = new Set(['disabled', 'idle', 'syncing', 'offline', 'error'])

function publicConfig(value) {
  // main process 即使日後誤回 token/tokenCipher，preload 仍是最後一道資料邊界。
  return {
    enabled: value?.enabled === true,
    repo: typeof value?.repo === 'string' ? value.repo : '',
    hasToken: value?.hasToken === true
  }
}

function configPatch(value) {
  if (!value || typeof value !== 'object') return {}

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

function publicStatus(value) {
  return {
    state: STATUS_STATES.has(value?.state) ? value.state : 'error',
    lastSyncAt: typeof value?.lastSyncAt === 'string' ? value.lastSyncAt : null,
    lastError: typeof value?.lastError === 'string' ? value.lastError : null,
    docCount: Number.isInteger(value?.docCount) && value.docCount >= 0 ? value.docCount : 0
  }
}

const mindflowSync = Object.freeze({
  async getConfig() {
    return publicConfig(await ipcRenderer.invoke(CHANNELS.getConfig))
  },

  async setConfig(value) {
    return actionResult(await ipcRenderer.invoke(CHANNELS.setConfig, configPatch(value)))
  },

  async syncNow() {
    return actionResult(await ipcRenderer.invoke(CHANNELS.syncNow))
  },

  async getStatus() {
    return publicStatus(await ipcRenderer.invoke(CHANNELS.getStatus))
  },

  onStatus(callback) {
    if (typeof callback !== 'function') throw new TypeError('A status callback is required')

    const listener = (_event, status) => callback(publicStatus(status))
    ipcRenderer.on(CHANNELS.statusChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.statusChanged, listener)
  }
})

contextBridge.exposeInMainWorld('mindflowSync', mindflowSync)
