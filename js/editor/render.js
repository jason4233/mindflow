/**
 * 將 model + layout 座標冪等渲染為 SVG 連線、HTML 節點與可擴充 overlay。
 */
import { countDescendants, walkNodes } from './model.js'
import { getLineAppearance, getNodeAppearance, getTheme } from './themes.js'
import { strings } from '../strings.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const overlays = new Set()

export function registerOverlay(drawFn) {
  if (typeof drawFn !== 'function') throw new TypeError('Overlay 必須是函式')
  overlays.add(drawFn)
  return () => overlays.delete(drawFn)
}

export function createMeasureFn(measureLayer, doc) {
  const probe = document.createElement('div')
  const text = document.createElement('div')
  text.className = 'mind-node__text'
  probe.append(text)
  measureLayer.replaceChildren(probe)

  return (node, depth) => {
    const activeTheme = getTheme(doc.themeId)
    const appearance = getNodeAppearance(node, depth, activeTheme)
    probe.className = nodeClassName(depth)
    applyAppearance(probe, appearance, activeTheme.branchPalette[0])
    probe.style.position = 'static'
    probe.style.width = 'max-content'
    probe.style.height = 'auto'
    probe.style.maxWidth = '250px'
    setTextContent(text, node.text, appearance.richText)
    const rect = probe.getBoundingClientRect()
    let width = Math.ceil(rect.width)
    let height = Math.ceil(rect.height)
    if (appearance.shape === 'circle') width = height = Math.max(width, height, 48)
    if (appearance.shape === 'ellipse') width = Math.max(width, height * 1.65)
    if (appearance.shape === 'diamond') {
      width = Math.max(width + 28, height * 1.7)
      height += 18
    }
    return { w: width, h: height }
  }
}

export function render(doc, positions, {
  svgLayer,
  nodesLayer,
  onToggleCollapse = () => {}
}) {
  const activeTheme = getTheme(doc.themeId)
  applyDocumentSpacing(positions, doc.root.id, doc.canvas)
  const previousPositions = readRenderedPositions(nodesLayer)
  const nodeLookup = new Map()
  const parentLookup = new Map()
  const branchLookup = buildBranchLookup(doc.root, activeTheme)

  walkNodes(doc.root, (node, parent, depth) => {
    nodeLookup.set(node.id, { node, parent, depth })
    if (parent) parentLookup.set(node.id, parent.id)
  }, { includeHidden: false })

  const fragment = document.createDocumentFragment()
  const movingNodes = []
  for (const [id, position] of positions) {
    const record = nodeLookup.get(id)
    if (!record) continue
    const element = createNodeElement(record.node, record.depth, position, activeTheme, branchLookup.get(id), onToggleCollapse)
    const previous = previousPositions.get(id)
    if (previous && (Math.abs(previous.x - position.x) > 0.5 || Math.abs(previous.y - position.y) > 0.5)) {
      element.style.left = `${previous.x}px`
      element.style.top = `${previous.y}px`
      element.classList.add('is-layout-moving')
      movingNodes.push({ element, position })
    }
    fragment.append(element)
  }
  nodesLayer.replaceChildren(fragment)

  const paths = document.createDocumentFragment()
  for (const [childId, parentId] of parentLookup) {
    const parentPosition = positions.get(parentId)
    const childPosition = positions.get(childId)
    const record = nodeLookup.get(childId)
    if (!parentPosition || !childPosition || !record) continue
    const branchColor = branchLookup.get(childId) || activeTheme.branchPalette[0]
    paths.append(createConnection(
      parentPosition,
      childPosition,
      getLineAppearance(record.node, record.depth, activeTheme, branchColor),
      childPosition.connector || doc.layout
    ))
  }
  svgLayer.replaceChildren(paths)
  animateLayoutChange(nodesLayer, svgLayer, movingNodes)

  const canvas = nodesLayer.closest('.canvas')
  if (canvas) canvas.style.background = doc.canvas?.background || activeTheme.canvasBg
  const context = { doc, positions, svgLayer, nodesLayer, canvas, theme: activeTheme, nodeLookup, branchLookup }
  for (const draw of overlays) {
    try {
      draw(context)
    } catch (error) {
      console.error('MindFlow overlay 渲染失敗', error)
    }
  }

}

