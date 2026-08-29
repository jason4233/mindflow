/**
 * 唯一快捷鍵入口：只維護 SPEC 的「按鍵 → action 名」表，功能由 registry 解耦實作。
 */
import {
  addChild,
  addSiblingAfter,
  insertSubtrees,
  moveNode,
  setStyle,
  toggleCollapse,
  updateRichText,
  updateText
} from './commands.js'
import {
  cloneSubtreeWithFreshIds,
  createNode,
  findNode,
  findNodeContext,
  getTopLevelIds,
  structuredCloneSafe
} from './model.js'
import { hasAction, registerAction, runAction } from './actions.js'
import {
  getNextThemeId,
  getLineAppearance,
  getNodeAppearance,
  getTheme,
  withLineAppearance
} from './themes.js'
import { sanitizeFloatingClone } from './floating.js'
import { deleteNodesWithOverlaysCommand, withOverlayCleanupCommand } from './relations.js'
import { strings } from '../strings.js'

const KEY_CODE_MAP = Object.freeze({
  ...Object.fromEntries(Array.from('abcdefghijklmnopqrstuvwxyz', key => [key, Object.freeze([`Key${key.toUpperCase()}`])])),
  ...Object.fromEntries(Array.from('0123456789', key => [key, Object.freeze([`Digit${key}`, `Numpad${key}`])])),
  ' ': Object.freeze(['Space']),
  '/': Object.freeze(['Slash']),
  '>': Object.freeze(['Period']),
  '<': Object.freeze(['Comma']),
  Tab: Object.freeze(['Tab']),
  Enter: Object.freeze(['Enter']),
  Delete: Object.freeze(['Delete']),
  ArrowUp: Object.freeze(['ArrowUp']),
  ArrowDown: Object.freeze(['ArrowDown']),
  ArrowLeft: Object.freeze(['ArrowLeft']),
  ArrowRight: Object.freeze(['ArrowRight']),
  F4: Object.freeze(['F4']),
  F6: Object.freeze(['F6']),
  F11: Object.freeze(['F11']),
  Escape: Object.freeze(['Escape'])
})
const KNOWN_BINDING_CODES = new Set(Object.values(KEY_CODE_MAP).flat())

export const ACTION_BINDINGS = Object.freeze([
  { action: 'undo', key: 'z', ctrl: true },
  { action: 'redo', key: 'y', ctrl: true },
  { action: 'copy', key: 'c', ctrl: true },
  { action: 'cut', key: 'x', ctrl: true },
  { action: 'paste', key: 'v', ctrl: true },
  { action: 'selectAll', key: 'a', ctrl: true },
  { action: 'save', key: 's', ctrl: true },
  { action: 'insertParent', key: 'Tab', shift: true },
  { action: 'insertChild', key: 'Tab' },
  { action: 'insertAfter', key: 'Enter' },
  { action: 'toggleCollapse', key: '/', ctrl: true },
  { action: 'dissolve', key: 'Delete', ctrl: true },
  { action: 'remove', key: 'Delete' },
  { action: 'navigateUp', key: 'ArrowUp' },
  { action: 'navigateDown', key: 'ArrowDown' },
  { action: 'navigateLeft', key: 'ArrowLeft' },
  { action: 'navigateRight', key: 'ArrowRight' },
  { action: 'moveUp', key: 'ArrowUp', alt: true },
  { action: 'moveDown', key: 'ArrowDown', alt: true },
  { action: 'selectPreviousSibling', key: 'ArrowUp', shift: true },
  { action: 'selectNextSibling', key: 'ArrowDown', shift: true },
  { action: 'copyStyle', key: 'c', ctrl: true, alt: true },
  { action: 'pasteStyle', key: 'v', ctrl: true, alt: true },
  { action: 'duplicate', key: 'd', ctrl: true },
  { action: 'nextTheme', key: 'F6' },
  { action: 'openThemePanel', key: 'p', ctrl: true },
  { action: 'openStylePanel', key: 'y', alt: true },
  { action: 'edit', key: ' ' },
  { action: 'formatPainter', key: 'g', ctrl: true },
  { action: 'priority1', key: '1', ctrl: true },
  { action: 'priority2', key: '2', ctrl: true },
  { action: 'priority3', key: '3', ctrl: true },
  { action: 'priority4', key: '4', ctrl: true },
  { action: 'priority5', key: '5', ctrl: true },
  { action: 'priority6', key: '6', ctrl: true },
  { action: 'priority7', key: '7', ctrl: true },
  { action: 'priority8', key: '8', ctrl: true },
  { action: 'priority9', key: '9', ctrl: true },
  { action: 'increaseFontSize', key: '>', ctrl: true, shift: true },
  { action: 'decreaseFontSize', key: '<', ctrl: true, shift: true },
  { action: 'insertLink', key: 'k', ctrl: true, alt: true },
  { action: 'insertNote', key: 'm', ctrl: true, alt: true },
  { action: 'insertSummary', key: 't', ctrl: true, alt: true },
  { action: 'insertImage', key: 'p', alt: true },
  { action: 'openIcons', key: 'i', alt: true },
  { action: 'insertRelation', key: 'F4' },
  { action: 'insertComment', key: 'r', ctrl: true, alt: true },
  { action: 'zoomReset', key: '0', ctrl: true },
  { action: 'tidyLayout', key: 'l', ctrl: true, shift: true },
  { action: 'toggleOutline', key: 'o', ctrl: true },
  { action: 'toggleFullscreen', key: 'F11' },
  { action: 'fit', key: 'f', ctrl: true, alt: true },
  { action: 'centerRoot', key: 'r', ctrl: true, shift: true },
  { action: 'findReplace', key: 'f', ctrl: true },
  { action: 'escape', key: 'Escape' },
  { action: 'history', key: 'h', shift: true, alt: true },
  { action: 'floatingNode', key: 'f', shift: true, alt: true }
].map(binding => Object.freeze({ ...binding, codes: KEY_CODE_MAP[binding.key] || Object.freeze([]) })))

