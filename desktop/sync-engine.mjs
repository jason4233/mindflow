import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import {
  SyncHttpError,
  createBlob,
  createCommit,
  createTree,
  ensureRepo,
  getBlobRaw,
  getCommit,
  getRef,
  getTreeRecursive,
  updateRef
} from './sync-github.mjs'
import {
  buildConflictCopy,
  buildLocalState,
  computeLocalWrites,
  computeSyncPlan,
  emptyManifest
} from './sync-plan.mjs'
import {
  getDecryptedToken,
  loadSyncSettings,
  saveSyncSettings
} from './sync-settings.mjs'

export const FINGERPRINT_INTERVAL_MS = 15_000
export const CHANGE_DEBOUNCE_MS = 45_000
export const PULL_INTERVAL_MS = 5 * 60_000
export const FOCUS_THROTTLE_MS = 10_000
export const CLOSE_FLUSH_TIMEOUT_MS = 10_000

const RETRY_INITIAL_MS = 30_000
const RETRY_MAX_MS = 5 * 60_000
const UPDATE_REF_ATTEMPTS = 3
const STATE_FILENAME = 'sync-state.json'
const MANIFEST_PATH = 'manifest.json'
const INDEX_KEY = 'mindflow.docs.index'
const DOC_KEY_PREFIX = 'mindflow.doc.'
const STATUS_STATES = new Set(['disabled', 'idle', 'syncing', 'offline', 'error'])

const IPC_CHANNELS = Object.freeze({
  getConfig: 'mindflow-sync:get-config',
  setConfig: 'mindflow-sync:set-config',
  syncNow: 'mindflow-sync:sync-now',
  getStatus: 'mindflow-sync:get-status',
  statusChanged: 'mindflow-sync:status-changed'
})

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function machineIdentity() {
  const label = hostname().trim() || 'mindflow-device'
  return `${label}-${randomBytes(2).toString('hex')}`
}

function statePath(userDataPath) {
  if (typeof userDataPath !== 'string' || !userDataPath) throw new TypeError('A userData path is required')
  return join(userDataPath, STATE_FILENAME)
}

function normalizeState(value, fallbackMachineId) {
  const source = isObject(value) ? value : {}
  return {
    lastSyncedCommitSha: typeof source.lastSyncedCommitSha === 'string' ? source.lastSyncedCommitSha : null,
    baseManifest: isObject(source.baseManifest) ? source.baseManifest : null,
    perDoc: isObject(source.perDoc) ? source.perDoc : {},
    machineId: typeof source.machineId === 'string' && source.machineId
      ? source.machineId
      : fallbackMachineId,
    etag: typeof source.etag === 'string' ? source.etag : null,
    lastSyncAt: typeof source.lastSyncAt === 'string' ? source.lastSyncAt : null
  }
}

async function loadSyncState(userDataPath, fallbackMachineId) {
  try {
    const parsed = JSON.parse(await readFile(statePath(userDataPath), 'utf8'))
    return normalizeState(parsed, fallbackMachineId)
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return normalizeState(null, fallbackMachineId)
    }
    throw error
  }
}

async function saveSyncState(userDataPath, state) {
  const normalized = normalizeState(state, state.machineId)
  const path = statePath(userDataPath)
  const temporaryPath = `${path}.tmp`
  await mkdir(userDataPath, { recursive: true })
  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

function stableJson(value) {
  return JSON.stringify(canonical(value))
}

function manifestsDiffer(remote, next) {
  const withoutWriter = manifest => ({ ...manifest, lastWriter: null })
  return stableJson(withoutWriter(remote)) !== stableJson(withoutWriter(next))
}

function documentPath(id) {
  return `docs/${encodeURIComponent(id)}.json`
}

function idFromDocumentPath(path) {
  const match = /^docs\/(.+)\.json$/u.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function fingerprint(entries) {
  const relevant = Object.fromEntries(
    Object.entries(isObject(entries) ? entries : {})
      .filter(([key, value]) => (
        (key === INDEX_KEY || key.startsWith(DOC_KEY_PREFIX)) &&
        !key.startsWith('mindflow.history.') &&
        typeof value === 'string'
      ))
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex')
}

function safeErrorMessage(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error || 'Unknown sync error')
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]')
  }
  return message.slice(0, 500)
}

