/**
 * 演示模式與 C1 面板 command：演示只切換視圖，所有樣式異動仍走可逆 command。
 */
import { registerAction, runAction } from './actions.js'
import { findNode, findNodeContext, structuredCloneSafe } from './model.js'
import {
  getLineAppearance,
  getTheme,
  withLineAppearance,
  withNodeShape,
  withScopedSpacing
} from './themes.js'

export function buildPresentationSteps(root) {
  if (!root) return []
  const rootStep = { branchId: root.id, label: root.text || '中心主題', ids: [root.id] }
  const branchSteps = (root.children || []).map(branch => ({
    branchId: branch.id,
    label: branch.text || '分支',
    ids: [root.id, ...collectIds(branch)]
  }))
  return [rootStep, ...branchSteps]
}

export function createSummaryStyleCommand(doc, summaryId, patch = {}) {
  const allowed = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => (
      ['lineColor', 'lineStyle', 'fill'].includes(key) && typeof value === 'string' && value
    ))
  )
  let previous = null
  return {
    description: '設定概要樣式',
    affectedIds: [summaryId],
    do: () => {
      const summary = doc.summaries?.find(item => item.id === summaryId)
      if (!summary || Object.keys(allowed).length === 0) return false
      const next = { ...(summary.style || {}), ...allowed }
      if (JSON.stringify(next) === JSON.stringify(summary.style || {})) return false
      if (!previous) previous = structuredCloneSafe(summary.style || {})
      summary.style = next
      return true
    },
    undo: () => {
      const summary = doc.summaries?.find(item => item.id === summaryId)
      if (summary && previous) summary.style = structuredCloneSafe(previous)
    }
  }
}

export function initPresentation(ctx) {
  ensurePresentationStylesheet()
  registerC1PanelActions(ctx)

  const controller = new PresentationController(ctx)
  registerAction('presentation', () => controller.enter())
  return controller
}

export class PresentationController {
  constructor(ctx) {
    this.ctx = ctx
    this.steps = []
    this.index = 0
    this.active = false
    this.restoreView = null
    this.contextNodeId = null
    this.enteredFullscreen = false
    this.overlay = createPresentationOverlay()
    this.progress = this.overlay.querySelector('[data-presentation-progress]')
    this.menu = this.overlay.querySelector('[data-presentation-menu]')
    this.caption = this.overlay.querySelector('[data-presentation-caption]')
    this.handleKeydown = event => this.onKeydown(event)
    this.handleClick = event => this.onCanvasClick(event)
    this.handleContextMenu = event => this.onContextMenu(event)
    this.handleFullscreenChange = () => {
      if (this.active && this.enteredFullscreen && !document.fullscreenElement) this.exit({ leaveFullscreen: false })
    }
    this.bindOverlay()
  }

  bindOverlay() {
    this.menu.addEventListener('click', event => {
      const action = event.target.closest('[data-presentation-action]')?.dataset.presentationAction
      if (!action) return
      event.stopPropagation()
      this.menu.hidden = true
      if (action === 'from-current') this.startFromCurrentNode()
      if (action === 'end') this.show(this.steps.length - 1)
      if (action === 'exit') this.exit()
    })
    this.progress.addEventListener('click', event => {
      const dot = event.target.closest('[data-presentation-step]')
      if (!dot) return
      event.stopPropagation()
      this.show(Number(dot.dataset.presentationStep))
    })
  }

  enter() {
    if (this.active) return false
    this.steps = buildPresentationSteps(this.ctx.doc.root)
    if (this.steps.length === 0) return false
    if (document.body.classList.contains('is-c1-focus-mode')) runAction('focus')
    this.active = true
    this.index = 0
    this.restoreView = this.ctx.viewport.getState()
    document.body.classList.add('is-presentation-mode')
    this.overlay.hidden = false
    this.renderProgress()
    this.bindRuntimeEvents()
    this.show(0)

    const request = document.documentElement.requestFullscreen?.()
    Promise.resolve(request).then(() => {
      this.enteredFullscreen = Boolean(document.fullscreenElement)
    }).catch(() => {
      // 瀏覽器拒絕全螢幕時仍保留可用的頁內演示。
      this.enteredFullscreen = false
    })
    return true
  }

