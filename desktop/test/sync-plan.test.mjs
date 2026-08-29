import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MANIFEST_SCHEMA_VERSION,
  buildConflictCopy,
  buildLocalState,
  computeLocalWrites,
  computeSyncPlan,
  emptyManifest
} from '../sync-plan.mjs'
import { ensureRepo, getRef } from '../sync-github.mjs'
import { loadSyncSettings } from '../sync-settings.mjs'
import * as syncSettingsUi from '../../js/settings.js'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T01:00:00.000Z'
const T2 = '2026-01-01T02:00:00.000Z'
const T3 = '2026-01-01T03:00:00.000Z'
const T4 = '2026-01-01T04:00:00.000Z'
const T5 = '2026-01-01T05:00:00.000Z'

function meta(id, updatedAt = T1, overrides = {}) {
  return {
    title: `文件 ${id}`,
    createdAt: T0,
    updatedAt,
    state: 'active',
    ...overrides
  }
}

function blob(id, updatedAt = T1, overrides = {}) {
  return JSON.stringify({
    id,
    title: `文件 ${id}`,
    createdAt: T0,
    updatedAt,
    thumbnail: `<svg data-id="${id}"></svg>`,
    root: { id: `root-${id}`, text: id, children: [] },
    ...overrides
  })
}

function localState(docs = {}, favorites = [], docBlobs = {}) {
  const completedBlobs = { ...docBlobs }
  for (const [id, document] of Object.entries(docs)) {
    if (!(id in completedBlobs)) completedBlobs[id] = blob(id, document.updatedAt, { title: document.title })
  }
  return { docs, favorites, docBlobs: completedBlobs }
}

function manifest(docs = {}, favorites = [], tombstones = {}, lastWriter = 'remote-machine') {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    docs,
    favorites,
    tombstones,
    lastWriter
  }
}

function syncedBase(docs = {}, favorites = [], tombstones = {}) {
  return {
    manifest: manifest(docs, favorites, tombstones, 'base-machine'),
    perDoc: Object.fromEntries(Object.entries(docs).map(([id, document]) => [id, document.updatedAt]))
  }
}

function planFor(local, remoteManifest, base = null, overrides = {}) {
  return computeSyncPlan({
    local,
    remoteManifest,
    base,
    machineId: 'local-machine',
    now: T5,
    ...overrides
  })
}

test('emptyManifest returns the frozen schema shape', () => {
  assert.equal(MANIFEST_SCHEMA_VERSION, 1)
  assert.deepEqual(emptyManifest(), {
    schemaVersion: 1,
    docs: {},
    favorites: [],
    tombstones: {},
    lastWriter: null
  })
})

test('emptyManifest does not share mutable collections across calls', () => {
  const first = emptyManifest()
  first.docs.a = meta('a')
  first.favorites.push('a')
  first.tombstones.a = T1
  assert.deepEqual(emptyManifest(), {
    schemaVersion: 1,
    docs: {},
    favorites: [],
    tombstones: {},
    lastWriter: null
  })
})

test('buildLocalState converts active, trash, favorites, and document blobs', () => {
  const activeBlob = blob('a', T2)
  const trashBlob = blob('b', T1)
  const result = buildLocalState({
    'mindflow.docs.index': JSON.stringify({
      version: 2,
      docs: [{ id: 'a', title: 'A', createdAt: T0, updatedAt: T2, thumbnail: '<svg>old</svg>' }],
      trash: [{ id: 'b', title: 'B', createdAt: T0, updatedAt: T1, deletedAt: T3 }],
      favorites: ['a', 'a', 'missing']
    }),
    'mindflow.doc.a': activeBlob,
    'mindflow.doc.b': trashBlob
  })

  assert.deepEqual(result.docs, {
    a: { title: 'A', createdAt: T0, updatedAt: T2, state: 'active' },
    b: { title: 'B', createdAt: T0, updatedAt: T1, state: 'trashed', deletedAt: T3 }
  })
  assert.deepEqual(result.favorites, ['a'])
  assert.deepEqual(result.docBlobs, { a: activeBlob, b: trashBlob })
})

