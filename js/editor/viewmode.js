/**
 * GAMMA 組裝入口：全域/局部佈局 action、Layout 分頁、三種檢視模式與小地圖。
 */
import { registerAction, runAction } from './actions.js'
import {
  LAYOUT_DEFINITIONS,
  createLayoutPreviewSvg,
  isLayoutName,
  normalizeLayoutName
} from './layout.js'
import { findNode, structuredCloneSafe, walkNodes } from './model.js'
import { initializeMinimap } from './minimap.js'
import { initializeOutline } from './outline.js'
import { registerOverlay } from './render.js'

const GAMMA_STATE_PREFIX = 'mindflow.gamma.'
const VIEW_MODE_PREFIX = 'mindflow.viewmode.'
const MANUAL_KEYS = ['offsetX', 'offsetY', 'manualX', 'manualY', 'manualOffset']

export function initializeGamma(ctx) {
  ensureStylesheet()
  restoreGammaState(ctx.doc)

  const viewMode = new ViewModeController(ctx)
  const outline = initializeOutline({
    ...ctx,
    container: viewMode.outlinePane,
    onJump: id => viewMode.jumpToMap(id)
  })
  viewMode.setOutline(outline)
  const minimap = initializeMinimap(ctx)

  registerGammaActions(ctx, viewMode, minimap)
  const layoutPanel = mountLayoutPanel(ctx)
  registerOverlay(() => layoutPanel.refresh())
  window.addEventListener('mindflow:selectionchange', () => layoutPanel.refresh())
  layoutPanel.refresh()

  return { viewMode, outline, minimap, layoutPanel }
}

function registerGammaActions(ctx, viewMode, minimap) {
  registerAction('setLayout', layoutName => setLayout(ctx, layoutName))
  registerAction('tidyLayout', () => tidyLayout(ctx))
  registerAction('setStructure', structure => setStructure(ctx, structure))
  registerAction('toggleOutline', () => viewMode.toggleOutline())
  registerAction('setViewMode', mode => viewMode.show(mode))
  registerAction('toggleMinimap', () => minimap.toggle())
  registerAction('openLayoutPanel', () => ctx.sidepanel?.showTab?.('layout'))
}

function setLayout(ctx, layoutName) {
  if (!isLayoutName(layoutName)) return false
  const next = normalizeLayoutName(layoutName)
  const previous = ctx.doc.layout
  if (normalizeLayoutName(previous) === next && previous === next) return false
  const command = {
    description: '切換全域佈局',
    affectedIds: [ctx.doc.root.id],
    do: () => {
      ctx.doc.layout = next
      saveGammaState(ctx.doc)
      return true
    },
    undo: () => {
      ctx.doc.layout = previous
      saveGammaState(ctx.doc)
    }
  }
  return ctx.manager.execute(command)
}

function setStructure(ctx, structure) {
  const id = ctx.selection?.primaryId
  const node = findNode(ctx.doc.root, id)
  if (!node) return false
  if (structure && structure !== 'inherit' && !isLayoutName(structure)) return false
  const next = structure && structure !== 'inherit' ? normalizeLayoutName(structure) : null
  const hadPrevious = Object.hasOwn(node.style, 'structure')
  const previous = node.style.structure
  if ((!hadPrevious && next === null) || previous === next) return false
  const apply = value => {
    if (value === null) delete node.style.structure
    else node.style.structure = value
    saveGammaState(ctx.doc)
  }
  return ctx.manager.execute({
    description: '設定局部結構',
    affectedIds: [id],
    do: () => { apply(next); return true },
    undo: () => {
      if (hadPrevious) apply(previous)
      else apply(null)
    }
  })
}

