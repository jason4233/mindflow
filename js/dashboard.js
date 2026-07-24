/** 首頁文件庫：視圖切換、卡片操作、全文搜尋與範本建立。 */
import {
  createDocument,
  createDocumentThumbnail,
  deleteDocument,
  duplicateDocument,
  listDocuments,
  listTrashedDocuments,
  loadDocument,
  permanentlyDeleteDocument,
  renameDocument,
  restoreDocument,
  toggleFavorite
} from './store.js'
import { searchDocuments } from './search.js'
import {
  createDocumentFromTemplate,
  MIND_FLOW_TEMPLATES,
  TEMPLATE_CATEGORIES
} from './templates.js'
import { createId } from './editor/model.js'
import {
  importDocumentJson,
  importDocumentMarkdown,
  importDocumentTxt
} from './io/import.js'

const elements = {
  heading: document.querySelector('#view-heading'),
  eyebrow: document.querySelector('#view-eyebrow'),
  description: document.querySelector('#view-description'),
  count: document.querySelector('#view-count'),
  documentGrid: document.querySelector('#document-grid'),
  documentsView: document.querySelector('#documents-view'),
  templatesView: document.querySelector('#templates-view'),
  templateCategories: document.querySelector('#template-categories'),
  templateGrid: document.querySelector('#template-grid'),
  emptyState: document.querySelector('#empty-state'),
  emptyTitle: document.querySelector('#empty-state-title'),
  emptyText: document.querySelector('#empty-state-text'),
  emptyAction: document.querySelector('#empty-state-action'),
  search: document.querySelector('#global-search-input'),
  clearSearch: document.querySelector('#clear-search'),
  favoritesCount: document.querySelector('#favorites-count'),
  trashCount: document.querySelector('#trash-count'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  confirmMessage: document.querySelector('#confirm-dialog-message'),
  toast: document.querySelector('#dashboard-toast')
}

const viewCopy = {
  recent: ['你的工作空間', '最近編輯', '快速接續最近的思考。'],
  documents: ['個人文件庫', '我的心智圖', '所有想法都在這裡，依最近更新排序。'],
  favorites: ['個人文件庫', '我的收藏', '把最常使用的心智圖放在手邊。'],
  trash: ['文件管理', '資源回收筒', '可還原文件，或永久清除不再需要的內容。'],
  templates: ['靈感起點', '範本庫', '8 類原創繁中範本，選一張立即開始。']
}

const state = {
  view: 'recent',
  categoryId: 'all',
  query: '',
  pendingDeleteId: null,
  toastTimer: null,
  searchTimer: null
}

const previewCache = new Map()

ensurePhaseCStyles()
initializeImportEntry()
bindEvents()
render()

function bindEvents() {
  document.querySelector('#create-document').addEventListener('click', createBlankDocument)
  elements.emptyAction.addEventListener('click', createBlankDocument)
  document.querySelector('#settings-button').addEventListener('click', () => showToast('設定功能正在準備中。'))

  document.querySelectorAll('[data-view-target]').forEach(button => {
    button.addEventListener('click', () => {
      state.view = button.dataset.viewTarget
      state.query = ''
      elements.search.value = ''
      elements.clearSearch.hidden = true
      render()
      document.querySelector('#main-content').focus({ preventScroll: true })
    })
  })

  elements.search.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer)
    state.query = elements.search.value.trim()
    elements.clearSearch.hidden = !state.query
    state.searchTimer = window.setTimeout(render, 140)
  })
  elements.search.addEventListener('keydown', event => {
    if (event.key === 'Escape' && elements.search.value) clearSearch()
  })
  elements.clearSearch.addEventListener('click', clearSearch)

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      elements.search.focus()
      elements.search.select()
    }
  })
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.card-menu')) closeCardMenus()
  })

  elements.confirmDialog.addEventListener('close', () => {
    if (elements.confirmDialog.returnValue === 'confirm' && state.pendingDeleteId) {
      const removed = permanentlyDeleteDocument(state.pendingDeleteId)
      state.pendingDeleteId = null
      if (removed) showToast('文件已永久刪除。')
      render()
    } else {
      state.pendingDeleteId = null
    }
  })
}

