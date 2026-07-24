/**
 * DELTA 組裝入口，以及節點備註、連結、圖片的 command 與 DOM overlay。
 */
import { registerAction, runAction } from './actions.js'
import { findNode, structuredCloneSafe, walkNodes } from './model.js'
import { registerOverlay } from './render.js'
import { initializeRelations } from './relations.js'
import { initializeSummaries } from './summary.js'
import { initializeFloatingFeatures } from './floating.js'
import { initializeFindReplace } from './findreplace.js'
import { initializeIconPanel } from './iconpanel.js'
import { initializeShortcutHelp } from './shortcuthelp.js'

const ATTACHMENT_FIELDS = new Set(['notes', 'link', 'image', 'text', 'icons'])
const URL_PATTERN = /^(https?:\/\/|www\.)[^\s]+$/iu

export function updateNodeFieldsCommand(doc, nodeId, patch, description = '更新節點附加物') {
  const safePatch = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => ATTACHMENT_FIELDS.has(key)))
  let previous = null
  return {
    description,
    do: () => {
      const node = findNode(doc.root, nodeId)
      if (!node || Object.keys(safePatch).length === 0) return false
      if (!previous) previous = Object.fromEntries(Object.keys(safePatch).map(key => [key, structuredCloneSafe(node[key])]))
      let changed = false
      for (const [key, value] of Object.entries(safePatch)) {
        const next = structuredCloneSafe(value)
        if (JSON.stringify(node[key]) !== JSON.stringify(next)) changed = true
        node[key] = next
      }
      return changed
    },
    undo: () => {
      const node = findNode(doc.root, nodeId)
      if (!node || !previous) return
      Object.entries(previous).forEach(([key, value]) => { node[key] = structuredCloneSafe(value) })
    }
  }
}

