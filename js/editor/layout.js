/**
 * mindmap-right / mindmap-both 佈局引擎；輸入相同便產生相同座標，不存取 DOM。
 */

export const HORIZONTAL_GAP = 40
export const SIBLING_GAP = 12
export const SUBTREE_GAP = 24

export function layout(doc, measureFn) {
  if (!doc?.root || typeof measureFn !== 'function') return new Map()

  const rootMeta = buildMeta(doc.root, 0, measureFn)
  const rootPosition = {
    x: -rootMeta.w / 2,
    y: -rootMeta.h / 2,
    w: rootMeta.w,
    h: rootMeta.h,
    depth: 0,
    side: null
  }
  const positions = new Map([[doc.root.id, rootPosition]])
  if (doc.root.collapsed) return positions

  if (doc.layout === 'mindmap-both') {
    const groups = splitBalancedSides(rootMeta.children)
    placeGroup(groups.left, rootPosition, -1, positions)
    placeGroup(groups.right, rootPosition, 1, positions)
  } else {
    // Phase A 僅規定 right 與 both；其他 schema layout 暫以 right 安全降級。
    placeGroup(rootMeta.children, rootPosition, 1, positions)
  }

  return positions
}

function buildMeta(node, depth, measureFn) {
  const measured = measureFn(node, depth) || {}
  const w = finiteDimension(measured.w, 80, 250)
  const h = finiteDimension(measured.h, 32, 1000)
  const children = node.collapsed
    ? []
    : node.children.map(child => buildMeta(child, depth + 1, measureFn))
  const childrenHeight = groupHeight(children)

  return {
    node,
    depth,
    w,
    h,
    children,
    subtreeHeight: Math.max(h, childrenHeight)
  }
}

function finiteDimension(value, fallback, max) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback
}

function gapBetween(previous, next) {
  return previous.children.length > 0 || next.children.length > 0 ? SUBTREE_GAP : SIBLING_GAP
}

function groupHeight(items) {
  if (items.length === 0) return 0
  let total = items.reduce((sum, item) => sum + item.subtreeHeight, 0)
  for (let index = 1; index < items.length; index += 1) {
    total += gapBetween(items[index - 1], items[index])
  }
  return total
}

function splitBalancedSides(children) {
  const result = { left: [], right: [] }
  let leftHeight = 0
  let rightHeight = 0

  for (const child of children) {
    let side = child.node.side
    if (side !== 'left' && side !== 'right') side = leftHeight <= rightHeight ? 'left' : 'right'
    result[side].push(child)
    const added = child.subtreeHeight + (result[side].length > 1 ? SUBTREE_GAP : 0)
    if (side === 'left') leftHeight += added
    else rightHeight += added
  }
  return result
}

function placeGroup(items, parentPosition, direction, positions) {
  if (items.length === 0) return
  const parentCenterY = parentPosition.y + parentPosition.h / 2
  let cursorY = parentCenterY - groupHeight(items) / 2

  items.forEach((item, index) => {
    const centerY = cursorY + item.subtreeHeight / 2
    placeSubtree(item, parentPosition, direction, centerY, positions)
    cursorY += item.subtreeHeight
    if (index < items.length - 1) cursorY += gapBetween(item, items[index + 1])
  })
}

function placeSubtree(meta, parentPosition, direction, centerY, positions) {
  const x = direction > 0
    ? parentPosition.x + parentPosition.w + HORIZONTAL_GAP
    : parentPosition.x - HORIZONTAL_GAP - meta.w
  const position = {
    x,
    y: centerY - meta.h / 2,
    w: meta.w,
    h: meta.h,
    depth: meta.depth,
    side: direction > 0 ? 'right' : 'left'
  }
  positions.set(meta.node.id, position)
  placeGroup(meta.children, position, direction, positions)
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
