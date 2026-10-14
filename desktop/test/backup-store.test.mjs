import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BACKUP_INTERVAL_MS,
  backupFilePaths,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  preserveFailedRestoreSource,
  readLatestMindflowBackup,
  rendererRestoreScript,
  writeMindflowBackup
} from '../backup-store.mjs'
import vm from 'node:vm'

test('M1 複審：備份還原／舊資料搬入的 renderer 腳本先寫新的識別碼，且不讓還原內容帶進任何 mindflow.sync.* key', () => {
  const writes = []
  const store = new Map([['mindflow.sync.storeEpoch', 'epoch-before-loss']])
  const localStorage = {
    setItem(key, value) { writes.push(key); store.set(key, value) },
    getItem: key => store.get(key) ?? null
  }
  const entries = {
    'mindflow.docs.index': documentIndex(1),
    'mindflow.doc.doc-1': '{"id":"doc-1"}',
    'mindflow.sync.storeEpoch': 'smuggled-epoch',
    'other.app.key': 'ignored'
  }
  const count = vm.runInNewContext(rendererRestoreScript(entries, { storeEpoch: 'fresh-epoch' }), { localStorage })
  assert.equal(count, 2, '只算真正寫進去的 key')
  assert.equal(writes[0], 'mindflow.sync.storeEpoch', '識別碼最先寫')
  assert.equal(store.get('mindflow.sync.storeEpoch'), 'fresh-epoch', '還原內容不能把識別碼換回去')
  assert.deepEqual(writes.slice(1).sort(), ['mindflow.doc.doc-1', 'mindflow.docs.index'])
  assert.throws(() => rendererRestoreScript(entries, {}), /storeEpoch/)
})

function fakeLocalStorage(initial, { failOnWrite = 0 } = {}) {
  const store = new Map(Object.entries(initial))
  const writes = []
  let count = 0
  const api = {
    get length() { return store.size },
    key: index => [...store.keys()][index] ?? null,
    getItem: key => store.get(key) ?? null,
    setItem(key, value) {
      count += 1
      if (failOnWrite && count === failOnWrite) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
      writes.push(key)
      store.set(key, String(value))
    },
    removeItem(key) { store.delete(key) }
  }
  return { api, store, writes }
}

// 照 main 的方式跑還原腳本：腳本失敗時回傳結構化結果（executeJavaScript 帶不回錯誤的自訂欄位），轉成錯誤再拋出。
function runRestoreLikeMain(entries, localStorage) {
  const result = vm.runInNewContext(rendererRestoreScript(entries, { storeEpoch: 'fresh' }), { localStorage })
  if (result && typeof result === 'object' && result.restoreFailed) {
    throw Object.assign(new Error(result.message), { name: result.name, rollbackIncomplete: result.rollbackIncomplete })
  }
  return result
}

const restoreEntries = {
  'mindflow.docs.index': documentIndex(1),
  'mindflow.doc.doc-1': '{"id":"doc-1"}'
}

test('Sol #4：還原腳本寫入前在同一段執行裡重新確認儲存區仍是空的，否則取消', () => {
  // 讀備份的這段時間，使用者已經新建了一份文件
  const busy = fakeLocalStorage({ 'mindflow.docs.index': documentIndex(9), 'mindflow.doc.doc-9': '{"id":"doc-9"}' })
  assert.equal(vm.runInNewContext(rendererRestoreScript(restoreEntries, { storeEpoch: 'fresh' }), { localStorage: busy.api }), 0)
  assert.deepEqual(busy.writes, [], '一個 key 都不能寫')
  assert.equal(busy.store.get('mindflow.docs.index'), documentIndex(9))

  // 使用者刻意清空（合法的空索引）也不復活
  const emptied = fakeLocalStorage({ 'mindflow.docs.index': JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] }) })
  assert.equal(vm.runInNewContext(rendererRestoreScript(restoreEntries, { storeEpoch: 'fresh' }), { localStorage: emptied.api }), 0)
  assert.deepEqual(emptied.writes, [])

  // 真的空了（只剩偏好設定或壞索引）才還原
  const lost = fakeLocalStorage({ 'mindflow.ui.theme': 'dark', 'mindflow.docs.index': '{broken' })
  assert.equal(vm.runInNewContext(rendererRestoreScript(restoreEntries, { storeEpoch: 'fresh' }), { localStorage: lost.api }), 2)
})

test('Sol #6：自動還原失敗時，來源備份另存到不會被輪替的檔名', async () => {
  await withUserData(async userDataPath => {
    await writeMindflowBackup({ userDataPath, entries: restoreEntries, reason: 'interval' })
    const backup = await readLatestMindflowBackup({ userDataPath })
    const preserved = await preserveFailedRestoreSource({ userDataPath, sourcePath: backup.path, now: new Date('2026-10-14T09:30:00.000Z') })
    assert.match(preserved, /restore-failed-2026-10-14T09-30-00-000Z\.json$/)
    assert.equal(await readFile(preserved, 'utf8'), await readFile(backup.path, 'utf8'))
    assert.ok(!backupFilePaths(userDataPath).includes(preserved), '不在輪替名單裡')
  })
})