test('buildLocalState ignores history and unrelated mindflow keys', () => {
  const result = buildLocalState({
    'mindflow.docs.index': JSON.stringify({ docs: [], trash: [], favorites: [] }),
    'mindflow.history.a': '[{"snapshot":true}]',
    'mindflow.theme': 'dark'
  })
  assert.deepEqual(result, { docs: {}, favorites: [], docBlobs: {} })
})

test('buildLocalState rebuilds a corrupt index from valid document keys', () => {
  const valid = blob('a', T2, { title: '救回 A' })
  const result = buildLocalState({
    'mindflow.docs.index': '{broken',
    'mindflow.doc.a': valid,
    'mindflow.doc.b': '{broken'
  })
  assert.deepEqual(result.docs, {
    a: { title: '救回 A', createdAt: T0, updatedAt: T2, state: 'active' }
  })
  assert.deepEqual(result.favorites, [])
  assert.deepEqual(result.docBlobs, { a: valid })
})

test('buildLocalState rebuilds when the index is absent', () => {
  const valid = blob('a', T2)
  assert.deepEqual(buildLocalState({ 'mindflow.doc.a': valid }).docs, {
    a: meta('a', T2)
  })
})

test('buildLocalState respects an intentional valid empty index', () => {
  const result = buildLocalState({
    'mindflow.docs.index': JSON.stringify({ docs: [], trash: [], favorites: [] }),
    'mindflow.doc.orphan': blob('orphan', T2)
  })
  assert.deepEqual(result.docs, {})
  assert.deepEqual(result.docBlobs, { orphan: blob('orphan', T2) })
})

test('buildLocalState rejects mismatched document ids during index rebuild', () => {
  const result = buildLocalState({
    'mindflow.docs.index': '{broken',
    'mindflow.doc.a': blob('different', T2)
  })
  assert.deepEqual(result, {
    docs: {},
    favorites: [],
    docBlobs: {},
    rebuilt: true,
    quarantinedIds: ['a']
  })
})

test('first sync pushes a local-only document', () => {
  const result = planFor(localState({ a: meta('a', T1) }), manifest())
  assert.deepEqual(result.pushDocs, ['a'])
  assert.deepEqual(result.pullDocs, [])
  assert.deepEqual(result.nextManifest.docs, { a: meta('a', T1) })
  assert.equal(result.nextManifest.lastWriter, 'local-machine')
  assert.deepEqual(result.nextPerDoc, { a: T1 })
})

test('first sync pulls a remote-only document', () => {
  const result = planFor(localState(), manifest({ b: meta('b', T2) }))
  assert.deepEqual(result.pushDocs, [])
  assert.deepEqual(result.pullDocs, ['b'])
  assert.deepEqual(result.nextManifest.docs, { b: meta('b', T2) })
})

test('first sync forms a bidirectional union of distinct documents', () => {
  const result = planFor(
    localState({ a: meta('a', T1) }),
    manifest({ b: meta('b', T2) })
  )
  assert.deepEqual(result.pushDocs, ['a'])
  assert.deepEqual(result.pullDocs, ['b'])
  assert.deepEqual(Object.keys(result.nextManifest.docs), ['a', 'b'])
})

test('first sync does not apply a remote tombstone to a local document', () => {
  const result = planFor(
    localState({ a: meta('a', T2) }),
    manifest({}, [], { a: T3 })
  )
  assert.deepEqual(result.purgeLocal, [])
  assert.deepEqual(result.resurrect, [])
  assert.deepEqual(result.pushDocs, ['a'])
  assert.deepEqual(result.nextManifest.docs, { a: meta('a', T2) })
  assert.deepEqual(result.nextManifest.tombstones, {})
})

