/**
 * MindFlow 文件的純邏輯匯出器；只回傳字串，不下載檔案、不存取 DOM。
 */
import { getLayoutBounds, layout } from '../editor/layout.js'
import { serializeDoc, walkNodes } from '../editor/model.js'
import { getConnectionPath } from '../editor/render.js'
import { getLineAppearance, getNodeAppearance, getTheme } from '../editor/themes.js'

const DEFAULT_MARGIN = 80
const DEFAULT_MAX_TEXT_WIDTH = 220
const DEFAULT_INDENT = '  '
// overlay 樣式對齊 css/features.css 的 .relation-label / .summary-bracket / .summary-node。
const OVERLAY_FONT_FAMILY = 'Segoe UI, Noto Sans TC, sans-serif'
const SUMMARY_LABEL_HEIGHT = 28

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
  applyDocumentSpacing(positions, workingRoot.id, doc.canvas)

  const nodes = new Map()
  const parents = new Map()
  const branches = buildBranchLookup(workingRoot, activeTheme)

  walkNodes(workingRoot, (node, parent, depth) => {
    nodes.set(node.id, { node, depth })
    if (parent) parents.set(node.id, parent.id)
  }, { includeHidden: true })

  // overlay 幾何先算好，才能把關聯線標籤與概要括弧納入畫布邊界，避免匯出後被裁掉。
  const relationLayer = svgRelations(doc.relations, positions)
  const summaryLayer = svgSummaries(doc.summaries, nodes, positions, doc.layout)
  const bounds = expandBounds(getLayoutBounds(positions), [...relationLayer.boxes, ...summaryLayer.boxes])
  const width = Math.max(1, Math.ceil(bounds.width + margin * 2))
  const height = Math.max(1, Math.ceil(bounds.height + margin * 2))
  const offsetX = margin - bounds.minX
  const offsetY = margin - bounds.minY

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
    pieces.push(svgConnection(parent, child, appearance, child.connector || doc.layout))
  }
  pieces.push(...relationLayer.pieces, ...summaryLayer.pieces)

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
  const textLayout = wrapSvgRichText(node.richText, node.text, fontSize, maxTextWidth)
  const iconLabels = Array.isArray(node.icons) ? node.icons.map(exportIconLabel).filter(Boolean) : []
  const iconPrefix = iconLabels.length > 0 ? `${iconLabels.join(' ')} ` : ''
  if (iconPrefix) {
    textLayout.lines[0] = `${iconPrefix}${textLayout.lines[0]}`
    textLayout.runLines[0].unshift({ text: iconPrefix, style: {} })
  }
  textLayout.width = Math.min(maxTextWidth, Math.max(...textLayout.runLines.map(line => {
    return line.reduce((width, run) => width + estimateTextWidth(run.text, run.style.fontSize || fontSize), 0)
  }), 0))
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

function wrapSvgRichText(richText, plainText, fontSize, maxWidth) {
  const sourceRuns = richText ? parseRichTextRuns(richText) : []
  const runs = sourceRuns.length > 0 ? sourceRuns : [{ text: String(plainText ?? ''), style: {} }]
  const runLines = [[]]
  const lines = ['']
  let width = 0

  const nextLine = () => {
    runLines.push([])
    lines.push('')
    width = 0
  }
  for (const run of runs) {
    for (const character of Array.from(run.text)) {
      if (character === '\r') continue
      if (character === '\n') {
        nextLine()
        continue
      }
      const characterWidth = estimateTextWidth(character, run.style.fontSize || fontSize)
      if (lines.at(-1) && width + characterWidth > maxWidth) nextLine()
      lines[lines.length - 1] += character
      width += characterWidth
      const currentRuns = runLines.at(-1)
      const previous = currentRuns.at(-1)
      if (previous && sameTextStyle(previous.style, run.style)) previous.text += character
      else currentRuns.push({ text: character, style: { ...run.style } })
    }
  }
  if (runLines.length === 0) {
    runLines.push([])
    lines.push('')
  }
  return { lines, runLines, width: Math.max(...lines.map(line => estimateTextWidth(line, fontSize)), 0) }
}