const FORM_GLOBAL_ACTIONS = new Set([
  'save', 'openThemePanel', 'toggleOutline', 'duplicate', 'findReplace', 'nextTheme',
  ...Array.from({ length: 9 }, (_, index) => `priority${index + 1}`)
])

const TOOLBAR_ACTIONS = Object.freeze([
  'insertParent', 'formatPainter', 'edit', 'insertImage', 'insertSummary',
  'insertRelation', 'openThemePanel', 'presentation', 'aiMenu', 'share',
  'openExport', 'moreMenu', 'toggleFullscreen'
])

export class KeyboardController {
  constructor({ doc, manager, selection, viewport, edit, save, getPositions }) {
    this.doc = doc
    this.manager = manager
    this.selection = selection
    this.viewport = viewport
    this.edit = edit
    this.save = save
    this.getPositions = getPositions
    this.clipboard = []
    this.styleClipboard = null
    this.previewSessions = new Map()
    this.pendingImeChord = null
    this.registerCoreActions()
    this.actions = createActionFacade()
    this.handleKeydown = this.handleKeydown.bind(this)
    this.handleKeyup = this.handleKeyup.bind(this)
  }

  handleKeyup(event) {
    const pending = this.pendingImeChord
    if (!pending) return
    const binding = resolveImeFallbackBinding(pending, event)
    if (binding === undefined) return // 修飾鍵自身的 keyup，繼續等待實體鍵
    this.pendingImeChord = null
    if (!binding) return
    const formMode = this.edit.isEditing || isFormTarget(event.target)
    if (formMode && !FORM_GLOBAL_ACTIONS.has(binding.action)) return
    if (!hasAction(binding.action)) return
    event.preventDefault()
    runAction(binding.action, event)
  }

  bind() {
    assertRegisteredActions([...ACTION_BINDINGS.map(binding => binding.action), ...TOOLBAR_ACTIONS])
    window.addEventListener('keydown', this.handleKeydown)
    window.addEventListener('keyup', this.handleKeyup)
  }

  handleKeydown(event) {
    const formMode = this.edit.isEditing || isFormTarget(event.target)
    // 純大綱模式沒有 map 導覽語意；保留方向鍵給大綱本身，避免改到隱藏畫布的 selection。
    if (this.selection.canvas?.hidden && event.key.startsWith('Arrow')) return
    if (dispatchGlobalShortcut(event, { formMode })) { this.pendingImeChord = null; return }

    // 部分 Windows IME 環境的修飾鍵組合 keydown 只給 key='Process' 且 code 缺失/異常，
    // keydown 無從辨識實體鍵；記下修飾鍵狀態，改由緊接的 keyup（通常帶真實 code）補償派發。
    if (event.key === 'Process' && (event.ctrlKey || event.metaKey || event.altKey)) {
      this.pendingImeChord = {
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey,
        time: Date.now()
      }
      return
    }
    if (formMode) return

    const hasCommandModifier = event.ctrlKey || event.metaKey || event.altKey
    const isImeCompositionKey = event.key === 'Process'
      && !hasCommandModifier
      && !event.shiftKey
      && /^(Key[A-Z]|Digit\d)$/u.test(event.code || '')
    // Windows IME 的首個實體字母／數字 keydown 仍落在畫布，先把焦點交給空白
    // contenteditable；不可 preventDefault，否則後續 composition 可能被瀏覽器取消。
    if (isImeCompositionKey) {
      const id = this.selection.primaryId
      if (id) this.edit.start(id, '')
      return
    }

    // 官方行為：選中節點後直接輸入可列印字元，清空原文並從該字元開始編輯。
    if (event.key.length === 1 && event.key !== ' ' && !hasCommandModifier) {
      const id = this.selection.primaryId
      if (!id) return
      event.preventDefault()
      this.edit.start(id, event.key)
    }
  }