test('first sync conservatively preserves a same-metadata same-id loser because blobs are unavailable', () => {
  const same = meta('a', T2)
  const result = planFor(
    localState({ a: same }),
    manifest({ a: same }, [], {}, 'z-remote'),
    null,
    { machineId: 'a-local' }
  )
  assert.deepEqual(result.pullDocs, ['a'])
  assert.deepEqual(result.conflicts, [{ id: 'a', winner: 'remote', loserCopyFrom: 'local' }])
})

test('an unchanged synchronized document produces no blob transfer', () => {
  const common = { a: meta('a', T1) }
  const result = planFor(localState(common), manifest(common, [], {}, 'base-machine'), syncedBase(common))
  assert.deepEqual(result.pushDocs, [])
  assert.deepEqual(result.pullDocs, [])
  assert.deepEqual(result.conflicts, [])
})

test('a one-sided local edit is pushed', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T2) }),
    manifest(baseDocs),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.pushDocs, ['a'])
  assert.deepEqual(result.pullDocs, [])
  assert.equal(result.nextManifest.docs.a.updatedAt, T2)
})

test('timestamp inequality detects a local edit even when the clock moved backward', () => {
  const baseDocs = { a: meta('a', T2) }
  const rolledBack = '2025-12-31T23:00:00.000Z'
  const result = planFor(
    localState({ a: meta('a', rolledBack) }),
    manifest(baseDocs),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.pushDocs, ['a'])
  assert.equal(result.nextManifest.docs.a.updatedAt, rolledBack)
})

test('a one-sided remote edit is pulled', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState(baseDocs),
    manifest({ a: meta('a', T2) }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.pushDocs, [])
  assert.deepEqual(result.pullDocs, ['a'])
  assert.equal(result.nextManifest.docs.a.updatedAt, T2)
})

test('simultaneous edits keep the newer local document and preserve the remote loser', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T4) }),
    manifest({ a: meta('a', T3) }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.pushDocs, ['a'])
  assert.deepEqual(result.pullDocs, [])
  assert.deepEqual(result.conflicts, [{ id: 'a', winner: 'local', loserCopyFrom: 'remote' }])
})

test('simultaneous edits keep the newer remote document and preserve the local loser', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T3) }),
    manifest({ a: meta('a', T4) }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.pushDocs, [])
  assert.deepEqual(result.pullDocs, ['a'])
  assert.deepEqual(result.conflicts, [{ id: 'a', winner: 'remote', loserCopyFrom: 'local' }])
})

test('equal-time simultaneous edits use lastWriter and machineId as a stable tie break', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T3) }),
    manifest({ a: meta('a', T3) }, [], {}, 'z-remote'),
    syncedBase(baseDocs),
    { machineId: 'a-local' }
  )
  assert.deepEqual(result.pullDocs, ['a'])
  assert.deepEqual(result.conflicts, [{ id: 'a', winner: 'remote', loserCopyFrom: 'local' }])
})

test('a remote-only trash transition is applied locally', () => {
  const baseDocs = { a: meta('a', T1) }
  const remote = meta('a', T1, { state: 'trashed', deletedAt: T3 })
  const result = planFor(localState(baseDocs), manifest({ a: remote }), syncedBase(baseDocs))
  assert.deepEqual(result.trashSet, [{ id: 'a', deletedAt: T3 }])
  assert.equal(result.nextManifest.docs.a.state, 'trashed')
})

test('a local-only trash transition is propagated to the manifest', () => {
  const baseDocs = { a: meta('a', T1) }
  const localTrash = meta('a', T1, { state: 'trashed', deletedAt: T3 })
  const result = planFor(localState({ a: localTrash }), manifest(baseDocs), syncedBase(baseDocs))
  assert.deepEqual(result.trashSet, [])
  assert.deepEqual(result.nextManifest.docs.a, localTrash)
})