export function parseRichTextRuns(html) {
  const tokens = String(html || '').match(/<[^>]*>|[^<]+/gu) || []
  const stack = [{ tag: '', style: {} }]
  const runs = []
  const append = (text, style = stack.at(-1).style) => {
    if (!text) return
    const decoded = decodeHtmlEntities(text).replace(/\u00a0/gu, ' ')
    if (!decoded) return
    const previous = runs.at(-1)
    if (previous && sameTextStyle(previous.style, style)) previous.text += decoded
    else runs.push({ text: decoded, style: { ...style } })
  }

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      append(token)
      continue
    }
    if (/^<\s*br\b/iu.test(token)) {
      append('\n')
      continue
    }
    const closing = token.match(/^<\s*\/\s*([a-z0-9-]+)/iu)
    if (closing) {
      const tag = closing[1].toLowerCase()
      const index = stack.map(entry => entry.tag).lastIndexOf(tag)
      if (index > 0) stack.splice(index)
      if (/^(div|p|li)$/u.test(tag) && !runs.at(-1)?.text.endsWith('\n')) append('\n')
      continue
    }
    if (/^<\s*[!?]/u.test(token)) continue
    const opening = token.match(/^<\s*([a-z0-9-]+)/iu)
    if (!opening) continue
    const tag = opening[1].toLowerCase()
    if (/^(div|p|li)$/u.test(tag) && runs.length > 0 && !runs.at(-1).text.endsWith('\n')) append('\n')
    const style = { ...stack.at(-1).style, ...styleFromTag(tag, token) }
    if (!/\/\s*>$/u.test(token) && !/^(br|hr|img|meta|link|input)$/u.test(tag)) stack.push({ tag, style })
  }
  while (runs.at(-1)?.text.endsWith('\n')) {
    runs[runs.length - 1].text = runs.at(-1).text.slice(0, -1)
    if (!runs.at(-1).text) runs.pop()
  }
  return runs
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

function exportIconLabel(token) {
  const value = String(token || '')
  if (!value || value.startsWith('__floating__:')) return ''
  const splitAt = value.indexOf(':')
  if (splitAt < 0) return value
  const category = value.slice(0, splitAt)
  const detail = value.slice(splitAt + 1)
  if (category === 'priority') return detail ? `P${detail}` : ''
  if (category === 'progress') return detail ? `${detail}%` : ''
  if (category === 'flag') return detail ? '⚑' : ''
  if (category === 'emoji' || category === 'symbol') return detail
  if (category === 'sticker') return detail ? '▣' : ''
  return detail || category
}

function svgConnection(parent, child, appearance, connector) {
  const goesRight = child.x >= parent.x
  const startX = goesRight ? parent.x + parent.w : parent.x
  const endX = goesRight ? child.x : child.x + child.w
  const startY = parent.y + parent.h / 2
  const endY = child.y + child.h / 2
  const middleX = (startX + endX) / 2
  let pathData
  if (['org', 'tree-right', 'tree-left', 'tree', 'timeline-h', 'timeline-v', 'fishbone'].includes(connector)) {
    pathData = getConnectionPath(parent, child, appearance.shape, connector)
  } else if (appearance.shape === 'straight') {
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
  const pieces = []
  const boxes = []
  if (!Array.isArray(relations)) return { pieces, boxes }
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

    const label = safeString(relation.label).trim()
    if (!label) continue
    // 與畫面一致：標籤釘在曲線 t=0.5 的位置，寬度沿用 relations.js drawRelations 的估算。
    const middle = cubicPoint(start, cp1, cp2, end, 0.5)
    const labelWidth = Math.max(48, Math.min(180, label.length * 14 + 16))
    pieces.push(`<g transform="translate(${formatNumber(middle.x)} ${formatNumber(middle.y)})"><rect x="${formatNumber(-labelWidth / 2)}" y="-13" width="${formatNumber(labelWidth)}" height="26" rx="7" fill="#ffffff" stroke="#f1a56f" stroke-width="1"/><text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-family="${OVERLAY_FONT_FAMILY}" font-size="12" font-weight="600" fill="#7c3b11">${escapeXml(label)}</text></g>`)
    boxes.push({ minX: middle.x - labelWidth / 2, minY: middle.y - 13, maxX: middle.x + labelWidth / 2, maxY: middle.y + 13 })
  }
  return { pieces, boxes }
}

