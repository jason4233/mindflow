/**
 * 資料驅動主題、樣式 metadata 與 mini-SVG；不依賴 DOM，可直接單元測試。
 */

const FONT_STACK = 'Inter, "Segoe UI", "Noto Sans TC", sans-serif'
const STYLE_SEPARATOR = '|'

function style(overrides = {}) {
  return Object.freeze({
    fill: '#ffffff',
    textColor: '#253044',
    borderColor: 'transparent',
    borderWidth: 0,
    borderStyle: 'solid',
    fontSize: 14,
    fontFamily: FONT_STACK,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    shape: 'rounded',
    radius: 6,
    paddingX: 14,
    paddingY: 8,
    lineColor: '#64748b',
    lineWidth: 3,
    lineStyle: 'solid',
    ...overrides
  })
}

function theme(definition) {
  const rootStyle = style(definition.rootStyle)
  const level2Style = style(definition.level2Style)
  const leafStyle = style(definition.leafStyle)
  return Object.freeze({
    rainbow: true,
    lineShape: 'curved',
    lineWidthByDepth: Object.freeze([4, 3, 2, 1]),
    ...definition,
    branchPalette: Object.freeze(definition.branchPalette.slice()),
    rootStyle,
    level2Style,
    leafStyle,
    // Phase A renderer 曾使用 root/branch/leaf；保留 alias 讓資料結構向下相容。
    root: rootStyle,
    branch: level2Style,
    leaf: leafStyle
  })
}

