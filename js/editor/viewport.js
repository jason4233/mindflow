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
    this.listeners = new Set()
    this.spacePressed = false
    this.spaceKeyPressed = false
    this.handToolActive = false
    this.initialPlacementDone = false
    this.drag = null
    this.bindEvents()
    this.mountHandTool()
    this.apply()
  }

  bindEvents() {
    this.canvas.addEventListener('wheel', event => this.handleWheel(event), { passive: false })
    // capture 先於節點拖曳；手形模式才能可靠地把節點上的左鍵改成平移。
    this.canvas.addEventListener('pointerdown', event => this.handlePointerDown(event), true)
    this.canvas.addEventListener('click', event => {
      if (!this.spacePressed || event.target.closest?.('.zoom-controls')) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }, true)
    this.canvas.addEventListener('contextmenu', event => event.preventDefault())
    window.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) return
      // Space 在有明確編輯目標時屬於「編輯」快捷鍵；不能先被 pan mode
      // preventDefault，否則 KeyboardController 會把它視為已處理而 no-op。
      const hasEditableSelection = this.canvas.querySelector(
        '.mind-node.is-selected, .relation-overlay.is-selected, .summary-node.is-selected'
      )
      if (hasEditableSelection) return
      this.spaceKeyPressed = true
      this.updatePanMode()
      event.preventDefault()
    })
    window.addEventListener('keyup', event => {
      if (event.code !== 'Space') return
      this.spaceKeyPressed = false
      this.updatePanMode()
    })
    window.addEventListener('blur', () => {
      this.spaceKeyPressed = false
      this.updatePanMode()
    })
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
    if (event.target.closest?.('.zoom-controls')) return
    const interactive = event.target.closest?.('.mind-node, button, input, select, textarea, [contenteditable="true"]')
    const forcedPan = this.spacePressed
    const shouldPan = event.button === 0 && (
      forcedPan || (!event.ctrlKey && !event.metaKey && !interactive)
    )
    if (!shouldPan) return
    // 重入守衛：第二個 pointer（觸控雙指）不得覆蓋進行中的拖曳，否則舊的 window listener 永遠拆不掉
    if (this.drag) return
    event.preventDefault()
    if (forcedPan) event.stopImmediatePropagation()
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

  mountHandTool() {
    const controls = this.canvas.querySelector('.zoom-controls')
    if (!controls || controls.querySelector('[data-hand-tool]')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'zoom-button hand-tool-button'
    button.dataset.handTool = 'true'
    button.textContent = '✋'
    button.title = '手形工具'
    button.setAttribute('aria-label', '手形工具：拖曳任意位置平移畫布')
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => this.setHandTool(!this.handToolActive))
    const fullscreen = controls.querySelector('#fullscreen-button')
    controls.insertBefore(button, fullscreen || null)
    this.handToolButton = button
  }

  setHandTool(active) {
    const next = Boolean(active)
    if (next === this.handToolActive) return false
    this.handToolActive = next
    this.updatePanMode()
    return true
  }

  updatePanMode() {
    this.spacePressed = this.handToolActive || this.spaceKeyPressed
    this.canvas.classList.toggle('is-hand-tool', this.handToolActive)
    this.handToolButton?.classList.toggle('is-active', this.handToolActive)
    this.handToolButton?.setAttribute('aria-pressed', String(this.handToolActive))
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

  setPan(panX, panY) {
    const nextX = Number(panX)
    const nextY = Number(panY)
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return false
    if (nextX === this.panX && nextY === this.panY) return false
    this.panX = nextX
    this.panY = nextY
    this.apply()
    return true
  }

  setView({ panX = this.panX, panY = this.panY, zoom = this.zoom } = {}) {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(zoom)))
    const nextX = Number(panX)
    const nextY = Number(panY)
    if (![nextZoom, nextX, nextY].every(Number.isFinite)) return false
    this.zoom = nextZoom
    this.panX = nextX
    this.panY = nextY
    this.apply()
    return true
  }

  fit(positions, padding = 60) {
    const bounds = getLayoutBounds(positions)
    if (positions.size === 0) return
    if (!this.initialPlacementDone) {
      this.initialPlacementDone = true
      this.zoom = 1
      const focusId = new URLSearchParams(window.location.search).get('focus')
      const focusPosition = focusId ? positions.get(focusId) : null
      if (focusPosition) {
        this.centerOn(focusPosition)
        window.dispatchEvent(new CustomEvent('mindflow:focusnode', { detail: { id: focusId } }))
        return
      }
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

  getVisibleWorldRect() {
    return {
      x: -this.panX / this.zoom,
      y: -this.panY / this.zoom,
      width: this.canvas.clientWidth / this.zoom,
      height: this.canvas.clientHeight / this.zoom
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('viewport listener 必須是函式')
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  apply() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`
    if (this.zoomDisplay) this.zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`
    const state = this.getState()
    this.onChange(state)
    for (const listener of this.listeners) listener(state)
  }

  getState() {
    return { panX: this.panX, panY: this.panY, zoom: this.zoom }
  }
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}
