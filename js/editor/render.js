/**
 * 將 model + layout 座標冪等渲染為 SVG 連線與 HTML 節點。
 */
import { countDescendants, walkNodes } from './model.js'
import { getNodeAppearance, getTheme } from './themes.js'
import { strings } from '../strings.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function createMeasureFn(measureLayer, doc) {
  const probe = document.createElement('div')
  const text = document.createElement('div')
  text.className = 'mind-node__text'
  probe.append(text)
  measureLayer.replaceChildren(probe)

  return (node, depth) => {
    const theme = getTheme(doc.themeId)
    const appearance = getNodeAppearance(node, depth, theme)
    probe.className = nodeClassName(depth)
    applyAppearance(probe, appearance, theme.branchPalette[0])
    probe.style.position = 'static'
    probe.style.width = 'max-content'
    probe.style.height = 'auto'
    probe.style.maxWidth = '250px'
    text.textContent = node.text || '\u200b'
    const rect = probe.getBoundingClientRect()
    return { w: Math.ceil(rect.width), h: Math.ceil(rect.height) }
  }
}

export function render(doc, positions, {
  svgLayer,
  nodesLayer,
  onToggleCollapse = () => {}
}) {
  const theme = getTheme(doc.themeId)
  const nodeLookup = new Map()
  const parentLookup = new Map()
  const branchLookup = buildBranchLookup(doc.root, theme.branchPalette)

  walkNodes(doc.root, (node, parent, depth) => {
    nodeLookup.set(node.id, { node, parent, depth })
    if (parent) parentLookup.set(node.id, parent.id)
  }, { includeHidden: false })

  const fragment = document.createDocumentFragment()
  for (const [id, position] of positions) {
    const record = nodeLookup.get(id)
    if (!record) continue
    fragment.append(createNodeElement(record.node, record.depth, position, theme, branchLookup.get(id), onToggleCollapse))
  }
  nodesLayer.replaceChildren(fragment)

  const paths = document.createDocumentFragment()
  for (const [childId, parentId] of parentLookup) {
    const parentPosition = positions.get(parentId)
    const childPosition = positions.get(childId)
    if (!parentPosition || !childPosition) continue
    const branchColor = branchLookup.get(childId) || theme.branchPalette[0]
    paths.append(createConnection(parentPosition, childPosition, branchColor, nodeLookup.get(childId).node))
  }
  svgLayer.replaceChildren(paths)

  return new Map(Array.from(nodesLayer.querySelectorAll('.mind-node'), element => [element.dataset.nodeId, element]))
}

function createNodeElement(node, depth, position, theme, branchColor, onToggleCollapse) {
  const element = document.createElement('div')
  element.className = nodeClassName(depth)
  element.dataset.nodeId = node.id
  element.dataset.depth = String(depth)
  element.dataset.side = position.side || ''
  element.style.left = `${position.x}px`
  element.style.top = `${position.y}px`
  element.style.width = `${position.w}px`
  element.style.height = `${position.h}px`
  applyAppearance(element, getNodeAppearance(node, depth, theme), branchColor)

  const text = document.createElement('div')
  text.className = 'mind-node__text'
  text.textContent = node.text || '\u200b'
  element.append(text)

  if (node.children.length > 0) {
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
  element.style.setProperty('--branch-color', branchColor || appearance.lineColor)
  element.style.padding = `${Number(appearance.paddingY) || 0}px ${Number(appearance.paddingX) || 0}px`
  element.style.background = appearance.fill
  element.style.color = appearance.textColor
  element.style.borderColor = appearance.borderColor
  element.style.borderWidth = `${Number(appearance.borderWidth) || 0}px`
  element.style.borderStyle = appearance.borderStyle || 'solid'
  element.style.fontSize = `${Number(appearance.fontSize) || 13}px`
  element.style.fontFamily = appearance.fontFamily
  element.style.fontWeight = appearance.bold ? '700' : '400'
  element.style.fontStyle = appearance.italic ? 'italic' : 'normal'
  element.style.textDecoration = [appearance.underline && 'underline', appearance.strike && 'line-through'].filter(Boolean).join(' ')
  element.style.borderRadius = shape === 'pill' ? '999px' : shape === 'ellipse' ? '50%' : shape === 'rounded' ? '8px' : '0'
}

function createConnection(parent, child, defaultColor, childNode) {
  const goesRight = child.x >= parent.x
  const startX = goesRight ? parent.x + parent.w : parent.x
  const endX = goesRight ? child.x : child.x + child.w
  const startY = parent.y + parent.h / 2
  const endY = child.y + child.h / 2
  const controlOffset = Math.max(20, Math.abs(endX - startX) * 0.5)
  const cp1X = goesRight ? startX + controlOffset : startX - controlOffset
  const cp2X = goesRight ? endX - controlOffset : endX + controlOffset

  const path = document.createElementNS(SVG_NS, 'path')
  path.classList.add('connection-path')
  path.setAttribute('d', `M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}`)
  path.setAttribute('stroke', childNode.style.lineColor || defaultColor)
  path.setAttribute('stroke-width', String(childNode.style.lineWidth || 2))
  if ((childNode.style.lineStyle || 'solid') === 'dashed') path.setAttribute('stroke-dasharray', '7 5')
  if (childNode.style.lineStyle === 'dotted') path.setAttribute('stroke-dasharray', '2 5')
  return path
}

function buildBranchLookup(root, palette) {
  const lookup = new Map([[root.id, palette[0]]])
  root.children.forEach((branch, index) => {
    const color = palette[index % palette.length]
    walkNodes(branch, node => lookup.set(node.id, color))
  })
  return lookup
}
