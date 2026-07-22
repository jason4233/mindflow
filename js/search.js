/** 跨文件全文檢索：搜尋標題與全部節點文字，並保留節點階層路徑。 */
import { listDocuments, loadDocument } from './store.js'

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-Hant')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchDocuments(query, options = {}) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const documents = options.documents || listDocuments()
  const load = options.loadDocument || loadDocument
  const perDocumentLimit = Math.max(1, Number(options.perDocumentLimit) || 8)

  return documents
    .map(meta => searchOneDocument(meta, load(meta.id), tokens, perDocumentLimit))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.titleMatch !== right.titleMatch) return left.titleMatch ? -1 : 1
      if (left.matches.length !== right.matches.length) return right.matches.length - left.matches.length
      return Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
    })
}

function searchOneDocument(meta, doc, tokens, limit) {
  if (!doc?.root) return null
  const titleMatch = includesTokens(meta.title || doc.title, tokens)
  const matches = []

  const visit = (node, path) => {
    const nextPath = [...path, node.text || '未命名節點']
    if (includesTokens(node.text, tokens) && matches.length < limit) {
      matches.push({
        nodeId: node.id,
        text: node.text || '未命名節點',
        path: nextPath,
        pathText: nextPath.join(' › ')
      })
    }
    node.children.forEach(child => visit(child, nextPath))
  }
  visit(doc.root, [])

  if (!titleMatch && matches.length === 0) return null
  return {
    documentId: meta.id,
    title: meta.title || doc.title,
    updatedAt: meta.updatedAt || doc.updatedAt,
    thumbnail: meta.thumbnail || '',
    favorite: Boolean(meta.favorite),
    titleMatch,
    matches
  }
}

function includesTokens(value, tokens) {
  const text = normalizeSearchText(value)
  return tokens.every(token => text.includes(token))
}
