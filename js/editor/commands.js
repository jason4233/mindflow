/**
 * 所有文件修改的 Command Pattern 實作；每個 command 都必須可逆。
 */
import {
  NODE_STYLE_KEYS,
  chooseBalancedSide,
  createNode,
  findNode,
  findNodeContext,
  getTopLevelIds,
  isDescendant,
  structuredCloneSafe
} from './model.js'
import { strings } from '../strings.js'

export class CommandManager {
  constructor({ limit = 100, onChange = () => {} } = {}) {
    this.limit = limit
    this.onChange = onChange
    this.undoStack = []
    this.redoStack = []
  }

  execute(command) {
    assertCommand(command)
    const changed = command.do()
    if (changed === false) return false
    this.undoStack.push(command)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    // 新分支一旦產生，舊 redo 歷史已不再能套用到目前狀態。
    this.redoStack.length = 0
    this.onChange({ type: 'execute', command })
    return true
  }

  undo() {
    const command = this.undoStack.pop()
    if (!command) return false
    command.undo()
    this.redoStack.push(command)
    this.onChange({ type: 'undo', command })
    return true
  }

  redo() {
    const command = this.redoStack.pop()
    if (!command) return false
    const changed = command.do()
    if (changed === false) {
      this.redoStack.push(command)
      return false
    }
    this.undoStack.push(command)
    this.onChange({ type: 'redo', command })
    return true
  }

  clear() {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.onChange({ type: 'clear', command: null })
  }

  get canUndo() {
    return this.undoStack.length > 0
  }

  get canRedo() {
    return this.redoStack.length > 0
  }
}

function assertCommand(command) {
  if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
    throw new TypeError('Command 必須包含 do() 與 undo()')
  }
}

function clampIndex(index, length) {
  if (!Number.isFinite(Number(index))) return length
  return Math.max(0, Math.min(length, Math.trunc(Number(index))))
}

function makeCommand(description, doAction, undoAction, extra = {}) {
  return { description, do: doAction, undo: undoAction, ...extra }
}

export function addChild(doc, parentId, index, options = {}) {
  const node = options.node ? structuredCloneSafe(options.node) : createNode(options.text || '')
  let insertedIndex = null
  let assignedSide = options.side || node.side
  let initialized = false

  return makeCommand(
    strings.commands.addChild,
    () => {
      const parent = findNode(doc.root, parentId)
      if (!parent || findNode(doc.root, node.id)) return false

      if (!initialized) {
        insertedIndex = clampIndex(index, parent.children.length)
        if (parent === doc.root && doc.layout === 'mindmap-both') {
          assignedSide = assignedSide === 'left' || assignedSide === 'right'
            ? assignedSide
            : chooseBalancedSide(doc.root)
        }
        initialized = true
      }

      node.side = parent === doc.root && doc.layout === 'mindmap-both' ? assignedSide : null
      parent.children.splice(clampIndex(insertedIndex, parent.children.length), 0, node)
      return true
    },
    () => {
      const context = findNodeContext(doc.root, node.id)
      if (context?.parent) context.parent.children.splice(context.index, 1)
    },
    { nodeId: node.id, node }
  )
}

export function addSiblingAfter(doc, nodeId, options = {}) {
  return createSiblingCommand(doc, nodeId, false, options)
}

export function addSiblingBefore(doc, nodeId, options = {}) {
  return createSiblingCommand(doc, nodeId, true, options)
}

function createSiblingCommand(doc, nodeId, before, options) {
  const node = options.node ? structuredCloneSafe(options.node) : createNode(options.text || '')
  let delegate = null
  return makeCommand(
    before ? strings.commands.addSiblingBefore : strings.commands.addSiblingAfter,
    () => {
      if (!delegate) {
        const context = findNodeContext(doc.root, nodeId)
        if (!context?.parent) return false
        // 首次執行才讀取 index，確保 command 建立後即使樹有變化仍緊鄰目標節點。
        delegate = addChild(doc, context.parent.id, context.index + (before ? 0 : 1), {
          ...options,
          node,
          side: context.parent === doc.root ? context.node.side : null
        })
      }
      return delegate.do()
    },
    () => delegate?.undo(),
    { nodeId: node.id, node }
  )
}

export function insertSubtrees(doc, parentId, nodes, index) {
  const insertedNodes = nodes.map(node => structuredCloneSafe(node))
  let startIndex = null
  return makeCommand(
    strings.commands.pasteSubtrees,
    () => {
      const parent = findNode(doc.root, parentId)
      if (!parent || insertedNodes.some(node => findNode(doc.root, node.id))) return false
      if (startIndex === null) startIndex = clampIndex(index, parent.children.length)
      const safeIndex = clampIndex(startIndex, parent.children.length)
      for (const node of insertedNodes) {
        if (parent !== doc.root) node.side = null
        else if (doc.layout === 'mindmap-both' && node.side !== 'left' && node.side !== 'right') {
          node.side = chooseBalancedSide(doc.root)
        }
      }
      parent.children.splice(safeIndex, 0, ...insertedNodes)
      return insertedNodes.length > 0
    },
    () => {
      for (const node of insertedNodes) {
        const context = findNodeContext(doc.root, node.id)
        if (context?.parent) context.parent.children.splice(context.index, 1)
      }
    },
    { nodeIds: insertedNodes.map(node => node.id), nodes: insertedNodes }
  )
}

