/**
 * 手機檔案備份：輪替、內容沒變不寫、空儲存區自動還原、以副本還原、匯出分享。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

class MemoryStorage {
  #data = new Map()
  get length() { return this.#data.size }
  clear() { this.#data.clear() }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null }
  key(index) { return Array.from(this.#data.keys())[index] ?? null }
  removeItem(key) { this.#data.delete(String(key)) }
  setItem(key, value) { this.#data.set(String(key), String(value)) }
}

globalThis.localStorage = new MemoryStorage()

const { createDocument, importDocumentCopy, listDocuments, loadDocument, saveDocument } = await import('../js/store.js')
const {
  MOBILE_BACKUP_LIMIT,
  consumeRestoredNotice,
  createMobileBackupStore,
  mobileBackupPaths,
  parseBackupPayload,
  startMobileBackups
} = await import('../js/mobile-backup.mjs')

// Capacitor Filesystem 的記憶體替身：只實作備份用到的方法，錯誤訊息與原生端相同（File does not exist）。
class FakeFilesystem {
  files = new Map()
  writes = []
  key(directory, path) { return `${directory}:${path}` }
  async writeFile({ path, data, directory, encoding, recursive }) {
    assert.equal(encoding, 'utf8')
    assert.equal(recursive, true)
    this.writes.push(path)
    this.files.set(this.key(directory, path), data)
    return { uri: `file:///${directory}/${path}` }
  }
  async readFile({ path, directory }) {
    const data = this.files.get(this.key(directory, path))
    if (data === undefined) throw new Error('File does not exist.')
    return { data }
  }
  async stat({ path, directory }) {
    if (!this.files.has(this.key(directory, path))) throw new Error('File does not exist.')
    return { type: 'file' }
  }
  async copy({ from, to, directory, toDirectory }) {
    const data = this.files.get(this.key(directory, from))
    if (data === undefined) throw new Error('File does not exist.')
    this.files.set(this.key(toDirectory, to), data)
  }
  async getUri({ path, directory }) {
    return { uri: `file:///${directory}/${path}` }
  }
}

function freshStorage() {
  globalThis.localStorage.clear()
  return globalThis.localStorage
}

function makeStore({ filesystem = new FakeFilesystem(), share = null, clock } = {}) {
  let tick = 0
  const now = clock || (() => new Date(Date.UTC(2026, 9, 14, 1, 0, tick++)))
  return {
    filesystem,
    store: createMobileBackupStore({ filesystem, storage: globalThis.localStorage, importCopy: importDocumentCopy, share, now })
  }
}

function addDoc(title) {
  const doc = createDocument()
  doc.title = title
  saveDocument(doc)
  return loadDocument(doc.id)
}

test('backups rotate newest-first, skip unchanged content, and never back up an empty library', async () => {
  freshStorage()
  const { store, filesystem } = makeStore()
  assert.equal(await store.writeBackup(), null, '沒有文件不寫備份')

  const doc = addDoc('第一版')
  const first = await store.writeBackup({ reason: 'startup' })
  assert.equal(first.path, mobileBackupPaths()[0])
  assert.equal(await store.writeBackup(), null, '內容沒變不重寫、不輪替')
  assert.equal(filesystem.writes.length, 1)

  for (let index = 0; index < MOBILE_BACKUP_LIMIT + 3; index += 1) {
    doc.title = `第 ${index} 版`
    saveDocument(doc, { expectedUpdatedAt: loadDocument(doc.id).updatedAt })
    assert.ok(await store.writeBackup())
  }
  const list = await store.listBackups()
  assert.equal(list.length, MOBILE_BACKUP_LIMIT, '最多保留 10 份')
  const latest = await store.readLatestBackup()
  assert.match(latest.entries[`mindflow.doc.${doc.id}`], new RegExp(`第 ${MOBILE_BACKUP_LIMIT + 2} 版`))
  const oldest = await store.readBackup(mobileBackupPaths()[MOBILE_BACKUP_LIMIT - 1])
  assert.match(oldest.entries[`mindflow.doc.${doc.id}`], new RegExp(`第 ${3} 版`), "共寫 14 次、保留 10 份：最舊的是第 3 版")
})

test('a fresh store instance (app restart) still skips an unchanged backup', async () => {
  freshStorage()
  addDoc('重開不重寫')
  const filesystem = new FakeFilesystem()
  await makeStore({ filesystem }).store.writeBackup()
  const again = makeStore({ filesystem })
  assert.equal(await again.store.writeBackup(), null)
  assert.equal(filesystem.writes.length, 1)
})

test('an empty storage is restored from the newest readable backup; an intentionally emptied library is not', async () => {
  freshStorage()
  addDoc('要救回來的文件')
  const filesystem = new FakeFilesystem()
  const { store } = makeStore({ filesystem })
  await store.writeBackup()

  // 刻意刪光：空索引仍在 → 不復活
  globalThis.localStorage.clear()
  globalThis.localStorage.setItem('mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] }))
  assert.equal(await store.restoreLatestIfEmpty(), false)

  // 整個不見（只剩偏好設定）→ 還原
  globalThis.localStorage.clear()
  globalThis.localStorage.setItem('mindflow.ui.theme', 'dark')
  // 最新那份壞掉也要往前找
  filesystem.files.set(`DATA:${mobileBackupPaths()[1]}`, filesystem.files.get(`DATA:${mobileBackupPaths()[0]}`))
  filesystem.files.set(`DATA:${mobileBackupPaths()[0]}`, '{broken')
  assert.equal(await store.restoreLatestIfEmpty(), true)
  assert.deepEqual(listDocuments().map(meta => meta.title), ['要救回來的文件'])
})

test('manual restore adds copies only, skips identical documents and documents from a newer app version', async () => {
  freshStorage()
  const kept = addDoc('保持不變')
  const edited = addDoc('之後被改')
  const { store } = makeStore()
  await store.writeBackup()
  const backup = await store.readLatestBackup()

  edited.title = '現在的版本'
  saveDocument(edited, { expectedUpdatedAt: loadDocument(edited.id).updatedAt })
  const future = JSON.parse(backup.entries[`mindflow.doc.${kept.id}`])
  backup.entries['mindflow.doc.from-future'] = JSON.stringify({ ...future, id: 'from-future', schemaVersion: 3, title: '未來格式' })

  const copies = []
  const result = store.restoreAsCopies(backup, { onCopy: doc => copies.push(doc) })
  assert.deepEqual(result, { restored: 1, unchanged: 1, skipped: 1 })
  assert.equal(copies.length, 1)
  assert.notEqual(copies[0].id, edited.id, '以新 id 加入')
  assert.match(copies[0].title, /^之後被改（備份還原 \d\d-\d\d \d\d:\d\d）$/)
  assert.equal(loadDocument(edited.id).title, '現在的版本', '現有文件不被覆蓋')
  assert.equal(listDocuments().length, 3)
})

test('export writes a parseable backup file and hands it to the share sheet', async () => {
  freshStorage()
  addDoc('匯出用')
  const shared = []
  const { store, filesystem } = makeStore({ share: { share: async options => { shared.push(options) } } })
  const result = await store.exportBackup()
  assert.deepEqual(result, { ok: true, docCount: 1 })
  assert.equal(shared.length, 1)
  assert.equal(shared[0].files.length, 1)
  const path = shared[0].files[0].replace('file:///CACHE/', '')
  const parsed = parseBackupPayload(filesystem.files.get(`CACHE:${path}`))
  assert.equal(parsed.reason, 'export')
  assert.equal(Object.keys(parsed.entries).some(key => key.startsWith('mindflow.doc.')), true)
})

test('export reports cancel from the share sheet as a non-error and refuses an empty library', async () => {
  freshStorage()
  const { store } = makeStore({ share: { share: async () => { throw new Error('Share canceled') } } })
  assert.equal((await store.exportBackup()).ok, false)
  addDoc('取消分享')
  assert.deepEqual(await store.exportBackup(), { ok: true, cancelled: true })
})

test('parseBackupPayload rejects foreign or empty files', () => {
  assert.equal(parseBackupPayload('not json'), null)
  assert.equal(parseBackupPayload(JSON.stringify({ version: 2, entries: {} })), null)
  assert.equal(parseBackupPayload(JSON.stringify({ version: 1, entries: { 'mindflow.ui.theme': 'dark' } })), null)
})

test('startMobileBackups gates startup on the restore check and reloads after restoring', async () => {
  freshStorage()
  addDoc('啟動還原')
  const filesystem = new FakeFilesystem()
  await makeStore({ filesystem }).store.writeBackup()
  globalThis.localStorage.clear()

  const session = new MemoryStorage()
  let reloaded = 0
  const started = startMobileBackups({
    windowRef: { localStorage: globalThis.localStorage, sessionStorage: session },
    documentRef: new EventTarget(),
    filesystem,
    share: null,
    importCopy: importDocumentCopy,
    setIntervalFn: () => assert.fail('還原後應重新載入，不啟動定期備份'),
    reload: () => { reloaded += 1 }
  })
  const settled = await Promise.race([started.ready.then(() => 'resolved'), new Promise(resolve => setTimeout(() => resolve('pending'), 50))])
  assert.equal(settled, 'pending', '還原後 ready 不解析，同步不會在重新載入前開始')
  assert.equal(reloaded, 1)
  assert.equal(consumeRestoredNotice({ sessionStorage: session }), true)
  assert.equal(consumeRestoredNotice({ sessionStorage: session }), false)

  const intervals = []
  const normal = startMobileBackups({
    windowRef: { localStorage: globalThis.localStorage, sessionStorage: session },
    documentRef: new EventTarget(),
    filesystem,
    importCopy: importDocumentCopy,
    setIntervalFn: (callback, delay) => { intervals.push(delay) },
    reload: () => assert.fail('有資料時不重新載入')
  })
  assert.equal(await normal.ready, false)
  assert.deepEqual(intervals, [120_000])
  assert.equal(startMobileBackups({ windowRef: {}, filesystem: null }), null, '沒有 Filesystem 外掛就不啟用')
})