function tidyLayout(ctx) {
  const records = []
  walkNodes(ctx.doc.root, node => {
    const values = {}
    for (const key of MANUAL_KEYS) {
      if (Object.hasOwn(node.style || {}, key)) values[key] = structuredCloneSafe(node.style[key])
    }
    if (Object.keys(values).length > 0) records.push({ id: node.id, values })
  })
  const hadDocumentOffsets = Object.hasOwn(ctx.doc, 'manualOffsets')
  const documentOffsets = hadDocumentOffsets ? structuredCloneSafe(ctx.doc.manualOffsets) : null

  if (records.length === 0 && !hadDocumentOffsets) {
    ctx.renderAll()
    requestAnimationFrame(() => ctx.viewport.fit(ctx.getPositions()))
    return true
  }

  const clear = () => {
    records.forEach(record => {
      const node = findNode(ctx.doc.root, record.id)
      if (node) MANUAL_KEYS.forEach(key => delete node.style[key])
    })
    delete ctx.doc.manualOffsets
  }
  const changed = ctx.manager.execute({
    description: '一鍵整理佈局',
    affectedIds: records.map(record => record.id),
    do: () => { clear(); return true },
    undo: () => {
      records.forEach(record => {
        const node = findNode(ctx.doc.root, record.id)
        if (node) Object.assign(node.style, structuredCloneSafe(record.values))
      })
      if (hadDocumentOffsets) ctx.doc.manualOffsets = structuredCloneSafe(documentOffsets)
    }
  })
  if (changed) requestAnimationFrame(() => ctx.viewport.fit(ctx.getPositions()))
  return changed
}

function mountLayoutPanel(ctx) {
  const view = ctx.sidepanel?.panel?.querySelector('[data-panel-view="layout"]')
  if (!view) return { refresh() {} }
  const globalCards = LAYOUT_DEFINITIONS.map(item => `
    <button class="layout-card" type="button" data-layout-id="${item.id}" title="${item.name}">
      <span class="layout-card__preview">${createLayoutPreviewSvg(item.id)}</span>
      <span>${item.name}</span>
    </button>`).join('')
  const structureOptions = [
    '<option value="inherit">跟隨全域</option>',
    ...LAYOUT_DEFINITIONS.map(item => `<option value="${item.id}">${item.name}</option>`)
  ].join('')
  view.innerHTML = `
    <section class="panel-section layout-panel-section">
      <h3>全域佈局</h3>
      <div class="layout-grid">${globalCards}</div>
    </section>
    <section class="panel-section">
      <h3>選中節點的 Structure</h3>
      <p class="layout-help">只覆蓋此節點以下的子樹，未設定時跟隨全域。</p>
      <select class="panel-select" data-local-structure>${structureOptions}</select>
      <button class="panel-primary-button" type="button" data-tidy-layout>一鍵整理（Ctrl+Shift+L）</button>
    </section>`
  view.querySelectorAll('[data-layout-id]').forEach(button => {
    button.addEventListener('click', () => runAction('setLayout', button.dataset.layoutId))
  })
  view.querySelector('[data-local-structure]').addEventListener('change', event => runAction('setStructure', event.target.value))
  view.querySelector('[data-tidy-layout]').addEventListener('click', () => runAction('tidyLayout'))

  return {
    refresh() {
      const current = normalizeLayoutName(ctx.doc.layout)
      view.querySelectorAll('[data-layout-id]').forEach(button => {
        const active = button.dataset.layoutId === current
        button.classList.toggle('is-active', active)
        button.setAttribute('aria-pressed', String(active))
      })
      const node = findNode(ctx.doc.root, ctx.selection?.primaryId)
      const select = view.querySelector('[data-local-structure]')
      const value = node?.style?.structure ? normalizeLayoutName(node.style.structure) : 'inherit'
      if (select.value !== value) select.value = value
      select.disabled = !node
    }
  }
}

class ViewModeController {
  constructor(ctx) {
    this.ctx = ctx
    this.outline = null
    this.mode = 'map'
    this.build()
    this.bindEvents()
    const restored = localStorage.getItem(`${VIEW_MODE_PREFIX}${ctx.doc.id}`)
    this.show(['map', 'outline', 'split'].includes(restored) ? restored : 'map', { persist: false })
  }

  build() {
    const shell = this.ctx.elements.canvas.closest('.editor-shell')
    this.shell = shell
    this.control = document.createElement('div')
    this.control.className = 'viewmode-control'
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'viewmode-button'
    this.button.setAttribute('aria-haspopup', 'menu')
    this.button.setAttribute('aria-expanded', 'false')
    this.menu = document.createElement('div')
    this.menu.className = 'viewmode-menu'
    this.menu.hidden = true
    this.menu.setAttribute('role', 'menu')
    const modes = [
      ['map', '心智圖', '⌘'],
      ['outline', '大綱', '☷'],
      ['split', '大綱 + 心智圖', '◫']
    ]
    modes.forEach(([id, label, icon]) => {
      const option = document.createElement('button')
      option.type = 'button'
      option.dataset.viewMode = id
      option.setAttribute('role', 'menuitemradio')
      option.innerHTML = `<span>${icon}</span><span>${label}</span>`
      this.menu.append(option)
    })
    this.control.append(this.button, this.menu)

    this.outlinePane = document.createElement('section')
    this.outlinePane.className = 'outline-pane'
    this.outlinePane.hidden = true
    this.outlinePane.setAttribute('aria-label', '大綱視圖')
    shell.insertBefore(this.outlinePane, shell.querySelector('#sidepanel'))
    shell.append(this.control)
  }

