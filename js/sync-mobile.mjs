import {
  buildConflictCopy,
  buildLocalState,
  computeLocalWrites,
  computeSyncPlan,
  emptyManifest
} from './sync-plan.mjs'

export const MOBILE_SYNC_CONFIG_KEY = 'mindflow.sync.mobile.config'
export const MOBILE_SYNC_TOKEN_KEY = 'mindflow.sync.mobile.token'
export const MOBILE_SYNC_STATE_KEY = 'mindflow.sync.mobile.state'
export const MOBILE_SYNC_CHANGE_DEBOUNCE_MS = 45_000

const DEFAULT_API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const UPDATE_REF_ATTEMPTS = 3
const MANIFEST_PATH = 'manifest.json'
const INDEX_KEY = 'mindflow.docs.index'
const DOC_KEY_PREFIX = 'mindflow.doc.'
const STATUS_STATES = new Set(['disabled', 'idle', 'syncing', 'offline', 'error'])
const WRITE_PERMISSION_GUIDANCE = 'PAT must grant Metadata: Read and Contents: Read and write access'

const storageListeners = new WeakMap()
const patchedStoragePrototypes = new WeakMap()

export class MobileSyncHttpError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message)
    this.name = 'MobileSyncHttpError'
    this.status = status
    this.retryable = retryable
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasMethods(value, methods) {
  return Boolean(value) && methods.every(name => typeof value[name] === 'function')
}

function encodePathSegments(value) {
  return String(value).split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function repoPath(cfg) {
  return encodePathSegments(cfg.repo)
}

function branchPath(cfg) {
  return encodePathSegments(cfg.branch || 'main')
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

function redactToken(value, token) {
  const message = String(value ?? '')
  const secret = String(token ?? '')
  return (secret ? message.split(secret).join('[redacted]') : message).slice(0, 500)
}

function safeErrorMessage(error, token = '') {
  return redactToken(error instanceof Error ? error.message : String(error || 'Unknown sync error'), token)
}

function retryableStatus(status, extraRetryableStatuses = []) {
  return status === 429 || status >= 500 || extraRetryableStatuses.includes(status)
}

function decodeBase64Utf8(value) {
  const binary = globalThis.atob(String(value).replace(/\s/gu, ''))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
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

function normalizeConfig(value, token = '') {
  const source = isObject(value) ? value : {}
  return {
    enabled: source.enabled === true,
    repo: typeof source.repo === 'string' ? source.repo.trim() : '',
    branch: typeof source.branch === 'string' && source.branch.trim() ? source.branch.trim() : 'main',
    token: typeof token === 'string' ? token : ''
  }
}

function normalizeState(value, machineId) {
  const source = isObject(value) ? value : {}
  return {
    lastSyncedCommitSha: typeof source.lastSyncedCommitSha === 'string' ? source.lastSyncedCommitSha : null,
    baseManifest: isObject(source.baseManifest) ? source.baseManifest : null,
    perDoc: isObject(source.perDoc) ? source.perDoc : {},
    machineId: typeof source.machineId === 'string' && source.machineId ? source.machineId : machineId,
    etag: typeof source.etag === 'string' ? source.etag : null,
    lastSyncAt: typeof source.lastSyncAt === 'string' ? source.lastSyncAt : null
  }
}

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

function machineIdentity(override) {
  if (typeof override === 'string' && override) return override
  if (typeof globalThis.crypto?.randomUUID === 'function') return `mobile-${globalThis.crypto.randomUUID()}`
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8))
    return `mobile-${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`
  }
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readStorageEntries(storage) {
  const entries = {}
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (typeof key !== 'string' || !key.startsWith('mindflow.')) continue
    const value = storage.getItem(key)
    if (typeof value === 'string') entries[key] = value
  }
  return entries
}

function isSyncStorageKey(key) {
  return key === INDEX_KEY || String(key).startsWith(DOC_KEY_PREFIX)
}

