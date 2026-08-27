/**
 * Icon 分頁、原創 SVG 圖示、emoji/符號與 manifest 貼紙插入。
 */
import { registerAction } from './actions.js'
import { findNode, structuredCloneSafe } from './model.js'
import { registerOverlay } from './render.js'

const PRIORITY_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']
const PROGRESS_VALUES = [0, 12.5, 25, 37.5, 50, 62.5, 75, 100]
const FLAGS = [
  ['red', '#ef4444'], ['orange', '#f97316'], ['yellow', '#eab308'],
  ['green', '#22c55e'], ['blue', '#3b82f6'], ['purple', '#8b5cf6']
]
const EMOJIS = ['😀', '😍', '🤔', '😮', '😴', '😎', '🥳', '😢', '😡', '👍', '👏', '🙏', '💡', '🔥', '⭐', '❤️', '✅', '❌']
const SYMBOLS = ['★', '◆', '●', '▲', '■', '✓', '!', '?', '→', '∞', '§', '※']

export function toggleNodeIconCommand(doc, nodeId, category, value) {
  const token = `${category}:${value}`
  let previous = null
  return {
    description: '切換節點圖示',
    token,
    do: () => {
      const node = findNode(doc.root, nodeId)
      if (!node) return false
      if (!previous) previous = structuredCloneSafe(node.icons || [])
      const current = Array.isArray(node.icons) ? node.icons : []
      node.icons = current.includes(token)
        ? current.filter(item => item !== token)
        : [...current.filter(item => !item.startsWith(`${category}:`)), token]
      return JSON.stringify(node.icons) !== JSON.stringify(previous)
    },
    undo: () => {
      const node = findNode(doc.root, nodeId)
      if (node && previous) node.icons = structuredCloneSafe(previous)
    }
  }
}

export function createPrioritySvg(priority, size = 24) {
  const number = Math.max(1, Math.min(9, Number(priority) || 1))
  const color = PRIORITY_COLORS[number - 1]
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${color}"/><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-opacity=".42"/><text x="12" y="12.7" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Segoe UI,sans-serif" font-size="12" font-weight="800">${number}</text></svg>`
}

export function createProgressSvg(value, size = 24) {
  const progress = Math.max(0, Math.min(100, Number(value) || 0))
  const radius = 8
  let fill = ''
  if (progress >= 100) fill = '<circle cx="12" cy="12" r="8" fill="#22c55e"/>'
  else if (progress > 0) {
    const angle = progress / 100 * Math.PI * 2 - Math.PI / 2
    const x = 12 + radius * Math.cos(angle)
    const y = 12 + radius * Math.sin(angle)
    const largeArc = progress > 50 ? 1 : 0
    fill = `<path d="M12 12 L12 4 A8 8 0 ${largeArc} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z" fill="#22c55e"/>`
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#fff" stroke="#94a3b8"/>${fill}<circle cx="12" cy="12" r="8" fill="none" stroke="#22c55e" stroke-opacity=".34"/></svg>`
}