function svgSummaries(summaries, nodes, positions, layoutName) {
  const pieces = []
  const boxes = []
  if (!Array.isArray(summaries)) return { pieces, boxes }
  for (const summary of summaries) {
    const parent = nodes.get(summary?.parentId)?.node
    if (!parent) continue
    const geometry = summaryGeometry(summary, parent, positions, layoutName)
    if (!geometry) continue
    const text = safeString(summary.text) || '概要'
    const labelWidth = Math.max(62, Math.min(180, estimateTextWidth(text, 12) + 20))
    const labelTop = geometry.middle - SUMMARY_LABEL_HEIGHT / 2
    // 尊重使用者自訂樣式（與畫面端 dnd.js decorateSummaryStyles 同一套對映）
    const summaryStyle = summary.style || {}
    const strokeColor = safeString(summaryStyle.lineColor) || '#f17e2e'
    const dash = ({ dotted: '2 7', dashed: '9 7', 'dash-dot': '10 5 2 5', 'long-dash': '16 8' })[summaryStyle.lineStyle] || ''
    const labelFill = safeString(summaryStyle.fill) || '#fff7ed'
    pieces.push(`<path d="${geometry.path}" stroke="${escapeXml(strokeColor)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''} fill="none"/>`)
    pieces.push(`<rect x="${formatNumber(geometry.labelX)}" y="${formatNumber(labelTop)}" width="${formatNumber(labelWidth)}" height="${SUMMARY_LABEL_HEIGHT}" rx="9" fill="${escapeXml(labelFill)}" stroke="#f2b487" stroke-width="1"/>`)
    pieces.push(`<text x="${formatNumber(geometry.labelX + 10)}" y="${formatNumber(geometry.middle)}" dominant-baseline="central" font-family="${OVERLAY_FONT_FAMILY}" font-size="12" font-weight="600" fill="#7c3b11">${escapeXml(text)}</text>`)
    boxes.push({
      minX: geometry.x,
      minY: Math.min(geometry.top, labelTop),
      maxX: geometry.labelX + labelWidth,
      maxY: Math.max(geometry.bottom, labelTop + SUMMARY_LABEL_HEIGHT)
    })
  }
  return { pieces, boxes }
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
  textLayout.runLines.forEach((line, index) => {
    const runs = line.length > 0 ? line : [{ text: '\u200b', style: {} }]
    runs.forEach((run, runIndex) => {
      const position = runIndex === 0
        ? ` x="${formatNumber(textX)}"${index === 0 ? '' : ` dy="${formatNumber(lineHeight)}"`}`
        : ''
      pieces.push(`<tspan${position}${svgRunAttributes(run.style)}>${escapeXml(run.text)}</tspan>`)
    })
  })
  pieces.push('</text></g>')
  return pieces.join('')
}

function styleFromTag(tag, token) {
  const style = {}
  if (tag === 'b' || tag === 'strong') style.bold = true
  if (tag === 'i' || tag === 'em') style.italic = true
  if (tag === 'u') style.underline = true
  if (tag === 's' || tag === 'strike' || tag === 'del') style.strike = true
  const styleText = readHtmlAttribute(token, 'style')
  for (const declaration of styleText.split(';')) {
    const splitAt = declaration.indexOf(':')
    if (splitAt < 1) continue
    const key = declaration.slice(0, splitAt).trim().toLowerCase()
    const value = declaration.slice(splitAt + 1).trim()
    if (key === 'color' && isSvgColor(value)) style.color = value
    if (key === 'font-weight' && (/bold/iu.test(value) || Number(value) >= 600)) style.bold = true
    if (key === 'font-style' && /italic|oblique/iu.test(value)) style.italic = true
    if (key === 'font-family' && value) style.fontFamily = value.replace(/["']/gu, '')
    if (key === 'font-size') {
      const size = Number.parseFloat(value)
      if (Number.isFinite(size)) style.fontSize = finiteNumber(size, 14, 6, 120)
    }
    if (key === 'text-decoration' && /underline/iu.test(value)) style.underline = true
    if (key === 'text-decoration' && /line-through/iu.test(value)) style.strike = true
  }
  const color = readHtmlAttribute(token, 'color')
  if (tag === 'font' && isSvgColor(color)) style.color = color
  const face = readHtmlAttribute(token, 'face')
  if (tag === 'font' && face) style.fontFamily = face.replace(/["']/gu, '')
  return style
}

function readHtmlAttribute(token, name) {
  const match = token.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu'))
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '')
}

function decodeHtmlEntities(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (entity, code) => {
    const normalized = code.toLowerCase()
    if (normalized.startsWith('#x')) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16))
    if (normalized.startsWith('#')) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' })[normalized] || entity
  })
}

function sameTextStyle(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {})
}