  registerCoreActions() {
    const actions = {
      undo: () => this.manager.undo(),
      redo: () => this.manager.redo(),
      copy: () => this.copy(),
      cut: () => {
        this.copy()
        return this.removeSelected()
      },
      paste: () => this.paste(),
      selectAll: () => this.selection.selectAll(),
      save: () => this.save(),
      zoomIn: () => this.viewport.zoomBy(1.2),
      zoomOut: () => this.viewport.zoomBy(1 / 1.2),
      zoomReset: () => this.viewport.resetZoom(),
      fit: () => this.viewport.fit(this.getPositions()),
      centerRoot: () => this.viewport.centerOn(this.getPositions().get(this.doc.root.id)),
      insertChild: () => this.insertChild(),
      insertAfter: () => this.insertSibling(),
      insertParent: () => this.insertParent(),
      remove: () => this.removeSelected(),
      dissolve: () => this.dissolveSelected(),
      toggleCollapse: () => this.toggleSelectedCollapse(),
      navigateUp: () => this.selection.navigate('up'),
      navigateDown: () => this.selection.navigate('down'),
      navigateLeft: () => this.selection.navigate('left'),
      navigateRight: () => this.selection.navigate('right'),
      moveUp: () => this.moveSelected(-1),
      moveDown: () => this.moveSelected(1),
      selectPreviousSibling: () => this.selectSibling(-1),
      selectNextSibling: () => this.selectSibling(1),
      duplicate: () => this.duplicateSelected(),
      edit: () => this.selection.primaryId ? this.edit.start(this.selection.primaryId) : false,
      escape: () => this.selection.clear(),
      copyStyle: () => this.copyStyle(),
      pasteStyle: () => this.pasteStyle(),
      formatPainter: () => this.copyStyle(),
      increaseFontSize: () => this.changeFontSize(2),
      decreaseFontSize: () => this.changeFontSize(-2),
      nextTheme: () => this.applyTheme(getNextThemeId(this.doc.themeId)),
      applyTheme: themeId => this.applyTheme(themeId),
      applyStyle: patch => this.applyStyle(patch),
      setShape: shape => this.applyShape(shape),
      setStyleMetadata: patch => this.applyStyleMetadata(patch),
      setDocumentSpacing: patch => this.setDocumentSpacing(patch),
      setLineStyle: config => this.applyLineStyle(config),
      setRichText: (html, id = this.selection.primaryId) => id ? this.manager.execute(updateRichText(this.doc, id, html)) : false,
      commitTextEdit: payload => this.commitTextEdit(payload),
      previewStyle: (key, patch) => this.previewStyle(key, patch),
      commitStylePreview: (key, patch) => this.commitStylePreview(key, patch),
      previewDocumentSpacing: (key, patch) => this.previewDocumentSpacing(key, patch),
      commitDocumentSpacingPreview: (key, patch) => this.commitDocumentSpacingPreview(key, patch),
      previewWatermark: (key, config) => this.previewWatermark(key, config),
      commitWatermarkPreview: (key, config) => this.commitWatermarkPreview(key, config),
      previewCanvasBackground: background => this.previewCanvasBackground(background),
      commitCanvasBackgroundPreview: background => this.commitCanvasBackgroundPreview(background),
      setCanvasBackground: background => this.setCanvasBackground(background),
      setWatermark: config => this.setWatermark(config),
      setLayout: layoutName => this.setLayout(layoutName),
      getEditorSnapshot: () => this.getEditorSnapshot(),
      toggleFullscreen: () => toggleFullscreen()
    }
    for (const [name, action] of Object.entries(actions)) registerAction(name, action)
    const required = new Set([...ACTION_BINDINGS.map(binding => binding.action), ...TOOLBAR_ACTIONS])
    for (const name of required) {
      if (!hasAction(name)) registerAction(name, () => showComingSoon(name))
    }
  }

  insertChild() {
    const parentId = this.selection.primaryId || this.doc.root.id
    const command = addChild(this.doc, parentId, undefined, { text: strings.editor.newTopic })
    if (this.manager.execute(command)) this.selection.set([command.nodeId])
  }

  insertSibling() {
    const id = this.selection.primaryId
    if (!id) return false
    const command = addSiblingAfter(this.doc, id, { text: strings.editor.newTopic })
    if (!this.manager.execute(command)) return false
    this.selection.set([command.nodeId])
    return true
  }

