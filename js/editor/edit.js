/**
 * contenteditable 編輯生命週期與文字浮動工具列：Enter 確認、Esc 還原、Shift+Enter 換行。
 */
import { runAction } from './actions.js'
import { dispatchGlobalShortcut, findShortcutBinding } from './keyboard.js'

const COMMIT_BEFORE_GLOBAL_ACTIONS = new Set([
  'duplicate',
  'findReplace',
  'nextTheme',
  ...Array.from({ length: 9 }, (_, index) => `priority${index + 1}`)
])

export function shouldCommitBeforeGlobalAction(action) {
  return action === 'save' || COMMIT_BEFORE_GLOBAL_ACTIONS.has(action)
}

export class EditController {
  constructor({ nodesLayer, onCommit, onLiveChange = null, onSessionEnd = null }) {
    this.nodesLayer = nodesLayer
    this.onCommit = onCommit
    // 輸入時通知外層排存檔：改成「存檔不結束編輯」之後，
    // 若沒有這條通知，使用者可以一直打字但只有第一次快照被存下來。
    this.onLiveChange = onLiveChange
    this.onSessionEnd = onSessionEnd
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

  // 預備輸入：節點一被選取就把它的文字元素變成可輸入（焦點就緒、原文全選、游標與反白透明），
  // 這樣中文輸入法從**第一個鍵**就能組字。之前焦點停在不可編輯的畫布，第一個鍵會以普通英文
  // 字母送達（瀏覽器不會把它交給輸入法），app 再拿那個字母當種子 → 第一個字變英文。
  // 第一個真正的輸入（compositionstart／beforeinput）才升格成正式 session；快捷鍵仍照常派發。
  arm(id) {
    if (this.session) return false
    if (this.armed?.id === id && this.armed.textElement.isConnected) return true
    this.disarm()
    const nodeElement = this.nodesLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    const textElement = nodeElement?.querySelector('.mind-node__text')
    if (!textElement) return false
    const original = textElement.textContent === '\u200b' ? '' : textElement.innerText
    const armed = { id, nodeElement, textElement, original, originalHtml: textElement.innerHTML }
    armed.compositionStart = () => this.promoteArmed()
    armed.beforeInput = event => this.handleArmedBeforeInput(event)
    armed.blur = () => queueMicrotask(() => {
      if (this.armed === armed && document.activeElement !== textElement) this.disarm()
    })
    this.armed = armed
    nodeElement.classList.add('is-armed')
    textElement.contentEditable = 'true'
    textElement.spellcheck = false
    textElement.addEventListener('compositionstart', armed.compositionStart)
    textElement.addEventListener('beforeinput', armed.beforeInput)
    textElement.addEventListener('blur', armed.blur)
    textElement.focus({ preventScroll: true })
    // 全選：第一個輸入（含輸入法組字）直接取代原文＝官方「選中後直接輸入會清空原文」語意
    placeCaret(textElement, true)
    return true
  }

  disarm() {
    const armed = this.armed
    if (!armed) return false
    this.armed = null
    armed.textElement.removeEventListener('compositionstart', armed.compositionStart)
    armed.textElement.removeEventListener('beforeinput', armed.beforeInput)
    armed.textElement.removeEventListener('blur', armed.blur)
    armed.nodeElement.classList.remove('is-armed')
    // 沒升格就結束：把 DOM 還原成非編輯（元素可能已被重繪拔掉，操作是安全的）
    armed.textElement.contentEditable = 'false'
    if (document.activeElement === armed.textElement) armed.textElement.blur()
    return true
  }

  isArmedTarget(target) {
    return Boolean(this.armed && target instanceof Node && this.armed.textElement.contains(target))
  }

  handleArmedBeforeInput(event) {
    const type = event.inputType || ''
    // 貼上／拖放／刪除／undo／換行／格式 在「選取」語意下都不是打字：維持既有的節點級行為，不進入編輯
    // （Shift+Enter 若放行會以換行取代全選的原文＝清空節點；Ctrl+B/I/U 在選取狀態原本就是 no-op）
    if (/^(insertFromPaste|insertFromDrop|delete|history|insertLineBreak|insertParagraph|format)/u.test(type)) {
      event.preventDefault()
      return
    }
    // 空白鍵（含 Shift+Space）＝「進入編輯、游標放尾端」，不能拿一個空白取代原文
    if (type === 'insertText' && event.data === ' ') {
      event.preventDefault()
      this.promoteArmed()
      if (this.session) placeCaret(this.session.textElement, false)
      return
    }
    this.promoteArmed()
  }

  // 預備 → 正式 session：不動 DOM、不動焦點、不動全選範圍，瀏覽器接著把輸入插進去取代原文。
  promoteArmed() {
    const armed = this.armed
    if (!armed) return false
    this.armed = null
    armed.textElement.removeEventListener('compositionstart', armed.compositionStart)
    armed.textElement.removeEventListener('beforeinput', armed.beforeInput)
    armed.textElement.removeEventListener('blur', armed.blur)
    armed.nodeElement.classList.remove('is-armed')
    this.session = {
      id: armed.id,
      nodeElement: armed.nodeElement,
      textElement: armed.textElement,
      original: armed.original,
      originalHtml: armed.originalHtml,
      finishing: false,
      lastRange: null,
      pendingStyle: {},
      pendingMetadata: {}
    }
    armed.nodeElement.classList.add('is-editing')
    this.captureRange()
    this.showToolbar(armed.nodeElement)
    this.attachSessionListeners()
    return true
  }

  attachSessionListeners() {
    const { textElement } = this.session
    const keydown = event => this.handleEditingKeydown(event)
    const blur = event => {
      if (this.toolbar?.contains(event.relatedTarget)) return
      queueMicrotask(() => {
        if (this.session && !this.toolbar?.contains(document.activeElement)) this.commit()
      })
    }
    const selectionChange = () => this.captureRange()
    const liveChange = () => { if (typeof this.onLiveChange === 'function') this.onLiveChange() }
    this.session.keydown = keydown
    this.session.blur = blur
    this.session.selectionChange = selectionChange
    this.session.liveChange = liveChange
    textElement.addEventListener('keydown', keydown)
    textElement.addEventListener('blur', blur)
    textElement.addEventListener('input', liveChange)
    textElement.addEventListener('compositionend', liveChange)
    document.addEventListener('selectionchange', selectionChange)
  }

  start(id, initialText = null) {
    if (this.session) this.commit()
    this.disarm()
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
    this.attachSessionListeners()
    return true
  }

  handleEditingKeydown(event) {
    const shortcut = findShortcutBinding(event)
    // 這些 action 會重繪節點層；先結束編輯，避免 renderAll 拔掉 contenteditable
    // 後留下 detached session，造成文字延遲回寫與鍵盤失效。
    if (shouldCommitBeforeGlobalAction(shortcut?.action)) this.commit()
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

  // 週期性存檔用：讀出進行中編輯的即時文字，但**不結束 session**。
  // commit() 會 cleanup（contenteditable=false + blur），等於把使用者踢出輸入狀態；
  // 自動存檔不該有這種副作用（雙擊空白畫布新建節點時會在 500ms 後失去游標）。
  getLiveEdit() {
    if (!this.session || this.session.finishing) return null
    const { id, textElement, original, originalHtml } = this.session
    const text = normalizeEditableText(textElement.innerText)
    // richText 必須跟著走：render 只要 richText 非空就優先畫它，
    // 只存 plain text 會讓重載後看到「舊 HTML 蓋住新文字」。
    // 無 DOM 環境（純函數單元測試）只回 plain text。
    if (typeof document === 'undefined' || typeof textElement.innerHTML !== 'string') {
      return { id, text, richText: null, changed: text !== original }
    }
    const richHtml = normalizeRichHtml(textElement.innerHTML)
    const richText = hasRichFormatting(richHtml) ? richHtml : null
    const richChanged = richHtml !== normalizeRichHtml(originalHtml)
    return { id, text, richText, changed: text !== original || richChanged }
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
    // 取消後 canonical 回到原值，但 storage 可能還留著中途的 live 快照：
    // 主動排一次存檔把 canonical 寫回去，否則被取消的文字會在重載後復活。
    if (typeof this.onLiveChange === 'function') this.onLiveChange()
    return true
  }

  cleanup() {
    const session = this.session
    if (!session) return
    session.textElement.removeEventListener('keydown', session.keydown)
    session.textElement.removeEventListener('blur', session.blur)
    if (session.liveChange) {
      session.textElement.removeEventListener('input', session.liveChange)
      session.textElement.removeEventListener('compositionend', session.liveChange)
    }
    document.removeEventListener('selectionchange', session.selectionChange)
    session.textElement.contentEditable = 'false'
    session.nodeElement.classList.remove('is-editing')
    if (this.toolbar) this.toolbar.hidden = true
    this.session = null
    // 編輯結束（提交或取消）都通知外層：文字沒變時不會有 render／selectionchange，
    // 若不通知，節點會停在「選取但未預備」，下一個字又走回舊的 keydown 種字路徑（第一個字變英文）。
    if (typeof this.onSessionEnd === 'function') queueMicrotask(() => this.onSessionEnd())
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
    this.bindNativeColor('#text-color', 'foreColor')
    this.bindNativeColor('#text-highlight', 'hiliteColor')
    this.toolbar.querySelector('#text-line-height')?.addEventListener('change', event => {
      if (this.session) this.session.pendingMetadata.lineHeight = event.target.value
      this.refocus()
    })
    this.toolbar.querySelector('#text-format-painter')?.addEventListener('click', () => {
      runAction('formatPainter')
      this.refocus()
    })
  }

  bindNativeColor(selector, command) {
    const input = this.toolbar?.querySelector(selector)
    if (!input) return
    let appliedDuringGesture = false

    input.addEventListener('pointerdown', () => {
      // 原生 picker 取得焦點後 Selection 會消失；必須在預設行為前保存 Range。
      this.captureRange()
      appliedDuringGesture = false
    }, { capture: true })

    const apply = event => {
      if (!this.session) return false
      this.restoreRange()
      document.execCommand(command, false, event.target.value)
      this.captureRange()
      this.refocus()
      return true
    }

    input.addEventListener('input', event => {
      appliedDuringGesture = apply(event)
    })
    input.addEventListener('change', event => {
      // 部分 Chromium / Electron 只在關閉 OS picker 時可靠送 change。
      if (!appliedDuringGesture) apply(event)
      else this.refocus()
      appliedDuringGesture = false
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

  get isArmed() {
    return Boolean(this.armed)
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
