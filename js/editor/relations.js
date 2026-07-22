/**
 * 關聯線 command、貝茲 overlay 與控制點互動；不介入樹狀連接線核心渲染。
 */
import { registerAction, runAction } from './actions.js'
import { deleteNodes, setStyle } from './commands.js'
import { createId, findNode, findNodeContext, structuredCloneSafe } from './model.js'
import { encodeLineToken } from './themes.js'
import { registerOverlay } from './render.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_STYLE = Object.freeze({ color: '#f17e2e', width: 2, lineStyle: 'dashed' })

export function createRelationCommand(doc, fromId, toId, overrides = {}) {
  const relation = {
    id: overrides.id || createId('relation'),
    fromId,
    toId,
    label: String(overrides.label || ''),
    // 控制點存相對於自然曲線控制點的偏移，佈局改變後弧度仍然合理。
    cp1: normalizePoint(overrides.cp1, { x: 0, y: -48 }),
    cp2: normalizePoint(overrides.cp2, { x: 0, y: 48 }),
    style: normalizeRelationStyle(overrides.style)
  }
  return collectionInsertCommand(doc, 'relations', relation, '新增關聯線', item => {
    if (!findNode(doc.root, item.fromId) || !findNode(doc.root, item.toId)) return false
    if (item.fromId === item.toId) return false
    return !doc.relations.some(existing => existing.fromId === item.fromId && existing.toId === item.toId)
  })
}

export function updateRelationCommand(doc, relationId, patch, description = '調整關聯線') {
  let previous = null
  const nextPatch = structuredCloneSafe(patch || {})
  return {
    description,
    do: () => {
      const relation = doc.relations?.find(item => item.id === relationId)
      if (!relation) return false
      if (nextPatch.fromId && !findNode(doc.root, nextPatch.fromId)) return false
      if (nextPatch.toId && !findNode(doc.root, nextPatch.toId)) return false
      if ((nextPatch.fromId || relation.fromId) === (nextPatch.toId || relation.toId)) return false
      if (!previous) previous = structuredCloneSafe(relation)
      const { style, ...fields } = structuredCloneSafe(nextPatch)
      Object.assign(relation, fields)
      if (nextPatch.cp1) relation.cp1 = normalizePoint(nextPatch.cp1)
      if (nextPatch.cp2) relation.cp2 = normalizePoint(nextPatch.cp2)
      if (style) relation.style = normalizeRelationStyle({ ...relation.style, ...style })
      return JSON.stringify(relation) !== JSON.stringify(previous)
    },
    undo: () => {
      const index = doc.relations?.findIndex(item => item.id === relationId) ?? -1
      if (index >= 0 && previous) doc.relations[index] = structuredCloneSafe(previous)
    }
  }
}

export function removeRelationCommand(doc, relationId) {
  return collectionRemoveCommand(doc, 'relations', relationId, '刪除關聯線')
}

export function setRelationStyleCommand(doc, relationId, patch) {
  const stylePatch = {}
  if (patch.color || patch.lineColor) stylePatch.color = patch.color || patch.lineColor
  if (patch.width !== undefined || patch.lineWidth !== undefined) stylePatch.width = Number(patch.width ?? patch.lineWidth)
  if (patch.lineStyle || patch.style) stylePatch.lineStyle = patch.lineStyle || patch.style
  return updateRelationCommand(doc, relationId, { style: stylePatch }, '設定關聯線樣式')
}

