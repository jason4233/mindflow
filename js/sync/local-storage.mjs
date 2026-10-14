/**
 * 同步引擎與 localStorage 的介面：讀快照、觀察本機存檔、以 CAS 原子套用遠端寫入。
 * （由 M1 的 js/sync-mobile.mjs 搬來，電腦與手機共用。）
 */
import { changedSince } from '../sync-plan.mjs'

const INDEX_KEY = 'mindflow.docs.index'
const DOC_KEY_PREFIX = 'mindflow.doc.'
const storageListeners = new WeakMap()
const patchedStoragePrototypes = new WeakMap()

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasMethods(value, methods) {
  return Boolean(value) && methods.every(method => typeof value[method] === 'function')
}

export function readStorageEntries(storage) {
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

export function applyStorageWrites(storage, writes, dispatchSyncApplied) {
  // 同步走網路的這幾秒內使用者若又存了要被覆蓋的 key，整批不寫，交由呼叫端重跑一輪。
  if (isObject(writes?.expected)) {
    const changedKeys = changedSince(writes.expected, key => storage.getItem(key))
    if (changedKeys.length) return { conflict: true, changedKeys }
  }
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
