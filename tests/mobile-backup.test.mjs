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
  consumeRestoreFailedNotice,
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

test('M1 複審：自動還原先換掉本機儲存區識別碼再寫內容，同步才不會信任較新的 base', async () => {
  freshStorage()
  addDoc('備份裡的文件')
  const filesystem = new FakeFilesystem()
  await makeStore({ filesystem }).store.writeBackup()

  // WebView 資料不見，但留下舊的識別碼（或升級前根本沒有識別碼）
  const writes = []
  const target = new MemoryStorage()
  target.setItem('mindflow.sync.storeEpoch', 'epoch-before-loss')
  const recording = new Proxy(target, {
    get(object, property) {
      if (property === 'setItem') return (key, value) => { writes.push(String(key)); object.setItem(key, value) }
      const value = Reflect.get(object, property, object)
      return typeof value === 'function' ? value.bind(object) : value
    }
  })
  const store = createMobileBackupStore({ filesystem, storage: recording, importCopy: importDocumentCopy })
  assert.equal(await store.restoreLatestIfEmpty(), true)

  assert.equal(writes[0], 'mindflow.sync.storeEpoch', '識別碼必須最先寫：還原內容落盤時新標記一定已在磁碟上')
  const marker = target.getItem('mindflow.sync.storeEpoch')
  assert.equal(typeof marker, 'string')
  assert.notEqual(marker, 'epoch-before-loss')
  assert.ok(writes.includes('mindflow.docs.index'))
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
  backup.entries['mindflow.doc.from-future'] = JSON.stringify({ ...future, id: 'from-future', schemaVersion: 2, title: '未來格式' })

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

function failingStorage(target, failOnWrite) {
  let count = 0
  return new Proxy(target, {
    get(object, property) {
      if (property === 'setItem') {
        return (key, value) => {
          count += 1
          if (count === failOnWrite) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
          object.setItem(key, value)
        }
      }
      const value = Reflect.get(object, property, object)
      return typeof value === 'function' ? value.bind(object) : value
    }
  })
}

async function backupWithTwoDocuments() {
  freshStorage()
  addDoc('備份裡的 A')
  addDoc('備份裡的 B')
  const filesystem = new FakeFilesystem()
  await makeStore({ filesystem }).store.writeBackup()
  return filesystem
}

test('Sol #6：自動還原寫到一半失敗 → 回滾已寫的內容，儲存區維持「空的」，下次開啟還會再自動還原', async () => {
  const filesystem = await backupWithTwoDocuments()
  const target = new MemoryStorage()
  target.setItem('mindflow.sync.storeEpoch', 'epoch-before')
  target.setItem('mindflow.ui.theme', 'dark')
  const store = createMobileBackupStore({ filesystem, storage: failingStorage(target, 3), importCopy: importDocumentCopy })
  await assert.rejects(store.restoreLatestIfEmpty(), /Quota/)

  const keys = Array.from({ length: target.length }, (_, index) => target.key(index)).sort()
  assert.deepEqual(keys, ['mindflow.sync.storeEpoch', 'mindflow.ui.theme'], '不能留下半套文件')
  assert.equal(target.getItem('mindflow.sync.storeEpoch'), 'epoch-before')
  // 空間清出來之後（不再失敗）重新開啟：照常自動還原
  const retry = createMobileBackupStore({ filesystem, storage: target, importCopy: importDocumentCopy })
  assert.equal(await retry.restoreLatestIfEmpty(), true)
})

test('Sol #6：自動還原失敗和「不需要還原」是不同的結果：要留下提示，也不啟動會輪替掉備份的定期備份', async () => {
  const filesystem = await backupWithTwoDocuments()
  const target = new MemoryStorage()
  const session = new MemoryStorage()
  const started = startMobileBackups({
    windowRef: { localStorage: failingStorage(target, 2), sessionStorage: session },
    documentRef: new EventTarget(),
    filesystem,
    share: null,
    importCopy: importDocumentCopy,
    setIntervalFn: () => assert.fail('還原失敗時不能啟動定期備份'),
    reload: () => assert.fail('還原失敗時不重新載入')
  })
  assert.equal(await started.ready, false)
  assert.ok(session.getItem('mindflow.backup.restoreFailed'), '要留下「還原失敗」的提示')
  assert.equal(consumeRestoredNotice({ sessionStorage: session }), false, '不能當成還原成功')
  assert.equal(consumeRestoreFailedNotice({ sessionStorage: session }), true)
  assert.equal(consumeRestoreFailedNotice({ sessionStorage: session }), false, '只提示一次')

  // 還沒救回的那份另存到不在輪替名單裡的位置，「從自動備份還原」列在最上面
  const list = await started.store.listBackups()
  assert.equal(list[0].preserved, true)
  assert.equal(list[0].path, 'backups/restore-failed.json')
  assert.equal(list[0].docCount, 2)
  assert.ok(!mobileBackupPaths().includes(list[0].path), '輪替不會擠掉它')
})

test('Sol 2-#2（手機）：還原失敗、來源備份還沒保護好（restore-pending.json 還在）之前，先保護來源再輪替，不能把它擠掉', async () => {
  freshStorage()
  addDoc('只在備份裡的 B')
  const filesystem = new FakeFilesystem()
  const { store } = makeStore({ filesystem })
  await store.writeBackup()
  const source = mobileBackupPaths()[0]
  const sourceText = filesystem.files.get(`DATA:${source}`)
  filesystem.files.set('DATA:backups/restore-pending.json', JSON.stringify({ version: 1, source }))

  const doc = addDoc('之後的新內容')
  for (let index = 0; index < MOBILE_BACKUP_LIMIT + 1; index += 1) {
    doc.title = `第 ${index} 版`
    saveDocument(doc, { expectedUpdatedAt: loadDocument(doc.id).updatedAt })
    await store.writeBackup()
  }
  assert.ok([...filesystem.files.values()].includes(sourceText), '唯一含未上雲資料的來源備份必須還在')
})

test('Sol 2-#2（手機）：還原失敗、另存來源也失敗 → 定期備份暫停輪替；之後另存成功才恢復', async () => {
  const filesystem = await backupWithTwoDocuments()
  const sourceText = filesystem.files.get(`DATA:${mobileBackupPaths()[0]}`)
  // 另存保留檔失敗（空間不足）：保留檔改用 writeFile 寫入（先比對既有內容、不覆蓋不同的保留檔）
  const realWrite = filesystem.writeFile.bind(filesystem)
  let copyFails = true
  filesystem.writeFile = async args => {
    if (copyFails && /^backups\/restore-failed(-\d+)?\.json$/u.test(args.path)) throw new Error('No space left on device')
    return realWrite(args)
  }
  const target = new MemoryStorage()
  const failing = createMobileBackupStore({ filesystem, storage: failingStorage(target, 2), importCopy: importDocumentCopy })
  await assert.rejects(failing.restoreLatestIfEmpty(), /Quota/)

  // 同步拉回了一部分、使用者繼續用：在來源保護好之前，定期備份不能輪替
  globalThis.localStorage.clear()
  addDoc('同步拉回的 A')
  const store = createMobileBackupStore({ filesystem, storage: globalThis.localStorage, importCopy: importDocumentCopy })
  assert.equal(await store.writeBackup(), null, '來源還沒保護好：暫停輪替')
  assert.equal(filesystem.files.get(`DATA:${mobileBackupPaths()[0]}`), sourceText)

  copyFails = false
  assert.ok(await store.writeBackup(), '另存成功後恢復備份')
  assert.equal(filesystem.files.get('DATA:backups/restore-failed.json'), sourceText)
})

async function storeWithPendingSource() {
  freshStorage()
  addDoc('只在備份裡的 B')
  const filesystem = new FakeFilesystem()
  const { store } = makeStore({ filesystem })
  await store.writeBackup()
  const source = mobileBackupPaths()[0]
  const sourceText = filesystem.files.get(`DATA:${source}`)
  filesystem.files.set('DATA:backups/restore-pending.json', JSON.stringify({ version: 1, source }))
  return { filesystem, store, source, sourceText }
}

function editAndSave(doc, title) {
  doc.title = title
  saveDocument(doc, { expectedUpdatedAt: loadDocument(doc.id).updatedAt })
}

test('Sol 3-#1（手機）：待保護標記存在但讀不出來（不是「檔案不存在」）→ 不能當成沒有待保護的來源，這一次不輪替', async () => {
  const { filesystem, store, source, sourceText } = await storeWithPendingSource()
  const realRead = filesystem.readFile.bind(filesystem)
  let markerReadFails = true
  filesystem.readFile = async args => {
    if (markerReadFails && args.path === 'backups/restore-pending.json') throw new Error('EIO: i/o error')
    return realRead(args)
  }
  const doc = addDoc('同步拉回的 A')
  editAndSave(doc, 'A v2')
  assert.equal(await store.writeBackup(), null, '讀不出標記：暫停輪替')
  assert.equal(filesystem.files.get(`DATA:${source}`), sourceText, '來源沒有被輪替掉')

  markerReadFails = false
  assert.ok(await store.writeBackup(), '標記讀得到之後：先保護來源，再照常輪替')
  assert.ok([...filesystem.files.values()].includes(sourceText), '唯一含 B 的來源仍在')
})

test('Sol 3-#2（手機）：來源另存成功但清標記失敗 → 之後的重試不會把保留檔覆蓋成已輪替的新內容', async () => {
  const { filesystem, store, sourceText } = await storeWithPendingSource()
  const realWrite = filesystem.writeFile.bind(filesystem)
  let clearFails = true
  filesystem.writeFile = async args => {
    if (clearFails && args.path === 'backups/restore-pending.json') throw new Error('No space left on device')
    return realWrite(args)
  }
  const doc = addDoc('同步拉回的 A')
  for (let index = 0; index < 3; index += 1) {
    editAndSave(doc, `A 第 ${index} 版`)
    await store.writeBackup()
  }
  clearFails = false
  for (let index = 0; index < MOBILE_BACKUP_LIMIT + 1; index += 1) {
    editAndSave(doc, `A 之後 ${index}`)
    await store.writeBackup()
  }
  assert.equal(filesystem.files.get('DATA:backups/restore-failed.json'), sourceText, '保留檔不能被覆蓋成只剩 A 的新備份')
})

test('Sol 3-#2（手機）：之前保留過的檔案，不能被另一次還原失敗的來源覆蓋', async () => {
  freshStorage()
  addDoc('上一次事件只在備份裡的 X')
  const earlierFilesystem = new FakeFilesystem()
  await makeStore({ filesystem: earlierFilesystem }).store.writeBackup()
  const earlierPreserved = earlierFilesystem.files.get(`DATA:${mobileBackupPaths()[0]}`)

  const filesystem = await backupWithTwoDocuments()
  const sourceText = filesystem.files.get(`DATA:${mobileBackupPaths()[0]}`)
  filesystem.files.set('DATA:backups/restore-failed.json', earlierPreserved)
  const target = new MemoryStorage()
  const failing = createMobileBackupStore({ filesystem, storage: failingStorage(target, 2), importCopy: importDocumentCopy })
  await assert.rejects(failing.restoreLatestIfEmpty(), /Quota/)

  assert.equal(filesystem.files.get('DATA:backups/restore-failed.json'), earlierPreserved, '舊的保留檔不能被覆蓋')
  const preserved = (await failing.listBackups()).filter(item => item.preserved)
  assert.equal(preserved.length, 2, '這一次的來源另存到另一個位置，兩份都列在「從自動備份還原」')
  assert.ok(preserved.some(item => filesystem.files.get(`DATA:${item.path}`) === sourceText))
})

test('Sol 2-#2（手機）：還原寫到一半失敗、回滾也失敗 → 錯誤要明確標出「回滾沒完成」', async () => {
  const filesystem = await backupWithTwoDocuments()
  const target = new MemoryStorage()
  const storage = new Proxy(failingStorage(target, 3), {
    get(object, property) {
      if (property === 'removeItem') return () => { throw new Error('storage unavailable') }
      return Reflect.get(object, property)
    }
  })
  const store = createMobileBackupStore({ filesystem, storage, importCopy: importDocumentCopy })
  const error = await store.restoreLatestIfEmpty().then(() => null, caught => caught)
  assert.ok(error)
  assert.equal(error.rollbackIncomplete, true)
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
