/**
 * 唯一快捷鍵入口；action 表集中對映至 command、選取、編輯與視口動作。
 */
import {
  addChild,
  addSiblingAfter,
  addSiblingBefore,
  deleteNodes,
  insertSubtrees
} from './commands.js'
import {
  cloneSubtreeWithFreshIds,
  findNode,
  findNodeContext,
  getTopLevelIds,
  structuredCloneSafe
} from './model.js'
import { strings } from '../strings.js'

export const ACTION_BINDINGS = Object.freeze([
  { action: 'undo', key: 'z', ctrl: true },
  { action: 'redo', key: 'y', ctrl: true },
  { action: 'redo', key: 'z', ctrl: true, shift: true },
  { action: 'copy', key: 'c', ctrl: true },
  { action: 'cut', key: 'x', ctrl: true },
  { action: 'paste', key: 'v', ctrl: true },
  { action: 'selectAll', key: 'a', ctrl: true },
  { action: 'save', key: 's', ctrl: true },
  { action: 'zoomIn', key: '=', ctrl: true },
  { action: 'zoomIn', key: '+', ctrl: true },
  { action: 'zoomOut', key: '-', ctrl: true },
  { action: 'zoomReset', key: '0', ctrl: true },
  { action: 'fit', key: 'f', ctrl: true, shift: true },
  { action: 'insertChild', key: 'Tab' },
  { action: 'insertChild', key: 'Insert' },
  { action: 'insertBefore', key: 'Enter', shift: true },
  { action: 'insertAfter', key: 'Enter' },
  { action: 'remove', key: 'Delete' },
  { action: 'remove', key: 'Backspace' },
  { action: 'edit', key: 'F2' },
  { action: 'clearSelection', key: 'Escape' },
  { action: 'left', key: 'ArrowLeft' },
  { action: 'right', key: 'ArrowRight' },
  { action: 'up', key: 'ArrowUp' },
  { action: 'down', key: 'ArrowDown' }
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
    this.actions = this.createActions()
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
      this.actions[binding.action]?.()
      return
    }

    // 直接輸入會以新字元進入編輯；Space 保留給畫布平移。
    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const id = this.selection.primaryId
      if (id) {
        event.preventDefault()
        this.edit.start(id, event.key)
      }
    }
  }

  createActions() {
    return {
      undo: () => this.manager.undo(),
      redo: () => this.manager.redo(),
      copy: () => this.copy(),
      cut: () => {
        this.copy()
        this.removeSelected()
      },
      paste: () => this.paste(),
      selectAll: () => this.selection.selectAll(),
      save: () => this.save(),
      zoomIn: () => this.viewport.zoomBy(1.2),
      zoomOut: () => this.viewport.zoomBy(1 / 1.2),
      zoomReset: () => this.viewport.resetZoom(),
      fit: () => this.viewport.fit(this.getPositions()),
      insertChild: () => this.insertChild(),
      insertAfter: () => this.insertSibling(false),
      insertBefore: () => this.insertSibling(true),
      remove: () => this.removeSelected(),
      edit: () => {
        if (this.selection.primaryId) this.edit.start(this.selection.primaryId)
      },
      clearSelection: () => this.selection.clear(),
      left: () => this.selection.navigate('left'),
      right: () => this.selection.navigate('right'),
      up: () => this.selection.navigate('up'),
      down: () => this.selection.navigate('down')
    }
  }

  insertChild() {
    const parentId = this.selection.primaryId || this.doc.root.id
    const command = addChild(this.doc, parentId, undefined, { text: strings.editor.newTopic })
    if (this.manager.execute(command)) this.selection.set([command.nodeId])
  }

  insertSibling(before) {
    const id = this.selection.primaryId
    if (!id) return
    const command = before
      ? addSiblingBefore(this.doc, id, { text: strings.editor.newTopic })
      : addSiblingAfter(this.doc, id, { text: strings.editor.newTopic })
    if (this.manager.execute(command)) this.selection.set([command.nodeId])
  }

  removeSelected() {
    const ids = this.selection.getSelectedIds()
    if (ids.length === 0) return
    const primaryContext = findNodeContext(this.doc.root, this.selection.primaryId)
    const fallbackId = primaryContext?.parent?.id || this.doc.root.id
    if (this.manager.execute(deleteNodes(this.doc, ids))) this.selection.set([fallbackId])
  }

  copy() {
    const ids = getTopLevelIds(this.doc.root, this.selection.getSelectedIds())
    this.clipboard = ids
      .map(id => findNode(this.doc.root, id))
      .filter(node => node && node !== this.doc.root)
      .map(node => structuredCloneSafe(node))
  }

  paste() {
    if (this.clipboard.length === 0) return
    const parentId = this.selection.primaryId || this.doc.root.id
    const nodes = this.clipboard.map(cloneSubtreeWithFreshIds)
    const command = insertSubtrees(this.doc, parentId, nodes)
    if (this.manager.execute(command)) this.selection.set(command.nodeIds)
  }
}

function matchesBinding(event, binding) {
  const ctrl = event.ctrlKey || event.metaKey
  return event.key.toLowerCase() === binding.key.toLowerCase()
    && ctrl === Boolean(binding.ctrl)
    && event.shiftKey === Boolean(binding.shift)
    && !event.altKey
}

function isFormTarget(target) {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}
