/**
 * 右側 Style / Theme / Background 面板；所有文件異動透過 action registry 執行。
 */
import { registerAction, runAction } from './actions.js'
import {
  backgroundPresets,
  createThemePreviewSvg,
  getThemeList,
  parseLineToken
} from './themes.js'
import { strings } from '../strings.js'

const PINNED_KEY = 'mindflow.theme.pinned'
const DEFAULT_KEY = 'mindflow.theme.default'
const RECENT_COLORS_KEY = 'mindflow.colors.recent'

const SHAPES = [
  ['rounded', '小圓角矩形'], ['rounded-large', '大圓角矩形'], ['pill-narrow', '窄藥丸'], ['pill-wide', '寬藥丸'], ['soft-rect', '大圓角卡片'],
  ['underline', '底線'], ['circle', '圓形'], ['ellipse', '橢圓'], ['diamond', '菱形'], ['parallelogram', '平行四邊形']
]

const LINE_STYLES = [
  ['solid', '實線'], ['dotted', '細點虛線'], ['dashed', '中段虛線'], ['dash-dot', '點劃線'], ['long-dash', '長虛點劃線']
]

const STRUCTURES = [
  ['mindmap-both', '⇆', '平衡心智圖'], ['mindmap-right', '⇢', '向右樹狀'], ['org', '⌄', '組織圖'],
  ['tree-right', '☷', '目錄樹'], ['fishbone', '≪', '魚骨圖'], ['timeline-h', '↦', '時間軸']
]

export function initializeSidepanel() {
  const panel = document.querySelector('#sidepanel')
  const title = document.querySelector('#sidepanel-title')
  const close = document.querySelector('#close-sidepanel-button')
  const content = document.querySelector('#sidepanel-placeholder')
  const tabs = Array.from(panel.querySelectorAll('[data-panel-tab]'))
  title.textContent = strings.editor.style
  close.textContent = strings.editor.close
  close.setAttribute('aria-label', strings.editor.closePanel)

  const views = buildViews(content)
  mountStyleControls(views.style)
  mountThemeControls(views.theme)

  const setOpen = open => panel.classList.toggle('is-collapsed', !open)
  const showTab = name => {
    setOpen(true)
    tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.panelTab === name))
    Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name })
    refreshPanel(views)
  }
  const toggle = () => setOpen(panel.classList.contains('is-collapsed'))

  close.addEventListener('click', () => setOpen(false))
  tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.panelTab)))
  window.addEventListener('mindflow:selectionchange', () => refreshPanel(views))
  registerAction('openStylePanel', () => showTab('style'))
  registerAction('openThemePanel', () => showTab('theme'))
  registerAction('toggleSidepanel', toggle)

  refreshPanel(views)
  return { panel, setOpen, toggle, showTab }
}

