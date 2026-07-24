/**
 * 全域與局部佈局引擎；只依賴 Doc 與 measureFn，絕不讀寫 DOM 或修改輸入資料。
 */

export const HORIZONTAL_GAP = 48
export const VERTICAL_GAP = 42
export const SIBLING_GAP = 16
export const SUBTREE_GAP = 26
export const TREE_INDENT = 46

export const LAYOUT_DEFINITIONS = Object.freeze([
  { id: 'mindmap-both', name: '心智圖', group: 'mindmap' },
  { id: 'mindmap-right', name: '邏輯圖 · 向右', group: 'logic' },
  { id: 'mindmap-left', name: '邏輯圖 · 向左', group: 'logic' },
  { id: 'org', name: '組織圖', group: 'org' },
  { id: 'tree-right', name: '目錄樹', group: 'tree' },
  { id: 'timeline-h', name: '水平時間軸', group: 'timeline' },
  { id: 'timeline-v', name: '垂直時間軸', group: 'timeline' },
  { id: 'fishbone', name: '魚骨圖', group: 'fishbone' }
])

const LAYOUT_ALIASES = Object.freeze({
  mindmap: 'mindmap-both',
  'logic-right': 'mindmap-right',
  'logic-left': 'mindmap-left',
  tree: 'tree-right'
})

const SUPPORTED_LAYOUTS = new Set([
  ...LAYOUT_DEFINITIONS.map(item => item.id),
  'tree-left'
])

export function normalizeLayoutName(value, fallback = 'mindmap-both') {
  const candidate = LAYOUT_ALIASES[String(value || '')] || String(value || '')
  if (SUPPORTED_LAYOUTS.has(candidate)) return candidate
  const safeFallback = LAYOUT_ALIASES[String(fallback || '')] || String(fallback || '')
  return SUPPORTED_LAYOUTS.has(safeFallback) ? safeFallback : 'mindmap-both'
}

export function isLayoutName(value) {
  const candidate = LAYOUT_ALIASES[String(value || '')] || String(value || '')
  return SUPPORTED_LAYOUTS.has(candidate)
}

export function layout(doc, measureFn) {
  if (!doc?.root || typeof measureFn !== 'function') return new Map()

  const globalLayout = normalizeLayoutName(doc.layout)
  const meta = buildMeta(doc.root, 0, measureFn)
  const box = composeSubtree(meta, globalLayout)
  const root = box.positions.get(doc.root.id)
  if (!root) return new Map()

  // 根節點中心固定在世界座標原點，切換佈局時 viewport 不會無故漂移。
  const centered = translatePositions(box.positions, -root.x - root.w / 2, -root.y - root.h / 2)
  applyManualOffsets(centered, meta)
  return centered
}

function buildMeta(node, depth, measureFn) {
  const measured = measureFn(node, depth) || {}
  const w = finiteDimension(measured.w, 80, 360)
  const h = finiteDimension(measured.h, 32, 1000)
  return {
    node,
    depth,
    w,
    h,
    children: node.collapsed
      ? []
      : (Array.isArray(node.children) ? node.children : []).map(child => buildMeta(child, depth + 1, measureFn))
  }
}

function composeSubtree(meta, inheritedLayout) {
  const localLayout = normalizeStructure(meta.node.style?.structure, inheritedLayout)
  const positions = new Map([[
    meta.node.id,
    { x: 0, y: 0, w: meta.w, h: meta.h, depth: meta.depth, side: null, connector: null }
  ]])
  if (meta.children.length === 0) return makeBox(meta, positions)

  const children = meta.children.map(child => ({
    meta: child,
    box: composeSubtree(child, localLayout)
  }))

  if (localLayout === 'mindmap-both') arrangeBalanced(meta, positions, children)
  else if (localLayout === 'mindmap-left') arrangeHorizontal(meta, positions, children, -1, localLayout)
  else if (localLayout === 'org') arrangeOrg(meta, positions, children)
  else if (localLayout === 'tree-right' || localLayout === 'tree-left') arrangeTree(meta, positions, children, localLayout)
  else if (localLayout === 'timeline-h') arrangeTimelineHorizontal(meta, positions, children)
  else if (localLayout === 'timeline-v') arrangeTimelineVertical(meta, positions, children)
  else if (localLayout === 'fishbone') arrangeFishbone(meta, positions, children)
  else arrangeHorizontal(meta, positions, children, 1, 'mindmap-right')

  return makeBox(meta, positions)
}

