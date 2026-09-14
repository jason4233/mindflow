/**
 * 同父連續節點的概要 command、大括弧 overlay（方向依同級排列軸與父節點位置，見 summary-geometry.js）與範圍邊界拖曳。
 */
import { registerAction } from './actions.js'
import { buildMapContext, createId, findNode, findNodeContext, getFloatingMeta, structuredCloneSafe } from './model.js'
import { registerOverlay } from './render.js'
import { centerX, centerY, getSummaryNodes, getVisualSiblings, normalizeSummaryAnchors, summaryGeometry } from './summary-geometry.js'

export { getSummaryNodes, summaryGeometry }

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * 由選取的節點推導概要範圍。GitMind 允許「一個或多個相鄰同層節點」，所以單節點也成立。
 * 有 positions 時「相鄰」與起訖以畫面順序判定（魚骨圖陣列與畫面相反、父節點覆寫結構後 node.side 失效）。
 */
export function getSummaryRange(root, selectedIds, layoutName = 'mindmap-both', positions = null) {
  const contexts = Array.from(new Set(selectedIds)).map(id => findNodeContext(root, id)).filter(context => context?.parent)
  if (contexts.length < 1) return null
  const parent = contexts[0].parent
  if (contexts.some(context => context.parent !== parent)) return null
  // 概要不得跨圖：獨立心智圖的 root 與主圖分支都掛在 doc.root 底下，光比 parent 擋不住
  const mapRootId = contexts[0].mapRootId
  if (contexts.some(context => context.mapRootId !== mapRootId)) return null
  // 同層兄弟已排除獨立心智圖（它們不是這張圖的節點，混進來會讓「連續」判定錯位）
  const visualSiblings = getVisualSiblings(parent, contexts[0].node, layoutName, positions)
  const indexes = contexts.map(context => visualSiblings.findIndex(node => node.id === context.node.id)).sort((a, b) => a - b)
  if (indexes.some(index => index < 0)) return null
  if (indexes.some((value, index) => index > 0 && value !== indexes[index - 1] + 1)) return null
  return {
    parentId: parent.id,
    startNodeId: visualSiblings[indexes[0]].id,
    endNodeId: visualSiblings[indexes.at(-1)].id
  }
}

export function createSummaryCommand(doc, selectedIds, overrides = {}, positions = null) {
  const range = getSummaryRange(doc.root, selectedIds, doc.layout, positions)
  const summary = range ? {
    id: overrides.id || createId('summary'),
    ...range,
    text: String(overrides.text || '概要'),
    style: structuredCloneSafe(overrides.style || {})
  } : null
  let index = null
  return {
    description: '新增概要',
    summary,
    do: () => {
      if (!summary || !findNode(doc.root, summary.parentId)) return false
      if (!Array.isArray(doc.summaries)) doc.summaries = []
      if (doc.summaries.some(item => item.id === summary.id)) return false
      if (index === null) index = doc.summaries.length
      doc.summaries.splice(Math.min(index, doc.summaries.length), 0, structuredCloneSafe(summary))
      return true
    },
    undo: () => {
      const current = doc.summaries?.findIndex(item => item.id === summary?.id) ?? -1
      if (current >= 0) doc.summaries.splice(current, 1)
    }
  }
}

export function updateSummaryCommand(doc, summaryId, patch, description = '調整概要', positions = null) {
  let previous = null
  const next = structuredCloneSafe(patch || {})
  return {
    description,
    do: () => {
      const summary = doc.summaries?.find(item => item.id === summaryId)
      if (!summary) return false
      const candidate = { ...structuredCloneSafe(summary), ...structuredCloneSafe(next) }
      const parent = findNode(doc.root, candidate.parentId)
      if (!parent || parent.children.length === 0) return false
      const anchors = normalizeSummaryAnchors(candidate, parent, doc.layout, positions)
      if (!anchors) return false
      Object.assign(candidate, anchors)
      delete candidate.startIndex
      delete candidate.endIndex
      if (JSON.stringify(summary) === JSON.stringify(candidate)) return false
      if (!previous) previous = structuredCloneSafe(summary)
      Object.assign(summary, candidate)
      delete summary.startIndex
      delete summary.endIndex
      return JSON.stringify(summary) !== JSON.stringify(previous)
    },
    undo: () => {
      const index = doc.summaries?.findIndex(item => item.id === summaryId) ?? -1
      if (index >= 0 && previous) doc.summaries[index] = structuredCloneSafe(previous)
    }
  }
}

export function removeSummaryCommand(doc, summaryId) {
  let removed = null
  let index = -1
  return {
    description: '刪除概要',
    do: () => {
      const current = doc.summaries?.findIndex(item => item.id === summaryId) ?? -1
      if (current < 0) return false
      if (!removed) { index = current; removed = structuredCloneSafe(doc.summaries[current]) }
      doc.summaries.splice(current, 1)
      return true
    },
    undo: () => {
      if (removed) doc.summaries.splice(Math.min(index, doc.summaries.length), 0, structuredCloneSafe(removed))
    }
  }
}