export function normalizeUrl(value) {
  const input = String(value || '').trim()
  if (!input) return ''
  const candidate = /^www\./iu.test(input) ? `https://${input}` : input
  if (!/^https?:\/\//iu.test(candidate)) return ''
  try {
    const parsed = new URL(candidate)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

export function isLikelyUrl(value) {
  return URL_PATTERN.test(String(value || '').trim()) && Boolean(normalizeUrl(value))
}

export function readImageFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return Promise.reject(new TypeError('只接受圖片檔案'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('圖片讀取失敗'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('圖片格式無法解析'))
      image.onload = () => {
        const scale = Math.min(1, 240 / Math.max(1, image.naturalWidth), 160 / Math.max(1, image.naturalHeight))
        resolve({
          src: String(reader.result),
          w: Math.max(48, Math.round(image.naturalWidth * scale)),
          h: Math.max(36, Math.round(image.naturalHeight * scale))
        })
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export function initializeDelta(ctx) {
  ensureFeatureStyles()
  ctx.featureState = { selectedOverlay: null, formatPainter: null }
  ctx.featureHandlers = { escape: [] }
  ctx.notify = createNotifier()

  // 懸浮 overlay 必須先修正 positions，後續關聯線與概要才會使用自由座標。
  initializeFloatingFeatures(ctx)
  initializeRelations(ctx)
  initializeSummaries(ctx)
  initializeAttachments(ctx)
  initializeFindReplace(ctx)
  initializeIconPanel(ctx)
  initializeShortcutHelp(ctx)
}

export function initializeAttachments(ctx) {
  const noteDrawer = createNoteDrawer(ctx)
  const linkDialog = createLinkDialog(ctx)
  const insertMenu = createInsertMenu(ctx)
  const fileInput = createImageInput(ctx)

  registerOverlay(overlayCtx => decorateNodeAttachments(overlayCtx, ctx, noteDrawer, linkDialog))

  registerAction('insertNote', () => {
    const id = ctx.selection.primaryId
    if (!id) { ctx.notify('請先選取節點'); return false }
    noteDrawer.open(id)
    return true
  })
  registerAction('insertLink', () => {
    const id = ctx.selection.primaryId
    if (!id) { ctx.notify('請先選取節點'); return false }
    linkDialog.open(id)
    return true
  })
  registerAction('insertImage', () => {
    if (!ctx.selection.primaryId) { ctx.notify('請先選取節點'); return false }
    fileInput.click()
    return true
  })
  registerAction('removeLink', () => {
    const id = ctx.selection.primaryId
    const node = findNode(ctx.doc.root, id)
    return node?.link ? ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, id, { link: null }, '移除節點連結')) : false
  })
  registerAction('openInsertMenu', () => { insertMenu.toggle(); return true })
  registerAction('expandAll', () => ctx.manager.execute(setAllCollapsedCommand(ctx.doc, false)))
  registerAction('collapseAll', () => ctx.manager.execute(setAllCollapsedCommand(ctx.doc, true)))

  const insertButton = document.querySelector('#insert-button')
  insertButton?.addEventListener('click', event => {
    // 工具列原先直連圖片；capture 階段改成完整插入選單，避免同一次 click 又開檔案框。
    event.preventDefault()
    event.stopImmediatePropagation()
    insertMenu.toggle()
  }, { capture: true })

  ctx.elements.canvas.addEventListener('dragover', event => {
    if (Array.from(event.dataTransfer?.items || []).some(item => item.kind === 'file' && item.type.startsWith('image/'))) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  })
  ctx.elements.canvas.addEventListener('drop', event => {
    const file = Array.from(event.dataTransfer?.files || []).find(item => item.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const id = event.target.closest('.mind-node')?.dataset.nodeId || ctx.selection.primaryId
    if (id) attachImageFile(ctx, id, file)
  }, { capture: true })

  window.addEventListener('paste', event => {
    if (isEditableTarget(event.target)) return
    // 內部節點剪貼簿優先；成功後不再把系統剪貼簿文字誤當成節點連結。
    if (runAction('paste')) {
      event.preventDefault()
      return
    }
    const imageFile = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'))
    const id = ctx.selection.primaryId
    if (imageFile && id) {
      event.preventDefault()
      attachImageFile(ctx, id, imageFile)
      return
    }
    if (!id) return
    const text = event.clipboardData?.getData('text/plain')?.trim() || ''
    if (!isLikelyUrl(text)) return
    event.preventDefault()
    ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, id, { link: normalizeUrl(text) }, '貼上網址連結'))
    ctx.notify('已把網址附加到節點')
  })

  window.addEventListener('mindflow:contexttarget', event => {
    const id = event.detail?.nodeId
    if (id && findNode(ctx.doc.root, id)) ctx.selection.set([id])
  })

  ctx.featureHandlers.escape.push(() => {
    insertMenu.close()
    noteDrawer.close()
    linkDialog.close()
  })
}

export function setAllCollapsedCommand(doc, collapsed) {
  let records = null
  return {
    description: collapsed ? '全部收起' : '全部展開',
    do: () => {
      if (!records) {
        records = []
        walkNodes(doc.root, node => {
          if (node !== doc.root && node.children.length > 0 && node.collapsed !== collapsed) records.push({ id: node.id, previous: node.collapsed })
        })
      }
      if (records.length === 0) return false
      records.forEach(record => {
        const node = findNode(doc.root, record.id)
        if (node) node.collapsed = collapsed
      })
      return true
    },
    undo: () => records?.forEach(record => {
      const node = findNode(doc.root, record.id)
      if (node) node.collapsed = record.previous
    })
  }
}

function decorateNodeAttachments({ doc, positions, nodesLayer }, ctx, noteDrawer, linkDialog) {
  const selected = new Set(ctx.selection.getSelectedIds())
  for (const [id, position] of positions) {
    const node = findNode(doc.root, id)
    const element = nodesLayer.querySelector(`[data-node-id="${cssEscape(id)}"]`)
    if (!node || !element) continue

    if (node.image?.src) {
      element.classList.add('mind-node--has-image')
      const width = clamp(node.image.w, 48, 360, 180)
      const height = clamp(node.image.h, 36, 260, 110)
      element.style.width = `${Math.max(position.w, width + 16)}px`
      element.style.height = `${position.h + height + 10}px`
      const wrapper = document.createElement('span')
      wrapper.className = 'node-image'
      wrapper.style.width = `${width}px`
      wrapper.style.height = `${height}px`
      const image = document.createElement('img')
      image.src = node.image.src
      image.alt = ''
      image.draggable = false
      wrapper.append(image)
      if (selected.has(id)) {
        const handle = document.createElement('span')
        handle.className = 'node-image__resize'
        handle.title = '拖曳調整圖片大小'
        handle.addEventListener('pointerdown', event => beginImageResize(event, ctx, id, node.image, wrapper))
        wrapper.append(handle)
      }
      element.insertBefore(wrapper, element.querySelector('.mind-node__text'))
    }

    if (!node.notes && !node.link) continue
    const badges = document.createElement('span')
    badges.className = 'node-attachment-badges'
    if (node.notes) {
      const note = document.createElement('button')
      note.type = 'button'
      note.className = 'node-attachment-button'
      note.textContent = '📄'
      note.title = '編輯備註'
      note.setAttribute('aria-label', '編輯備註')
      note.addEventListener('pointerdown', event => event.stopPropagation())
      note.addEventListener('click', event => { event.stopPropagation(); ctx.selection.set([id]); noteDrawer.open(id) })
      badges.append(note)
    }
    if (node.link) {
      const link = document.createElement('a')
      link.className = 'node-attachment-button node-link'
      link.href = node.link
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = '↗'
      link.dataset.tooltip = node.link
      link.setAttribute('aria-label', `開啟連結 ${node.link}`)
      link.addEventListener('pointerdown', event => event.stopPropagation())
      link.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); ctx.selection.set([id]); linkDialog.open(id) })
      badges.append(link)
    }
    element.append(badges)
  }
}