function arrangeBalanced(meta, positions, children) {
  const groups = { left: [], right: [] }
  let leftHeight = 0
  let rightHeight = 0
  for (const child of children) {
    let side = child.meta.node.side
    if (side !== 'left' && side !== 'right') side = leftHeight <= rightHeight ? 'left' : 'right'
    groups[side].push(child)
    const height = child.box.bounds.height + (groups[side].length > 1 ? SUBTREE_GAP : 0)
    if (side === 'left') leftHeight += height
    else rightHeight += height
  }
  arrangeVerticalGroup(meta, positions, groups.left, -1, 'mindmap-both')
  arrangeVerticalGroup(meta, positions, groups.right, 1, 'mindmap-both')
}

function arrangeHorizontal(meta, positions, children, direction, connector) {
  arrangeVerticalGroup(meta, positions, children, direction, connector)
}

function arrangeVerticalGroup(meta, positions, children, direction, connector) {
  if (children.length === 0) return
  const gap = childrenGap(children)
  const totalHeight = children.reduce((sum, child) => sum + child.box.bounds.height, 0) + gap
  let cursorY = meta.h / 2 - totalHeight / 2

  children.forEach((child, index) => {
    const bounds = child.box.bounds
    const dx = direction > 0
      ? meta.w + HORIZONTAL_GAP - bounds.minX
      : -HORIZONTAL_GAP - bounds.maxX
    const dy = cursorY - bounds.minY
    mergeBox(positions, child.box, dx, dy, {
      rootId: child.meta.node.id,
      connector,
      side: direction > 0 ? 'right' : 'left'
    })
    cursorY += bounds.height + (index < children.length - 1 ? childGap(child, children[index + 1]) : 0)
  })
}

function arrangeOrg(meta, positions, children) {
  const totalWidth = children.reduce((sum, child) => sum + child.box.bounds.width, 0) + Math.max(0, children.length - 1) * SUBTREE_GAP
  let cursorX = meta.w / 2 - totalWidth / 2
  for (const child of children) {
    const bounds = child.box.bounds
    mergeBox(positions, child.box, cursorX - bounds.minX, meta.h + VERTICAL_GAP - bounds.minY, {
      rootId: child.meta.node.id,
      connector: 'org',
      side: 'down'
    })
    cursorX += bounds.width + SUBTREE_GAP
  }
}

function arrangeTree(meta, positions, children, layoutName) {
  const leftward = layoutName === 'tree-left'
  let cursorY = meta.h + SIBLING_GAP
  children.forEach((child, index) => {
    const bounds = child.box.bounds
    const dx = leftward ? -TREE_INDENT - bounds.maxX : TREE_INDENT - bounds.minX
    mergeBox(positions, child.box, dx, cursorY - bounds.minY, {
      rootId: child.meta.node.id,
      connector: layoutName,
      side: leftward ? 'left' : 'right'
    })
    cursorY += bounds.height + (index < children.length - 1 ? SIBLING_GAP : 0)
  })
}

function arrangeTimelineHorizontal(meta, positions, children) {
  let cursorX = meta.w + HORIZONTAL_GAP
  children.forEach((child, index) => {
    const bounds = child.box.bounds
    const above = index % 2 === 0
    const dx = cursorX - bounds.minX
    const dy = above ? -VERTICAL_GAP - bounds.maxY : meta.h + VERTICAL_GAP - bounds.minY
    mergeBox(positions, child.box, dx, dy, {
      rootId: child.meta.node.id,
      connector: 'timeline-h',
      side: above ? 'up' : 'down'
    })
    cursorX += bounds.width + HORIZONTAL_GAP
  })
}

function arrangeTimelineVertical(meta, positions, children) {
  let cursorY = meta.h + VERTICAL_GAP
  children.forEach((child, index) => {
    const bounds = child.box.bounds
    const leftward = index % 2 === 0
    const dx = leftward ? -HORIZONTAL_GAP - bounds.maxX : meta.w + HORIZONTAL_GAP - bounds.minX
    mergeBox(positions, child.box, dx, cursorY - bounds.minY, {
      rootId: child.meta.node.id,
      connector: 'timeline-v',
      side: leftward ? 'left' : 'right'
    })
    cursorY += bounds.height + VERTICAL_GAP
  })
}

function arrangeFishbone(meta, positions, children) {
  let cursorX = -HORIZONTAL_GAP
  children.forEach((child, index) => {
    const bounds = child.box.bounds
    const above = index % 2 === 0
    const dx = cursorX - bounds.maxX
    const dy = above ? -VERTICAL_GAP - bounds.maxY : meta.h + VERTICAL_GAP - bounds.minY
    mergeBox(positions, child.box, dx, dy, {
      rootId: child.meta.node.id,
      connector: 'fishbone',
      side: above ? 'up' : 'down'
    })
    cursorX -= bounds.width + HORIZONTAL_GAP
  })
}

