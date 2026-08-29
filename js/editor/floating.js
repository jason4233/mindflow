/**
 * 懸浮節點持久化、自由拖放/掛回樹，以及單次格式刷互動。
 */
import { registerAction } from './actions.js'
import { moveNode, setStyle } from './commands.js'
import { createId, createNode, findNode, findNodeContext, structuredCloneSafe } from './model.js'
import { registerOverlay } from './render.js'

const FLOATING_PREFIX = '__floating__:'

export function getFloatingMeta(node) {
  const token = node?.icons?.find(icon => icon.startsWith(FLOATING_PREFIX))
  if (!token) return null
  const [rawX, rawY] = token.slice(FLOATING_PREFIX.length).split(',')
  const x = Number(rawX)
  const y = Number(rawY)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0
  }
}

export function stripFloatingMeta(node) {
  if (!node || typeof node !== 'object') return node
  node.icons = Array.isArray(node.icons)
    ? node.icons.filter(icon => !String(icon).startsWith(FLOATING_PREFIX))
    : []
  for (const child of node.children || []) stripFloatingMeta(child)
  return node
}

export function sanitizeFloatingClone(node, { asRootChild = false, offset = { x: 32, y: 24 } } = {}) {
  const meta = getFloatingMeta(node)
  stripFloatingMeta(node)
  // 只有 root 直屬節點能保留懸浮語意；複製時位移，避免 Ctrl+D 完全重疊。
  if (asRootChild && meta) {
    node.icons.push(floatingToken({
      x: meta.x + finite(offset?.x, 32),
      y: meta.y + finite(offset?.y, 24)
    }))
  }
  return node
}

export function createFloatingNodeCommand(doc, point, overrides = {}) {
  const node = createNode(overrides.text ?? '懸浮主題', {
    id: overrides.id || createId('node'),
    style: { ...(overrides.style || {}), shape: overrides.style?.shape || 'rounded-large' },
    icons: [...(overrides.icons || []), floatingToken(point)]
  })
  let index = null
  return {
    description: '新增懸浮節點',
    node,
    nodeId: node.id,
    do: () => {
      if (findNode(doc.root, node.id)) return false
      if (index === null) index = doc.root.children.length
      doc.root.children.splice(Math.min(index, doc.root.children.length), 0, node)
      return true
    },
    undo: () => {
      const current = findNodeContext(doc.root, node.id)
      if (current?.parent) current.parent.children.splice(current.index, 1)
    }
  }
}

export function updateFloatingPositionCommand(doc, nodeId, point) {
  let previous = null
  return {
    description: '移動懸浮節點',
    do: () => {
      const node = findNode(doc.root, nodeId)
      if (!node || !getFloatingMeta(node)) return false
      if (previous === null) previous = structuredCloneSafe(node.icons)
      const next = [...node.icons.filter(icon => !icon.startsWith(FLOATING_PREFIX)), floatingToken(point)]
      if (JSON.stringify(next) === JSON.stringify(node.icons)) return false
      node.icons = next
      return true
    },
    undo: () => {
      const node = findNode(doc.root, nodeId)
      if (node && previous !== null) node.icons = structuredCloneSafe(previous)
    }
  }
}

export function attachFloatingNodeCommand(doc, nodeId, parentId, index) {
  const delegate = moveNode(doc, nodeId, parentId, index)
  let previousIcons = null
  return {
    description: '將懸浮節點掛回樹',
    do: () => {
      const node = findNode(doc.root, nodeId)
      if (!node || !getFloatingMeta(node)) return false
      if (previousIcons === null) previousIcons = structuredCloneSafe(node.icons)
      if (delegate.do() === false) return false
      const current = findNode(doc.root, nodeId)
      current.icons = current.icons.filter(icon => !icon.startsWith(FLOATING_PREFIX))
      return true
    },
    undo: () => {
      delegate.undo()
      const node = findNode(doc.root, nodeId)
      if (node && previousIcons !== null) node.icons = structuredCloneSafe(previousIcons)
    }
  }
}