function render() {
  updateNavigationCounts()
  updateActiveNavigation()
  if (state.query) {
    renderSearchResults()
    return
  }
  if (state.view === 'templates') {
    renderTemplates()
    return
  }
  renderDocumentView()
}

function renderDocumentView() {
  setViewCopy(state.view)
  elements.documentsView.hidden = false
  elements.templatesView.hidden = true

  const documents = state.view === 'trash'
    ? listTrashedDocuments()
    : listDocuments({ favoritesOnly: state.view === 'favorites' })
  const visibleDocuments = state.view === 'recent' ? documents.slice(0, 12) : documents
  const cards = visibleDocuments.map(meta => createDocumentCard(meta, state.view === 'trash'))
  if (state.view === 'documents' || state.view === 'recent') cards.unshift(createNewDocumentCard())
  elements.documentGrid.className = 'document-grid'
  elements.documentGrid.replaceChildren(...cards)
  elements.count.textContent = `${visibleDocuments.length} 份文件`

  const isEmpty = visibleDocuments.length === 0 && state.view !== 'documents' && state.view !== 'recent'
  elements.emptyState.hidden = !isEmpty
  elements.documentGrid.hidden = isEmpty
  if (isEmpty) setEmptyCopy(state.view)
}

function renderSearchResults() {
  const results = searchDocuments(state.query)
  elements.documentsView.hidden = false
  elements.templatesView.hidden = true
  elements.heading.textContent = `「${state.query}」的搜尋結果`
  elements.eyebrow.textContent = '跨文件全文檢索'
  elements.description.textContent = '同時搜尋文件標題與所有節點文字。'
  elements.count.textContent = `${results.length} 份文件`
  elements.documentGrid.className = 'search-results'
  elements.documentGrid.replaceChildren(...results.map(createSearchResult))
  elements.documentGrid.hidden = results.length === 0
  elements.emptyState.hidden = results.length !== 0
  if (results.length === 0) {
    elements.emptyTitle.textContent = '找不到符合內容'
    elements.emptyText.textContent = '換個關鍵字，或縮短搜尋詞再試一次。'
    elements.emptyAction.hidden = true
  }
}

function renderTemplates() {
  setViewCopy('templates')
  elements.documentsView.hidden = true
  elements.templatesView.hidden = false
  renderTemplateCategories()
  const selected = state.categoryId === 'all'
    ? MIND_FLOW_TEMPLATES
    : MIND_FLOW_TEMPLATES.filter(item => item.categoryId === state.categoryId)
  elements.templateGrid.replaceChildren(...selected.map(createTemplateCard))
  elements.count.textContent = `${selected.length} 個範本`
}

function renderTemplateCategories() {
  const categories = [{ id: 'all', name: '全部範本' }, ...TEMPLATE_CATEGORIES]
  elements.templateCategories.replaceChildren(...categories.map(category => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = category.name
    button.setAttribute('aria-pressed', String(state.categoryId === category.id))
    button.addEventListener('click', () => {
      state.categoryId = category.id
      renderTemplates()
    })
    return button
  }))
}

function createNewDocumentCard() {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'new-document-card'
  button.setAttribute('aria-label', '新增空白心智圖')
  button.append(createIcon('plus'), document.createTextNode('新增空白心智圖'))
  button.addEventListener('click', createBlankDocument)
  return button
}