function publicStatus(value) {
  const status = {
    state: STATUS_STATES.has(value?.state) ? value.state : 'error',
    lastSyncAt: typeof value?.lastSyncAt === 'string' ? value.lastSyncAt : null,
    lastError: typeof value?.lastError === 'string' ? value.lastError : null,
    docCount: Number.isInteger(value?.docCount) && value.docCount >= 0 ? value.docCount : 0
  }
  if (typeof value?.warning === 'string' && value.warning.trim()) status.warning = value.warning.trim().slice(0, 500)
  return status
}

function timerUnref(timer) {
  timer?.unref?.()
  return timer
}

async function withTimeout(promise, timeoutMs) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs)
        timerUnref(timeout)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export function createStorageQueue() {
  let tail = Promise.resolve()
  return Object.freeze({
    run(task) {
      if (typeof task !== 'function') return Promise.reject(new TypeError('storageQueue task must be a function'))
      const result = tail.catch(() => {}).then(task)
      tail = result.catch(() => {})
      return result
    },
    drain() {
      return tail
    }
  })
}

function rendererReadScript({ flush = false } = {}) {
  return `(() => {
    ${flush ? "window.dispatchEvent(new Event('beforeunload'));" : ''}
    return Object.fromEntries(
      Object.keys(localStorage)
        .filter(key => key.startsWith('mindflow.'))
        .sort()
        .map(key => [key, localStorage.getItem(key)])
    );
  })()`
}

function rendererApplyScript(writes) {
  const serialized = JSON.stringify(JSON.stringify(writes))
  return `(() => {
    const writes = JSON.parse(${serialized});
    const indexKey = 'mindflow.docs.index';
    const removeKeys = [...new Set(Array.isArray(writes.removeKeys) ? writes.removeKeys : [])];
    const setEntries = Object.entries(writes.setKeys || {});
    const touched = [...new Set([...removeKeys, ...setEntries.map(([key]) => key)])];
    const previous = touched.map(key => ({ key, present: localStorage.getItem(key) !== null, value: localStorage.getItem(key) }));
    try {
      for (const key of removeKeys) localStorage.removeItem(key);
      for (const [key, value] of setEntries) {
        if (key !== indexKey) localStorage.setItem(key, value);
      }
      const indexEntry = setEntries.find(([key]) => key === indexKey);
      if (indexEntry) localStorage.setItem(indexEntry[0], indexEntry[1]);
    } catch (error) {
      for (const item of previous) {
        try {
          if (item.present) localStorage.setItem(item.key, item.value);
          else localStorage.removeItem(item.key);
        } catch {}
      }
      throw error;
    }
    const changedDocIds = touched
      .filter(key => key.startsWith('mindflow.doc.'))
      .map(key => key.slice('mindflow.doc.'.length));
    window.dispatchEvent(new CustomEvent('mindflow:sync-applied', { detail: { changedDocIds } }));
    return { changedDocIds, changedKeyCount: touched.length };
  })()`
}

export function createRendererStorageAdapter(window) {
  if (!window?.webContents) throw new TypeError('A BrowserWindow is required')

  function usable() {
    return !window.isDestroyed?.() && !window.webContents.isDestroyed?.()
  }

  return Object.freeze({
    async readEntries({ flush = false } = {}) {
      if (!usable()) return {}
      return window.webContents.executeJavaScript(rendererReadScript({ flush }), true)
    },
    async applyWrites(writes) {
      if (!usable()) throw new Error('Renderer is unavailable')
      // 同步套用必須維持單一 renderer transaction；script 內 doc-first、index-last，失敗即 rollback。
      return window.webContents.executeJavaScript(rendererApplyScript(writes), true)
    }
  })
}

