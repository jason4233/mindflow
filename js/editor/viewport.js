/**
 * 畫布 pan / zoom / fit 控制；座標以 canvas 左上角為視口原點。
 */
import { getLayoutBounds } from './layout.js'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

export class ViewportController {
  constructor({ canvas, world, zoomDisplay, onChange = () => {} }) {
    this.canvas = canvas
    this.world = world
    this.zoomDisplay = zoomDisplay
    this.onChange = onChange
    this.panX = 0
    this.panY = 0
    this.zoom = 1
    this.spacePressed = false
    this.initialPlacementDone = false
    this.drag = null
    this.bindEvents()
    this.apply()
  }

  bindEvents() {
    this.canvas.addEventListener('wheel', event => this.handleWheel(event), { passive: false })
    this.canvas.addEventListener('pointerdown', event => this.handlePointerDown(event))
    this.canvas.addEventListener('contextmenu', event => event.preventDefault())
  }

  handleWheel(event) {
    event.preventDefault()
    if (event.ctrlKey) {
      const rect = this.canvas.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = Math.exp(-event.deltaY * 0.002)
      this.setZoom(this.zoom * factor, anchor)
      return
    }

    if (event.shiftKey) this.panX -= event.deltaY || event.deltaX
    else {
      this.panX -= event.deltaX
      this.panY -= event.deltaY
    }
    this.apply()
  }

  handlePointerDown(event) {
    // 官方操作是直接拖曳空白平移；Ctrl/Meta+拖曳保留給框選。
    const interactive = event.target.closest?.('.mind-node, button, input, select, textarea, [contenteditable="true"]')
    const shouldPan = event.button === 0 && !event.ctrlKey && !event.metaKey && !interactive
    if (!shouldPan) return
    event.preventDefault()
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: this.panX,
      panY: this.panY
    }
    this.canvas.classList.add('is-panning')
    this.canvas.setPointerCapture?.(event.pointerId)

    const move = moveEvent => {
      if (!this.drag || moveEvent.pointerId !== this.drag.pointerId) return
      this.panX = this.drag.panX + moveEvent.clientX - this.drag.startX
      this.panY = this.drag.panY + moveEvent.clientY - this.drag.startY
      this.apply()
    }
    const end = endEvent => {
      if (!this.drag || endEvent.pointerId !== this.drag.pointerId) return
      this.drag = null
      this.canvas.classList.remove('is-panning')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  setZoom(value, anchor = null) {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value)))
    if (!Number.isFinite(nextZoom) || nextZoom === this.zoom) return
    const point = anchor || { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 }
    const worldX = (point.x - this.panX) / this.zoom
    const worldY = (point.y - this.panY) / this.zoom
    this.zoom = nextZoom
    this.panX = point.x - worldX * this.zoom
    this.panY = point.y - worldY * this.zoom
    this.apply()
  }

  zoomBy(factor) {
    this.setZoom(this.zoom * factor)
  }

  resetZoom() {
    this.setZoom(1)
  }

  fit(positions, padding = 60) {
    const bounds = getLayoutBounds(positions)
    if (positions.size === 0) return
    if (!this.initialPlacementDone) {
      this.initialPlacementDone = true
      this.zoom = 1
      this.panX = (this.canvas.clientWidth - (bounds.minX + bounds.maxX)) / 2
      this.panY = (this.canvas.clientHeight - (bounds.minY + bounds.maxY)) / 2
      this.apply()
      return
    }
    const availableWidth = Math.max(1, this.canvas.clientWidth - padding * 2)
    const availableHeight = Math.max(1, this.canvas.clientHeight - padding * 2)
    const contentWidth = Math.max(1, bounds.width)
    const contentHeight = Math.max(1, bounds.height)
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(availableWidth / contentWidth, availableHeight / contentHeight)))
    this.panX = (this.canvas.clientWidth - (bounds.minX + bounds.maxX) * this.zoom) / 2
    this.panY = (this.canvas.clientHeight - (bounds.minY + bounds.maxY) * this.zoom) / 2
    this.apply()
  }

  centerOn(position) {
    if (!position) return false
    this.panX = this.canvas.clientWidth / 2 - (position.x + position.w / 2) * this.zoom
    this.panY = this.canvas.clientHeight / 2 - (position.y + position.h / 2) * this.zoom
    this.apply()
    return true
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top - this.panY) / this.zoom
    }
  }

  apply() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`
    if (this.zoomDisplay) this.zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`
    this.onChange(this.getState())
  }

  getState() {
    return { panX: this.panX, panY: this.panY, zoom: this.zoom }
  }
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}