function buildViews(content) {
  content.innerHTML = `
    <div class="panel-view" data-panel-view="style">
      <section class="panel-section">
        <h3>形狀 Shape</h3>
        <div class="shape-grid">${SHAPES.map(([id, label]) => `<button class="shape-option" type="button" data-shape="${id}" title="${label}" aria-label="${label}"></button>`).join('')}</div>
        <div class="control-row"><label>填色</label><span data-picker="fill"></span></div>
      </section>
      <section class="panel-section">
        <h3>圓角 Radius</h3>
        <div class="control-row"><input data-style-range="radius" type="range" min="0" max="40" value="6"><output class="range-value" data-style-output="radius">6px</output></div>
      </section>
      <section class="panel-section">
        <h3>邊框 Border</h3>
        <div class="control-row"><label>線型</label><select data-style-input="borderStyle">${options(LINE_STYLES)}</select></div>
        <div class="control-row"><label>顏色</label><span data-picker="border"></span><label>寬度</label><select data-style-input="borderWidth">${numberOptions(0, 5, 1, 'px')}</select></div>
      </section>
      <section class="panel-section">
        <h3>連接線 Line</h3>
        <div class="control-row"><label>形狀</label><select data-line-shape><option value="curved">曲線</option><option value="straight">直線</option><option value="orthogonal">直角</option></select></div>
        <div class="control-row"><label>線型</label><select data-line-style>${options(LINE_STYLES)}</select></div>
        <div class="control-row"><label>顏色</label><span data-picker="line"></span><label>寬度</label><select data-style-input="lineWidth">${numberOptions(0, 5, 3, 'px')}</select></div>
      </section>
      <section class="panel-section">
        <h3>結構 Structure</h3>
        <div class="structure-grid">${STRUCTURES.map(([id, icon, label]) => `<button class="structure-option" type="button" data-structure="${id}" title="${label}" aria-label="${label}">${icon}</button>`).join('')}</div>
        <div class="control-row"><label>方向</label><select data-layout-direction><option value="mindmap-right">向右</option><option value="mindmap-left">向左</option><option value="mindmap-both">平衡</option></select></div>
      </section>
      <section class="panel-section">
        <h3>節點間距</h3>
        <div class="control-row"><label>水平</label><input data-spacing="spacingH" type="range" min="10" max="80" value="30"><output class="range-value" data-spacing-output="spacingH">30</output></div>
        <div class="control-row"><label>垂直</label><input data-spacing="spacingV" type="range" min="10" max="80" value="30"><output class="range-value" data-spacing-output="spacingV">30</output></div>
        <div class="control-row"><label>範圍</label><select class="panel-select" data-spacing-scope><option>所有節點</option><option>目前分支</option><option>選中節點</option></select></div>
      </section>
    </div>
    <div class="panel-view" data-panel-view="theme" hidden>
      <div class="subtabs"><button type="button" class="is-active" data-theme-subtab="themes">主題</button><button type="button" data-theme-subtab="background">背景</button></div>
      <div data-theme-pane="themes">
        <button type="button" class="panel-primary-button" data-random-theme>一鍵搭配</button>
        <section class="panel-section"><h3>推薦主題</h3><div class="theme-grid" data-theme-grid></div></section>
      </div>
      <div data-theme-pane="background" hidden>
        <button type="button" class="panel-primary-button" data-random-background>隨機背景</button>
        <section class="panel-section"><h3>背景顏色</h3><div class="quick-colors" data-quick-colors></div><div class="control-row"><label>完整色票</label><span data-picker="background"></span></div></section>
        <section class="panel-section"><h3>推薦背景</h3><div class="background-grid" data-background-grid></div></section>
        <section class="panel-section">
          <h3><label><input data-watermark-enabled type="checkbox"> 插入浮水印</label></h3>
          <div class="watermark-controls">
            <label><span>文字</span><input data-watermark-text type="text" maxlength="30" value="MindFlow"><small data-watermark-count>8/30</small></label>
            <label><span>顏色</span><span data-picker="watermark"></span><small></small></label>
            <label><span>旋轉</span><select data-watermark-rotation><option value="left">左斜</option><option value="right">右斜</option><option value="horizontal">水平</option></select><small></small></label>
            <label><span>透明度</span><input data-watermark-opacity type="range" min="0" max="100" value="12"><small data-watermark-opacity-value>12%</small></label>
            <label><span>字級</span><input data-watermark-size type="range" min="10" max="48" value="18"><small data-watermark-size-value>18px</small></label>
          </div>
        </section>
      </div>
    </div>
    <div class="panel-view" data-panel-view="layout" hidden><div class="panel-empty">全域佈局縮圖由工作流 GAMMA 接入；目前可先在「樣式 → 結構」切換方向。</div></div>
    <div class="panel-view" data-panel-view="icon" hidden><div class="panel-empty">節點圖示庫由工作流 DELTA 接入。</div></div>`
  return Object.fromEntries(Array.from(content.querySelectorAll('[data-panel-view]'), view => [view.dataset.panelView, view]))
}

function mountStyleControls(view) {
  view.querySelectorAll('[data-shape]').forEach(button => button.addEventListener('click', () => runAction('setShape', button.dataset.shape)))
  mountPicker(view.querySelector('[data-picker="fill"]'), { value: '#ffffff', defaultColor: 'transparent', onChange: color => runAction('applyStyle', { fill: color }) })
  mountPicker(view.querySelector('[data-picker="border"]'), { value: '#64748b', defaultColor: 'transparent', onChange: color => runAction('applyStyle', { borderColor: color }) })
  mountPicker(view.querySelector('[data-picker="line"]'), { value: '#3f89de', defaultColor: '#64748b', onChange: color => runAction('applyStyle', { lineColor: color }) })

  view.querySelector('[data-style-range="radius"]').addEventListener('input', event => {
    view.querySelector('[data-style-output="radius"]').value = `${event.target.value}px`
    runAction('setStyleMetadata', { radius: event.target.value })
  })
  view.querySelectorAll('[data-style-input]').forEach(input => input.addEventListener('change', () => {
    const key = input.dataset.styleInput
    const numeric = ['borderWidth', 'lineWidth'].includes(key)
    runAction('applyStyle', { [key]: numeric ? Number(input.value) : input.value })
  }))

  const lineShape = view.querySelector('[data-line-shape]')
  const lineStyle = view.querySelector('[data-line-style]')
  const updateLine = () => runAction('setLineStyle', { shape: lineShape.value, style: lineStyle.value })
  lineShape.addEventListener('change', updateLine)
  lineStyle.addEventListener('change', updateLine)

  view.querySelectorAll('[data-structure]').forEach(button => button.addEventListener('click', () => runAction('setLayout', button.dataset.structure)))
  view.querySelector('[data-layout-direction]').addEventListener('change', event => runAction('setLayout', event.target.value))
  view.querySelectorAll('[data-spacing]').forEach(input => input.addEventListener('input', () => {
    view.querySelector(`[data-spacing-output="${input.dataset.spacing}"]`).value = input.value
    runAction('setDocumentSpacing', { [input.dataset.spacing]: input.value })
  }))
}

