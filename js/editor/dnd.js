/**
 * 節點拖曳重掛：ghost、候選父節點高亮、插入線與左右側切換。
 */
import { findNode, findNodeContext, isDescendant, structuredCloneSafe } from './model.js'
import { getNodeWidth, withNodeWidth } from './themes.js'

const MIN_NODE_WIDTH = 60
const MAX_NODE_WIDTH = 500

export class DragDropController {
  constructor({ canvas, nodesLayer, indicator, doc, viewport, selection, manager, onMove }) {
    this.canvas = canvas
    this.nodesLayer = nodesLayer
    this.indicator = indicator
    this.doc = doc
    this.viewport = viewport
    this.selection = selection
    this.manager = manager
    this.onMove = onMove
    this.pending = null
    this.drag = null
    this.decorateQueued = false
    this.bindEvents()
    this.bindOwnedDecorations()
  }

  bindEvents() {
    this.nodesLayer.addEventListener('pointerdown', event => {
      if (event.target.closest('.node-width-handle') || this.viewport.spacePressed) return
      const element = event.target.closest('.mind-node')
      if (event.button !== 0 || !element || event.target.closest('[data-collapse-control]') || event.target.isContentEditable) return
      const id = element.dataset.nodeId
      if (id === this.doc.root.id) return
      // Ctrl/Meta+點擊由 SelectionManager 在 click 階段 toggle；這裡若提前 set 會造成第二次 toggle 把它移除。
      if (!this.selection.ids.has(id) && !event.ctrlKey && !event.metaKey) this.selection.set([id])
      this.pending = {
        id,
        element,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      }

      const move = moveEvent => this.handleMove(moveEvent)
      const end = endEvent => {
        if (!this.pending || endEvent.pointerId !== this.pending.pointerId) return
        const wasDragging = Boolean(this.drag)
        if (wasDragging && this.drag.drop) {
          const { id: movedId } = this.pending
          const { parentId, index, side } = this.drag.drop
          this.onMove(movedId, parentId, index, side)
        }
        this.cleanup()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        if (wasDragging) {
          // pointerup 後瀏覽器會合成 click，必須在 capture 階段吃掉，避免選取狀態被重設。
          this.nodesLayer.addEventListener('click', clickEvent => {
            clickEvent.preventDefault()
            clickEvent.stopImmediatePropagation()
          }, { capture: true, once: true })
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    })
  }

  bindOwnedDecorations() {
    const queueDecorate = () => {
      if (this.decorateQueued) return
      this.decorateQueued = true
      queueMicrotask(() => {
        this.decorateQueued = false
        this.decorateResizeHandles()
        this.decorateSummaryStyles()
      })
    }
    window.addEventListener('mindflow:selectionchange', queueDecorate)
    const world = this.nodesLayer.closest('.world') || this.nodesLayer
    this.decorationObserver = new MutationObserver(queueDecorate)
    this.decorationObserver.observe(world, { childList: true, subtree: true })
    queueDecorate()
  }

  decorateResizeHandles() {
    const selected = new Set(this.selection.getSelectedIds())
    for (const element of this.nodesLayer.querySelectorAll('.mind-node')) {
      const id = element.dataset.nodeId
      const shouldShow = selected.has(id)
      if (!shouldShow) {
        element.querySelectorAll('.node-width-handle').forEach(handle => handle.remove())
        continue
      }
      for (const side of ['left', 'right']) {
        if (element.querySelector(`.node-width-handle--${side}`)) continue
        const handle = document.createElement('span')
        handle.className = `node-width-handle node-width-handle--${side}`
        handle.dataset.resizeSide = side
        handle.title = `拖曳${side === 'left' ? '左' : '右'}邊緣調整寬度`
        handle.addEventListener('pointerdown', event => this.beginNodeResize(event, element, side))
        element.append(handle)
      }
    }
  }

  decorateSummaryStyles() {
    for (const summary of this.doc.summaries || []) {
      const style = summary.style || {}
      const path = this.canvas.querySelector(`[data-summary-id="${cssEscape(summary.id)}"]`)
      const label = this.canvas.querySelector(`[data-summary-node="${cssEscape(summary.id)}"]`)
      if (path) {
        path.style.stroke = style.lineColor || ''
        path.style.strokeDasharray = lineDash(style.lineStyle)
      }
      if (label) label.style.background = style.fill || ''
    }
  }

  beginNodeResize(event, element, side) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const id = element.dataset.nodeId
    if (!this.selection.ids.has(id)) this.selection.set([id])
    const ids = this.selection.getSelectedIds()
    const positions = this.selection.getPositions()
    const position = positions.get(id)
    const startWidth = getNodeWidth(findNode(this.doc.root, id)) || position?.w || element.getBoundingClientRect().width / this.viewport.zoom
    const startX = event.clientX
    const pointerId = event.pointerId
    let width = clampNodeWidth(startWidth)
    element.setPointerCapture?.(pointerId)

    const move = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return
      const delta = (moveEvent.clientX - startX) / Math.max(0.2, this.viewport.zoom)
      width = clampNodeWidth(startWidth + (side === 'left' ? -delta : delta))
      for (const selectedId of ids) {
        const selectedElement = this.nodesLayer.querySelector(`[data-node-id="${cssEscape(selectedId)}"]`)
        if (selectedElement) selectedElement.style.width = `${width}px`
      }
    }
    const end = endEvent => {
      if (endEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      if (this.manager) this.manager.execute(createNodeWidthCommand(this.doc, ids, width))
      this.suppressNextClick()
    }
    const cancel = cancelEvent => {
      if (cancelEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      for (const selectedId of ids) {
        const selectedElement = this.nodesLayer.querySelector(`[data-node-id="${cssEscape(selectedId)}"]`)
        const selectedPosition = positions.get(selectedId)
        if (selectedElement && selectedPosition) selectedElement.style.width = `${selectedPosition.w}px`
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
  }

  suppressNextClick() {
    this.nodesLayer.addEventListener('click', event => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }, { capture: true, once: true })
  }

  handleMove(event) {
    if (!this.pending || event.pointerId !== this.pending.pointerId) return
    const distance = Math.hypot(event.clientX - this.pending.startX, event.clientY - this.pending.startY)
    if (!this.drag && distance < 5) return
    if (!this.drag) this.beginDrag(event)
    event.preventDefault()

    this.drag.ghost.style.left = `${event.clientX}px`
    this.drag.ghost.style.top = `${event.clientY}px`
    this.clearDropVisuals()
    this.drag.drop = this.resolveDrop(event.clientX, event.clientY)
  }

  beginDrag(event) {
    const rect = this.pending.element.getBoundingClientRect()
    const ghost = this.pending.element.cloneNode(true)
    ghost.classList.add('drag-ghost')
    ghost.classList.remove('is-selected')
    ghost.querySelector('.collapse-control')?.remove()
    ghost.style.width = `${rect.width}px`
    ghost.style.height = `${rect.height}px`
    ghost.style.left = `${event.clientX}px`
    ghost.style.top = `${event.clientY}px`
    document.body.append(ghost)
    this.pending.element.classList.add('is-drag-source')
    this.drag = { ghost, drop: null, highlighted: null }
  }

  resolveDrop(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY)?.closest('.mind-node')
    const sourceContext = findNodeContext(this.doc.root, this.pending.id)
    if (!sourceContext?.parent) return null

    if (!hit || hit.dataset.nodeId === this.pending.id) {
      return this.resolveEmptySideDrop(clientX, clientY, sourceContext)
    }

    const targetId = hit.dataset.nodeId
    if (isDescendant(this.doc.root, this.pending.id, targetId)) return null
    const targetContext = findNodeContext(this.doc.root, targetId)
    if (!targetContext) return null
    const rect = hit.getBoundingClientRect()

    if (targetId === this.doc.root.id) {
      const side = this.sideAt(clientX)
      const rawIndex = rootInsertionIndex(this.doc.root, side, clientY, this.nodesLayer)
      this.highlightParent(hit)
      this.showIndicator(clientY, rect.left - 44, rect.right + 44)
      return {
        parentId: this.doc.root.id,
        index: adjustIndexAfterRemoval(rawIndex, sourceContext, this.doc.root),
        side
      }
    }

    const ratio = (clientY - rect.top) / Math.max(1, rect.height)
    if (targetContext.parent && (ratio < 0.24 || ratio > 0.76)) {
      const after = ratio > 0.76
      const rawIndex = targetContext.index + (after ? 1 : 0)
      this.showIndicator(after ? rect.bottom : rect.top, rect.left - 10, rect.right + 10)
      return {
        parentId: targetContext.parent.id,
        index: adjustIndexAfterRemoval(rawIndex, sourceContext, targetContext.parent),
        side: targetContext.parent === this.doc.root ? targetContext.node.side : null
      }
    }

    this.highlightParent(hit)
    return {
      parentId: targetId,
      index: targetContext.node.children.length,
      side: null
    }
  }

  resolveEmptySideDrop(clientX, clientY, sourceContext) {
    if (this.doc.layout !== 'mindmap-both' || sourceContext.parent !== this.doc.root) return null
    const nextSide = this.sideAt(clientX)
    if (nextSide === sourceContext.node.side) return null
    const rawIndex = this.doc.root.children.length
    this.showIndicator(clientY, clientX - 50, clientX + 50)
    return {
      parentId: this.doc.root.id,
      index: adjustIndexAfterRemoval(rawIndex, sourceContext, this.doc.root),
      side: nextSide
    }
  }

  sideAt(clientX) {
    const root = this.nodesLayer.querySelector(`[data-node-id="${CSS.escape(this.doc.root.id)}"]`)
    const rootCenter = root ? root.getBoundingClientRect().left + root.getBoundingClientRect().width / 2 : this.canvas.getBoundingClientRect().left + this.canvas.clientWidth / 2
    return clientX < rootCenter ? 'left' : 'right'
  }

  highlightParent(element) {
    element.classList.add('is-drop-parent')
    this.drag.highlighted = element
  }

  showIndicator(screenY, screenLeft, screenRight) {
    const canvasRect = this.canvas.getBoundingClientRect()
    this.indicator.hidden = false
    this.indicator.style.left = `${screenLeft - canvasRect.left}px`
    this.indicator.style.top = `${screenY - canvasRect.top}px`
    this.indicator.style.width = `${Math.max(30, screenRight - screenLeft)}px`
  }

  clearDropVisuals() {
    this.drag?.highlighted?.classList.remove('is-drop-parent')
    if (this.drag) this.drag.highlighted = null
    this.indicator.hidden = true
  }

  cleanup() {
    this.clearDropVisuals()
    this.drag?.ghost.remove()
    this.pending?.element.classList.remove('is-drag-source')
    this.drag = null
    this.pending = null
  }
}

function adjustIndexAfterRemoval(rawIndex, sourceContext, targetParent) {
  return sourceContext.parent === targetParent && sourceContext.index < rawIndex ? rawIndex - 1 : rawIndex
}

function rootInsertionIndex(root, side, clientY, nodesLayer) {
  const sideChildren = root.children
    .map((node, index) => ({ node, index }))
    .filter(item => item.node.side === side)
  for (const item of sideChildren) {
    const element = nodesLayer.querySelector(`[data-node-id="${CSS.escape(item.node.id)}"]`)
    if (element && clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2) return item.index
  }
  return sideChildren.at(-1)?.index + 1 || root.children.length
}

export function clampNodeWidth(value) {
  const width = Number(value)
  return Math.round(Number.isFinite(width) ? Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, width)) : MIN_NODE_WIDTH)
}

export function createNodeWidthCommand(doc, ids, width) {
  const targetIds = Array.from(new Set(ids || [])).filter(Boolean)
  const nextWidth = clampNodeWidth(width)
  let previous = null
  return {
    description: '調整節點寬度',
    affectedIds: targetIds.slice(),
    do: () => {
      const nodes = targetIds.map(id => findNode(doc.root, id)).filter(Boolean)
      const changed = nodes.filter(node => getNodeWidth(node) !== nextWidth)
      if (changed.length === 0) return false
      if (!previous) previous = changed.map(node => ({ id: node.id, style: structuredCloneSafe(node.style) }))
      for (const node of changed) node.style.lineStyle = withNodeWidth(node.style.lineStyle || '', nextWidth)
      return true
    },
    undo: () => {
      for (const record of previous || []) {
        const node = findNode(doc.root, record.id)
        if (node) node.style = structuredCloneSafe(record.style)
      }
    }
  }
}

function lineDash(style) {
  return ({ dotted: '2 7', dashed: '9 7', 'dash-dot': '10 5 2 5', 'long-dash': '16 8' })[style] || ''
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&')
}