  insertParent() {
    const id = this.selection.primaryId
    const context = findNodeContext(this.doc.root, id)
    if (!context?.parent) return false
    const parentNode = createNode(strings.editor.newTopic)
    const originalParent = context.parent
    const originalIndex = context.index
    const originalSide = context.node.side
    const command = {
      description: '插入上級節點',
      affectedIds: [parentNode.id, id, originalParent.id],
      do: () => {
        const current = findNodeContext(this.doc.root, id)
        if (!current?.parent || findNode(this.doc.root, parentNode.id)) return false
        current.parent.children.splice(current.index, 1, parentNode)
        parentNode.side = current.parent === this.doc.root ? originalSide : null
        current.node.side = null
        parentNode.children = [current.node]
        return true
      },
      undo: () => {
        const current = findNodeContext(this.doc.root, parentNode.id)
        if (!current?.parent) return
        current.parent.children.splice(current.index, 1, context.node)
        context.node.side = originalSide
        parentNode.children = []
        if (current.parent !== originalParent) originalParent.children.splice(originalIndex, 0, context.node)
      }
    }
    if (!this.manager.execute(command)) return false
    this.selection.set([parentNode.id])
    return true
  }

  removeSelected() {
    const ids = this.selection.getSelectedIds()
    if (ids.length === 0) return false
    const primaryContext = findNodeContext(this.doc.root, this.selection.primaryId)
    const fallbackId = primaryContext?.parent?.id || this.doc.root.id
    if (!this.manager.execute(deleteNodesWithOverlaysCommand(this.doc, ids))) return false
    this.selection.set([fallbackId])
    return true
  }

  dissolveSelected() {
    const ids = getTopLevelIds(this.doc.root, this.selection.getSelectedIds()).filter(id => id !== this.doc.root.id)
    if (ids.length === 0) return false
    const fallback = findNodeContext(this.doc.root, ids[0])?.parent?.id || this.doc.root.id
    let records = null
    const treeCommand = {
      description: '刪除節點並保留子節點',
      affectedIds: [...ids, fallback],
      do: () => {
        if (!records) {
          records = ids.map(id => findNodeContext(this.doc.root, id)).filter(context => context?.parent).map(context => ({
            node: context.node,
            parentId: context.parent.id,
            index: context.index,
            childSides: context.node.children.map(child => child.side)
          }))
        }
        let changed = false
        for (const record of records.slice().sort((a, b) => b.index - a.index)) {
          const current = findNodeContext(this.doc.root, record.node.id)
          if (!current?.parent) continue
          const promoted = current.node.children.slice()
          if (current.parent === this.doc.root) {
            promoted.forEach(child => { child.side = current.node.side })
          }
          current.parent.children.splice(current.index, 1, ...promoted)
          changed = true
        }
        return changed
      },
      undo: () => {
        for (const record of records.slice().sort((a, b) => a.index - b.index)) {
          const parent = findNode(this.doc.root, record.parentId)
          if (!parent) continue
          const childIds = new Set(record.node.children.map(child => child.id))
          parent.children = parent.children.filter(child => !childIds.has(child.id))
          record.node.children.forEach((child, index) => { child.side = record.childSides[index] })
          parent.children.splice(Math.min(record.index, parent.children.length), 0, record.node)
        }
      }
    }
    const command = withOverlayCleanupCommand(this.doc, ids, treeCommand)
    if (!this.manager.execute(command)) return false
    this.selection.set([fallback])
    return true
  }

  toggleSelectedCollapse() {
    const id = this.selection.primaryId
    return id ? this.manager.execute(toggleCollapse(this.doc, id)) : false
  }

  moveSelected(delta) {
    const context = findNodeContext(this.doc.root, this.selection.primaryId)
    if (!context?.parent) return false
    const siblings = this.getVisualSiblings(context)
    const currentIndex = siblings.findIndex(node => node.id === context.node.id)
    const target = siblings[currentIndex + delta]
    if (!target) return false
    const targetContext = findNodeContext(this.doc.root, target.id)
    if (!targetContext) return false
    return this.manager.execute(moveNode(this.doc, context.node.id, context.parent.id, targetContext.index, context.node.side))
  }

  selectSibling(delta) {
    const context = findNodeContext(this.doc.root, this.selection.primaryId)
    if (!context?.parent) return false
    const siblings = this.getVisualSiblings(context)
    const currentIndex = siblings.findIndex(node => node.id === context.node.id)
    const sibling = siblings[currentIndex + delta]
    if (!sibling) return false
    this.selection.set([sibling.id])
    return true
  }

  getVisualSiblings(context) {
    const positions = this.getPositions()
    const currentPosition = positions.get(context.node.id)
    if (!currentPosition) return context.parent.children.slice()
    return context.parent.children
      .filter(node => positions.get(node.id)?.side === currentPosition.side)
      .sort((left, right) => {
        const a = positions.get(left.id)
        const b = positions.get(right.id)
        return (a.y + a.h / 2) - (b.y + b.h / 2)
      })
  }

