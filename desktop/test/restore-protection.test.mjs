import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import vm from 'node:vm'

import {
  backupFilePaths,
  ensureRestoreSourceProtected,
  markRestorePending,
  recoveryFailedDetail,
  rendererRecoveryCheckScript,
  restoreScriptOutcome,
  writeMindflowBackup
} from '../backup-store.mjs'

function runRecoveryCheck(initial, { full = false } = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    get length() { return store.size },
    key: index => [...store.keys()][index] ?? null,
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => {
      if (full) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' })
      store.set(key, String(value))
    },
    removeItem: key => { store.delete(key) }
  }
  const entries = vm.runInNewContext(rendererRecoveryCheckScript({ storeEpoch: 'fresh' }), { localStorage })
  return { store, entries }
}

test('M1_NOTES 6-#13 根治：main 判定本機是不是空的那段腳本，讀不到索引（不存在或損壞）就在同一段執行裡換掉舊識別碼（空間全滿時至少移除）', () => {
  for (const [label, initial] of [
    ['全空', { 'mindflow.sync.storeEpoch': 'old', 'mindflow.ui.theme': 'dark' }],
    ['索引不見、還剩文件', { 'mindflow.sync.storeEpoch': 'old', 'mindflow.doc.A': '{"id":"A"}' }],
    ['索引損壞', { 'mindflow.sync.storeEpoch': 'old', 'mindflow.docs.index': '{broken', 'mindflow.doc.A': '{"id":"A"}' }]
  ]) {
    const { store, entries } = runRecoveryCheck(initial)
    assert.equal(store.get('mindflow.sync.storeEpoch'), 'fresh', `${label}：舊識別碼換成新的`)
    assert.equal(entries['mindflow.sync.storeEpoch'], 'fresh', `${label}：讀回的內容是換掉之後的`)
    for (const key of Object.keys(initial).filter(key => key !== 'mindflow.sync.storeEpoch')) {
      assert.equal(entries[key], initial[key], `${label}：其他內容照樣讀回、不動`)
      assert.equal(store.get(key), initial[key])
    }
    // 空間全滿、新的寫不進去：至少已經移除（removeItem 不受空間限制）
    assert.equal(runRecoveryCheck(initial, { full: true }).store.has('mindflow.sync.storeEpoch'), false, `${label}：空間全滿時識別碼移除`)
  }
  for (const [label, index] of [['刻意清空的空索引', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] })], ['正常索引', documentIndex(1)]]) {
    const { store } = runRecoveryCheck({ 'mindflow.sync.storeEpoch': 'kept', 'mindflow.docs.index': index })
    assert.equal(store.get('mindflow.sync.storeEpoch'), 'kept', `${label}：識別碼不動`)
  }
  assert.throws(() => rendererRecoveryCheckScript({}), /storeEpoch/)
})

test('還原失敗對話框：撤回沒完成時不說「重新開啟會再自動還原」，改說明本機留著部分文件、不會再自動還原，以及其餘文件在哪裡', () => {
  const preserved = recoveryFailedDetail({ preservedBackupPath: 'C:\\backups\\restore-failed-1.json', backupsDirectory: 'C:\\backups', rollbackIncomplete: true })
  assert.doesNotMatch(preserved, /會再自動還原一次/)
  assert.doesNotMatch(preserved, /已寫入的部分已撤回/, '不能前後矛盾')
  assert.match(preserved, /不會再自動還原/)
  assert.match(preserved, /restore-failed-1\.json/)
  assert.match(preserved, /雲端/)

  const legacy = recoveryFailedDetail({ preservedBackupPath: undefined, backupsDirectory: 'C:\\backups', rollbackIncomplete: true })
  assert.match(legacy, /不會再自動/)
  assert.match(legacy, /舊版 MindFlow 的資料/)
  assert.doesNotMatch(legacy, /上面的備份/, '舊資料搬入沒有「上面的備份」')

  // 撤回成功：本機維持空的，重新開啟確實會再自動還原一次
  const complete = recoveryFailedDetail({ preservedBackupPath: null, backupsDirectory: 'C:\\backups', rollbackIncomplete: false })
  assert.match(complete, /已寫入的部分已撤回/)
  assert.match(complete, /會再自動還原一次/)
  assert.match(complete, /C:\\backups/)
})

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
