/**
 * 節點／畫布兩式右鍵選單；只負責選單與 action 分派，不直接修改文件。
 */
import { runAction } from './actions.js'

const NODE_MENU = [
  { label: '添加上級節點', action: 'insertParent', shortcut: 'Shift+Tab' },
  { label: '添加同級節點', action: 'insertAfter', shortcut: 'Enter' },
  { label: '添加下級節點', action: 'insertChild', shortcut: 'Tab' },
  { separator: true },
  { label: '選擇', children: [
    { label: '選擇目前節點', action: 'selectContextNode' },
    { label: '全選', action: 'selectAll', shortcut: 'Ctrl+A' }
  ] },
  { label: '插入', children: [
    { label: '圖片', action: 'insertImage', shortcut: 'Alt+P' },
    { label: '連結', action: 'insertLink', shortcut: 'Ctrl+Alt+K' },
    { label: '備註', action: 'insertNote', shortcut: 'Ctrl+Alt+M' },
    { label: '貼紙', action: 'openStickerPanel' }
  ] },
  { separator: true },
  { label: '分解（保留子節點）', action: 'dissolve', shortcut: 'Ctrl+Delete' },
  { label: '複製', action: 'copy', shortcut: 'Ctrl+C' },
  { label: '黏貼', action: 'paste', shortcut: 'Ctrl+V' },
  { label: '移除連結', action: 'removeLink' },
  { label: '刪除', action: 'remove', shortcut: 'Delete', danger: true }
]

const CANVAS_MENU = [
  { label: '一鍵整理', action: 'tidyLayout', shortcut: 'Ctrl+Shift+L' },
  { label: '展開／收起', children: [
    { label: '全部展開', action: 'expandAll' },
    { label: '全部收起', action: 'collapseAll' }
  ] },
  { label: '全選', action: 'selectAll', shortcut: 'Ctrl+A' },
  { separator: true },
  { label: '懸浮節點', action: 'floatingNode', shortcut: 'Shift+Alt+F', passEvent: true },
  { label: '歷史版本', action: 'history', shortcut: 'Shift+Alt+H' },
  { label: '尋找與取代', action: 'findReplace', shortcut: 'Ctrl+F' },
  { label: '更多', children: [
    { label: '專注模式', action: 'focusMode' },
    { label: '快速鍵', action: 'shortcutHelp' },
    { label: '更多選項', action: 'moreMenu' }
  ] }
]

export function initializeContextMenu() {
  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.hidden = true
  menu.setAttribute('role', 'menu')
  document.body.append(menu)
  let contextEvent = null
  let contextNodeId = null

  const close = () => { menu.hidden = true; menu.replaceChildren() }
  const open = (items, event) => {
    contextEvent = event
    renderItems(menu, items)
    menu.hidden = false
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX))}px`
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY))}px`
    menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true })
  }

  const handleContextMenu = event => {
    const canvas = event.target.closest('#canvas')
    if (!canvas) return
    event.preventDefault()
    const node = event.target.closest('.mind-node')
    contextNodeId = node?.dataset.nodeId || null
    if (contextNodeId) {
      window.dispatchEvent(new CustomEvent('mindflow:contexttarget', { detail: { nodeId: contextNodeId } }))
      open(NODE_MENU, event)
    } else open(CANVAS_MENU, event)
  }

  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-context-action]')
    if (!button) return
    const action = button.dataset.contextAction
    close()
    if (action === 'selectContextNode') {
      if (contextNodeId) window.dispatchEvent(new CustomEvent('mindflow:contexttarget', { detail: { nodeId: contextNodeId } }))
      return
    }
    runAction(action, button.dataset.passEvent === 'true' ? contextEvent : undefined)
  })
  document.addEventListener('contextmenu', handleContextMenu)
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target)) close() })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close()
    if (menu.hidden) return
    const buttons = Array.from(menu.querySelectorAll(':scope > button:not([hidden])'))
    const index = buttons.indexOf(document.activeElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(index + 1 + buttons.length) % buttons.length]?.focus() }
    if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus() }
  })

  return {
    destroy() {
      close()
      menu.remove()
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }
}

function renderItems(mount, items) {
  mount.replaceChildren()
  items.forEach(item => {
    if (item.separator) {
      const separator = document.createElement('hr')
      separator.setAttribute('role', 'separator')
      mount.append(separator)
      return
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.classList.toggle('is-danger', Boolean(item.danger))
    const label = document.createElement('span')
    label.textContent = item.label
    const shortcut = document.createElement('kbd')
    shortcut.textContent = item.children ? '›' : (item.shortcut || '')
    button.append(label, shortcut)
    if (item.action) {
      button.dataset.contextAction = item.action
      if (item.passEvent) button.dataset.passEvent = 'true'
    }
    if (item.children) {
      button.classList.add('has-submenu')
      const submenu = document.createElement('div')
      submenu.className = 'context-submenu'
      submenu.setAttribute('role', 'menu')
      renderItems(submenu, item.children)
      button.append(submenu)
    }
    mount.append(button)
  })
}
