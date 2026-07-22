/**
 * contenteditable 編輯生命週期：Enter/blur 確認、Esc 還原、Shift+Enter 換行。
 */
export class EditController {
  constructor({ nodesLayer, onCommit }) {
    this.nodesLayer = nodesLayer
    this.onCommit = onCommit
    this.session = null
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

    const original = textElement.textContent === '\u200b' ? '' : textElement.textContent
    this.session = { id, textElement, original, finishing: false }
    nodeElement.classList.add('is-editing')
    textElement.contentEditable = 'true'
    textElement.spellcheck = false
    if (initialText !== null) textElement.textContent = initialText
    textElement.focus()
    placeCaret(textElement, initialText === null)

    const keydown = event => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancel()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        this.commit()
      }
    }
    const blur = () => this.commit()
    this.session.keydown = keydown
    this.session.blur = blur
    textElement.addEventListener('keydown', keydown)
    textElement.addEventListener('blur', blur)
    return true
  }

  commit() {
    if (!this.session || this.session.finishing) return false
    this.session.finishing = true
    const { id, textElement, original } = this.session
    const next = normalizeEditableText(textElement.innerText)
    this.cleanup()
    if (next !== original) this.onCommit(id, next)
    return true
  }

  cancel() {
    if (!this.session || this.session.finishing) return false
    this.session.finishing = true
    this.session.textElement.textContent = this.session.original || '\u200b'
    this.cleanup()
    return true
  }

  cleanup() {
    const session = this.session
    if (!session) return
    session.textElement.removeEventListener('keydown', session.keydown)
    session.textElement.removeEventListener('blur', session.blur)
    session.textElement.contentEditable = 'false'
    session.textElement.closest('.mind-node')?.classList.remove('is-editing')
    this.session = null
  }

  get isEditing() {
    return Boolean(this.session)
  }
}

function normalizeEditableText(text) {
  return String(text).replace(/\r/g, '').replace(/\n$/, '')
}

function placeCaret(element, selectAll) {
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(element)
  if (!selectAll) range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}
