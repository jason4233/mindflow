/**
 * 唯一快捷鍵入口：只維護 SPEC 的「按鍵 → action 名」表，功能由 registry 解耦實作。
 */
import {
  addChild,
  addSiblingAfter,
  deleteNodes,
  insertSubtrees,
  moveNode,
  setStyle,
  toggleCollapse
} from './commands.js'
import {
  cloneSubtreeWithFreshIds,
  createNode,
  findNode,
  findNodeContext,
  getTopLevelIds,
  structuredCloneSafe
} from './model.js'
import { registerAction, runAction } from './actions.js'
import {
  encodeLineToken,
  encodeStyleToken,
  getNextThemeId,
  getNodeAppearance,
  getTheme
} from './themes.js'
import { strings } from '../strings.js'

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
    this.registerCoreActions()
    this.actions = createActionFacade()
    this.handleKeydown = this.handleKeydown.bind(this)
  }

  bind() {
    window.addEventListener('keydown', this.handleKeydown)
  }

  handleKeydown(event) {
    if (this.edit.isEditing || isFormTarget(event.target)) return
    const binding = ACTION_BINDINGS.find(item => matchesBinding(event, item))
    if (binding) {
      event.preventDefault()
      runAction(binding.action, event)
      return
    }

    // 官方行為：選中節點後直接輸入可列印字元，清空原文並從該字元開始編輯。
    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const id = this.selection.primaryId
      if (id) {
        event.preventDefault()
        this.edit.start(id, event.key)
      }
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
      setDocumentSpacing: patch => this.applyStyleMetadata(patch, [this.doc.root.id]),
      setLineStyle: config => this.applyLineStyle(config),
      setRichText: html => this.applyStyleMetadata({ richText: html || null }, [this.selection.primaryId]),
      setCanvasBackground: background => this.setCanvasBackground(background),
      setWatermark: config => this.setWatermark(config),
      setLayout: layoutName => this.setLayout(layoutName),
      getEditorSnapshot: () => this.getEditorSnapshot(),
      toggleFullscreen: () => toggleFullscreen()
    }
    for (const [name, action] of Object.entries(actions)) registerAction(name, action)
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
    if (!this.manager.execute(deleteNodes(this.doc, ids))) return false
    this.selection.set([fallbackId])
    return true
  }

  dissolveSelected() {
    const ids = getTopLevelIds(this.doc.root, this.selection.getSelectedIds()).filter(id => id !== this.doc.root.id)
    if (ids.length === 0) return false
    let records = null
    const command = {
      description: '刪除節點並保留子節點',
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
    const fallback = findNodeContext(this.doc.root, ids[0])?.parent?.id || this.doc.root.id
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
    const nextIndex = context.index + delta
    if (nextIndex < 0 || nextIndex >= context.parent.children.length) return false
    return this.manager.execute(moveNode(this.doc, context.node.id, context.parent.id, nextIndex, context.node.side))
  }

  selectSibling(delta) {
    const context = findNodeContext(this.doc.root, this.selection.primaryId)
    if (!context?.parent) return false
    const sibling = context.parent.children[context.index + delta]
    if (!sibling) return false
    this.selection.set([sibling.id])
    return true
  }

  duplicateSelected() {
    const ids = getTopLevelIds(this.doc.root, this.selection.getSelectedIds())
    const records = ids.map(id => findNodeContext(this.doc.root, id)).filter(context => context?.parent)
    if (records.length === 0) return false
    const anchor = records.at(-1)
    const clones = records.map(record => cloneSubtreeWithFreshIds(record.node))
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
    const nodes = this.clipboard.map(cloneSubtreeWithFreshIds)
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
    return ids.length > 0 && patch && typeof patch === 'object'
      ? this.manager.execute(setStyle(this.doc, ids, patch))
      : false
  }

  applyShape(shape) {
    return this.mutateSelectedStyles('設定節點形狀', (node, context) => {
      const current = node.style.shape || getNodeAppearance(node, context.depth, getTheme(this.doc.themeId)).shape
      node.style.shape = encodeStyleToken(current, {}, shape)
    })
  }

  applyStyleMetadata(patch, explicitIds = null) {
    const ids = (explicitIds || this.selection.getSelectedIds()).filter(Boolean)
    return this.mutateSelectedStyles('設定節點進階樣式', (node, context) => {
      const current = node.style.shape || getNodeAppearance(node, context.depth, getTheme(this.doc.themeId)).shape
      node.style.shape = encodeStyleToken(current, patch)
    }, ids)
  }

  applyLineStyle(config = {}) {
    return this.mutateSelectedStyles('設定連接線樣式', node => {
      node.style.lineStyle = encodeLineToken(node.style.lineStyle, config.style, config.shape)
    })
  }

  mutateSelectedStyles(description, mutate, ids = this.selection.getSelectedIds()) {
    const targetIds = ids.filter(Boolean)
    if (targetIds.length === 0) return false
    let previous = null
    const command = {
      description,
      do: () => {
        const records = targetIds.map(id => findNodeContext(this.doc.root, id)).filter(Boolean)
        if (records.length === 0) return false
        if (!previous) previous = records.map(record => ({ id: record.node.id, style: structuredCloneSafe(record.node.style) }))
        records.forEach(record => mutate(record.node, record))
        return true
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

  setWatermark(config = {}) {
    const root = this.doc.root
    const previous = { enabled: Boolean(this.doc.canvas.watermark), shape: root.style.shape }
    const patch = {
      watermarkText: String(config.text || 'MindFlow').slice(0, 30),
      watermarkColor: config.color || '#64748b',
      watermarkRotation: ['left', 'right', 'horizontal'].includes(config.rotation) ? config.rotation : 'left',
      watermarkOpacity: Math.max(0, Math.min(100, Number(config.opacity) || 0)),
      watermarkSize: Math.max(10, Math.min(48, Number(config.size) || 18))
    }
    const nextShape = encodeStyleToken(root.style.shape || getTheme(this.doc.themeId).rootStyle.shape, patch)
    const enabled = Boolean(config.enabled)
    return this.manager.execute({
      description: '設定浮水印',
      do: () => {
        this.doc.canvas.watermark = enabled
        root.style.shape = nextShape
        return true
      },
      undo: () => {
        this.doc.canvas.watermark = previous.enabled
        if (previous.shape === undefined) delete root.style.shape
        else root.style.shape = previous.shape
      }
    })
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
    return {
      doc: this.doc,
      selectedIds: this.selection.getSelectedIds(),
      primaryNode: context?.node || null,
      primaryAppearance: context ? getNodeAppearance(context.node, context.depth, getTheme(this.doc.themeId)) : null,
      rootAppearance: getNodeAppearance(this.doc.root, 0, getTheme(this.doc.themeId))
    }
  }
}

function createActionFacade() {
  const names = new Set(ACTION_BINDINGS.map(binding => binding.action))
  ;['zoomIn', 'zoomOut', 'fit', 'insertChild', 'insertAfter', 'undo', 'redo'].forEach(name => names.add(name))
  return Object.fromEntries(Array.from(names, name => [name, (...args) => runAction(name, ...args)]))
}

function matchesBinding(event, binding) {
  const ctrl = event.ctrlKey || event.metaKey
  return event.key.toLowerCase() === binding.key.toLowerCase()
    && ctrl === Boolean(binding.ctrl)
    && event.shiftKey === Boolean(binding.shift)
    && event.altKey === Boolean(binding.alt)
}

function isFormTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen?.()
  return document.documentElement.requestFullscreen?.()
}
