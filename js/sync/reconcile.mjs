/**
 * 同步引擎 v2 的一輪比對：讀雲端快照 → 與 base、本機三方比對 → 算出本機要寫什麼、雲端要寫什麼 → 推送。
 * 不直接寫本機：回傳 writes（附 CAS 期望值），由引擎在儲存佇列裡套用。
 * 電腦與手機共用；傳輸由呼叫端注入（GitHubTransport，M3 起也有 FirebaseTransport）。
 */
import {
  SyncLocalChangedError,
  assertSupportedManifest,
  buildConflictCopy,
  buildLocalState,
  computeLocalWrites,
  computeSyncPlan,
  emptyManifest,
  writeExpectations
} from '../sync-plan.mjs'
import { CLOUD_DOC_SCHEMA_VERSION, cloudDocAssets, decodeCloudDoc, encodeCloudDoc } from './doc-codec.mjs'

export const MANIFEST_PATH = 'manifest.json'
const INDEX_KEY = 'mindflow.docs.index'
const DOC_KEY_PREFIX = 'mindflow.doc.'

export function documentPath(id) {
  return `docs/${encodeURIComponent(id)}.json`
}

export function assetPath(sha) {
  return `assets/${sha}.txt`
}

function idFromDocumentPath(path) {
  const match = /^docs\/(.+)\.json$/u.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

function stableJson(value) {
  return JSON.stringify(canonical(value))
}

export class RemoteManifestError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RemoteManifestError'
  }
}

/**
 * @param {object} input
 * @param {object} input.transport      getHead/getTree/readBlob/writeCommit
 * @param {Record<string,string>} input.entries  本機 mindflow.* 快照
 * @param {object} input.state          { lastSyncedCommitSha, baseManifest, perDoc, pending }
 * @param {string} input.machineId
 * @param {object} input.clock          HLC：now()/receive()
 * @param {object} input.assetCache     get(sha)/set(sha, dataUri)（async）
 * @param {Date} input.syncNow
 * @param {Map<string,string>} [input.pushedThisRun]  本輪稍早推上去的本機版本（id → 本機 JSON）
 * @param {(expected: Record<string,string|null>) => string[]} input.changedLocalKeys  推送前重讀本機：回傳與期望值不同的 key
 */