function createNoteDrawer(ctx) {
  const drawer = document.createElement('aside')
  drawer.className = 'feature-drawer'
  drawer.hidden = true
  drawer.innerHTML = `
    <header><div><small>節點附加物</small><h2>備註</h2></div><button type="button" data-note-close aria-label="關閉">×</button></header>
    <textarea data-note-editor maxlength="10000" placeholder="輸入這個節點的備註…"></textarea>
    <footer><span data-note-count>0 / 10000</span><button type="button" data-note-save>儲存備註</button></footer>`
  document.body.append(drawer)
  const textarea = drawer.querySelector('[data-note-editor]')
  const count = drawer.querySelector('[data-note-count]')
  let nodeId = null
  const updateCount = () => { count.textContent = `${textarea.value.length} / 10000` }
  const save = () => {
    const node = findNode(ctx.doc.root, nodeId)
    if (!node) return false
    const value = textarea.value.trim() || null
    if (value === node.notes) return false
    return ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, nodeId, { notes: value }, '編輯節點備註'))
  }
  const close = () => { if (!drawer.hidden) save(); drawer.hidden = true }
  drawer.querySelector('[data-note-close]').addEventListener('click', close)
  drawer.querySelector('[data-note-save]').addEventListener('click', () => { save(); ctx.notify('備註已儲存') })
  textarea.addEventListener('input', updateCount)
  textarea.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save(); ctx.notify('備註已儲存') }
    if (event.key === 'Escape') { event.preventDefault(); close() }
  })
  return {
    open(id) {
      const node = findNode(ctx.doc.root, id)
      if (!node) return
      if (nodeId && nodeId !== id && !drawer.hidden) save()
      nodeId = id
      textarea.value = node.notes || ''
      updateCount()
      drawer.hidden = false
      textarea.focus()
    },
    close
  }
}

function createLinkDialog(ctx) {
  const dialog = document.createElement('dialog')
  dialog.className = 'feature-dialog'
  dialog.innerHTML = `
    <form method="dialog" data-link-form>
      <header><div><small>節點附加物</small><h2>插入連結</h2></div><button type="button" data-link-close aria-label="關閉">×</button></header>
      <label>網址<input name="url" type="text" inputmode="url" placeholder="https://example.com" required></label>
      <label>顯示文字<input name="label" type="text" maxlength="200" placeholder="保留空白則不改節點文字"></label>
      <p class="feature-form-error" data-link-error aria-live="polite"></p>
      <footer><button type="button" data-link-remove>移除連結</button><span></span><button type="button" data-link-cancel>取消</button><button type="submit" class="is-primary">套用</button></footer>
    </form>`
  document.body.append(dialog)
  const form = dialog.querySelector('[data-link-form]')
  const urlInput = form.elements.url
  const labelInput = form.elements.label
  const error = dialog.querySelector('[data-link-error]')
  let nodeId = null
  const close = () => { if (dialog.open) dialog.close() }
  dialog.querySelector('[data-link-close]').addEventListener('click', close)
  dialog.querySelector('[data-link-cancel]').addEventListener('click', close)
  dialog.querySelector('[data-link-remove]').addEventListener('click', () => {
    const node = findNode(ctx.doc.root, nodeId)
    if (node?.link) ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, nodeId, { link: null }, '移除節點連結'))
    close()
  })
  form.addEventListener('submit', event => {
    event.preventDefault()
    const url = normalizeUrl(urlInput.value)
    if (!url) { error.textContent = '請輸入 http 或 https 網址'; urlInput.focus(); return }
    const node = findNode(ctx.doc.root, nodeId)
    if (!node) { close(); return }
    const label = labelInput.value.trim()
    const patch = { link: url }
    if (label) patch.text = label
    if (ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, nodeId, patch, '插入節點連結'))) ctx.notify('連結已套用')
    close()
  })
  return {
    open(id) {
      const node = findNode(ctx.doc.root, id)
      if (!node) return
      nodeId = id
      urlInput.value = node.link || ''
      labelInput.value = ''
      error.textContent = ''
      if (!dialog.open) dialog.showModal()
      queueMicrotask(() => urlInput.focus())
    },
    close
  }
}