export function initializeSummaries(ctx) {
  const selectSummary = id => {
    ctx.featureState.selectedOverlay = { type: 'summary', id }
    ctx.selection.clear()
    ctx.renderAll()
  }
  const editSummary = id => {
    const summary = ctx.doc.summaries.find(item => item.id === id)
    const label = document.querySelector(`[data-summary-node="${cssEscape(id)}"]`)
    if (!summary || !label) return false
    const rect = label.getBoundingClientRect()
    const input = document.createElement('input')
    input.className = 'feature-inline-editor'
    input.value = summary.text
    input.style.left = `${rect.left}px`
    input.style.top = `${rect.top}px`
    document.body.append(input)
    let finished = false
    const finish = commit => {
      if (finished) return
      finished = true
      const value = input.value.trim() || '概要'
      input.remove()
      if (commit && value !== summary.text) ctx.manager.execute(updateSummaryCommand(ctx.doc, id, { text: value }, '編輯概要文字'))
    }
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true) }
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
    })
    input.addEventListener('blur', () => finish(true))
    input.focus()
    input.select()
    return true
  }

  registerOverlay(overlayCtx => drawSummaries(overlayCtx, ctx, selectSummary, editSummary))
  ctx.featureHandlers.removeSummary = id => ctx.manager.execute(removeSummaryCommand(ctx.doc, id))
  ctx.featureHandlers.editSummary = editSummary

  registerAction('insertSummary', () => {
    const command = createSummaryCommand(ctx.doc, ctx.selection.getSelectedIds(), {}, ctx.getPositions())
    if (!command.summary) {
      ctx.notify('概要需要選取同一父節點底下、畫面上相鄰的同級節點')
      return false
    }
    if (!ctx.manager.execute(command)) return false
    selectSummary(command.summary.id)
    return true
  })
}

function drawSummaries(overlayCtx, appCtx, selectSummary, editSummary) {
  for (const summary of overlayCtx.doc.summaries || []) {
    const parent = findNode(overlayCtx.doc.root, summary.parentId)
    if (!parent) continue
    const geometry = summaryGeometry(summary, parent, overlayCtx.positions, overlayCtx.doc.layout)
    if (!geometry) continue
    const selected = appCtx.featureState.selectedOverlay?.type === 'summary' && appCtx.featureState.selectedOverlay.id === summary.id
    const summaryMapRoot = buildMapContext(overlayCtx.doc.root).get(summary.parentId)?.mapRootId
    const path = svgElement('path', {
      d: geometry.path,
      class: `summary-bracket${selected ? ' is-selected' : ''}`,
      'data-summary-id': summary.id,
      ...(summaryMapRoot ? { 'data-map-root': summaryMapRoot } : {})
    })
    path.addEventListener('click', event => { event.stopPropagation(); selectSummary(summary.id) })
    overlayCtx.svgLayer.append(path)

    const label = document.createElement('button')
    label.type = 'button'
    label.className = `summary-node${selected ? ' is-selected' : ''}`
    label.dataset.summaryNode = summary.id
    if (summaryMapRoot) label.dataset.mapRoot = summaryMapRoot
    label.textContent = summary.text || '概要'
    // 標籤錨點在括號外側；由 CSS 依 data-summary-side 決定往哪個方向對齊（右：靠左緣、左：靠右緣、下／上：水平置中）
    label.dataset.summarySide = geometry.side
    label.style.left = `${geometry.labelX}px`
    label.style.top = `${geometry.labelY}px`
    label.addEventListener('click', event => { event.stopPropagation(); selectSummary(summary.id) })
    label.addEventListener('dblclick', event => { event.stopPropagation(); editSummary(summary.id) })
    overlayCtx.nodesLayer.append(label)

    if (selected) {
      for (const boundary of geometry.boundaries) {
        const control = svgElement('circle', {
          cx: boundary.cx, cy: boundary.cy, r: 7, class: 'summary-boundary', 'data-summary-edge': boundary.edge,
          ...(summaryMapRoot ? { 'data-map-root': summaryMapRoot } : {})
        })
        control.addEventListener('pointerdown', event => beginBoundaryDrag(event, summary, parent, boundary.edge, geometry, appCtx, control))
        overlayCtx.svgLayer.append(control)
      }
    }
  }
}

function beginBoundaryDrag(event, summary, parent, edge, geometry, ctx, control) {
  // 右鍵是框選／右鍵選單的手勢，不得順便改文件
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const pointerId = event.pointerId
  // 控制點只沿括號主軸滑動：直立括號跟 y、橫向括號跟 x
  const vertical = geometry.orientation !== 'horizontal'
  const attribute = vertical ? 'cy' : 'cx'
  const along = position => vertical ? centerY(position) : centerX(position)
  let latest = Number(control.getAttribute(attribute))
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    const world = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY)
    latest = vertical ? world.y : world.x
    control.setAttribute(attribute, latest)
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    // 同級順序、起訖與最近節點都以畫面位置為準（魚骨圖陣列與畫面相反）
    const positions = ctx.getPositions()
    const covered = getSummaryNodes(summary, parent, ctx.doc.layout, positions)
    const anchor = covered[0]
    const visualSiblings = anchor ? getVisualSiblings(parent, anchor, ctx.doc.layout, positions) : []
    const candidates = visualSiblings.map((child, index) => ({ child, index, position: positions.get(child.id) })).filter(item => item.position)
    const nearest = candidates.sort((a, b) => Math.abs(along(a.position) - latest) - Math.abs(along(b.position) - latest))[0]
    if (!nearest) { ctx.renderAll(); return }
    const startIndex = visualSiblings.findIndex(child => child.id === covered[0]?.id)
    const endIndex = visualSiblings.findIndex(child => child.id === covered.at(-1)?.id)
    const patch = edge === 'startNodeId'
      ? { startNodeId: visualSiblings[Math.min(nearest.index, endIndex)]?.id }
      : { endNodeId: visualSiblings[Math.max(nearest.index, startIndex)]?.id }
    ctx.manager.execute(updateSummaryCommand(ctx.doc, summary.id, patch, '調整概要範圍', positions))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  Object.entries(attributes).forEach(([key, value]) => { if (value !== '') element.setAttribute(key, String(value)) })
  return element
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
