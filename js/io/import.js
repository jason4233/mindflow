/**
 * MindFlow 文件的純邏輯匯入器；解析 JSON／TXT／Markdown，不存取 DOM 或檔案系統。
 */
import { deserializeDoc } from '../editor/model.js'

const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z'
const DEFAULT_TITLE = '未命名'
const VALID_LAYOUTS = new Set([
  'mindmap-right', 'mindmap-left', 'mindmap-both', 'org',
  'tree-left', 'tree-right', 'timeline-h', 'fishbone'
])

/** 匯入原生 MindFlow JSON；保留舊 stub 的字串或物件輸入相容性。 */
export function importDocumentJson(json) {
  const raw = typeof json === 'string' ? JSON.parse(stripBom(json)) : json
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('MindFlow JSON 必須是文件物件')
  }
  return deserializeDoc(raw)
}

/** 匯入純文字縮排大綱。 */
export function importDocumentTxt(source, options = {}) {
  return importOutline(source, { ...options, format: 'txt' })
}

/** 匯入 Markdown 標題／縮排清單大綱。 */
export function importDocumentMarkdown(source, options = {}) {
  return importOutline(source, { ...options, format: 'markdown' })
}

/**
 * 將大綱文字轉成 Doc。
 * 預設 metadata 與 ID 都由輸入內容決定，確保相同輸入可得到相同輸出；
 * UI 若要每次匯入成新文件，可由 options 傳入 id、timestamp 或 idFactory。
 */
export function importOutline(source, options = {}) {
  const text = stripBom(String(source ?? '')).replace(/\r\n?/g, '\n')
  const format = normalizeFormat(options.format, text)
  const tokens = tokenizeOutline(text, format, options)
  const hash = hashString(`${format}\n${text}`)
  const makeId = createIdProvider(options.idFactory, hash)
  const root = buildTree(tokens, makeId)
  const timestamp = validDateString(options.timestamp) ? options.timestamp : DEFAULT_TIMESTAMP
  const derivedTitle = root.text.trim() || DEFAULT_TITLE
  const title = typeof options.title === 'string' && options.title.trim()
    ? options.title.trim()
    : derivedTitle

  return {
    id: typeof options.id === 'string' && options.id ? options.id : `doc_import_${hash}`,
    title,
    createdAt: validDateString(options.createdAt) ? options.createdAt : timestamp,
    updatedAt: validDateString(options.updatedAt) ? options.updatedAt : timestamp,
    root,
    layout: VALID_LAYOUTS.has(options.layout) ? options.layout : 'mindmap-both',
    themeId: typeof options.themeId === 'string' && options.themeId ? options.themeId : 'classic-blue',
    relations: [],
    summaries: [],
    canvas: {
      background: typeof options.background === 'string' ? options.background : '#f5f5f5',
      watermark: Boolean(options.watermark)
    }
  }
}

function tokenizeOutline(source, format, options) {
  const tabSize = clampInteger(options.tabSize, 1, 16, 2)
  const lines = source.split('\n')
  const tokens = []
  let indentLevels = [0]
  let activeHeadingDepth = null

  for (const rawLine of lines) {
    if (/^[ \t]*$/u.test(rawLine)) continue

    if (format === 'markdown') {
      const heading = rawLine.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/u)
      if (heading) {
        const depth = heading[1].length - 1
        tokens.push({ depth, text: unescapeOutlineText(heading[2]) })
        activeHeadingDepth = depth
        indentLevels = [0]
        continue
      }
    }

    const list = format === 'markdown'
      ? rawLine.match(/^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+(.*)$/u)
      : null
    const leading = list ? list[1] : (rawLine.match(/^[ \t]*/u)?.[0] || '')
    const content = list ? list[2] : rawLine.slice(leading.length)
    const column = indentationWidth(leading, tabSize)
    const relativeDepth = resolveIndentDepth(column, indentLevels)
    const baseDepth = format === 'markdown' && activeHeadingDepth !== null
      ? activeHeadingDepth + 1
      : 0
    tokens.push({ depth: baseDepth + relativeDepth, text: unescapeOutlineText(content) })
  }
  return tokens
}

