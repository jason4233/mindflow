/**
 * localStorage 文件庫 v2：文件內容仍各自存放，index 管理目錄、回收筒、收藏與縮圖。
 */
import {
  createDefaultDoc,
  createId,
  deserializeDoc,
  normalizeDoc,
  structuredCloneSafe,
  walkNodes
} from './editor/model.js'
import { getTheme } from './editor/themes.js'

export const INDEX_KEY = 'mindflow.docs.index'
export const DOC_KEY_PREFIX = 'mindflow.doc.'
export const HISTORY_KEY_PREFIX = 'mindflow.history.'
export const INDEX_VERSION = 2
export const SNAPSHOT_LIMIT = 30
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
export const SNAPSHOT_NODE_CHANGE_RATIO = 0.1

function storage() {
  if (!globalThis.localStorage) throw new Error('此環境不支援 localStorage')
  return globalThis.localStorage
}

function emptyIndex() {
  return { version: INDEX_VERSION, docs: [], trash: [], favorites: [] }
}

// 每個 session 的最新快照 meta 快取：讓 autosave 的節流判斷不必每次 parse 整包歷史
const snapshotMetaCache = new Map()

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' || error?.code === 22
}

function normalizeMeta(meta, extras = {}) {
  if (!meta || typeof meta.id !== 'string' || !meta.id) return null
  return {
    id: meta.id,
    title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : '未命名心智圖',
    createdAt: validDate(meta.createdAt) ? meta.createdAt : new Date(0).toISOString(),
    updatedAt: validDate(meta.updatedAt) ? meta.updatedAt : new Date(0).toISOString(),
    thumbnail: isSvgThumbnail(meta.thumbnail) ? meta.thumbnail : '',
    ...extras
  }
}

function readIndex() {
  const raw = storage().getItem(INDEX_KEY)
  // 沒有索引＝第一次使用，不是損毀；空字串同樣視為全新
  if (raw === null || raw === '') return emptyIndex()
  try {
    const parsed = JSON.parse(raw)
    if (!parsed) return emptyIndex()

    // v1 只有 docs；這裡在記憶體中補齊欄位，第一次寫入時才升級為 v2。
    const rawDocs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.docs) ? parsed.docs : []
    const rawTrash = !Array.isArray(parsed) && Array.isArray(parsed.trash) ? parsed.trash : []
    const trashedIds = new Set(rawTrash.filter(item => typeof item === 'string'))
    const docs = rawDocs
      .map(normalizeMeta)
      .filter(Boolean)
      .filter(meta => !trashedIds.has(meta.id))
    const docsById = new Map(rawDocs.map(meta => [meta?.id, meta]))
    const trash = rawTrash
      .map(item => {
        const source = typeof item === 'string' ? docsById.get(item) : item
        return normalizeMeta(source, {
          deletedAt: validDate(source?.deletedAt) ? source.deletedAt : new Date(0).toISOString()
        })
      })
      .filter(Boolean)
    const knownIds = new Set([...docs, ...trash].map(meta => meta.id))
    const favorites = (!Array.isArray(parsed) && Array.isArray(parsed.favorites) ? parsed.favorites : [])
      .filter((id, index, items) => typeof id === 'string' && knownIds.has(id) && items.indexOf(id) === index)

    return { version: INDEX_VERSION, docs: uniqueMeta(docs), trash: uniqueMeta(trash), favorites }
  } catch {
    return rebuildIndexFromDocuments(raw)
  }
}

/**
 * 索引損毀時的自癒：先把壞掉的原文隔離備份，再掃描既存文件 blob 重建目錄。
 * 不這麼做的話整個文件庫會從 UI 消失，且下一次 autosave 會把空索引固化、其餘文件永久孤兒化。
 * 已知取捨：回收筒歸屬與收藏無法還原，一律放回文件列表（看得見比藏起來安全）。
 */
function rebuildIndexFromDocuments(corruptRaw) {
  try { storage().setItem(`${INDEX_KEY}.corrupt`, corruptRaw) } catch { /* 空間不足時放棄隔離備份 */ }
  const store = storage()
  const docs = []
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i)
    if (!key || !key.startsWith(DOC_KEY_PREFIX)) continue
    try {
      const doc = JSON.parse(store.getItem(key))
      const id = key.slice(DOC_KEY_PREFIX.length)
      if (!doc || typeof doc !== 'object' || doc.id !== id || !doc.root) continue
      docs.push(normalizeMeta({ id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, thumbnail: doc.thumbnail }))
    } catch { /* 單一文件 blob 壞掉就跳過，不拖累其他文件重建 */ }
  }
  const rebuilt = { ...emptyIndex(), docs: uniqueMeta(docs.filter(Boolean)) }
  console.warn(`MindFlow 文件索引損毀，已從 ${rebuilt.docs.length} 份既存文件重建；原始索引備份於 ${INDEX_KEY}.corrupt`)
  return rebuilt
}

