/**
 * MindFlow 文件的純邏輯匯出器；只回傳字串，不下載檔案、不存取 DOM。
 */
import { getLayoutBounds, layout } from '../editor/layout.js'
import { serializeDoc, walkNodes } from '../editor/model.js'
import { getLineAppearance, getNodeAppearance, getTheme } from '../editor/themes.js'

const DEFAULT_MARGIN = 80
const DEFAULT_MAX_TEXT_WIDTH = 220
const DEFAULT_INDENT = '  '

/** 匯出原生 MindFlow JSON；預設維持舊 API 的緊湊格式。 */
export function exportDocumentJson(doc, options = {}) {
  const space = typeof options === 'number' ? options : options.space ?? 0
  const json = serializeDoc(doc)
  return space ? JSON.stringify(JSON.parse(json), null, clampInteger(space, 0, 10)) : json
}

/** 匯出以兩個空白為一層的純文字大綱。 */
export function exportDocumentTxt(doc, options = {}) {
  const indent = typeof options.indent === 'string' ? options.indent : DEFAULT_INDENT
  return outlineRows(doc?.root)
    .map(({ node, depth }) => `${indent.repeat(depth)}${escapeOutlineText(node.text)}`)
    .join('\n')
}

/** 匯出標準 Markdown：根節點是 H1，其餘節點是縮排項目。 */
export function exportDocumentMarkdown(doc, options = {}) {
  const rows = outlineRows(doc?.root)
  if (rows.length === 0) return ''

  const indent = typeof options.indent === 'string' ? options.indent : DEFAULT_INDENT
  const [root, ...children] = rows
  const lines = [`# ${escapeOutlineText(root.node.text)}`]
  if (children.length > 0) lines.push('')
  for (const { node, depth } of children) {
    lines.push(`${indent.repeat(Math.max(0, depth - 1))}- ${escapeOutlineText(node.text)}`)
  }
  return lines.join('\n')
}

/**
 * 匯出 Word 可直接開啟的 HTML 版 .doc。
 * MIME type 與副檔名由 UI 下載層決定，本函數只產生完整文件內容。
 */
export function exportDocumentWord(doc, options = {}) {
  const title = String(options.title ?? doc?.title ?? doc?.root?.text ?? 'MindFlow')
  const root = doc?.root
  const body = root ? wordOutlineHtml(root) : '<p class="empty"></p>'
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/1999/xhtml" lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="MindFlow">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: A4; margin: 2cm; }
body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; color: #1f2937; line-height: 1.55; }
h1 { font-size: 22pt; margin: 0 0 14pt; }
ul { margin: 4pt 0 4pt 18pt; padding-left: 12pt; }
li { margin: 3pt 0; }
.empty { min-height: 1em; }
</style>
</head>
<body>${body}</body>
</html>`
}

/**
 * 將 Doc 畫成完整、獨立的 SVG 字串，供 UI 層再交給 Canvas 轉 PNG/JPG。
 * 預設只畫目前可見節點；includeCollapsedChildren=true 可展開後匯出。
 */
export function documentToSvg(doc, options = {}) {
  const sourceRoot = doc?.root
  const margin = finiteNumber(options.margin, DEFAULT_MARGIN, 0, 2000)
  const transparent = Boolean(options.transparent)
  if (!sourceRoot) return emptySvg(doc, margin, transparent)

  const activeTheme = getTheme(doc.themeId)
  const workingRoot = options.includeCollapsedChildren ? expandedClone(sourceRoot) : sourceRoot
  const workingDoc = { ...doc, root: workingRoot }
  const textLayouts = new Map()
  const measure = (node, depth) => measureSvgNode(node, depth, activeTheme, textLayouts, options)
  const positions = layout(workingDoc, measure)
  mirrorLeftLayout(positions, workingRoot.id, doc.layout)

  const bounds = getLayoutBounds(positions)
  const width = Math.max(1, Math.ceil(bounds.width + margin * 2))
  const height = Math.max(1, Math.ceil(bounds.height + margin * 2))
  const offsetX = margin - bounds.minX
  const offsetY = margin - bounds.minY
  const nodes = new Map()
  const parents = new Map()
  const branches = buildBranchLookup(workingRoot, activeTheme)

  walkNodes(workingRoot, (node, parent, depth) => {
    nodes.set(node.id, { node, depth })
    if (parent) parents.set(node.id, parent.id)
  }, { includeHidden: true })

  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(doc.title || workingRoot.text || 'MindFlow')}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility">`
  ]

  if (!transparent) {
    pieces.push(`<rect width="100%" height="100%" fill="${escapeXml(resolveCanvasColor(doc, activeTheme))}"/>`)
  }
  pieces.push(`<g transform="translate(${formatNumber(offsetX)} ${formatNumber(offsetY)})">`)

  // 連線先畫，確保線條在節點盒下方。
  for (const [childId, parentId] of parents) {
    const parent = positions.get(parentId)
    const child = positions.get(childId)
    const record = nodes.get(childId)
    if (!parent || !child || !record) continue
    const branchColor = branches.get(childId) || activeTheme.branchPalette[0]
    const appearance = getLineAppearance(record.node, record.depth, activeTheme, branchColor)
    pieces.push(svgConnection(parent, child, appearance))
  }
  pieces.push(...svgRelations(doc.relations, positions))

  for (const [id, position] of positions) {
    const record = nodes.get(id)
    if (!record) continue
    const branchColor = branches.get(id) || activeTheme.branchPalette[0]
    const appearance = getNodeAppearance(record.node, record.depth, activeTheme)
    const textLayout = textLayouts.get(id) || measureSvgNode(record.node, record.depth, activeTheme, textLayouts, options).textLayout
    pieces.push(svgNode(record.node, position, appearance, branchColor, textLayout))
  }

  pieces.push('</g></svg>')
  return pieces.join('')
}