test('a remote-only restore transition is applied locally even with an old updatedAt', () => {
  const trashed = meta('a', T1, { state: 'trashed', deletedAt: T4 })
  const result = planFor(
    localState({ a: trashed }),
    manifest({ a: meta('a', T1) }),
    syncedBase({ a: trashed })
  )
  assert.deepEqual(result.trashRestore, ['a'])
  assert.equal(result.nextManifest.docs.a.state, 'active')
})

test('a local-only restore transition is propagated to the manifest', () => {
  const trashed = meta('a', T1, { state: 'trashed', deletedAt: T4 })
  const result = planFor(
    localState({ a: meta('a', T1) }),
    manifest({ a: trashed }),
    syncedBase({ a: trashed })
  )
  assert.deepEqual(result.trashRestore, [])
  assert.equal(result.nextManifest.docs.a.state, 'active')
})

test('a newer active edit beats a concurrent remote trash transition', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T4) }),
    manifest({ a: meta('a', T1, { state: 'trashed', deletedAt: T3 }) }),
    syncedBase(baseDocs)
  )
  assert.equal(result.nextManifest.docs.a.state, 'active')
  assert.deepEqual(result.trashSet, [])
  assert.deepEqual(result.pushDocs, ['a'])
})

test('a newer trash transition beats a concurrent local edit without dropping its blob', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T4) }),
    manifest({ a: meta('a', T1, { state: 'trashed', deletedAt: T5 }) }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.trashSet, [{ id: 'a', deletedAt: T5 }])
  assert.deepEqual(result.pushDocs, ['a'])
  assert.equal(result.nextManifest.docs.a.updatedAt, T4)
  assert.equal(result.nextManifest.docs.a.state, 'trashed')
})

test('a remote favorite addition is added locally', () => {
  const docs = { a: meta('a', T1) }
  const result = planFor(localState(docs), manifest(docs, ['a']), syncedBase(docs))
  assert.deepEqual(result.favoriteAdds, ['a'])
  assert.deepEqual(result.nextManifest.favorites, ['a'])
})

test('a local favorite removal propagates through a three-way delta', () => {
  const docs = { a: meta('a', T1) }
  const base = syncedBase(docs, ['a'])
  const result = planFor(localState(docs), manifest(docs, ['a']), base)
  assert.deepEqual(result.favoriteRemoves, [])
  assert.deepEqual(result.nextManifest.favorites, [])
})

test('independent favorite additions and removals merge without losing either delta', () => {
  const docs = { a: meta('a'), b: meta('b'), c: meta('c') }
  const base = syncedBase(docs, ['a'])
  const result = planFor(
    localState(docs, ['b']),
    manifest(docs, ['a', 'c']),
    base
  )
  assert.deepEqual(result.favoriteAdds, ['c'])
  assert.deepEqual(result.favoriteRemoves, [])
  assert.deepEqual(result.nextManifest.favorites, ['b', 'c'])
})

test('a remote tombstone purges an unchanged local document', () => {
  const docs = { a: meta('a', T1) }
  const result = planFor(
    localState(docs, ['a']),
    manifest({}, [], { a: T3 }),
    syncedBase(docs, ['a'])
  )
  assert.deepEqual(result.purgeLocal, ['a'])
  assert.deepEqual(result.resurrect, [])
  assert.deepEqual(result.nextManifest.docs, {})
  assert.deepEqual(result.nextManifest.favorites, [])
  assert.deepEqual(result.nextPerDoc, {})
})

test('a local edit newer than a remote tombstone is resurrected as a conflict copy', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState({ a: meta('a', T4) }),
    manifest({}, [], { a: T3 }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.purgeLocal, [])
  assert.deepEqual(result.resurrect, [{ id: 'a' }])
  assert.deepEqual(result.pushDocs, [])
  assert.deepEqual(result.nextManifest.docs, {})
  assert.deepEqual(result.nextManifest.tombstones, { a: T3 })
})