function makeBox(meta, positions) {
  return { meta, positions, bounds: getLayoutBounds(positions) }
}

function mergeBox(target, box, dx, dy, rootOptions) {
  for (const [id, source] of box.positions) {
    const position = { ...source, x: source.x + dx, y: source.y + dy }
    if (id === rootOptions.rootId) {
      position.connector = rootOptions.connector
      position.side = rootOptions.side
    }
    target.set(id, position)
  }
}

function translatePositions(source, dx, dy) {
  return new Map(Array.from(source, ([id, position]) => [id, {
    ...position,
    x: position.x + dx,
    y: position.y + dy
  }]))
}

function normalizeStructure(value, inheritedLayout) {
  if (!value || value === 'inherit' || value === 'default') return normalizeLayoutName(inheritedLayout)
  return normalizeLayoutName(value, inheritedLayout)
}

function applyManualOffsets(positions, meta) {
  walkMeta(meta, current => {
    const position = positions.get(current.node.id)
    if (!position) return
    const style = current.node.style || {}
    const nested = style.manualOffset && typeof style.manualOffset === 'object' ? style.manualOffset : {}
    const offsetX = finiteOffset(style.offsetX ?? style.manualX ?? nested.x)
    const offsetY = finiteOffset(style.offsetY ?? style.manualY ?? nested.y)
    position.x += offsetX
    position.y += offsetY
  })
}

function walkMeta(meta, visitor) {
  visitor(meta)
  meta.children.forEach(child => walkMeta(child, visitor))
}

function childrenGap(children) {
  let total = 0
  for (let index = 1; index < children.length; index += 1) total += childGap(children[index - 1], children[index])
  return total
}

function childGap(previous, next) {
  return previous.meta.children.length > 0 || next.meta.children.length > 0 ? SUBTREE_GAP : SIBLING_GAP
}

function finiteDimension(value, fallback, max) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback
}

function finiteOffset(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function getLayoutBounds(positions) {
  if (!positions || positions.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
    maxX = Math.max(maxX, position.x + position.w)
    maxY = Math.max(maxY, position.y + position.h)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

export function createLayoutPreviewSvg(layoutName, { width = 144, height = 88 } = {}) {
  const sample = {
    root: {
      id: 'root', text: '', style: {}, children: Array.from({ length: 4 }, (_, index) => ({
        id: `branch-${index}`, text: '', side: index % 2 ? 'left' : 'right', style: {}, collapsed: false,
        children: index < 2 ? [{ id: `leaf-${index}`, text: '', style: {}, collapsed: false, children: [] }] : []
      })), collapsed: false
    },
    layout: layoutName
  }
  const positions = layout(sample, (_node, depth) => ({ w: depth === 0 ? 30 : 23, h: depth === 0 ? 15 : 11 }))
  const bounds = getLayoutBounds(positions)
  const scale = Math.min((width - 18) / Math.max(1, bounds.width), (height - 16) / Math.max(1, bounds.height), 1.4)
  const offsetX = (width - bounds.width * scale) / 2 - bounds.minX * scale
  const offsetY = (height - bounds.height * scale) / 2 - bounds.minY * scale
  const parentById = new Map()
  const collect = node => node.children.forEach(child => { parentById.set(child.id, node.id); collect(child) })
  collect(sample.root)
  const lines = Array.from(parentById, ([id, parentId]) => {
    const parent = positions.get(parentId)
    const child = positions.get(id)
    return `<path d="M ${format((parent.x + parent.w / 2) * scale + offsetX)} ${format((parent.y + parent.h / 2) * scale + offsetY)} L ${format((child.x + child.w / 2) * scale + offsetX)} ${format((child.y + child.h / 2) * scale + offsetY)}"/>`
  }).join('')
  const nodes = Array.from(positions, ([id, position]) => `<rect x="${format(position.x * scale + offsetX)}" y="${format(position.y * scale + offsetY)}" width="${format(position.w * scale)}" height="${format(position.h * scale)}" rx="${id === 'root' ? 5 : 3}" class="${id === 'root' ? 'root' : ''}"/>`).join('')
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${lines}</g><g fill="#fff" stroke="currentColor" stroke-width="1.3">${nodes}</g></svg>`
}

function format(value) {
  return Number(value.toFixed(2))
}