function outlineRows(root) {
  if (!root || typeof root !== 'object') return []
  const rows = []
  const stack = [{ node: root, depth: 0 }]
  while (stack.length > 0) {
    const entry = stack.pop()
    rows.push(entry)
    const children = Array.isArray(entry.node.children) ? entry.node.children : []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: entry.depth + 1 })
    }
  }
  return rows
}

function escapeOutlineText(value) {
  const source = String(value ?? '')
  if (source === '') return '\\0'
  let escaped = source
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)

  // 首尾空白若不跳脫，會與縮排或編輯器自動 trim 混在一起。
  escaped = escaped.replace(/^ +/, spaces => '\\s'.repeat(spaces.length))
  escaped = escaped.replace(/ +$/, spaces => '\\s'.repeat(spaces.length))
  return escaped
}

function wordOutlineHtml(root) {
  const pieces = [`<h1>${escapeHtmlWithBreaks(root.text)}</h1>`]
  const children = Array.isArray(root.children) ? root.children : []
  if (children.length === 0) return pieces.join('')

  pieces.push('<ul>')
  const stack = []
  for (let index = children.length - 1; index >= 0; index -= 1) {
    stack.push({ type: 'node', node: children[index] })
  }

  while (stack.length > 0) {
    const event = stack.pop()
    if (event.type === 'close-list') pieces.push('</ul>')
    else if (event.type === 'close-node') pieces.push('</li>')
    else {
      const nodeChildren = Array.isArray(event.node.children) ? event.node.children : []
      pieces.push(`<li><span>${escapeHtmlWithBreaks(event.node.text)}</span>`)
      stack.push({ type: 'close-node' })
      if (nodeChildren.length > 0) {
        pieces.push('<ul>')
        stack.push({ type: 'close-list' })
        for (let index = nodeChildren.length - 1; index >= 0; index -= 1) {
          stack.push({ type: 'node', node: nodeChildren[index] })
        }
      }
    }
  }
  pieces.push('</ul>')
  return pieces.join('')
}

function measureSvgNode(node, depth, activeTheme, cache, options) {
  const appearance = getNodeAppearance(node, depth, activeTheme)
  const fontSize = finiteNumber(appearance.fontSize, depth === 0 ? 17 : 14, 8, 96)
  const paddingX = finiteNumber(appearance.paddingX, depth === 0 ? 22 : 14, 0, 120)
  const paddingY = finiteNumber(appearance.paddingY, depth === 0 ? 12 : 8, 0, 120)
  const maxTextWidth = finiteNumber(options.maxTextWidth, DEFAULT_MAX_TEXT_WIDTH, 40, 2000)
  const lineHeight = fontSize * finiteNumber(appearance.lineHeight, 1.35, 0.8, 4)
  const textLayout = wrapSvgText(node.text, fontSize, maxTextWidth)
  const iconPrefix = Array.isArray(node.icons) && node.icons.length > 0 ? `${node.icons.join(' ')} ` : ''
  if (iconPrefix) textLayout.lines[0] = `${iconPrefix}${textLayout.lines[0]}`
  textLayout.width = Math.min(maxTextWidth, Math.max(...textLayout.lines.map(line => estimateTextWidth(line, fontSize)), 0))
  textLayout.lineHeight = lineHeight
  textLayout.fontSize = fontSize

  const imageWidth = node.image ? finiteNumber(node.image.w, 0, 0, 2000) : 0
  const imageHeight = node.image ? finiteNumber(node.image.h, 0, 0, 2000) : 0
  const contentWidth = Math.max(textLayout.width, imageWidth)
  const contentHeight = textLayout.lines.length * lineHeight + (imageHeight > 0 ? imageHeight + 6 : 0)
  const result = {
    w: Math.max(24, contentWidth + paddingX * 2),
    h: Math.max(20, contentHeight + paddingY * 2),
    textLayout: { ...textLayout, imageHeight }
  }
  cache.set(node.id, result.textLayout)
  return result
}

