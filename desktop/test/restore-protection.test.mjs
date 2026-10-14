import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  backupFilePaths,
  ensureRestoreSourceProtected,
  markRestorePending,
  restoreScriptOutcome,
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

async function withUserData(run) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-restore-protection-'))
  try {
    await run(userDataPath)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
}

test('Sol 2-#2：main 把還原腳本的結構化失敗轉回錯誤，rollbackIncomplete 一路帶到對話框', () => {
  assert.equal(restoreScriptOutcome(2), 2)
  assert.equal(restoreScriptOutcome(0), 0)
  assert.throws(
    () => restoreScriptOutcome({ restoreFailed: true, name: 'QuotaExceededError', message: 'quota', rollbackIncomplete: true }),
    error => error.name === 'QuotaExceededError' && error.rollbackIncomplete === true
  )
})

test('Sol 2-#2：來源另存一直失敗 → 這一次不輪替；另存成功才恢復，並清掉待保護標記', async () => {
  await withUserData(async userDataPath => {
    await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(100) }, reason: 'interval' })
    const source = backupFilePaths(userDataPath)[0]
    const sourceText = await readFile(source, 'utf8')
    await markRestorePending({ userDataPath, sourcePath: source })

    const failingCopy = async () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }) }
    const paused = await writeMindflowBackup({
      userDataPath,
      entries: { 'mindflow.docs.index': documentIndex(1) },
      protectRestoreSource: () => ensureRestoreSourceProtected({ userDataPath, copy: failingCopy })
    })
    assert.equal(paused, null, '來源還沒保護好：不輪替')
    assert.equal(await readFile(source, 'utf8'), sourceText)

    assert.ok(await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(2) } }), '另存成功後恢復')
    const directory = join(userDataPath, 'backups')
    const names = await readdir(directory)
    assert.ok(!names.includes('restore-pending.json'), '標記已清掉')
    const preserved = names.find(name => name.startsWith('restore-failed-'))
    assert.equal(await readFile(join(directory, preserved), 'utf8'), sourceText)
  })
})

test('Sol 2-#2：待保護標記指向的來源已經不在（沒有東西可保護）→ 清掉標記、照常輪替', async () => {
  await withUserData(async userDataPath => {
    await markRestorePending({ userDataPath, sourcePath: join(userDataPath, 'backups', 'gone.json') })
    assert.ok(await writeMindflowBackup({ userDataPath, entries: { 'mindflow.docs.index': documentIndex(3) } }))
    assert.ok(!(await readdir(join(userDataPath, 'backups'))).includes('restore-pending.json'))
  })
})
