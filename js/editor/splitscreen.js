/**
 * 編輯器右側參考分屏：支援 HTTPS 網址與本機 PDF，分隔線可拖曳。
 * 明文 http 會自動升級成 https（CSP frame-src 也只放行 https），純 HTTP 內網站點不支援。
 */
import { registerAction } from './actions.js'

// 外部網頁分屏的 iframe 限制：沒有 allow-top-navigation，外站不能把整個編輯器導走。
const EXTERNAL_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

export function normalizeSplitUrl(value) {
  const input = String(value ?? '').trim()
  if (!input) return ''
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(input) ? input : `https://${input}`
  try {
    const parsed = new URL(candidate)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    // 明文 http 一律升級成 https 再載入，分屏內容不走可被竄改的連線。
    parsed.protocol = 'https:'
    return parsed.href
  } catch {
    return ''
  }
}

export function isPdfFile(file) {
  if (!file) return false
  return file.type === 'application/pdf' || /\.pdf$/iu.test(String(file.name || ''))
}

export function initSplitscreen(ctx) {
  ensurePhaseCStyles()
  const controller = createSplitScreen(ctx)
  registerAction('splitScreen', () => {
    controller.openDialog()
    return true
  })
  return controller
}

function createSplitScreen(ctx) {
  const panel = document.createElement('aside')
  panel.className = 'split-screen-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', '參考資料分屏')

  const divider = document.createElement('div')
  divider.className = 'split-screen-divider'
  divider.tabIndex = 0
  divider.setAttribute('role', 'separator')
  divider.setAttribute('aria-orientation', 'vertical')
  divider.setAttribute('aria-label', '調整分屏寬度')

  const content = document.createElement('div')
  content.className = 'split-screen-content'
  const header = document.createElement('header')
  const title = document.createElement('strong')
  title.textContent = '參考資料'
  const sourceLink = document.createElement('a')
  sourceLink.target = '_blank'
  sourceLink.rel = 'noopener noreferrer'
  sourceLink.textContent = '另開視窗'
  sourceLink.hidden = true
  const close = iconButton('×', '關閉分屏')
  header.append(title, sourceLink, close)
  const frame = document.createElement('iframe')
  frame.className = 'split-screen-frame'
  frame.title = '參考資料'
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  content.append(header, frame)
  panel.append(divider, content)
  ;(document.querySelector('#editor-shell') || document.body).append(panel)

  const dialog = createSourceDialog()
  let objectUrl = ''
  let currentWidth = Math.round(window.innerWidth / 2)

  const setWidth = width => {
    const max = Math.max(280, window.innerWidth - 320)
    currentWidth = Math.min(max, Math.max(280, Number(width) || window.innerWidth / 2))
    document.body.style.setProperty('--split-panel-width', `${currentWidth}px`)
    divider.setAttribute('aria-valuemin', '280')
    divider.setAttribute('aria-valuemax', String(max))
    divider.setAttribute('aria-valuenow', String(Math.round(currentWidth)))
    window.dispatchEvent(new Event('resize'))
  }

  const revokeObjectUrl = () => {
    if (!objectUrl) return
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }

  const show = ({ source, label, externalUrl = '', sandboxed = false }) => {
    // sandbox 只能套在外部網站上：本機 PDF 用的是 Chromium 內建 viewer，加了會壞掉。
    // 屬性必須在指定 src 之前設好，導覽當下才會套用。
    if (sandboxed) frame.setAttribute('sandbox', EXTERNAL_FRAME_SANDBOX)
    else frame.removeAttribute('sandbox')
    frame.src = source
    title.textContent = label
    sourceLink.href = externalUrl
    sourceLink.hidden = !externalUrl
    panel.hidden = false
    document.body.classList.add('is-split-screen')
    setWidth(currentWidth)
  }

  const hide = () => {
    panel.hidden = true
    document.body.classList.remove('is-split-screen')
    document.body.style.removeProperty('--split-panel-width')
    frame.removeAttribute('sandbox')
    frame.src = 'about:blank'
    revokeObjectUrl()
    window.dispatchEvent(new Event('resize'))
    document.querySelector('#more-button')?.focus()
  }

  const openUrl = value => {
    const url = normalizeSplitUrl(value)
    if (!url) return false
    revokeObjectUrl()
    show({ source: url, label: new URL(url).hostname, externalUrl: url, sandboxed: true })
    return true
  }

  const openPdf = file => {
    if (!isPdfFile(file)) return false
    revokeObjectUrl()
    objectUrl = URL.createObjectURL(file)
    show({ source: objectUrl, label: file.name || 'PDF 文件' })
    return true
  }

  dialog.form.addEventListener('submit', event => {
    event.preventDefault()
    const url = dialog.url.value.trim()
    const file = dialog.file.files?.[0]
    const opened = url ? openUrl(url) : openPdf(file)
    if (!opened) {
      dialog.error.textContent = url ? '請輸入有效的 HTTPS 網址（http 會自動升級）。' : '請選擇 PDF 文件或輸入網址。'
      return
    }
    dialog.element.close('open')
  })
  dialog.cancel.addEventListener('click', () => dialog.element.close('cancel'))
  dialog.url.addEventListener('input', () => {
    if (dialog.url.value.trim()) dialog.file.value = ''
    dialog.error.textContent = ''
  })
  dialog.file.addEventListener('change', () => {
    if (dialog.file.files?.length) dialog.url.value = ''
    dialog.error.textContent = isPdfFile(dialog.file.files?.[0]) ? '' : '只接受 PDF 文件。'
  })
  close.addEventListener('click', hide)

  divider.addEventListener('pointerdown', event => {
    event.preventDefault()
    divider.setPointerCapture?.(event.pointerId)
    const move = moveEvent => setWidth(window.innerWidth - moveEvent.clientX)
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  })
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    setWidth(currentWidth + (event.key === 'ArrowLeft' ? 20 : -20))
  })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || panel.hidden || dialog.element.open) return
    event.preventDefault()
    hide()
  }, { capture: true })

  return {
    openDialog() {
      dialog.form.reset()
      dialog.error.textContent = ''
      if (!dialog.element.open) dialog.element.showModal()
      queueMicrotask(() => dialog.url.focus())
    },
    openUrl,
    openPdf,
    close: hide,
    setWidth,
    get isOpen() {
      return !panel.hidden
    }
  }
}

