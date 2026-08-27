/**
 * 大綱檢視：與心智圖共用同一份 Doc，文字與層級異動全部走 command。
 */
import { addChild, addSiblingAfter, moveNode, updateRichText, updateText } from './commands.js'
import { findNode, findNodeContext, walkNodes } from './model.js'
import { registerOverlay } from './render.js'

export function initializeOutline(options = {}) {
  if (!options.container || !options.doc || !options.manager) return { open() {}, close() {}, refresh() {} }
  return new OutlineController(options)
}

class OutlineController {
  constructor({ container, doc, manager, selection, viewport, getPositions, onJump = () => {} }) {
    this.container = container
    this.doc = doc
    this.manager = manager
    this.selection = selection
    this.viewport = viewport
    this.getPositions = getPositions
    this.onJump = onJump
    this.suspendRefresh = false
    this.opened = false
    this.build()
    this.bindEvents()
    this.unregisterOverlay = registerOverlay(() => this.refresh())
    this.refresh(true)
  }

  build() {
    this.container.innerHTML = `
      <header class="outline-header">
        <div><strong>大綱</strong><span data-outline-count></span></div>
        <span>Tab 下級 · Enter 同級 · Shift+Tab 減少縮排</span>
      </header>
      <div class="outline-list" data-outline-list role="tree" aria-label="文件大綱"></div>`
    this.list = this.container.querySelector('[data-outline-list]')
    this.count = this.container.querySelector('[data-outline-count]')
  }

  bindEvents() {
    this.list.addEventListener('focusin', event => {
      const row = event.target.closest('[data-outline-row]')
      if (row) this.selection?.set([row.dataset.nodeId])
    })
    this.list.addEventListener('click', event => {
      const row = event.target.closest('[data-outline-row]')
      if (row) this.selection?.set([row.dataset.nodeId])
    })
    this.list.addEventListener('dblclick', event => {
      const row = event.target.closest('[data-outline-row]')
      if (!row) return
      this.commitRow(row)
      this.jumpTo(row.dataset.nodeId)
    })
    this.list.addEventListener('blur', event => {
      const row = event.target.closest('[data-outline-row]')
      if (row) this.commitRow(row)
    }, true)
    this.list.addEventListener('keydown', event => this.handleKeydown(event))
    window.addEventListener('mindflow:selectionchange', event => this.applySelection(event.detail?.ids || []))
  }

  handleKeydown(event) {
    const row = event.target.closest('[data-outline-row]')
    if (!row) return
    const id = row.dataset.nodeId

    if (event.key === 'Escape') {
      event.preventDefault()
      row.querySelector('[data-outline-text]')?.blur()
      return
    }
    if (event.key === 'Enter' && event.shiftKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitRow(row)
      this.insertSibling(id)
      return
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    this.commitRow(row)
    if (event.shiftKey) this.outdent(id)
    else this.insertChild(id)
  }

  commitRow(row) {
    const id = row?.dataset.nodeId
    const node = findNode(this.doc.root, id)
    const editor = row?.querySelector('[data-outline-text]')
    if (!node || !editor) return false
    const nextText = normalizeEditableText(editor.innerText)
    if (nextText === node.text) return false

    this.suspendRefresh = true
    try {
      // 大綱是純文字編輯；文字真的變更時清掉舊 richText，避免圖與大綱顯示兩份內容。
      return this.manager.batch('編輯大綱文字', [
        updateText(this.doc, id, nextText),
        updateRichText(this.doc, id, null)
      ])
    } finally {
      this.suspendRefresh = false
    }
  }

  insertChild(parentId) {
    const command = addChild(this.doc, parentId, undefined, { text: '新主題' })
    if (!this.manager.execute(command)) return false
    this.focusNode(command.nodeId)
    return true
  }

  insertSibling(id) {
    if (id === this.doc.root.id) return this.insertChild(id)
    const command = addSiblingAfter(this.doc, id, { text: '新主題' })
    if (!this.manager.execute(command)) return false
    this.focusNode(command.nodeId)
    return true
  }

  outdent(id) {
    const context = findNodeContext(this.doc.root, id)
    if (!context?.parent || context.parent === this.doc.root) return false
    const parentContext = findNodeContext(this.doc.root, context.parent.id)
    if (!parentContext?.parent) return false
    const command = moveNode(this.doc, id, parentContext.parent.id, parentContext.index + 1, context.parent.side)
    if (!this.manager.execute(command)) return false
    this.focusNode(id, false)
    return true
  }

  jumpTo(id) {
    const position = this.getPositions?.().get(id)
    this.selection?.set([id])
    if (position) this.viewport?.centerOn(position)
    this.onJump(id)
  }

  focusNode(id, selectText = true) {
    this.selection?.set([id])
    requestAnimationFrame(() => {
      this.refresh(true)
      const editor = this.list.querySelector(`[data-outline-row][data-node-id="${cssEscape(id)}"] [data-outline-text]`)
      if (!editor) return
      editor.focus()
      if (selectText) selectContents(editor)
    })
  }

  refresh(force = false) {
    if (this.suspendRefresh) return
    // 面板關閉時不重建（open() 會補一次 refresh(true)），避免大圖每次重繪都白建整份大綱
    if (!force && !this.opened) return
    const active = document.activeElement
    if (!force && active?.closest?.('[data-outline-list]') === this.list) return
    const records = []
    walkNodes(this.doc.root, (node, _parent, depth) => records.push({ node, depth }))
    const fragment = document.createDocumentFragment()
    for (const { node, depth } of records) {
      const row = document.createElement('div')
      row.className = 'outline-row'
      row.dataset.outlineRow = 'true'
      row.dataset.nodeId = node.id
      row.dataset.depth = String(depth)
      row.setAttribute('role', 'treeitem')
      row.setAttribute('aria-level', String(depth + 1))
      row.style.setProperty('--outline-depth', String(depth))
      const marker = document.createElement('span')
      marker.className = 'outline-marker'
      marker.textContent = depth === 0 ? '◆' : node.children.length > 0 ? '●' : '○'
      const text = document.createElement('div')
      text.className = 'outline-text'
      text.dataset.outlineText = 'true'
      text.contentEditable = 'true'
      text.spellcheck = false
      text.textContent = node.text || ''
      row.append(marker, text)
      fragment.append(row)
    }
    this.list.replaceChildren(fragment)
    this.count.textContent = `${records.length} 個節點`
    this.applySelection(this.selection?.getSelectedIds?.() || [])
  }

  applySelection(ids) {
    const selected = new Set(ids)
    this.list.querySelectorAll('[data-outline-row]').forEach(row => {
      row.classList.toggle('is-selected', selected.has(row.dataset.nodeId))
    })
  }

  open() {
    this.opened = true
    this.container.hidden = false
    this.refresh(true)
  }

  close() {
    this.opened = false
    this.container.hidden = true
  }
}

function normalizeEditableText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

function selectContents(element) {
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&')
}