function resolveIndentDepth(column, levels) {
  if (column <= 0) return 0
  const exact = levels.indexOf(column)
  if (exact >= 0) {
    levels.length = exact + 1
    return exact
  }

  while (levels.length > 1 && column < levels[levels.length - 1]) levels.pop()
  if (column > levels[levels.length - 1]) levels.push(column)
  return levels.length - 1
}

function indentationWidth(value, tabSize) {
  let column = 0
  for (const character of value) {
    if (character === '\t') column += tabSize - (column % tabSize)
    else column += 1
  }
  return column
}

function buildTree(tokens, makeId) {
  if (tokens.length === 0) return createImportedNode('', makeId(0))

  const root = createImportedNode(tokens[0].text, makeId(0))
  const stack = [root]
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    // Doc 只能有一個根；額外的零層項目視為根的直接子節點。
    const depth = Math.max(1, Math.min(Math.max(0, token.depth), stack.length))
    const node = createImportedNode(token.text, makeId(index))
    stack[depth - 1].children.push(node)
    stack[depth] = node
    stack.length = depth + 1
  }
  return root
}

function createImportedNode(text, id) {
  return {
    id,
    text: String(text ?? ''),
    children: [],
    collapsed: false,
    side: null,
    style: {},
    notes: null,
    link: null,
    icons: [],
    image: null
  }
}

function createIdProvider(factory, hash) {
  const used = new Set()
  return index => {
    const proposed = typeof factory === 'function' ? factory(index) : `node_${hash}_${index.toString(36)}`
    const base = typeof proposed === 'string' && proposed ? proposed : `node_${hash}_${index.toString(36)}`
    let id = base
    let suffix = 1
    while (used.has(id)) {
      id = `${base}_${suffix}`
      suffix += 1
    }
    used.add(id)
    return id
  }
}

function unescapeOutlineText(value) {
  const source = String(value ?? '')
  if (source === '\\0') return ''
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character !== '\\' || index === source.length - 1) {
      result += character
      continue
    }

    const next = source[index + 1]
    if (next === '\\') result += '\\'
    else if (next === 'n') result += '\n'
    else if (next === 'r') result += '\r'
    else if (next === 't') result += '\t'
    else if (next === 's') result += ' '
    else if (next === '0') result += '\0'
    else if (next === 'u' && /^[0-9a-f]{4}$/iu.test(source.slice(index + 2, index + 6))) {
      result += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16))
      index += 4
    } else {
      // 未知跳脫保持原字面，避免匯入一般文字時吞掉反斜線。
      result += `\\${next}`
    }
    index += 1
  }
  return result
}

function normalizeFormat(format, source) {
  if (format === 'txt' || format === 'text') return 'txt'
  if (format === 'md' || format === 'markdown') return 'markdown'
  return /^(?:[ \t]{0,3}#{1,6}[ \t]+|[ \t]*(?:[-+*]|\d+[.)])[ \t]+)/mu.test(source)
    ? 'markdown'
    : 'txt'
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function validDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback
}

// FNV-1a 32-bit 足以提供短而穩定的匯入 ID；索引再保證同文件內唯一。
function hashString(value) {
  let hash = 0x811c9dc5
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0)
    hash ^= codePoint
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

export const importDocumentMindflow = importDocumentJson
export const importDocumentText = importDocumentTxt
export const importFromJson = importDocumentJson
export const importFromJSON = importDocumentJson
export const importFromMindflow = importDocumentJson
export const importFromTxt = importDocumentTxt
export const importFromTXT = importDocumentTxt
export const importFromText = importDocumentTxt
export const importFromMarkdown = importDocumentMarkdown
export const importFromOutline = importOutline
