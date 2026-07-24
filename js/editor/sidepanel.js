/**
 * 右側 Style / Theme / Background 面板；所有文件異動透過 action registry 執行。
 */
import { hasAction, registerAction, runAction } from './actions.js'
import {
  backgroundPresets,
  createThemePreviewSvg,
  getTheme,
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

const LAYOUT_CARDS = [
  ['mindmap', '心智圖'], ['logic-right', '邏輯圖'], ['org', '組織圖'],
  ['tree', '目錄樹'], ['timeline-h', '時間軸'], ['fishbone', '魚骨圖']
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
  mountLayoutControls(views.layout)

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
    <div class="panel-view" data-panel-view="layout" hidden>
      <section class="panel-section">
        <h3>全域佈局</h3>
        <div class="fix2-layout-grid">${LAYOUT_CARDS.map(([id, label]) => `
          <button class="fix2-layout-card" type="button" data-fix2-layout="${id}" title="${label}">
            <span>${createLayoutMiniSvg(id)}</span><strong>${label}</strong>
          </button>`).join('')}</div>
        <button class="panel-primary-button fix2-tidy-button" type="button" data-fix2-tidy>一鍵整理（Ctrl+Shift+L）</button>
      </section>
    </div>
    <div class="panel-view" data-panel-view="icon" hidden><div class="panel-empty">節點圖示庫由工作流 DELTA 接入。</div></div>`
  return Object.fromEntries(Array.from(content.querySelectorAll('[data-panel-view]'), view => [view.dataset.panelView, view]))
}

function mountStyleControls(view) {
  view.querySelectorAll('[data-shape]').forEach(button => button.addEventListener('click', () => runAction('setShape', button.dataset.shape)))
  mountPicker(view.querySelector('[data-picker="fill"]'), stylePickerOptions('fill', '#ffffff', 'transparent'))
  mountPicker(view.querySelector('[data-picker="border"]'), stylePickerOptions('borderColor', '#64748b', 'transparent'))
  mountPicker(view.querySelector('[data-picker="line"]'), stylePickerOptions('lineColor', '#3f89de', '#64748b'))

  const radius = view.querySelector('[data-style-range="radius"]')
  radius.addEventListener('input', event => {
    view.querySelector('[data-style-output="radius"]').value = `${event.target.value}px`
    runAction('previewStyle', 'radius', { radius: Number(event.target.value) })
  })
  radius.addEventListener('change', event => runAction('commitStylePreview', 'radius', { radius: Number(event.target.value) }))
  view.querySelectorAll('[data-style-input]').forEach(input => input.addEventListener('change', () => {
    const key = input.dataset.styleInput
    const numeric = ['borderWidth', 'lineWidth'].includes(key)
    const value = numeric ? Number(input.value) : input.value
    if (key === 'lineWidth' && runAction('getSelectedOverlay')?.type === 'relation') {
      runAction('applyRelationStyle', { lineWidth: value })
    } else {
      runAction('applyStyle', { [key]: value })
    }
  }))

  const lineShape = view.querySelector('[data-line-shape]')
  const lineStyle = view.querySelector('[data-line-style]')
  lineShape.addEventListener('change', () => {
    if (runAction('getSelectedOverlay')?.type !== 'relation') runAction('setLineStyle', { shape: lineShape.value })
  })
  lineStyle.addEventListener('change', () => {
    if (runAction('getSelectedOverlay')?.type === 'relation') runAction('applyRelationStyle', { lineStyle: lineStyle.value })
    else runAction('setLineStyle', { style: lineStyle.value })
  })

  view.querySelectorAll('[data-structure]').forEach(button => button.addEventListener('click', () => runAction('setLayout', button.dataset.structure)))
  view.querySelector('[data-layout-direction]').addEventListener('change', event => runAction('setLayout', event.target.value))
  view.querySelectorAll('[data-spacing]').forEach(input => {
    input.addEventListener('input', () => {
      view.querySelector(`[data-spacing-output="${input.dataset.spacing}"]`).value = input.value
      runAction('previewDocumentSpacing', input.dataset.spacing, { [input.dataset.spacing]: Number(input.value) })
    })
    input.addEventListener('change', () => runAction('commitDocumentSpacingPreview', input.dataset.spacing, { [input.dataset.spacing]: Number(input.value) }))
  })
}

function mountLayoutControls(view) {
  view.querySelectorAll('[data-fix2-layout]').forEach(button => {
    button.addEventListener('click', () => runLayoutAction('setLayout', button.dataset.fix2Layout))
  })
  view.querySelector('[data-fix2-tidy]')?.addEventListener('click', () => runLayoutAction('tidyLayout'))
}

function runLayoutAction(action, ...args) {
  if (!hasAction(action)) {
    showPanelToast('此佈局即將推出')
    return false
  }
  return runAction(action, ...args)
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
  mountPicker(view.querySelector('[data-picker="background"]'), {
    value: '#f4f7fb',
    defaultColor: '#ffffff',
    onPreview: color => runAction('previewCanvasBackground', color),
    onChange: color => runAction('commitCanvasBackgroundPreview', color)
  })

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

  mountPicker(view.querySelector('[data-picker="watermark"]'), {
    value: '#64748b',
    defaultColor: '#64748b',
    onPreview: color => {
      view.dataset.watermarkColor = color
      applyWatermark(view, 'preview', 'color')
    },
    onChange: color => {
      view.dataset.watermarkColor = color
      applyWatermark(view, 'commit-preview', 'color')
    }
  })
  view.dataset.watermarkColor = '#64748b'
  view.querySelectorAll('[data-watermark-text], [data-watermark-opacity], [data-watermark-size]').forEach(input => {
    const key = input.dataset.watermarkText !== undefined ? 'text' : input.dataset.watermarkOpacity !== undefined ? 'opacity' : 'size'
    input.addEventListener('input', () => applyWatermark(view, 'preview', key))
    input.addEventListener('change', () => applyWatermark(view, 'commit-preview', key))
  })
  view.querySelectorAll('[data-watermark-enabled], [data-watermark-rotation]').forEach(input => input.addEventListener('change', () => applyWatermark(view)))
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
    const selectTheme = () => {
      runAction('applyTheme', selectedTheme.id)
      renderThemeGrid(container)
    }
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
    pin.addEventListener('click', event => {
      event.stopPropagation()
      togglePinnedTheme(selectedTheme.id, container)
    })
    pin.addEventListener('dblclick', () => {
      localStorage.setItem(DEFAULT_KEY, selectedTheme.id)
      runAction('applyTheme', selectedTheme.id)
    })
    meta.append(name, pin)
    card.append(preview, meta)
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.addEventListener('click', selectTheme)
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      selectTheme()
    })
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

function applyWatermark(view, mode = 'commit', key = '') {
  const text = view.querySelector('[data-watermark-text]').value.slice(0, 30)
  const opacity = view.querySelector('[data-watermark-opacity]').value
  const size = view.querySelector('[data-watermark-size]').value
  view.querySelector('[data-watermark-count]').textContent = `${text.length}/30`
  view.querySelector('[data-watermark-opacity-value]').textContent = `${opacity}%`
  view.querySelector('[data-watermark-size-value]').textContent = `${size}px`
  const config = {
    enabled: view.querySelector('[data-watermark-enabled]').checked,
    text,
    color: view.dataset.watermarkColor,
    rotation: view.querySelector('[data-watermark-rotation]').value,
    opacity,
    size
  }
  if (mode === 'preview') runAction('previewWatermark', key, config)
  else if (mode === 'commit-preview') runAction('commitWatermarkPreview', key, config)
  else runAction('setWatermark', config)
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
    const line = parseLineToken(appearance.lineStyle, 'solid', getTheme(snapshot.doc.themeId).lineShape)
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
  themeView.querySelector('[data-watermark-enabled]').checked = Boolean(snapshot.doc.canvas.watermark.enabled)
  setValue(themeView, '[data-watermark-text]', snapshot.rootAppearance.watermarkText)
  setValue(themeView, '[data-watermark-rotation]', snapshot.rootAppearance.watermarkRotation)
  setValue(themeView, '[data-watermark-opacity]', snapshot.rootAppearance.watermarkOpacity)
  setValue(themeView, '[data-watermark-size]', snapshot.rootAppearance.watermarkSize)
  themeView.dataset.watermarkColor = snapshot.rootAppearance.watermarkColor
  themeView.querySelector('[data-watermark-count]').textContent = `${snapshot.rootAppearance.watermarkText.length}/30`
  themeView.querySelector('[data-watermark-opacity-value]').textContent = `${snapshot.rootAppearance.watermarkOpacity}%`
  themeView.querySelector('[data-watermark-size-value]').textContent = `${snapshot.rootAppearance.watermarkSize}px`
}

function createLayoutMiniSvg(id) {
  const common = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"'
  const node = (x, y, w = 17, h = 8) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="white" stroke="currentColor"/>`
  let paths = ''
  let nodes = ''
  if (id === 'org') {
    paths = `<path d="M45 19V29M18 29H72M18 29V40M45 29V40M72 29V40" ${common}/>`
    nodes = `${node(34,10,22,9)}${node(9,40)}${node(36,40)}${node(63,40)}`
  } else if (id === 'tree') {
    paths = `<path d="M22 15V47M22 26H39M22 39H48M22 47H36" ${common}/>`
    nodes = `${node(6,10,20,9)}${node(39,22)}${node(48,35)}${node(36,44)}`
  } else if (id === 'timeline-h') {
    paths = `<path d="M10 31H80M28 31V19M48 31V43M68 31V19" ${common}/>`
    nodes = `${node(19,10)}${node(39,43)}${node(59,10)}`
  } else if (id === 'fishbone') {
    paths = `<path d="M12 31H78M30 31L20 17M45 31L35 45M60 31L51 17" ${common}/>`
    nodes = `${node(69,26)}${node(8,9,15,8)}${node(27,45,15,8)}${node(44,9,15,8)}`
  } else {
    const both = id === 'mindmap'
    paths = both
      ? `<path d="M34 31H15M34 31H70M15 31V17M15 31V45M70 31V17M70 31V45" ${common}/>`
      : `<path d="M28 31H68M48 31V17M48 31V45M68 31V31" ${common}/>`
    nodes = both
      ? `${node(29,26,28,10)}${node(3,10)}${node(3,43)}${node(70,10)}${node(70,43)}`
      : `${node(5,26,24,10)}${node(48,10)}${node(48,43)}${node(68,26)}`
  }
  return `<svg viewBox="0 0 90 62" aria-hidden="true">${paths}${nodes}</svg>`
}

function showPanelToast(message) {
  let toast = document.querySelector('[data-fix2-toast]')
  if (!toast) {
    toast = document.createElement('div')
    toast.dataset.fix2Toast = 'true'
    toast.className = 'fix2-toast'
    toast.setAttribute('role', 'status')
    document.body.append(toast)
  }
  toast.textContent = message
  toast.hidden = false
  window.clearTimeout(showPanelToast.timer)
  showPanelToast.timer = window.setTimeout(() => { toast.hidden = true }, 1800)
}

function mountPicker(mount, { value, defaultColor, onChange, onPreview = onChange }) {
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
  const choose = (color, { commit = true, close = true } = {}) => {
    trigger.style.setProperty('--swatch', color)
    if (close) popover.hidden = true
    if (commit) {
      rememberColor(color)
      renderRecent()
      onChange(color)
    } else {
      onPreview(color)
    }
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
  native.addEventListener('input', () => choose(native.value, { commit: false, close: false }))
  native.addEventListener('change', () => choose(native.value))
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
  if (!input || document.activeElement === input) return
  if (input.tagName === 'SELECT' && !Array.from(input.options).some(option => option.value === String(value))) return
  input.value = String(value)
}

function stylePickerOptions(key, value, defaultColor) {
  return {
    value,
    defaultColor,
    onPreview: color => runAction('previewStyle', key, { [key]: color }),
    onChange: color => runAction('commitStylePreview', key, { [key]: color })
  }
}