function mountThemeControls(view) {
  const subtabButtons = Array.from(view.querySelectorAll('[data-theme-subtab]'))
  subtabButtons.forEach(button => button.addEventListener('click', () => {
    subtabButtons.forEach(item => item.classList.toggle('is-active', item === button))
    view.querySelector('[data-theme-pane="themes"]').hidden = button.dataset.themeSubtab !== 'themes'
    view.querySelector('[data-theme-pane="background"]').hidden = button.dataset.themeSubtab !== 'background'
  }))

  view.querySelector('[data-random-theme]').addEventListener('click', () => {
    const themes = getThemeList()
    const current = runAction('getEditorSnapshot')?.doc?.themeId
    const choices = themes.filter(item => item.id !== current)
    runAction('applyTheme', choices[Math.floor(Math.random() * choices.length)]?.id)
  })

  renderThemeGrid(view.querySelector('[data-theme-grid]'))
  const quickColors = ['#FDF3BD', '#C0E4BC', '#8B8FD4', '#BDF4FC', '#C2BCE6']
  const quickContainer = view.querySelector('[data-quick-colors]')
  quickColors.forEach(color => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'quick-color'
    button.style.setProperty('--swatch', color)
    button.title = color
    button.addEventListener('click', () => runAction('setCanvasBackground', color))
    quickContainer.append(button)
  })
  mountPicker(view.querySelector('[data-picker="background"]'), { value: '#f4f7fb', defaultColor: '#ffffff', onChange: color => runAction('setCanvasBackground', color) })

  const backgroundGrid = view.querySelector('[data-background-grid]')
  backgroundPresets.forEach((background, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'background-card'
    button.style.setProperty('--background', background)
    button.title = `背景 ${index + 1}`
    button.addEventListener('click', () => runAction('setCanvasBackground', background))
    backgroundGrid.append(button)
  })
  view.querySelector('[data-random-background]').addEventListener('click', () => runAction('setCanvasBackground', backgroundPresets[Math.floor(Math.random() * backgroundPresets.length)]))

  mountPicker(view.querySelector('[data-picker="watermark"]'), { value: '#64748b', defaultColor: '#64748b', onChange: color => { view.dataset.watermarkColor = color; applyWatermark(view) } })
  view.dataset.watermarkColor = '#64748b'
  const watermarkInputs = view.querySelectorAll('[data-watermark-enabled], [data-watermark-text], [data-watermark-rotation], [data-watermark-opacity], [data-watermark-size]')
  watermarkInputs.forEach(input => input.addEventListener(input.type === 'range' || input.type === 'text' ? 'input' : 'change', () => applyWatermark(view)))
}