function isSvgColor(value) {
  return /^(?:#[\da-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/iu.test(String(value || '').trim())
}

function svgRunAttributes(style = {}) {
  const attributes = []
  if (style.bold) attributes.push('font-weight="700"')
  if (style.italic) attributes.push('font-style="italic"')
  if (style.color) attributes.push(`fill="${escapeXml(style.color)}"`)
  if (style.fontFamily) attributes.push(`font-family="${escapeXml(style.fontFamily)}"`)
  if (style.fontSize) attributes.push(`font-size="${formatNumber(style.fontSize)}"`)
  const decoration = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  if (decoration) attributes.push(`text-decoration="${decoration}"`)
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
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

function applyDocumentSpacing(positions, rootId, canvas) {
  const root = positions.get(rootId)
  if (!root) return
  const horizontalScale = Math.max(0.72, Math.min(2.4, 1 + ((Number(canvas?.spacingH) || 30) - 30) / 50))
  const verticalScale = Math.max(0.72, Math.min(2.4, 1 + ((Number(canvas?.spacingV) || 30) - 30) / 50))
  if (horizontalScale === 1 && verticalScale === 1) return
  const rootCenterX = root.x + root.w / 2
  const rootCenterY = root.y + root.h / 2
  // 與畫面渲染相同：只縮放節點中心距離，節點本身尺寸不變。
  for (const [id, position] of positions) {
    if (id === rootId) continue
    const centerX = position.x + position.w / 2
    const centerY = position.y + position.h / 2
    position.x = rootCenterX + (centerX - rootCenterX) * horizontalScale - position.w / 2
    position.y = rootCenterY + (centerY - rootCenterY) * verticalScale - position.h / 2
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

// 與 js/editor/relations.js 的 cubicPoint 同式；io 層自帶一份，不相依編輯器 overlay 模組。
function cubicPoint(p0, p1, p2, p3, t) {
  const a = (1 - t) ** 3
  const b = 3 * (1 - t) ** 2 * t
  const c = 3 * (1 - t) * t ** 2
  const d = t ** 3
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

/*
 * 以下四個概要幾何函數複製自 js/editor/summary.js（皆為純函數、無 DOM 依賴），
 * 讓 io 層不必相依編輯器 overlay 模組；那邊改幾何時，這裡要同步改。
 */
function summaryGeometry(summary, parent, positions, layoutName = 'mindmap-both') {
  const covered = getSummaryNodes(summary, parent, layoutName).map(child => positions.get(child.id)).filter(Boolean)
  if (covered.length === 0) return null
  const top = Math.min(...covered.map(position => position.y)) - 5
  const bottom = Math.max(...covered.map(position => position.y + position.h)) + 5
  const x = Math.max(...covered.map(position => position.x + position.w)) + 24
  const middle = (top + bottom) / 2
  const depth = Math.max(12, Math.min(24, (bottom - top) * 0.16))
  return {
    top,
    bottom,
    middle,
    x,
    labelX: x + 32,
    path: `M ${x + depth} ${top} C ${x + 5} ${top}, ${x + 8} ${middle - depth}, ${x} ${middle} C ${x + 8} ${middle + depth}, ${x + 5} ${bottom}, ${x + depth} ${bottom}`
  }
}

function getSummaryNodes(summary, parent, layoutName = 'mindmap-both') {
  if (!summary || !parent) return []
  const anchors = normalizeSummaryAnchors(summary, parent, layoutName)
  if (!anchors) return []
  const startNode = parent.children.find(node => node.id === anchors.startNodeId)
  if (!startNode) return []
  const siblings = getVisualSiblings(parent, startNode, layoutName)
  const start = siblings.findIndex(node => node.id === anchors.startNodeId)
  const end = siblings.findIndex(node => node.id === anchors.endNodeId)
  return start >= 0 && end >= start ? siblings.slice(start, end + 1) : []
}

function normalizeSummaryAnchors(summary, parent, layoutName = 'mindmap-both') {
  let startNodeId = summary.startNodeId
  let endNodeId = summary.endNodeId
  // 舊文件仍可讀取 index；一旦更新便遷移為穩定 nodeId 錨點。
  if (!startNodeId && Number.isFinite(Number(summary.startIndex))) {
    startNodeId = parent.children[Math.max(0, Math.min(parent.children.length - 1, Number(summary.startIndex)))]?.id
  }
  if (!endNodeId && Number.isFinite(Number(summary.endIndex))) {
    endNodeId = parent.children[Math.max(0, Math.min(parent.children.length - 1, Number(summary.endIndex)))]?.id
  }
  const startNode = parent.children.find(node => node.id === startNodeId)
  const endNode = parent.children.find(node => node.id === endNodeId)
  if (!startNode || !endNode) return null
  const siblings = getVisualSiblings(parent, startNode, layoutName)
  const start = siblings.findIndex(node => node.id === startNode.id)
  const end = siblings.findIndex(node => node.id === endNode.id)
  return start >= 0 && end >= start ? { startNodeId, endNodeId } : null
}

function getVisualSiblings(parent, anchor, layoutName = 'mindmap-both') {
  // 只有雙向心智圖會把 children 分到兩側；其他佈局的視覺順序就是 children 陣列順序。
  if ((layoutName === 'mindmap-both' || layoutName === 'mindmap') && (anchor?.side === 'left' || anchor?.side === 'right')) {
    return parent.children.filter(node => node.side === anchor.side)
  }
  return parent.children.slice()
}

function expandBounds(bounds, boxes) {
  if (boxes.length === 0) return bounds
  let { minX, minY, maxX, maxY } = bounds
  for (const box of boxes) {
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
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
