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