function renderThemeGrid(container) {
  const pinned = readJson(PINNED_KEY, [])
  const active = runAction('getEditorSnapshot')?.doc?.themeId
  const allThemes = getThemeList().sort((left, right) => pinned.indexOf(right.id) - pinned.indexOf(left.id))
  container.replaceChildren()
  for (const selectedTheme of allThemes) {
    const card = document.createElement('article')
    card.className = `theme-card${selectedTheme.id === active ? ' is-active' : ''}`
    card.dataset.themeId = selectedTheme.id
    card.title = selectedTheme.name
    const preview = document.createElement('button')
    preview.type = 'button'
    preview.className = 'theme-card__preview'
    preview.innerHTML = createThemePreviewSvg(selectedTheme, { width: 180, height: 108 })
    preview.addEventListener('click', () => {
      runAction('applyTheme', selectedTheme.id)
      renderThemeGrid(container)
    })
    const meta = document.createElement('div')
    meta.className = 'theme-card__meta'
    const name = document.createElement('span')
    name.className = 'theme-card__name'
    name.textContent = selectedTheme.name
    const pin = document.createElement('button')
    pin.type = 'button'
    pin.className = `theme-pin${pinned.includes(selectedTheme.id) ? ' is-pinned' : ''}`
    pin.textContent = pinned.includes(selectedTheme.id) ? '●' : '○'
    pin.title = pinned.includes(selectedTheme.id) ? '取消釘選' : '釘選主題（最多 6 個）'
    pin.addEventListener('click', () => togglePinnedTheme(selectedTheme.id, container))
    pin.addEventListener('dblclick', () => {
      localStorage.setItem(DEFAULT_KEY, selectedTheme.id)
      runAction('applyTheme', selectedTheme.id)
    })
    meta.append(name, pin)
    card.append(preview, meta)
    container.append(card)
  }
}

function togglePinnedTheme(themeId, container) {
  const pinned = readJson(PINNED_KEY, [])
  const index = pinned.indexOf(themeId)
  if (index >= 0) pinned.splice(index, 1)
  else if (pinned.length < 6) pinned.unshift(themeId)
  localStorage.setItem(PINNED_KEY, JSON.stringify(pinned))
  renderThemeGrid(container)
}

function applyWatermark(view) {
  const text = view.querySelector('[data-watermark-text]').value.slice(0, 30)
  const opacity = view.querySelector('[data-watermark-opacity]').value
  const size = view.querySelector('[data-watermark-size]').value
  view.querySelector('[data-watermark-count]').textContent = `${text.length}/30`
  view.querySelector('[data-watermark-opacity-value]').textContent = `${opacity}%`
  view.querySelector('[data-watermark-size-value]').textContent = `${size}px`
  runAction('setWatermark', {
    enabled: view.querySelector('[data-watermark-enabled]').checked,
    text,
    color: view.dataset.watermarkColor,
    rotation: view.querySelector('[data-watermark-rotation]').value,
    opacity,
    size
  })
}

function refreshPanel(views) {
  const snapshot = runAction('getEditorSnapshot')
  if (!snapshot) return
  const appearance = snapshot.primaryAppearance
  const styleView = views.style
  styleView.querySelectorAll('[data-shape]').forEach(button => button.classList.toggle('is-active', button.dataset.shape === appearance?.shape))
  if (appearance) {
    setValue(styleView, '[data-style-range="radius"]', appearance.radius)
    styleView.querySelector('[data-style-output="radius"]').value = `${appearance.radius}px`
    setValue(styleView, '[data-style-input="borderStyle"]', appearance.borderStyle)
    setValue(styleView, '[data-style-input="borderWidth"]', appearance.borderWidth)
    setValue(styleView, '[data-style-input="lineWidth"]', appearance.lineWidth)
    const line = parseLineToken(appearance.lineStyle, 'solid', 'curved')
    setValue(styleView, '[data-line-style]', line.lineStyle)
    setValue(styleView, '[data-line-shape]', line.lineShape)
  }
  styleView.querySelectorAll('[data-structure]').forEach(button => button.classList.toggle('is-active', button.dataset.structure === snapshot.doc.layout))
  setValue(styleView, '[data-layout-direction]', snapshot.doc.layout)
  for (const key of ['spacingH', 'spacingV']) {
    setValue(styleView, `[data-spacing="${key}"]`, snapshot.rootAppearance[key])
    styleView.querySelector(`[data-spacing-output="${key}"]`).value = snapshot.rootAppearance[key]
  }

  views.theme.querySelectorAll('.theme-card').forEach(card => card.classList.toggle('is-active', card.dataset.themeId === snapshot.doc.themeId))
  const themeView = views.theme
  themeView.querySelector('[data-watermark-enabled]').checked = Boolean(snapshot.doc.canvas.watermark)
  themeView.querySelector('[data-watermark-text]').value = snapshot.rootAppearance.watermarkText
  themeView.querySelector('[data-watermark-rotation]').value = snapshot.rootAppearance.watermarkRotation
  themeView.querySelector('[data-watermark-opacity]').value = snapshot.rootAppearance.watermarkOpacity
  themeView.querySelector('[data-watermark-size]').value = snapshot.rootAppearance.watermarkSize
  themeView.dataset.watermarkColor = snapshot.rootAppearance.watermarkColor
  themeView.querySelector('[data-watermark-count]').textContent = `${snapshot.rootAppearance.watermarkText.length}/30`
  themeView.querySelector('[data-watermark-opacity-value]').textContent = `${snapshot.rootAppearance.watermarkOpacity}%`
  themeView.querySelector('[data-watermark-size-value]').textContent = `${snapshot.rootAppearance.watermarkSize}px`
}