  exit({ leaveFullscreen = true } = {}) {
    if (!this.active) return false
    this.active = false
    this.unbindRuntimeEvents()
    this.menu.hidden = true
    this.overlay.hidden = true
    document.body.classList.remove('is-presentation-mode')
    for (const element of this.ctx.elements.nodesLayer.querySelectorAll('.mind-node')) {
      element.classList.remove('is-presentation-visible', 'is-presentation-muted')
    }
    if (this.restoreView) this.ctx.viewport.setView(this.restoreView)
    if (leaveFullscreen && this.enteredFullscreen && document.fullscreenElement) {
      Promise.resolve(document.exitFullscreen?.()).catch(() => {})
    }
    this.enteredFullscreen = false
    return true
  }

  bindRuntimeEvents() {
    document.addEventListener('keydown', this.handleKeydown, true)
    this.ctx.elements.canvas.addEventListener('click', this.handleClick, true)
    this.ctx.elements.canvas.addEventListener('contextmenu', this.handleContextMenu, true)
    document.addEventListener('fullscreenchange', this.handleFullscreenChange)
  }

  unbindRuntimeEvents() {
    document.removeEventListener('keydown', this.handleKeydown, true)
    this.ctx.elements.canvas.removeEventListener('click', this.handleClick, true)
    this.ctx.elements.canvas.removeEventListener('contextmenu', this.handleContextMenu, true)
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange)
  }

  onKeydown(event) {
    if (!this.active) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.exit()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.next()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.previous()
    }
  }

  onCanvasClick(event) {
    if (!this.active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.menu.hidden = true
    this.next()
  }

  onContextMenu(event) {
    if (!this.active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.contextNodeId = event.target.closest('.mind-node')?.dataset.nodeId || this.steps[this.index]?.branchId
    this.menu.style.left = `${Math.min(window.innerWidth - 210, Math.max(12, event.clientX))}px`
    this.menu.style.top = `${Math.min(window.innerHeight - 150, Math.max(12, event.clientY))}px`
    this.menu.hidden = false
  }

  next() {
    this.show(Math.min(this.steps.length - 1, this.index + 1))
  }

  previous() {
    this.show(Math.max(0, this.index - 1))
  }

  startFromCurrentNode() {
    const branchId = topLevelBranchId(this.ctx.doc.root, this.contextNodeId)
    const index = this.steps.findIndex(step => step.branchId === branchId)
    this.show(index >= 0 ? index : 0)
  }

  show(index) {
    if (!this.active || this.steps.length === 0) return
    this.index = Math.max(0, Math.min(this.steps.length - 1, Number(index) || 0))
    const step = this.steps[this.index]
    const visible = new Set(step.ids)
    for (const element of this.ctx.elements.nodesLayer.querySelectorAll('.mind-node')) {
      const active = visible.has(element.dataset.nodeId)
      element.classList.toggle('is-presentation-visible', active)
      element.classList.toggle('is-presentation-muted', !active)
    }
    this.caption.textContent = step.label
    this.progress.querySelectorAll('[data-presentation-step]').forEach((dot, dotIndex) => {
      dot.classList.toggle('is-active', dotIndex === this.index)
      dot.setAttribute('aria-current', dotIndex === this.index ? 'step' : 'false')
    })
    const positions = this.ctx.getPositions()
    const focusPositions = new Map(step.ids.map(id => [id, positions.get(id)]).filter(([, position]) => position))
    requestAnimationFrame(() => this.ctx.viewport.fit(focusPositions, 130))
  }

  renderProgress() {
    this.progress.replaceChildren(...this.steps.map((step, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.presentationStep = String(index)
      button.title = step.label
      button.setAttribute('aria-label', `第 ${index + 1} 步：${step.label}`)
      return button
    }))
  }
}

function registerC1PanelActions(ctx) {
  const spacingPreviews = new Map()

  registerAction('setNodeShape', shape => mutateSelectedStyles(ctx, '設定節點形狀', node => {
    node.style.shape = withNodeShape(node.style.shape || '', shape)
  }))

  // 覆寫舊 action，避免只改線型時把主題的 lineShape 寫死在節點 token。
  registerAction('setLineStyle', (config = {}) => mutateSelectedStyles(ctx, '設定連接線樣式', (node, context) => {
    const selectedTheme = getTheme(ctx.doc.themeId)
    const current = getLineAppearance(node, context.depth, selectedTheme)
    const shapeExplicit = Object.hasOwn(config, 'shape')
    const nextStyle = config.style || current.style
    const nextShape = shapeExplicit ? config.shape : current.shape
    node.style.lineStyle = withLineAppearance(node.style.lineStyle || '', {
      lineStyle: nextStyle,
      lineShape: nextShape,
      themeShape: selectedTheme.lineShape,
      shapeExplicit,
      styleExplicit: Object.hasOwn(config, 'style')
    })
  }))

  registerAction('applySummaryStyle', patch => {
    const selected = runAction('getSelectedOverlay')
    return selected?.type === 'summary'
      ? ctx.manager.execute(createSummaryStyleCommand(ctx.doc, selected.id, patch))
      : false
  })

  registerAction('previewScopedSpacing', (key, patch = {}) => {
    const id = ctx.selection.primaryId
    const node = findNode(ctx.doc.root, id)
    if (!node) return false
    const sessionKey = `${id}:${key}`
    if (!spacingPreviews.has(sessionKey)) spacingPreviews.set(sessionKey, node.style.lineStyle)
    node.style.lineStyle = withScopedSpacing(node.style.lineStyle || '', patch)
    ctx.manager.preview()
    return true
  })

  registerAction('commitScopedSpacing', (key, patch = {}) => {
    const id = ctx.selection.primaryId
    const node = findNode(ctx.doc.root, id)
    if (!node) return false
    const sessionKey = `${id}:${key}`
    if (spacingPreviews.has(sessionKey)) {
      const previous = spacingPreviews.get(sessionKey)
      if (previous === undefined) delete node.style.lineStyle
      else node.style.lineStyle = previous
      spacingPreviews.delete(sessionKey)
    }
    return ctx.manager.execute(setScopedSpacingCommand(ctx.doc, id, patch))
  })
}

function setScopedSpacingCommand(doc, nodeId, patch) {
  let previous
  return {
    description: '設定選取子樹間距',
    affectedIds: [nodeId],
    do: () => {
      const node = findNode(doc.root, nodeId)
      if (!node) return false
      if (previous === undefined) previous = node.style.lineStyle
      const next = withScopedSpacing(node.style.lineStyle || '', patch)
      if (next === node.style.lineStyle) return false
      node.style.lineStyle = next
      return true
    },
    undo: () => {
      const node = findNode(doc.root, nodeId)
      if (!node) return
      if (previous === undefined) delete node.style.lineStyle
      else node.style.lineStyle = previous
    }
  }
}

function mutateSelectedStyles(ctx, description, mutate) {
  const ids = ctx.selection.getSelectedIds()
  if (ids.length === 0) return false
  let previous = null
  return ctx.manager.execute({
    description,
    affectedIds: ids.slice(),
    do: () => {
      const records = ids.map(id => findNodeContext(ctx.doc.root, id)).filter(Boolean)
      if (records.length === 0) return false
      if (!previous) previous = records.map(record => ({ id: record.node.id, style: structuredCloneSafe(record.node.style) }))
      const before = records.map(record => JSON.stringify(record.node.style))
      records.forEach(record => mutate(record.node, record))
      return records.some((record, index) => JSON.stringify(record.node.style) !== before[index])
    },
    undo: () => {
      for (const record of previous || []) {
        const node = findNode(ctx.doc.root, record.id)
        if (node) node.style = structuredCloneSafe(record.style)
      }
    }
  })
}

function createPresentationOverlay() {
  const overlay = document.createElement('div')
  overlay.className = 'presentation-ui'
  overlay.hidden = true
  overlay.innerHTML = `
    <div class="presentation-caption" data-presentation-caption></div>
    <nav class="presentation-progress" data-presentation-progress aria-label="演示進度"></nav>
    <div class="presentation-menu" data-presentation-menu hidden>
      <button type="button" data-presentation-action="from-current">從當前節點開始</button>
      <button type="button" data-presentation-action="end">跳到結尾</button>
      <button type="button" data-presentation-action="exit">退出演示</button>
    </div>`
  document.body.append(overlay)
  return overlay
}

function collectIds(node) {
  return [node.id, ...(node.children || []).flatMap(collectIds)]
}

function topLevelBranchId(root, nodeId) {
  if (!nodeId || nodeId === root.id) return root.id
  for (const branch of root.children || []) {
    if (collectIds(branch).includes(nodeId)) return branch.id
  }
  return root.id
}

function ensurePresentationStylesheet() {
  if (document.querySelector('link[data-c1-presentation]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = new URL('../../css/presentation.css', import.meta.url).href
  link.dataset.c1Presentation = 'true'
  document.head.append(link)
}