function createNodeElement(node, depth, position, activeTheme, branchColor, onToggleCollapse) {
  const element = document.createElement('div')
  const appearance = getNodeAppearance(node, depth, activeTheme)
  element.className = nodeClassName(depth)
  element.dataset.nodeId = node.id
  element.dataset.depth = String(depth)
  element.dataset.side = position.side || ''
  element.style.left = `${position.x}px`
  element.style.top = `${position.y}px`
  element.style.width = `${position.w}px`
  element.style.height = `${position.h}px`
  applyAppearance(element, appearance, branchColor)

  const text = document.createElement('div')
  text.className = 'mind-node__text'
  setTextContent(text, node.text, appearance.richText)
  element.append(text)

  // 根節點永遠不顯示摺疊鈕；Ctrl+/ 仍可透過 action 切換其他層級。
  if (depth > 0 && node.children.length > 0) {
    const control = document.createElement('button')
    control.type = 'button'
    control.className = `collapse-control${node.collapsed ? ' is-collapsed' : ''}`
    control.dataset.collapseControl = 'true'
    control.textContent = node.collapsed ? `+${countDescendants(node)}` : '−'
    control.setAttribute('aria-label', node.collapsed ? strings.editor.expand : strings.editor.collapse)
    control.addEventListener('pointerdown', event => event.stopPropagation())
    control.addEventListener('click', event => {
      event.stopPropagation()
      onToggleCollapse(node.id)
    })
    element.append(control)
  }

  return element
}

function nodeClassName(depth) {
  const levelClass = depth === 0 ? 'mind-node--root' : depth === 1 ? 'mind-node--branch' : 'mind-node--leaf'
  return `mind-node ${levelClass}`
}

function applyAppearance(element, appearance, branchColor) {
  const shape = appearance.shape
  element.dataset.shape = shape
  element.style.setProperty('--branch-color', branchColor || appearance.lineColor)
  element.style.padding = `${Number(appearance.paddingY) || 0}px ${Number(appearance.paddingX) || 0}px`
  element.style.background = appearance.fill
  element.style.color = appearance.textColor
  element.style.borderColor = appearance.borderColor
  element.style.borderWidth = `${Number(appearance.borderWidth) || 0}px`
  element.style.borderStyle = cssBorderStyle(appearance.borderStyle)
  element.style.fontSize = `${Number(appearance.fontSize) || 13}px`
  element.style.fontFamily = appearance.fontFamily
  element.style.fontWeight = appearance.bold ? '700' : '400'
  element.style.fontStyle = appearance.italic ? 'italic' : 'normal'
  element.style.textDecoration = [appearance.underline && 'underline', appearance.strike && 'line-through'].filter(Boolean).join(' ')
  element.style.textAlign = appearance.textAlign
  element.style.lineHeight = String(appearance.lineHeight)
  const shapeRadius = ({ rounded: 4, 'rounded-large': 10, 'soft-rect': 16 })[shape]
  element.style.borderRadius = shape.includes('pill') ? '999px' : ['circle', 'ellipse'].includes(shape) ? '50%' : `${appearance.hasCustomRadius ? Math.max(0, Number(appearance.radius) || 0) : (shapeRadius ?? Math.max(0, Number(appearance.radius) || 0))}px`
  element.style.clipPath = shape === 'diamond'
    ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'
    : shape === 'parallelogram'
      ? 'polygon(12% 0, 100% 0, 88% 100%, 0 100%)'
      : ''
  if (shape === 'underline') {
    element.style.background = 'transparent'
    element.style.borderWidth = '0 0 2px'
    element.style.borderColor = branchColor || appearance.borderColor || appearance.lineColor
  }
}

