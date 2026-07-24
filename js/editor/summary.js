/**
 * 同父連續節點的概要 command、右側大括弧 overlay 與範圍邊界拖曳。
 */
import { registerAction } from './actions.js'
import { createId, findNode, findNodeContext, structuredCloneSafe } from './model.js'
import { registerOverlay } from './render.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function getSummaryRange(root, selectedIds, layoutName = 'mindmap-both') {
  const contexts = Array.from(new Set(selectedIds)).map(id => findNodeContext(root, id)).filter(context => context?.parent)
  if (contexts.length < 2) return null
  const parent = contexts[0].parent
  if (contexts.some(context => context.parent !== parent)) return null
  // 根節點 children 會左右交錯保存；概要的「連續」必須以同側視覺順序判定。
  const visualSiblings = getVisualSiblings(parent, contexts[0].node, layoutName)
  const indexes = contexts.map(context => visualSiblings.findIndex(node => node.id === context.node.id)).sort((a, b) => a - b)
  if (indexes.some(index => index < 0)) return null
  if (indexes.some((value, index) => index > 0 && value !== indexes[index - 1] + 1)) return null
  return {
    parentId: parent.id,
    startNodeId: visualSiblings[indexes[0]].id,
    endNodeId: visualSiblings[indexes.at(-1)].id
  }
}

export function createSummaryCommand(doc, selectedIds, overrides = {}) {
  const range = getSummaryRange(doc.root, selectedIds, doc.layout)
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

export function updateSummaryCommand(doc, summaryId, patch, description = '調整概要') {
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
      const anchors = normalizeSummaryAnchors(candidate, parent, doc.layout)
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

export function summaryGeometry(summary, parent, positions, layoutName = 'mindmap-both') {
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

export function getSummaryNodes(summary, parent, layoutName = 'mindmap-both') {
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
    const command = createSummaryCommand(ctx.doc, ctx.selection.getSelectedIds())
    if (!command.summary) {
      ctx.notify('概要需要選取至少兩個同父、連續的同級節點')
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
    const path = svgElement('path', {
      d: geometry.path,
      class: `summary-bracket${selected ? ' is-selected' : ''}`,
      'data-summary-id': summary.id
    })
    path.addEventListener('click', event => { event.stopPropagation(); selectSummary(summary.id) })
    overlayCtx.svgLayer.append(path)

    const label = document.createElement('button')
    label.type = 'button'
    label.className = `summary-node${selected ? ' is-selected' : ''}`
    label.dataset.summaryNode = summary.id
    label.textContent = summary.text || '概要'
    label.style.left = `${geometry.labelX}px`
    label.style.top = `${geometry.middle}px`
    label.addEventListener('click', event => { event.stopPropagation(); selectSummary(summary.id) })
    label.addEventListener('dblclick', event => { event.stopPropagation(); editSummary(summary.id) })
    overlayCtx.nodesLayer.append(label)

    if (selected) {
      for (const edge of ['startNodeId', 'endNodeId']) {
        const y = edge === 'startNodeId' ? geometry.top : geometry.bottom
        const control = svgElement('circle', { cx: geometry.x + 20, cy: y, r: 7, class: 'summary-boundary', 'data-summary-edge': edge })
        control.addEventListener('pointerdown', event => beginBoundaryDrag(event, summary, parent, edge, geometry, appCtx, control))
        overlayCtx.svgLayer.append(control)
      }
    }
  }
}

function beginBoundaryDrag(event, summary, parent, edge, geometry, ctx, control) {
  event.preventDefault()
  event.stopPropagation()
  const pointerId = event.pointerId
  let latestY = Number(control.getAttribute('cy'))
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    latestY = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY).y
    control.setAttribute('cy', latestY)
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    const covered = getSummaryNodes(summary, parent, ctx.doc.layout)
    const anchor = covered[0]
    const visualSiblings = anchor ? getVisualSiblings(parent, anchor, ctx.doc.layout) : []
    const candidates = visualSiblings.map((child, index) => ({ child, index, position: ctx.getPositions().get(child.id) })).filter(item => item.position)
    const nearest = candidates.sort((a, b) => Math.abs(centerY(a.position) - latestY) - Math.abs(centerY(b.position) - latestY))[0]
    if (!nearest) { ctx.renderAll(); return }
    const startIndex = visualSiblings.findIndex(child => child.id === covered[0]?.id)
    const endIndex = visualSiblings.findIndex(child => child.id === covered.at(-1)?.id)
    const patch = edge === 'startNodeId'
      ? { startNodeId: visualSiblings[Math.min(nearest.index, endIndex)]?.id }
      : { endNodeId: visualSiblings[Math.max(nearest.index, startIndex)]?.id }
    ctx.manager.execute(updateSummaryCommand(ctx.doc, summary.id, patch, '調整概要範圍'))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
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

function centerY(position) { return position.y + position.h / 2 }
function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  return element
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