export function initializeFloatingFeatures(ctx) {
  registerOverlay(overlayCtx => drawFloatingNodes(overlayCtx, ctx))

  ctx.elements.canvas.addEventListener('dblclick', event => createFloatingNodeFromCanvasDoubleClick(event, ctx))

  registerAction('floatingNode', sourceEvent => {
    let point
    if (sourceEvent && Number.isFinite(sourceEvent.clientX) && Number.isFinite(sourceEvent.clientY) && sourceEvent.type === 'contextmenu') {
      point = ctx.viewport.screenToWorld(sourceEvent.clientX, sourceEvent.clientY)
    } else {
      const rect = ctx.elements.canvas.getBoundingClientRect()
      point = ctx.viewport.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
    const command = createFloatingNodeCommand(ctx.doc, point)
    if (!ctx.manager.execute(command)) return false
    ctx.selection.set([command.nodeId])
    return true
  })

  registerAction('formatPainter', () => {
    const source = findNode(ctx.doc.root, ctx.selection.primaryId)
    if (!source) { ctx.notify('請先選取格式來源節點'); return false }
    ctx.featureState.formatPainter = { sourceId: source.id, style: structuredCloneSafe(source.style) }
    ctx.elements.canvas.classList.add('is-format-painting')
    document.querySelector('#format-painter-button')?.classList.add('is-active')
    ctx.notify('格式刷已啟用，請點選一個目標節點')
    return true
  })

  ctx.elements.nodesLayer.addEventListener('click', event => {
    const painter = ctx.featureState.formatPainter
    const element = event.target.closest('.mind-node')
    if (!painter || !element) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const targetId = element.dataset.nodeId
    clearPainter(ctx)
    if (targetId === painter.sourceId) { ctx.notify('格式刷已取消'); return }
    if (ctx.manager.execute(setStyle(ctx.doc, [targetId], painter.style))) {
      ctx.selection.set([targetId])
      ctx.notify('格式已套用')
    }
  }, { capture: true })

  ctx.featureHandlers.escape.push(() => clearPainter(ctx))
}

function createFloatingNodeFromCanvasDoubleClick(event, ctx) {
  if (!isBlankCanvasDoubleClick(event, ctx)) return false
  const point = ctx.viewport.screenToWorld(event.clientX, event.clientY)
  const command = createFloatingNodeCommand(ctx.doc, point, { text: '' })
  if (!ctx.manager.execute(command)) return false

  event.preventDefault()
  event.stopPropagation()
  ctx.selection.set([command.nodeId])
  // execute 會先觸發重繪；此時節點 DOM 已存在，空 seed 可直接進入輸入狀態。
  ctx.edit.start(command.nodeId, '')
  return true
}

function isBlankCanvasDoubleClick(event, ctx) {
  if (event.button !== 0 || event.defaultPrevented) return false
  const { canvas, world, nodesLayer, svgLayer } = ctx.elements
  if (canvas.hidden || canvas.closest?.('.editor-shell')?.dataset.viewMode === 'outline') return false
  const body = canvas.ownerDocument?.body || globalThis.document?.body
  if (body?.classList?.contains('is-presentation-mode')) return false
  // 採 allowlist：節點、關聯線、概要與畫布 UI 都是這四層的子元素，不會誤判為空白。
  return event.target === canvas || event.target === world || event.target === nodesLayer || event.target === svgLayer
}

function drawFloatingNodes({ doc, positions, nodesLayer, svgLayer, nodeLookup }, ctx) {
  const orderedIds = Array.from(nodeLookup.keys()).filter(id => id !== doc.root.id)
  const connectionPaths = Array.from(svgLayer.querySelectorAll(':scope > .connection-path'))
  for (const [id, position] of positions) {
    const record = nodeLookup.get(id)
    const node = record?.node || findNode(doc.root, id)
    const meta = getFloatingMeta(node)
    // 舊資料若把 token 洩漏到樹內子節點，不再讓它脫離父節點與隱藏連線。
    if (!meta || record?.parent !== doc.root) continue
    // overlay 先改 positions，讓後續關聯線/概要 hook 讀到自由座標。
    position.x = meta.x
    position.y = meta.y
    const element = nodesLayer.querySelector(`[data-node-id="${cssEscape(id)}"]`)
    if (!element) continue
    element.classList.add('mind-node--floating')
    element.style.left = `${meta.x}px`
    element.style.top = `${meta.y}px`
    const pathIndex = orderedIds.indexOf(id)
    if (pathIndex >= 0 && connectionPaths[pathIndex]) connectionPaths[pathIndex].hidden = true
    element.addEventListener('pointerdown', event => beginFloatingDrag(event, ctx, id, element, meta))
  }
}

function beginFloatingDrag(event, ctx, nodeId, element, meta) {
  if (event.button !== 0 || event.target.closest('button, a, input, textarea, [contenteditable="true"]')) return
  event.preventDefault()
  event.stopPropagation()
  const pointerId = event.pointerId
  const start = ctx.viewport.screenToWorld(event.clientX, event.clientY)
  let latest = { ...meta }
  let moved = false
  ctx.selection.set([nodeId])
  element.classList.add('is-floating-dragging')
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    const point = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY)
    latest = { x: meta.x + point.x - start.x, y: meta.y + point.y - start.y }
    moved = moved || Math.hypot(point.x - start.x, point.y - start.y) > 3
    element.style.left = `${latest.x}px`
    element.style.top = `${latest.y}px`
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    element.classList.remove('is-floating-dragging')
    if (!moved) { ctx.renderAll(); return }
    element.style.pointerEvents = 'none'
    const target = document.elementsFromPoint(endEvent.clientX, endEvent.clientY).find(candidate => candidate.classList?.contains('mind-node') && candidate.dataset.nodeId !== nodeId)
    element.style.pointerEvents = ''
    if (target && !getFloatingMeta(findNode(ctx.doc.root, target.dataset.nodeId))) {
      const command = attachFloatingNodeCommand(ctx.doc, nodeId, target.dataset.nodeId)
      if (ctx.manager.execute(command)) ctx.notify('懸浮節點已掛回樹')
      else ctx.renderAll()
      return
    }
    ctx.manager.execute(updateFloatingPositionCommand(ctx.doc, nodeId, latest))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function clearPainter(ctx) {
  ctx.featureState.formatPainter = null
  ctx.elements.canvas.classList.remove('is-format-painting')
  document.querySelector('#format-painter-button')?.classList.remove('is-active')
}

function finite(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
function floatingToken(point) {
  const x = Math.round(finite(point?.x, 120) * 100) / 100
  const y = Math.round(finite(point?.y, 120) * 100) / 100
  return `${FLOATING_PREFIX}${x},${y}`
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
