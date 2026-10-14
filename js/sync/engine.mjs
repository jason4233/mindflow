/**
 * 同步引擎 v2：電腦（Electron renderer）與手機（Capacitor WebView）共用的一份實作。
 * 平台差異全部在 platform（設定、權杖、HTTP），傳輸在 transport（M2a：GitHub；M3 起 Firebase）。
 *
 * 推拉節奏（GitHub 加速版，計畫 3.8）：
 * - 存檔後等 5 秒、連續修改最多 30 秒才推；兩次推送至少間隔 60 秒（GitHub 次級寫入限制）。
 * - 前景每 20 秒比一次 ETag（304 不算限額）；取得焦點、回前景、恢復網路時立刻拉。
 * - 進背景、返回鍵離開、關窗：立刻推（不受最小間隔限制）。
 */
import { SyncLocalChangedError, buildLocalState, changedSince } from '../sync-plan.mjs'
import { sha256Hex } from './assets.mjs'
import { createHlcClock } from './hlc.mjs'
import { applyStorageWrites, observeMindflowStorage, readStorageEntries } from './local-storage.mjs'
import { RemoteManifestError, reconcileOnce } from './reconcile.mjs'
import { TransportConflictError, TransportError, createGitHubTransport, redactSecret } from './transport-github.mjs'

export const DEFAULT_CADENCE = Object.freeze({
  pushDebounceMs: 5_000,
  pushMaxWaitMs: 30_000,
  minPushIntervalMs: 60_000,
  pollIntervalMs: 20_000,
  focusThrottleMs: 10_000,
  retryInitialMs: 30_000,
  retryMaxMs: 5 * 60_000
})
const REF_CONFLICT_ATTEMPTS = 3
const LOCAL_CHANGE_ATTEMPTS = 3
const DIAGNOSTIC_LIMIT = 30
// 因本機剛有修改而要求的同步：撞上正在跑的一輪時，結束後要再跑一次（那一輪的快照可能早於修改）。
const LOCAL_CHANGE_REASONS = new Set(['local-change', 'hidden-change', 'hidden', 'flush', 'back-button', 'app-pause', 'pagehide', 'exit', 'window-close', 'config'])
const STATUS_STATES = new Set(['disabled', 'idle', 'syncing', 'offline', 'error'])
const STATE_KEY = 'state'
const CLOCK_KEY = 'clock'
const MACHINE_KEY = 'machineId'
const ASSET_PREFIX = 'asset:'

function publicStatus(value) {
  const result = {
    state: STATUS_STATES.has(value?.state) ? value.state : 'error',
    lastSyncAt: typeof value?.lastSyncAt === 'string' ? value.lastSyncAt : null,
    lastError: typeof value?.lastError === 'string' ? value.lastError : null,
    docCount: Number.isInteger(value?.docCount) && value.docCount >= 0 ? value.docCount : 0
  }
  if (typeof value?.warning === 'string' && value.warning.trim()) result.warning = value.warning.trim().slice(0, 500)
  return result
}

/** HLC 的裝置 id 只能用 [A-Za-z0-9._-]，最多 64 字；舊版的 machineId（含主機名稱）也要能用。 */
export function sanitizeMachineId(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64)
  return cleaned || null
}

