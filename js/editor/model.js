/**
 * v1 文件資料模型、正規化與樹狀結構查詢；本模組不接觸 DOM。
 */
import { strings } from '../strings.js'

export const LAYOUTS = Object.freeze([
  'mindmap-right',
  'mindmap-left',
  'mindmap-both',
  'org',
  'tree-left',
  'tree-right',
  'timeline-h',
  'fishbone'
])

export const NODE_STYLE_KEYS = Object.freeze([
  'fill', 'textColor', 'borderColor', 'borderWidth', 'borderStyle',
  'fontSize', 'fontFamily', 'bold', 'italic', 'underline', 'strike', 'shape',
  'lineColor', 'lineWidth', 'lineStyle'
])

export function createId(prefix = 'id') {
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(9)), byte => byte.toString(36).padStart(2, '0')).join('')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}_${random.slice(0, 16)}`
}

export function createNode(text = '', overrides = {}) {
  const node = {
    id: overrides.id || createId('node'),
    text: String(text),
    children: [],
    collapsed: false,
    side: null,
    style: {},
    notes: null,
    link: null,
    icons: [],
    image: null
  }

  return normalizeNode({ ...node, ...overrides })
}

export function createDefaultDoc(overrides = {}) {
  const now = new Date().toISOString()
  const root = createNode(strings.editor.centerTopic, {
    children: [
      createNode(strings.editor.branchTopic, { side: 'right' }),
      createNode(strings.editor.branchTopic, { side: 'left' }),
      createNode(strings.editor.branchTopic, { side: 'right' }),
      createNode(strings.editor.branchTopic, { side: 'left' })
    ]
  })

  return normalizeDoc({
    id: createId('doc'),
    title: strings.dashboard.untitled,
    createdAt: now,
    updatedAt: now,
    root,
    layout: 'mindmap-both',
    themeId: 'classic-blue',
    relations: [],
    summaries: [],
    canvas: { background: '#f5f5f5', watermark: false },
    ...overrides
  })
}

export function normalizeNode(input = {}, seenIds = new Set()) {
  let id = typeof input.id === 'string' && input.id ? input.id : createId('node')
  // 匯入損壞資料時重建重複 ID，否則 command 無法精確定位節點。
  if (seenIds.has(id)) id = createId('node')
  seenIds.add(id)

  const style = {}
  for (const key of NODE_STYLE_KEYS) {
    if (input.style && input.style[key] !== undefined) style[key] = input.style[key]
  }

  const side = input.side === 'left' || input.side === 'right' ? input.side : null
  return {
    id,
    text: typeof input.text === 'string' ? input.text : '',
    children: Array.isArray(input.children)
      ? input.children.map(child => normalizeNode(child, seenIds))
      : [],
    collapsed: Boolean(input.collapsed),
    side,
    style,
    notes: typeof input.notes === 'string' ? input.notes : null,
    link: typeof input.link === 'string' ? input.link : null,
    icons: Array.isArray(input.icons) ? input.icons.filter(icon => typeof icon === 'string') : [],
    image: normalizeImage(input.image)
  }
}

function normalizeImage(image) {
  if (!image || typeof image.src !== 'string') return null
  return {
    src: image.src,
    w: Number.isFinite(Number(image.w)) ? Number(image.w) : 0,
    h: Number.isFinite(Number(image.h)) ? Number(image.h) : 0
  }
}

export function normalizeDoc(input = {}) {
  const now = new Date().toISOString()
  const layout = LAYOUTS.includes(input.layout) ? input.layout : 'mindmap-both'
  const canvas = input.canvas && typeof input.canvas === 'object' ? input.canvas : {}
  const seenIds = new Set()

  return {
    id: typeof input.id === 'string' && input.id ? input.id : createId('doc'),
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : strings.dashboard.untitled,
    createdAt: validDateString(input.createdAt) ? input.createdAt : now,
    updatedAt: validDateString(input.updatedAt) ? input.updatedAt : now,
    root: normalizeNode(input.root || createNode('中心主題'), seenIds),
    layout,
    themeId: typeof input.themeId === 'string' && input.themeId ? input.themeId : 'classic-blue',
    relations: Array.isArray(input.relations) ? structuredCloneSafe(input.relations) : [],
    summaries: Array.isArray(input.summaries) ? structuredCloneSafe(input.summaries) : [],
    canvas: {
      background: typeof canvas.background === 'string' ? canvas.background : '#f5f5f5',
      watermark: Boolean(canvas.watermark)
    }
  }
}

function validDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function serializeDoc(doc) {
  return JSON.stringify(normalizeDoc(doc))
}

export function deserializeDoc(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json
  return normalizeDoc(raw)
}

export function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

export function walkNodes(root, visitor, options = {}) {
  const includeHidden = options.includeHidden !== false
  const visit = (node, parent, depth, index) => {
    visitor(node, parent, depth, index)
    if (!includeHidden && node.collapsed) return
    node.children.forEach((child, childIndex) => visit(child, node, depth + 1, childIndex))
  }
  visit(root, null, 0, 0)
}

export function findNode(root, id) {
  let found = null
  walkNodes(root, node => {
    if (!found && node.id === id) found = node
  })
  return found
}

export function findNodeContext(root, id) {
  let found = null
  walkNodes(root, (node, parent, depth, index) => {
    if (!found && node.id === id) found = { node, parent, depth, index }
  })
  return found
}

export function isDescendant(root, ancestorId, candidateId) {
  const ancestor = findNode(root, ancestorId)
  return ancestor ? Boolean(findNode(ancestor, candidateId)) && ancestorId !== candidateId : false
}

export function countDescendants(node) {
  let count = -1
  walkNodes(node, () => { count += 1 })
  return count
}

export function visibleNodeIds(root) {
  const ids = []
  walkNodes(root, node => ids.push(node.id), { includeHidden: false })
  return ids
}

export function getTopLevelIds(root, ids) {
  const wanted = new Set(ids)
  const result = []
  const visit = (node, ancestorWanted) => {
    const selected = wanted.has(node.id)
    if (selected && !ancestorWanted) result.push(node.id)
    node.children.forEach(child => visit(child, ancestorWanted || selected))
  }
  visit(root, false)
  return result
}

export function cloneSubtreeWithFreshIds(node) {
  const clone = structuredCloneSafe(node)
  walkNodes(clone, current => {
    current.id = createId('node')
  })
  return normalizeNode(clone)
}

// Command 新增根層分支時用可見子樹高度近似值做左右平衡，避免只比較分支數。
export function estimateVisibleSubtreeHeight(node) {
  const ownHeight = 38
  if (node.collapsed || node.children.length === 0) return ownHeight
  const heights = node.children.map(estimateVisibleSubtreeHeight)
  return Math.max(ownHeight, heights.reduce((sum, height) => sum + height, 0) + (heights.length - 1) * 18)
}

export function chooseBalancedSide(root) {
  const totals = { left: 0, right: 0 }
  for (const child of root.children) {
    const side = child.side === 'left' ? 'left' : 'right'
    totals[side] += estimateVisibleSubtreeHeight(child)
  }
  return totals.left <= totals.right ? 'left' : 'right'
}
