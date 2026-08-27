import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BACKUP_INTERVAL_MS,
  backupFilePaths,
  hasIntentionalMindflowState,
  hasMindflowDocuments,
  readLatestMindflowBackup,
  writeMindflowBackup
} from '../backup-store.mjs'

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
