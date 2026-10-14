/**
 * M2a 同步引擎 v2 的純模組：HLC、KV、圖片資產、雲端文件編解碼。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_DRIFT_MS, compareHlc, createHlcClock, formatHlc, isHlc, maxHlc, parseHlc } from '../js/sync/hlc.mjs'
import { createMemoryKv } from '../js/sync/kv.mjs'
import { assetRef, extractAssetsInPlace, isAssetRef, restoreAssetsInPlace, sha256Hex } from '../js/sync/assets.mjs'
import { CloudSchemaError, cloudDocAssets, decodeCloudDoc, encodeCloudDoc } from '../js/sync/doc-codec.mjs'

test('HLC is strictly increasing even when the wall clock stalls or goes backwards', () => {
  let wall = 1_000
  const clock = createHlcClock({ node: 'phone', wallClock: () => wall })
  const a = clock.now()
  const b = clock.now()
  wall = 500
  const c = clock.now()
  wall = 2_000
  const d = clock.now()
  assert.ok(compareHlc(a, b) < 0 && compareHlc(b, c) < 0 && compareHlc(c, d) < 0, [a, b, c, d].join(' '))
  assert.equal(parseHlc(c).wall, 1_000, '時間倒退時沿用最大的時間，只加計數')
  assert.equal(parseHlc(d).counter, 0)
})

test('HLC orders a phone edit after a desktop edit it has seen, even if the phone clock is behind', () => {
  const desktop = createHlcClock({ node: 'desktop', wallClock: () => 10_000 })
  const phone = createHlcClock({ node: 'phone', wallClock: () => 4_000 })
  const desktopStamp = desktop.now()
  phone.receive(desktopStamp)
  const phoneStamp = phone.now()
  assert.equal(compareHlc(desktopStamp, phoneStamp), -1, '看過對方的修改之後才改的，一定排在後面')
})

test('HLC ignores absurd future stamps and survives restarts from the saved value', () => {
  const clock = createHlcClock({ node: 'phone', wallClock: () => 1_000 })
  const before = clock.current()
  assert.equal(clock.receive(formatHlc({ wall: 1_000 + MAX_DRIFT_MS + 1, counter: 0, node: 'evil' })), before)
  const saved = clock.now()
  const restarted = createHlcClock({ node: 'phone', last: saved, wallClock: () => 1 })
  assert.equal(compareHlc(saved, restarted.now()), -1)
  assert.throws(() => createHlcClock({ node: 'bad node!' }), TypeError)
})

test('HLC helpers', () => {
  const value = formatHlc({ wall: 1760400000000, counter: 10, node: 'android-1' })
  assert.equal(value, '1760400000000-000a-android-1')
  assert.equal(isHlc(value), true)
  assert.equal(isHlc('nope'), false)
  assert.equal(maxHlc('1-x', value, null), value)
  assert.equal(compareHlc(null, value), -1)
  const sameWall = createHlcClock({ node: 'a', wallClock: () => 5 })
  for (let i = 0; i < 0x10001; i += 1) sameWall.now()
  assert.equal(parseHlc(sameWall.current()).wall, 6, '同一毫秒計數用完會借下一毫秒')
})

test('memory KV clones values and lists keys by prefix', async () => {
  const kv = createMemoryKv()
  const value = { a: [1] }
  await kv.set('asset:1', value)
  value.a.push(2)
  assert.deepEqual(await kv.get('asset:1'), { a: [1] })
  await kv.set('state', 1)
  assert.deepEqual(await kv.keys('asset:'), ['asset:1'])
  await kv.delete('asset:1')
  assert.equal(await kv.get('asset:1'), undefined)
})

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SVG_STICKER = 'assets/stickers/emoji/smile.svg'

function sampleLocalRaw() {
  return JSON.stringify({
    id: 'doc_1',
    title: '有圖片的文件',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    root: {
      id: 'n_root', text: '中心', children: [
        { id: 'n_a', text: 'A', children: [], image: { src: PNG, w: 1, h: 1 } },
        { id: 'n_b', text: 'B', children: [{ id: 'n_c', text: 'C', children: [], image: { src: PNG, w: 2, h: 2 } }] },
        { id: 'n_d', text: 'D', children: [], image: { src: SVG_STICKER, w: 24, h: 24 } }
      ]
    },
    layout: 'mindmap-both'
  })
}

test('sha256Hex matches the known digest', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('assets: data URIs become one shared reference, stickers are untouched, restore is exact', async () => {
  const doc = JSON.parse(sampleLocalRaw())
  const assets = await extractAssetsInPlace(doc)
  const sha = await sha256Hex(PNG)
  assert.deepEqual(Object.keys(assets), [sha], '同一張圖只存一份')
  assert.equal(doc.root.children[0].image.src, assetRef(sha))
  assert.equal(doc.root.children[1].children[0].image.src, assetRef(sha))
  assert.equal(doc.root.children[2].image.src, SVG_STICKER)
  assert.equal(isAssetRef(doc.root.children[0].image.src), true)
  assert.deepEqual(restoreAssetsInPlace(doc, key => assets[key]), [])
  assert.equal(JSON.stringify(doc), sampleLocalRaw())
})

test('cloud doc codec round-trips byte-for-byte and carries schemaVersion 2 + HLC', async () => {
  const local = sampleLocalRaw()
  const hlc = '1760400000000-0001-desktop'
  const encoded = await encodeCloudDoc(local, { id: 'doc_1', hlc })
  const cloud = JSON.parse(encoded.raw)
  assert.equal(cloud.schemaVersion, 2)
  assert.equal(cloud.hlc, hlc)
  assert.equal(encoded.raw.includes('data:image'), false, '雲端文件不含圖片本體')
  assert.equal(Object.keys(encoded.assets).length, 1)
  assert.deepEqual(cloudDocAssets(encoded.raw, 'doc_1'), Object.keys(encoded.assets))

  const decoded = decodeCloudDoc(encoded.raw, { id: 'doc_1', getAsset: sha => encoded.assets[sha] })
  assert.equal(decoded.raw, local, '往返後逐字相同')
  assert.equal(decoded.hlc, hlc)
  assert.equal(decoded.schemaVersion, 2)
  assert.deepEqual(decoded.missingAssets, [])

  const missing = decodeCloudDoc(encoded.raw, { id: 'doc_1' })
  assert.equal(missing.missingAssets.length, 1, '缺資產時回報，呼叫端不能把參照寫進本機')
})

test('cloud doc codec reads v1 documents and refuses newer schemas', async () => {
  const legacy = sampleLocalRaw()
  const decoded = decodeCloudDoc(legacy, { id: 'doc_1' })
  assert.equal(decoded.schemaVersion, 1)
  assert.equal(decoded.hlc, null)
  assert.equal(decoded.raw, legacy)
  const future = JSON.stringify({ ...JSON.parse(legacy), schemaVersion: 3 })
  assert.throws(() => decodeCloudDoc(future, { id: 'doc_1' }), error => error instanceof CloudSchemaError && error.code === 'SCHEMA_TOO_NEW')
  assert.throws(() => decodeCloudDoc(legacy, { id: 'other' }), /mismatch/)
  await assert.rejects(encodeCloudDoc(legacy, { id: 'doc_1', hlc: 'bad' }), TypeError)
})
