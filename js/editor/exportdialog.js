/**
 * 六格式匯出彈窗；純資料產生交給 io/export，這裡只處理瀏覽器下載與列印管道。
 */
import { registerAction } from './actions.js'
import {
  documentToSvg,
  exportDocumentJson,
  exportDocumentTxt,
  exportDocumentWord
} from '../io/export.js'

export const EXPORT_FORMATS = Object.freeze([
  { id: 'jpg', label: 'JPG', detail: '通用圖片', icon: 'JPG' },
  { id: 'png', label: 'PNG', detail: '支援透明背景', icon: 'PNG' },
  { id: 'pdf', label: 'PDF', detail: '列印與簡報', icon: 'PDF' },
  { id: 'word', label: 'WORD', detail: '大綱文件', icon: 'W' },
  { id: 'txt', label: 'TXT', detail: '縮排大綱', icon: 'TXT' },
  { id: 'mindflow', label: 'MINDFLOW', detail: '原生可編輯檔', icon: 'MF' }
])

export function initializeExportDialog({ doc }) {
  const existing = document.querySelector('[data-export-dialog]')
  if (existing) {
    registerAction('openExport', () => openDialog(existing))
    return existing
  }

  const dialog = document.createElement('dialog')
  dialog.className = 'export-dialog'
  dialog.dataset.exportDialog = 'true'
  dialog.innerHTML = `
    <form method="dialog" class="export-dialog__surface">
      <header>
        <div><small>匯出文件</small><h2>選擇匯出格式</h2></div>
        <button type="button" class="export-dialog__close" data-export-close aria-label="關閉">×</button>
      </header>
      <div class="export-format-grid" role="radiogroup" aria-label="匯出格式">
        ${EXPORT_FORMATS.map((format, index) => `
          <button type="button" class="export-format-card${index === 0 ? ' is-active' : ''}"
            data-export-format="${format.id}" role="radio" aria-checked="${index === 0}">
            <span class="export-format-card__icon">${format.icon}</span>
            <strong>${format.label}</strong><small>${format.detail}</small>
          </button>`).join('')}
      </div>
      <section class="export-options" aria-label="匯出設定">
        <label class="export-toggle"><input type="checkbox" data-export-hd checked><span>HD 高畫質</span></label>
        <label><span>邊距</span><input type="number" data-export-margin min="0" max="2000" step="10" value="80"><small>px</small></label>
        <label><span>渲染比例</span><input type="number" data-export-scale min="100" max="400" step="25" value="200"><small>%</small></label>
        <label class="export-toggle"><input type="checkbox" data-export-transparent disabled><span>PNG 透明背景</span></label>
      </section>
      <p class="export-dialog__status" data-export-status aria-live="polite"></p>
      <footer>
        <button type="button" data-export-close>取消</button>
        <button type="button" class="is-primary" data-export-submit>匯出</button>
      </footer>
    </form>`
  document.body.append(dialog)

  let format = 'jpg'
  const cards = Array.from(dialog.querySelectorAll('[data-export-format]'))
  const transparent = dialog.querySelector('[data-export-transparent]')
  const submit = dialog.querySelector('[data-export-submit]')
  const status = dialog.querySelector('[data-export-status]')

  const selectFormat = next => {
    format = next
    cards.forEach(card => {
      const active = card.dataset.exportFormat === format
      card.classList.toggle('is-active', active)
      card.setAttribute('aria-checked', String(active))
    })
    transparent.disabled = format !== 'png'
    if (transparent.disabled) transparent.checked = false
  }
  cards.forEach(card => card.addEventListener('click', () => selectFormat(card.dataset.exportFormat)))
  dialog.querySelectorAll('[data-export-close]').forEach(button => button.addEventListener('click', () => dialog.close()))
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    dialog.close()
  })
  dialog.addEventListener('cancel', event => {
    event.preventDefault()
    dialog.close()
  })
  dialog.querySelector('[data-export-hd]').addEventListener('change', event => {
    dialog.querySelector('[data-export-margin]').disabled = !event.target.checked
    dialog.querySelector('[data-export-scale]').disabled = !event.target.checked
  })
  submit.addEventListener('click', async () => {
    submit.disabled = true
    status.textContent = '正在產生檔案…'
    try {
      await exportSelectedFormat(doc, format, {
        hd: dialog.querySelector('[data-export-hd]').checked,
        margin: Number(dialog.querySelector('[data-export-margin]').value),
        scale: Number(dialog.querySelector('[data-export-scale]').value) / 100,
        transparent: transparent.checked
      })
      status.textContent = format === 'pdf' ? '已開啟列印視窗' : '檔案已開始下載'
    } catch (error) {
      console.error(error)
      status.textContent = `匯出失敗：${error?.message || '無法產生檔案'}`
    } finally {
      submit.disabled = false
    }
  })

  registerAction('openExport', () => openDialog(dialog))
  return dialog
}

