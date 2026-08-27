/**
 * 右下導航器：透過 render overlay hook 接收最新座標，紅框與 viewport 即時同步。
 */
import { getLayoutBounds } from './layout.js'
import { walkNodes } from './model.js'
import { registerOverlay } from './render.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const STORAGE_KEY = 'mindflow.minimap.open'

export function initializeMinimap({ elements, viewport }) {
  if (!elements?.canvas || !viewport) return { toggle() {}, update() {} }
  return new MinimapController({ canvas: elements.canvas, viewport })
}

class MinimapController {
  constructor({ canvas, viewport }) {
    this.canvas = canvas
    this.viewport = viewport
    this.transform = null
    this.latestContext = null
    this.drag = null
    this.build()
    this.bindEvents()
    this.unregisterOverlay = registerOverlay(context => this.draw(context))
    this.unsubscribeViewport = viewport.subscribe(() => this.updateViewportFrame())
    this.setOpen(localStorage.getItem(STORAGE_KEY) === 'true')
  }

  build() {
    const controls = this.canvas.querySelector('.zoom-controls')
    this.toggleButton = document.createElement('button')
    this.toggleButton.type = 'button'
    this.toggleButton.className = 'zoom-button minimap-toggle'
    this.toggleButton.textContent = '⌖'
    this.toggleButton.title = '小地圖'
    this.toggleButton.setAttribute('aria-label', '切換小地圖')
    controls?.append(this.toggleButton)

    this.panel = document.createElement('section')
    this.panel.className = 'minimap-panel'
    this.panel.hidden = true
    this.panel.setAttribute('aria-label', '小地圖導航器')
    this.svg = document.createElementNS(SVG_NS, 'svg')
    this.svg.setAttribute('viewBox', '0 0 216 136')
    this.svg.setAttribute('role', 'img')
    this.svg.setAttribute('aria-label', '心智圖縮圖，拖曳紅框移動畫布')
    this.content = document.createElementNS(SVG_NS, 'g')
    this.content.classList.add('minimap-content')
    this.viewportRect = document.createElementNS(SVG_NS, 'rect')
    this.viewportRect.classList.add('minimap-viewport')
    this.viewportRect.setAttribute('rx', '2')
    this.svg.append(this.content, this.viewportRect)
    this.panel.append(this.svg)
    this.canvas.append(this.panel)
  }

  bindEvents() {
    this.toggleButton.addEventListener('click', () => this.setOpen(this.panel.hidden))
    this.viewportRect.addEventListener('pointerdown', event => this.startDrag(event))
    this.svg.addEventListener('pointerdown', event => {
      if (event.target === this.viewportRect) return
      this.centerAt(event)
    })
  }

  setOpen(open) {
    const next = Boolean(open)
    this.panel.hidden = !next
    this.toggleButton.classList.toggle('is-active', next)
    this.toggleButton.setAttribute('aria-pressed', String(next))
    localStorage.setItem(STORAGE_KEY, String(next))
    if (next && this.latestContext) this.draw(this.latestContext)
    return next
  }

  toggle() {
    return this.setOpen(this.panel.hidden)
  }

  draw(context) {
    // 只留重繪所需的最小資料，不長期抓著整包 nodeLookup/branchLookup 不放
    this.latestContext = { doc: context.doc, positions: context.positions }
    if (this.panel.hidden || !context.positions?.size) return
    const bounds = getLayoutBounds(context.positions)
    const padding = 12
    const scale = Math.min(
      (216 - padding * 2) / Math.max(1, bounds.width),
      (136 - padding * 2) / Math.max(1, bounds.height)
    )
    const offsetX = (216 - bounds.width * scale) / 2 - bounds.minX * scale
    const offsetY = (136 - bounds.height * scale) / 2 - bounds.minY * scale
    this.transform = { scale, offsetX, offsetY }

    const parentLookup = new Map()
    walkNodes(context.doc.root, (node, parent) => {
      if (parent) parentLookup.set(node.id, parent.id)
    }, { includeHidden: false })
    const fragment = document.createDocumentFragment()
    for (const [childId, parentId] of parentLookup) {
      const parent = context.positions.get(parentId)
      const child = context.positions.get(childId)
      if (!parent || !child) continue
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', format((parent.x + parent.w / 2) * scale + offsetX))
      line.setAttribute('y1', format((parent.y + parent.h / 2) * scale + offsetY))
      line.setAttribute('x2', format((child.x + child.w / 2) * scale + offsetX))
      line.setAttribute('y2', format((child.y + child.h / 2) * scale + offsetY))
      fragment.append(line)
    }
    for (const [id, position] of context.positions) {
      const rect = document.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('x', format(position.x * scale + offsetX))
      rect.setAttribute('y', format(position.y * scale + offsetY))
      rect.setAttribute('width', format(Math.max(2, position.w * scale)))
      rect.setAttribute('height', format(Math.max(2, position.h * scale)))
      rect.setAttribute('rx', id === context.doc.root.id ? '3' : '1.5')
      if (id === context.doc.root.id) rect.classList.add('is-root')
      fragment.append(rect)
    }
    this.content.replaceChildren(fragment)
    this.updateViewportFrame()
  }

  updateViewportFrame() {
    if (this.panel.hidden || !this.transform) return
    const visible = this.viewport.getVisibleWorldRect()
    const { scale, offsetX, offsetY } = this.transform
    this.viewportRect.setAttribute('x', format(visible.x * scale + offsetX))
    this.viewportRect.setAttribute('y', format(visible.y * scale + offsetY))
    this.viewportRect.setAttribute('width', format(Math.max(8, visible.width * scale)))
    this.viewportRect.setAttribute('height', format(Math.max(8, visible.height * scale)))
  }

  startDrag(event) {
    if (!this.transform) return
    // 重入守衛：拖曳進行中不接受第二個 pointer（避免 window listener 孤兒化）
    if (this.drag) return
    event.preventDefault()
    event.stopPropagation()
    const visible = this.viewport.getVisibleWorldRect()
    this.drag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: visible.x,
      worldY: visible.y
    }
    this.viewportRect.setPointerCapture?.(event.pointerId)
    const move = moveEvent => {
      if (!this.drag || moveEvent.pointerId !== this.drag.pointerId) return
      const dx = (moveEvent.clientX - this.drag.clientX) / this.transform.scale
      const dy = (moveEvent.clientY - this.drag.clientY) / this.transform.scale
      this.viewport.setPan(-(this.drag.worldX + dx) * this.viewport.zoom, -(this.drag.worldY + dy) * this.viewport.zoom)
    }
    const end = endEvent => {
      if (!this.drag || endEvent.pointerId !== this.drag.pointerId) return
      this.drag = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  centerAt(event) {
    if (!this.transform) return
    event.preventDefault()
    const rect = this.svg.getBoundingClientRect()
    const miniX = (event.clientX - rect.left) * (216 / Math.max(1, rect.width))
    const miniY = (event.clientY - rect.top) * (136 / Math.max(1, rect.height))
    const worldX = (miniX - this.transform.offsetX) / this.transform.scale
    const worldY = (miniY - this.transform.offsetY) / this.transform.scale
    this.viewport.setPan(
      this.canvas.clientWidth / 2 - worldX * this.viewport.zoom,
      this.canvas.clientHeight / 2 - worldY * this.viewport.zoom
    )
  }
}

function format(value) {
  return String(Number(value.toFixed(2)))
}