export async function reconcileOnce({
  transport,
  entries,
  state,
  machineId,
  clock,
  assetCache,
  syncNow,
  pushedThisRun = new Map(),
  changedLocalKeys,
  hash,
  label = 'MindFlow'
}) {
  const localState = buildLocalState(entries)
  const head = await transport.getHead()
  const tree = await transport.getTree(head.sha)
  const manifestEntry = tree.byPath[MANIFEST_PATH]
  let remoteManifest = emptyManifest()
  if (manifestEntry) {
    try {
      remoteManifest = JSON.parse(await transport.readBlob(manifestEntry.sha))
    } catch (error) {
      if (error?.name === 'TransportError') throw error
      throw new RemoteManifestError('雲端的 manifest.json 損壞，為避免誤刪資料已暫停同步。')
    }
  }
  // 版本閘門：v3 以上直接停止；v1 照常比對，推送時整份升級成 v2。
  assertSupportedManifest(remoteManifest)
  const remoteVersion = Number.isInteger(remoteManifest.schemaVersion) ? remoteManifest.schemaVersion : 1

  const base = state.lastSyncedCommitSha && state.baseManifest
    ? { manifest: state.baseManifest, perDoc: state.perDoc || {} }
    : null

  // 本機每個版本的 HLC：沒改過就沿用 base 的；改過就在第一次看到時蓋章。
  // pending 是引擎持有的同一個物件：這一輪失敗或重試時章仍保留，否則重算時時鐘已看過較新的遠端時間戳，
  // 較早的本機修改會被蓋成較新的章。
  if (!state.pending || typeof state.pending !== 'object') state.pending = {}
  const pending = state.pending
  for (const [id, meta] of Object.entries(localState.docs)) {
    const baseStamp = base?.perDoc?.[id]
    const baseMeta = base?.manifest?.docs?.[id]
    if (base && meta.updatedAt === baseStamp) {
      // 沒改過：沿用 base 的 HLC／writer（v1 base 沒有就留空，推送升級時才補蓋）。
      if (baseMeta?.hlc) meta.hlc = baseMeta.hlc
      if (baseMeta?.writer) meta.writer = baseMeta.writer
      delete pending[id]
      continue
    }
    // 以修改當下的時間（本機文件的 updatedAt，同一台裝置的時鐘）蓋章，而不是同步的時間；
    // 而且要在接收這一輪的遠端時間戳「之前」蓋，否則較早的離線修改會因為晚同步而勝出。
    if (pending[id]?.updatedAt !== meta.updatedAt) pending[id] = { updatedAt: meta.updatedAt, hlc: clock.stamp(Date.parse(meta.updatedAt)) }
    meta.hlc = pending[id].hlc
    meta.writer = machineId
  }
  for (const meta of Object.values(remoteManifest.docs || {})) clock.receive(meta?.hlc)

  const plan = computeSyncPlan({ local: localState, remoteManifest, base, machineId, now: syncNow })

  // 遠端文件一律先解碼成本機格式（換回圖片），之後的比對與寫入都只看本機格式。
  const pulledBlobs = {}
  const readRemoteDoc = async id => {
    if (Object.hasOwn(pulledBlobs, id)) return pulledBlobs[id]
    const remoteEntry = tree.byPath[documentPath(id)]
    if (!remoteEntry) throw new Error(`Remote document blob is missing: ${id}`)
    const cloudRaw = await transport.readBlob(remoteEntry.sha)
    const fetched = {}
    for (const sha of cloudDocAssets(cloudRaw, id)) {
      const cached = await assetCache.get(sha)
      if (typeof cached === 'string') {
        fetched[sha] = cached
        continue
      }
      const entry = tree.byPath[assetPath(sha)]
      if (!entry) throw new Error(`Remote asset is missing: ${sha} (document ${id})`)
      const dataUri = await transport.readBlob(entry.sha)
      await assetCache.set(sha, dataUri)
      fetched[sha] = dataUri
    }
    const decoded = decodeCloudDoc(cloudRaw, { id, getAsset: sha => fetched[sha] })
    if (decoded.missingAssets.length) throw new Error(`Remote assets could not be restored for ${id}`)
    pulledBlobs[id] = decoded.raw
    return decoded.raw
  }
  for (const id of plan.pullDocs) await readRemoteDoc(id)

  const augmentedLocal = {
    docs: { ...localState.docs },
    favorites: [...localState.favorites],
    docBlobs: { ...localState.docBlobs }
  }
  const conflictBlobs = {}
  const pushIds = new Set(plan.pushDocs)
  const purgeIds = new Set(plan.purgeLocal)
  const addConflictCopy = (raw, copyLabel) => {
    const copy = buildConflictCopy(raw, copyLabel, syncNow)
    const document = JSON.parse(copy.json)
    conflictBlobs[copy.id] = copy.json
    augmentedLocal.docBlobs[copy.id] = copy.json
    const meta = {
      title: copy.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      state: 'active',
      hlc: clock.now(),
      writer: machineId
    }
    augmentedLocal.docs[copy.id] = meta
    plan.nextManifest.docs[copy.id] = { ...meta }
    plan.nextPerDoc[copy.id] = document.updatedAt
    pushIds.add(copy.id)
  }

  for (const conflict of plan.conflicts) {
    const localRaw = localState.docBlobs[conflict.id]
    const remoteRaw = await readRemoteDoc(conflict.id)
    if (typeof localRaw === 'string' && localRaw === remoteRaw) {
      // 兩邊內容一字不差（例如上一輪推送成功但 base 沒存到）：不是衝突，不產生副本。
      pushIds.delete(conflict.id)
      plan.pullDocs = plan.pullDocs.filter(id => id !== conflict.id)
      continue
    }
    if (typeof localRaw === 'string' && pushedThisRun.get(conflict.id) === remoteRaw) {
      // 雲端那份是本輪稍早自己推的版本、本機之後又改了：本機直接蓋過，不算衝突。
      pushIds.add(conflict.id)
      plan.pullDocs = plan.pullDocs.filter(id => id !== conflict.id)
      delete pulledBlobs[conflict.id]
      plan.nextManifest.docs[conflict.id] = { ...plan.nextManifest.docs[conflict.id], ...localState.docs[conflict.id] }
      plan.nextPerDoc[conflict.id] = localState.docs[conflict.id].updatedAt
      continue
    }
    if (conflict.loserCopyFrom === 'local') {
      if (typeof localRaw !== 'string') throw new Error(`Local conflict document blob is missing: ${conflict.id}`)
      addConflictCopy(localRaw, label)
    } else {
      addConflictCopy(remoteRaw, remoteManifest.docs?.[conflict.id]?.writer || remoteManifest.lastWriter || '另一台裝置')
    }
  }
  for (const resurrection of plan.resurrect) {
    const localRaw = localState.docBlobs[resurrection.id]
    if (typeof localRaw === 'string') addConflictCopy(localRaw, label)
    else addConflictCopy(await readRemoteDoc(resurrection.id), remoteManifest.lastWriter || '另一台裝置')
    purgeIds.add(resurrection.id)
  }
  plan.purgeLocal = [...purgeIds].sort()

  const baseWrites = computeLocalWrites({ plan, pulledBlobs, localState: augmentedLocal })
  const setKeys = {}
  for (const [key, value] of Object.entries(baseWrites.setKeys)) {
    if (key !== INDEX_KEY) setKeys[key] = value
  }
  for (const [id, raw] of Object.entries(conflictBlobs)) setKeys[`${DOC_KEY_PREFIX}${id}`] = raw
  setKeys[INDEX_KEY] = baseWrites.setKeys[INDEX_KEY]
  const removeKeys = new Set(baseWrites.removeKeys)
  for (const id of purgeIds) {
    for (const key of Object.keys(entries)) {
      if (key !== INDEX_KEY && key.endsWith(`.${id}`)) removeKeys.add(key)
    }
  }
  const writes = { setKeys, removeKeys: [...removeKeys] }
  const localChanged = writes.removeKeys.some(key => Object.hasOwn(entries, key)) ||
    Object.entries(writes.setKeys).some(([key, value]) => entries[key] !== value)
  writes.expected = writeExpectations(entries, writes)

  // 套用後的本機內容（推送與 v1→v2 升級都以它為準）。
  const contentAfterMerge = id => {
    const key = `${DOC_KEY_PREFIX}${id}`
    if (Object.hasOwn(writes.setKeys, key)) return writes.setKeys[key]
    return augmentedLocal.docBlobs[id] ?? pulledBlobs[id] ?? entries[key]
  }
  // v1 雲端：第一次推送就把所有文件寫成 v2（補 HLC、圖片抽成資產）。
  if (remoteVersion < CLOUD_DOC_SCHEMA_VERSION) {
    for (const id of Object.keys(plan.nextManifest.docs)) pushIds.add(id)
  }
  plan.pushDocs = [...pushIds].sort()

  // 推上去的版本由本機寫入：HLC 與 writer 以本機為準；沒有 HLC 的（v1 升級）現在補蓋。
  for (const id of plan.pushDocs) {
    const meta = plan.nextManifest.docs[id]
    if (!meta) continue
    const localMeta = augmentedLocal.docs[id]
    const fromLocal = typeof localState.docBlobs[id] === 'string' && localMeta && localMeta.updatedAt === meta.updatedAt
    if (fromLocal && localMeta.hlc) {
      meta.hlc = localMeta.hlc
      meta.writer = localMeta.writer || machineId
    }
    if (!meta.hlc) meta.hlc = clock.now()
    if (!meta.writer) meta.writer = remoteManifest.docs?.[id]?.writer || machineId
  }
  plan.nextManifest.docs = canonical(plan.nextManifest.docs)
  plan.nextPerDoc = canonical(plan.nextPerDoc)
  plan.nextManifest.schemaVersion = CLOUD_DOC_SCHEMA_VERSION

  const pushedLocalIds = plan.pushDocs.filter(id => !Object.hasOwn(conflictBlobs, id) && typeof localState.docBlobs[id] === 'string')
  const prePushExpected = writeExpectations(entries, writes, pushedLocalIds.map(id => `${DOC_KEY_PREFIX}${id}`))

  const remoteDocPaths = Object.keys(tree.byPath).filter(path => idFromDocumentPath(path))
  const desiredDocPaths = new Set(Object.keys(plan.nextManifest.docs).map(documentPath))
  const deletedRemotePaths = remoteDocPaths.filter(path => !desiredDocPaths.has(path))
  // lastWriter 不算內容差異：只拉不推的一輪不能因為「最後寫入者是誰」就多推一次。
  const withoutWriter = manifest => ({ ...manifest, lastWriter: null })
  const needsPush = plan.pushDocs.length > 0 || deletedRemotePaths.length > 0 ||
    stableJson(withoutWriter(remoteManifest)) !== stableJson(withoutWriter(plan.nextManifest))

  let commitSha = head.sha
  const pushedDocs = {}
  let uploadedAssets = 0
  if (needsPush) {
    // 還沒對雲端寫任何東西：本機在同步期間又存檔就作廢重跑。
    const changedKeys = changedLocalKeys(prePushExpected)
    if (changedKeys.length) throw new SyncLocalChangedError(changedKeys)

    const files = []
    const assetsToUpload = {}
    for (const id of plan.pushDocs) {
      const raw = contentAfterMerge(id)
      if (typeof raw !== 'string') throw new Error(`Local document blob is missing: ${id}`)
      const encoded = await encodeCloudDoc(raw, { id, hlc: plan.nextManifest.docs[id].hlc, hash })
      files.push({ path: documentPath(id), content: encoded.raw })
      for (const [sha, dataUri] of Object.entries(encoded.assets)) {
        await assetCache.set(sha, dataUri)
        if (!tree.byPath[assetPath(sha)]) assetsToUpload[sha] = dataUri
      }
    }
    for (const [sha, dataUri] of Object.entries(assetsToUpload).sort(([a], [b]) => a.localeCompare(b))) {
      files.push({ path: assetPath(sha), content: dataUri })
      uploadedAssets += 1
    }
    for (const path of deletedRemotePaths) files.push({ path, content: null })
    files.push({ path: MANIFEST_PATH, content: JSON.stringify(plan.nextManifest) })
    commitSha = await transport.writeCommit({
      parentSha: head.sha,
      baseTreeSha: tree.treeSha,
      files,
      message: `${label} sync ${syncNow.toISOString()}`
    })
    for (const id of pushedLocalIds) pushedDocs[id] = localState.docBlobs[id]
  }

  // 已同步的版本不再需要暫存的 HLC 章。
  for (const id of Object.keys(pending)) {
    if (!localState.docs[id] || plan.nextPerDoc[id] === pending[id].updatedAt || purgeIds.has(id)) delete pending[id]
  }

  return {
    entries,
    localChanged,
    writes,
    pushedDocs,
    pushed: needsPush,
    uploadedAssets,
    remoteVersion,
    nextState: {
      lastSyncedCommitSha: commitSha,
      baseManifest: needsPush
        ? plan.nextManifest
        : { ...plan.nextManifest, lastWriter: remoteManifest.lastWriter ?? null },
      perDoc: plan.nextPerDoc,
      pending,
      etag: head.etag,
      lastSyncAt: syncNow.toISOString()
    },
    quarantinedIds: plan.quarantinedIds
  }
}