export async function exportSelectedFormat(doc, format, options = {}) {
  const filename = safeFilename(doc?.title || doc?.root?.text || 'MindFlow')
  if (format === 'word') {
    downloadBlob(new Blob([`\ufeff${exportDocumentWord(doc)}`], { type: 'application/msword;charset=utf-8' }), `${filename}.doc`)
    return true
  }
  if (format === 'txt') {
    downloadBlob(new Blob([`\ufeff${exportDocumentTxt(doc)}`], { type: 'text/plain;charset=utf-8' }), `${filename}.txt`)
    return true
  }
  if (format === 'mindflow') {
    downloadBlob(new Blob([exportDocumentJson(doc, { space: 2 })], { type: 'application/json;charset=utf-8' }), `${filename}.mindflow`)
    return true
  }

  const margin = options.hd === false ? 24 : clamp(options.margin, 0, 2000, 80)
  const scale = options.hd === false ? 1 : clamp(options.scale, 1, 4, 2)
  const svg = documentToSvg(doc, {
    margin,
    transparent: format === 'png' && Boolean(options.transparent)
  })
  if (format === 'pdf') {
    openPrintWindow(svg, filename)
    return true
  }
  if (format !== 'png' && format !== 'jpg') throw new TypeError(`不支援的匯出格式：${format}`)
  const blob = await svgToRasterBlob(svg, {
    type: format === 'png' ? 'image/png' : 'image/jpeg',
    scale,
    background: format === 'jpg' ? '#ffffff' : null
  })
  downloadBlob(blob, `${filename}.${format}`)
  return true
}

export async function svgToRasterBlob(svg, { type = 'image/png', scale = 2, background = null } = {}) {
  const dimensions = readSvgDimensions(svg)
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(source)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(dimensions.width * scale))
    canvas.height = Math.max(1, Math.round(dimensions.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('瀏覽器不支援 Canvas 2D')
    context.scale(scale, scale)
    if (background) {
      context.fillStyle = background
      context.fillRect(0, 0, dimensions.width, dimensions.height)
    }
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    return await canvasToBlob(canvas, type, type === 'image/jpeg' ? 0.94 : undefined)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function openDialog(dialog) {
  dialog.querySelector('[data-export-status]').textContent = ''
  if (!dialog.open) dialog.showModal()
  queueMicrotask(() => dialog.querySelector('[data-export-format].is-active')?.focus())
  return true
}

function openPrintWindow(svg, title) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('瀏覽器已阻擋列印視窗')
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  printWindow.document.open()
  printWindow.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:0}html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#fff}img{display:block;max-width:100%;height:auto}</style></head><body><img src="${escapeHtml(url)}" alt=""></body></html>`)
  printWindow.document.close()
  const image = printWindow.document.querySelector('img')
  image.addEventListener('load', () => {
    printWindow.focus()
    printWindow.print()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
  }, { once: true })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('SVG 無法轉成圖片'))
    image.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas 無法產生圖檔'))
    }, type, quality)
  })
}

function readSvgDimensions(svg) {
  const match = String(svg).match(/<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/iu)
  if (!match) throw new Error('SVG 缺少尺寸')
  return { width: Math.max(1, Number(match[1])), height: Math.max(1, Number(match[2])) }
}

function safeFilename(value) {
  const cleaned = String(value || 'MindFlow').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim()
  return (cleaned || 'MindFlow').slice(0, 100)
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}
