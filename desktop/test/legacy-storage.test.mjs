import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  discoverLegacyOrigins,
  mergeLegacyMindflowEntries
} from '../legacy-storage.mjs'

function doc(id, title, updatedAt) {
  return {
    id,
    title,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    thumbnail: '',
    root: { id: 'root', text: title, children: [] }
  }
}

function candidate(origin, documents, extras = {}) {
  return {
    origin,
    entries: {
      'mindflow.docs.index': JSON.stringify({
        version: 2,
        docs: documents.map(document => ({
          id: document.id,
          title: document.title,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          thumbnail: ''
        })),
        trash: extras.trash || [],
        favorites: extras.favorites || []
      }),
      ...Object.fromEntries(documents.map(document => [
        `mindflow.doc.${document.id}`,
        JSON.stringify(document)
      ]))
    }
  }
}

test('discovers old random-port origins from Chromium LevelDB files', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-legacy-'))
  const levelDbPath = join(userDataPath, 'Local Storage', 'leveldb')
  await mkdir(levelDbPath, { recursive: true })
  await writeFile(
    join(levelDbPath, '000003.log'),
    Buffer.from('\u0000_http://127.0.0.1:49152\u0000mindflow.docs.index\u0000http://127.0.0.1:8931')
  )

  try {
    assert.deepEqual(await discoverLegacyOrigins([userDataPath]), [
      'http://127.0.0.1:49152',
      'http://127.0.0.1:8931'
    ])
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('merges documents scattered across old origins and keeps the newest duplicate', () => {
  const first = doc('a', 'A old', '2026-01-01T01:00:00.000Z')
  const newer = doc('a', 'A new', '2026-01-03T01:00:00.000Z')
  const second = doc('b', 'B', '2026-01-02T01:00:00.000Z')
  const merged = mergeLegacyMindflowEntries([
    candidate('http://127.0.0.1:49152', [first], { favorites: ['a'] }),
    candidate('http://127.0.0.1:49153', [newer, second])
  ])
  const index = JSON.parse(merged['mindflow.docs.index'])

  assert.equal(JSON.parse(merged['mindflow.doc.a']).title, 'A new')
  assert.equal(JSON.parse(merged['mindflow.doc.b']).title, 'B')
  assert.deepEqual(index.docs.map(item => item.id), ['a', 'b'])
  assert.deepEqual(index.favorites, ['a'])
})

test('ignores candidates without a valid document index', () => {
  assert.deepEqual(mergeLegacyMindflowEntries([
    { origin: 'http://127.0.0.1:49152', entries: { 'mindflow.doc.x': '{}' } }
  ]), {})
})
