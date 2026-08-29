export const MANIFEST_SCHEMA_VERSION = 1

const INDEX_KEY = 'mindflow.docs.index'
const DOC_PREFIX = 'mindflow.doc.'
const HISTORY_PREFIX = 'mindflow.history.'
const GAMMA_PREFIX = 'mindflow.gamma.'
const VIEW_MODE_PREFIX = 'mindflow.viewmode.'
const EPOCH = new Date(0).toISOString()

export function emptyManifest() {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    docs: {},
    favorites: [],
    tombstones: {},
    lastWriter: null
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizeTitle(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '未命名心智圖'
}

function localMeta(source, fallback, state) {
  const meta = isObject(source) ? source : {}
  const document = isObject(fallback) ? fallback : {}
  const normalized = {
    title: normalizeTitle(meta.title ?? document.title),
    createdAt: validDate(meta.createdAt) ? meta.createdAt : validDate(document.createdAt) ? document.createdAt : EPOCH,
    updatedAt: validDate(meta.updatedAt) ? meta.updatedAt : validDate(document.updatedAt) ? document.updatedAt : EPOCH,
    state
  }
  if (state === 'trashed') {
    normalized.deletedAt = validDate(meta.deletedAt) ? meta.deletedAt : normalized.updatedAt
  }
  return normalized
}

export function buildLocalState(entries) {
  const sourceEntries = isObject(entries) ? entries : {}
  const docBlobs = {}
  const parsedBlobs = {}
  const quarantinedIds = new Set()

  for (const [key, value] of Object.entries(sourceEntries).sort(([left], [right]) => left.localeCompare(right))) {
    if (!key.startsWith(DOC_PREFIX) || key.startsWith(HISTORY_PREFIX)) continue
    const id = key.slice(DOC_PREFIX.length)
    if (!id) continue
    if (typeof value !== 'string') {
      quarantinedIds.add(id)
      continue
    }
    const document = parseJson(value)
    // key 與 blob id 不一致代表資料已交叉污染；寧可隔離，也不能把內容同步到錯的文件。
    if (!isObject(document) || document.id !== id) {
      quarantinedIds.add(id)
      continue
    }
    docBlobs[id] = value
    parsedBlobs[id] = document
  }

  const rawIndex = sourceEntries[INDEX_KEY]
  const parsedIndex = typeof rawIndex === 'string' ? parseJson(rawIndex) : null
  const indexReadable = Array.isArray(parsedIndex) || isObject(parsedIndex)
  const docs = {}

  if (!indexReadable) {
    // 索引不存在或損壞時，blob 是唯一仍可信的來源；回收筒與收藏無法推回，只能安全復原為 active。
    for (const id of Object.keys(parsedBlobs).sort()) {
      docs[id] = localMeta(parsedBlobs[id], null, 'active')
    }
    const result = { docs, favorites: [], docBlobs, rebuilt: true }
    if (quarantinedIds.size) result.quarantinedIds = [...quarantinedIds].sort()
    return result
  }

  const activeRows = Array.isArray(parsedIndex)
    ? parsedIndex
    : Array.isArray(parsedIndex.docs) ? parsedIndex.docs : []
  const trashRows = !Array.isArray(parsedIndex) && Array.isArray(parsedIndex.trash)
    ? parsedIndex.trash
    : []

  for (const row of activeRows) {
    if (!isObject(row) || typeof row.id !== 'string' || !row.id) continue
    // index 先於 blob 清除而殘留時，不能把沒有內容的 metadata 排進 push，否則整輪套用必然中止。
    if (!parsedBlobs[row.id]) continue
    docs[row.id] = localMeta(row, parsedBlobs[row.id], 'active')
  }
  for (const row of trashRows) {
    const normalizedRow = typeof row === 'string'
      ? { id: row }
      : row
    if (!isObject(normalizedRow) || typeof normalizedRow.id !== 'string' || !normalizedRow.id) continue
    if (!parsedBlobs[normalizedRow.id]) continue
    docs[normalizedRow.id] = localMeta(normalizedRow, parsedBlobs[normalizedRow.id], 'trashed')
  }

  const knownIds = new Set(Object.keys(docs))
  const favorites = (!Array.isArray(parsedIndex) && Array.isArray(parsedIndex.favorites) ? parsedIndex.favorites : [])
    .filter((id, index, items) => typeof id === 'string' && knownIds.has(id) && items.indexOf(id) === index)
    .sort()

  const result = { docs, favorites, docBlobs }
  if (quarantinedIds.size) result.quarantinedIds = [...quarantinedIds].sort()
  return result
}

function manifestMeta(source) {
  const meta = isObject(source) ? source : {}
  const state = meta.state === 'trashed' ? 'trashed' : 'active'
  const normalized = {
    title: normalizeTitle(meta.title),
    createdAt: validDate(meta.createdAt) ? meta.createdAt : EPOCH,
    updatedAt: validDate(meta.updatedAt) ? meta.updatedAt : EPOCH,
    state
  }
  if (state === 'trashed') {
    normalized.deletedAt = validDate(meta.deletedAt) ? meta.deletedAt : normalized.updatedAt
  }
  return normalized
}

function normalizeManifest(source) {
  const manifest = emptyManifest()
  if (!isObject(source)) return manifest

  if (isObject(source.docs)) {
    for (const id of Object.keys(source.docs).sort()) {
      if (!id || !isObject(source.docs[id])) continue
      manifest.docs[id] = manifestMeta(source.docs[id])
    }
  }
  manifest.favorites = Array.isArray(source.favorites)
    ? [...new Set(source.favorites.filter(id => typeof id === 'string' && id))].sort()
    : []
  if (isObject(source.tombstones)) {
    for (const id of Object.keys(source.tombstones).sort()) {
      if (id && validDate(source.tombstones[id])) manifest.tombstones[id] = source.tombstones[id]
    }
  }
  manifest.lastWriter = typeof source.lastWriter === 'string' ? source.lastWriter : null
  return manifest
}

function normalizeLocal(source) {
  const local = isObject(source) ? source : {}
  const docs = {}
  if (isObject(local.docs)) {
    for (const id of Object.keys(local.docs).sort()) {
      if (id && isObject(local.docs[id])) docs[id] = manifestMeta(local.docs[id])
    }
  }
  return {
    docs,
    favorites: Array.isArray(local.favorites)
      ? [...new Set(local.favorites.filter(id => typeof id === 'string' && id))].sort()
      : [],
    docBlobs: isObject(local.docBlobs) ? { ...local.docBlobs } : {},
    quarantinedIds: Array.isArray(local.quarantinedIds)
      ? [...new Set(local.quarantinedIds.filter(id => typeof id === 'string' && id))].sort()
      : [],
    rebuilt: local.rebuilt === true
  }
}

function timeValue(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function isoValue(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new TypeError('now 必須是有效日期')
  return parsed.toISOString()
}

function eventTime(meta) {
  return meta.state === 'trashed' ? meta.deletedAt || meta.updatedAt : meta.updatedAt
}

function chooseSide(localTime, remoteTime, machineId, remoteWriter) {
  const difference = timeValue(localTime) - timeValue(remoteTime)
  if (difference > 0) return 'local'
  if (difference < 0) return 'remote'

  // timestamp 相同時仍需所有機器得出同一答案，否則兩端會在重試間來回翻轉。
  return String(machineId || '').localeCompare(String(remoteWriter || '')) > 0 ? 'local' : 'remote'
}

function stateWinner({ localDoc, remoteDoc, baseDoc, localChanged, remoteChanged, initialSync, machineId, remoteWriter }) {
  if (localDoc.state === remoteDoc.state) {
    if (localDoc.state === 'active') return localDoc
    return chooseSide(localDoc.deletedAt, remoteDoc.deletedAt, machineId, remoteWriter) === 'local'
      ? localDoc
      : remoteDoc
  }

  const localStateChanged = Boolean(baseDoc) && localDoc.state !== baseDoc.state
  const remoteStateChanged = Boolean(baseDoc) && remoteDoc.state !== baseDoc.state
  const localSideChanged = localStateChanged || localChanged
  const remoteSideChanged = remoteStateChanged || remoteChanged

  // 單邊純狀態變更（尤其 restore 沒有獨立 timestamp）必須可靠傳播。
  if (localStateChanged && !remoteSideChanged) return localDoc
  if (remoteStateChanged && !localSideChanged) return remoteDoc

  if (initialSync || localSideChanged || remoteSideChanged) {
    return chooseSide(eventTime(localDoc), eventTime(remoteDoc), machineId, remoteWriter) === 'local'
      ? localDoc
      : remoteDoc
  }
  return remoteDoc
}

function withState(contentMeta, stateMeta) {
  const merged = {
    title: contentMeta.title,
    createdAt: contentMeta.createdAt,
    updatedAt: contentMeta.updatedAt,
    state: stateMeta.state
  }
  if (stateMeta.state === 'trashed') merged.deletedAt = stateMeta.deletedAt || stateMeta.updatedAt
  return merged
}

function sortedObject(source) {
  return Object.fromEntries(Object.keys(source).sort().map(key => [key, source[key]]))
}

function mergeFavorites({ localFavorites, remoteFavorites, baseFavorites, initialSync, survivingIds }) {
  const local = new Set(localFavorites)
  const remote = new Set(remoteFavorites)
  const base = new Set(baseFavorites)
  const merged = new Set()

  if (initialSync) {
    for (const id of local) merged.add(id)
    for (const id of remote) merged.add(id)
  } else {
    // 三方 set delta：base 成員任一端移除即傳播；base 外成員任一端新增即保留。
    for (const id of base) {
      if (local.has(id) && remote.has(id)) merged.add(id)
    }
    for (const id of local) {
      if (!base.has(id)) merged.add(id)
    }
    for (const id of remote) {
      if (!base.has(id)) merged.add(id)
    }
  }

  return [...merged].filter(id => survivingIds.has(id)).sort()
}

function mergeTombstones({ remoteTombstones, baseTombstones, initialSync }) {
  if (initialSync) return { ...baseTombstones, ...remoteTombstones }

  // tombstone 也必須套三方 delta：base 有而 remote 無，代表另一台已刻意復活，舊 base 不得反殺。
  return { ...remoteTombstones }
}

export function computeSyncPlan({ local, remoteManifest, base, machineId, now }) {
  const localState = normalizeLocal(local)
  const remote = normalizeManifest(remoteManifest)
  const initialSync = base === null || base === undefined
  const baseManifest = initialSync ? emptyManifest() : normalizeManifest(base?.manifest)
  const basePerDoc = !initialSync && isObject(base?.perDoc) ? base.perDoc : {}
  const nowIso = isoValue(now)

  const pushDocs = new Set()
  const pullDocs = new Set()
  const purgeLocal = new Set()
  const conflicts = []
  const resurrect = []
  const trashSet = []
  const trashRestore = new Set()
  const mergedDocs = {}
  const blockedIds = new Set()
  const locallyPurged = new Set()
  const quarantinedIds = new Set(localState.quarantinedIds)

  const tombstones = mergeTombstones({
    remoteTombstones: remote.tombstones,
    baseTombstones: baseManifest.tombstones,
    initialSync
  })

  if (!initialSync) {
    for (const id of Object.keys(baseManifest.docs)) {
      // key 還在但內容不可讀是損壞，不是使用者永久刪除；由健康 remote 副本修復，禁止製造幽靈 tombstone。
      if (localState.docs[id] || quarantinedIds.has(id) || tombstones[id]) continue
      tombstones[id] = nowIso
      locallyPurged.add(id)
      blockedIds.add(id)

      const remoteDoc = remote.docs[id]
      const baseStamp = basePerDoc[id] ?? baseManifest.docs[id]?.updatedAt ?? null
      // localStorage 永久刪除不留 purgedAt；若遠端已偏離 base，就無法可靠判定先後，必須保留內容副本。
      if (remoteDoc && remoteDoc.updatedAt !== baseStamp) {
        pullDocs.add(id)
        resurrect.push({ id })
      }
    }
  }

  for (const [id, purgedAt] of Object.entries(tombstones)) {
    const localDoc = localState.docs[id]
    if (initialSync && localDoc && remote.tombstones[id]) {
      // 首次同步沒有可信 base，套用刪除可能把尚未上雲的唯一副本抹掉；以聯集重新上傳原文件。
      delete tombstones[id]
      continue
    }

    blockedIds.add(id)
    if (!localDoc || locallyPurged.has(id)) continue
    // 是否保住副本只取決於事件先後；base stamp 可能已在上一輪記住同一版本，不能拿來當 purge 守門。
    if (timeValue(localDoc.updatedAt) > timeValue(purgedAt)) {
      resurrect.push({ id })
    } else {
      purgeLocal.add(id)
    }
  }

  const allDocIds = new Set([...Object.keys(localState.docs), ...Object.keys(remote.docs)])
  for (const id of [...allDocIds].sort()) {
    if (blockedIds.has(id) || tombstones[id]) continue
    const localDoc = localState.docs[id]
    const remoteDoc = remote.docs[id]

    if (localDoc && !remoteDoc) {
      pushDocs.add(id)
      mergedDocs[id] = { ...localDoc }
      continue
    }
    if (!localDoc && remoteDoc) {
      pullDocs.add(id)
      mergedDocs[id] = { ...remoteDoc }
      if (remoteDoc.state === 'trashed') trashSet.push({ id, deletedAt: remoteDoc.deletedAt })
      continue
    }
    if (!localDoc || !remoteDoc) continue

    const baseDoc = baseManifest.docs[id]
    const baseStamp = basePerDoc[id] ?? baseDoc?.updatedAt ?? null
    let localChanged = localDoc.updatedAt !== baseStamp
    let remoteChanged = remoteDoc.updatedAt !== baseStamp
    let contentSide = 'remote'

    // updatedAt 同毫秒時，標題 metadata 與 lastWriter 是僅存的勝方證據；後續輪必須拉回遠端 blob 才會真正收斂。
    const remoteWriterAdvanced = !initialSync && remote.lastWriter &&
      remote.lastWriter !== baseManifest.lastWriter && remote.lastWriter !== machineId
    const equalTimeFollowUp = !localChanged && !remoteChanged &&
      localDoc.updatedAt === remoteDoc.updatedAt && remoteWriterAdvanced

    if (localChanged && !remoteChanged) {
      contentSide = 'local'
      pushDocs.add(id)
    } else if (!localChanged && remoteChanged) {
      contentSide = 'remote'
      pullDocs.add(id)
    } else if (localChanged && remoteChanged) {
      contentSide = chooseSide(localDoc.updatedAt, remoteDoc.updatedAt, machineId, remote.lastWriter)
      const loserCopyFrom = contentSide === 'local' ? 'remote' : 'local'
      conflicts.push({ id, winner: contentSide, loserCopyFrom })
      if (contentSide === 'local') pushDocs.add(id)
      else pullDocs.add(id)
    } else if (equalTimeFollowUp) {
      contentSide = 'remote'
      pullDocs.add(id)
    }

    const contentMeta = contentSide === 'local' ? localDoc : remoteDoc
    const localStateDoc = localState.rebuilt
      ? withState(localDoc, baseDoc || remoteDoc)
      : localDoc
    const selectedState = stateWinner({
      localDoc: localStateDoc,
      remoteDoc,
      baseDoc,
      localChanged,
      remoteChanged,
      initialSync,
      machineId,
      remoteWriter: remote.lastWriter
    })
    const merged = withState(contentMeta, selectedState)
    mergedDocs[id] = merged

    if (merged.state !== localDoc.state) {
      if (merged.state === 'trashed') trashSet.push({ id, deletedAt: merged.deletedAt })
      else trashRestore.add(id)
    }
  }

  const survivingIds = new Set(Object.keys(mergedDocs))
  const mergedFavorites = mergeFavorites({
    // rebuild 遺失收藏資訊；把本地視為仍等於 base，才不會把損壞誤當成取消收藏。
    localFavorites: localState.rebuilt && !initialSync ? baseManifest.favorites : localState.favorites,
    remoteFavorites: remote.favorites,
    baseFavorites: baseManifest.favorites,
    initialSync,
    survivingIds
  })
  const localFavoriteSet = new Set(localState.favorites)
  const mergedFavoriteSet = new Set(mergedFavorites)
  const favoriteAdds = mergedFavorites.filter(id => !localFavoriteSet.has(id))
  const favoriteRemoves = localState.favorites.filter(id => !mergedFavoriteSet.has(id)).sort()

  const nextManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    docs: sortedObject(mergedDocs),
    favorites: mergedFavorites,
    tombstones: sortedObject(tombstones),
    lastWriter: machineId
  }
  const nextPerDoc = Object.fromEntries(
    Object.entries(nextManifest.docs).map(([id, document]) => [id, document.updatedAt])
  )

  return {
    pushDocs: [...pushDocs].sort(),
    pullDocs: [...pullDocs].sort(),
    conflicts: conflicts.sort((left, right) => left.id.localeCompare(right.id)),
    purgeLocal: [...purgeLocal].sort(),
    resurrect: resurrect.sort((left, right) => left.id.localeCompare(right.id)),
    favoriteAdds,
    favoriteRemoves,
    trashSet: trashSet
      .filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index)
      .sort((left, right) => left.id.localeCompare(right.id)),
    trashRestore: [...trashRestore].sort(),
    quarantinedIds: [...quarantinedIds].sort(),
    nextManifest,
    nextPerDoc
  }
}