export function deleteNodes(doc, ids) {
  const selectedIds = getTopLevelIds(doc.root, ids).filter(id => id !== doc.root.id)
  let records = null

  return makeCommand(
    strings.commands.deleteNodes,
    () => {
      if (selectedIds.length === 0) return false
      if (!records) {
        records = selectedIds
          .map(id => findNodeContext(doc.root, id))
          .filter(context => context?.parent)
          .map(context => ({
            parentId: context.parent.id,
            index: context.index,
            node: context.node
          }))
      }
      if (records.length === 0) return false

      // 同父節點由後往前刪，避免前面的 splice 改變後方索引。
      const current = records
        .map(record => findNodeContext(doc.root, record.node.id))
        .filter(context => context?.parent)
        .sort((a, b) => b.index - a.index)
      for (const context of current) context.parent.children.splice(context.index, 1)
      return current.length > 0
    },
    () => {
      const sorted = records.slice().sort((a, b) => a.index - b.index)
      for (const record of sorted) {
        const parent = findNode(doc.root, record.parentId)
        if (parent && !findNode(doc.root, record.node.id)) {
          parent.children.splice(clampIndex(record.index, parent.children.length), 0, record.node)
        }
      }
    },
    { deletedIds: selectedIds }
  )
}

export function updateText(doc, id, text) {
  let previous
  let initialized = false
  const next = String(text)
  return makeCommand(
    strings.commands.updateText,
    () => {
      const node = findNode(doc.root, id)
      if (!node) return false
      if (!initialized) {
        previous = node.text
        initialized = true
      }
      if (node.text === next) return false
      node.text = next
      return true
    },
    () => {
      const node = findNode(doc.root, id)
      if (node) node.text = previous
    }
  )
}

export function moveNode(doc, id, newParentId, index, side = null) {
  let original = null

  return makeCommand(
    strings.commands.moveNode,
    () => {
      const context = findNodeContext(doc.root, id)
      const newParent = findNode(doc.root, newParentId)
      if (!context?.parent || !newParent || id === newParentId || isDescendant(doc.root, id, newParentId)) return false

      if (!original) {
        original = {
          parentId: context.parent.id,
          index: context.index,
          side: context.node.side
        }
      }

      const node = context.node
      const targetIndex = clampIndex(index, newParent.children.length - (context.parent === newParent ? 1 : 0))
      const samePlace = context.parent === newParent
        && context.index === targetIndex
        && (newParent !== doc.root || side === null || node.side === side)
      if (samePlace) return false

      context.parent.children.splice(context.index, 1)
      if (newParent === doc.root && doc.layout === 'mindmap-both') {
        node.side = side === 'left' || side === 'right'
          ? side
          : (original.parentId === doc.root.id ? original.side : chooseBalancedSide(doc.root))
      } else {
        node.side = null
      }
      newParent.children.splice(clampIndex(targetIndex, newParent.children.length), 0, node)
      return true
    },
    () => {
      if (!original) return
      const current = findNodeContext(doc.root, id)
      const oldParent = findNode(doc.root, original.parentId)
      if (!current?.parent || !oldParent) return
      current.parent.children.splice(current.index, 1)
      current.node.side = original.side
      oldParent.children.splice(clampIndex(original.index, oldParent.children.length), 0, current.node)
    }
  )
}

export function toggleCollapse(doc, id) {
  let previous
  let initialized = false
  return makeCommand(
    strings.commands.toggleCollapse,
    () => {
      const node = findNode(doc.root, id)
      if (!node || node.children.length === 0) return false
      if (!initialized) {
        previous = node.collapsed
        initialized = true
      }
      node.collapsed = !previous
      return true
    },
    () => {
      const node = findNode(doc.root, id)
      if (node) node.collapsed = previous
    }
  )
}

export function setStyle(doc, ids, patch) {
  const allowedPatch = {}
  for (const key of NODE_STYLE_KEYS) {
    if (Object.hasOwn(patch, key)) allowedPatch[key] = patch[key]
  }
  let previous = null

  return makeCommand(
    strings.commands.setStyle,
    () => {
      const nodes = ids.map(id => findNode(doc.root, id)).filter(Boolean)
      if (nodes.length === 0 || Object.keys(allowedPatch).length === 0) return false
      if (!previous) previous = nodes.map(node => ({ id: node.id, style: structuredCloneSafe(node.style) }))
      for (const node of nodes) node.style = { ...node.style, ...allowedPatch }
      return true
    },
    () => {
      for (const record of previous || []) {
        const node = findNode(doc.root, record.id)
        if (node) node.style = structuredCloneSafe(record.style)
      }
    }
  )
}

export function updateDocumentTitle(doc, title) {
  const next = String(title).trim()
  let previous
  let initialized = false
  return makeCommand(
    strings.commands.updateDocumentTitle,
    () => {
      if (!next || doc.title === next) return false
      if (!initialized) {
        previous = doc.title
        initialized = true
      }
      doc.title = next
      return true
    },
    () => {
      doc.title = previous
    }
  )
}