export function relationGeometry(positions, relation) {
  const from = positions.get(relation.fromId)
  const to = positions.get(relation.toId)
  if (!from || !to) return null
  const goesRight = centerX(to) >= centerX(from)
  const start = { x: goesRight ? from.x + from.w : from.x, y: from.y + from.h / 2 }
  const end = { x: goesRight ? to.x : to.x + to.w, y: to.y + to.h / 2 }
  const baseCp1 = { x: start.x + (end.x - start.x) * 0.34, y: start.y + (end.y - start.y) * 0.22 }
  const baseCp2 = { x: start.x + (end.x - start.x) * 0.66, y: start.y + (end.y - start.y) * 0.78 }
  const cp1Offset = normalizePoint(relation.cp1, { x: 0, y: -48 })
  const cp2Offset = normalizePoint(relation.cp2, { x: 0, y: 48 })
  const cp1 = { x: baseCp1.x + cp1Offset.x, y: baseCp1.y + cp1Offset.y }
  const cp2 = { x: baseCp2.x + cp2Offset.x, y: baseCp2.y + cp2Offset.y }
  return {
    start,
    end,
    cp1,
    cp2,
    baseCp1,
    baseCp2,
    path: `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`,
    label: cubicPoint(start, cp1, cp2, end, 0.5)
  }
}

