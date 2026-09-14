/**
 * 節點單選、多選、空白框選與方向鍵視覺導覽。
 */
import { visibleNodeIds } from './model.js'

const FRAME_DRAG_THRESHOLD = 4
// 右鍵框選後要吃掉緊接著的 contextmenu（Windows 在右鍵放開時才送）。用布林、不用時間窗：
// 門檻一超過就設（拖曳中先放右鍵也吃得到）、contextmenu 消費一次即清、下一次按下時清掉殘留。
let contextMenuSuppressed = false

const DIRECTION_VECTORS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 })
})
const AXIS_ALIGNMENT_WEIGHT = 2

export function shouldStartSelectionFrame({
  button,
  ctrlKey = false,
  metaKey = false,
  isPanMode = false,
  onNode = false,
  onButton = false,
  onControl = false
}) {
  // onControl：小地圖、縮放列、文字工具列與表單控制項——它們在 #canvas 內，但右鍵拖曳不該起框
  if (isPanMode || onNode || onButton || onControl) return false
  if (button === 0) return ctrlKey || metaKey
  if (button === 2) return true
  return false
}

export function hasFrameDragExceeded(start, current, threshold = FRAME_DRAG_THRESHOLD) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

export function getSelectionFrameRect(start, end) {
  return {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y)
  }
}

export function isRectInSelectionFrame(rect, frame) {
  return rect.x + rect.w >= frame.left && rect.x <= frame.right && rect.y + rect.h >= frame.top && rect.y <= frame.bottom
}

export function suppressNextContextMenu() {
  contextMenuSuppressed = true
}

export function consumeContextMenuSuppression() {
  if (!contextMenuSuppressed) return false
  contextMenuSuppressed = false
  return true
}

export function clearContextMenuSuppression() {
  contextMenuSuppressed = false
}