const THEME_LIST = [
  theme({
    id: 'classic-blue', name: '經典藍', canvasBg: '#f4f7fb',
    branchPalette: ['#3f89de', '#5ba8a0', '#e69b45', '#8c74c9', '#dc6d7a', '#6e9f4f'],
    rootStyle: { fill: '#3f89de', textColor: '#fff', borderColor: '#3f89de', fontSize: 17, bold: true, paddingX: 22, paddingY: 12 },
    level2Style: { fill: '#fff', borderColor: '#cbd7e5', borderWidth: 1, lineColor: '#3f89de' },
    leafStyle: { fill: 'transparent', shape: 'underline', paddingX: 5, paddingY: 5, lineColor: '#3f89de' }
  }),
  theme({
    id: 'office-pink', name: '粉紅範本', canvasBg: '#FDE0DC',
    branchPalette: ['#7030A0', '#E36C0A', '#00B050', '#92D050', '#00B0F0', '#002060', '#4BACC6'],
    rootStyle: { fill: '#DAEEF3', textColor: '#17365D', borderColor: '#4BACC6', borderWidth: 1, fontSize: 18, bold: true, paddingX: 22, paddingY: 12 },
    level2Style: { fill: '#fff8f7', textColor: '#7030A0', borderColor: '#e7b4ad', borderWidth: 1, lineWidth: 3 },
    leafStyle: { fill: 'transparent', shape: 'underline', textColor: '#7030A0', paddingX: 5, lineWidth: 2 }
  }),
  theme({
    id: 'deep-space', name: '深色星空', canvasBg: '#0B0B2A',
    branchPalette: ['#ff8a3d', '#8b5cf6', '#2dd4bf', '#f472b6', '#38bdf8', '#facc15'],
    rootStyle: { fill: '#f97316', textColor: '#fff', borderColor: '#fdba74', borderWidth: 1, fontSize: 18, bold: true, shape: 'pill' },
    level2Style: { fill: '#20204a', textColor: '#f8fafc', borderColor: '#6767a8', borderWidth: 1, shape: 'pill' },
    leafStyle: { fill: '#121232', textColor: '#e2e8f0', borderColor: '#38386b', borderWidth: 1, lineColor: '#a78bfa' }
  }),
  theme({
    id: 'monochrome-outline', name: '灰階綱要', canvasBg: '#f7f7f5', rainbow: false,
    branchPalette: ['#262626'], lineShape: 'orthogonal',
    rootStyle: { fill: '#fff', textColor: '#111', borderColor: '#111', borderWidth: 2, fontSize: 17, bold: true, radius: 3 },
    level2Style: { fill: '#fff', textColor: '#262626', borderColor: '#525252', borderWidth: 1, radius: 3 },
    leafStyle: { fill: 'transparent', textColor: '#404040', shape: 'underline', lineColor: '#525252' }
  }),
  theme({
    id: 'duo-capsule', name: '藍橘雙藥丸', canvasBg: '#f8fbff',
    branchPalette: ['#2563eb', '#f97316'],
    rootStyle: { fill: '#172554', textColor: '#fff', borderColor: '#172554', fontSize: 17, bold: true, shape: 'pill', paddingX: 24 },
    level2Style: { fill: '#fff', textColor: '#1e3a8a', borderColor: '#2563eb', borderWidth: 2, shape: 'pill', paddingX: 18 },
    leafStyle: { fill: '#fff7ed', textColor: '#9a3412', borderColor: '#fb923c', borderWidth: 1, shape: 'pill' }
  }),
  theme({
    id: 'watercolor-mint', name: '水彩薄荷綠', canvasBg: '#edf9f4',
    branchPalette: ['#3f8f77', '#65a98f', '#84b6a3', '#4d7c8a', '#c18b6b', '#8074a8'], lineShape: 'dotted',
    rootStyle: { fill: '#174c4f', textColor: '#fff', borderColor: '#174c4f', fontSize: 17, bold: true, shape: 'pill' },
    level2Style: { fill: '#cce9df', textColor: '#164e42', borderColor: '#7fb9a5', borderWidth: 1, shape: 'pill', lineStyle: 'dotted' },
    leafStyle: { fill: '#f8fffc', textColor: '#315b50', borderColor: '#a9d4c5', borderWidth: 1, lineStyle: 'dotted' }
  }),
  theme({
    id: 'autumn-warm', name: '秋色暖棕', canvasBg: '#fbf2e7',
    branchPalette: ['#b45309', '#c2410c', '#a16207', '#9a3412', '#7c2d12', '#ca8a04'],
    rootStyle: { fill: '#7c2d12', textColor: '#fff7ed', borderColor: '#7c2d12', fontSize: 18, bold: true, radius: 10 },
    level2Style: { fill: '#ffedd5', textColor: '#7c2d12', borderColor: '#d97706', borderWidth: 1, radius: 10 },
    leafStyle: { fill: '#fffaf3', textColor: '#78350f', shape: 'underline', lineColor: '#b45309' }
  }),
  theme({
    id: 'cream-notes', name: '奶油筆記', canvasBg: '#fff8dc',
    branchPalette: ['#e07a5f', '#3d8b7d', '#577590', '#f2a65a', '#8f6fb0', '#6f8f52'], lineShape: 'orthogonal',
    rootStyle: { fill: '#f4a261', textColor: '#4a2c20', borderColor: '#d97706', borderWidth: 1, fontSize: 18, bold: true, radius: 4 },
    level2Style: { fill: '#fffdf2', textColor: '#463f3a', borderColor: '#d6c49b', borderWidth: 1, radius: 4 },
    leafStyle: { fill: '#fffdf7', textColor: '#57534e', borderColor: '#e7d9b4', borderWidth: 1, radius: 2 }
  }),
  theme({
    id: 'magenta-rainbow', name: '紫紅彩虹', canvasBg: '#fff5fb',
    branchPalette: ['#db2777', '#9333ea', '#4f46e5', '#0891b2', '#16a34a', '#ea580c'],
    rootStyle: { fill: '#86198f', textColor: '#fff', borderColor: '#c026d3', borderWidth: 2, fontSize: 18, bold: true, shape: 'pill' },
    level2Style: { fill: '#fff', textColor: '#701a75', borderColor: '#db2777', borderWidth: 2, shape: 'pill' },
    leafStyle: { fill: 'transparent', textColor: '#4a044e', shape: 'underline', lineWidth: 2 }
  }),
  theme({
    id: 'presentation-night', name: '午夜簡報', canvasBg: '#111827',
    branchPalette: ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#fb7185', '#60a5fa'], rainbow: false,
    rootStyle: { fill: '#f8fafc', textColor: '#111827', borderColor: '#fff', fontSize: 19, bold: true, shape: 'pill' },
    level2Style: { fill: '#1f2937', textColor: '#f8fafc', borderColor: '#22d3ee', borderWidth: 2, radius: 10 },
    leafStyle: { fill: '#111827', textColor: '#dbeafe', borderColor: '#475569', borderWidth: 1 }
  }),
  theme({
    id: 'journal-sage', name: '鼠尾草日記', canvasBg: '#f4f1e8',
    branchPalette: ['#647d68', '#94745b', '#758b9e', '#a27b86', '#8e8a5b', '#6f7f91'], rainbow: false, lineShape: 'dotted',
    rootStyle: { fill: '#667761', textColor: '#fff', borderColor: '#445442', fontSize: 17, bold: true, radius: 12 },
    level2Style: { fill: '#ebe5d7', textColor: '#3f493e', borderColor: '#9eaa96', borderWidth: 1, radius: 12, lineStyle: 'dotted' },
    leafStyle: { fill: 'transparent', textColor: '#57534e', shape: 'underline', lineStyle: 'dotted' }
  }),
  theme({
    id: 'confetti-pop', name: '繽紛派對', canvasBg: '#fefefe',
    branchPalette: ['#ff4d6d', '#ff9f1c', '#2ec4b6', '#3a86ff', '#8338ec', '#80b918'],
    rootStyle: { fill: '#ff4d6d', textColor: '#fff', borderColor: '#d90429', borderWidth: 2, fontSize: 18, bold: true, shape: 'pill' },
    level2Style: { fill: '#fff', textColor: '#17202a', borderColor: '#3a86ff', borderWidth: 2, shape: 'pill' },
    leafStyle: { fill: '#fff', textColor: '#343a40', borderColor: '#ffd166', borderWidth: 1, radius: 10 }
  })
]