test('Sol 2-#2：還原失敗、來源備份還沒保護好（restore-pending.json 還在）之前，先保護來源再輪替，不能把它擠掉', async () => {
  await withUserData(async userDataPath => {
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(100) }, reason: 'interval' })
    const source = backupFilePaths(userDataPath)[0]
    const sourceText = await readFile(source, 'utf8')
    await writeFile(join(userDataPath, 'backups', 'restore-pending.json'), JSON.stringify({ version: 1, source }))

    for (let sequence = 0; sequence < 11; sequence += 1) {
      await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(sequence) }, reason: 'interval' })
    }
    const directory = join(userDataPath, 'backups')
    const texts = await Promise.all((await readdir(directory)).map(name => readFile(join(directory, name), 'utf8')))
    assert.ok(texts.includes(sourceText), '唯一含未上雲資料的來源備份必須還在')
  })
})

test('Sol 2-#2：還原寫到一半失敗、回滾也失敗 → 錯誤要明確標出「回滾沒完成」，不能吞掉', () => {
  const target = fakeLocalStorage({ 'mindflow.ui.theme': 'dark' }, { failOnWrite: 3 })
  target.api.removeItem = () => { throw new Error('storage unavailable') }
  let caught = null
  try {
    runRestoreLikeMain(restoreEntries, target.api)
  } catch (error) {
    caught = error
  }
  assert.ok(caught, '要拋出錯誤')
  assert.equal(caught.rollbackIncomplete, true)
})

test('Sol #6：還原寫到一半失敗（空間不足）→ 把已寫的回滾，不留下「看起來不是空的」半套內容', () => {
  const target = fakeLocalStorage({ 'mindflow.sync.storeEpoch': 'epoch-before', 'mindflow.ui.theme': 'dark' }, { failOnWrite: 3 })
  assert.throws(() => runRestoreLikeMain(restoreEntries, target.api), /Quota/)
  // 新識別碼寫成功之後的任何還原失敗都保留新識別碼（M1-A20）：舊的配上 sync-state.json 會讓舊 base 被信任
  assert.equal(target.store.get('mindflow.sync.storeEpoch'), 'fresh', '完整回滾也不恢復舊識別碼')
  assert.equal(target.store.has('mindflow.docs.index'), false)
  assert.equal(target.store.has('mindflow.doc.doc-1'), false)
  assert.equal(target.store.get('mindflow.ui.theme'), 'dark')
})

test('M1_NOTES 6-#13 補完：空間全滿、連新識別碼都沒寫成功 → 什麼都沒寫進去，識別碼維持原值，也不誤報「回滾沒完成」', () => {
  const target = fakeLocalStorage({ 'mindflow.sync.storeEpoch': 'epoch-before' })
  target.api.setItem = () => { throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }) }
  assert.throws(
    () => runRestoreLikeMain(restoreEntries, target.api),
    error => /Quota/.test(error.message) && error.rollbackIncomplete !== true,
    '什麼都沒改過，不能說撤回沒完成'
  )
  assert.deepEqual([...target.store.keys()], ['mindflow.sync.storeEpoch'])
  assert.equal(target.store.get('mindflow.sync.storeEpoch'), 'epoch-before')
})

function documentIndex(sequence) {
  return JSON.stringify({
    version: 2,
    docs: [{ id: `doc-${sequence}`, title: `文件 ${sequence}` }],
    trash: [],
    favorites: []
  })
}

function indexedSequence(snapshot) {
  return JSON.parse(snapshot.entries['mindflow.docs.index']).docs[0].id
}

async function withUserData(run) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-backup-'))
  try {
    await run(userDataPath)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
}

test('production backup interval is exactly two minutes', () => {
  assert.equal(BACKUP_INTERVAL_MS, 120000)
})

test('only counts a storage snapshot as populated when documents survive', () => {
  assert.equal(hasMindflowDocuments({ 'mindflow.docs.index': documentIndex(1) }), true)
  assert.equal(hasMindflowDocuments({
    'mindflow.docs.index': JSON.stringify({ docs: [], trash: [{ id: 'a' }] })
  }), true)

  // 偏好設定殘留不算資料，否則文件掉光時永遠不會觸發救援。
  assert.equal(hasMindflowDocuments({ 'mindflow.theme': 'dark' }), false)
  assert.equal(hasMindflowDocuments({
    'mindflow.docs.index': JSON.stringify({ docs: [], trash: [] })
  }), false)
  assert.equal(hasMindflowDocuments({}), false)

  // 索引壞掉但文件還在時算有資料，救援才不會拿舊備份蓋掉現存文件。
  assert.equal(hasMindflowDocuments({
    'mindflow.docs.index': '{broken',
    'mindflow.doc.a': '{"id":"a"}'
  }), true)
  assert.equal(hasMindflowDocuments({ 'mindflow.doc.a': '{"id":"a"}' }), true)
  assert.equal(hasMindflowDocuments({ 'mindflow.docs.index': '{broken' }), false)
})