function wrapSvgText(value, fontSize, maxWidth) {
  const sourceLines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
  const lines = []
  for (const sourceLine of sourceLines) {
    if (sourceLine === '') {
      lines.push('')
      continue
    }
    let line = ''
    let width = 0
    for (const character of Array.from(sourceLine)) {
      const characterWidth = estimateTextWidth(character, fontSize)
      if (line && width + characterWidth > maxWidth) {
        lines.push(line)
        line = character
        width = characterWidth
      } else {
        line += character
        width += characterWidth
      }
    }
    lines.push(line)
  }
  if (lines.length === 0) lines.push('')
  return { lines, width: Math.max(...lines.map(line => estimateTextWidth(line, fontSize)), 0) }
}

function estimateTextWidth(value, fontSize) {
  let units = 0
  for (const character of Array.from(String(value))) {
    if (/\s/u.test(character)) units += 0.34
    else if (/^[\u0000-\u00ff]$/u.test(character)) units += 0.56
    else units += 1
  }
  return units * fontSize
}

function svgConnection(parent, child, appearance) {
  const goesRight = child.x >= parent.x
  const startX = goesRight ? parent.x + parent.w : parent.x
  const endX = goesRight ? child.x : child.x + child.w
  const startY = parent.y + parent.h / 2
  const endY = child.y + child.h / 2
  const middleX = (startX + endX) / 2
  let pathData
  if (appearance.shape === 'straight') {
    pathData = `M ${formatNumber(startX)} ${formatNumber(startY)} L ${formatNumber(endX)} ${formatNumber(endY)}`
  } else if (appearance.shape === 'orthogonal') {
    pathData = `M ${formatNumber(startX)} ${formatNumber(startY)} H ${formatNumber(middleX)} V ${formatNumber(endY)} H ${formatNumber(endX)}`
  } else {
    const controlOffset = Math.max(20, Math.abs(endX - startX) * 0.5)
    const cp1X = goesRight ? startX + controlOffset : startX - controlOffset
    const cp2X = goesRight ? endX - controlOffset : endX + controlOffset
    pathData = `M ${formatNumber(startX)} ${formatNumber(startY)} C ${formatNumber(cp1X)} ${formatNumber(startY)}, ${formatNumber(cp2X)} ${formatNumber(endY)}, ${formatNumber(endX)} ${formatNumber(endY)}`
  }
  const dash = strokeDasharray(appearance.style)
  return `<path d="${pathData}" fill="none" stroke="${escapeXml(appearance.color)}" stroke-width="${formatNumber(appearance.width)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`
}

function svgRelations(relations, positions) {
  if (!Array.isArray(relations)) return []
  const pieces = []
  for (const relation of relations) {
    const from = positions.get(relation?.fromId)
    const to = positions.get(relation?.toId)
    if (!from || !to) continue
    const start = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
    const end = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
    const cp1 = validPoint(relation.cp1) || { x: start.x + (end.x - start.x) * 0.35, y: start.y - 30 }
    const cp2 = validPoint(relation.cp2) || { x: start.x + (end.x - start.x) * 0.65, y: end.y - 30 }
    const color = safeString(relation.style?.color || relation.color || '#f59e0b')
    const width = finiteNumber(relation.style?.width ?? relation.width, 2, 0.5, 30)
    pieces.push(`<path d="M ${formatNumber(start.x)} ${formatNumber(start.y)} C ${formatNumber(cp1.x)} ${formatNumber(cp1.y)}, ${formatNumber(cp2.x)} ${formatNumber(cp2.y)}, ${formatNumber(end.x)} ${formatNumber(end.y)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${formatNumber(width)}" stroke-dasharray="7 5" stroke-linecap="round"/>`)
  }
  return pieces
}