export const themes = Object.freeze(Object.fromEntries(THEME_LIST.map(item => [item.id, item])))
export const themeIds = Object.freeze(THEME_LIST.map(item => item.id))

export const backgroundPresets = Object.freeze([
  'linear-gradient(135deg, #fff7ed 0%, #ffedd5 48%, #fef3c7 100%)',
  'linear-gradient(145deg, #eef2ff 0%, #e0e7ff 48%, #f5f3ff 100%)',
  'linear-gradient(135deg, #ecfeff 0%, #ccfbf1 50%, #f0fdf4 100%)',
  'linear-gradient(140deg, #fff1f2 0%, #fce7f3 52%, #faf5ff 100%)',
  'linear-gradient(155deg, #0f172a 0%, #1e1b4b 52%, #312e81 100%)',
  'radial-gradient(circle at 18% 20%, #fde68a 0 10%, transparent 11%), linear-gradient(135deg, #fff7ed, #fed7aa)',
  'radial-gradient(circle at 80% 15%, #bae6fd 0 12%, transparent 13%), linear-gradient(145deg, #f0f9ff, #e0f2fe)',
  'linear-gradient(120deg, #f7fee7 0%, #dcfce7 45%, #ccfbf1 100%)',
  'linear-gradient(150deg, #fafaf9 0%, #e7e5e4 50%, #f5f5f4 100%)',
  'radial-gradient(circle at 30% 30%, #c4b5fd 0%, transparent 36%), radial-gradient(circle at 75% 70%, #f9a8d4 0%, transparent 34%), #fff'
])

export function getTheme(themeId) {
  return themes[themeId] || themes['classic-blue']
}

export function getThemeList() {
  return THEME_LIST.slice()
}

export function getNextThemeId(themeId) {
  const index = themeIds.indexOf(themeId)
  return themeIds[(index + 1 + themeIds.length) % themeIds.length]
}

export function parseStyleToken(value, fallbackShape = 'rounded') {
  const [rawShape, ...parts] = String(value || fallbackShape).split(STYLE_SEPARATOR)
  const metadata = {}
  for (const part of parts) {
    const splitAt = part.indexOf('=')
    if (splitAt < 1) continue
    const key = part.slice(0, splitAt)
    try {
      metadata[key] = decodeURIComponent(part.slice(splitAt + 1))
    } catch {
      metadata[key] = part.slice(splitAt + 1)
    }
  }
  return { shape: rawShape || fallbackShape, metadata }
}

export function encodeStyleToken(value, patch = {}, shapeOverride = null) {
  const parsed = parseStyleToken(value)
  const metadata = { ...parsed.metadata }
  for (const [key, entry] of Object.entries(patch)) {
    if (entry === undefined || entry === null || entry === '') delete metadata[key]
    else metadata[key] = String(entry)
  }
  const encoded = Object.keys(metadata)
    .sort()
    .map(key => `${key}=${encodeURIComponent(metadata[key])}`)
  return [shapeOverride || parsed.shape, ...encoded].join(STYLE_SEPARATOR)
}

export function parseLineToken(value, fallbackStyle = 'solid', fallbackShape = 'curved') {
  const parsed = parseStyleToken(value || fallbackStyle, fallbackStyle)
  return { lineStyle: parsed.shape, lineShape: parsed.metadata.shape || fallbackShape }
}

