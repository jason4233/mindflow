/**
 * 首頁文件列表、新建、開啟、重新命名與刪除流程。
 */
import { strings, formatString } from './strings.js'
import { createDocument, deleteDocument, listDocuments, renameDocument } from './store.js'

const grid = document.querySelector('#document-grid')
const emptyState = document.querySelector('#empty-state')

document.querySelector('#product-name').textContent = strings.productName
document.querySelector('#documents-heading').textContent = strings.dashboard.myDocuments
document.querySelector('#empty-state-text').textContent = strings.dashboard.empty
document.querySelector('#create-document').textContent = strings.dashboard.newDocument
document.querySelector('#create-document').addEventListener('click', () => {
  const doc = createDocument()
  window.location.href = `editor.html?id=${encodeURIComponent(doc.id)}`
})

function renderDocuments() {
  const documents = listDocuments()
  grid.replaceChildren(...documents.map(createCard))
  emptyState.hidden = documents.length !== 0
}

function createCard(meta) {
  const card = document.createElement('article')
  card.className = 'document-card'

  const title = document.createElement('h3')
  title.className = 'document-card__title'
  title.textContent = meta.title || strings.dashboard.untitled

  const time = document.createElement('p')
  time.className = 'document-card__time'
  time.textContent = formatString(strings.dashboard.updatedAt, {
    time: new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meta.updatedAt))
  })

  const actions = document.createElement('div')
  actions.className = 'document-card__actions'
  actions.append(
    actionButton(strings.dashboard.open, () => {
      window.location.href = `editor.html?id=${encodeURIComponent(meta.id)}`
    }),
    actionButton(strings.dashboard.rename, () => {
      const nextTitle = window.prompt(strings.dashboard.renamePrompt, meta.title)
      if (nextTitle?.trim() && renameDocument(meta.id, nextTitle)) renderDocuments()
    }),
    actionButton(strings.dashboard.remove, () => {
      const confirmed = window.confirm(formatString(strings.dashboard.deleteConfirm, { title: meta.title }))
      if (confirmed) {
        deleteDocument(meta.id)
        renderDocuments()
      }
    }, 'danger-button')
  )

  card.append(title, time, actions)
  return card
}

function actionButton(label, handler, className = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', handler)
  return button
}

renderDocuments()
