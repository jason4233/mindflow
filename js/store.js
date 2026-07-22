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

export const INDEX_KEY = 'mindflow.docs.index'
export const DOC_KEY_PREFIX = 'mindflow.doc.'
export const INDEX_VERSION = 2

function storage() {
  if (!globalThis.localStorage) throw new Error('此環境不支援 localStorage')
  return globalThis.localStorage
}

function emptyIndex() {
  return { version: INDEX_VERSION, docs: [], trash: [], favorites: [] }
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
  try {
    const parsed = JSON.parse(storage().getItem(INDEX_KEY) || '')
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
    return emptyIndex()
  }
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
  saveDocument(doc)
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

export function saveDocument(doc, options = {}) {
  const persisted = structuredCloneSafe(normalizeDoc(doc))
  persisted.updatedAt = new Date().toISOString()
  persisted.thumbnail = isSvgThumbnail(options.thumbnail)
    ? options.thumbnail
    : createDocumentThumbnail(persisted)
  storage().setItem(`${DOC_KEY_PREFIX}${persisted.id}`, JSON.stringify(persisted))

  const index = readIndex()
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
  walkNodes(copy.root, node => { node.id = createId('node') })
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
  const accent = colorFromTheme(normalized.themeId)
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
    const fill = root ? accent : '#ffffff'
    const stroke = root ? accent : `${accent}99`
    const textColor = root ? '#ffffff' : '#3b4149'
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

function colorFromTheme(themeId) {
  const palette = ['#F17E2E', '#4F7CAC', '#37A07B', '#8A62C7', '#D55F78', '#A06B3C']
  const value = String(themeId || 'classic-blue')
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
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
