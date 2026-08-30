import { runAction } from './actions.js'

const DEFAULT_MIN_ZOOM = 0.2
const DEFAULT_MAX_ZOOM = 4
const DEFAULT_TAP_DISTANCE = 10
const DEFAULT_LONG_PRESS_MS = 520
const DEFAULT_DOUBLE_TAP_MS = 350
const DEFAULT_DOUBLE_TAP_DISTANCE = 24

export function initTouchGestures(ctx) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const { canvas, nodesLayer } = ctx?.elements || {}
  if (!canvas || !nodesLayer || !isTouchEnvironment()) return () => {}

  ensureTouchStyles()
  document.documentElement.classList.add('mindflow-touch')
  document.body?.classList.add('mindflow-touch')

  const previousTouchAction = canvas.style.touchAction
  // Pointer Events 是否持續送 move 由 touch-action 在手勢開始前決定；inline 值避免 stylesheet 尚在載入時首個手勢被瀏覽器接管。
  canvas.style.touchAction = 'none'

  const pointers = new Map()
  const internalCancels = new Set()
  const actions = mountNodeActions(canvas)
  let pinch = null
  let lastTap = null
  let suppressClick = null
  let suppressNativeDoubleClickUntil = 0
  let positionFrame = 0

  const scheduleActionPosition = () => {
    window.cancelAnimationFrame(positionFrame)
    positionFrame = window.requestAnimationFrame(() => positionNodeActions(actions, ctx))
  }

  const cancelNativeRoute = pointerId => {
    internalCancels.add(pointerId)
    window.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      cancelable: false,
      pointerId,
      pointerType: 'touch'
    }))
  }

  const beginPinch = currentPointerId => {
    const active = Array.from(pointers.values()).slice(0, 2)
    if (active.length < 2) return
    for (const pointer of active) {
      window.clearTimeout(pointer.longPressTimer)
      if (pointer.nativeRouted && pointer.id !== currentPointerId) cancelNativeRoute(pointer.id)
      pointer.nativeRouted = false
      pointer.wasPinch = true
    }
    pinch = {
      ids: active.map(pointer => pointer.id),
      startPoints: active.map(pointer => ({ clientX: pointer.clientX, clientY: pointer.clientY })),
      startView: ctx.viewport.getState(),
      canvasRect: canvas.getBoundingClientRect()
    }
    lastTap = null
  }

  const openLongPressMenu = pointer => {
    if (!pointers.has(pointer.id) || pointers.size !== 1 || pinch || pointer.moved || !pointer.node?.isConnected) return
    pointer.longPressFired = true
    lastTap = null
    ctx.selection.set([pointer.nodeId])
    if (pointer.nativeRouted) {
      cancelNativeRoute(pointer.id)
      pointer.nativeRouted = false
    }
    suppressClick = { nodeId: pointer.nodeId, until: Date.now() + 800 }
    pointer.node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 0,
      clientX: pointer.clientX,
      clientY: pointer.clientY
    }))
  }

  const handleTap = pointer => {
    const current = {
      targetKey: pointer.nodeId ? `node:${pointer.nodeId}` : 'canvas',
      time: Date.now(),
      clientX: pointer.clientX,
      clientY: pointer.clientY
    }
    if (pointer.nodeId) ctx.selection.set([pointer.nodeId])
    if (!isDoubleTap(lastTap, current)) {
      lastTap = current
      return
    }

    lastTap = null
    suppressNativeDoubleClickUntil = Date.now() + 500
    if (pointer.nodeId) {
      ctx.edit.start(pointer.nodeId)
      return
    }

    const target = pointer.target?.isConnected ? pointer.target : canvas
    const doubleClick = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 0,
      detail: 2,
      clientX: pointer.clientX,
      clientY: pointer.clientY
    })
    Object.defineProperty(doubleClick, 'mindflowTouchGesture', { value: true })
    target.dispatchEvent(doubleClick)
  }

  const onPointerDown = event => {
    if (event.pointerType !== 'touch' || !canvas.contains(event.target) || isIgnoredTouchTarget(event.target)) return
    const node = event.target.closest?.('.mind-node') || null
    const pointer = {
      id: event.pointerId,
      target: event.target,
      node,
      nodeId: node?.dataset.nodeId || null,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: Date.now(),
      startView: ctx.viewport.getState(),
      moved: false,
      longPressFired: false,
      nativeRouted: Boolean(node),
      wasPinch: false,
      longPressTimer: 0
    }
    pointers.set(pointer.id, pointer)

    if (pointers.size >= 2) {
      event.preventDefault()
      event.stopPropagation()
      beginPinch(event.pointerId)
      return
    }

    if (!node) {
      event.preventDefault()
      event.stopPropagation()
      canvas.setPointerCapture?.(event.pointerId)
      return
    }
    pointer.longPressTimer = window.setTimeout(() => openLongPressMenu(pointer), DEFAULT_LONG_PRESS_MS)
  }

  const onPointerMove = event => {
    const pointer = pointers.get(event.pointerId)
    if (!pointer || event.pointerType !== 'touch') return
    pointer.clientX = event.clientX
    pointer.clientY = event.clientY
    const distance = Math.hypot(pointer.clientX - pointer.startX, pointer.clientY - pointer.startY)
    if (distance > DEFAULT_TAP_DISTANCE) {
      pointer.moved = true
      window.clearTimeout(pointer.longPressTimer)
    }

    if (pinch && pointers.size >= 2) {
      event.preventDefault()
      event.stopPropagation()
      const pair = pinch.ids.map(id => pointers.get(id)).filter(Boolean)
      if (pair.length === 2) {
        ctx.viewport.setView(calculatePinchView({
          startPoints: pinch.startPoints,
          currentPoints: pair.map(item => ({ clientX: item.clientX, clientY: item.clientY })),
          startView: pinch.startView,
          canvasRect: pinch.canvasRect
        }))
      }
      return
    }

    if (!pointer.nodeId) {
      event.preventDefault()
      event.stopPropagation()
      ctx.viewport.setPan(
        pointer.startView.panX + pointer.clientX - pointer.startX,
        pointer.startView.panY + pointer.clientY - pointer.startY
      )
    }
  }

  const onPointerEnd = event => {
    if (internalCancels.delete(event.pointerId)) return
    const pointer = pointers.get(event.pointerId)
    if (!pointer || event.pointerType !== 'touch') return
    window.clearTimeout(pointer.longPressTimer)
    if (Number.isFinite(event.clientX)) pointer.clientX = event.clientX
    if (Number.isFinite(event.clientY)) pointer.clientY = event.clientY

    if (pinch || pointer.wasPinch) {
      event.preventDefault()
      event.stopPropagation()
      pointers.delete(pointer.id)
      if (pointers.size < 2) {
        pinch = null
        const remaining = pointers.values().next().value
        if (remaining) {
          remaining.startX = remaining.clientX
          remaining.startY = remaining.clientY
          remaining.startView = ctx.viewport.getState()
          remaining.node = null
          remaining.nodeId = null
          remaining.nativeRouted = false
        }
      }
      scheduleActionPosition()
      return
    }

    pointers.delete(pointer.id)
    const distance = Math.hypot(pointer.clientX - pointer.startX, pointer.clientY - pointer.startY)
    const release = event.type === 'pointercancel' ? 'cancel' : classifyTouchRelease({
      distance,
      duration: Date.now() - pointer.startedAt,
      longPressFired: pointer.longPressFired
    })
    if (!pointer.nodeId || release === 'long-press') {
      event.preventDefault()
      event.stopPropagation()
    }
    if (release === 'tap') handleTap(pointer)
    scheduleActionPosition()
  }

  const onClickCapture = event => {
    if (!suppressClick || Date.now() > suppressClick.until) {
      suppressClick = null
      return
    }
    const nodeId = event.target.closest?.('.mind-node')?.dataset.nodeId
    if (nodeId !== suppressClick.nodeId) return
    suppressClick = null
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onDoubleClickCapture = event => {
    if (event.mindflowTouchGesture || Date.now() > suppressNativeDoubleClickUntil || !canvas.contains(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onActionClick = event => {
    const button = event.target.closest('[data-touch-action]')
    if (!button || button.disabled) return
    runAction(button.dataset.touchAction)
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerEnd, true)
  window.addEventListener('pointercancel', onPointerEnd, true)
  window.addEventListener('resize', scheduleActionPosition)
  window.addEventListener('mindflow:selectionchange', scheduleActionPosition)
  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('dblclick', onDoubleClickCapture, true)
  actions.addEventListener('click', onActionClick)
  const unsubscribeViewport = ctx.viewport.subscribe(scheduleActionPosition)
  scheduleActionPosition()

  return () => {
    for (const pointer of pointers.values()) window.clearTimeout(pointer.longPressTimer)
    window.cancelAnimationFrame(positionFrame)
    unsubscribeViewport()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerEnd, true)
    window.removeEventListener('pointercancel', onPointerEnd, true)
    window.removeEventListener('resize', scheduleActionPosition)
    window.removeEventListener('mindflow:selectionchange', scheduleActionPosition)
    document.removeEventListener('click', onClickCapture, true)
    document.removeEventListener('dblclick', onDoubleClickCapture, true)
    actions.removeEventListener('click', onActionClick)
    actions.remove()
    canvas.style.touchAction = previousTouchAction
    document.documentElement.classList.remove('mindflow-touch')
    document.body?.classList.remove('mindflow-touch')
  }
}

export function screenPointToWorld(point, canvasRect, view) {
  return {
    x: (Number(point.clientX) - Number(canvasRect.left) - Number(view.panX)) / Number(view.zoom),
    y: (Number(point.clientY) - Number(canvasRect.top) - Number(view.panY)) / Number(view.zoom)
  }
}

export function calculatePinchView({
  startPoints,
  currentPoints,
  startView,
  canvasRect,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM
}) {
  const startDistance = pointDistance(startPoints[0], startPoints[1])
  const currentDistance = pointDistance(currentPoints[0], currentPoints[1])
  const startMidpoint = pointMidpoint(startPoints[0], startPoints[1])
  const currentMidpoint = pointMidpoint(currentPoints[0], currentPoints[1])
  const anchor = screenPointToWorld(startMidpoint, canvasRect, startView)
  const ratio = startDistance > 0 ? currentDistance / startDistance : 1
  const zoom = clamp(Number(startView.zoom) * ratio, minZoom, maxZoom)
  return {
    panX: currentMidpoint.clientX - Number(canvasRect.left) - anchor.x * zoom,
    panY: currentMidpoint.clientY - Number(canvasRect.top) - anchor.y * zoom,
    zoom
  }
}

export function classifyTouchRelease({
  distance,
  duration,
  longPressFired = false,
  tapDistance = DEFAULT_TAP_DISTANCE,
  longPressMs = DEFAULT_LONG_PRESS_MS
}) {
  if (longPressFired || (distance <= tapDistance && duration >= longPressMs)) return 'long-press'
  return distance <= tapDistance ? 'tap' : 'drag'
}

export function isDoubleTap(previous, current, {
  maxDelay = DEFAULT_DOUBLE_TAP_MS,
  maxDistance = DEFAULT_DOUBLE_TAP_DISTANCE
} = {}) {
  if (!previous || !current || previous.targetKey !== current.targetKey) return false
  const delay = Number(current.time) - Number(previous.time)
  return delay >= 0 && delay <= maxDelay && pointDistance(previous, current) <= maxDistance
}

function pointDistance(left, right) {
  return Math.hypot(Number(right.clientX) - Number(left.clientX), Number(right.clientY) - Number(left.clientY))
}

function pointMidpoint(left, right) {
  return {
    clientX: (Number(left.clientX) + Number(right.clientX)) / 2,
    clientY: (Number(left.clientY) + Number(right.clientY)) / 2
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(Number(minimum), Math.min(Number(maximum), value))
}

function isTouchEnvironment() {
  return Number(navigator.maxTouchPoints) > 0 || window.matchMedia?.('(pointer: coarse)').matches
}

function isIgnoredTouchTarget(target) {
  return Boolean(target.closest?.(
    '.touch-node-actions, .zoom-controls, .text-toolbar, .context-menu, .relation-overlay, .summary-node, .summary-bracket, button, input, select, textarea, [contenteditable="true"], .node-width-handle'
  ))
}

function ensureTouchStyles() {
  if (document.querySelector('link[data-mobile-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/mobile.css'
  link.dataset.mobileStyles = 'true'
  document.head.append(link)
}

function mountNodeActions(canvas) {
  const actions = document.createElement('div')
  actions.className = 'touch-node-actions'
  actions.dataset.touchNodeActions = 'true'
  actions.setAttribute('role', 'toolbar')
  actions.setAttribute('aria-label', '節點快捷操作')
  actions.hidden = true

  const child = document.createElement('button')
  child.type = 'button'
  child.dataset.touchAction = 'insertChild'
  child.textContent = '＋子節點'

  const sibling = document.createElement('button')
  sibling.type = 'button'
  sibling.dataset.touchAction = 'insertAfter'
  sibling.textContent = '＋同級'

  actions.append(child, sibling)
  canvas.append(actions)
  return actions
}

function positionNodeActions(actions, ctx) {
  const { canvas, nodesLayer } = ctx.elements
  const selectedId = ctx.selection.primaryId
  const node = selectedId
    ? nodesLayer.querySelector(`[data-node-id="${cssEscape(selectedId)}"]`)
    : null
  if (!node || !node.isConnected) {
    actions.hidden = true
    return
  }

  actions.hidden = false
  actions.querySelector('[data-touch-action="insertAfter"]').disabled = selectedId === ctx.doc.root.id
  const canvasRect = canvas.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const width = actions.offsetWidth
  const height = actions.offsetHeight
  const left = clamp(nodeRect.left - canvasRect.left + nodeRect.width / 2 - width / 2, 8, Math.max(8, canvas.clientWidth - width - 8))
  const below = nodeRect.bottom - canvasRect.top + 8
  const top = below + height <= canvas.clientHeight - 8
    ? below
    : Math.max(8, nodeRect.top - canvasRect.top - height - 8)
  actions.style.left = `${Math.round(left)}px`
  actions.style.top = `${Math.round(top)}px`
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/gu, '\\$&')
}
