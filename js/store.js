/**
 * localStorage 文件庫；index 只保存排序與 meta，完整 Doc 各自獨立存放。
 */
import { createDefaultDoc, deserializeDoc, normalizeDoc, structuredCloneSafe } from './editor/model.js'

export const INDEX_KEY = 'mindflow.docs.index'
export const DOC_KEY_PREFIX = 'mindflow.doc.'

function storage() {
  if (!globalThis.localStorage) throw new Error('此環境不支援 localStorage')
  return globalThis.localStorage
}

function readIndex() {
  try {
    const parsed = JSON.parse(storage().getItem(INDEX_KEY) || '')
    if (!parsed || !Array.isArray(parsed.docs)) return { version: 1, docs: [] }
    return {
      version: 1,
      docs: parsed.docs.filter(meta => meta && typeof meta.id === 'string')
    }
  } catch {
    return { version: 1, docs: [] }
  }
}

function writeIndex(index) {
  storage().setItem(INDEX_KEY, JSON.stringify(index))
}

export function listDocuments() {
  return readIndex().docs
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
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

export function saveDocument(doc) {
  const persisted = structuredCloneSafe(normalizeDoc(doc))
  persisted.updatedAt = new Date().toISOString()
  storage().setItem(`${DOC_KEY_PREFIX}${persisted.id}`, JSON.stringify(persisted))

  const index = readIndex()
  const meta = {
    id: persisted.id,
    title: persisted.title,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt
  }
  const existingIndex = index.docs.findIndex(item => item.id === persisted.id)
  if (existingIndex === -1) index.docs.push(meta)
  else index.docs[existingIndex] = meta
  writeIndex(index)
  return persisted.updatedAt
}

export function deleteDocument(id) {
  storage().removeItem(`${DOC_KEY_PREFIX}${id}`)
  const index = readIndex()
  index.docs = index.docs.filter(meta => meta.id !== id)
  writeIndex(index)
}

export function renameDocument(id, title) {
  const doc = loadDocument(id)
  if (!doc) return false
  doc.title = String(title).trim() || doc.title
  saveDocument(doc)
  return true
}