function createDocumentCard(meta, inTrash = false) {
  const card = document.createElement('article')
  card.className = 'document-card'
  card.dataset.documentId = meta.id

  const preview = document.createElement('div')
  preview.className = 'document-card__preview'
  preview.append(createThumbnailImage(resolveDocumentThumbnail(meta), `${meta.title} 心智圖縮圖`))

  if (!inTrash) preview.append(createFavoriteButton(meta))

  const body = document.createElement('div')
  body.className = 'document-card__body'
  const titleRow = document.createElement('div')
  titleRow.className = 'document-card__title-row'
  const title = document.createElement('h2')
  title.className = 'document-card__title'
  if (inTrash) {
    // 回收筒只允許還原或永久刪除，避免直接開啟後存檔造成狀態含糊。
    title.textContent = meta.title
    title.title = meta.title
  } else {
    const titleButton = document.createElement('button')
    titleButton.type = 'button'
    titleButton.className = 'document-title-button'
    titleButton.textContent = meta.title
    titleButton.title = `開啟「${meta.title}」`
    titleButton.addEventListener('click', () => openDocument(meta.id))
    title.append(titleButton)
  }
  titleRow.append(title)

  if (inTrash) {
    const spacer = document.createElement('span')
    spacer.setAttribute('aria-hidden', 'true')
    titleRow.append(spacer)
  } else {
    titleRow.append(createCardMenu(meta, card, title))
    card.addEventListener('contextmenu', event => {
      if (event.target.closest('button, input, summary')) return
      event.preventDefault()
      closeCardMenus()
      card.querySelector('.card-menu').open = true
    })
  }

  const time = document.createElement('p')
  time.className = 'document-card__time'
  time.textContent = inTrash
    ? `刪除於 ${formatDateTime(meta.deletedAt)}`
    : `更新於 ${formatDateTime(meta.updatedAt)}`
  body.append(titleRow, time)

  if (inTrash) body.append(createTrashActions(meta))
  card.append(preview, body)
  return card
}

function createFavoriteButton(meta) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'favorite-toggle'
  button.setAttribute('aria-pressed', String(meta.favorite))
  button.setAttribute('aria-label', meta.favorite ? `取消收藏「${meta.title}」` : `收藏「${meta.title}」`)
  button.append(createIcon('star'))
  button.addEventListener('click', () => {
    const favorite = toggleFavorite(meta.id)
    showToast(favorite ? '已加入收藏。' : '已從收藏移除。')
    render()
  })
  return button
}

function createCardMenu(meta, card, titleContainer) {
  const details = document.createElement('details')
  details.className = 'card-menu'
  const summary = document.createElement('summary')
  summary.setAttribute('aria-label', `${meta.title} 更多操作`)
  summary.append(createIcon('more'))
  const popover = document.createElement('div')
  popover.className = 'card-menu__popover'
  popover.append(
    menuButton('開啟', () => openDocument(meta.id)),
    menuButton('重新命名', () => beginInlineRename(meta, card, titleContainer, details)),
    menuButton('建立副本', () => {
      const copy = duplicateDocument(meta.id)
      if (copy) showToast('已建立文件副本。')
      render()
    }),
    menuButton(meta.favorite ? '取消收藏' : '加入收藏', () => {
      toggleFavorite(meta.id)
      render()
    }),
    menuButton('移到回收筒', () => {
      if (deleteDocument(meta.id)) showToast('文件已移到回收筒。')
      render()
    }, 'danger-menu-item')
  )
  details.append(summary, popover)
  return details
}

function createTrashActions(meta) {
  const actions = document.createElement('div')
  actions.className = 'trash-actions'
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.textContent = '還原'
  restore.addEventListener('click', () => {
    if (restoreDocument(meta.id)) showToast('文件已還原。')
    render()
  })
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'permanent-delete'
  remove.textContent = '永久刪除'
  remove.addEventListener('click', () => confirmPermanentDelete(meta))
  actions.append(restore, remove)
  return actions
}

