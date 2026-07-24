/**
 * 文件歷史版本：顯示 localStorage 快照、唯讀預覽，並以 command 可逆還原。
 */
import {
  createDocumentSnapshot,
  createDocumentThumbnail,
  listDocumentSnapshots
} from '../store.js'
import { registerAction } from './actions.js'
import { structuredCloneSafe } from './model.js'

export function createRestoreSnapshotCommand(doc, snapshotDocument) {
  const next = structuredCloneSafe(snapshotDocument)
  next.id = doc.id
  let previous = null

  return {
    description: '還原歷史版本',
    affectedIds: [doc.root.id, next.root?.id].filter(Boolean),
    do: () => {
      if (!next.root || JSON.stringify(doc) === JSON.stringify(next)) return false
      if (!previous) previous = structuredCloneSafe(doc)
      replaceDocument(doc, next)
      return true
    },
    undo: () => {
      if (previous) replaceDocument(doc, previous)
    }
  }
}

export function initHistory(ctx) {
  ensurePhaseCStyles()
  const panel = createHistoryPanel(ctx)
  registerAction('history', () => {
    panel.toggle()
    return true
  })
  return panel
}

function createHistoryPanel(ctx) {
  const panel = document.createElement('section')
  panel.className = 'phasec-drawer history-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-labelledby', 'history-panel-title')

  const header = document.createElement('header')
  const heading = document.createElement('div')
  const eyebrow = document.createElement('span')
  eyebrow.className = 'phasec-eyebrow'
  eyebrow.textContent = 'VERSION HISTORY'
  const title = document.createElement('h2')
  title.id = 'history-panel-title'
  title.textContent = '歷史版本'
  heading.append(eyebrow, title)
  const close = iconButton('×', '關閉歷史版本')
  header.append(heading, close)

  const body = document.createElement('div')
  body.className = 'history-panel__body'
  const list = document.createElement('div')
  list.className = 'history-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', '版本時間點')

  const preview = document.createElement('div')
  preview.className = 'history-preview'
  const previewImage = document.createElement('img')
  previewImage.alt = '歷史版本唯讀預覽'
  previewImage.width = 360
  previewImage.height = 202
  const previewMeta = document.createElement('p')
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.className = 'phasec-primary-button'
  restore.textContent = '還原此版本'
  preview.append(previewImage, previewMeta, restore)
  body.append(list, preview)
  panel.append(header, body)
  document.body.append(panel)

  let snapshots = []
  let selectedId = null

  const select = id => {
    const snapshot = snapshots.find(item => item.id === id)
    if (!snapshot) return
    selectedId = id
    for (const button of list.querySelectorAll('[data-snapshot-id]')) {
      const selected = button.dataset.snapshotId === id
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-selected', String(selected))
    }
    const svg = createDocumentThumbnail(snapshot.document)
    previewImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    previewMeta.textContent = `${formatDateTime(snapshot.createdAt)} · ${snapshot.nodeCount} 個節點`
    restore.disabled = false
  }

  const refresh = () => {
    snapshots = listDocumentSnapshots(ctx.doc.id)
    list.replaceChildren()
    if (snapshots.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'phasec-empty'
      empty.textContent = '尚無歷史快照。文件持續編輯後會自動建立版本。'
      list.append(empty)
      selectedId = null
      previewImage.removeAttribute('src')
      previewMeta.textContent = ''
      restore.disabled = true
      return
    }

    const fragment = document.createDocumentFragment()
    for (const snapshot of snapshots) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'history-list__item'
      button.dataset.snapshotId = snapshot.id
      button.setAttribute('role', 'option')
      const time = document.createElement('strong')
      time.textContent = formatDateTime(snapshot.createdAt)
      const count = document.createElement('span')
      count.textContent = `${snapshot.nodeCount} 個節點`
      button.append(time, count)
      button.addEventListener('click', () => select(snapshot.id))
      fragment.append(button)
    }
    list.append(fragment)
    select(snapshots.some(item => item.id === selectedId) ? selectedId : snapshots[0].id)
  }

  const hide = () => {
    panel.hidden = true
    document.querySelector('#more-button')?.focus()
  }

  close.addEventListener('click', hide)
  restore.addEventListener('click', () => {
    const snapshot = snapshots.find(item => item.id === selectedId)
    if (!snapshot) return
    // 還原前再留一份目前狀態；即使命令歷史日後被清掉，仍有保險版本可回復。
    createDocumentSnapshot(ctx.doc)
    const restored = ctx.manager.execute(createRestoreSnapshotCommand(ctx.doc, snapshot.document))
    if (restored) {
      ctx.selection.set([ctx.doc.root.id])
      ctx.notify?.('已還原歷史版本，可使用 Ctrl+Z 復原')
      refresh()
    }
  })
  document.addEventListener('keydown', event => {
    if (!panel.hidden && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hide()
    }
  }, { capture: true })

  return {
    open() {
      refresh()
      panel.hidden = false
      close.focus()
    },
    close: hide,
    toggle() {
      if (panel.hidden) this.open()
      else hide()
    },
    refresh
  }
}

function replaceDocument(target, source) {
  const replacement = structuredCloneSafe(source)
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, replacement)
}

function iconButton(label, ariaLabel) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'phasec-icon-button'
  button.textContent = label
  button.setAttribute('aria-label', ariaLabel)
  return button
}

function formatDateTime(value) {
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function ensurePhaseCStyles() {
  if (document.querySelector('link[data-phasec-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/phasec.css'
  link.dataset.phasecStyles = 'true'
  document.head.append(link)
}