  duplicateSelected() {
    const ids = getTopLevelIds(this.doc.root, this.selection.getSelectedIds())
    const records = ids.map(id => findNodeContext(this.doc.root, id)).filter(context => context?.parent)
    if (records.length === 0) return false
    const anchor = records.at(-1)
    const clones = records.map(record => sanitizeFloatingClone(
      cloneSubtreeWithFreshIds(record.node),
      { asRootChild: anchor.parent === this.doc.root }
    ))
    const command = insertSubtrees(this.doc, anchor.parent.id, clones, anchor.index + 1)
    if (!this.manager.execute(command)) return false
    this.selection.set(command.nodeIds)
    return true
  }

  copy() {
    const ids = getTopLevelIds(this.doc.root, this.selection.getSelectedIds())
    this.clipboard = ids
      .map(id => findNode(this.doc.root, id))
      .filter(node => node && node !== this.doc.root)
      .map(node => structuredCloneSafe(node))
    return this.clipboard.length > 0
  }

  paste() {
    if (this.clipboard.length === 0) return false
    const parentId = this.selection.primaryId || this.doc.root.id
    const nodes = this.clipboard.map(node => sanitizeFloatingClone(
      cloneSubtreeWithFreshIds(node),
      { asRootChild: parentId === this.doc.root.id }
    ))
    const command = insertSubtrees(this.doc, parentId, nodes)
    if (!this.manager.execute(command)) return false
    this.selection.set(command.nodeIds)
    return true
  }

  copyStyle() {
    const node = findNode(this.doc.root, this.selection.primaryId)
    if (!node) return false
    this.styleClipboard = structuredCloneSafe(node.style)
    return true
  }

  pasteStyle() {
    if (!this.styleClipboard) return false
    return this.applyStyle(this.styleClipboard)
  }

  applyStyle(patch) {
    const ids = this.selection.getSelectedIds()
    return this.applyStyleToIds(patch, ids)
  }

  applyStyleToIds(patch, ids) {
    if (!patch || typeof patch !== 'object' || ids.length === 0) return false
    const theme = getTheme(this.doc.themeId)
    const changedIds = ids.filter(id => {
      const context = findNodeContext(this.doc.root, id)
      if (!context) return false
      const appearance = getNodeAppearance(context.node, context.depth, theme)
      return Object.entries(patch).some(([key, value]) => {
        const effective = key === 'align' ? appearance.textAlign : appearance[key]
        return Number.isFinite(Number(effective)) && Number.isFinite(Number(value))
          ? Number(effective) !== Number(value)
          : effective !== value
      })
    })
    return changedIds.length > 0 ? this.manager.execute(setStyle(this.doc, changedIds, patch)) : false
  }

  applyShape(shape) {
    return this.applyStyle({ shape: String(shape || 'rounded') })
  }

  applyStyleMetadata(patch, explicitIds = null) {
    const ids = (explicitIds || this.selection.getSelectedIds()).filter(Boolean)
    const allowed = {}
    if (Object.hasOwn(patch || {}, 'radius')) allowed.radius = Math.max(0, Number(patch.radius) || 0)
    if (['left', 'center', 'right'].includes(patch?.align)) allowed.align = patch.align
    if (Object.hasOwn(patch || {}, 'lineHeight')) allowed.lineHeight = Math.max(0.5, Number(patch.lineHeight) || 1.35)
    return this.applyStyleToIds(allowed, ids)
  }

  applyLineStyle(config = {}) {
    return this.mutateSelectedStyles('設定連接線樣式', (node, context) => {
      const activeTheme = getTheme(this.doc.themeId)
      const current = getLineAppearance(node, context.depth, activeTheme)
      const styleExplicit = Object.hasOwn(config, 'style') && Boolean(config.style)
      const shapeExplicit = Object.hasOwn(config, 'shape') && Boolean(config.shape)
      const nextStyle = config.style || current.style
      const nextShape = config.shape || current.shape
      if (current.style === nextStyle && current.shape === nextShape) return
      // 只有使用者明確改 shape 才寫 override；單改線型必須繼續跟隨後續主題。
      node.style.lineStyle = withLineAppearance(node.style.lineStyle, {
        lineStyle: nextStyle,
        lineShape: nextShape,
        themeShape: activeTheme.lineShape,
        styleExplicit,
        shapeExplicit
      })
    })
  }

  mutateSelectedStyles(description, mutate, ids = this.selection.getSelectedIds()) {
    const targetIds = ids.filter(Boolean)
    if (targetIds.length === 0) return false
    let previous = null
    const command = {
      description,
      affectedIds: targetIds.slice(),
      do: () => {
        const records = targetIds.map(id => findNodeContext(this.doc.root, id)).filter(Boolean)
        if (records.length === 0) return false
        if (!previous) previous = records.map(record => ({ id: record.node.id, style: structuredCloneSafe(record.node.style) }))
        const before = records.map(record => JSON.stringify(record.node.style))
        records.forEach(record => mutate(record.node, record))
        return records.some((record, index) => JSON.stringify(record.node.style) !== before[index])
      },
      undo: () => {
        for (const record of previous || []) {
          const node = findNode(this.doc.root, record.id)
          if (node) node.style = structuredCloneSafe(record.style)
        }
      }
    }
    return this.manager.execute(command)
  }

