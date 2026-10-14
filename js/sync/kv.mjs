/**
 * 同步引擎自己的小型鍵值儲存：base、HLC、資產快取都放這裡（IndexedDB），不佔 localStorage 配額。
 * 介面：get(key) / set(key, value) / delete(key) / keys(prefix)；value 必須可被 structured clone。
 */
export const SYNC_DB_NAME = 'mindflow-sync'
const STORE = 'kv'

export function createMemoryKv(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]))
  return Object.freeze({
    async get(key) {
      return values.has(key) ? structuredClone(values.get(key)) : undefined
    },
    async set(key, value) {
      values.set(key, structuredClone(value))
    },
    async delete(key) {
      values.delete(key)
    },
    async keys(prefix = '') {
      return [...values.keys()].filter(key => key.startsWith(prefix)).sort()
    },
    snapshot() {
      return Object.fromEntries([...values].map(([key, value]) => [key, structuredClone(value)]))
    }
  })
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

/** 瀏覽器（Electron renderer、Android WebView）用的 IndexedDB 實作；開不起來時丟錯，由呼叫端決定退路。 */
export async function openIndexedDbKv({ indexedDB = globalThis.indexedDB, name = SYNC_DB_NAME } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new Error('IndexedDB is unavailable')
  const request = indexedDB.open(name, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
  }
  const db = await promisify(request)
  const run = (mode, operation) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const store = transaction.objectStore(STORE)
    let result
    Promise.resolve(operation(store)).then(value => { result = value }, reject)
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
  return Object.freeze({
    get: key => run('readonly', store => promisify(store.get(key))),
    set: (key, value) => run('readwrite', store => promisify(store.put(value, key))).then(() => undefined),
    delete: key => run('readwrite', store => promisify(store.delete(key))).then(() => undefined),
    keys: (prefix = '') => run('readonly', store => promisify(store.getAllKeys()))
      .then(keys => keys.map(String).filter(key => key.startsWith(prefix)).sort()),
    close: () => db.close()
  })
}

/**
 * IndexedDB 不可用時的退路：狀態、時鐘等小資料存 localStorage（前綴不以 `mindflow.` 開頭，
 * 所以不會進手機／電腦的檔案備份，也不會被同步），圖片快取只放記憶體（需要時重新下載）。
 */
export function createLocalStorageKv(storage, { prefix = 'mfsync.' } = {}) {
  const assets = createMemoryKv()
  const isAsset = key => key.startsWith('asset:')
  return Object.freeze({
    async get(key) {
      if (isAsset(key)) return assets.get(key)
      const raw = storage.getItem(`${prefix}${key}`)
      if (raw === null) return undefined
      try { return JSON.parse(raw) } catch { return undefined }
    },
    async set(key, value) {
      if (isAsset(key)) return assets.set(key, value)
      storage.setItem(`${prefix}${key}`, JSON.stringify(value))
    },
    async delete(key) {
      if (isAsset(key)) return assets.delete(key)
      storage.removeItem(`${prefix}${key}`)
    },
    async keys(keyPrefix = '') {
      const keys = await assets.keys(keyPrefix)
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith(prefix) && key.slice(prefix.length).startsWith(keyPrefix)) keys.push(key.slice(prefix.length))
      }
      return keys.sort()
    }
  })
}

/** 同步用的 KV：先試 IndexedDB，失敗退回 localStorage（呼叫可同步拿到物件，實際開啟在背景）。 */
export function openSyncKv({ indexedDB = globalThis.indexedDB, storage = globalThis.localStorage, onFallback = () => {} } = {}) {
  const opened = openIndexedDbKv({ indexedDB }).catch(error => {
    onFallback(error)
    return createLocalStorageKv(storage)
  })
  const call = method => async (...args) => (await opened)[method](...args)
  return Object.freeze({ get: call('get'), set: call('set'), delete: call('delete'), keys: call('keys'), opened })
}