function createConnection(parent, child, appearance, layoutName) {
  const pathData = getConnectionPath(parent, child, appearance.shape, layoutName)

  const path = document.createElementNS(SVG_NS, 'path')
  path.classList.add('connection-path')
  path.setAttribute('d', pathData)
  path.setAttribute('stroke', appearance.color)
  path.setAttribute('stroke-width', String(appearance.width))
  const dash = strokeDasharray(appearance.style)
  if (dash) path.setAttribute('stroke-dasharray', dash)
  return path
}

export function getConnectionPath(parent, child, appearanceShape = 'curved', layoutName = '') {
  if (layoutName === 'org') {
    const startX = parent.x + parent.w / 2
    const startY = parent.y + parent.h
    const endX = child.x + child.w / 2
    const endY = child.y
    const middleY = (startY + endY) / 2
    return `M ${startX} ${startY} L ${startX} ${middleY} L ${endX} ${middleY} L ${endX} ${endY}`
  }

  if (layoutName === 'tree-right' || layoutName === 'tree-left' || layoutName === 'tree') {
    const leftward = layoutName === 'tree-left'
    const startX = leftward ? parent.x + parent.w - 12 : parent.x + 12
    const startY = parent.y + parent.h
    const endX = leftward ? child.x + child.w : child.x
    const endY = child.y + child.h / 2
    return `M ${startX} ${startY} L ${startX} ${endY} L ${endX} ${endY}`
  }

  if (layoutName === 'fishbone') {
    const startX = child.x < parent.x ? parent.x : parent.x + parent.w
    const startY = parent.y + parent.h / 2
    const endX = child.x < parent.x ? child.x + child.w : child.x
    const endY = child.y + child.h / 2
    const tailX = endX + (startX > endX ? 12 : -12)
    return `M ${startX} ${startY} L ${tailX} ${endY} L ${endX} ${endY}`
  }

  if (layoutName === 'timeline-h') {
    const startX = parent.x + parent.w
    const startY = parent.y + parent.h / 2
    const endX = child.x + child.w / 2
    const endY = child.y < parent.y ? child.y + child.h : child.y
    return `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`
  }

  if (layoutName === 'timeline-v') {
    const startX = parent.x + parent.w / 2
    const startY = parent.y + parent.h
    const endX = child.x < parent.x ? child.x + child.w : child.x
    const endY = child.y + child.h / 2
    return `M ${startX} ${startY} L ${startX} ${endY} L ${endX} ${endY}`
  }

  const goesRight = child.x >= parent.x
  const startX = goesRight ? parent.x + parent.w : parent.x
  const endX = goesRight ? child.x : child.x + child.w
  const startY = parent.y + parent.h / 2
  const endY = child.y + child.h / 2
  const middleX = (startX + endX) / 2
  let pathData
  if (appearanceShape === 'straight') {
    pathData = `M ${startX} ${startY} L ${endX} ${endY}`
  } else if (appearanceShape === 'orthogonal') {
    pathData = `M ${startX} ${startY} L ${middleX} ${startY} L ${middleX} ${endY} L ${endX} ${endY}`
  } else {
    const controlOffset = Math.max(20, Math.abs(endX - startX) * 0.5)
    const cp1X = goesRight ? startX + controlOffset : startX - controlOffset
    const cp2X = goesRight ? endX - controlOffset : endX + controlOffset
    pathData = `M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}`
  }

  return pathData
}

function buildBranchLookup(root, activeTheme) {
  const palette = activeTheme.branchPalette
  const lookup = new Map([[root.id, palette[0]]])
  root.children.forEach((branch, index) => {
    const color = activeTheme.rainbow ? palette[index % palette.length] : palette[0]
    walkNodes(branch, node => lookup.set(node.id, color))
  })
  return lookup
}

function applyDocumentSpacing(positions, rootId, canvas) {
  const root = positions.get(rootId)
  if (!root) return
  const horizontalScale = Math.max(0.72, Math.min(2.4, 1 + ((Number(canvas?.spacingH) || 30) - 30) / 50))
  const verticalScale = Math.max(0.72, Math.min(2.4, 1 + ((Number(canvas?.spacingV) || 30) - 30) / 50))
  if (horizontalScale === 1 && verticalScale === 1) return
  const rootCenterX = root.x + root.w / 2
  const rootCenterY = root.y + root.h / 2
  for (const [id, position] of positions) {
    if (id === rootId) continue
    const centerX = position.x + position.w / 2
    const centerY = position.y + position.h / 2
    position.x = rootCenterX + (centerX - rootCenterX) * horizontalScale - position.w / 2
    position.y = rootCenterY + (centerY - rootCenterY) * verticalScale - position.h / 2
  }
}