export function createFlagSvg(color, size = 24) {
  const safeColor = FLAGS.find(([id]) => id === color)?.[1] || FLAGS[0][1]
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M6 21V3" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round"/><path d="M7 4.5C11 2.5 14 6.4 19 4.2V14c-5 2.2-8-1.7-12 .3Z" fill="${safeColor}" stroke="#fff" stroke-opacity=".5"/></svg>`
}

export function flattenStickerManifest(manifest) {
  return Object.entries(manifest || {}).flatMap(([category, items]) => (Array.isArray(items) ? items : []).map(item => ({ ...item, category })))
}

export function initializeIconPanel(ctx) {
  const view = document.querySelector('[data-panel-view="icon"]')
  if (!view) return
  const stickerMap = new Map()
  buildIconPanel(view, ctx, stickerMap)
  registerOverlay(overlayCtx => decorateNodeIcons(overlayCtx, stickerMap))

  const showSection = section => {
    ctx.sidepanel.showTab('icon')
    view.querySelectorAll('[data-icon-section]').forEach(element => { element.hidden = element.dataset.iconSection !== section })
    view.querySelectorAll('[data-icon-subtab]').forEach(button => button.classList.toggle('is-active', button.dataset.iconSubtab === section))
  }
  registerAction('openIcons', () => { showSection('icons'); return true })
  registerAction('openStickerPanel', () => { showSection('stickers'); return true })
  for (let value = 1; value <= 9; value += 1) registerAction(`priority${value}`, () => applyIcon(ctx, 'priority', String(value)))

  view.addEventListener('click', event => {
    const subtab = event.target.closest('[data-icon-subtab]')
    if (subtab) { showSection(subtab.dataset.iconSubtab); return }
    const button = event.target.closest('[data-icon-value]')
    if (!button) return
    applyIcon(ctx, button.dataset.iconCategory, button.dataset.iconValue)
  })
  window.addEventListener('mindflow:selectionchange', () => refreshActiveIcons(view, ctx))
  refreshActiveIcons(view, ctx)

  loadStickers(view, stickerMap, ctx)
}

function buildIconPanel(view, ctx, stickerMap) {
  view.innerHTML = `
    <div class="subtabs icon-subtabs"><button type="button" class="is-active" data-icon-subtab="icons">圖示</button><button type="button" data-icon-subtab="stickers">貼紙</button></div>
    <div data-icon-section="icons">
      <section class="panel-section"><h3>優先順序 <small>Ctrl+1…9</small></h3><div class="feature-icon-grid" data-priority-grid></div></section>
      <section class="panel-section"><h3>進度</h3><div class="feature-icon-grid" data-progress-grid></div></section>
      <section class="panel-section"><h3>旗幟</h3><div class="feature-icon-grid" data-flag-grid></div></section>
      <section class="panel-section"><h3>表情</h3><div class="feature-icon-grid feature-icon-grid--emoji" data-emoji-grid></div></section>
      <section class="panel-section"><h3>符號</h3><div class="feature-icon-grid feature-icon-grid--emoji" data-symbol-grid></div></section>
    </div>
    <div data-icon-section="stickers" hidden><div class="sticker-status">載入貼紙中…</div><div class="sticker-categories"></div></div>`

  const addButton = (mount, category, value, label, content, useHtml = true) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'feature-icon-button'
    button.dataset.iconCategory = category
    button.dataset.iconValue = value
    button.title = label
    button.setAttribute('aria-label', label)
    if (useHtml) button.innerHTML = content
    else button.textContent = content
    mount.append(button)
  }
  PRIORITY_COLORS.forEach((_, index) => addButton(view.querySelector('[data-priority-grid]'), 'priority', String(index + 1), `優先順序 ${index + 1}`, createPrioritySvg(index + 1, 28)))
  PROGRESS_VALUES.forEach(value => addButton(view.querySelector('[data-progress-grid]'), 'progress', String(value), `進度 ${value}%`, createProgressSvg(value, 28)))
  FLAGS.forEach(([id]) => addButton(view.querySelector('[data-flag-grid]'), 'flag', id, `${id} 旗幟`, createFlagSvg(id, 28)))
  EMOJIS.forEach(value => addButton(view.querySelector('[data-emoji-grid]'), 'emoji', value, value, value, false))
  SYMBOLS.forEach(value => addButton(view.querySelector('[data-symbol-grid]'), 'symbol', value, value, value, false))
}

async function loadStickers(view, stickerMap, ctx) {
  const status = view.querySelector('.sticker-status')
  const mount = view.querySelector('.sticker-categories')
  try {
    const response = await fetch('assets/stickers/manifest.json')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = await response.json()
    const labels = { business: '商務', education: '教育', technology: '科技', expressions: '表情', travel: '旅行', weather: '天氣' }
    const items = flattenStickerManifest(manifest)
    items.forEach(item => stickerMap.set(item.id, item))
    status.textContent = `36 張原創貼紙 · ${items.length} 張已載入`
    for (const [category, entries] of Object.entries(manifest)) {
      const section = document.createElement('section')
      section.className = 'panel-section sticker-section'
      const heading = document.createElement('h3')
      heading.textContent = labels[category] || category
      const grid = document.createElement('div')
      grid.className = 'sticker-grid'
      entries.forEach(item => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'sticker-button'
        button.dataset.iconCategory = 'sticker'
        button.dataset.iconValue = item.id
        button.title = item.name
        const image = document.createElement('img')
        image.src = item.file
        image.alt = item.name
        const label = document.createElement('span')
        label.textContent = item.name
        button.append(image, label)
        grid.append(button)
      })
      section.append(heading, grid)
      mount.append(section)
    }
  } catch (error) {
    console.error('貼紙 manifest 載入失敗', error)
    status.textContent = '貼紙載入失敗'
    ctx.notify('貼紙清單載入失敗')
  }
}

function applyIcon(ctx, category, value) {
  const id = ctx.selection.primaryId
  if (!id) { ctx.notify('請先選取節點'); return false }
  return ctx.manager.execute(toggleNodeIconCommand(ctx.doc, id, category, value))
}

function refreshActiveIcons(view, ctx) {
  const node = findNode(ctx.doc.root, ctx.selection.primaryId)
  const icons = new Set(node?.icons || [])
  view.querySelectorAll('[data-icon-value]').forEach(button => {
    button.classList.toggle('is-active', icons.has(`${button.dataset.iconCategory}:${button.dataset.iconValue}`))
  })
}

function decorateNodeIcons({ doc, positions, nodesLayer, nodeLookup }, stickerMap) {
  for (const id of positions.keys()) {
    const node = nodeLookup?.get(id)?.node || findNode(doc.root, id)
    const element = nodesLayer.querySelector(`[data-node-id="${cssEscape(id)}"]`)
    if (!node || !element || !node.icons?.length) continue
    const strip = document.createElement('span')
    strip.className = 'node-icon-strip'
    for (const token of node.icons) {
      const separator = token.indexOf(':')
      if (separator < 1) continue
      const category = token.slice(0, separator)
      const value = token.slice(separator + 1)
      if (category === 'sticker') {
        const sticker = stickerMap.get(value)
        if (!sticker) continue
        const image = document.createElement('img')
        image.className = 'node-sticker'
        image.src = sticker.file
        image.alt = sticker.name
        image.title = sticker.name
        strip.append(image)
        continue
      }
      const icon = document.createElement('span')
      icon.className = 'node-inline-icon'
      if (category === 'priority') icon.innerHTML = createPrioritySvg(value, 20)
      else if (category === 'progress') icon.innerHTML = createProgressSvg(value, 20)
      else if (category === 'flag') icon.innerHTML = createFlagSvg(value, 20)
      else if (category === 'emoji' || category === 'symbol') icon.textContent = value
      else continue
      strip.append(icon)
    }
    if (strip.childElementCount) element.append(strip)
  }
}

function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