function createInsertMenu(ctx) {
  const menu = document.createElement('div')
  menu.className = 'feature-popover insert-menu'
  menu.hidden = true
  const items = [
    ['insertImage', '▧', '圖片', 'Alt+P'],
    ['insertLink', '↗', '連結', 'Ctrl+Alt+K'],
    ['insertNote', '📄', '備註', 'Ctrl+Alt+M'],
    ['formula', '∑', '公式', ''],
    ['comment', '◌', '評論', ''],
    ['openStickerPanel', '✿', '貼紙', '']
  ]
  menu.innerHTML = items.map(([action, icon, label, key]) => `<button type="button" data-insert-action="${action}"><span>${icon}</span><strong>${label}</strong><kbd>${key}</kbd></button>`).join('')
  document.body.append(menu)
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-insert-action]')
    if (!button) return
    const action = button.dataset.insertAction
    menu.hidden = true
    if (action === 'formula' || action === 'comment') ctx.notify(`${action === 'formula' ? '公式' : '評論'}將在後續版本接入`)
    else runAction(action)
  })
  document.addEventListener('pointerdown', event => {
    const insertButton = document.querySelector('#insert-button')
    if (!menu.hidden && !menu.contains(event.target) && event.target !== insertButton) menu.hidden = true
  })
  return {
    toggle() {
      const anchor = document.querySelector('#insert-button')?.getBoundingClientRect()
      if (!anchor) return
      menu.style.left = `${Math.max(8, anchor.left - 54)}px`
      menu.style.top = `${anchor.bottom + 8}px`
      menu.hidden = !menu.hidden
    },
    close() { menu.hidden = true }
  }
}

function createImageInput(ctx) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.hidden = true
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    const id = ctx.selection.primaryId
    if (file && id) attachImageFile(ctx, id, file)
    input.value = ''
  })
  document.body.append(input)
  return input
}

async function attachImageFile(ctx, nodeId, file) {
  try {
    const image = await readImageFile(file)
    if (ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, nodeId, { image }, '插入節點圖片'))) ctx.notify('圖片已嵌入節點')
  } catch (error) {
    console.error(error)
    ctx.notify('圖片讀取失敗')
  }
}

function beginImageResize(event, ctx, nodeId, original, wrapper) {
  event.preventDefault()
  event.stopPropagation()
  const pointerId = event.pointerId
  const start = ctx.viewport.screenToWorld(event.clientX, event.clientY)
  const ratio = Math.max(0.1, Number(original.w) / Math.max(1, Number(original.h)))
  let width = clamp(original.w, 48, 360, 180)
  let height = clamp(original.h, 36, 260, 110)
  const move = moveEvent => {
    if (moveEvent.pointerId !== pointerId) return
    const point = ctx.viewport.screenToWorld(moveEvent.clientX, moveEvent.clientY)
    width = Math.max(48, Math.min(360, Number(original.w) + point.x - start.x))
    height = Math.max(36, Math.min(260, width / ratio))
    wrapper.style.width = `${width}px`
    wrapper.style.height = `${height}px`
  }
  const end = endEvent => {
    if (endEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    ctx.manager.execute(updateNodeFieldsCommand(ctx.doc, nodeId, { image: { ...original, w: Math.round(width), h: Math.round(height) } }, '調整節點圖片大小'))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function createNotifier() {
  let timer = null
  let toast = document.querySelector('#feature-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'feature-toast'
    toast.className = 'feature-toast'
    toast.hidden = true
    document.body.append(toast)
  }
  return message => {
    window.clearTimeout(timer)
    toast.textContent = String(message || '')
    toast.hidden = false
    timer = window.setTimeout(() => { toast.hidden = true }, 2200)
  }
}

function ensureFeatureStyles() {
  if (document.querySelector('link[data-delta-features]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/features.css'
  link.dataset.deltaFeatures = 'true'
  document.head.append(link)
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName)) return true
  // Chromium 在非文字焦點下可能把 native paste 的 target 指向 canvas 內最後一次文字選取
  // 所在的 button（例如概要標籤）；這種情況仍應貼到目前節點。畫布外按鈕則保持原生行為。
  return /^(BUTTON)$/u.test(target.tagName) && !target.closest('#canvas')
}
function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