function svgNode(node, position, appearance, branchColor, textLayout) {
  const x = position.x
  const y = position.y
  const w = position.w
  const h = position.h
  const borderColor = appearance.borderColor === 'transparent' && appearance.shape !== 'underline'
    ? branchColor
    : appearance.borderColor
  const borderWidth = finiteNumber(appearance.borderWidth, appearance.shape === 'underline' ? 0 : 1, 0, 30)
  const fill = safeString(appearance.fill || 'transparent')
  const pieces = [`<g data-node-id="${escapeXml(node.id)}">`]
  const borderDash = strokeDasharray(appearance.borderStyle)
  const strokeAttrs = `stroke="${escapeXml(borderColor)}" stroke-width="${formatNumber(borderWidth)}"${borderDash ? ` stroke-dasharray="${borderDash}"` : ''}`

  if (appearance.shape === 'circle') {
    pieces.push(`<circle cx="${formatNumber(x + w / 2)}" cy="${formatNumber(y + h / 2)}" r="${formatNumber(Math.min(w, h) / 2)}" fill="${escapeXml(fill)}" ${strokeAttrs}/>`)
  } else if (appearance.shape === 'ellipse') {
    pieces.push(`<ellipse cx="${formatNumber(x + w / 2)}" cy="${formatNumber(y + h / 2)}" rx="${formatNumber(w / 2)}" ry="${formatNumber(h / 2)}" fill="${escapeXml(fill)}" ${strokeAttrs}/>`)
  } else if (appearance.shape === 'diamond') {
    pieces.push(`<polygon points="${formatNumber(x + w / 2)},${formatNumber(y)} ${formatNumber(x + w)},${formatNumber(y + h / 2)} ${formatNumber(x + w / 2)},${formatNumber(y + h)} ${formatNumber(x)},${formatNumber(y + h / 2)}" fill="${escapeXml(fill)}" ${strokeAttrs}/>`)
  } else if (appearance.shape === 'parallelogram') {
    const offset = Math.min(w * 0.12, h)
    pieces.push(`<polygon points="${formatNumber(x + offset)},${formatNumber(y)} ${formatNumber(x + w)},${formatNumber(y)} ${formatNumber(x + w - offset)},${formatNumber(y + h)} ${formatNumber(x)},${formatNumber(y + h)}" fill="${escapeXml(fill)}" ${strokeAttrs}/>`)
  } else if (appearance.shape === 'underline') {
    if (fill !== 'transparent') pieces.push(`<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(w)}" height="${formatNumber(h)}" fill="${escapeXml(fill)}"/>`)
    pieces.push(`<line x1="${formatNumber(x)}" y1="${formatNumber(y + h - 1)}" x2="${formatNumber(x + w)}" y2="${formatNumber(y + h - 1)}" stroke="${escapeXml(branchColor)}" stroke-width="${formatNumber(Math.max(1, borderWidth))}"${borderDash ? ` stroke-dasharray="${borderDash}"` : ''}/>`)
  } else {
    const shapeRadius = ({ rounded: 4, 'rounded-large': 10, 'soft-rect': 16 })[appearance.shape]
    const radius = appearance.shape === 'pill' || appearance.shape.startsWith('pill-')
      ? h / 2
      : appearance.shape === 'rect' ? 0 : finiteNumber(appearance.hasCustomRadius ? appearance.radius : (shapeRadius ?? appearance.radius), 6, 0, Math.min(w, h) / 2)
    pieces.push(`<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(w)}" height="${formatNumber(h)}" rx="${formatNumber(radius)}" fill="${escapeXml(fill)}" ${strokeAttrs}/>`)
  }

  if (node.image?.src && String(node.image.src).startsWith('data:image/')) {
    const imageWidth = Math.min(w, finiteNumber(node.image.w, 0, 0, w))
    const imageHeight = Math.min(h * 0.6, finiteNumber(node.image.h, 0, 0, h * 0.6))
    if (imageWidth > 0 && imageHeight > 0) {
      pieces.push(`<image href="${escapeXml(node.image.src)}" x="${formatNumber(x + (w - imageWidth) / 2)}" y="${formatNumber(y + 5)}" width="${formatNumber(imageWidth)}" height="${formatNumber(imageHeight)}" preserveAspectRatio="xMidYMid meet"/>`)
    }
  }

  const anchor = appearance.textAlign === 'left' ? 'start' : appearance.textAlign === 'right' ? 'end' : 'middle'
  const textX = anchor === 'start' ? x + 8 : anchor === 'end' ? x + w - 8 : x + w / 2
  const lineHeight = textLayout.lineHeight
  const textAreaCenterY = y + h / 2 + (textLayout.imageHeight || 0) / 2
  const firstY = textAreaCenterY - ((textLayout.lines.length - 1) * lineHeight) / 2
  const decoration = [appearance.underline ? 'underline' : '', appearance.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  pieces.push(`<text x="${formatNumber(textX)}" y="${formatNumber(firstY)}" text-anchor="${anchor}" dominant-baseline="central" font-family="${escapeXml(appearance.fontFamily)}" font-size="${formatNumber(textLayout.fontSize)}" font-weight="${appearance.bold ? '700' : '400'}" font-style="${appearance.italic ? 'italic' : 'normal'}"${decoration ? ` text-decoration="${decoration}"` : ''} fill="${escapeXml(appearance.textColor)}">`)
  textLayout.lines.forEach((line, index) => {
    pieces.push(`<tspan x="${formatNumber(textX)}"${index === 0 ? '' : ` dy="${formatNumber(lineHeight)}"`}>${escapeXml(line)}</tspan>`)
  })
  pieces.push('</text></g>')
  return pieces.join('')
}

function buildBranchLookup(root, activeTheme) {
  const palette = activeTheme.branchPalette
  const lookup = new Map([[root.id, palette[0]]])
  const children = Array.isArray(root.children) ? root.children : []
  children.forEach((branch, index) => {
    const color = activeTheme.rainbow ? palette[index % palette.length] : palette[0]
    const stack = [branch]
    while (stack.length > 0) {
      const node = stack.pop()
      lookup.set(node.id, color)
      const nested = Array.isArray(node.children) ? node.children : []
      for (let childIndex = nested.length - 1; childIndex >= 0; childIndex -= 1) stack.push(nested[childIndex])
    }
  })
  return lookup
}

function expandedClone(root) {
  const clone = typeof structuredClone === 'function'
    ? structuredClone(root)
    : JSON.parse(JSON.stringify(root))
  const stack = [clone]
  while (stack.length > 0) {
    const node = stack.pop()
    node.collapsed = false
    const children = Array.isArray(node.children) ? node.children : []
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index])
  }
  return clone
}