  changeFontSize(delta) {
    const snapshot = this.getEditorSnapshot()
    const current = Number(snapshot.primaryAppearance?.fontSize) || 14
    return this.applyStyle({ fontSize: Math.max(8, Math.min(72, current + delta)) })
  }

  applyTheme(themeId) {
    const nextTheme = getTheme(themeId)
    if (this.doc.themeId === nextTheme.id && this.doc.canvas.background === nextTheme.canvasBg) return false
    const previous = { themeId: this.doc.themeId, background: this.doc.canvas.background }
    const command = {
      description: '套用主題',
      do: () => {
        this.doc.themeId = nextTheme.id
        this.doc.canvas.background = nextTheme.canvasBg
        return true
      },
      undo: () => Object.assign(this.doc, { themeId: previous.themeId, canvas: { ...this.doc.canvas, background: previous.background } })
    }
    return this.manager.execute(command)
  }

  setCanvasBackground(background) {
    const next = String(background || '').trim()
    if (!next || next === this.doc.canvas.background) return false
    const previous = this.doc.canvas.background
    return this.manager.execute({
      description: '設定畫布背景',
      do: () => { this.doc.canvas.background = next; return true },
      undo: () => { this.doc.canvas.background = previous }
    })
  }

  previewCanvasBackground(background) {
    const next = String(background || '').trim()
    if (!next) return false
    const sessionKey = 'canvas:background'
    if (!this.previewSessions.has(sessionKey)) this.previewSessions.set(sessionKey, { previous: this.doc.canvas.background })
    this.doc.canvas.background = next
    this.manager.preview()
    return true
  }

  commitCanvasBackgroundPreview(background) {
    const sessionKey = 'canvas:background'
    const session = this.previewSessions.get(sessionKey)
    if (!session) return this.setCanvasBackground(background)
    this.doc.canvas.background = session.previous
    this.previewSessions.delete(sessionKey)
    return this.setCanvasBackground(background)
  }

  setWatermark(config = {}) {
    const previous = structuredCloneSafe(this.doc.canvas.watermark)
    const next = normalizeWatermark(config, previous)
    if (sameObject(previous, next)) return false
    return this.manager.execute({
      description: '設定浮水印',
      affectedIds: [this.doc.root.id],
      do: () => {
        if (sameObject(this.doc.canvas.watermark, next)) return false
        this.doc.canvas.watermark = structuredCloneSafe(next)
        return true
      },
      undo: () => { this.doc.canvas.watermark = structuredCloneSafe(previous) }
    })
  }

  setDocumentSpacing(patch = {}) {
    const previous = { spacingH: this.doc.canvas.spacingH, spacingV: this.doc.canvas.spacingV }
    const next = normalizeSpacing(patch, previous)
    if (sameObject(previous, next)) return false
    return this.manager.execute({
      description: '設定節點間距',
      affectedIds: [this.doc.root.id],
      do: () => {
        if (this.doc.canvas.spacingH === next.spacingH && this.doc.canvas.spacingV === next.spacingV) return false
        Object.assign(this.doc.canvas, next)
        return true
      },
      undo: () => Object.assign(this.doc.canvas, previous)
    })
  }

  commitTextEdit(payload = {}) {
    const id = payload.id
    if (!id || !findNode(this.doc.root, id)) return false
    const stylePatch = { ...(payload.pendingStyle || {}), ...(payload.pendingMetadata || {}) }
    const commands = [
      updateText(this.doc, id, payload.text ?? ''),
      updateRichText(this.doc, id, payload.richText || null)
    ]
    if (Object.keys(stylePatch).length > 0) {
      const context = findNodeContext(this.doc.root, id)
      const appearance = getNodeAppearance(context.node, context.depth, getTheme(this.doc.themeId))
      const effectivePatch = Object.fromEntries(Object.entries(stylePatch).filter(([key, value]) => {
        const effective = key === 'align' ? appearance.textAlign : appearance[key]
        return Number.isFinite(Number(effective)) && Number.isFinite(Number(value))
          ? Number(effective) !== Number(value)
          : effective !== value
      }))
      if (Object.keys(effectivePatch).length > 0) commands.push(setStyle(this.doc, [id], effectivePatch))
    }
    return this.manager.batch('編輯節點文字', commands)
  }