function notifyStorageListeners(storage, key) {
  const listeners = storageListeners.get(storage)
  if (!listeners || (key !== null && !isSyncStorageKey(key))) return
  for (const listener of listeners) {
    try { listener({ key }) } catch { /* 儲存觀察者不能破壞 localStorage 寫入。 */ }
  }
}

function patchStoragePrototype(storage) {
  const prototype = Object.getPrototypeOf(storage)
  if (!prototype || patchedStoragePrototypes.has(prototype)) return
  const originals = {
    setItem: prototype.setItem,
    removeItem: prototype.removeItem,
    clear: prototype.clear
  }
  if (!hasMethods(originals, ['setItem', 'removeItem', 'clear'])) {
    throw new TypeError('Storage must provide setItem, removeItem, and clear')
  }

  Object.defineProperties(prototype, {
    setItem: {
      configurable: true,
      writable: true,
      value(key, value) {
        const result = originals.setItem.call(this, key, value)
        notifyStorageListeners(this, String(key))
        return result
      }
    },
    removeItem: {
      configurable: true,
      writable: true,
      value(key) {
        const normalizedKey = String(key)
        const existed = this.getItem(normalizedKey) !== null
        const result = originals.removeItem.call(this, normalizedKey)
        if (existed) notifyStorageListeners(this, normalizedKey)
        return result
      }
    },
    clear: {
      configurable: true,
      writable: true,
      value() {
        let hadSyncData = false
        for (let index = 0; index < this.length; index += 1) {
          if (isSyncStorageKey(this.key(index))) {
            hadSyncData = true
            break
          }
        }
        const result = originals.clear.call(this)
        if (hadSyncData) notifyStorageListeners(this, null)
        return result
      }
    }
  })
  patchedStoragePrototypes.set(prototype, originals)
}

export function observeMindflowStorage(storage, listener) {
  if (!storage || typeof listener !== 'function') throw new TypeError('Storage and listener are required')
  patchStoragePrototype(storage)
  let listeners = storageListeners.get(storage)
  if (!listeners) {
    listeners = new Set()
    storageListeners.set(storage, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) storageListeners.delete(storage)
  }
}

function applyStorageWrites(storage, writes, dispatchSyncApplied) {
  const removeKeys = [...new Set(Array.isArray(writes?.removeKeys) ? writes.removeKeys : [])]
  const setEntries = Object.entries(isObject(writes?.setKeys) ? writes.setKeys : {})
  const touched = [...new Set([...removeKeys, ...setEntries.map(([key]) => key)])]
  const previous = touched.map(key => ({
    key,
    present: storage.getItem(key) !== null,
    value: storage.getItem(key)
  }))

  try {
    for (const key of removeKeys) storage.removeItem(key)
    for (const [key, value] of setEntries) {
      if (key !== INDEX_KEY) storage.setItem(key, value)
    }
    const indexEntry = setEntries.find(([key]) => key === INDEX_KEY)
    if (indexEntry) storage.setItem(indexEntry[0], indexEntry[1])
  } catch (error) {
    for (const item of previous) {
      try {
        if (item.present) storage.setItem(item.key, item.value)
        else storage.removeItem(item.key)
      } catch {
        // rollback 盡力而為；原始 quota/security error 必須保留。
      }
    }
    throw error
  }

  const changedDocIds = touched
    .filter(key => key.startsWith(DOC_KEY_PREFIX))
    .map(key => key.slice(DOC_KEY_PREFIX.length))
    .sort()
  dispatchSyncApplied?.({ changedDocIds })
  return { changedDocIds, changedKeyCount: touched.length }
}

