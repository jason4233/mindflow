/**
 * 節點單選、多選、空白框選與方向鍵視覺導覽。
 */
import { visibleNodeIds } from './model.js'

const DIRECTION_VECTORS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 })
})
const AXIS_ALIGNMENT_WEIGHT = 2

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
    this.handleCommandSelection = this.handleCommandSelection.bind(this)
    this.handleFocusRequest = this.handleFocusRequest.bind(this)
    this.bindEvents()
  }

  bindEvents() {
    window.addEventListener('mindflow:commandselection', this.handleCommandSelection)
    window.addEventListener('mindflow:focusnode', this.handleFocusRequest)
    this.nodesLayer.addEventListener('click', event => {
      const nodeElement = event.target.closest('.mind-node')
      if (!nodeElement || event.target.closest('[data-collapse-control]')) return
      const id = nodeElement.dataset.nodeId
      if (event.ctrlKey || event.metaKey) this.toggle(id)
      else this.set([id])
    })

    this.canvas.addEventListener('pointerdown', event => {
      // 純左鍵拖曳由 viewport 平移；只有 Ctrl/Meta+左鍵才開始框選。
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || this.isPanMode() || event.target.closest('.mind-node') || event.target.closest('button')) return
      this.startFrame(event)
    })
  }

  handleCommandSelection(event) {
    if (!['undo', 'redo'].includes(event.detail?.type)) return
    const positions = this.getPositions()
    const targetId = event.detail.affectedIds.find(id => positions.has(id))
    if (targetId) this.set([targetId])
  }

  handleFocusRequest(event) {
    const id = event.detail?.id
    if (id && this.getPositions().has(id)) this.set([id])
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
    window.dispatchEvent(new CustomEvent('mindflow:selectionchange', {
      detail: { ids: this.getSelectedIds(), primaryId: this.primaryId }
    }))
  }

  getSelectedIds() {
    return Array.from(this.ids)
  }

  navigate(direction) {
    // keyboard 之外的 action 也可能直接呼叫 navigate，隱藏 map 時不得悄悄改 selection。
    if (this.canvas?.hidden) return null
    const doc = this.getDoc()
    const positions = this.getPositions()
    if (!this.primaryId) {
      if (!positions.has(doc.root.id)) return null
      this.set([doc.root.id])
      return doc.root.id
    }
    const targetId = findDirectionalTarget(positions, this.primaryId, direction)
    if (targetId) this.set([targetId])
    return targetId
  }
}

export function findDirectionalTarget(positions, currentId, direction) {
  const vector = DIRECTION_VECTORS[direction]
  const current = positions.get(currentId)
  if (!vector || !isFinitePosition(current)) return null

  const currentCenter = center(current)
  let best = null
  for (const [id, position] of positions) {
    if (id === currentId || !isFinitePosition(position)) continue
    const point = center(position)
    const deltaX = point.x - currentCenter.x
    const deltaY = point.y - currentCenter.y
    const axial = deltaX * vector.x + deltaY * vector.y
    const lateral = Math.abs(deltaX * vector.y - deltaY * vector.x)
    // 90° 圓錐即方向軸左右各 45°；偏軸距離加倍，讓視覺對齊優先於斜向捷徑。
    if (axial <= 0 || lateral > axial) continue
    const score = axial + lateral * AXIS_ALIGNMENT_WEIGHT
    if (!best
      || score < best.score
      || (score === best.score && lateral < best.lateral)
      || (score === best.score && lateral === best.lateral && axial < best.axial)) {
      best = { id, score, lateral, axial }
    }
  }
  return best?.id || null
}

function center(position) {
  return { x: position.x + position.w / 2, y: position.y + position.h / 2 }
}

function isFinitePosition(position) {
  return position && [position.x, position.y, position.w, position.h].every(Number.isFinite)
}