function createTemplateCard(template) {
  const card = document.createElement('article')
  card.className = 'template-card'
  const preview = document.createElement('div')
  preview.className = 'template-card__preview'
  let thumbnail = previewCache.get(template.id)
  if (!thumbnail) {
    thumbnail = createDocumentThumbnail(createDocumentFromTemplate(template.id))
    previewCache.set(template.id, thumbnail)
  }
  preview.append(createThumbnailImage(thumbnail, `${template.title}範本預覽`))

  const body = document.createElement('div')
  body.className = 'template-card__body'
  const category = document.createElement('span')
  category.className = 'template-card__category'
  category.textContent = TEMPLATE_CATEGORIES.find(item => item.id === template.categoryId)?.name || '範本'
  const title = document.createElement('h2')
  title.className = 'template-card__title'
  title.textContent = template.title
  const description = document.createElement('p')
  description.className = 'template-card__description'
  description.textContent = template.description
  const use = document.createElement('button')
  use.type = 'button'
  use.className = 'template-use-button'
  use.textContent = '使用此範本'
  use.addEventListener('click', () => {
    const source = createDocumentFromTemplate(template.id)
    const doc = createDocument(source)
    openDocument(doc.id)
  })
  body.append(category, title, description, use)
  card.append(preview, body)
  return card
}

function createSearchResult(result) {
  const card = document.createElement('article')
  card.className = 'search-result'
  const preview = document.createElement('div')
  preview.className = 'search-result__preview'
  preview.append(createThumbnailImage(resolveDocumentThumbnail({
    id: result.documentId,
    thumbnail: result.thumbnail
  }), `${result.title}縮圖`))
  const body = document.createElement('div')
  const header = document.createElement('div')
  header.className = 'search-result__header'
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'search-result__open'
  open.textContent = result.title
  open.addEventListener('click', () => openDocument(result.documentId))
  header.append(open)
  if (result.titleMatch) {
    const badge = document.createElement('span')
    badge.className = 'search-result__badge'
    badge.textContent = '標題命中'
    header.append(badge)
  }
  body.append(header)
  if (result.matches.length) {
    const list = document.createElement('ul')
    list.className = 'search-match-list'
    result.matches.forEach(match => {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = match.pathText
      button.title = match.pathText
      button.addEventListener('click', () => openDocument(result.documentId, match.nodeId))
      item.append(button)
      list.append(item)
    })
    body.append(list)
  }
  card.append(preview, body)
  return card
}

function menuButton(label, handler, className = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', handler)
  return button
}

function beginInlineRename(meta, card, titleContainer, details) {
  details.open = false
  const previous = titleContainer.firstElementChild
  const input = document.createElement('input')
  input.className = 'inline-rename'
  input.value = meta.title
  input.setAttribute('aria-label', `重新命名「${meta.title}」`)
  titleContainer.replaceChildren(input)
  input.focus()
  input.select()
  let settled = false
  const finish = commit => {
    if (settled) return
    settled = true
    const nextTitle = input.value.trim()
    if (commit && nextTitle && nextTitle !== meta.title) renameDocument(meta.id, nextTitle)
    render()
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
  card.scrollIntoView({ block: 'nearest' })
  void previous
}

function confirmPermanentDelete(meta) {
  state.pendingDeleteId = meta.id
  elements.confirmMessage.textContent = `「${meta.title}」與其中所有節點將永久刪除，此操作無法復原。`
  if (typeof elements.confirmDialog.showModal === 'function') {
    elements.confirmDialog.showModal()
  } else if (window.confirm(elements.confirmMessage.textContent)) {
    permanentlyDeleteDocument(meta.id)
    state.pendingDeleteId = null
    render()
  }
}

function clearSearch() {
  state.query = ''
  elements.search.value = ''
  elements.clearSearch.hidden = true
  elements.search.focus()
  render()
}

function createBlankDocument() {
  const doc = createDocument()
  openDocument(doc.id)
}

function initializeImportEntry() {
  const createButton = document.querySelector('#create-document')
  if (!createButton || document.querySelector('[data-dashboard-import]')) return

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sidebar-import'
  button.dataset.dashboardImport = 'true'
  button.append(createIcon('upload'), document.createTextNode('匯入'))

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.mindflow,.json,.txt,.md,application/json,text/plain,text/markdown'
  input.hidden = true
  input.setAttribute('aria-hidden', 'true')
  button.addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const source = await file.text()
      const imported = parseDashboardImport(file.name, source)
      const now = new Date().toISOString()
      // 匯入永遠建立新文件，避免相同 doc id 無提示覆蓋現有內容。
      imported.id = createId('doc')
      imported.createdAt = now
      imported.updatedAt = now
      const doc = createDocument(imported)
      openDocument(doc.id)
    } catch (error) {
      console.error('MindFlow 匯入失敗', error)
      showToast('匯入失敗，請確認檔案格式與內容。')
    }
  })

  createButton.insertAdjacentElement('afterend', button)
  document.body.append(input)
}