function mountPicker(mount, { value, defaultColor, onChange }) {
  const wrapper = document.createElement('span')
  wrapper.className = 'color-picker'
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'color-trigger'
  trigger.style.setProperty('--swatch', value)
  trigger.setAttribute('aria-label', '開啟色票')
  const popover = document.createElement('div')
  popover.className = 'color-popover'
  popover.hidden = true
  const grid = document.createElement('div')
  grid.className = 'color-grid'
  const recentCaption = document.createElement('div')
  recentCaption.className = 'color-popover__caption'
  recentCaption.textContent = '最近使用'
  const recentContainer = document.createElement('div')
  recentContainer.className = 'recent-colors'
  const renderRecent = () => {
    const fallback = [value, defaultColor, '#ffffff', '#111827', '#f17e2e', '#3f89de', '#22c55e', '#eab308', '#a855f7', '#ec4899']
    const recent = Array.from(new Set([...readJson(RECENT_COLORS_KEY, []), ...fallback])).filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 10)
    recentContainer.replaceChildren()
    for (const color of recent) {
      const swatch = document.createElement('button')
      swatch.type = 'button'
      swatch.className = 'color-swatch'
      swatch.style.setProperty('--swatch', color)
      swatch.title = color
      swatch.addEventListener('click', () => choose(color))
      recentContainer.append(swatch)
    }
  }
  const choose = color => {
    trigger.style.setProperty('--swatch', color)
    popover.hidden = true
    rememberColor(color)
    renderRecent()
    onChange(color)
  }
  for (const color of createPalette()) {
    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'color-swatch'
    swatch.style.setProperty('--swatch', color)
    swatch.title = color
    swatch.addEventListener('click', () => choose(color))
    grid.append(swatch)
  }
  const footer = document.createElement('div')
  footer.className = 'color-popover__footer'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.textContent = '預設'
  reset.addEventListener('click', () => choose(defaultColor))
  const more = document.createElement('label')
  more.textContent = '更多顏色'
  const native = document.createElement('input')
  native.type = 'color'
  native.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#64748b'
  native.addEventListener('input', () => choose(native.value))
  more.append(native)
  footer.append(reset, more)
  renderRecent()
  popover.append(grid, recentCaption, recentContainer, footer)
  document.body.append(popover)
  wrapper.append(trigger)
  mount.replaceChildren(wrapper)
  trigger.addEventListener('click', event => {
    event.stopPropagation()
    const rect = trigger.getBoundingClientRect()
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, rect.right - 252))}px`
    popover.style.top = `${Math.min(window.innerHeight - 330, rect.bottom + 6)}px`
    popover.hidden = !popover.hidden
  })
  document.addEventListener('pointerdown', event => {
    if (!popover.hidden && !popover.contains(event.target) && event.target !== trigger) popover.hidden = true
  })
  return { trigger, choose }
}

function createPalette() {
  const hues = [0, 18, 40, 78, 135, 178, 210, 235, 275, 325]
  const lightness = [96, 88, 76, 63, 50, 37, 23]
  return lightness.flatMap(light => hues.map(hue => hslToHex(hue, light > 90 ? 55 : 68, light)))
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - chroma / 2
  const [red, green, blue] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return `#${[red, green, blue].map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

function rememberColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return
  const recent = readJson(RECENT_COLORS_KEY, []).filter(item => item !== color)
  recent.unshift(color)
  localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent.slice(0, 10)))
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return Array.isArray(value) ? value : fallback
  } catch {
    return fallback
  }
}

function options(entries) {
  return entries.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')
}

function numberOptions(min, max, selected, suffix = '') {
  return Array.from({ length: max - min + 1 }, (_, index) => index + min).map(value => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}${suffix}</option>`).join('')
}

function setValue(root, selector, value) {
  const input = root.querySelector(selector)
  if (input && document.activeElement !== input && Array.from(input.options || []).some(option => option.value === String(value)) || input?.type === 'range') input.value = String(value)
}
