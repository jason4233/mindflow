/**
 * contenteditable 編輯生命週期與文字浮動工具列：Enter 確認、Esc 還原、Shift+Enter 換行。
 */
import { runAction } from './actions.js'
import { dispatchGlobalShortcut, findShortcutBinding } from './keyboard.js'

export class EditController {
  constructor({ nodesLayer, onCommit }) {
    this.nodesLayer = nodesLayer
    this.onCommit = onCommit
    this.session = null
    this.toolbar = document.querySelector('#text-toolbar')
    this.bindToolbar()
  }

  bindEvents() {
    this.nodesLayer.addEventListener('dblclick', event => {
      const node = event.target.closest('.mind-node')
      if (!node || event.target.closest('[data-collapse-control]')) return
      event.preventDefault()
      this.start(node.dataset.nodeId)
    })
  }

  start(id, initialText = null) {
    if (this.session) this.commit()
    const nodeElement = this.nodesLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    const textElement = nodeElement?.querySelector('.mind-node__text')
    if (!textElement) return false

    const original = textElement.textContent === '\u200b' ? '' : textElement.innerText
    this.session = {
      id,
      nodeElement,
      textElement,
      original,
      originalHtml: textElement.innerHTML,
      finishing: false,
      lastRange: null,
      pendingStyle: {},
      pendingMetadata: {}
    }
    nodeElement.classList.add('is-editing')
    textElement.contentEditable = 'true'
    textElement.spellcheck = false
    if (initialText !== null) textElement.textContent = initialText
    textElement.focus()
    placeCaret(textElement, initialText === null)
    this.captureRange()
    this.showToolbar(nodeElement)

    const keydown = event => {
      const shortcut = findShortcutBinding(event)
      // Ctrl+S 先提交目前 session，確保存下的是畫面上正在編輯的內容。
      if (shortcut?.action === 'save') this.commit()
      if (dispatchGlobalShortcut(event, { formMode: true })) {
        event.stopPropagation()
        return
      }
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancel()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        this.commit()
      } else if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        this.executeTextCommand(({ b: 'bold', i: 'italic', u: 'underline' })[event.key.toLowerCase()])
      }
    }
    const blur = event => {
      if (this.toolbar?.contains(event.relatedTarget)) return
      queueMicrotask(() => {
        if (this.session && !this.toolbar?.contains(document.activeElement)) this.commit()
      })
    }
    const selectionChange = () => this.captureRange()
    this.session.keydown = keydown
    this.session.blur = blur
    this.session.selectionChange = selectionChange
    textElement.addEventListener('keydown', keydown)
    textElement.addEventListener('blur', blur)
    document.addEventListener('selectionchange', selectionChange)
    return true
  }

  commit() {
    if (!this.session || this.session.finishing) return false
    this.session.finishing = true
    const { id, textElement, original, originalHtml, pendingStyle, pendingMetadata } = this.session
    const next = normalizeEditableText(textElement.innerText)
    const richHtml = normalizeRichHtml(textElement.innerHTML)
    const richChanged = richHtml !== normalizeRichHtml(originalHtml)
    this.cleanup()
    const richText = hasRichFormatting(richHtml) ? richHtml : null
    const committed = runAction('commitTextEdit', {
      id,
      text: next,
      richText,
      richChanged,
      pendingStyle,
      pendingMetadata
    })
    // 保留舊注入點供獨立使用 EditController 的呼叫端；主編輯器由 batch action 接管。
    if (committed === false && next !== original && typeof this.onCommit === 'function') this.onCommit(id, next)
    return true
  }

  cancel() {
    if (!this.session || this.session.finishing) return false
    this.session.finishing = true
    this.session.textElement.innerHTML = this.session.originalHtml || '\u200b'
    this.cleanup()
    return true
  }

  cleanup() {
    const session = this.session
    if (!session) return
    session.textElement.removeEventListener('keydown', session.keydown)
    session.textElement.removeEventListener('blur', session.blur)
    document.removeEventListener('selectionchange', session.selectionChange)
    session.textElement.contentEditable = 'false'
    session.nodeElement.classList.remove('is-editing')
    if (this.toolbar) this.toolbar.hidden = true
    this.session = null
  }

  bindToolbar() {
    if (!this.toolbar) return
    this.toolbar.addEventListener('pointerdown', () => this.captureRange(), true)
    this.toolbar.querySelectorAll('[data-text-command]').forEach(button => button.addEventListener('click', () => this.executeTextCommand(button.dataset.textCommand)))
    this.toolbar.querySelectorAll('[data-text-align]').forEach(button => button.addEventListener('click', () => {
      const alignment = button.dataset.textAlign
      this.restoreRange()
      document.execCommand(({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' })[alignment], false)
      if (this.session) this.session.pendingMetadata.align = alignment
      this.refocus()
    }))

    this.toolbar.querySelector('#text-font-family')?.addEventListener('change', event => {
      this.restoreRange()
      document.execCommand('fontName', false, event.target.value)
      if (this.session) this.session.pendingStyle.fontFamily = event.target.value
      this.refocus()
    })
    this.toolbar.querySelector('#text-font-size')?.addEventListener('change', event => {
      const size = Number(event.target.value)
      this.restoreRange()
      document.execCommand('fontSize', false, fontSizeCommandValue(size))
      if (this.session) this.session.pendingStyle.fontSize = size
      this.refocus()
    })
    this.toolbar.querySelector('#text-color')?.addEventListener('input', event => {
      this.restoreRange()
      document.execCommand('foreColor', false, event.target.value)
      this.refocus()
    })
    this.toolbar.querySelector('#text-highlight')?.addEventListener('input', event => {
      this.restoreRange()
      document.execCommand('hiliteColor', false, event.target.value)
      this.refocus()
    })
    this.toolbar.querySelector('#text-line-height')?.addEventListener('change', event => {
      if (this.session) this.session.pendingMetadata.lineHeight = event.target.value
      this.refocus()
    })
    this.toolbar.querySelector('#text-format-painter')?.addEventListener('click', () => {
      runAction('copyStyle')
      this.refocus()
    })
  }

  executeTextCommand(command) {
    if (!this.session) return false
    this.restoreRange()
    document.execCommand(command, false)
    this.captureRange()
    this.updateToolbarState()
    this.refocus()
    return true
  }

  captureRange() {
    if (!this.session) return
    const selection = window.getSelection()
    if (!selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    if (this.session.textElement.contains(range.commonAncestorContainer)) this.session.lastRange = range.cloneRange()
  }

  restoreRange() {
    if (!this.session?.lastRange) return
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(this.session.lastRange)
  }

  refocus() {
    if (!this.session) return
    this.session.textElement.focus({ preventScroll: true })
    this.restoreRange()
  }

  showToolbar(nodeElement) {
    if (!this.toolbar) return
    this.toolbar.hidden = false
    this.updateToolbarState()
    requestAnimationFrame(() => {
      if (!this.session) return
      const canvas = this.nodesLayer.closest('.canvas')
      const nodeRect = nodeElement.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const width = this.toolbar.offsetWidth
      const left = Math.max(8, Math.min(canvas.clientWidth - width - 8, nodeRect.left - canvasRect.left + nodeRect.width / 2 - width / 2))
      const top = Math.max(64, nodeRect.top - canvasRect.top - this.toolbar.offsetHeight - 10)
      this.toolbar.style.left = `${left}px`
      this.toolbar.style.top = `${top}px`
    })
  }

  updateToolbarState() {
    if (!this.toolbar || !this.session) return
    this.toolbar.querySelectorAll('[data-text-command]').forEach(button => button.classList.toggle('is-active', document.queryCommandState(button.dataset.textCommand)))
  }

  get isEditing() {
    return Boolean(this.session)
  }
}

function normalizeEditableText(text) {
  return String(text).replace(/\r/g, '').replace(/\n$/, '')
}

function normalizeRichHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = String(html || '')
  for (const font of Array.from(template.content.querySelectorAll('font'))) {
    const span = document.createElement('span')
    if (font.color) span.style.color = font.color
    if (font.face) span.style.fontFamily = font.face
    if (font.size) span.style.fontSize = commandSizeToPixels(font.size)
    span.append(...font.childNodes)
    font.replaceWith(span)
  }
  return template.innerHTML
}

function hasRichFormatting(html) {
  return /<(b|strong|i|em|u|s|strike|span)\b/i.test(html)
}

function fontSizeCommandValue(size) {
  if (size <= 10) return 1
  if (size <= 12) return 2
  if (size <= 14) return 3
  if (size <= 18) return 4
  if (size <= 24) return 5
  if (size <= 32) return 6
  return 7
}

function commandSizeToPixels(value) {
  return `${({ 1: 10, 2: 12, 3: 14, 4: 18, 5: 24, 6: 32, 7: 48 })[Number(value)] || 14}px`
}

function placeCaret(element, selectAll) {
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(element)
  if (!selectAll) range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}