function parsePreferenceJson(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function createPreferencesStore(preferences, machineIdOverride) {
  if (!hasMethods(preferences, ['get', 'set'])) throw new TypeError('Capacitor Preferences is required')
  const fallbackMachineId = machineIdentity(machineIdOverride)
  return Object.freeze({
    async load() {
      const [configResult, tokenResult, stateResult] = await Promise.all([
        preferences.get({ key: MOBILE_SYNC_CONFIG_KEY }),
        preferences.get({ key: MOBILE_SYNC_TOKEN_KEY }),
        preferences.get({ key: MOBILE_SYNC_STATE_KEY })
      ])
      const config = normalizeConfig(parsePreferenceJson(configResult?.value), tokenResult?.value || '')
      const state = normalizeState(parsePreferenceJson(stateResult?.value), fallbackMachineId)
      return { config, state }
    },
    async saveConfig(config, { tokenChanged = false } = {}) {
      await preferences.set({
        key: MOBILE_SYNC_CONFIG_KEY,
        value: JSON.stringify({ enabled: config.enabled, repo: config.repo, branch: config.branch })
      })
      if (tokenChanged) {
        if (config.token) {
          await preferences.set({ key: MOBILE_SYNC_TOKEN_KEY, value: config.token })
        } else if (typeof preferences.remove === 'function') {
          await preferences.remove({ key: MOBILE_SYNC_TOKEN_KEY })
        } else {
          await preferences.set({ key: MOBILE_SYNC_TOKEN_KEY, value: '' })
        }
      }
    },
    async saveState(state) {
      await preferences.set({ key: MOBILE_SYNC_STATE_KEY, value: JSON.stringify(normalizeState(state, state.machineId)) })
    }
  })
}

function createGitHubClient(fetchFn) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetch is required')

  async function request(cfg, path, {
    method = 'GET',
    headers = {},
    json,
    acceptedStatuses = [],
    retryableStatuses = []
  } = {}) {
    const apiBase = String(cfg.apiBase || DEFAULT_API_BASE).replace(/\/+$/u, '')
    const init = {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${cfg.token}`,
        'x-github-api-version': API_VERSION,
        ...headers
      }
    }
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(json)
    }

    let response
    try {
      response = await fetchFn(`${apiBase}${path}`, init)
    } catch (error) {
      throw new MobileSyncHttpError(`GitHub request failed: ${redactToken(error?.message || 'network error', cfg.token)}`, {
        status: 0,
        retryable: true
      })
    }
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      let detail = ''
      try {
        const body = await response.json()
        if (typeof body?.message === 'string') detail = `: ${redactToken(body.message, cfg.token)}`
      } catch {
        // HTTP status 是主分類依據；錯誤頁不必保證 JSON。
      }
      throw new MobileSyncHttpError(`GitHub API request failed (${response.status})${detail}`, {
        status: response.status,
        retryable: retryableStatus(response.status, retryableStatuses)
      })
    }
    return response
  }

  async function responseJson(response) {
    try {
      return await response.json()
    } catch {
      throw new MobileSyncHttpError(`GitHub API returned invalid JSON (${response.status})`, {
        status: response.status,
        retryable: response.status >= 500
      })
    }
  }

  function writeAccessError(cfg, cause) {
    const status = cause instanceof MobileSyncHttpError && cause.status ? cause.status : 403
    return new MobileSyncHttpError(
      `Cannot write GitHub repository ${cfg.repo}. ${WRITE_PERMISSION_GUIDANCE}.`,
      { status, retryable: false }
    )
  }

  return Object.freeze({
    async getRef(cfg, { etag } = {}) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/ref/heads/${branchPath(cfg)}`, {
        headers: etag ? { 'if-none-match': etag } : {},
        acceptedStatuses: [304]
      })
      if (response.status === 304) {
        return { sha: null, etag: response.headers.get('etag') || etag || null, notModified: true }
      }
      const body = await responseJson(response)
      return { sha: body.object.sha, etag: response.headers.get('etag'), notModified: false }
    },
    async getCommit(cfg, sha) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/commits/${encodeURIComponent(sha)}`)
      const body = await responseJson(response)
      return { treeSha: body.tree.sha }
    },
    async getTreeRecursive(cfg, treeSha) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`)
      const body = await responseJson(response)
      if (body.truncated) {
        throw new MobileSyncHttpError('GitHub recursive tree response was truncated', {
          status: response.status,
          retryable: false
        })
      }
      return {
        byPath: Object.fromEntries((Array.isArray(body.tree) ? body.tree : [])
          .filter(entry => entry.type === 'blob')
          .map(entry => [entry.path, { sha: entry.sha, size: entry.size }]))
      }
    },
    async getBlobRaw(cfg, blobSha) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/blobs/${encodeURIComponent(blobSha)}`)
      const body = await responseJson(response)
      if (body.encoding !== 'base64' || typeof body.content !== 'string') {
        throw new MobileSyncHttpError('GitHub blob response is not base64 encoded', {
          status: response.status,
          retryable: false
        })
      }
      return decodeBase64Utf8(body.content)
    },
    async createBlob(cfg, content) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/blobs`, {
        method: 'POST',
        json: { content, encoding: 'utf-8' }
      })
      return (await responseJson(response)).sha
    },
    async createTree(cfg, { baseTreeSha, entries }) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/trees`, {
        method: 'POST',
        json: {
          base_tree: baseTreeSha,
          tree: entries.map(({ path, sha }) => ({ path, mode: '100644', type: 'blob', sha }))
        }
      })
      return (await responseJson(response)).sha
    },
    async createCommit(cfg, { message, treeSha, parentSha }) {
      const response = await request(cfg, `/repos/${repoPath(cfg)}/git/commits`, {
        method: 'POST',
        json: { message, tree: treeSha, parents: [parentSha] }
      })
      return (await responseJson(response)).sha
    },
    async updateRef(cfg, commitSha) {
      await request(cfg, `/repos/${repoPath(cfg)}/git/refs/heads/${branchPath(cfg)}`, {
        method: 'PATCH',
        json: { sha: commitSha, force: false },
        retryableStatuses: [422]
      })
    },
    async ensureRepo(cfg) {
      let response
      try {
        response = await request(cfg, `/repos/${repoPath(cfg)}`, { acceptedStatuses: [404] })
      } catch (error) {
        if (error instanceof MobileSyncHttpError && [401, 403].includes(error.status)) throw writeAccessError(cfg, error)
        throw error
      }
      if (response.status !== 404) {
        const body = await responseJson(response)
        if (!body.permissions?.push) throw writeAccessError(cfg)
        return { exists: true, private: Boolean(body.private), canWrite: true }
      }

      const repoName = String(cfg.repo).split('/').at(-1)
      try {
        response = await request(cfg, '/user/repos', {
          method: 'POST',
          json: { name: repoName, private: true, auto_init: true, default_branch: cfg.branch || 'main' }
        })
      } catch (error) {
        if (error instanceof MobileSyncHttpError && [401, 403].includes(error.status)) throw writeAccessError(cfg, error)
        throw error
      }
      const body = await responseJson(response)
      if (String(body.full_name || '').toLocaleLowerCase('en-US') !== String(cfg.repo).toLocaleLowerCase('en-US')) {
        throw new MobileSyncHttpError(`GitHub 建立的 repo ${body.full_name || '(unknown)'} 與設定的 ${cfg.repo} 不一致。`, {
          status: 409,
          retryable: false
        })
      }
      return { exists: true, private: Boolean(body.private), canWrite: body.permissions?.push !== false }
    }
  })
}

async function reconcileAttempt({ cfg, state, storage, client, syncNow }) {
  const entries = readStorageEntries(storage)
  const localState = buildLocalState(entries)
  const ref = await client.getRef(cfg)
  const commit = await client.getCommit(cfg, ref.sha)
  const tree = await client.getTreeRecursive(cfg, commit.treeSha)
  const manifestEntry = tree.byPath[MANIFEST_PATH]
  const remoteManifest = manifestEntry
    ? JSON.parse(await client.getBlobRaw(cfg, manifestEntry.sha))
    : emptyManifest()
  const base = state.lastSyncedCommitSha && state.baseManifest
    ? { manifest: state.baseManifest, perDoc: state.perDoc }
    : null
  const plan = computeSyncPlan({
    local: localState,
    remoteManifest,
    base,
    machineId: state.machineId,
    now: syncNow
  })
  const pulledBlobs = {}
  const readRemoteDoc = async id => {
    if (Object.hasOwn(pulledBlobs, id)) return pulledBlobs[id]
    const remoteEntry = tree.byPath[documentPath(id)]
    if (!remoteEntry) throw new Error(`Remote document blob is missing: ${id}`)
    pulledBlobs[id] = await client.getBlobRaw(cfg, remoteEntry.sha)
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
      addConflictCopy(raw, state.machineId)
    } else {
      addConflictCopy(await readRemoteDoc(conflict.id), remoteManifest.lastWriter || 'remote-device')
    }
  }
  for (const resurrection of plan.resurrect) {
    const localRaw = localState.docBlobs[resurrection.id]
    if (typeof localRaw === 'string') addConflictCopy(localRaw, state.machineId)
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
  const needsPush = pushIds.size > 0 || deletedRemotePaths.length > 0 || manifestsDiffer(remoteManifest, plan.nextManifest)

  let commitSha = ref.sha
  if (needsPush) {
    const treeEntries = []
    for (const id of [...pushIds].sort()) {
      const raw = augmentedLocal.docBlobs[id] ?? pulledBlobs[id]
      if (typeof raw !== 'string') throw new Error(`Local document blob is missing: ${id}`)
      treeEntries.push({ path: documentPath(id), sha: await client.createBlob(cfg, raw) })
    }
    for (const path of deletedRemotePaths) treeEntries.push({ path, sha: null })
    const manifestSha = await client.createBlob(cfg, JSON.stringify(plan.nextManifest))
    treeEntries.push({ path: MANIFEST_PATH, sha: manifestSha })
    const treeSha = await client.createTree(cfg, { baseTreeSha: commit.treeSha, entries: treeEntries })
    commitSha = await client.createCommit(cfg, {
      message: `MindFlow mobile sync ${syncNow.toISOString()}`,
      treeSha,
      parentSha: ref.sha
    })
    await client.updateRef(cfg, commitSha)
  }

  return {
    entries,
    localChanged,
    writes,
    nextState: {
      lastSyncedCommitSha: commitSha,
      baseManifest: needsPush
        ? plan.nextManifest
        : { ...plan.nextManifest, lastWriter: remoteManifest.lastWriter ?? null },
      perDoc: plan.nextPerDoc,
      machineId: state.machineId,
      etag: ref.etag,
      lastSyncAt: syncNow.toISOString()
    },
    quarantinedIds: plan.quarantinedIds
  }
}

export function createMobileSyncLifecycle({
  syncNow,
  documentRef = globalThis.document,
  observeLocalChanges,
  debounceMs = MOBILE_SYNC_CHANGE_DEBOUNCE_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  if (typeof syncNow !== 'function') throw new TypeError('syncNow is required')
  if (typeof observeLocalChanges !== 'function') throw new TypeError('observeLocalChanges is required')
  let started = false
  let changeTimer = null
  let unsubscribe = null

  const onLocalChange = () => {
    clearTimeoutFn(changeTimer)
    changeTimer = setTimeoutFn(() => {
      changeTimer = null
      return syncNow({ reason: 'local-change' })
    }, debounceMs)
  }
  const onVisibilityChange = () => {
    if (documentRef?.visibilityState === 'visible') void syncNow({ reason: 'visibility' })
  }

  return Object.freeze({
    async start() {
      if (started) return
      started = true
      unsubscribe = observeLocalChanges(onLocalChange)
      documentRef?.addEventListener?.('visibilitychange', onVisibilityChange)
      await syncNow({ reason: 'startup' })
    },
    stop() {
      if (!started) return
      started = false
      clearTimeoutFn(changeTimer)
      changeTimer = null
      unsubscribe?.()
      unsubscribe = null
      documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange)
    }
  })
}

export function isNativeCapacitor(windowRef = globalThis.window) {
  const capacitor = windowRef?.Capacitor
  if (!capacitor) return false
  try {
    if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform() === true
    if (typeof capacitor.getPlatform === 'function') return capacitor.getPlatform() !== 'web'
  } catch {
    return false
  }
  return false
}

export function getCapacitorPreferences(windowRef = globalThis.window) {
  if (!isNativeCapacitor(windowRef)) return null
  const capacitor = windowRef.Capacitor
  const existing = capacitor.Plugins?.Preferences
  if (hasMethods(existing, ['get', 'set'])) return existing
  if (typeof capacitor.registerPlugin !== 'function') return null
  const preferences = capacitor.registerPlugin('Preferences')
  return hasMethods(preferences, ['get', 'set']) ? preferences : null
}

export function createMobileSyncApi({
  preferences,
  storage = globalThis.localStorage,
  fetchFn = globalThis.fetch,
  apiBase = DEFAULT_API_BASE,
  machineId,
  now = () => new Date(),
  autoStart = true,
  documentRef = globalThis.document,
  observeLocalChanges,
  dispatchSyncApplied,
  windowRef = globalThis.window,
  debounceMs = MOBILE_SYNC_CHANGE_DEBOUNCE_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
} = {}) {
  if (!storage || !hasMethods(storage, ['getItem', 'setItem', 'removeItem', 'key'])) {
    throw new TypeError('localStorage is required')
  }
  const preferenceStore = createPreferencesStore(preferences, machineId)
  const client = createGitHubClient(fetchFn)
  const listeners = new Set()
  let config = normalizeConfig(null)
  let state = normalizeState(null, machineIdentity(machineId))
  let status = publicStatus({ state: 'disabled', lastSyncAt: null, lastError: null, docCount: 0 })
  let lifecycle = null
  let lifecycleStarted = false
  let runningSync = null
  let applyingRemote = false
  let disposed = false

  const ready = preferenceStore.load().then(loaded => {
    config = { ...loaded.config, apiBase }
    state = loaded.state
    status = publicStatus({
      state: isEnabled() ? 'idle' : 'disabled',
      lastSyncAt: state.lastSyncAt,
      lastError: null,
      docCount: Object.keys(buildLocalState(readStorageEntries(storage)).docs).length
    })
  })

  function isEnabled() {
    return config.enabled === true && Boolean(config.repo && config.token)
  }

  function setStatus(patch) {
    status = publicStatus({ ...status, ...patch })
    for (const listener of listeners) {
      try { listener(publicStatus(status)) } catch { /* UI listener 不能中止同步。 */ }
    }
  }

  function emitSyncApplied(detail) {
    if (typeof dispatchSyncApplied === 'function') {
      dispatchSyncApplied(detail)
      return
    }
    const CustomEventConstructor = windowRef?.CustomEvent || globalThis.CustomEvent
    if (windowRef?.dispatchEvent && typeof CustomEventConstructor === 'function') {
      windowRef.dispatchEvent(new CustomEventConstructor('mindflow:sync-applied', { detail }))
    }
  }

  function ensureLifecycle() {
    if (lifecycle) return lifecycle
    const observer = typeof observeLocalChanges === 'function'
      ? observeLocalChanges
      : callback => observeMindflowStorage(storage, callback)
    lifecycle = createMobileSyncLifecycle({
      syncNow: options => api.syncNow(options),
      documentRef,
      debounceMs,
      setTimeoutFn,
      clearTimeoutFn,
      observeLocalChanges(callback) {
        return observer(() => {
          // 遠端套用會經同一個 Storage API；這批權威寫入不可再排成「本機存檔」。
          if (!applyingRemote) callback()
        })
      }
    })
    return lifecycle
  }

  async function runSync() {
    setStatus({ state: 'syncing', lastError: null, warning: null })
    const syncNow = now()
    if (!(syncNow instanceof Date) || Number.isNaN(syncNow.getTime())) throw new TypeError('now must return a valid Date')
    const repoStatus = await client.ensureRepo(config)
    let outcome
    for (let attempt = 1; attempt <= UPDATE_REF_ATTEMPTS; attempt += 1) {
      try {
        outcome = await reconcileAttempt({ cfg: config, state, storage, client, syncNow })
        break
      } catch (error) {
        const refConflict = error instanceof MobileSyncHttpError && error.status === 422
        if (!refConflict || attempt === UPDATE_REF_ATTEMPTS) throw error
      }
    }

    if (outcome.localChanged) {
      applyingRemote = true
      try {
        applyStorageWrites(storage, outcome.writes, emitSyncApplied)
      } finally {
        applyingRemote = false
      }
    }
    state = outcome.nextState
    await preferenceStore.saveState(state)
    const localState = buildLocalState(readStorageEntries(storage))
    const warnings = []
    if (!repoStatus.private) warnings.push('GitHub repo 是 public，心智圖內容可能公開；請立即改為 private。')
    if (outcome.quarantinedIds.length) {
      warnings.push(`本機有損壞文件已隔離：${outcome.quarantinedIds.slice(0, 5).join(', ')}。`)
    }
    const warning = warnings.length ? warnings.join(' ') : null
    setStatus({
      state: 'idle',
      lastSyncAt: syncNow.toISOString(),
      lastError: null,
      docCount: Object.keys(localState.docs).length,
      warning
    })
    return warning ? { warning } : {}
  }

  const api = Object.freeze({
    async start() {
      await ready
      if (disposed || lifecycleStarted || !isEnabled()) return
      lifecycleStarted = true
      await ensureLifecycle().start()
    },
    async getConfig() {
      await ready
      return { enabled: config.enabled, repo: config.repo, hasToken: Boolean(config.token) }
    },
    async setConfig(patch = {}) {
      await ready
      const suppliedToken = Object.hasOwn(patch, 'token') ? String(patch.token || '').trim() : config.token
      const next = normalizeConfig({
        enabled: Object.hasOwn(patch, 'enabled') ? patch.enabled : config.enabled,
        repo: Object.hasOwn(patch, 'repo') ? patch.repo : config.repo,
        branch: config.branch
      }, suppliedToken)
      if (next.repo && !/^[^/\s]+\/[^/\s]+$/u.test(next.repo)) {
        return { ok: false, error: 'Repo must use owner/name format' }
      }
      if (next.enabled && (!next.repo || !next.token)) {
        return { ok: false, error: 'Enabled sync requires a repository and token' }
      }
      try {
        await preferenceStore.saveConfig(next, { tokenChanged: Object.hasOwn(patch, 'token') })
        config = { ...next, apiBase }
        if (!isEnabled()) {
          lifecycle?.stop()
          lifecycleStarted = false
          setStatus({ state: 'disabled', lastError: null, warning: null })
        } else {
          setStatus({ state: 'idle', lastError: null })
          if (autoStart) await api.start()
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, error: safeErrorMessage(error, suppliedToken) }
      }
    },
    async syncNow(_options = {}) {
      await ready
      if (disposed || !isEnabled()) {
        setStatus({ state: 'disabled', lastError: null })
        return { ok: false, error: 'Sync is disabled' }
      }
      if (runningSync) return runningSync
      runningSync = runSync()
        .then(outcome => outcome.warning ? { ok: true, warning: outcome.warning } : { ok: true })
        .catch(error => {
          const offline = error instanceof MobileSyncHttpError && error.status === 0
          setStatus({ state: offline ? 'offline' : 'error', lastError: safeErrorMessage(error, config.token) })
          return { ok: false, error: safeErrorMessage(error, config.token) }
        })
        .finally(() => { runningSync = null })
      return runningSync
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
    async dispose() {
      disposed = true
      lifecycle?.stop()
      lifecycleStarted = false
      await runningSync?.catch(() => {})
      listeners.clear()
    }
  })

  if (autoStart) void api.start()
  return api
}
