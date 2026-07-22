/**
 * 頂部工具列文字、按鈕狀態與文件標題編輯綁定。
 */
import { strings } from '../strings.js'

export function initializeToolbar({ doc, manager, onTitleChange, actions }) {
  const back = document.querySelector('#back-home')
  const undo = document.querySelector('#undo-button')
  const redo = document.querySelector('#redo-button')
  const title = document.querySelector('#document-title')
  const addChild = document.querySelector('#add-child-button')
  const addSibling = document.querySelector('#add-sibling-button')
  const style = document.querySelector('#toggle-sidepanel-button')
  const exportButton = document.querySelector('#export-button')

  back.textContent = strings.editor.back
  back.setAttribute('aria-label', strings.editor.backLabel)
  undo.textContent = strings.editor.undo
  undo.setAttribute('aria-label', strings.editor.undoLabel)
  redo.textContent = strings.editor.redo
  redo.setAttribute('aria-label', strings.editor.redoLabel)
  addChild.textContent = strings.editor.addChild
  addSibling.textContent = strings.editor.addSibling
  style.textContent = strings.editor.style
  exportButton.textContent = strings.editor.export
  title.value = doc.title

  undo.addEventListener('click', actions.undo)
  redo.addEventListener('click', actions.redo)
  addChild.addEventListener('click', actions.insertChild)
  addSibling.addEventListener('click', actions.insertAfter)
  style.addEventListener('click', actions.toggleSidepanel)

  title.addEventListener('keydown', event => {
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
    }
  }
}
