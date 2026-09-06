/**
 * 懸浮節點持久化、自由拖放/掛回樹，以及單次格式刷互動。
 */
import { registerAction } from './actions.js'
import { moveNode, setStyle } from './commands.js'
import { FLOATING_PREFIX, buildMapContext, createId, createNode, findNode, findNodeContext, getFloatingMeta, structuredCloneSafe } from './model.js'
import { registerOverlay } from './render.js'

export { getFloatingMeta }

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

function drawFloatingNodes({ doc, positions, nodesLayer, nodeLookup }, ctx) {
  // 座標與連線已由 layout/render 處理（獨立心智圖自成一棵樹、不畫來自原圖的連線）；
  // 這裡只負責標記與拖曳。以前是在 overlay 事後搬位置＋用索引隱藏連線，
  // 子節點不會跟著搬，而且索引一錯就會在原圖留下連線殘段。
  for (const [id] of positions) {
    const record = nodeLookup.get(id)
    const node = record?.node || findNode(doc.root, id)
    const meta = getFloatingMeta(node)
    if (!meta || record?.parent !== doc.root) continue
    const element = nodesLayer.querySelector(`[data-node-id="${cssEscape(id)}"]`)
    if (!element) continue
    element.classList.add('mind-node--floating')
    element.addEventListener('pointerdown', event => beginFloatingDrag(event, ctx, id, element, meta))
  }
}

// 收集同一張獨立心智圖的節點元素起始座標與圖內連線，供拖曳時整體平移。
function collectMapFollowers(ctx, mapRootId) {
  const context = buildMapContext(ctx.doc.root)
  const ids = new Set(Array.from(context.entries())
    .filter(([, entry]) => entry.mapRootId === mapRootId)
    .map(([id]) => id))
  const followers = []
  for (const id of ids) {
    const element = ctx.elements.nodesLayer.querySelector(`[data-node-id="${cssEscape(id)}"]`)
    if (!element) continue
    followers.push({ element, x: Number.parseFloat(element.style.left) || 0, y: Number.parseFloat(element.style.top) || 0 })
  }
  // 圖內連線：render 依 parentLookup 順序輸出，這裡用 data 屬性比對子節點 id
  followers.edges = Array.from(ctx.elements.svgLayer.querySelectorAll(':scope > .connection-path'))
    .filter(path => ids.has(path.dataset.childId))
  // 關聯線與概要 overlay：只搬「渲染時明確標記為本圖」的（data-map-root）。
  // 用 selector 猜所屬圖會誤搬別張圖的 overlay；跨圖關聯線刻意不標記，
  // 整條平移會讓另一端脫離它的節點，放開後由完整重繪校正。
  followers.overlays = []
  for (const layer of [ctx.elements.svgLayer, ctx.elements.nodesLayer]) {
    if (!layer) continue
    for (const element of layer.querySelectorAll(`[data-map-root="${cssEscape(mapRootId)}"]`)) {
      // SVG 用 transform；HTML（概要標籤是 button）改位移 left/top——
      // 直接寫 inline transform 會取代 CSS 的 translateY(-50%) 置中，拖曳中會多偏半個標籤高。
      if (typeof SVGElement !== 'undefined' && element instanceof SVGElement) followers.overlays.push(element)
      else followers.push({ element, x: Number.parseFloat(element.style.left) || 0, y: Number.parseFloat(element.style.top) || 0 })
    }
  }
  return followers
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
  // 使用者拖的是「整張圖」：先收集這張圖的所有節點 DOM 與圖內連線，拖曳中一起平移，
  // 否則 root 會脫離自己的子樹，放開時才跳回去。
  const followers = collectMapFollowers(ctx, nodeId)
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    const point = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY)
    latest = { x: meta.x + point.x - start.x, y: meta.y + point.y - start.y }
    moved = moved || Math.hypot(point.x - start.x, point.y - start.y) > 3
    const dx = latest.x - meta.x
    const dy = latest.y - meta.y
    for (const follower of followers) {
      follower.element.style.left = `${follower.x + dx}px`
      follower.element.style.top = `${follower.y + dy}px`
    }
    for (const edge of followers.edges) edge.setAttribute('transform', `translate(${dx},${dy})`)
    // overlay 用 CSS transform：SVG 與 HTML（概要標籤是 button）都適用，
    // 也不會覆蓋 relation-label 既有的 transform 屬性。
    for (const overlay of followers.overlays) overlay.style.transform = `translate(${dx}px, ${dy}px)`
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    element.classList.remove('is-floating-dragging')
    for (const edge of followers.edges) edge.removeAttribute('transform')
    for (const overlay of followers.overlays) overlay.style.transform = ''
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