export function initializeRelations(ctx) {
  const state = ctx.featureState
  let relationSourceId = null

  const selectRelation = id => {
    state.selectedOverlay = { type: 'relation', id }
    ctx.selection.clear()
    ctx.renderAll()
  }

  const startLabelEdit = relationId => {
    const relation = ctx.doc.relations.find(item => item.id === relationId)
    const label = document.querySelector(`[data-relation-label="${cssEscape(relationId)}"]`)
    if (!relation || !label) return false
    const rect = label.getBoundingClientRect()
    const input = document.createElement('input')
    input.className = 'feature-inline-editor'
    input.value = relation.label || ''
    input.placeholder = '關聯說明'
    input.style.left = `${Math.max(8, rect.left - 30)}px`
    input.style.top = `${Math.max(8, rect.top - 8)}px`
    document.body.append(input)
    let finished = false
    const finish = commit => {
      if (finished) return
      finished = true
      const value = input.value.trim()
      input.remove()
      if (commit && value !== relation.label) ctx.manager.execute(updateRelationCommand(ctx.doc, relationId, { label: value }, '編輯關聯線標籤'))
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

  registerOverlay(overlayCtx => drawRelations(overlayCtx, ctx, selectRelation, startLabelEdit))

  ctx.elements.nodesLayer.addEventListener('click', event => {
    const target = event.target.closest('.mind-node')
    if (!target || !relationSourceId) return
    const targetId = target.dataset.nodeId
    const sourceId = relationSourceId
    relationSourceId = null
    ctx.elements.canvas.classList.remove('is-relation-picking')
    if (targetId === sourceId) {
      ctx.notify('關聯線不能連到同一節點')
      return
    }
    const command = createRelationCommand(ctx.doc, sourceId, targetId)
    if (ctx.manager.execute(command)) selectRelation(command.item.id)
    else ctx.notify('這兩個節點已有關聯線')
  })

  window.addEventListener('mindflow:selectionchange', event => {
    if (event.detail?.ids?.length && state.selectedOverlay) state.selectedOverlay = null
  })

  ctx.featureHandlers.removeRelation = id => ctx.manager.execute(removeRelationCommand(ctx.doc, id))
  ctx.featureHandlers.editRelation = startLabelEdit
  ctx.featureHandlers.escape.push(() => {
    relationSourceId = null
    ctx.elements.canvas.classList.remove('is-relation-picking')
  })

  registerAction('insertRelation', () => {
    const sourceId = ctx.selection.primaryId
    if (!sourceId) { ctx.notify('請先選取關聯線起點'); return false }
    relationSourceId = sourceId
    state.selectedOverlay = null
    ctx.elements.canvas.classList.add('is-relation-picking')
    ctx.notify('請點選關聯線的目標節點')
    return true
  })

  // 接管這些既有 action，先處理 overlay 選取，否則完整保留節點原行為。
  registerAction('remove', () => {
    const selected = state.selectedOverlay
    if (selected?.type === 'relation') {
      state.selectedOverlay = null
      return ctx.manager.execute(removeRelationCommand(ctx.doc, selected.id))
    }
    if (selected?.type === 'summary') {
      state.selectedOverlay = null
      return ctx.featureHandlers.removeSummary?.(selected.id) || false
    }
    const ids = ctx.selection.getSelectedIds()
    if (ids.length === 0) return false
    const fallback = findNodeContext(ctx.doc.root, ctx.selection.primaryId)?.parent?.id || ctx.doc.root.id
    if (!ctx.manager.execute(deleteNodes(ctx.doc, ids))) return false
    ctx.selection.set([fallback])
    return true
  })

  registerAction('edit', () => {
    const selected = state.selectedOverlay
    if (selected?.type === 'relation') return startLabelEdit(selected.id)
    if (selected?.type === 'summary') return ctx.featureHandlers.editSummary?.(selected.id) || false
    return ctx.selection.primaryId ? ctx.edit.start(ctx.selection.primaryId) : false
  })

  registerAction('applyStyle', patch => {
    const selected = state.selectedOverlay
    if (selected?.type === 'relation') return ctx.manager.execute(setRelationStyleCommand(ctx.doc, selected.id, patch || {}))
    const ids = ctx.selection.getSelectedIds()
    return ids.length > 0 && patch && typeof patch === 'object' ? ctx.manager.execute(setStyle(ctx.doc, ids, patch)) : false
  })

  registerAction('setLineStyle', config => {
    const selected = state.selectedOverlay
    if (selected?.type === 'relation') return ctx.manager.execute(setRelationStyleCommand(ctx.doc, selected.id, { lineStyle: config?.style }))
    const ids = ctx.selection.getSelectedIds()
    if (ids.length === 0) return false
    let previous = null
    return ctx.manager.execute({
      description: '設定連接線樣式',
      do: () => {
        const nodes = ids.map(id => findNode(ctx.doc.root, id)).filter(Boolean)
        if (nodes.length === 0) return false
        if (!previous) previous = nodes.map(node => ({ id: node.id, value: node.style.lineStyle }))
        nodes.forEach(node => { node.style.lineStyle = encodeLineToken(node.style.lineStyle, config?.style, config?.shape) })
        return true
      },
      undo: () => previous?.forEach(record => {
        const node = findNode(ctx.doc.root, record.id)
        if (!node) return
        if (record.value === undefined) delete node.style.lineStyle
        else node.style.lineStyle = record.value
      })
    })
  })

  registerAction('applyRelationStyle', patch => {
    const selected = state.selectedOverlay
    return selected?.type === 'relation'
      ? ctx.manager.execute(setRelationStyleCommand(ctx.doc, selected.id, patch || {}))
      : false
  })

  // FIX 版色票以 preview/commit action 維持節點預覽；監看既有 swatch，僅在 relation 選取時轉送。
  const lineColorTrigger = document.querySelector('[data-panel-view="style"] [data-picker="line"] .color-trigger')
  if (lineColorTrigger) {
    const observer = new MutationObserver(() => {
      if (state.selectedOverlay?.type !== 'relation') return
      const color = lineColorTrigger.style.getPropertyValue('--swatch').trim()
      if (/^#[0-9a-f]{6}$/iu.test(color)) runAction('applyRelationStyle', { color })
    })
    observer.observe(lineColorTrigger, { attributes: true, attributeFilter: ['style'] })
  }

  registerAction('escape', () => {
    ctx.featureHandlers.escape.forEach(handler => handler())
    state.selectedOverlay = null
    ctx.selection.clear()
    ctx.renderAll()
    return true
  })
}

function drawRelations(overlayCtx, appCtx, selectRelation, startLabelEdit) {
  const { doc, positions, svgLayer } = overlayCtx
  for (const relation of doc.relations || []) {
    const geometry = relationGeometry(positions, relation)
    if (!geometry) continue
    const selected = appCtx.featureState.selectedOverlay?.type === 'relation' && appCtx.featureState.selectedOverlay.id === relation.id
    const group = svgElement('g', { class: `relation-overlay${selected ? ' is-selected' : ''}`, 'data-relation-id': relation.id })
    const hit = svgElement('path', { d: geometry.path, class: 'relation-hitarea' })
    const path = svgElement('path', {
      d: geometry.path,
      class: 'relation-path',
      stroke: relation.style?.color || DEFAULT_STYLE.color,
      'stroke-width': clamp(relation.style?.width, 1, 8, DEFAULT_STYLE.width),
      'stroke-dasharray': relationDash(relation.style?.lineStyle)
    })
    hit.addEventListener('click', event => { event.stopPropagation(); selectRelation(relation.id) })
    hit.addEventListener('dblclick', event => { event.stopPropagation(); selectRelation(relation.id); startLabelEdit(relation.id) })
    group.append(hit, path)

    if (relation.label || selected) {
      const label = svgElement('g', {
        class: 'relation-label',
        transform: `translate(${geometry.label.x} ${geometry.label.y})`,
        'data-relation-label': relation.id
      })
      const width = Math.max(48, Math.min(180, (relation.label || '雙擊輸入').length * 14 + 16))
      label.append(
        svgElement('rect', { x: -width / 2, y: -13, width, height: 26, rx: 7 }),
        svgText(relation.label || '雙擊輸入')
      )
      label.addEventListener('click', event => { event.stopPropagation(); selectRelation(relation.id) })
      label.addEventListener('dblclick', event => { event.stopPropagation(); startLabelEdit(relation.id) })
      group.append(label)
    }

    if (selected) appendRelationHandles(group, relation, geometry, appCtx)
    svgLayer.append(group)
  }
}

function appendRelationHandles(group, relation, geometry, ctx) {
  group.append(
    svgElement('path', { d: `M ${geometry.start.x} ${geometry.start.y} L ${geometry.cp1.x} ${geometry.cp1.y}`, class: 'relation-guide' }),
    svgElement('path', { d: `M ${geometry.end.x} ${geometry.end.y} L ${geometry.cp2.x} ${geometry.cp2.y}`, class: 'relation-guide' })
  )
  for (const key of ['cp1', 'cp2']) {
    const point = geometry[key]
    const handle = svgElement('circle', { cx: point.x, cy: point.y, r: 7, class: 'relation-control', 'data-handle': key })
    handle.addEventListener('pointerdown', event => beginControlDrag(event, relation, key, geometry, ctx, group))
    group.append(handle)
  }
  for (const key of ['fromId', 'toId']) {
    const point = key === 'fromId' ? geometry.start : geometry.end
    const handle = svgElement('circle', { cx: point.x, cy: point.y, r: 6, class: 'relation-endpoint', 'data-handle': key })
    handle.addEventListener('pointerdown', event => beginEndpointDrag(event, relation, key, geometry, ctx, group))
    group.append(handle)
  }
}

function beginControlDrag(event, relation, key, geometry, ctx, group) {
  event.preventDefault()
  event.stopPropagation()
  const pointerId = event.pointerId
  let latest = geometry[key]
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    latest = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY)
    group.querySelector(`[data-handle="${key}"]`)?.setAttribute('cx', latest.x)
    group.querySelector(`[data-handle="${key}"]`)?.setAttribute('cy', latest.y)
    const cp1 = key === 'cp1' ? latest : geometry.cp1
    const cp2 = key === 'cp2' ? latest : geometry.cp2
    group.querySelector('.relation-path')?.setAttribute('d', `M ${geometry.start.x} ${geometry.start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${geometry.end.x} ${geometry.end.y}`)
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    cleanupPointer(move, end)
    const base = key === 'cp1' ? geometry.baseCp1 : geometry.baseCp2
    ctx.manager.execute(updateRelationCommand(ctx.doc, relation.id, { [key]: { x: latest.x - base.x, y: latest.y - base.y } }))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function beginEndpointDrag(event, relation, key, geometry, ctx, group) {
  event.preventDefault()
  event.stopPropagation()
  const pointerId = event.pointerId
  let latest = key === 'fromId' ? geometry.start : geometry.end
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    latest = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY)
    const start = key === 'fromId' ? latest : geometry.start
    const endPoint = key === 'toId' ? latest : geometry.end
    group.querySelector(`[data-handle="${key}"]`)?.setAttribute('cx', latest.x)
    group.querySelector(`[data-handle="${key}"]`)?.setAttribute('cy', latest.y)
    group.querySelector('.relation-path')?.setAttribute('d', `M ${start.x} ${start.y} C ${geometry.cp1.x} ${geometry.cp1.y}, ${geometry.cp2.x} ${geometry.cp2.y}, ${endPoint.x} ${endPoint.y}`)
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    cleanupPointer(move, end)
    const nodeElement = document.elementsFromPoint(endEvent.clientX, endEvent.clientY).find(element => element.classList?.contains('mind-node'))
    const targetId = nodeElement?.dataset.nodeId
    if (!targetId) { ctx.renderAll(); return }
    const otherId = key === 'fromId' ? relation.toId : relation.fromId
    if (targetId === otherId) { ctx.notify('關聯線兩端不能是同一節點'); ctx.renderAll(); return }
    ctx.manager.execute(updateRelationCommand(ctx.doc, relation.id, { [key]: targetId }, '重新吸附關聯線端點'))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function collectionInsertCommand(doc, key, item, description, validate) {
  let index = null
  return {
    description,
    item,
    do: () => {
      if (!Array.isArray(doc[key])) doc[key] = []
      if (!validate(item) || doc[key].some(existing => existing.id === item.id)) return false
      if (index === null) index = doc[key].length
      doc[key].splice(Math.min(index, doc[key].length), 0, structuredCloneSafe(item))
      return true
    },
    undo: () => {
      const current = doc[key]?.findIndex(existing => existing.id === item.id) ?? -1
      if (current >= 0) doc[key].splice(current, 1)
    }
  }
}

function collectionRemoveCommand(doc, key, id, description) {
  let removed = null
  let index = -1
  return {
    description,
    do: () => {
      const current = doc[key]?.findIndex(item => item.id === id) ?? -1
      if (current < 0) return false
      if (!removed) { index = current; removed = structuredCloneSafe(doc[key][current]) }
      doc[key].splice(current, 1)
      return true
    },
    undo: () => {
      if (removed) doc[key].splice(Math.min(index, doc[key].length), 0, structuredCloneSafe(removed))
    }
  }
}

function normalizeRelationStyle(style = {}) {
  return {
    color: /^#[0-9a-f]{3,8}$/i.test(style.color || '') ? style.color : DEFAULT_STYLE.color,
    width: clamp(style.width, 1, 8, DEFAULT_STYLE.width),
    lineStyle: ['solid', 'dotted', 'dashed', 'dash-dot', 'long-dash'].includes(style.lineStyle) ? style.lineStyle : DEFAULT_STYLE.lineStyle
  }
}

function normalizePoint(point, fallback = { x: 0, y: 0 }) {
  return {
    x: Number.isFinite(Number(point?.x)) ? Number(point.x) : fallback.x,
    y: Number.isFinite(Number(point?.y)) ? Number(point.y) : fallback.y
  }
}

function cubicPoint(p0, p1, p2, p3, t) {
  const a = (1 - t) ** 3
  const b = 3 * (1 - t) ** 2 * t
  const c = 3 * (1 - t) * t ** 2
  const d = t ** 3
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

function relationDash(style) {
  return ({ dotted: '2 7', dashed: '9 7', 'dash-dot': '10 5 2 5', 'long-dash': '16 8' })[style] || ''
}

function centerX(position) { return position.x + position.w / 2 }
function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  Object.entries(attributes).forEach(([key, value]) => { if (value !== '') element.setAttribute(key, String(value)) })
  return element
}
function svgText(value) {
  const text = svgElement('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' })
  text.textContent = value
  return text
}
function cleanupPointer(move, end) {
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', end)
  window.removeEventListener('pointercancel', end)
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
