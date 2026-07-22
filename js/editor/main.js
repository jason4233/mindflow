/**
 * 編輯器組裝入口：載入文件、串接 command、佈局、渲染與全部互動控制器。
 */
import { createDocument, loadDocument, saveDocument } from '../store.js'
import { strings } from '../strings.js'
import { createMeasureFn, render } from './render.js'
import { layout } from './layout.js'
import { CommandManager, moveNode, toggleCollapse, updateDocumentTitle, updateText } from './commands.js'
import { ViewportController } from './viewport.js'
import { SelectionManager } from './selection.js'
import { EditController } from './edit.js'
import { KeyboardController } from './keyboard.js'
import { DragDropController } from './dnd.js'
import { initializeToolbar } from './toolbar.js'
import { initializeSidepanel } from './sidepanel.js'
import { initializeContextMenu } from './contextmenu.js'
import { initializeOutline } from './outline.js'

const elements = {
  canvas: document.querySelector('#canvas'),
  world: document.querySelector('#world'),
  svgLayer: document.querySelector('#connections-layer'),
  nodesLayer: document.querySelector('#nodes-layer'),
  measureLayer: document.querySelector('#measure-layer'),
  selectionRectangle: document.querySelector('#selection-rectangle'),
  indicator: document.querySelector('#drop-indicator'),
  zoomDisplay: document.querySelector('#zoom-display')
}

const requestedId = new URLSearchParams(window.location.search).get('id')
let doc = requestedId ? loadDocument(requestedId) : null
if (!doc) {
  doc = createDocument()
  history.replaceState(null, '', `editor.html?id=${encodeURIComponent(doc.id)}`)
}
document.title = `${doc.title} — ${strings.productName}`

let positions = new Map()
let saveTimer = null
let toolbar = null
let selection = null

const measureFn = createMeasureFn(elements.measureLayer, doc)
const viewport = new ViewportController({
  canvas: elements.canvas,
  world: elements.world,
  zoomDisplay: elements.zoomDisplay
})

const manager = new CommandManager({
  limit: 100,
  onChange: () => {
    renderAll()
    scheduleSave()
  }
})

selection = new SelectionManager({
  canvas: elements.canvas,
  nodesLayer: elements.nodesLayer,
  selectionRectangle: elements.selectionRectangle,
  getDoc: () => doc,
  getPositions: () => positions,
  isPanMode: () => viewport.spacePressed
})

const edit = new EditController({
  nodesLayer: elements.nodesLayer,
  onCommit: (id, text) => manager.execute(updateText(doc, id, text))
})
edit.bindEvents()

const keyboard = new KeyboardController({
  doc,
  manager,
  selection,
  viewport,
  edit,
  save: saveNow,
  getPositions: () => positions
})
keyboard.bind()

const sidepanel = initializeSidepanel()
toolbar = initializeToolbar({
  doc,
  manager,
  onTitleChange: title => {
    if (!manager.execute(updateDocumentTitle(doc, title))) toolbar.update()
    document.title = `${doc.title} — ${strings.productName}`
  },
  actions: {
    undo: keyboard.actions.undo,
    redo: keyboard.actions.redo,
    insertChild: keyboard.actions.insertChild,
    insertAfter: keyboard.actions.insertAfter,
    toggleSidepanel: sidepanel.toggle
  }
})

new DragDropController({
  canvas: elements.canvas,
  nodesLayer: elements.nodesLayer,
  indicator: elements.indicator,
  doc,
  viewport,
  selection,
  onMove: (id, parentId, index, side) => {
    if (manager.execute(moveNode(doc, id, parentId, index, side))) selection.set([id])
  }
})

initializeContextMenu()
initializeOutline()
bindZoomControls()
renderAll()
selection.set([doc.root.id])
requestAnimationFrame(() => viewport.fit(positions))

function renderAll() {
  positions = layout(doc, measureFn)
  render(doc, positions, {
    svgLayer: elements.svgLayer,
    nodesLayer: elements.nodesLayer,
    onToggleCollapse: id => manager.execute(toggleCollapse(doc, id))
  })
  selection?.prune()
  toolbar?.update()
}

function scheduleSave() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveNow, 500)
}

function saveNow() {
  window.clearTimeout(saveTimer)
  saveTimer = null
  saveDocument(doc)
}

function bindZoomControls() {
  const zoomOut = document.querySelector('#zoom-out-button')
  const zoomIn = document.querySelector('#zoom-in-button')
  const fit = document.querySelector('#fit-button')
  zoomOut.textContent = strings.editor.zoomOut
  zoomOut.setAttribute('aria-label', strings.editor.zoomOut)
  zoomIn.textContent = strings.editor.zoomIn
  zoomIn.setAttribute('aria-label', strings.editor.zoomIn)
  fit.textContent = strings.editor.fit
  fit.setAttribute('aria-label', strings.editor.fitLabel)
  elements.zoomDisplay.setAttribute('aria-label', strings.editor.zoomReset)
  zoomOut.addEventListener('click', keyboard.actions.zoomOut)
  zoomIn.addEventListener('click', keyboard.actions.zoomIn)
  elements.zoomDisplay.addEventListener('click', keyboard.actions.zoomReset)
  fit.addEventListener('click', keyboard.actions.fit)
}

window.addEventListener('beforeunload', saveNow)