test('an edit changed under clock rollback but older than the tombstone is purged', () => {
  const baseDocs = { a: meta('a', T2) }
  const rolledBack = '2025-12-31T23:00:00.000Z'
  const result = planFor(
    localState({ a: meta('a', rolledBack) }),
    manifest({}, [], { a: T3 }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.resurrect, [])
  assert.deepEqual(result.purgeLocal, ['a'])
})

test('a third machine with a stale base honors a tombstone without peer connectivity', () => {
  const staleDocs = { a: meta('a', T1) }
  const result = planFor(
    localState(staleDocs),
    manifest({}, [], { a: T5 }, 'machine-a'),
    syncedBase(staleDocs),
    { machineId: 'machine-c' }
  )
  assert.deepEqual(result.purgeLocal, ['a'])
  assert.deepEqual(result.nextManifest.tombstones, { a: T5 })
})

test('a local permanent deletion emits a durable tombstone', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(localState(), manifest(baseDocs), syncedBase(baseDocs))
  assert.deepEqual(result.pullDocs, [])
  assert.deepEqual(result.nextManifest.docs, {})
  assert.deepEqual(result.nextManifest.tombstones, { a: T5 })
})

test('a concurrent remote edit survives an inferred local tombstone as a conflict copy', () => {
  const baseDocs = { a: meta('a', T1) }
  const result = planFor(
    localState(),
    manifest({ a: meta('a', T3) }),
    syncedBase(baseDocs)
  )
  assert.deepEqual(result.pullDocs, ['a'])
  assert.deepEqual(result.resurrect, [{ id: 'a' }])
  assert.deepEqual(result.nextManifest.docs, {})
  assert.deepEqual(result.nextManifest.tombstones, { a: T5 })
})

test('a tombstone removed by the remote side stays removed through three-way delta merge', () => {
  const result = planFor(localState(), manifest(), syncedBase({}, [], { gone: T2 }))
  assert.deepEqual(result.nextManifest.tombstones, {})
})

test('an initial-sync resurrection survives the next two machines and never purges its unique copy', () => {
  const unique = meta('x', T1, { title: '唯一副本' })
  const localC = localState({ x: unique })

  const cRound1 = planFor(
    localC,
    manifest({}, [], { x: T3 }, 'machine-a'),
    null,
    { machineId: 'machine-c' }
  )
  assert.deepEqual(cRound1.pushDocs, ['x'])
  assert.deepEqual(cRound1.nextManifest.tombstones, {})

  const aRound2 = planFor(
    localState(),
    cRound1.nextManifest,
    syncedBase({}, [], { x: T3 }),
    { machineId: 'machine-a' }
  )
  assert.deepEqual(aRound2.pullDocs, ['x'])
  assert.deepEqual(aRound2.nextManifest.docs, { x: unique })
  assert.deepEqual(aRound2.nextManifest.tombstones, {})

  const cRound3 = planFor(
    localC,
    aRound2.nextManifest,
    { manifest: cRound1.nextManifest, perDoc: cRound1.nextPerDoc },
    { machineId: 'machine-c' }
  )
  assert.deepEqual(cRound3.purgeLocal, [])
  assert.deepEqual(cRound3.nextManifest.docs, { x: unique })
})

test('a local document newer than purgedAt is preserved even when updatedAt equals its base stamp', () => {
  const newer = meta('x', T4)
  const result = planFor(
    localState({ x: newer }),
    manifest({}, [], { x: T3 }, 'machine-a'),
    syncedBase({ x: newer }),
    { machineId: 'machine-c' }
  )
  assert.deepEqual(result.purgeLocal, [])
  assert.deepEqual(result.resurrect, [{ id: 'x' }])
})