test('treats a valid empty index as an intentional state so rescue does not resurrect it', () => {
  // 使用者刻意清空：合法空索引＝刻意狀態，救援不得發動
  assert.equal(hasIntentionalMindflowState({
    'mindflow.docs.index': JSON.stringify({ docs: [], trash: [] })
  }), true)
  // 索引消失且無文件＝真的掉資料，救援要發動
  assert.equal(hasIntentionalMindflowState({ 'mindflow.theme': 'dark' }), false)
  assert.equal(hasIntentionalMindflowState({}), false)
  // 索引壞掉但文件還在＝仍是有資料的狀態，不得拿舊備份蓋掉
  assert.equal(hasIntentionalMindflowState({
    'mindflow.docs.index': '{broken',
    'mindflow.doc.a': '{"id":"a"}'
  }), true)
  // 索引壞掉且文件掉光＝需要救援
  assert.equal(hasIntentionalMindflowState({ 'mindflow.docs.index': '{broken' }), false)
})

test('writes the fixed latest filename and rotates the previous nine snapshots', async () => {
  await withUserData(async userDataPath => {
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      await writeMindflowBackup({
        userDataPath,
        entries: {
          'mindflow.docs.index': documentIndex(sequence),
          unrelated: 'must be excluded'
        },
        now: new Date(`2026-07-25T00:${String(sequence).padStart(2, '0')}:00.000Z`)
      })
    }

    const paths = backupFilePaths(userDataPath)
    assert.equal(paths.length, 10)
    const snapshots = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))))

    assert.equal(indexedSequence(snapshots[0]), 'doc-12')
    assert.equal(indexedSequence(snapshots[9]), 'doc-3')
    assert.equal('unrelated' in snapshots[0].entries, false)
  })
})

test('falls back to the newest readable history when the latest file is corrupt', async () => {
  await withUserData(async userDataPath => {
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(1) } })
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(2) } })
    const [latest] = backupFilePaths(userDataPath)
    await writeFile(latest, '{broken', 'utf8')

    const recovered = await readLatestMindflowBackup({ userDataPath })
    assert.equal(JSON.parse(recovered.entries['mindflow.docs.index']).docs[0].id, 'doc-1')
    assert.match(recovered.path, /mindflow-backup-1\.json$/)
  })
})

test('does not overwrite good backups with a completely empty origin', async () => {
  await withUserData(async userDataPath => {
    const written = await writeMindflowBackup({ userDataPath, entries: {} })
    assert.equal(written, null)
  })
})

test('refuses to rotate a good backup out with a preference-only snapshot', async () => {
  await withUserData(async userDataPath => {
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(1) } })

    const written = await writeMindflowBackup({
      userDataPath,
      entries: { 'mindflow.theme': 'dark', 'mindflow.zoom': '1.25' }
    })

    const [latest, previous] = backupFilePaths(userDataPath)
    assert.equal(written, null)
    assert.equal(indexedSequence(JSON.parse(await readFile(latest, 'utf8'))), 'doc-1')
    await assert.rejects(readFile(previous, 'utf8'), { code: 'ENOENT' })
  })
})

test('skips rotation when the snapshot is identical to the latest backup', async () => {
  await withUserData(async userDataPath => {
    const entries = { 'mindflow.docs.index': documentIndex(1) }
    await writeMindflowBackup({ userDataPath, entries })
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(2) } })

    // 閒置時每兩分鐘寫同一份快照，不能把還留著的舊版本一份份擠掉。
    const repeated = await writeMindflowBackup({
      userDataPath,
      entries: { 'mindflow.docs.index': documentIndex(2) }
    })

    const [latest, previous, older] = backupFilePaths(userDataPath)
    assert.equal(repeated, null)
    assert.equal(indexedSequence(JSON.parse(await readFile(latest, 'utf8'))), 'doc-2')
    assert.equal(indexedSequence(JSON.parse(await readFile(previous, 'utf8'))), 'doc-1')
    await assert.rejects(readFile(older, 'utf8'), { code: 'ENOENT' })
  })
})

test('reads past preference-only backups to find one that still holds documents', async () => {
  await withUserData(async userDataPath => {
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(1) } })
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(2) } })

    // 模擬舊版寫出來的、只剩偏好設定的快照佔住最新那格。
    const [latest] = backupFilePaths(userDataPath)
    await writeFile(latest, JSON.stringify({
      version: 1,
      createdAt: '2026-07-25T00:00:00.000Z',
      reason: 'interval',
      entries: { 'mindflow.theme': 'dark' }
    }), 'utf8')

    const recovered = await readLatestMindflowBackup({ userDataPath })
    assert.equal(JSON.parse(recovered.entries['mindflow.docs.index']).docs[0].id, 'doc-1')
    assert.match(recovered.path, /mindflow-backup-1\.json$/)
  })
})
