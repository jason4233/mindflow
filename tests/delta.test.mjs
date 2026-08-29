/**
 * DELTA 純函數與 command 自測：不依賴瀏覽器 DOM。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createDefaultDoc, createNode, findNode } from '../js/editor/model.js'
import { CommandManager } from '../js/editor/commands.js'
import { KeyboardController } from '../js/editor/keyboard.js'
import { ViewportController } from '../js/editor/viewport.js'
import {
  createRelationCommand,
  deleteNodesWithOverlaysCommand,
  relationGeometry,
  removeRelationCommand,
  setRelationStyleCommand,
  updateRelationCommand
} from '../js/editor/relations.js'
import {
  createSummaryCommand,
  getSummaryRange,
  getSummaryNodes,
  removeSummaryCommand,
  summaryGeometry,
  updateSummaryCommand
} from '../js/editor/summary.js'
import {
  isLikelyUrl,
  normalizeUrl,
  setAllCollapsedCommand,
  updateNodeFieldsCommand
} from '../js/editor/attachments.js'
import * as attachmentModule from '../js/editor/attachments.js'
import {
  attachFloatingNodeCommand,
  createFloatingNodeCommand,
  getFloatingMeta,
  initializeFloatingFeatures,
  sanitizeFloatingClone,
  updateFloatingPositionCommand
} from '../js/editor/floating.js'
import { createProgressSvg, createPrioritySvg, flattenStickerManifest, toggleNodeIconCommand } from '../js/editor/iconpanel.js'
import { createReplaceAllCommand, findTextMatches, replaceText } from '../js/editor/findreplace.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

class FakeClassList {
  constructor() { this.tokens = new Set() }
  add(...tokens) { tokens.forEach(token => this.tokens.add(token)) }
  remove(...tokens) { tokens.forEach(token => this.tokens.delete(token)) }
  contains(token) { return this.tokens.has(token) }
  toggle(token, force) {
    const enabled = force === undefined ? !this.tokens.has(token) : Boolean(force)
    if (enabled) this.tokens.add(token)
    else this.tokens.delete(token)
    return enabled
  }
}

class FakeElement extends EventTarget {
  constructor(tagName = 'div') {
    super()
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.parentElement = null
    this.ownerDocument = null
    this.hidden = false
    this.style = {}
    this.dataset = {}
    this.classList = new FakeClassList()
    this.attributes = new Map()
    this.textContent = ''
    this.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      child.ownerDocument = this.ownerDocument
      this.children.push(child)
    }
  }

  contains(target) {
    return target === this || this.children.some(child => child.contains(target))
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  removeAttribute(name) { this.attributes.delete(name) }
  getBoundingClientRect() { return this.rect }
}

function createNoteHoverDom() {
  const windowRef = new EventTarget()
  Object.assign(windowRef, {
    innerWidth: 320,
    innerHeight: 240,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ backgroundColor: 'rgb(18, 24, 36)' })
  })
  const documentRef = new EventTarget()
  documentRef.defaultView = windowRef
  documentRef.createElement = tagName => {
    const element = new FakeElement(tagName)
    element.ownerDocument = documentRef
    if (tagName === 'div') element.rect = { left: 0, top: 0, right: 260, bottom: 180, width: 260, height: 180 }
    return element
  }
  documentRef.body = documentRef.createElement('body')
  const canvas = documentRef.createElement('section')
  const button = documentRef.createElement('button')
  button.rect = { left: 289, top: 96, right: 312, bottom: 119, width: 23, height: 23 }
  return { windowRef, documentRef, canvas, button }
}

function pointerEvent(type, relatedTarget = null) {
  const event = new Event(type)
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  return event
}

function keyboardEvent(key) {
  const event = new Event('keydown')
  Object.defineProperty(event, 'key', { value: key })
  return event
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function createFloatingDoubleClickHarness({ viewMode = 'map', presentation = false, handTool = false } = {}) {
  const listeners = new Map()
  const shell = { dataset: { viewMode } }
  const body = { classList: new FakeClassList() }
  if (presentation) body.classList.add('is-presentation-mode')
  const canvas = {
    hidden: false,
    ownerDocument: { body },
    addEventListener: (type, listener) => listeners.set(type, listener),
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    closest: selector => selector === '.editor-shell' ? shell : null,
    classList: new FakeClassList()
  }
  const nodesLayer = {
    addEventListener: () => {},
    classList: new FakeClassList()
  }
  const world = {}
  const svgLayer = {}
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const selected = []
  const edits = []
  const ctx = {
    doc,
    manager,
    selection: { set: ids => selected.push(ids) },
    viewport: {
      canvas,
      panX: 40,
      panY: -20,
      zoom: 2,
      spacePressed: handTool,
      handToolActive: handTool,
      screenToWorld: ViewportController.prototype.screenToWorld
    },
    edit: { start: (...args) => { edits.push(args); return true } },
    elements: { canvas, world, nodesLayer, svgLayer },
    featureState: { selectedOverlay: null, formatPainter: null },
    featureHandlers: { escape: [] },
    notify: () => {}
  }
  initializeFloatingFeatures(ctx)
  return { ctx, listeners, selected, edits, canvas, world, nodesLayer, svgLayer }
}

function doubleClickEvent(target, { clientX = 500, clientY = 250, button = 0 } = {}) {
  return {
    type: 'dblclick',
    button,
    clientX,
    clientY,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true }
  }
}

test('關聯線新增、調控制點/樣式、刪除皆可 undo/redo', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const [from, to] = doc.root.children
  const add = createRelationCommand(doc, from.id, to.id, { id: 'rel-delta' })
  assert.equal(manager.execute(add), true)
  assert.equal(doc.relations.length, 1)
  assert.equal(manager.execute(updateRelationCommand(doc, add.item.id, { cp1: { x: 20, y: -12 }, label: '影響' })), true)
  assert.deepEqual(doc.relations[0].cp1, { x: 20, y: -12 })
  manager.execute(setRelationStyleCommand(doc, add.item.id, { lineColor: '#112233', lineWidth: 4, lineStyle: 'dash-dot' }))
  assert.deepEqual(doc.relations[0].style, { color: '#112233', width: 4, lineStyle: 'dash-dot' })
  manager.execute(setRelationStyleCommand(doc, add.item.id, { lineWidth: 5 }))
  assert.deepEqual(doc.relations[0].style, { color: '#112233', width: 5, lineStyle: 'dash-dot' })
  manager.execute(removeRelationCommand(doc, add.item.id))
  assert.equal(doc.relations.length, 0)
  manager.undo()
  assert.equal(doc.relations[0].label, '影響')
  manager.redo()
  assert.equal(doc.relations.length, 0)
})

test('關聯線幾何使用 cubic Bézier 且控制點偏移可預測', () => {
  const positions = new Map([
    ['a', { x: 0, y: 20, w: 80, h: 30 }],
    ['b', { x: 260, y: 120, w: 90, h: 40 }]
  ])
  const geometry = relationGeometry(positions, { fromId: 'a', toId: 'b', cp1: { x: 10, y: -20 }, cp2: { x: -5, y: 30 } })
  assert.match(geometry.path, /^M .+ C .+,.+,.+$/u)
  assert.equal(geometry.cp1.x, geometry.baseCp1.x + 10)
  assert.equal(geometry.cp2.y, geometry.baseCp2.y + 30)
})

test('概要依同側視覺順序建立並以 nodeId 錨定，兄弟增刪不會漂移', () => {
  const doc = createDefaultDoc()
  const right = doc.root.children.filter(node => node.side === 'right')
  const left = doc.root.children.filter(node => node.side === 'left')
  const ids = right.map(node => node.id)
  assert.deepEqual(getSummaryRange(doc.root, ids), {
    parentId: doc.root.id,
    startNodeId: ids[0],
    endNodeId: ids[1]
  })
  assert.equal(getSummaryRange(doc.root, [right[0].id, left[0].id]), null)
  const manager = new CommandManager()
  const add = createSummaryCommand(doc, ids, { id: 'sum-delta', text: '三段概要' })
  manager.execute(add)
  const inserted = createNode('先插入', { side: 'right' })
  doc.root.children.unshift(inserted)
  assert.deepEqual(getSummaryNodes(doc.summaries[0], doc.root).map(node => node.id), ids)
  manager.execute(updateSummaryCommand(doc, add.summary.id, { startNodeId: ids[1], text: '後一段' }))
  assert.equal(doc.summaries[0].startNodeId, ids[1])
  manager.execute(removeSummaryCommand(doc, add.summary.id))
  manager.undo()
  assert.equal(doc.summaries[0].text, '後一段')
  const positions = new Map(doc.root.children.map((node, index) => [node.id, { x: 120, y: index * 55, w: 80, h: 30 }]))
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions)
  assert.ok(geometry.bottom > geometry.top)
  assert.match(geometry.path, /^M .+ C /u)
})

test('單側佈局的概要依 children 視覺順序判定連續，不受持久化 side 干擾', () => {
  const doc = createDefaultDoc()
  doc.layout = 'org'
  const [first, second, third] = doc.root.children

  assert.deepEqual(getSummaryRange(doc.root, [first.id, second.id], doc.layout), {
    parentId: doc.root.id,
    startNodeId: first.id,
    endNodeId: second.id
  })
  assert.equal(getSummaryRange(doc.root, [first.id, third.id], doc.layout), null)

  const command = createSummaryCommand(doc, [first.id, second.id], { id: 'sum-org' })
  assert.equal(command.do(), true)
  assert.deepEqual(getSummaryNodes(doc.summaries[0], doc.root, doc.layout).map(node => node.id), [first.id, second.id])
})

test('概要更新驗證失敗時不修改懸空資料', () => {
  const doc = createDefaultDoc()
  doc.summaries.push({
    id: 'sum-orphan',
    parentId: 'missing-parent',
    startNodeId: 'missing-a',
    endNodeId: 'missing-b',
    text: '原文',
    style: {}
  })
  const command = updateSummaryCommand(doc, 'sum-orphan', { text: '不該寫入' })
  assert.equal(command.do(), false)
  assert.equal(doc.summaries[0].text, '原文')
})

test('關聯線重接端點會拒絕既有的相同配對', () => {
  const doc = createDefaultDoc()
  const [a, b, c] = doc.root.children
  const manager = new CommandManager()
  const first = createRelationCommand(doc, a.id, b.id, { id: 'rel-ab' })
  const second = createRelationCommand(doc, a.id, c.id, { id: 'rel-ac' })
  manager.execute(first)
  manager.execute(second)
  assert.equal(manager.execute(updateRelationCommand(doc, second.item.id, { toId: b.id })), false)
  assert.equal(doc.relations.length, 2)
  assert.equal(doc.relations.find(item => item.id === second.item.id).toId, c.id)
})

test('刪除節點同步清理關聯線與概要，undo/redo 完整還原', () => {
  const doc = createDefaultDoc()
  const right = doc.root.children.filter(node => node.side === 'right')
  const left = doc.root.children.find(node => node.side === 'left')
  const middle = createNode('概要中段', { side: 'right' })
  doc.root.children.splice(doc.root.children.indexOf(right[0]) + 1, 0, middle)
  const manager = new CommandManager()
  manager.execute(createRelationCommand(doc, middle.id, left.id, { id: 'rel-cleanup' }))
  manager.execute(createSummaryCommand(doc, [right[0].id, middle.id, right[1].id], { id: 'sum-cleanup' }))
  manager.execute(deleteNodesWithOverlaysCommand(doc, [middle.id]))
  assert.equal(findNode(doc.root, middle.id), null)
  assert.equal(doc.relations.length, 0)
  assert.equal(doc.summaries.length, 0)
  manager.undo()
  assert.ok(findNode(doc.root, middle.id))
  assert.equal(doc.relations[0].id, 'rel-cleanup')
  assert.equal(doc.summaries[0].id, 'sum-cleanup')
  manager.redo()
  assert.equal(doc.relations.length, 0)
  assert.equal(doc.summaries.length, 0)
})

test('dissolve 節點保留子節點時同步清理關聯線與概要，undo/redo 完整還原', () => {
  const doc = createDefaultDoc()
  const dissolved = doc.root.children[0]
  const retainedA = createNode('保留 A', { side: dissolved.side })
  const retainedB = createNode('保留 B', { side: dissolved.side })
  dissolved.children.push(retainedA, retainedB)
  doc.relations = [{
    id: 'rel-dissolve',
    fromId: doc.root.id,
    toId: dissolved.id,
    label: '',
    cp1: { x: 0, y: -48 },
    cp2: { x: 0, y: 48 },
    style: {}
  }]
  doc.summaries = [{
    id: 'sum-dissolve',
    parentId: dissolved.id,
    startNodeId: retainedA.id,
    endNodeId: retainedB.id,
    text: '子樹概要',
    style: {}
  }]
  const manager = new CommandManager()
  const selection = {
    primaryId: dissolved.id,
    selectedIds: [dissolved.id],
    getSelectedIds() { return this.selectedIds.slice() },
    set(ids) {
      this.selectedIds = ids.slice()
      this.primaryId = ids[0] || null
    }
  }
  const controller = new KeyboardController({
    doc,
    manager,
    selection,
    viewport: {},
    edit: { isEditing: false },
    save: () => true,
    getPositions: () => new Map()
  })

  assert.equal(controller.dissolveSelected(), true)
  assert.equal(findNode(doc.root, dissolved.id), null)
  assert.ok(findNode(doc.root, retainedA.id))
  assert.equal(doc.relations.length, 0)
  assert.equal(doc.summaries.length, 0)
  manager.undo()
  assert.ok(findNode(doc.root, dissolved.id))
  assert.equal(doc.relations[0].id, 'rel-dissolve')
  assert.equal(doc.summaries[0].id, 'sum-dissolve')
  manager.redo()
  assert.equal(doc.relations.length, 0)
  assert.equal(doc.summaries.length, 0)
})

test('備註/連結/圖片欄位以同一 command 原子更新與復原', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  const manager = new CommandManager()
  manager.execute(updateNodeFieldsCommand(doc, node.id, {
    notes: '重要備註',
    link: 'https://example.com/',
    image: { src: 'data:image/png;base64,AA==', w: 120, h: 80 }
  }))
  assert.equal(node.notes, '重要備註')
  assert.equal(node.image.w, 120)
  manager.undo()
  assert.equal(node.notes, null)
  assert.equal(node.image, null)
  assert.equal(normalizeUrl('www.example.com'), 'https://www.example.com/')
  assert.equal(isLikelyUrl('https://example.com/a?q=1'), true)
  assert.equal(normalizeUrl('javascript:alert(1)'), '')
})

test('備註圖標 hover 約 180ms 後顯示純文字預覽，移入卡片保持、移開隱藏', async () => {
  assert.equal(typeof attachmentModule.createNoteHoverPreview, 'function')
  const { windowRef, documentRef, canvas, button } = createNoteHoverDom()
  const preview = attachmentModule.createNoteHoverPreview({ canvas, documentRef, windowRef })
  preview.bind(button, { text: '<b>第一行</b>\n第二行', open: () => {} })
  const popover = documentRef.body.children.at(-1)

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(150)
  assert.equal(popover.hidden, true)
  button.dispatchEvent(pointerEvent('pointerleave', canvas))
  await wait(40)
  assert.equal(popover.hidden, true, '延遲尚未結束就移開時不得閃現預覽')

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(150)
  assert.equal(popover.hidden, true)
  await wait(50)
  assert.equal(popover.hidden, false)
  assert.equal(popover.children[0].textContent, '<b>第一行</b>\n第二行')
  assert.equal(popover.classList.contains('is-dark'), true)
  assert.ok(Number.parseFloat(popover.style.left) < button.rect.left, '靠近右緣時應翻到圖標左側')

  button.dispatchEvent(pointerEvent('pointerleave', popover))
  popover.dispatchEvent(pointerEvent('pointerenter', button))
  await wait(80)
  assert.equal(popover.hidden, false)
  popover.dispatchEvent(pointerEvent('pointerleave', canvas))
  assert.equal(popover.hidden, true)
})

test('備註預覽不攔截 click 編輯，Esc、viewport 變更與拖曳起點立即關閉', async () => {
  assert.equal(typeof attachmentModule.createNoteHoverPreview, 'function')
  const { windowRef, documentRef, canvas, button } = createNoteHoverDom()
  let viewportListener = null
  let opened = 0
  const preview = attachmentModule.createNoteHoverPreview({
    canvas,
    documentRef,
    windowRef,
    hoverDelay: 1,
    viewport: { subscribe(listener) { viewportListener = listener; listener(); return () => {} } }
  })
  preview.bind(button, { text: '可編輯備註', open: () => { opened += 1 } })
  const popover = documentRef.body.children.at(-1)

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(5)
  assert.equal(popover.hidden, false)
  button.dispatchEvent(pointerEvent('pointerleave', canvas))
  assert.equal(popover.hidden, true, '已顯示的預覽在圖標移往別處時必須立即隱藏')

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(5)
  button.dispatchEvent(new Event('click'))
  assert.equal(opened, 1)
  assert.equal(popover.hidden, true)

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(5)
  windowRef.dispatchEvent(keyboardEvent('Escape'))
  assert.equal(popover.hidden, true)

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(5)
  viewportListener()
  assert.equal(popover.hidden, true)

  button.dispatchEvent(pointerEvent('pointerenter'))
  await wait(5)
  canvas.dispatchEvent(new Event('pointerdown'))
  assert.equal(popover.hidden, true)
})

test('圖示同類互斥、再點移除，SVG 為自包含原創向量', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  const manager = new CommandManager()
  manager.execute(toggleNodeIconCommand(doc, node.id, 'priority', '1'))
  manager.execute(toggleNodeIconCommand(doc, node.id, 'flag', 'blue'))
  manager.execute(toggleNodeIconCommand(doc, node.id, 'priority', '7'))
  assert.deepEqual(node.icons.sort(), ['flag:blue', 'priority:7'])
  manager.execute(toggleNodeIconCommand(doc, node.id, 'priority', '7'))
  assert.deepEqual(node.icons, ['flag:blue'])
  assert.match(createPrioritySvg(3), /^<svg[\s\S]+<circle[\s\S]+<text/u)
  assert.match(createProgressSvg(62.5), /<path d="M12 12 L12 4 A8 8/u)
  assert.doesNotMatch(createProgressSvg(100), /<image|http/iu)
})

test('貼紙 manifest 正好展平 120 張且每張檔案存在', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/stickers/manifest.json', import.meta.url), 'utf8'))
  const stickers = flattenStickerManifest(manifest)
  assert.equal(stickers.length, 120)
  for (const sticker of stickers) {
    assert.match(sticker.file, /^assets\/stickers\/.+\.svg$/u)
    const local = new URL(`../${sticker.file}`, import.meta.url)
    assert.ok((await readFile(local, 'utf8')).startsWith('<svg'))
  }
})

test('懸浮節點座標可持久化、移動、掛回樹並 undo', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const target = doc.root.children[0]
  const add = createFloatingNodeCommand(doc, { x: 321, y: 123 }, { id: 'floating-delta' })
  manager.execute(add)
  assert.deepEqual(getFloatingMeta(findNode(doc.root, add.nodeId)), { x: 321, y: 123 })
  manager.execute(updateFloatingPositionCommand(doc, add.nodeId, { x: 400, y: 220 }))
  assert.deepEqual(getFloatingMeta(findNode(doc.root, add.nodeId)), { x: 400, y: 220 })
  manager.execute(attachFloatingNodeCommand(doc, add.nodeId, target.id))
  assert.equal(getFloatingMeta(findNode(doc.root, add.nodeId)), null)
  assert.equal(target.children[0].id, add.nodeId)
  manager.undo()
  assert.deepEqual(getFloatingMeta(findNode(doc.root, add.nodeId)), { x: 400, y: 220 })
})

test('懸浮節點 clone 掛入樹時清 token，root 複製時位移且清除後代 token', () => {
  const source = createNode('懸浮 clone', {
    icons: ['__floating__:300,200'],
    children: [createNode('後代', { icons: ['__floating__:10,20'] })]
  })
  const attached = sanitizeFloatingClone(structuredClone(source), { asRootChild: false })
  assert.equal(getFloatingMeta(attached), null)
  assert.equal(getFloatingMeta(attached.children[0]), null)
  const duplicated = sanitizeFloatingClone(structuredClone(source), { asRootChild: true })
  assert.deepEqual(getFloatingMeta(duplicated), { x: 332, y: 224 })
  assert.equal(getFloatingMeta(duplicated.children[0]), null)
})

test('手形工具中雙擊空白畫布依 pan/zoom 換算座標，建立空白懸浮節點後編輯且可 undo', () => {
  const harness = createFloatingDoubleClickHarness({ handTool: true })
  const listener = harness.listeners.get('dblclick')
  assert.equal(typeof listener, 'function')
  const event = doubleClickEvent(harness.nodesLayer)

  assert.equal(listener(event), true)
  const [created] = harness.ctx.doc.root.children.slice(-1)
  assert.deepEqual(getFloatingMeta(created), { x: 180, y: 110 })
  assert.equal(created.text, '')
  assert.deepEqual(harness.selected, [[created.id]])
  assert.deepEqual(harness.edits, [[created.id, '']])
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.propagationStopped, true)

  harness.ctx.manager.undo()
  assert.equal(findNode(harness.ctx.doc.root, created.id), null)
})

test('雙擊只接受空白畫布基礎層，relation、summary 與 UI 不建立懸浮節點', () => {
  const blank = createFloatingDoubleClickHarness()
  const blankListener = blank.listeners.get('dblclick')
  assert.equal(typeof blankListener, 'function')
  assert.equal(blankListener(doubleClickEvent(blank.world)), true)

  const ui = createFloatingDoubleClickHarness()
  const uiListener = ui.listeners.get('dblclick')
  assert.equal(typeof uiListener, 'function')
  const before = ui.ctx.doc.root.children.length
  const blockedTargets = [
    { className: 'relation-overlay' },
    { className: 'summary-node' },
    { tagName: 'BUTTON' }
  ]
  for (const target of blockedTargets) assert.equal(uiListener(doubleClickEvent(target)), false)
  assert.equal(uiListener(doubleClickEvent(ui.canvas, { button: 2 })), false)
  assert.equal(ui.ctx.doc.root.children.length, before)
  assert.deepEqual(ui.edits, [])
})

test('雙擊節點仍交由既有文字編輯，不誤建懸浮節點', () => {
  const harness = createFloatingDoubleClickHarness()
  const listener = harness.listeners.get('dblclick')
  assert.equal(typeof listener, 'function')
  const before = harness.ctx.doc.root.children.length
  const nodeTarget = { closest: selector => selector.includes('.mind-node') ? nodeTarget : null }
  const event = doubleClickEvent(nodeTarget)

  assert.equal(listener(event), false)
  assert.equal(harness.ctx.doc.root.children.length, before)
  assert.deepEqual(harness.edits, [])
  assert.equal(event.defaultPrevented, false)
})

test('大綱模式與演示模式雙擊空白畫布皆不建立懸浮節點', () => {
  for (const options of [{ viewMode: 'outline' }, { presentation: true }]) {
    const harness = createFloatingDoubleClickHarness(options)
    const listener = harness.listeners.get('dblclick')
    assert.equal(typeof listener, 'function')
    const before = harness.ctx.doc.root.children.length
    assert.equal(listener(doubleClickEvent(harness.canvas)), false)
    assert.equal(harness.ctx.doc.root.children.length, before)
    assert.deepEqual(harness.edits, [])
  }
})

test('尋找與取代支援逐筆/全部並保留 undo', () => {
  const doc = createDefaultDoc()
  doc.root.text = 'Alpha alpha'
  doc.root.richText = '<b>Alpha</b> alpha'
  doc.root.children[0].text = 'alpha beta alpha'
  const matches = findTextMatches(doc.root, 'alpha')
  assert.equal(matches.length, 2)
  assert.equal(matches.reduce((sum, match) => sum + match.count, 0), 4)
  assert.equal(replaceText('Alpha alpha', 'alpha', 'X'), 'X alpha')
  const manager = new CommandManager()
  const command = createReplaceAllCommand(doc, 'alpha', '完成')
  manager.execute(command)
  assert.equal(doc.root.text, '完成 完成')
  assert.equal(doc.root.richText, null)
  assert.equal(doc.root.children[0].text, '完成 beta 完成')
  manager.undo()
  assert.equal(doc.root.text, 'Alpha alpha')
  assert.equal(doc.root.richText, '<b>Alpha</b> alpha')
})

test('全部展開/收起只改有子節點的非根節點', () => {
  const doc = createDefaultDoc()
  doc.root.children[0].children.push(createNode('子節點'))
  const manager = new CommandManager()
  manager.execute(setAllCollapsedCommand(doc, true))
  assert.equal(doc.root.collapsed, false)
  assert.equal(doc.root.children[0].collapsed, true)
  manager.undo()
  assert.equal(doc.root.children[0].collapsed, false)
})

let passed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

console.log(`\n${passed}/${tests.length} DELTA tests passed`)