test('corrupt document keys are quarantined and cannot emit phantom tombstones', () => {
  const healthy = blob('y', T1)
  const local = buildLocalState({
    'mindflow.docs.index': '{broken',
    'mindflow.doc.x': '{also-broken',
    'mindflow.doc.y': healthy
  })
  assert.deepEqual(local.quarantinedIds, ['x'])

  const baseDocs = { x: meta('x', T1), y: meta('y', T1) }
  const result = planFor(local, manifest(baseDocs), syncedBase(baseDocs))
  assert.equal(Object.hasOwn(result.nextManifest.tombstones, 'x'), false)
  assert.deepEqual(result.quarantinedIds, ['x'])
  assert.deepEqual(result.pushDocs, [])
})

test('an index row with no document blob is repaired without aborting the whole sync', () => {
  const goodBlob = blob('good', T1)
  const local = buildLocalState({
    'mindflow.docs.index': JSON.stringify({
      version: 2,
      docs: [
        { id: 'missing', title: '殘留列', createdAt: T0, updatedAt: T1 },
        { id: 'good', title: '文件 good', createdAt: T0, updatedAt: T1 }
      ],
      trash: [],
      favorites: []
    }),
    'mindflow.doc.good': goodBlob
  })
  assert.deepEqual(Object.keys(local.docs), ['good'])

  const result = planFor(local, manifest())
  assert.deepEqual(result.pushDocs, ['good'])
  assert.equal(Object.hasOwn(result.nextManifest.docs, 'missing'), false)
  const writes = computeLocalWrites({ plan: result, pulledBlobs: {}, localState: local })
  assert.deepEqual(JSON.parse(writes.setKeys['mindflow.docs.index']).docs.map(row => row.id), ['good'])
})

test('a rebuilt index cannot export lost favorites or revive trashed documents', () => {
  const local = buildLocalState({
    'mindflow.docs.index': 'not-json',
    'mindflow.doc.x': blob('x', T1),
    'mindflow.doc.t': blob('t', T1)
  })
  assert.equal(local.rebuilt, true)

  const trashed = meta('t', T1, { state: 'trashed', deletedAt: T2 })
  const baseDocs = { x: meta('x', T1), t: trashed }
  const result = planFor(local, manifest(baseDocs, ['x']), syncedBase(baseDocs, ['x']))
  assert.deepEqual(result.nextManifest.favorites, ['x'])
  assert.equal(result.nextManifest.docs.t.state, 'trashed')
  assert.deepEqual(result.trashSet, [{ id: 't', deletedAt: T2 }])
})

test('the equal-millisecond losing machine pulls the stable winner on its follow-up round', () => {
  const baseDocs = { x: meta('x', T1, { title: 'V0' }) }
  const sharedBase = syncedBase(baseDocs)
  const localA = localState({ x: meta('x', T2, { title: 'V1-A' }) }, [], {
    x: blob('x', T2, { title: 'V1-A' })
  })
  const localB = localState({ x: meta('x', T2, { title: 'V2-B' }) }, [], {
    x: blob('x', T2, { title: 'V2-B' })
  })

  const aRound1 = planFor(localA, manifest(baseDocs, [], {}, 'machine-a'), sharedBase, { machineId: 'machine-a' })
  const bRound2 = planFor(localB, aRound1.nextManifest, sharedBase, { machineId: 'machine-b' })
  assert.equal(bRound2.nextManifest.docs.x.title, 'V2-B')

  const aRound3 = planFor(
    localA,
    bRound2.nextManifest,
    { manifest: aRound1.nextManifest, perDoc: aRound1.nextPerDoc },
    { machineId: 'machine-a' }
  )
  assert.deepEqual(aRound3.pullDocs, ['x'])
  const writes = computeLocalWrites({
    plan: aRound3,
    pulledBlobs: { x: localB.docBlobs.x },
    localState: localA
  })
  assert.equal(JSON.parse(writes.setKeys['mindflow.doc.x']).title, 'V2-B')
})

