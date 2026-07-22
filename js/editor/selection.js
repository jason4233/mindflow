/**
 * 節點單選、多選、空白框選與方向鍵視覺導覽。
 */
import { findNodeContext, visibleNodeIds } from './model.js'

export class SelectionManager {
  constructor({ canvas, nodesLayer, selectionRectangle, getDoc, getPositions, isPanMode = () => false }) {
    this.canvas = canvas
    this.nodesLayer = nodesLayer
    this.selectionRectangle = selectionRectangle
    this.getDoc = getDoc
    this.getPositions = getPositions
    this.isPanMode = isPanMode
    this.ids = new Set()
    this.primaryId = null
    this.frame = null
    this.bindEvents()
  }

  bindEvents() {
    this.nodesLayer.addEventListener('click', event => {
      const nodeElement = event.target.closest('.mind-node')
      if (!nodeElement || event.target.closest('[data-collapse-control]')) return
      const id = nodeElement.dataset.nodeId
      if (event.ctrlKey || event.metaKey) this.toggle(id)
      else this.set([id])
    })

    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.isPanMode() || event.target.closest('.mind-node') || event.target.closest('button')) return
      this.startFrame(event)
    })
  }

  startFrame(event) {
    event.preventDefault()
    const canvasRect = this.canvas.getBoundingClientRect()
    const start = { x: event.clientX - canvasRect.left, y: event.clientY - canvasRect.top }
    const baseSelection = event.ctrlKey || event.metaKey ? new Set(this.ids) : new Set()
    this.frame = { start, current: start, baseSelection, pointerId: event.pointerId }
    this.updateFrameVisual()

    const move = moveEvent => {
      if (!this.frame || moveEvent.pointerId !== this.frame.pointerId) return
      this.frame.current = {
        x: moveEvent.clientX - canvasRect.left,
        y: moveEvent.clientY - canvasRect.top
      }
      this.updateFrameVisual()
      this.selectInsideFrame(canvasRect)
    }
    const end = endEvent => {
      if (!this.frame || endEvent.pointerId !== this.frame.pointerId) return
      const distance = Math.hypot(this.frame.current.x - this.frame.start.x, this.frame.current.y - this.frame.start.y)
      if (distance < 3 && !(event.ctrlKey || event.metaKey)) this.clear()
      this.frame = null
      this.selectionRectangle.hidden = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  updateFrameVisual() {
    const { start, current } = this.frame
    this.selectionRectangle.hidden = false
    this.selectionRectangle.style.left = `${Math.min(start.x, current.x)}px`
    this.selectionRectangle.style.top = `${Math.min(start.y, current.y)}px`
    this.selectionRectangle.style.width = `${Math.abs(current.x - start.x)}px`
    this.selectionRectangle.style.height = `${Math.abs(current.y - start.y)}px`
  }

  selectInsideFrame(canvasRect) {
    const { start, current, baseSelection } = this.frame
    const frameRect = {
      left: canvasRect.left + Math.min(start.x, current.x),
      right: canvasRect.left + Math.max(start.x, current.x),
      top: canvasRect.top + Math.min(start.y, current.y),
      bottom: canvasRect.top + Math.max(start.y, current.y)
    }
    const next = new Set(baseSelection)
    for (const element of this.nodesLayer.querySelectorAll('.mind-node')) {
      const rect = element.getBoundingClientRect()
      if (rect.right >= frameRect.left && rect.left <= frameRect.right && rect.bottom >= frameRect.top && rect.top <= frameRect.bottom) {
        next.add(element.dataset.nodeId)
      }
    }
    this.ids = next
    this.primaryId = Array.from(next).at(-1) || null
    this.apply()
  }

  set(ids, primaryId = null) {
    this.ids = new Set(ids)
    this.primaryId = primaryId || Array.from(this.ids).at(-1) || null
    this.apply()
  }

  toggle(id) {
    if (this.ids.has(id)) this.ids.delete(id)
    else this.ids.add(id)
    this.primaryId = this.ids.has(id) ? id : Array.from(this.ids).at(-1) || null
    this.apply()
  }

  clear() {
    this.ids.clear()
    this.primaryId = null
    this.apply()
  }

  selectAll() {
    this.set(visibleNodeIds(this.getDoc().root))
  }

  prune() {
    const validIds = new Set(this.getPositions().keys())
    this.ids = new Set(Array.from(this.ids).filter(id => validIds.has(id)))
    if (!this.ids.has(this.primaryId)) this.primaryId = Array.from(this.ids).at(-1) || null
    this.apply()
  }

  apply() {
    for (const element of this.nodesLayer.querySelectorAll('.mind-node')) {
      element.classList.toggle('is-selected', this.ids.has(element.dataset.nodeId))
    }
  }

  getSelectedIds() {
    return Array.from(this.ids)
  }

  navigate(direction) {
    const doc = this.getDoc()
    const positions = this.getPositions()
    const currentId = this.primaryId || doc.root.id
    const targetId = findDirectionalTarget(doc, positions, currentId, direction)
    if (targetId) this.set([targetId])
    return targetId
  }
}

function findDirectionalTarget(doc, positions, currentId, direction) {
  const current = positions.get(currentId)
  const context = findNodeContext(doc.root, currentId)
  if (!current || !context) return null

  if (direction === 'left' || direction === 'right') {
    if (currentId === doc.root.id) {
      const wantedSide = direction
      return doc.root.children
        .filter(child => positions.get(child.id)?.side === wantedSide)
        .sort((a, b) => verticalDistance(positions.get(a.id), current) - verticalDistance(positions.get(b.id), current))[0]?.id || null
    }
    const outward = (current.side === 'right' && direction === 'right') || (current.side === 'left' && direction === 'left')
    if (!outward) return context.parent?.id || null
    return context.node.children
      .filter(child => positions.has(child.id))
      .sort((a, b) => verticalDistance(positions.get(a.id), current) - verticalDistance(positions.get(b.id), current))[0]?.id || null
  }

  const currentCenter = center(current)
  const sign = direction === 'up' ? -1 : 1
  let best = null
  for (const [id, position] of positions) {
    if (id === currentId || (position.side || '') !== (current.side || '')) continue
    const point = center(position)
    const deltaY = point.y - currentCenter.y
    if (Math.sign(deltaY) !== sign) continue
    const score = Math.abs(deltaY) + Math.abs(point.x - currentCenter.x) * 0.2
    if (!best || score < best.score) best = { id, score }
  }
  return best?.id || null
}

function center(position) {
  return { x: position.x + position.w / 2, y: position.y + position.h / 2 }
}

function verticalDistance(a, b) {
  return Math.abs(center(a).y - center(b).y)
}
