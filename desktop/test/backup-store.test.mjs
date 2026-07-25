import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BACKUP_INTERVAL_MS,
  backupFilePaths,
  readLatestMindflowBackup,
  writeMindflowBackup
} from '../backup-store.mjs'

test('production backup interval is exactly two minutes', () => {
  assert.equal(BACKUP_INTERVAL_MS, 120000)
})

test('writes the fixed latest filename and rotates the previous nine snapshots', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-backup-'))
  try {
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      await writeMindflowBackup({
        userDataPath,
        entries: {
          'mindflow.docs.index': JSON.stringify({ sequence }),
          unrelated: 'must be excluded'
        },
        now: new Date(`2026-07-25T00:${String(sequence).padStart(2, '0')}:00.000Z`)
      })
    }

    const paths = backupFilePaths(userDataPath)
    assert.equal(paths.length, 10)
    const snapshots = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))))

    assert.equal(snapshots[0].entries['mindflow.docs.index'], '{"sequence":12}')
    assert.equal(snapshots[9].entries['mindflow.docs.index'], '{"sequence":3}')
    assert.equal('unrelated' in snapshots[0].entries, false)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('falls back to the newest readable history when the latest file is corrupt', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-backup-'))
  try {
    await writeMindflowBackup({
      userDataPath,
      entries: { 'mindflow.docs.index': '{"sequence":1}' }
    })
    await writeMindflowBackup({
      userDataPath,
      entries: { 'mindflow.docs.index': '{"sequence":2}' }
    })
    const [latest] = backupFilePaths(userDataPath)
    await writeFile(latest, '{broken', 'utf8')

    const recovered = await readLatestMindflowBackup({ userDataPath })
    assert.equal(recovered.entries['mindflow.docs.index'], '{"sequence":1}')
    assert.match(recovered.path, /mindflow-backup-1\.json$/)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('does not overwrite good backups with a completely empty origin', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-backup-'))
  try {
    const written = await writeMindflowBackup({ userDataPath, entries: {} })
    assert.equal(written, null)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})