test('ensureRepo rejects a repository created under the wrong owner', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    if (requestCount === 1) return new Response('{}', { status: 404 })
    return Response.json({ full_name: 'token-user/mindmaps', private: true, permissions: { push: true } })
  }

  await assert.rejects(
    ensureRepo({ token: 'secret', repo: 'some-org/mindmaps', branch: 'main' }),
    /some-org\/mindmaps|owner|擁有者|PAT/u
  )
})

test('ensureRepo auto-initializes a new repo and wraps hidden existing repos with PAT guidance', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requestBodies = []
  let mode = 'create'
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method || 'GET') === 'GET') return new Response('{}', { status: 404 })
    requestBodies.push(JSON.parse(init.body))
    if (mode === 'hidden') return Response.json({ message: 'name already exists on this account' }, { status: 422 })
    return Response.json({
      full_name: 'owner/mindmaps',
      private: true,
      permissions: { push: true }
    })
  }

  await ensureRepo({ token: 'secret', repo: 'owner/mindmaps', branch: 'sync-main' })
  assert.deepEqual(requestBodies[0], {
    name: 'mindmaps',
    private: true,
    auto_init: true,
    default_branch: 'sync-main'
  })

  mode = 'hidden'
  await assert.rejects(
    ensureRepo({ token: 'secret', repo: 'owner/mindmaps', branch: 'main' }),
    /PAT|fine-grained|授權/u
  )
})

test('getRef explains how to recover an already-existing empty repository', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => Response.json({ message: 'Git Repository is empty.' }, { status: 409 })
  await assert.rejects(
    getRef({ token: 'secret', repo: 'owner/mindmaps', branch: 'main' }),
    /建立第一個 commit|加入初始 commit|刪除.*重新建立/ui
  )
})