function randomMachineId(prefix) {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${random}`
}

function emptySyncState() {
  return { lastSyncedCommitSha: null, baseManifest: null, perDoc: {}, pending: {}, etag: null, lastSyncAt: null, storeEpoch: null }
}

function normalizeSyncState(value) {
  const source = value && typeof value === 'object' ? value : {}
  const isObject = item => item !== null && typeof item === 'object' && !Array.isArray(item)
  return {
    lastSyncedCommitSha: typeof source.lastSyncedCommitSha === 'string' ? source.lastSyncedCommitSha : null,
    baseManifest: isObject(source.baseManifest) ? source.baseManifest : null,
    perDoc: isObject(source.perDoc) ? source.perDoc : {},
    pending: isObject(source.pending) ? source.pending : {},
    etag: typeof source.etag === 'string' ? source.etag : null,
    lastSyncAt: typeof source.lastSyncAt === 'string' ? source.lastSyncAt : null,
    storeEpoch: typeof source.storeEpoch === 'string' ? source.storeEpoch : null
  }
}

/**
 * @param {object} options
 * @param {object} options.platform  見 platform-mobile.mjs／platform-desktop.mjs 的契約
 * @param {Storage} options.storage
 * @param {object} options.kv        js/sync/kv.mjs 的 KV
 */
export function createSyncEngine({
  platform,
  storage = globalThis.localStorage,
  kv,
  now = () => new Date(),
  monotonic = () => Date.now(),
  hash = sha256Hex,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  cadence = {},
  observeLocalChanges,
  dispatchSyncApplied,
  startGate = null,
  autoStart = true,
  transportFactory = createGitHubTransport
} = {}) {
  if (!platform || typeof platform.loadConfig !== 'function') throw new TypeError('platform is required')
  if (!kv || typeof kv.get !== 'function') throw new TypeError('kv is required')
  if (!storage || typeof storage.getItem !== 'function') throw new TypeError('localStorage is required')
  const timing = { ...DEFAULT_CADENCE, ...cadence }
  const listeners = new Set()
  const diagnostics = []
  let config = { enabled: false, repo: '', branch: 'main', hasToken: false }
  let syncState = emptySyncState()
  let machineId = null
  let clock = null
  let status = publicStatus({ state: 'disabled', docCount: 0 })
  let runningSync = null
  let applyingRemote = false
  let disposed = false
  let started = false
  let unsubscribe = null
  let pushTimer = null
  let pendingSince = null
  let lastPushAt = -Infinity
  let pollTimer = null
  let retryTimer = null
  let retryDelayMs = timing.retryInitialMs
  let lastFocusPullAt = -Infinity
  let warning = null
  let rerunRequested = false
  let reconfiguring = Promise.resolve()

  const assetCache = Object.freeze({
    get: sha => kv.get(`${ASSET_PREFIX}${sha}`),
    set: (sha, value) => kv.set(`${ASSET_PREFIX}${sha}`, value)
  })

  const ready = Promise.resolve(startGate).catch(() => {}).then(async () => {
    config = await platform.loadConfig()
    let stored = await kv.get(STATE_KEY)
    machineId = sanitizeMachineId(await kv.get(MACHINE_KEY))
    if (stored === undefined) {
      // 從 M1 升級：舊引擎的 base 搬過來一次（搬不到就當首次同步：只做聯集，不刪任何東西）。
      const legacy = await platform.loadLegacyState?.().catch(() => null)
      if (legacy && typeof legacy === 'object') {
        stored = normalizeSyncState(legacy)
        machineId = machineId || sanitizeMachineId(legacy.machineId)
        await kv.set(STATE_KEY, stored)
      }
    }
    syncState = normalizeSyncState(stored)
    if (!machineId) machineId = sanitizeMachineId(await platform.defaultMachineId?.()) || randomMachineId(platform.kind || 'device')
    await kv.set(MACHINE_KEY, machineId)
    clock = createHlcClock({ node: machineId, last: await kv.get(CLOCK_KEY), wallClock: () => now().getTime() })
    setStatus({ state: isEnabled() ? 'idle' : 'disabled', lastSyncAt: syncState.lastSyncAt, docCount: countDocs() })
  })

  function isEnabled() {
    return config.enabled === true && Boolean(config.repo) && config.hasToken === true
  }

  function countDocs() {
    try {
      return Object.keys(buildLocalState(readStorageEntries(storage)).docs).length
    } catch {
      return 0
    }
  }

  function setStatus(patch) {
    status = publicStatus({ ...status, ...patch })
    for (const listener of listeners) {
      try { listener(publicStatus(status)) } catch { /* UI 監聽者不能中止同步 */ }
    }
  }

  function recordDiagnostic(entry) {
    diagnostics.push({ at: now().toISOString(), ...entry })
    if (diagnostics.length > DIAGNOSTIC_LIMIT) diagnostics.splice(0, diagnostics.length - DIAGNOSTIC_LIMIT)
  }

  function safeMessage(error) {
    return redactSecret(error instanceof Error ? error.message : String(error || '同步失敗'), platform.secretForRedaction?.() || '').slice(0, 300)
  }

  function emitSyncApplied(detail) {
    if (typeof dispatchSyncApplied === 'function') {
      dispatchSyncApplied(detail)
      return
    }
    const Constructor = windowRef?.CustomEvent || globalThis.CustomEvent
    if (windowRef?.dispatchEvent && typeof Constructor === 'function') {
      windowRef.dispatchEvent(new Constructor('mindflow:sync-applied', { detail }))
    }
  }

  function transport() {
    return transportFactory({ request: platform.createRequest(config), repo: config.repo, branch: config.branch || 'main', clientLabel: 'MindFlow' })
  }

  // ── 重試 ──
  function cancelRetry() {
    clearTimeoutFn(retryTimer)
    retryTimer = null
  }

  function resetRetry() {
    cancelRetry()
    retryDelayMs = timing.retryInitialMs
  }

  function scheduleRetry(error) {
    if (error?.code === 'SCHEMA_TOO_NEW' || error instanceof RemoteManifestError) return
    if (error instanceof TransportError && !error.retryable && ![0, 409, 422].includes(error.status)) return
    if (!started || disposed || !isEnabled() || retryTimer) return
    const delay = retryDelayMs
    retryDelayMs = Math.min(timing.retryMaxMs, delay * 2)
    retryTimer = setTimeoutFn(() => {
      retryTimer = null
      void api.syncNow({ reason: 'retry' })
    }, delay)
  }

  // ── 一次完整同步 ──
  async function runSync() {
    setStatus({ state: 'syncing', lastError: null })
    const syncNow = now()
    const remote = transport()
    const repoInfo = await remote.ensureRepo()
    const pushedThisRun = new Map()
    let refConflicts = 0
    let localChanges = 0
    let outcome
    for (;;) {
      try {
        outcome = await reconcileOnce({
          transport: remote,
          entries: readStorageEntries(storage),
          state: syncState,
          machineId,
          clock,
          assetCache,
          syncNow,
          pushedThisRun,
          hash,
          label: platform.label || 'MindFlow',
          changedLocalKeys: expected => changedSince(expected, key => storage.getItem(key))
        })
      } catch (error) {
        if (error instanceof TransportConflictError) {
          refConflicts += 1
          if (refConflicts < REF_CONFLICT_ATTEMPTS) continue
        } else if (error instanceof SyncLocalChangedError) {
          localChanges += 1
          if (localChanges < LOCAL_CHANGE_ATTEMPTS) continue
        }
        // 這一輪已蓋的 HLC 章要留下來（下一次同步沿用），否則較早的修改會被蓋成較新的章。
        await kv.set(STATE_KEY, syncState).catch(() => {})
        throw error
      }
      for (const [id, raw] of Object.entries(outcome.pushedDocs)) pushedThisRun.set(id, raw)
      if (outcome.pushed) lastPushAt = monotonic()
      if (outcome.localChanged) {
        applyingRemote = true
        let applied
        try {
          applied = applyStorageWrites(storage, outcome.writes, emitSyncApplied)
        } finally {
          applyingRemote = false
        }
        if (applied?.conflict) {
          localChanges += 1
          if (localChanges < LOCAL_CHANGE_ATTEMPTS) continue
          throw new SyncLocalChangedError(applied.changedKeys)
        }
      }
      break
    }
    syncState = normalizeSyncState(outcome.nextState)
    await kv.set(STATE_KEY, syncState)
    await kv.set(CLOCK_KEY, clock.current())
    const warnings = []
    if (!repoInfo.private) warnings.push('GitHub repo 是 public，心智圖內容可能公開；請立即改為 private。')
    if (outcome.quarantinedIds.length) warnings.push(`本機有損壞文件已隔離：${outcome.quarantinedIds.slice(0, 5).join(', ')}。`)
    warning = warnings.length ? warnings.join(' ') : null
    setStatus({ state: 'idle', lastSyncAt: syncState.lastSyncAt, lastError: null, docCount: countDocs(), warning })
    return { warning, pushed: outcome.pushed, uploadedAssets: outcome.uploadedAssets }
  }

  // ── 排程 ──
  function hidden() {
    return documentRef?.visibilityState === 'hidden'
  }

  function clearPushTimer() {
    clearTimeoutFn(pushTimer)
    pushTimer = null
  }

  function schedulePush() {
    const current = monotonic()
    pendingSince = pendingSince ?? current
    // 停手 5 秒才推，但從第一次修改起最多等 30 秒；而且距上次推送至少 60 秒。
    let delay = Math.min(timing.pushDebounceMs, Math.max(0, pendingSince + timing.pushMaxWaitMs - current))
    delay = Math.max(delay, lastPushAt + timing.minPushIntervalMs - current)
    clearPushTimer()
    pushTimer = setTimeoutFn(() => {
      pushTimer = null
      pendingSince = null
      return api.syncNow({ reason: 'local-change' })
    }, Math.max(0, delay))
  }

  function onLocalChange() {
    if (applyingRemote || !isEnabled()) return
    if (hidden()) {
      // 已經在背景還在存檔（例如離開時最後一次存檔）：趁 WebView 被凍結前直接推。
      clearPushTimer()
      pendingSince = null
      void api.syncNow({ reason: 'hidden-change' })
      return
    }
    schedulePush()
  }

  async function poll(reason = 'poll') {
    if (disposed || !isEnabled() || runningSync) return
    try {
      const head = await transport().getHead({ etag: syncState.etag || undefined })
      const recovering = status.state === 'offline' || status.state === 'error'
      if (!head.notModified || recovering) await api.syncNow({ reason: head.notModified ? 'recover' : reason })
    } catch (error) {
      const message = reportFailure(error)
      recordDiagnostic({ reason, ok: false, error: message })
    }
  }

  function pull(reason) {
    // 有等待中的本機修改就直接完整同步（順便推）；沒有就先比 ETag。
    if (pushTimer) {
      clearPushTimer()
      pendingSince = null
      return api.syncNow({ reason })
    }
    return poll(reason)
  }

  function startPolling() {
    if (pollTimer || !(timing.pollIntervalMs > 0)) return
    pollTimer = setIntervalFn(() => Promise.resolve().then(() => poll('poll')).catch(() => {}), timing.pollIntervalMs)
    pollTimer?.unref?.()
  }

  function stopPolling() {
    if (!pollTimer) return
    clearIntervalFn(pollTimer)
    pollTimer = null
  }

  const onVisibilityChange = () => {
    if (documentRef?.visibilityState === 'visible') {
      startPolling()
      void pull('visibility')
    } else if (hidden()) {
      stopPolling()
      void api.flush('hidden')
    }
  }
  const onOnline = () => { void pull('online') }
  const onFocus = () => {
    const current = monotonic()
    if (current - lastFocusPullAt < timing.focusThrottleMs) return
    lastFocusPullAt = current
    void pull('focus')
  }

  function startLifecycle() {
    if (started) return
    started = true
    const observe = typeof observeLocalChanges === 'function'
      ? observeLocalChanges
      : callback => observeMindflowStorage(storage, callback)
    unsubscribe = observe(onLocalChange)
    documentRef?.addEventListener?.('visibilitychange', onVisibilityChange)
    windowRef?.addEventListener?.('online', onOnline)
    windowRef?.addEventListener?.('focus', onFocus)
    if (!hidden()) startPolling()
  }

  function stopLifecycle() {
    if (!started) return
    started = false
    clearPushTimer()
    pendingSince = null
    stopPolling()
    resetRetry()
    unsubscribe?.()
    unsubscribe = null
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange)
    windowRef?.removeEventListener?.('online', onOnline)
    windowRef?.removeEventListener?.('focus', onFocus)
  }

  function reportFailure(error) {
    const offline = error instanceof TransportError && error.status === 0
    const message = safeMessage(error)
    setStatus({ state: offline ? 'offline' : 'error', lastError: message })
    scheduleRetry(error)
    return message
  }

  const api = Object.freeze({
    ready,

    async start() {
      await ready
      if (disposed || !isEnabled()) return
      const first = !started
      startLifecycle()
      if (first) await api.syncNow({ reason: 'startup' })
    },

    async getConfig() {
      await ready
      const result = { enabled: config.enabled === true, repo: config.repo || '', hasToken: config.hasToken === true }
      if (config.tokenStorage) result.tokenStorage = config.tokenStorage
      if (config.warning) result.warning = config.warning
      return result
    },

    async setConfig(patch = {}) {
      await ready
      // 設定變更期間不開始新的同步（計時器觸發的同步會用舊 repo 跑、把舊 base 寫回來）。
      let finish
      const previousReconfigure = reconfiguring
      reconfiguring = new Promise(resolve => { finish = resolve })
      await previousReconfigure
      try {
        await runningSync?.catch(() => {})
        const previous = config
        const result = await platform.saveConfig(patch)
        if (!result?.ok) return { ok: false, error: result?.error || '設定儲存失敗' }
        config = await platform.loadConfig()
        const targetChanged = Boolean(previous.repo) && (previous.repo !== config.repo || (previous.branch || 'main') !== (config.branch || 'main'))
        // 換到別的 repo／分支：舊 base 不能拿來跟新 repo 比，改當首次同步（只做聯集）。
        if (targetChanged) {
          syncState = emptySyncState()
          await kv.set(STATE_KEY, syncState)
        }
        finish()
        if (!isEnabled()) {
          stopLifecycle()
          setStatus({ state: 'disabled', lastError: null, warning: null })
        } else {
          setStatus({ state: 'idle', lastError: null })
          if (autoStart) {
            // 已在運作時 start() 不會再同步：配對或換 repo／權杖後要立刻同步，而不是等下一次輪詢。
            if (started && (targetChanged || Object.hasOwn(patch, 'token'))) await api.syncNow({ reason: 'config' })
            else await api.start()
          }
        }
        return { ok: true }
      } finally {
        finish()
      }
    },

    async syncNow(options = {}) {
      await ready
      if (disposed || !isEnabled()) {
        setStatus({ state: 'disabled', lastError: null })
        return { ok: false, error: 'Sync is disabled' }
      }
      await reconfiguring
      if (disposed || !isEnabled()) return { ok: false, error: 'Sync is disabled' }
      if (runningSync) {
        if (LOCAL_CHANGE_REASONS.has(options?.reason)) rerunRequested = true
        return runningSync
      }
      const reason = typeof options?.reason === 'string' ? options.reason : 'manual'
      const startedAt = monotonic()
      cancelRetry()
      runningSync = runSync()
        .then(outcome => {
          resetRetry()
          recordDiagnostic({ reason, ok: true, durationMs: monotonic() - startedAt, pushed: outcome.pushed, ...(outcome.warning ? { warning: outcome.warning } : {}) })
          return outcome.warning ? { ok: true, warning: outcome.warning } : { ok: true }
        })
        .catch(error => {
          const message = reportFailure(error)
          recordDiagnostic({ reason, ok: false, durationMs: monotonic() - startedAt, error: message })
          return { ok: false, error: message }
        })
        .finally(() => {
          runningSync = null
          const rerun = rerunRequested && !disposed && isEnabled()
          rerunRequested = false
          if (rerun) void api.syncNow({ reason: 'rerun' })
        })
      return runningSync
    },

    /** 有等待中的本機修改就立刻推（不受最小間隔限制）；回傳這次同步的結果。 */
    async flush(reason = 'flush') {
      await ready
      if (!isEnabled()) return { ok: true, skipped: true }
      await runningSync?.catch(() => {})
      if (!pushTimer) return { ok: true, skipped: true }
      clearPushTimer()
      pendingSince = null
      return api.syncNow({ reason })
    },

    async getStatus() {
      await ready
      return publicStatus(status)
    },

    onStatus(listener) {
      if (typeof listener !== 'function') throw new TypeError('A status listener is required')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async getDiagnostics() {
      await ready
      return diagnostics.map(entry => ({ ...entry }))
    },

    async dispose() {
      disposed = true
      stopLifecycle()
      await runningSync?.catch(() => {})
      listeners.clear()
    }
  })

  if (autoStart) void api.start()
  return api
}