class SyncEngine {
  constructor(options = {}) {
    this.userDataPath = options.userDataPath
    this.storageQueue = options.storageQueue || createStorageQueue()
    this.readEntries = options.readEntries || options.readLocalEntries || options.getLocalEntries
    this.applyWrites = options.applyWrites || options.applyLocalWrites
    if (typeof this.readEntries !== 'function' || typeof this.applyWrites !== 'function') {
      throw new TypeError('Sync engine requires renderer readEntries and applyWrites callbacks')
    }

    const suppliedCfg = options.cfg || options.config || {}
    this.cfg = {
      apiBase: suppliedCfg.apiBase,
      token: suppliedCfg.token || '',
      repo: suppliedCfg.repo || '',
      branch: suppliedCfg.branch || 'main',
      enabled: suppliedCfg.enabled !== false
    }
    this.machineIdOverride = options.machineId || null
    this.now = typeof options.now === 'function' ? options.now : () => new Date()
    this.listeners = new Set()
    if (typeof options.onStatus === 'function') this.listeners.add(options.onStatus)
    this.status = publicStatus({
      state: this.isEnabled() ? 'idle' : 'disabled',
      lastSyncAt: null,
      lastError: null,
      docCount: 0
    })
    this.runningSync = null
    this.started = false
    this.disposed = false
    this.currentFingerprint = null
    this.fingerprintTimer = null
    this.pullTimer = null
    this.changeTimer = null
    this.retryTimer = null
    this.retryDelayMs = RETRY_INITIAL_MS
    this.lastFocusSyncAt = 0
  }

  isEnabled() {
    return this.cfg.enabled === true && Boolean(this.cfg.repo && this.cfg.token)
  }

  getStatus() {
    return publicStatus(this.status)
  }

  getConfig() {
    return {
      enabled: this.cfg.enabled === true,
      repo: this.cfg.repo,
      hasToken: Boolean(this.cfg.token)
    }
  }