function writeIndex(index) {
  storage().setItem(INDEX_KEY, JSON.stringify({
    version: INDEX_VERSION,
    docs: uniqueMeta(index.docs),
    trash: uniqueMeta(index.trash),
    favorites: Array.from(new Set(index.favorites))
  }))
}

function uniqueMeta(items) {
  const seen = new Set()
  return items.filter(item => {
    if (!item || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function newestFirst(items, key = 'updatedAt') {
  return items.slice().sort((a, b) => Date.parse(b[key] || 0) - Date.parse(a[key] || 0))
}

export function listDocuments(options = {}) {
  const index = readIndex()
  const favorites = new Set(index.favorites)
  const docs = options.favoritesOnly ? index.docs.filter(meta => favorites.has(meta.id)) : index.docs
  return newestFirst(docs).map(meta => ({ ...meta, favorite: favorites.has(meta.id) }))
}

export function listTrashedDocuments() {
  const index = readIndex()
  const favorites = new Set(index.favorites)
  return newestFirst(index.trash, 'deletedAt').map(meta => ({ ...meta, favorite: favorites.has(meta.id) }))
}

export function getDocumentMeta(id) {
  const index = readIndex()
  const meta = index.docs.find(item => item.id === id) || index.trash.find(item => item.id === id)
  return meta ? { ...meta, favorite: index.favorites.includes(id) } : null
}

export function createDocument(input = null) {
  const doc = input ? normalizeDoc(input) : createDefaultDoc()
  saveDocument(doc, { allowCreate: true })
  return doc
}

export function loadDocument(id) {
  if (!id) return null
  const json = storage().getItem(`${DOC_KEY_PREFIX}${id}`)
  if (!json) return null
  try {
    return deserializeDoc(json)
  } catch {
    return null
  }
}

/**
 * 版本快照與目前文件分開存放，避免升級既有 index schema。
 * 對外一律回傳 clone，面板預覽或還原不會誤改 localStorage 內的版本。
 */
export function listDocumentSnapshots(id) {
  return readSnapshots(id)
    .slice()
    .reverse()
    .map(snapshot => structuredCloneSafe(snapshot))
}

/**
 * 壞檔救援：主檔 JSON 解析失敗時，從版本快照（新到舊）找第一份可用的還原並寫回同一個 id。
 * 完全救不回來時回傳 null，且不動原始 blob（留給使用者或工程手動處理）。
 */
export function recoverDocument(id) {
  if (!id) return null
  for (const snapshot of listDocumentSnapshots(id)) {
    try {
      // normalizeDoc 對空物件會「編造」一份預設文件而不是拋錯——必須先驗結構，
      // 否則一份壞掉的 {} 快照會蓋過更舊但完整的快照
      const source = snapshot.document
      if (!source || typeof source !== 'object' || !source.root || typeof source.root !== 'object' || typeof source.root.id !== 'string') continue
      const doc = normalizeDoc(source)
      doc.id = id
      const stamp = saveDocument(doc, { allowCreate: true, snapshot: false })
      // 寫入產生了新的 updatedAt；回傳的 doc 必須同步，否則呼叫端第一次存檔就誤判 CAS 衝突
      if (typeof stamp === 'string') doc.updatedAt = stamp
      return doc
    } catch { /* 這份快照也壞，往更舊的找 */ }
  }
  return null
}

export function getDocumentSnapshot(documentId, snapshotId) {
  const snapshot = readSnapshots(documentId).find(item => item.id === snapshotId)
  return snapshot ? structuredCloneSafe(snapshot) : null
}

export function createDocumentSnapshot(doc, options = {}) {
  if (!doc?.id || !doc.root) return null
  const document = structuredCloneSafe(normalizeDoc(doc))
  const createdAt = resolveTimestamp(options.now)
  const snapshot = {
    id: createId('snapshot'),
    createdAt,
    nodeCount: countDocumentNodes(document),
    document
  }
  const snapshots = readSnapshots(document.id)
  snapshots.push(snapshot)
  writeSnapshots(document.id, snapshots.slice(-SNAPSHOT_LIMIT))
  snapshotMetaCache.set(document.id, { createdAt: snapshot.createdAt, nodeCount: snapshot.nodeCount })
  return structuredCloneSafe(snapshot)
}

export function saveDocument(doc, options = {}) {
  const index = readIndex()
  const documentKey = `${DOC_KEY_PREFIX}${doc?.id || ''}`
  const known = index.docs.some(meta => meta.id === doc?.id) || index.trash.some(meta => meta.id === doc?.id)
  // 永久刪除後，殘留編輯器分頁不可再用 autosave 把文件加回 index。
  if (!options.allowCreate && !known && storage().getItem(documentKey) === null) return false
  // CAS 版本比對：呼叫端聲明它所知的最後版本，儲存區已被別的視窗改過就拒寫，避免舊內容蓋掉新內容
  if (options.expectedUpdatedAt) {
    const rawExisting = storage().getItem(documentKey)
    if (rawExisting) {
      let existingUpdatedAt = null
      try { existingUpdatedAt = JSON.parse(rawExisting)?.updatedAt || null } catch { /* 壞檔不擋覆寫，本次寫入即修復 */ }
      if (existingUpdatedAt && existingUpdatedAt !== options.expectedUpdatedAt) {
        const conflict = new Error('文件已被其他視窗修改')
        conflict.name = 'MindflowSaveConflictError'
        conflict.currentUpdatedAt = existingUpdatedAt
        throw conflict
      }
    }
  }
  const persisted = structuredCloneSafe(normalizeDoc(doc))
  persisted.updatedAt = resolveTimestamp(options.now)
  persisted.thumbnail = isSvgThumbnail(options.thumbnail)
    ? options.thumbnail
    : createDocumentThumbnail(persisted)
  try {
    storage().setItem(documentKey, JSON.stringify(persisted))
  } catch (error) {
    if (!isQuotaError(error)) throw error
    // 空間滿：先丟掉這份文件的版本快照騰出空間再試一次；仍失敗就把錯誤交給呼叫端顯示警告
    try { writeSnapshots(persisted.id, []) } catch { /* 快照清不掉也繼續重試主檔 */ }
    snapshotMetaCache.delete(persisted.id)
    storage().setItem(documentKey, JSON.stringify(persisted))
  }

  const meta = {
    id: persisted.id,
    title: persisted.title,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    thumbnail: persisted.thumbnail
  }
  const activeIndex = index.docs.findIndex(item => item.id === persisted.id)
  const trashIndex = index.trash.findIndex(item => item.id === persisted.id)
  if (activeIndex !== -1) index.docs[activeIndex] = meta
  else if (trashIndex !== -1) index.trash[trashIndex] = { ...meta, deletedAt: index.trash[trashIndex].deletedAt }
  else index.docs.push(meta)
  writeIndex(index)
  maybeCreateDocumentSnapshot(persisted, options)
  return persisted.updatedAt
}

/** 舊 API 名稱保留，但 Phase B 起刪除代表移入回收筒。 */
export function deleteDocument(id) {
  const index = readIndex()
  const itemIndex = index.docs.findIndex(meta => meta.id === id)
  if (itemIndex === -1) return false
  const [meta] = index.docs.splice(itemIndex, 1)
  index.trash.unshift({ ...meta, deletedAt: new Date().toISOString() })
  writeIndex(index)
  return true
}

export const trashDocument = deleteDocument

export function restoreDocument(id) {
  const index = readIndex()
  const itemIndex = index.trash.findIndex(meta => meta.id === id)
  if (itemIndex === -1) return false
  const [{ deletedAt: _deletedAt, ...meta }] = index.trash.splice(itemIndex, 1)
  index.docs.unshift(meta)
  writeIndex(index)
  return true
}

export function permanentlyDeleteDocument(id) {
  const index = readIndex()
  const hadDocument = index.trash.some(meta => meta.id === id)
  if (!hadDocument) return false
  index.trash = index.trash.filter(meta => meta.id !== id)
  index.favorites = index.favorites.filter(favoriteId => favoriteId !== id)
  storage().removeItem(`${DOC_KEY_PREFIX}${id}`)
  storage().removeItem(`${HISTORY_KEY_PREFIX}${id}`)
  snapshotMetaCache.delete(id)
  // 掃掉影子狀態（mindflow.gamma.*、mindflow.viewmode.* 等），永久刪除不留殘渣吃空間
  const residue = []
  for (let i = 0; i < storage().length; i += 1) {
    const key = storage().key(i)
    if (key && key.startsWith('mindflow.') && key.endsWith(`.${id}`)) residue.push(key)
  }
  residue.forEach(key => storage().removeItem(key))
  writeIndex(index)
  return true
}

export function renameDocument(id, title) {
  const nextTitle = String(title ?? '').trim()
  const doc = loadDocument(id)
  if (!doc || !nextTitle) return false
  doc.title = nextTitle
  saveDocument(doc)
  return true
}

export function duplicateDocument(id) {
  const source = loadDocument(id)
  if (!source) return null
  const copy = structuredCloneSafe(source)
  copy.id = createId('doc')
  copy.title = `${source.title}（副本）`
  const now = new Date().toISOString()
  copy.createdAt = now
  copy.updatedAt = now
  // 不共用節點 ID，避免日後跨文件操作或匯入時產生識別衝突。
  const idMap = new Map()
  walkNodes(copy.root, node => {
    const nextId = createId('node')
    idMap.set(node.id, nextId)
    node.id = nextId
  })
  // 關聯線與概要引用節點 id，必須跟著重映射；映射不到的整筆丟棄（原本就指向不存在節點的垃圾）
  copy.relations = (Array.isArray(copy.relations) ? copy.relations : [])
    .map(relation => ({ ...relation, fromId: idMap.get(relation.fromId), toId: idMap.get(relation.toId) }))
    .filter(relation => relation.fromId && relation.toId)
  copy.summaries = (Array.isArray(copy.summaries) ? copy.summaries : [])
    .map(summary => ({
      ...summary,
      parentId: idMap.get(summary.parentId),
      ...(summary.startNodeId ? { startNodeId: idMap.get(summary.startNodeId) } : {}),
      ...(summary.endNodeId ? { endNodeId: idMap.get(summary.endNodeId) } : {})
    }))
    .filter(summary => summary.parentId && (!('startNodeId' in summary) || summary.startNodeId) && (!('endNodeId' in summary) || summary.endNodeId))
  return createDocument(copy)
}

export function isFavorite(id) {
  return readIndex().favorites.includes(id)
}

export function toggleFavorite(id, force) {
  const index = readIndex()
  const exists = index.docs.some(meta => meta.id === id) || index.trash.some(meta => meta.id === id)
  if (!exists) return false
  const current = index.favorites.includes(id)
  const next = typeof force === 'boolean' ? force : !current
  index.favorites = next
    ? Array.from(new Set([...index.favorites, id]))
    : index.favorites.filter(favoriteId => favoriteId !== id)
  writeIndex(index)
  return next
}

export function createDocumentThumbnail(doc) {
  const normalized = normalizeDoc(doc)
  const width = 360
  const height = 202
  const center = { x: width / 2, y: height / 2 }
  const visible = collectThumbnailNodes(normalized.root)
  const positions = positionThumbnailNodes(visible, center, width, height)
  const selectedTheme = getTheme(normalized.themeId)
  const accent = safeColor(selectedTheme.branchPalette[0], '#3f89de')
  const rootFill = safeColor(selectedTheme.rootStyle.fill, accent)
  const rootText = safeColor(selectedTheme.rootStyle.textColor, '#ffffff')
  const branchFill = safeColor(selectedTheme.level2Style.fill, '#ffffff')
  const branchText = safeColor(selectedTheme.level2Style.textColor, '#3b4149')
  const background = safeColor(normalized.canvas?.background, '#fbfaf8')
  const lines = visible.slice(1).map(entry => {
    const from = positions.get(entry.parent.id)
    const to = positions.get(entry.node.id)
    if (!from || !to) return ''
    const bend = (from.x + to.x) / 2
    return `<path d="M${from.x} ${from.y} C${bend} ${from.y} ${bend} ${to.y} ${to.x} ${to.y}" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" opacity=".72"/>`
  }).join('')
  const nodes = visible.map((entry, index) => {
    const point = positions.get(entry.node.id)
    if (!point) return ''
    const root = index === 0
    const boxWidth = root ? 96 : 74
    const boxHeight = root ? 30 : 24
    const fill = root ? rootFill : branchFill
    const stroke = root ? accent : `${accent}99`
    const textColor = root ? rootText : branchText
    return `<g><rect x="${point.x - boxWidth / 2}" y="${point.y - boxHeight / 2}" width="${boxWidth}" height="${boxHeight}" rx="${root ? 10 : 8}" fill="${fill}" stroke="${stroke}"/><text x="${point.x}" y="${point.y + 4}" text-anchor="middle" font-family="Segoe UI,Noto Sans TC,sans-serif" font-size="${root ? 11 : 9}" font-weight="${root ? 700 : 500}" fill="${textColor}">${escapeXml(shorten(entry.node.text, root ? 10 : 8))}</text></g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(normalized.title)}縮圖"><rect width="${width}" height="${height}" rx="16" fill="${escapeXml(background)}"/><circle cx="318" cy="32" r="42" fill="${accent}" opacity=".08"/><circle cx="42" cy="174" r="54" fill="${accent}" opacity=".06"/>${lines}${nodes}</svg>`
}

function collectThumbnailNodes(root) {
  const result = [{ node: root, parent: null, depth: 0, side: 'center' }]
  const queue = root.children.map((node, index) => ({
    node,
    parent: root,
    depth: 1,
    side: node.side || (index % 2 ? 'left' : 'right')
  }))
  while (queue.length && result.length < 13) {
    const entry = queue.shift()
    result.push(entry)
    for (const child of entry.node.children) {
      queue.push({ node: child, parent: entry.node, depth: entry.depth + 1, side: entry.side })
    }
  }
  return result
}

function positionThumbnailNodes(entries, center, width, height) {
  const positions = new Map([[entries[0].node.id, center]])
  for (const side of ['left', 'right']) {
    const sideEntries = entries.filter(entry => entry.side === side)
    sideEntries.forEach((entry, index) => {
      const depth = Math.min(entry.depth, 3)
      const direction = side === 'left' ? -1 : 1
      const x = center.x + direction * (78 + (depth - 1) * 54)
      const step = Math.min(44, (height - 42) / Math.max(sideEntries.length, 1))
      const y = center.y + (index - (sideEntries.length - 1) / 2) * step
      positions.set(entry.node.id, {
        x: Math.max(38, Math.min(width - 38, x)),
        y: Math.max(20, Math.min(height - 20, y))
      })
    })
  }
  return positions
}

function safeColor(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i.test(trimmed)
    ? trimmed
    : fallback
}

function isSvgThumbnail(value) {
  return typeof value === 'string' && /^<svg[\s>]/i.test(value.trim())
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function readSnapshots(id) {
  if (typeof id !== 'string' || !id) return []
  try {
    const parsed = JSON.parse(storage().getItem(`${HISTORY_KEY_PREFIX}${id}`) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(snapshot => (
        snapshot &&
        typeof snapshot.id === 'string' &&
        validDate(snapshot.createdAt) &&
        Number.isInteger(snapshot.nodeCount) &&
        snapshot.nodeCount > 0 &&
        snapshot.document &&
        typeof snapshot.document === 'object'
      ))
      .slice(-SNAPSHOT_LIMIT)
  } catch {
    return []
  }
}

function writeSnapshots(id, snapshots) {
  storage().setItem(`${HISTORY_KEY_PREFIX}${id}`, JSON.stringify(snapshots))
}

function maybeCreateDocumentSnapshot(doc, options) {
  if (options.snapshot === false) return null
  let latest = snapshotMetaCache.get(doc.id)
  if (latest === undefined) {
    const last = readSnapshots(doc.id).at(-1)
    latest = last ? { createdAt: last.createdAt, nodeCount: last.nodeCount } : null
    snapshotMetaCache.set(doc.id, latest)
  }
  const nodeCount = countDocumentNodes(doc)
  const timestamp = Date.parse(doc.updatedAt)
  // Math.abs：時鐘倒退或匯入未來時間戳時，不得讓節流恆成立、快照永久停擺
  const elapsed = latest ? Math.abs(timestamp - Date.parse(latest.createdAt)) : Infinity
  const nodeRatio = latest
    ? Math.abs(nodeCount - latest.nodeCount) / Math.max(1, latest.nodeCount)
    : Infinity
  if (latest && elapsed <= SNAPSHOT_INTERVAL_MS && nodeRatio <= SNAPSHOT_NODE_CHANGE_RATIO) return null
  return createDocumentSnapshot(doc, { now: doc.updatedAt })
}

function countDocumentNodes(doc) {
  let count = 0
  walkNodes(doc.root, () => { count += 1 })
  return count
}

function resolveTimestamp(value) {
  const date = value === undefined ? new Date() : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function shorten(value, length) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length)}…` : text
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