  previewStyle(key, patch = {}) {
    const ids = this.selection.getSelectedIds()
    if (ids.length === 0) return false
    const sessionKey = `style:${key}`
    if (!this.previewSessions.has(sessionKey)) {
      this.previewSessions.set(sessionKey, {
        ids: ids.slice(),
        previous: ids.map(id => ({ id, style: structuredCloneSafe(findNode(this.doc.root, id)?.style || {}) }))
      })
    }
    const session = this.previewSessions.get(sessionKey)
    for (const id of session.ids) {
      const node = findNode(this.doc.root, id)
      if (node) Object.assign(node.style, patch)
    }
    this.manager.preview()
    return true
  }

  commitStylePreview(key, patch = {}) {
    const sessionKey = `style:${key}`
    const session = this.previewSessions.get(sessionKey)
    if (!session) return this.applyStyle(patch)
    for (const record of session.previous) {
      const node = findNode(this.doc.root, record.id)
      if (node) node.style = structuredCloneSafe(record.style)
    }
    this.previewSessions.delete(sessionKey)
    return this.applyStyleToIds(patch, session.ids)
  }

  previewDocumentSpacing(key, patch = {}) {
    const sessionKey = `spacing:${key}`
    if (!this.previewSessions.has(sessionKey)) {
      this.previewSessions.set(sessionKey, { previous: { spacingH: this.doc.canvas.spacingH, spacingV: this.doc.canvas.spacingV } })
    }
    Object.assign(this.doc.canvas, normalizeSpacing(patch, this.doc.canvas))
    this.manager.preview()
    return true
  }

  commitDocumentSpacingPreview(key, patch = {}) {
    const sessionKey = `spacing:${key}`
    const session = this.previewSessions.get(sessionKey)
    if (!session) return this.setDocumentSpacing(patch)
    Object.assign(this.doc.canvas, session.previous)
    this.previewSessions.delete(sessionKey)
    return this.setDocumentSpacing(patch)
  }

  previewWatermark(key, config = {}) {
    const sessionKey = `watermark:${key}`
    if (!this.previewSessions.has(sessionKey)) {
      this.previewSessions.set(sessionKey, { previous: structuredCloneSafe(this.doc.canvas.watermark) })
    }
    this.doc.canvas.watermark = normalizeWatermark(config, this.doc.canvas.watermark)
    this.manager.preview()
    return true
  }

  commitWatermarkPreview(key, config = {}) {
    const sessionKey = `watermark:${key}`
    const session = this.previewSessions.get(sessionKey)
    if (!session) return this.setWatermark(config)
    this.doc.canvas.watermark = structuredCloneSafe(session.previous)
    this.previewSessions.delete(sessionKey)
    return this.setWatermark(config)
  }

  setLayout(layoutName) {
    const allowed = ['mindmap-both', 'mindmap-right', 'mindmap-left', 'org', 'tree-right', 'fishbone', 'timeline-h']
    const next = allowed.includes(layoutName) ? layoutName : 'mindmap-right'
    if (this.doc.layout === next) return false
    const previous = this.doc.layout
    return this.manager.execute({
      description: '切換結構',
      do: () => { this.doc.layout = next; return true },
      undo: () => { this.doc.layout = previous }
    })
  }

  getEditorSnapshot() {
    const context = findNodeContext(this.doc.root, this.selection.primaryId)
    const watermark = this.doc.canvas.watermark
    return {
      doc: this.doc,
      selectedIds: this.selection.getSelectedIds(),
      primaryNode: context?.node || null,
      primaryAppearance: context ? getNodeAppearance(context.node, context.depth, getTheme(this.doc.themeId)) : null,
      rootAppearance: {
        ...getNodeAppearance(this.doc.root, 0, getTheme(this.doc.themeId)),
        spacingH: this.doc.canvas.spacingH,
        spacingV: this.doc.canvas.spacingV,
        watermarkText: watermark.text,
        watermarkColor: watermark.color,
        watermarkRotation: watermark.rotation,
        watermarkOpacity: watermark.opacity,
        watermarkSize: watermark.size
      }
    }
  }
}

function createActionFacade() {
  const names = new Set(ACTION_BINDINGS.map(binding => binding.action))
  ;['zoomIn', 'zoomOut', 'fit', 'insertChild', 'insertAfter', 'undo', 'redo'].forEach(name => names.add(name))
  return Object.fromEntries(Array.from(names, name => [name, (...args) => runAction(name, ...args)]))
}

export function matchesBinding(event, binding) {
  const ctrl = event.ctrlKey || event.metaKey
  // 已知實體碼具有決定權；Intl* 等未納入對照的非標準碼才交給 event.key fallback。
  const hasKnownCode = KNOWN_BINDING_CODES.has(event.code)
  const codeMatches = binding.codes?.includes(event.code) || false
  const keyMatches = typeof event.key === 'string' && event.key.toLowerCase() === binding.key.toLowerCase()
  return (hasKnownCode ? codeMatches : keyMatches)
    && ctrl === Boolean(binding.ctrl)
    && event.shiftKey === Boolean(binding.shift)
    && event.altKey === Boolean(binding.alt)
}