  bindEvents() {
    this.button.addEventListener('click', event => {
      event.stopPropagation()
      this.menu.hidden = !this.menu.hidden
      this.button.setAttribute('aria-expanded', String(!this.menu.hidden))
    })
    this.menu.addEventListener('click', event => {
      const option = event.target.closest('[data-view-mode]')
      if (option) this.show(option.dataset.viewMode)
    })
    document.addEventListener('click', event => {
      if (!this.control.contains(event.target)) this.closeMenu()
    })
  }

  setOutline(outline) {
    this.outline = outline
    if (this.mode === 'map') outline.close()
    else outline.open()
  }

  show(mode, { persist = true } = {}) {
    if (!['map', 'outline', 'split'].includes(mode)) return false
    this.mode = mode
    this.shell.dataset.viewMode = mode
    // 大綱佔右側時先收起樣式面板，避免 326px 浮層遮住大部分文字區。
    if (mode !== 'map') this.ctx.sidepanel?.setOpen?.(false)
    const canvas = this.ctx.elements.canvas
    canvas.hidden = mode === 'outline'
    this.outlinePane.hidden = mode === 'map'
    if (mode === 'map') this.outline?.close()
    else this.outline?.open()
    this.button.textContent = mode === 'map' ? '心智圖 ▾' : mode === 'outline' ? '大綱 ▾' : '並排 ▾'
    this.menu.querySelectorAll('[data-view-mode]').forEach(option => {
      const active = option.dataset.viewMode === mode
      option.classList.toggle('is-active', active)
      option.setAttribute('aria-checked', String(active))
    })
    this.closeMenu()
    if (persist) localStorage.setItem(`${VIEW_MODE_PREFIX}${this.ctx.doc.id}`, mode)
    if (mode !== 'outline') {
      requestAnimationFrame(() => {
        const id = this.ctx.selection?.primaryId || this.ctx.doc.root.id
        this.ctx.viewport.centerOn(this.ctx.getPositions().get(id))
      })
    }
    return true
  }

  toggleOutline() {
    return this.show(this.mode === 'map' ? 'outline' : 'map')
  }

  jumpToMap(id) {
    if (this.mode === 'outline') this.show('split')
    requestAnimationFrame(() => {
      const position = this.ctx.getPositions().get(id)
      if (position) this.ctx.viewport.centerOn(position)
    })
  }

  closeMenu() {
    this.menu.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
  }
}

function restoreGammaState(doc) {
  const state = readState(doc.id)
  if (state.layout && isLayoutName(state.layout)) doc.layout = normalizeLayoutName(state.layout)
  const structures = state.structures && typeof state.structures === 'object' ? state.structures : {}
  walkNodes(doc.root, node => {
    const structure = structures[node.id]
    if (isLayoutName(structure)) node.style.structure = normalizeLayoutName(structure)
  })
}

function saveGammaState(doc) {
  const structures = {}
  walkNodes(doc.root, node => {
    if (isLayoutName(node.style?.structure)) structures[node.id] = normalizeLayoutName(node.style.structure)
  })
  localStorage.setItem(`${GAMMA_STATE_PREFIX}${doc.id}`, JSON.stringify({
    layout: normalizeLayoutName(doc.layout),
    structures
  }))
}

function readState(id) {
  try {
    return JSON.parse(localStorage.getItem(`${GAMMA_STATE_PREFIX}${id}`) || '{}')
  } catch {
    return {}
  }
}

function ensureStylesheet() {
  if (document.querySelector('link[data-gamma-layouts]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = new URL('../../css/layouts.css', import.meta.url).href
  link.dataset.gammaLayouts = 'true'
  document.head.append(link)
}