export function encodeLineToken(value, lineStyle, lineShape) {
  const parsed = parseLineToken(value)
  return encodeStyleToken(lineStyle || parsed.lineStyle, { shape: lineShape || parsed.lineShape }, lineStyle || parsed.lineStyle)
}

export function getNodeAppearance(node, depth, selectedTheme) {
  const activeTheme = selectedTheme || themes['classic-blue']
  const base = depth === 0 ? activeTheme.rootStyle : depth === 1 ? activeTheme.level2Style : activeTheme.leafStyle
  const merged = { ...base, ...node.style }
  const parsed = parseStyleToken(merged.shape, base.shape)
  const number = (key, fallback) => Number.isFinite(Number(parsed.metadata[key])) ? Number(parsed.metadata[key]) : fallback
  return {
    ...merged,
    shape: parsed.shape,
    hasCustomRadius: Object.hasOwn(parsed.metadata, 'radius'),
    radius: number('radius', Number(base.radius) || 6),
    textAlign: parsed.metadata.align || 'center',
    lineHeight: number('lineHeight', 1.35),
    richText: parsed.metadata.richText || '',
    spacingH: number('spacingH', 30),
    spacingV: number('spacingV', 30),
    watermarkText: parsed.metadata.watermarkText || 'MindFlow',
    watermarkColor: parsed.metadata.watermarkColor || '#64748b',
    watermarkRotation: parsed.metadata.watermarkRotation || 'left',
    watermarkOpacity: number('watermarkOpacity', 12),
    watermarkSize: number('watermarkSize', 18)
  }
}

export function getLineAppearance(node, depth, selectedTheme, branchColor) {
  const activeTheme = selectedTheme || themes['classic-blue']
  const nodeAppearance = getNodeAppearance(node, depth, activeTheme)
  const parsed = parseLineToken(nodeAppearance.lineStyle, 'solid', activeTheme.lineShape)
  return {
    color: node.style.lineColor || branchColor || nodeAppearance.lineColor,
    width: node.style.lineWidth ?? activeTheme.lineWidthByDepth[Math.min(depth - 1, activeTheme.lineWidthByDepth.length - 1)] ?? 2,
    style: parsed.lineStyle,
    shape: parsed.lineShape || activeTheme.lineShape
  }
}

export function createThemePreviewSvg(selectedTheme, { width = 180, height = 108 } = {}) {
  const activeTheme = typeof selectedTheme === 'string' ? getTheme(selectedTheme) : selectedTheme
  const colors = activeTheme.branchPalette
  const root = activeTheme.rootStyle
  const branch = activeTheme.level2Style
  const lineDash = activeTheme.lineShape === 'dotted' ? '3 5' : ''
  const line = (x1, y1, x2, y2, color) => activeTheme.lineShape === 'orthogonal'
    ? `<path d="M${x1} ${y1}H${(x1 + x2) / 2}V${y2}H${x2}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${lineDash}"/>`
    : `<path d="M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${lineDash}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(activeTheme.name)}主題預覽"><rect width="${width}" height="${height}" rx="10" fill="${escapeXml(activeTheme.canvasBg)}"/>${line(79, 54, 112, 27, colors[0])}${line(79, 54, 112, 54, colors[1 % colors.length])}${line(79, 54, 112, 81, colors[2 % colors.length])}${line(53, 54, 25, 32, colors[3 % colors.length])}${line(53, 54, 25, 76, colors[4 % colors.length])}<rect x="52" y="40" width="29" height="28" rx="${Math.min(12, Number(root.radius) || 6)}" fill="${root.fill}" stroke="${root.borderColor}" stroke-width="${root.borderWidth}"/><rect x="112" y="19" width="43" height="16" rx="${Math.min(8, Number(branch.radius) || 6)}" fill="${branch.fill}" stroke="${colors[0]}" stroke-width="1.5"/><rect x="112" y="46" width="48" height="16" rx="${Math.min(8, Number(branch.radius) || 6)}" fill="${branch.fill}" stroke="${colors[1 % colors.length]}" stroke-width="1.5"/><rect x="112" y="73" width="37" height="16" rx="${Math.min(8, Number(branch.radius) || 6)}" fill="${branch.fill}" stroke="${colors[2 % colors.length]}" stroke-width="1.5"/><rect x="18" y="24" width="35" height="16" rx="7" fill="${branch.fill}" stroke="${colors[3 % colors.length]}"/><rect x="14" y="68" width="39" height="16" rx="7" fill="${branch.fill}" stroke="${colors[4 % colors.length]}"/></svg>`
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}
