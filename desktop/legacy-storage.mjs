import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { normalizeMindflowEntries } from './backup-store.mjs'

const INDEX_KEY = 'mindflow.docs.index'
const DOC_PREFIX = 'mindflow.doc.'
const HISTORY_PREFIX = 'mindflow.history.'
const LEGACY_ORIGIN_PATTERN = /http:\/\/127\.0\.0\.1:(\d{2,5})/g

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function timestamp(value) {
  const parsed = Date.parse(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizedIndex(value) {
  const parsed = parseJson(value)
  if (!parsed) return null
  return {
    docs: Array.isArray(parsed) ? parsed : Array.isArray(parsed.docs) ? parsed.docs : [],
    trash: !Array.isArray(parsed) && Array.isArray(parsed.trash) ? parsed.trash : [],
    favorites: !Array.isArray(parsed) && Array.isArray(parsed.favorites) ? parsed.favorites : []
  }
}

export async function discoverLegacyOrigins(userDataPaths) {
  const origins = new Set()

  for (const userDataPath of new Set(userDataPaths.filter(Boolean))) {
    const levelDbPath = join(userDataPath, 'Local Storage', 'leveldb')
    let names = []
    try {
      names = await readdir(levelDbPath)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }

    for (const name of names) {
      if (!/\.(?:ldb|log)$/i.test(name)) continue
      const contents = await readFile(join(levelDbPath, name))
      // LevelDB key 內的 origin 是 ASCII；latin1 可保留每個 byte，避免二進位片段截斷搜尋。
      const text = contents.toString('latin1')
      for (const match of text.matchAll(LEGACY_ORIGIN_PATTERN)) {
        const port = Number(match[1])
        if (port >= 1 && port <= 65535) origins.add(`http://127.0.0.1:${port}`)
      }
    }
  }

  return [...origins].sort()
}

export async function readLegacyOriginEntries(webContents, origins) {
  if (!origins.length) return []
  const debuggerApi = webContents.debugger
  const attachedHere = !debuggerApi.isAttached()
  if (attachedHere) debuggerApi.attach('1.3')

  try {
    await debuggerApi.sendCommand('DOMStorage.enable')
    const candidates = []
    for (const origin of origins) {
      try {
        const result = await debuggerApi.sendCommand('DOMStorage.getDOMStorageItems', {
          storageId: { securityOrigin: origin, isLocalStorage: true }
        })
        const entries = normalizeMindflowEntries(Object.fromEntries(result.entries || []))
        if (entries[INDEX_KEY]) candidates.push({ origin, entries })
      } catch {
        // 舊 port 的資料可能已被 Chromium 清理；單一 origin 失敗不應阻止其餘救援。
      }
    }
    return candidates
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
  }
}

export function mergeLegacyMindflowEntries(candidates) {
  const result = {}
  const documents = new Map()
  const histories = new Map()
  const states = new Map()
  const favorites = new Set()
  let foundIndex = false

  for (const candidate of candidates) {
    const entries = normalizeMindflowEntries(candidate?.entries)
    const index = normalizedIndex(entries[INDEX_KEY])
    if (!index) continue
    foundIndex = true

    for (const [key, value] of Object.entries(entries)) {
      if (key === INDEX_KEY) continue
      if (key.startsWith(DOC_PREFIX)) {
        const document = parseJson(value)
        if (!document?.id) continue
        const current = documents.get(document.id)
        if (!current || timestamp(document.updatedAt) >= current.updatedAt) {
          documents.set(document.id, {
            raw: value,
            document,
            updatedAt: timestamp(document.updatedAt)
          })
        }
      } else if (key.startsWith(HISTORY_PREFIX)) {
        const id = key.slice(HISTORY_PREFIX.length)
        if (!histories.has(id) || value.length > histories.get(id).length) histories.set(id, value)
      } else {
        // 設定類 key 沒有修改時間，只在尚未選定時保留第一份有效值。
        if (!(key in result)) result[key] = value
      }
    }

    for (const meta of index.docs) recordState(states, meta, false)
    for (const meta of index.trash) recordState(states, meta, true)
    for (const id of index.favorites) {
      if (typeof id === 'string') favorites.add(id)
    }
  }

  if (!foundIndex) return {}

  const docs = []
  const trash = []
  for (const [id, selected] of documents) {
    result[`${DOC_PREFIX}${id}`] = selected.raw
    if (histories.has(id)) result[`${HISTORY_PREFIX}${id}`] = histories.get(id)

    const document = selected.document
    const meta = {
      id,
      title: typeof document.title === 'string' && document.title.trim()
        ? document.title.trim()
        : '未命名心智圖',
      createdAt: document.createdAt || new Date(0).toISOString(),
      updatedAt: document.updatedAt || new Date(0).toISOString(),
      thumbnail: typeof document.thumbnail === 'string' ? document.thumbnail : ''
    }
    const state = states.get(id)
    if (state?.trashed) {
      trash.push({ ...meta, deletedAt: state.deletedAt || state.meta?.deletedAt || meta.updatedAt })
    } else {
      docs.push(meta)
    }
  }

  const newestFirst = (left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt)
  docs.sort(newestFirst)
  trash.sort((left, right) => timestamp(right.deletedAt) - timestamp(left.deletedAt))
  result[INDEX_KEY] = JSON.stringify({
    version: 2,
    docs,
    trash,
    favorites: [...favorites].filter(id => documents.has(id))
  })
  return result
}

function recordState(states, meta, trashed) {
  if (!meta?.id) return
  const stateTime = Math.max(timestamp(meta.updatedAt), trashed ? timestamp(meta.deletedAt) : 0)
  const current = states.get(meta.id)
  if (!current || stateTime >= current.stateTime) {
    states.set(meta.id, {
      trashed,
      deletedAt: meta.deletedAt,
      meta,
      stateTime
    })
  }
}