function createSourceDialog() {
  const element = document.createElement('dialog')
  element.className = 'phasec-dialog split-source-dialog'
  element.setAttribute('aria-labelledby', 'split-source-title')
  const form = document.createElement('form')
  form.method = 'dialog'

  const header = document.createElement('header')
  const heading = document.createElement('div')
  const eyebrow = document.createElement('span')
  eyebrow.className = 'phasec-eyebrow'
  eyebrow.textContent = 'REFERENCE'
  const title = document.createElement('h2')
  title.id = 'split-source-title'
  title.textContent = '開啟分屏'
  heading.append(eyebrow, title)
  header.append(heading)

  const urlLabel = document.createElement('label')
  urlLabel.textContent = '網址'
  const url = document.createElement('input')
  url.type = 'url'
  url.inputMode = 'url'
  url.placeholder = 'https://example.com'
  urlLabel.append(url)

  const separator = document.createElement('div')
  separator.className = 'phasec-or-separator'
  separator.textContent = '或'

  const fileLabel = document.createElement('label')
  fileLabel.className = 'split-pdf-picker'
  fileLabel.textContent = '上傳 PDF'
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = '.pdf,application/pdf'
  fileLabel.append(file)

  const error = document.createElement('p')
  error.className = 'phasec-form-error'
  error.setAttribute('role', 'alert')

  const footer = document.createElement('footer')
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = '取消'
  const open = document.createElement('button')
  open.type = 'submit'
  open.className = 'phasec-primary-button'
  open.textContent = '開啟'
  footer.append(cancel, open)

  form.append(header, urlLabel, separator, fileLabel, error, footer)
  element.append(form)
  document.body.append(element)
  return { element, form, url, file, error, cancel }
}

function iconButton(label, ariaLabel) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'phasec-icon-button'
  button.textContent = label
  button.setAttribute('aria-label', ariaLabel)
  return button
}

function ensurePhaseCStyles() {
  if (document.querySelector('link[data-phasec-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/phasec.css'
  link.dataset.phasecStyles = 'true'
  document.head.append(link)
}