test('a corrupt settings file is preserved and surfaced instead of silently disabling sync', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'mindflow-sync-settings-'))
  try {
    const path = join(userDataPath, 'sync-settings.json')
    writeFileSync(path, '{"enabled":true,', 'utf8')
    const first = loadSyncSettings(userDataPath)
    assert.equal(first.enabled, false)
    assert.match(first.warning, /損壞|corrupt|設定/ui)
    assert.equal(readdirSync(userDataPath).some(name => name.startsWith('sync-settings.json.corrupt')), true)
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('sync-applied reload guard commits active edits and rechecks the delayed reload window', () => {
  assert.equal(typeof syncSettingsUi.protectSyncAppliedReload, 'function')
  let dirty = false
  let conflicts = 0
  const edit = {
    session: null,
    commit() {
      dirty = true
      this.session = null
    }
  }
  const options = {
    edit,
    isDirty: () => dirty,
    onConflict: () => { conflicts += 1 }
  }

  assert.equal(syncSettingsUi.protectSyncAppliedReload(options), false)
  edit.session = { finishing: false }
  assert.equal(syncSettingsUi.protectSyncAppliedReload(options), true)
  assert.equal(dirty, true)
  assert.equal(conflicts, 1)
})

test('idle sync status has a non-blocking warning channel for public repositories', () => {
  const result = syncSettingsUi.describeSyncStatus({
    state: 'idle',
    docCount: 2,
    warning: 'GitHub repo 是 public，心智圖內容可能公開。'
  })
  assert.equal(result.state, 'idle')
  assert.equal(result.tone, 'warning')
  assert.match(result.detail, /public|公開/u)
})

test('buildConflictCopy creates a renamed document with fresh timestamps', () => {
  const now = '2026-08-30T12:34:00'
  const result = buildConflictCopy(blob('a', T1, { title: '策略圖' }), '辦公室電腦', now)
  const parsed = JSON.parse(result.json)
  assert.notEqual(result.id, 'a')
  assert.match(result.id, /^conflict-/)
  assert.equal(result.title, '策略圖（衝突副本・辦公室電腦 08-30 12:34）')
  assert.equal(parsed.id, result.id)
  assert.equal(parsed.title, result.title)
  assert.equal(parsed.createdAt, new Date(now).toISOString())
  assert.equal(parsed.updatedAt, new Date(now).toISOString())
})

test('buildConflictCopy is retry-stable for identical pure inputs', () => {
  const source = blob('a', T1)
  const first = buildConflictCopy(source, 'A', T5)
  const second = buildConflictCopy(source, 'A', T5)
  assert.deepEqual(first, second)
})

test('buildConflictCopy rejects malformed document JSON', () => {
  assert.throws(() => buildConflictCopy('{broken', 'A', T5), /JSON|文件/)
})

test('computeLocalWrites writes pulled blobs before an index with blob thumbnails', () => {
  const localBlob = blob('a', T1, { thumbnail: '<svg>local-thumb</svg>' })
  const remoteBlob = blob('b', T2, { title: '遠端 B', thumbnail: '<svg>remote-thumb</svg>' })
  const nextManifest = manifest({ a: meta('a', T1), b: meta('b', T2, { title: '遠端 B' }) }, ['b'])
  const writes = computeLocalWrites({
    plan: {
      pullDocs: ['b'],
      purgeLocal: [],
      nextManifest
    },
    pulledBlobs: { b: remoteBlob },
    localState: localState({ a: meta('a', T1) }, [], { a: localBlob })
  })

  assert.deepEqual(Object.keys(writes.setKeys), ['mindflow.doc.b', 'mindflow.docs.index'])
  assert.equal(writes.setKeys['mindflow.doc.b'], remoteBlob)
  const index = JSON.parse(writes.setKeys['mindflow.docs.index'])
  assert.deepEqual(index.favorites, ['b'])
  assert.equal(index.docs.find(item => item.id === 'a').thumbnail, '<svg>local-thumb</svg>')
  assert.equal(index.docs.find(item => item.id === 'b').thumbnail, '<svg>remote-thumb</svg>')
  assert.deepEqual(index.trash, [])
})

test('computeLocalWrites thoroughly removes purged document, history, and shadow-state keys', () => {
  const writes = computeLocalWrites({
    plan: {
      pullDocs: [],
      purgeLocal: ['a'],
      nextManifest: manifest()
    },
    pulledBlobs: {},
    localState: localState({ a: meta('a') }, ['a'])
  })
  assert.deepEqual(writes.removeKeys, [
    'mindflow.doc.a',
    'mindflow.history.a',
    'mindflow.gamma.a',
    'mindflow.viewmode.a'
  ])
  assert.deepEqual(JSON.parse(writes.setKeys['mindflow.docs.index']), {
    version: 2,
    docs: [],
    trash: [],
    favorites: []
  })
})

test('computeLocalWrites mirrors trash state and strips deletedAt from active index rows', () => {
  const a = meta('a', T1, { state: 'trashed', deletedAt: T3 })
  const b = meta('b', T2)
  const writes = computeLocalWrites({
    plan: { pullDocs: [], purgeLocal: [], nextManifest: manifest({ a, b }) },
    pulledBlobs: {},
    localState: localState({ a, b })
  })
  const index = JSON.parse(writes.setKeys['mindflow.docs.index'])
  assert.equal(index.docs[0].id, 'b')
  assert.equal('deletedAt' in index.docs[0], false)
  assert.deepEqual(index.trash.map(item => ({ id: item.id, deletedAt: item.deletedAt })), [{ id: 'a', deletedAt: T3 }])
})

test('computeLocalWrites fails closed when a required pulled blob is missing', () => {
  assert.throws(() => computeLocalWrites({
    plan: { pullDocs: ['b'], purgeLocal: [], nextManifest: manifest({ b: meta('b') }) },
    pulledBlobs: {},
    localState: localState()
  }), /pulled blob|遠端文件/i)
})