export function parseDashboardImport(filename, source) {
  const name = String(filename || '').trim()
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  if (extension === '.mindflow' || extension === '.json') return importDocumentJson(source)
  if (extension === '.txt') return importDocumentTxt(source)
  if (extension === '.md') return importDocumentMarkdown(source)
  throw new TypeError('只支援 .mindflow、.json、.txt、.md')
}

function openDocument(id, nodeId = '') {
  const params = new URLSearchParams({ id })
  if (nodeId) params.set('focus', nodeId)
  window.location.href = `editor.html?${params}`
}

function setViewCopy(view) {
  const [eyebrow, heading, description] = viewCopy[view] || viewCopy.recent
  elements.eyebrow.textContent = eyebrow
  elements.heading.textContent = heading
  elements.description.textContent = description
  elements.emptyAction.hidden = false
}

function setEmptyCopy(view) {
  if (view === 'favorites') {
    elements.emptyTitle.textContent = '還沒有收藏'
    elements.emptyText.textContent = '在文件卡片上點擊星號，就能快速收進這裡。'
    elements.emptyAction.hidden = true
  } else if (view === 'trash') {
    elements.emptyTitle.textContent = '回收筒是空的'
    elements.emptyText.textContent = '移除的文件會保留在這裡，直到你永久刪除。'
    elements.emptyAction.hidden = true
  }
}

function updateNavigationCounts() {
  elements.favoritesCount.textContent = String(listDocuments({ favoritesOnly: true }).length)
  elements.trashCount.textContent = String(listTrashedDocuments().length)
}

function updateActiveNavigation() {
  document.querySelectorAll('[data-view-target]').forEach(button => {
    if (button.closest('.sidebar-nav')) {
      if (!state.query && button.dataset.viewTarget === state.view) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
  })
}

function createThumbnailImage(svg, alt) {
  const image = document.createElement('img')
  image.alt = alt
  image.width = 360
  image.height = 202
  const safeSvg = typeof svg === 'string' && svg.trim().startsWith('<svg')
    ? svg
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 202"><rect width="360" height="202" rx="16" fill="#fbfaf8"/><path d="M90 101h180" stroke="#e6ddd6" stroke-width="3"/><circle cx="180" cy="101" r="28" fill="#f17e2e" opacity=".9"/></svg>'
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`
  return image
}

function resolveDocumentThumbnail(meta) {
  if (typeof meta.thumbnail === 'string' && meta.thumbnail.trim().startsWith('<svg')) return meta.thumbnail
  const doc = loadDocument(meta.id)
  return doc ? createDocumentThumbnail(doc) : ''
}

function createIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5"/>'
  }
  svg.innerHTML = paths[name] || paths.plus
  return svg
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知時間'
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `今天 ${new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit' }).format(date)}`
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function closeCardMenus() {
  document.querySelectorAll('.card-menu[open]').forEach(menu => { menu.open = false })
}

function showToast(message) {
  window.clearTimeout(state.toastTimer)
  elements.toast.textContent = message
  elements.toast.hidden = false
  state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true }, 3200)
}

function ensurePhaseCStyles() {
  if (document.querySelector('link[data-phasec-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/phasec.css'
  link.dataset.phasecStyles = 'true'
  document.head.append(link)
}