function readRenderedPositions(nodesLayer) {
  const result = new Map()
  for (const element of nodesLayer.querySelectorAll('.mind-node')) {
    const x = Number.parseFloat(element.style.left)
    const y = Number.parseFloat(element.style.top)
    if (Number.isFinite(x) && Number.isFinite(y)) result.set(element.dataset.nodeId, { x, y })
  }
  return result
}

// 佈局過渡的收尾計時器：連續重繪時要先清掉舊的，否則過期計時器會提早拔掉新一輪過渡的 class
let layoutTransitionTimer = null

function animateLayoutChange(nodesLayer, svgLayer, movingNodes) {
  if (movingNodes.length === 0 || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  // 先把新節點放回舊座標，再由 CSS left/top transition 移到演算法新座標。
  void nodesLayer.offsetWidth
  svgLayer.classList.add('is-layout-transitioning')
  requestAnimationFrame(() => {
    for (const { element, position } of movingNodes) {
      element.style.left = `${position.x}px`
      element.style.top = `${position.y}px`
    }
  })
  window.clearTimeout(layoutTransitionTimer)
  layoutTransitionTimer = window.setTimeout(() => {
    layoutTransitionTimer = null
    movingNodes.forEach(({ element }) => element.classList.remove('is-layout-moving'))
    svgLayer.classList.remove('is-layout-transitioning')
  }, 320)
}

function setTextContent(element, plainText, richText) {
  if (!richText) {
    element.textContent = plainText || '\u200b'
    return
  }
  const template = document.createElement('template')
  template.innerHTML = richText
  sanitizeRichTree(template.content)
  element.replaceChildren(template.content.cloneNode(true))
  if (!element.textContent) element.textContent = plainText || '\u200b'
}

function sanitizeRichTree(root) {
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'BR', 'DIV'])
  const allowedStyles = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration'])
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes)
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name !== 'style') element.removeAttribute(attribute.name)
    }
    if (element.hasAttribute('style')) {
      const kept = []
      for (const property of allowedStyles) {
        const value = element.style.getPropertyValue(property)
        if (value && !/url\s*\(|expression\s*\(/i.test(value)) kept.push(`${property}:${value}`)
      }
      if (kept.length > 0) element.setAttribute('style', kept.join(';'))
      else element.removeAttribute('style')
    }
  }
}

function cssBorderStyle(value) {
  return ({ dotted: 'dotted', dashed: 'dashed', 'dash-dot': 'dashed', 'long-dash': 'dashed' })[value] || 'solid'
}

function strokeDasharray(value) {
  return ({ dotted: '2 5', dashed: '7 5', 'dash-dot': '10 4 2 4', 'long-dash': '14 6 3 6' })[value] || ''
}

function drawWatermark({ doc, canvas, theme }) {
  if (!canvas) return
  let layer = canvas.querySelector(':scope > .canvas-watermark')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'canvas-watermark'
    canvas.prepend(layer)
  }
  const watermark = doc.canvas?.watermark
  layer.hidden = !watermark?.enabled
  if (layer.hidden) return
  const angle = watermark.rotation === 'right' ? 24 : watermark.rotation === 'horizontal' ? 0 : -24
  const opacity = Math.max(0, Math.min(1, watermark.opacity / 100))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150" viewBox="0 0 260 150"><text x="130" y="75" dominant-baseline="middle" text-anchor="middle" transform="rotate(${angle} 130 75)" font-family="Segoe UI, sans-serif" font-size="${watermark.size}" font-weight="600" fill="${escapeXml(watermark.color)}" fill-opacity="${opacity}">${escapeXml(watermark.text)}</text></svg>`
  layer.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

registerOverlay(drawWatermark)