export function isFormTarget(target) {
  if (!target) return false
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName || '')) return true
  return typeof target.closest === 'function' && Boolean(target.closest('[role="button"], [role="menuitem"], [role^="menuitem"]'))
}

export function findShortcutBinding(event) {
  return ACTION_BINDINGS.find(item => matchesBinding(event, item)) || null
}

// IME keyup 補償：keydown 只給 key='Process' 且 code 無法辨識時，改用緊接 keyup 的實體碼判定。
// 回傳 undefined＝修飾鍵自身的 keyup（保留等待）；null＝清除補償狀態且不派發；binding＝補償命中。
export function resolveImeFallbackBinding(pending, event, now = Date.now()) {
  if (!pending) return null
  const code = event.code || ''
  if (/^(Control|Alt|Shift|Meta)/.test(event.key || '') || /^(Control|Alt|Shift|Meta)/.test(code)) return undefined
  if (now - pending.time > 800) return null
  if (!/^(Key[A-Z]|Digit\d|Numpad\d)$/u.test(code)) return null
  // keyup 當下的修飾鍵需與 keydown 記錄一致（使用者慣性是先放開字母鍵、修飾鍵仍按著）。
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl !== pending.ctrl || event.altKey !== pending.alt || event.shiftKey !== pending.shift) return null
  return findShortcutBinding({ key: 'Process', code, ctrlKey: pending.ctrl, metaKey: false, altKey: pending.alt, shiftKey: pending.shift })
}

export function dispatchGlobalShortcut(event, { formMode = false } = {}) {
  if (event.defaultPrevented) return false
  const binding = findShortcutBinding(event)
  if (!binding || (formMode && !FORM_GLOBAL_ACTIONS.has(binding.action))) return false
  if (!hasAction(binding.action)) throw new Error(`快捷鍵 action「${binding.action}」尚未註冊`)
  // Ctrl+V 必須保留瀏覽器原生 paste 事件；attachments 會先嘗試內部節點剪貼簿，
  // 沒有內部資料時才接手 URL / 圖片，避免 keydown 與 paste 雙重處理。
  if (binding.action === 'paste') return false
  event.preventDefault()
  runAction(binding.action, event)
  return true
}

export function assertRegisteredActions(names) {
  const missing = Array.from(new Set(names)).filter(name => !hasAction(name))
  if (missing.length > 0) throw new Error(`未註冊 action：${missing.join(', ')}`)
  return true
}

function normalizeWatermark(config, current) {
  return {
    enabled: Object.hasOwn(config, 'enabled') ? Boolean(config.enabled) : Boolean(current.enabled),
    text: Object.hasOwn(config, 'text') ? String(config.text).slice(0, 30) : String(current.text ?? 'MindFlow').slice(0, 30),
    color: typeof config.color === 'string' && config.color ? config.color : current.color || '#64748b',
    rotation: ['left', 'right', 'horizontal'].includes(config.rotation) ? config.rotation : current.rotation || 'left',
    opacity: Object.hasOwn(config, 'opacity') ? clamp(config.opacity, 0, 100, 12) : clamp(current.opacity, 0, 100, 12),
    size: Object.hasOwn(config, 'size') ? clamp(config.size, 10, 48, 18) : clamp(current.size, 10, 48, 18)
  }
}

function normalizeSpacing(patch, current) {
  return {
    spacingH: Object.hasOwn(patch, 'spacingH') ? clamp(patch.spacingH, 10, 80, 30) : clamp(current.spacingH, 10, 80, 30),
    spacingV: Object.hasOwn(patch, 'spacingV') ? clamp(patch.spacingV, 10, 80, 30) : clamp(current.spacingV, 10, 80, 30)
  }
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function showComingSoon(action) {
  const existing = document.querySelector('[data-mindflow-toast]')
  const toast = existing || document.createElement('div')
  toast.dataset.mindflowToast = 'true'
  toast.setAttribute('role', 'status')
  toast.textContent = action === 'findReplace' ? '尋找與取代即將推出' : '此功能即將推出'
  Object.assign(toast.style, {
    position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
    zIndex: '9999', padding: '10px 16px', borderRadius: '8px', color: '#fff',
    background: 'rgba(15, 23, 42, .92)', boxShadow: '0 8px 24px rgba(0,0,0,.2)'
  })
  if (!existing) document.body.append(toast)
  window.clearTimeout(showComingSoon.timer)
  showComingSoon.timer = window.setTimeout(() => toast.remove(), 1800)
  return true
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen?.()
  return document.documentElement.requestFullscreen?.()
}