  onStatus(listener) {
    if (typeof listener !== 'function') throw new TypeError('A status listener is required')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setStatus(patch) {
    this.status = publicStatus({ ...this.status, ...patch })
    for (const listener of this.listeners) {
      try { listener(this.getStatus()) } catch { /* 狀態 consumer 不得中斷同步。 */ }
    }
  }

  updateConfig(next = {}) {
    this.cfg = {
      apiBase: next.apiBase ?? this.cfg.apiBase,
      token: next.token ?? this.cfg.token,
      repo: next.repo ?? this.cfg.repo,
      branch: next.branch ?? this.cfg.branch,
      enabled: next.enabled ?? this.cfg.enabled
    }
    if (!this.isEnabled()) {
      this.cancelScheduledWork()
      this.setStatus({ state: 'disabled', lastError: null })
    } else if (this.status.state === 'disabled') {
      this.setStatus({ state: 'idle', lastError: null })
      if (this.started) this.installIntervals()
    }
  }

  start({ startup = true } = {}) {
    if (this.disposed || this.started) return
    this.started = true
    if (!this.isEnabled()) {
      this.setStatus({ state: 'disabled', lastError: null })
      return
    }
    this.installIntervals()
    if (startup) void this.syncNow({ reason: 'startup' })
  }

  installIntervals() {
    if (!this.started || !this.isEnabled()) return
    if (!this.fingerprintTimer) {
      this.fingerprintTimer = timerUnref(setInterval(() => {
        void this.pollFingerprint()
      }, FINGERPRINT_INTERVAL_MS))
    }
    if (!this.pullTimer) {
      this.pullTimer = timerUnref(setInterval(() => {
        void this.pollRemote()
      }, PULL_INTERVAL_MS))
    }
  }

  async pollFingerprint() {
    if (!this.isEnabled() || this.disposed) return
    try {
      const entries = await this.storageQueue.run(() => this.readEntries())
      const nextFingerprint = fingerprint(entries)
      if (this.currentFingerprint === null) {
        this.currentFingerprint = nextFingerprint
        return
      }
      if (nextFingerprint === this.currentFingerprint) return
      this.currentFingerprint = nextFingerprint
      clearTimeout(this.changeTimer)
      this.changeTimer = timerUnref(setTimeout(() => {
        this.changeTimer = null
        void this.syncNow({ reason: 'local-change' })
      }, CHANGE_DEBOUNCE_MS))
    } catch (error) {
      this.handleFailure(error)
    }
  }

  async pollRemote() {
    if (!this.isEnabled() || this.disposed || this.runningSync) return
    try {
      const state = await loadSyncState(this.userDataPath, this.machineIdOverride || machineIdentity())
      const result = await getRef(this.cfg, { etag: state.etag || undefined })
      if (!result.notModified) await this.syncNow({ reason: 'etag-pull' })
    } catch (error) {
      this.handleFailure(error)
    }
  }

  handleFocus() {
    if (!this.isEnabled() || this.disposed) return
    const current = Date.now()
    if (current - this.lastFocusSyncAt < FOCUS_THROTTLE_MS) return
    this.lastFocusSyncAt = current
    void this.syncNow({ reason: 'focus' })
  }

  syncNow(_options = {}) {
    if (!this.isEnabled()) {
      this.setStatus({ state: 'disabled', lastError: null })
      return Promise.resolve({ ok: false, error: 'Sync is disabled' })
    }
    if (this.runningSync) return this.runningSync

    this.runningSync = this.runSync()
      .then(outcome => outcome?.warning ? { ok: true, warning: outcome.warning } : { ok: true })
      .catch(error => {
        this.handleFailure(error)
        return { ok: false, error: safeErrorMessage(error, [this.cfg.token]) }
      })
      .finally(() => { this.runningSync = null })
    return this.runningSync
  }

  async runSync() {
    this.setStatus({ state: 'syncing', lastError: null, warning: null })
    clearTimeout(this.changeTimer)
    this.changeTimer = null

    const startedAt = this.now()
    const fallbackMachineId = this.machineIdOverride || machineIdentity()
    const previousState = await loadSyncState(this.userDataPath, fallbackMachineId)
    let outcome

    const repoStatus = await ensureRepo(this.cfg)
    for (let attempt = 1; attempt <= UPDATE_REF_ATTEMPTS; attempt += 1) {
      try {
        outcome = await this.reconcileAttempt(previousState, startedAt)
        break
      } catch (error) {
        const refConflict = error instanceof SyncHttpError && error.status === 422
        if (!refConflict || attempt === UPDATE_REF_ATTEMPTS) throw error
        // 422 是 compare-and-swap 競爭；必須回到 ref pull 重新合併，不可 force push。
      }
    }

    if (outcome.localChanged) {
      await this.storageQueue.run(() => this.applyWrites(outcome.writes))
    }
    // renderer 套用成功後才允許前進 base；失敗時 state file 保持原值。
    await saveSyncState(this.userDataPath, outcome.nextState)

    const finalEntries = outcome.localChanged
      ? await this.storageQueue.run(() => this.readEntries())
      : outcome.entries
    this.currentFingerprint = fingerprint(finalEntries)
    const localState = buildLocalState(finalEntries)
    const warnings = []
    if (!repoStatus.private) {
      warnings.push('GitHub repo 是 public，心智圖內容可能公開；請立即改為 private。')
    }
    if (outcome.quarantinedIds.length) {
      const visibleIds = outcome.quarantinedIds.slice(0, 5)
      const remainder = outcome.quarantinedIds.length - visibleIds.length
      warnings.push(`本機有損壞文件已隔離：${visibleIds.join(', ')}${remainder > 0 ? `（另 ${remainder} 份）` : ''}。`)
    }
    const warning = warnings.length ? warnings.join(' ') : null
    this.retryDelayMs = RETRY_INITIAL_MS
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.setStatus({
      state: 'idle',
      lastSyncAt: startedAt.toISOString(),
      lastError: null,
      docCount: Object.keys(localState.docs).length,
      warning
    })
    return warning ? { warning } : {}
  }

  async reconcileAttempt(previousState, syncNow) {
    const entries = await this.storageQueue.run(() => this.readEntries())
    const localState = buildLocalState(entries)
    const ref = await getRef(this.cfg)
    const commit = await getCommit(this.cfg, ref.sha)
    const tree = await getTreeRecursive(this.cfg, commit.treeSha)
    const manifestEntry = tree.byPath[MANIFEST_PATH]
    const remoteManifest = manifestEntry
      ? JSON.parse(await getBlobRaw(this.cfg, manifestEntry.sha))
      : emptyManifest()
    const base = previousState.lastSyncedCommitSha && previousState.baseManifest
      ? { manifest: previousState.baseManifest, perDoc: previousState.perDoc }
      : null
    const plan = computeSyncPlan({
      local: localState,
      remoteManifest,
      base,
      machineId: previousState.machineId,
      now: syncNow
    })
    const pulledBlobs = {}
    const readRemoteDoc = async id => {
      if (Object.hasOwn(pulledBlobs, id)) return pulledBlobs[id]
      const remoteEntry = tree.byPath[documentPath(id)]
      if (!remoteEntry) throw new Error(`Remote document blob is missing: ${id}`)
      pulledBlobs[id] = await getBlobRaw(this.cfg, remoteEntry.sha)
      return pulledBlobs[id]
    }
    for (const id of plan.pullDocs) await readRemoteDoc(id)

    const augmentedLocal = {
      docs: { ...localState.docs },
      favorites: [...localState.favorites],
      docBlobs: { ...localState.docBlobs }
    }
    const conflictBlobs = {}
    const pushIds = new Set(plan.pushDocs)
    const purgeIds = new Set(plan.purgeLocal)
    const addConflictCopy = (raw, label) => {
      const copy = buildConflictCopy(raw, label, syncNow)
      const document = JSON.parse(copy.json)
      conflictBlobs[copy.id] = copy.json
      augmentedLocal.docBlobs[copy.id] = copy.json
      augmentedLocal.docs[copy.id] = {
        title: copy.title,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        state: 'active'
      }
      plan.nextManifest.docs[copy.id] = { ...augmentedLocal.docs[copy.id] }
      plan.nextPerDoc[copy.id] = document.updatedAt
      pushIds.add(copy.id)
    }

    for (const conflict of plan.conflicts) {
      if (conflict.loserCopyFrom === 'local') {
        const raw = localState.docBlobs[conflict.id]
        if (typeof raw !== 'string') throw new Error(`Local conflict document blob is missing: ${conflict.id}`)
        addConflictCopy(raw, previousState.machineId)
      } else {
        addConflictCopy(await readRemoteDoc(conflict.id), remoteManifest.lastWriter || 'remote-device')
      }
    }
    for (const resurrection of plan.resurrect) {
      const localRaw = localState.docBlobs[resurrection.id]
      if (typeof localRaw === 'string') addConflictCopy(localRaw, previousState.machineId)
      else addConflictCopy(await readRemoteDoc(resurrection.id), remoteManifest.lastWriter || 'remote-device')
      purgeIds.add(resurrection.id)
    }
    plan.pushDocs = [...pushIds].sort()
    plan.purgeLocal = [...purgeIds].sort()
    plan.nextManifest.docs = canonical(plan.nextManifest.docs)
    plan.nextPerDoc = canonical(plan.nextPerDoc)

    const baseWrites = computeLocalWrites({ plan, pulledBlobs, localState: augmentedLocal })
    const setKeys = {}
    for (const [key, value] of Object.entries(baseWrites.setKeys)) {
      if (key !== INDEX_KEY) setKeys[key] = value
    }
    for (const [id, raw] of Object.entries(conflictBlobs)) setKeys[`${DOC_KEY_PREFIX}${id}`] = raw
    setKeys[INDEX_KEY] = baseWrites.setKeys[INDEX_KEY]

    const removeKeys = new Set(baseWrites.removeKeys)
    for (const id of purgeIds) {
      for (const key of Object.keys(entries)) {
        if (key !== INDEX_KEY && key.endsWith(`.${id}`)) removeKeys.add(key)
      }
    }
    const writes = { setKeys, removeKeys: [...removeKeys] }
    const localChanged = writes.removeKeys.some(key => Object.hasOwn(entries, key)) ||
      Object.entries(writes.setKeys).some(([key, value]) => entries[key] !== value)

    const remoteDocPaths = Object.keys(tree.byPath).filter(path => idFromDocumentPath(path))
    const desiredDocPaths = new Set(Object.keys(plan.nextManifest.docs).map(documentPath))
    const deletedRemotePaths = remoteDocPaths.filter(path => !desiredDocPaths.has(path))
    const needsPush = pushIds.size > 0 || deletedRemotePaths.length > 0 ||
      manifestsDiffer(remoteManifest, plan.nextManifest)

    let commitSha = ref.sha
    if (needsPush) {
      const treeEntries = []
      for (const id of [...pushIds].sort()) {
        const raw = augmentedLocal.docBlobs[id] ?? pulledBlobs[id]
        if (typeof raw !== 'string') throw new Error(`Local document blob is missing: ${id}`)
        treeEntries.push({ path: documentPath(id), sha: await createBlob(this.cfg, raw) })
      }
      for (const path of deletedRemotePaths) treeEntries.push({ path, sha: null })
      const manifestSha = await createBlob(this.cfg, JSON.stringify(plan.nextManifest))
      treeEntries.push({ path: MANIFEST_PATH, sha: manifestSha })
      const treeSha = await createTree(this.cfg, {
        baseTreeSha: commit.treeSha,
        entries: treeEntries
      })
      commitSha = await createCommit(this.cfg, {
        message: `MindFlow sync ${syncNow.toISOString()}`,
        treeSha,
        parentSha: ref.sha
      })
      await updateRef(this.cfg, commitSha)
    }

    const baseManifest = needsPush
      ? plan.nextManifest
      : { ...plan.nextManifest, lastWriter: remoteManifest.lastWriter ?? null }
    return {
      entries,
      localChanged,
      writes,
      nextState: {
        lastSyncedCommitSha: commitSha,
        baseManifest,
        perDoc: plan.nextPerDoc,
        machineId: previousState.machineId,
        etag: ref.etag,
        lastSyncAt: syncNow.toISOString()
      },
      quarantinedIds: plan.quarantinedIds
    }
  }

  handleFailure(error) {
    const message = safeErrorMessage(error, [this.cfg.token])
    const offline = error instanceof SyncHttpError && error.status === 0
    this.setStatus({ state: offline ? 'offline' : 'error', lastError: message })
    if (!this.started || !this.isEnabled() || this.disposed || this.retryTimer) return
    const delay = this.retryDelayMs
    this.retryDelayMs = Math.min(RETRY_MAX_MS, delay * 2)
    this.retryTimer = timerUnref(setTimeout(() => {
      this.retryTimer = null
      void this.syncNow({ reason: 'retry' })
    }, delay))
  }

  cancelScheduledWork() {
    clearInterval(this.fingerprintTimer)
    clearInterval(this.pullTimer)
    clearTimeout(this.changeTimer)
    clearTimeout(this.retryTimer)
    this.fingerprintTimer = null
    this.pullTimer = null
    this.changeTimer = null
    this.retryTimer = null
  }

  async flush({ beforeSync } = {}) {
    this.cancelScheduledWork()
    return withTimeout((async () => {
      if (typeof beforeSync === 'function') await beforeSync()
      if (this.isEnabled()) {
        const result = await this.syncNow({ reason: 'window-close' })
        if (!result.ok) throw new Error(result.error)
      }
      await this.storageQueue.drain()
    })(), CLOSE_FLUSH_TIMEOUT_MS)
  }

  async dispose() {
    this.disposed = true
    this.started = false
    this.cancelScheduledWork()
    await this.runningSync?.catch(() => {})
    await this.storageQueue.drain()
  }
}

export function createSyncEngine(options) {
  return new SyncEngine(options)
}

export function createSyncEngineForTest(options) {
  return createSyncEngine(options)
}

export function registerSyncIpc({
  ipcMain,
  engine,
  webContents,
  userDataPath,
  loadSettings = loadSyncSettings,
  saveSettings = saveSyncSettings,
  getToken = getDecryptedToken
}) {
  if (!ipcMain || !engine) throw new TypeError('ipcMain and sync engine are required')

  const handlers = {
    [IPC_CHANNELS.getConfig]: async () => {
      const settings = loadSettings(userDataPath)
      const config = { enabled: settings.enabled === true, repo: settings.repo || '', hasToken: Boolean(settings.tokenCipher) }
      if (typeof settings.warning === 'string' && settings.warning) config.warning = settings.warning
      return config
    },
    [IPC_CHANNELS.setConfig]: async (_event, patch = {}) => {
      try {
        const saved = saveSettings(userDataPath, patch)
        engine.updateConfig({
          enabled: saved.enabled,
          repo: saved.repo,
          branch: saved.branch,
          token: getToken(saved) || ''
        })
        if (saved.enabled) {
          engine.start({ startup: false })
          void engine.syncNow({ reason: 'settings' })
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, error: safeErrorMessage(error, [patch?.token]) }
      }
    },
    [IPC_CHANNELS.syncNow]: async () => engine.syncNow({ reason: 'manual' }),
    [IPC_CHANNELS.getStatus]: async () => engine.getStatus()
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler?.(channel)
    ipcMain.handle(channel, handler)
  }
  const unsubscribe = engine.onStatus(status => {
    if (!webContents?.isDestroyed?.()) webContents?.send?.(IPC_CHANNELS.statusChanged, publicStatus(status))
  })

  return Object.freeze({
    dispose() {
      unsubscribe?.()
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel)
    }
  })
}
