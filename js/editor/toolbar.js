/**
 * 頂部三膠囊工具列：綁定 action registry、文件標題與 undo/redo 狀態。
 */
import { hasAction, runAction } from './actions.js'
import { dispatchGlobalShortcut, findShortcutBinding } from './keyboard.js'
import { initializeExportDialog } from './exportdialog.js'
import { strings } from '../strings.js'

export function initializeToolbar({ doc, manager, onTitleChange, actions }) {
  initializeExportDialog({ doc })
  ensurePhaseCStyles()
  upgradeDeferredMenuEntries()
  const back = document.querySelector('#back-home')
  const undo = document.querySelector('#undo-button')
  const redo = document.querySelector('#redo-button')
  const title = document.querySelector('#document-title')
  const addChild = document.querySelector('#add-child-button')
  const addSibling = document.querySelector('#add-sibling-button')
  const style = document.querySelector('#toggle-sidepanel-button')
  const exportButton = document.querySelector('#export-button')
  const saveStatus = document.querySelector('#save-status')

  back.textContent = strings.editor.back
  back.setAttribute('aria-label', strings.editor.backLabel)
  undo.textContent = strings.editor.undo
  undo.setAttribute('aria-label', strings.editor.undoLabel)
  undo.title = `${strings.editor.undoLabel}（Ctrl+Z）`
  redo.textContent = strings.editor.redo
  redo.setAttribute('aria-label', strings.editor.redoLabel)
  redo.title = `${strings.editor.redoLabel}（Ctrl+Y）`
  addChild.setAttribute('aria-label', strings.editor.addChild)
  addSibling.setAttribute('aria-label', strings.editor.addSibling)
  exportButton.setAttribute('aria-label', strings.editor.export)
  title.value = doc.title
  // 載入完成＝記憶體與儲存區一致，顯示已保存但不冒充「剛剛存過」的時間
  if (saveStatus) saveStatus.textContent = '已保存'

  undo.addEventListener('click', actions.undo)
  redo.addEventListener('click', actions.redo)
  addChild.addEventListener('click', actions.insertChild)
  addSibling.addEventListener('click', actions.insertAfter)
  style.addEventListener('click', actions.toggleSidepanel)

  bindAction('#add-parent-button', 'insertParent')
  bindAction('#format-painter-button', 'formatPainter')
  bindAction('#text-button', 'edit')
  bindAction('#insert-button', 'insertImage')
  bindAction('#summary-button', 'insertSummary')
  bindAction('#relation-button', 'insertRelation')
  bindAction('#theme-button', 'openThemePanel')
  bindAction('#presentation-button', 'presentation')
  bindAction('#ai-button', 'aiMenu')
  bindAction('#share-button', 'share')
  bindAction('#export-button', 'openExport')
  bindAction('#more-button', 'moreMenu')
  bindAction('#fullscreen-button', 'toggleFullscreen')

  title.addEventListener('keydown', event => {
    const shortcut = findShortcutBinding(event)
    if (shortcut?.action === 'save') title.blur()
    if (dispatchGlobalShortcut(event, { formMode: true })) {
      event.stopPropagation()
      return
    }
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      title.blur()
    } else if (event.key === 'Escape') {
      title.value = doc.title
      title.blur()
    }
  })
  title.addEventListener('change', () => onTitleChange(title.value))

  return {
    update() {
      undo.disabled = !manager.canUndo
      redo.disabled = !manager.canRedo
      if (document.activeElement !== title) title.value = doc.title
    },
    // 儲存狀態只由真實存檔結果驅動：pending（有變更未寫入）/ saved（寫入成功）/ failed（寫入失敗）
    setSaveStatus(state) {
      if (!saveStatus) return
      if (state === 'pending') {
        saveStatus.textContent = '變更未儲存…'
        saveStatus.style.color = ''
      } else if (state === 'failed') {
        saveStatus.textContent = '⚠ 儲存失敗'
        saveStatus.style.color = '#dc2626'
      } else {
        updateSaveStatus(saveStatus)
        saveStatus.style.color = ''
      }
    }
  }
}

function bindAction(selector, action) {
  if (!hasAction(action)) throw new Error(`工具列 action「${action}」尚未註冊`)
  document.querySelector(selector)?.addEventListener('click', () => runAction(action))
}

function updateSaveStatus(element) {
  if (!element) return
  const time = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  element.textContent = `已保存 ${time}`
}

function upgradeDeferredMenuEntries() {
  const upgrade = () => {
    const formula = document.querySelector('[data-insert-action="formula"]')
    if (formula) formula.dataset.insertAction = 'insertFormula'

    const moreMenu = document.querySelector('.more-menu')
    if (moreMenu && !moreMenu.querySelector('[data-more-action="splitScreen"]')) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.moreAction = 'splitScreen'
      const label = document.createElement('span')
      label.textContent = '分屏參考'
      const key = document.createElement('kbd')
      key.textContent = ''
      button.append(label, key)
      const history = moreMenu.querySelector('[data-more-action="history"]')
      if (history) history.insertAdjacentElement('afterend', button)
      else moreMenu.prepend(button)
    }
    return Boolean(formula && moreMenu)
  }
  if (upgrade()) return
  const observer = new MutationObserver(() => {
    if (upgrade()) observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function ensurePhaseCStyles() {
  if (document.querySelector('link[data-phasec-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/phasec.css'
  link.dataset.phasecStyles = 'true'
  document.head.append(link)
}