function stableHash(value, seed = 0x811c9dc5) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

function twoDigits(value) {
  return String(value).padStart(2, '0')
}

export function buildConflictCopy(docJsonString, machineLabel, now) {
  if (typeof docJsonString !== 'string') throw new TypeError('文件 JSON 必須是字串')
  const document = parseJson(docJsonString)
  if (!isObject(document) || typeof document.id !== 'string' || !document.id) {
    throw new TypeError('文件 JSON 損壞或缺少 id')
  }

  const timestamp = isoValue(now)
  const displayDate = new Date(now)
  const label = String(machineLabel || '未知裝置')
  const suffix = `${twoDigits(displayDate.getMonth() + 1)}-${twoDigits(displayDate.getDate())} ${twoDigits(displayDate.getHours())}:${twoDigits(displayDate.getMinutes())}`
  const title = `${normalizeTitle(document.title)}（衝突副本・${label} ${suffix}）`
  const identity = `${docJsonString}\u0000${label}\u0000${timestamp}`
  let id = `conflict-${stableHash(identity)}-${stableHash(identity, 0x9e3779b9)}`
  if (id === document.id) id = `${id}-copy`

  const copy = {
    ...document,
    id,
    title,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return { id, title, json: JSON.stringify(copy) }
}

function thumbnailFromBlob(raw, id) {
  if (typeof raw !== 'string') throw new Error(`缺少遠端文件 pulled blob：${id}`)
  const document = parseJson(raw)
  if (!isObject(document) || document.id !== id) throw new Error(`遠端文件 pulled blob 損壞或 id 不符：${id}`)
  const thumbnail = typeof document.thumbnail === 'string' ? document.thumbnail.trim() : ''
  return /^<svg[\s>]/i.test(thumbnail) ? document.thumbnail : ''
}

function newestFirst(left, right, key) {
  const difference = timeValue(right[key]) - timeValue(left[key])
  return difference || left.id.localeCompare(right.id)
}

export function computeLocalWrites({ plan, pulledBlobs, localState }) {
  if (!isObject(plan) || !isObject(plan.nextManifest)) throw new TypeError('plan.nextManifest 必須存在')
  const local = normalizeLocal(localState)
  const pulled = isObject(pulledBlobs) ? pulledBlobs : {}
  const nextManifest = normalizeManifest(plan.nextManifest)
  const pullIds = [...new Set(Array.isArray(plan.pullDocs) ? plan.pullDocs : [])].sort()
  const purgeIds = [...new Set(Array.isArray(plan.purgeLocal) ? plan.purgeLocal : [])].sort()
  const setKeys = {}
  const effectiveBlobs = { ...local.docBlobs }

  for (const id of pullIds) {
    const raw = pulled[id]
    // 先完整驗證所有 doc blob；任一缺失就不產生 index patch，避免 UI 指向不存在的文件。
    thumbnailFromBlob(raw, id)
    setKeys[`${DOC_PREFIX}${id}`] = raw
    effectiveBlobs[id] = raw
  }

  const docs = []
  const trash = []
  for (const [id, document] of Object.entries(nextManifest.docs)) {
    const thumbnail = thumbnailFromBlob(effectiveBlobs[id], id)
    const row = {
      id,
      title: document.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      thumbnail
    }
    if (document.state === 'trashed') {
      trash.push({ ...row, deletedAt: document.deletedAt })
    } else {
      docs.push(row)
    }
  }
  docs.sort((left, right) => newestFirst(left, right, 'updatedAt'))
  trash.sort((left, right) => newestFirst(left, right, 'deletedAt'))

  const survivingIds = new Set([...docs, ...trash].map(row => row.id))
  const index = {
    version: 2,
    docs,
    trash,
    favorites: nextManifest.favorites.filter(id => survivingIds.has(id))
  }
  // JS 保證一般字串 key 的插入順序；把 index 最後加入，呼叫端可依 Object.entries 逐筆安全套用。
  setKeys[INDEX_KEY] = JSON.stringify(index)

  const removeKeys = []
  for (const id of purgeIds) {
    removeKeys.push(
      `${DOC_PREFIX}${id}`,
      `${HISTORY_PREFIX}${id}`,
      `${GAMMA_PREFIX}${id}`,
      `${VIEW_MODE_PREFIX}${id}`
    )
  }
  return { setKeys, removeKeys }
}