export class SelectionManager {
  constructor({ canvas, nodesLayer, selectionRectangle, getDoc, getPositions, viewport = null, isPanMode = () => false }) {
    this.canvas = canvas
    this.nodesLayer = nodesLayer
    this.selectionRectangle = selectionRectangle
    this.getDoc = getDoc
    this.getPositions = getPositions
    this.viewport = viewport
    this.isPanMode = isPanMode
    this.ids = new Set()
    this.primaryId = null
    this.frame = null
    // apply() 的差異快取：框選拖曳時只動有變化的節點；重繪後由 prune() 全量重套
    this.lastAppliedIds = null
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
      // 新的一次按下：清掉上一次框選殘留的選單抑制（框選進行中的和弦按鍵除外）
      if (!this.frame) clearContextMenuSuppression()
      // 純左鍵拖曳由 viewport 平移；Ctrl/Meta+左鍵、或右鍵空白處才開始框選。
      if (!shouldStartSelectionFrame({
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        isPanMode: this.isPanMode(),
        onNode: Boolean(event.target.closest('.mind-node')),
        onButton: Boolean(event.target.closest('button')),
        onControl: Boolean(event.target.closest('.minimap-panel, .zoom-controls, .text-toolbar, input, select, textarea'))
      })) return
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
    // 重入守衛：第二個 pointer 進來時不得覆蓋進行中的框選（否則舊的 window listener 永遠拆不掉）
    if (this.frame) return
    event.preventDefault()
    // 框選是畫布手勢：把焦點拉回畫布（結束進行中的編輯、離開面板控制項），
    // 否則 pointerdown 被 preventDefault 後焦點留在原處，框選完按 Delete/Tab 會被當表單鍵吞掉。
    if (document.activeElement !== this.canvas) this.canvas.focus({ preventScroll: true })
    const canvasRect = this.canvas.getBoundingClientRect()
    const start = { x: event.clientX - canvasRect.left, y: event.clientY - canvasRect.top }
    const baseSelection = event.button === 0 && (event.ctrlKey || event.metaKey) ? new Set(this.ids) : new Set()
    this.frame = { start, current: start, baseSelection, pointerId: event.pointerId, exceeded: false }
    this.updateFrameVisual()

    const move = moveEvent => {
      if (!this.frame || moveEvent.pointerId !== this.frame.pointerId) return
      this.frame.current = {
        x: moveEvent.clientX - canvasRect.left,
        y: moveEvent.clientY - canvasRect.top
      }
      this.updateFrameVisual()
      // 「曾超過門檻」是黏性的：拖出去再拉回原點仍是一次拖曳，不會退化成單擊開選單
      if (!this.frame.exceeded && hasFrameDragExceeded(this.frame.start, this.frame.current)) {
        this.frame.exceeded = true
        if (event.button === 2) suppressNextContextMenu()
      }
      if (event.button === 2 && !this.frame.exceeded) return
      this.selectInsideFrame(canvasRect)
    }
    const end = endEvent => {
      if (!this.frame || endEvent.pointerId !== this.frame.pointerId) return
      const isRightButton = event.button === 2
      const isDrag = !isRightButton || this.frame.exceeded
      const cancelled = endEvent.type === 'pointercancel'
      // 右鍵短按（沒拖）→ 不套用、讓 contextmenu 照常開；pointercancel → 不套用也不留抑制旗標
      if (isDrag && !cancelled) this.selectInsideFrame(canvasRect)
      if (cancelled) clearContextMenuSuppression()
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
    const next = new Set(baseSelection)
    const frameRect = getSelectionFrameRect(start, current)
    const positions = this.viewport ? this.getPositions() : null
    if (positions && positions.size) {
      // 世界座標純數學命中：框選拖曳的每一格不再讀 n 次 DOM rect（大圖下那是逐格強制 reflow）
      const { panX, panY, zoom } = this.viewport
      const worldRect = {
        left: (frameRect.left - panX) / zoom,
        right: (frameRect.right - panX) / zoom,
        top: (frameRect.top - panY) / zoom,
        bottom: (frameRect.bottom - panY) / zoom
      }
      for (const [id, position] of positions) {
        if (isRectInSelectionFrame(position, worldRect)) {
          next.add(id)
        }
      }
      // 圖片節點會被 overlay 撐得比 layout 尺寸大，這些少數節點用實際 DOM rect 補判
      const frameScreenRect = {
        left: canvasRect.left + frameRect.left,
        right: canvasRect.left + frameRect.right,
        top: canvasRect.top + frameRect.top,
        bottom: canvasRect.top + frameRect.bottom
      }
      for (const element of this.nodesLayer.querySelectorAll('.mind-node--has-image')) {
        if (next.has(element.dataset.nodeId)) continue
        const rect = element.getBoundingClientRect()
        if (isRectInSelectionFrame({ x: rect.left, y: rect.top, w: rect.width, h: rect.height }, frameScreenRect)) {
          next.add(element.dataset.nodeId)
        }
      }
    } else {
      const frameScreenRect = {
        left: canvasRect.left + frameRect.left,
        right: canvasRect.left + frameRect.right,
        top: canvasRect.top + frameRect.top,
        bottom: canvasRect.top + frameRect.bottom
      }
      for (const element of this.nodesLayer.querySelectorAll('.mind-node')) {
        const rect = element.getBoundingClientRect()
        if (isRectInSelectionFrame({ x: rect.left, y: rect.top, w: rect.width, h: rect.height }, frameScreenRect)) {
          next.add(element.dataset.nodeId)
        }
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
    // 重繪後節點 DOM 是全新的，必須全量重套 class，不能走差異路徑
    this.apply(true)
  }

  apply(full = false) {
    const unchanged = !full && this.lastAppliedIds &&
      this.lastAppliedIds.size === this.ids.size &&
      Array.from(this.ids).every(id => this.lastAppliedIds.has(id))
    if (unchanged) return
    for (const element of this.nodesLayer.querySelectorAll('.mind-node')) {
      const id = element.dataset.nodeId
      const selected = this.ids.has(id)
      // 差異模式下只碰狀態有變的節點
      if (!full && this.lastAppliedIds && this.lastAppliedIds.has(id) === selected) continue
      element.classList.toggle('is-selected', selected)
    }
    this.lastAppliedIds = new Set(this.ids)
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
