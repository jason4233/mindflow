/**
 * 節點拖曳重掛：ghost、候選父節點高亮、插入線與左右側切換。
 */
import { findNodeContext, isDescendant } from './model.js'

export class DragDropController {
  constructor({ canvas, nodesLayer, indicator, doc, viewport, selection, onMove }) {
    this.canvas = canvas
    this.nodesLayer = nodesLayer
    this.indicator = indicator
    this.doc = doc
    this.viewport = viewport
    this.selection = selection
    this.onMove = onMove
    this.pending = null
    this.drag = null
    this.bindEvents()
  }

  bindEvents() {
    this.nodesLayer.addEventListener('pointerdown', event => {
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