function mirrorLeftLayout(positions, rootId, layoutName) {
  if (layoutName !== 'mindmap-left' && layoutName !== 'tree-left') return
  const root = positions.get(rootId)
  if (!root) return
  const axis = root.x + root.w / 2
  for (const [id, position] of positions) {
    if (id === rootId) continue
    position.x = axis - (position.x + position.w - axis)
    position.side = 'left'
  }
}

function resolveCanvasColor(doc, activeTheme) {
  const candidate = String(doc?.canvas?.background || activeTheme.canvasBg || '#ffffff').trim()
  // CSS gradient 不能直接放進 SVG fill；此處安全回退到主題底色。
  return /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/iu.test(candidate)
    ? candidate
    : activeTheme.canvasBg || '#ffffff'
}

function emptySvg(doc, margin, transparent) {
  const size = Math.max(1, Math.ceil(margin * 2))
  const background = transparent ? '' : `<rect width="100%" height="100%" fill="${escapeXml(doc?.canvas?.background || '#ffffff')}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}</svg>`
}

function validPoint(value) {
  const x = Number(value?.x)
  const y = Number(value?.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function strokeDasharray(value) {
  return ({ dotted: '2 5', dashed: '7 5', 'dash-dot': '10 4 2 4', 'long-dash': '14 6 3 6' })[value] || ''
}

function finiteNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)))
}

function formatNumber(value) {
  return Number(value.toFixed(2)).toString()
}

function safeString(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function escapeHtmlWithBreaks(value) {
  return escapeHtml(value).replace(/\r\n?|\n/g, '<br>')
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
}

// 常見命名別名，讓 UI 層可依下載格式直接對映，不重複邏輯。
export const exportDocumentMindflow = exportDocumentJson
export const exportDocumentDoc = exportDocumentWord
export const exportDocumentSvg = documentToSvg
export const exportToTxt = exportDocumentTxt
export const exportToTXT = exportDocumentTxt
export const exportToMarkdown = exportDocumentMarkdown
export const exportToWord = exportDocumentWord
export const exportToDoc = exportDocumentWord
export const exportToJson = exportDocumentJson
export const exportToJSON = exportDocumentJson
export const exportToMindflow = exportDocumentJson
export const exportToSvg = documentToSvg
export const exportToSVG = documentToSvg
export const docToSvg = documentToSvg
export const docToSVG = documentToSvg
