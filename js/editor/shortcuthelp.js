/**
 * 更多選單、專注模式與快捷鍵說明面板。
 */
import { hasAction, registerAction, runAction } from './actions.js'
import { ACTION_BINDINGS } from './keyboard.js'
import { walkNodes } from './model.js'

const ACTION_LABELS = {
  undo: '復原', redo: '重做', copy: '複製', cut: '剪下', paste: '貼上', selectAll: '全選', save: '儲存',
  insertParent: '插入上級節點', insertChild: '插入下級節點', insertAfter: '插入同級節點', toggleCollapse: '展開／收合',
  dissolve: '分解節點', remove: '刪除', moveUp: '同級上移', moveDown: '同級下移', duplicate: '複製節點', edit: '編輯文字',
  navigateUp: '選取上方節點', navigateDown: '選取下方節點', navigateLeft: '選取左方節點', navigateRight: '選取右方節點',
  formatPainter: '格式刷', insertLink: '插入連結', insertNote: '插入備註', insertSummary: '新增概要', insertImage: '插入圖片',
  openIcons: '開啟圖示', insertRelation: '新增關聯線', findReplace: '尋找與取代', floatingNode: '新增懸浮節點',
  fit: '適合畫布', centerRoot: '根節點置中', zoomReset: '縮放 100%', toggleFullscreen: '全螢幕', nextTheme: '下一個主題'
}

export function initializeShortcutHelp(ctx) {
  const menu = createMoreMenu(ctx)
  const dialog = createShortcutDialog()
  const closeDialog = () => { if (dialog.open) dialog.close() }

  registerAction('moreMenu', () => { menu.toggle(); return true })
  registerAction('shortcutHelp', () => { menu.close(); if (!dialog.open) dialog.showModal(); return true })
  // focusMode 由 focus.js 的 FocusController 全權實作（含 Esc 退出與 is-c1-focus-mode class）；
  // 這裡不再註冊舊版 toggle，避免依賴初始化順序的雙註冊互相覆蓋。
  if (!hasAction('history')) registerAction('history', () => { ctx.notify('歷史版本尚未接入'); return false })

  dialog.querySelector('[data-shortcut-close]').addEventListener('click', closeDialog)
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog()
  })
  ctx.featureHandlers.escape.push(() => {
    menu.close()
    closeDialog()
  })
}

function createMoreMenu(ctx) {
  const menu = document.createElement('div')
  menu.className = 'feature-popover more-menu'
  menu.hidden = true
  menu.innerHTML = `
    <button type="button" data-more-action="focusMode"><span>專注</span><kbd>Esc 退出</kbd></button>
    <button type="button" data-more-placeholder="團隊協作"><span>團隊協作</span><small>即將推出</small></button>
    <button type="button" data-more-action="findReplace"><span>尋找與取代</span><kbd>Ctrl+F</kbd></button>
    <button type="button" data-more-action="history"><span>歷史版本</span><kbd>Shift+Alt+H</kbd></button>
    <button type="button" data-more-action="tidyLayout"><span>一鍵整理</span><kbd>Ctrl+Shift+L</kbd></button>
    <label class="more-toggle"><span>顯示評論</span><input type="checkbox" data-comment-toggle checked><i></i></label>
    <button type="button" data-more-action="shortcutHelp"><span>快速鍵</span><kbd>?</kbd></button>
    <button type="button" data-more-placeholder="設定"><span>設定</span><small>即將推出</small></button>
    <footer><span data-comment-count>評論 0</span><span data-node-count>節點 0</span></footer>`
  document.body.append(menu)

  const updateCounts = () => {
    let nodes = 0
    let comments = 0
    walkNodes(ctx.doc.root, node => {
      nodes += 1
      if (Array.isArray(node.comments)) comments += node.comments.length
    })
    menu.querySelector('[data-comment-count]').textContent = `評論 ${comments}`
    menu.querySelector('[data-node-count]').textContent = `節點 ${nodes}`
  }
  const close = () => { menu.hidden = true }
  menu.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-more-action]')
    const placeholder = event.target.closest('[data-more-placeholder]')
    if (placeholder) { ctx.notify(`${placeholder.dataset.morePlaceholder}尚未接入`); close(); return }
    if (!actionButton) return
    const action = actionButton.dataset.moreAction
    close()
    const result = runAction(action)
    if (result === false && action === 'tidyLayout') ctx.notify('一鍵整理模組尚未接入')
  })
  menu.querySelector('[data-comment-toggle]').addEventListener('change', event => {
    document.body.classList.toggle('hide-comments', !event.target.checked)
  })
  document.addEventListener('pointerdown', event => {
    const moreButton = document.querySelector('#more-button')
    if (!menu.hidden && !menu.contains(event.target) && event.target !== moreButton) close()
  })
  window.addEventListener('mindflow:selectionchange', updateCounts)

  return {
    toggle() {
      const anchor = document.querySelector('#more-button')?.getBoundingClientRect()
      if (!anchor) return
      updateCounts()
      menu.style.right = `${Math.max(8, window.innerWidth - anchor.right)}px`
      menu.style.top = `${anchor.bottom + 8}px`
      menu.hidden = !menu.hidden
    },
    close
  }
}

function createShortcutDialog() {
  const dialog = document.createElement('dialog')
  dialog.className = 'feature-dialog shortcut-dialog'
  const rows = ACTION_BINDINGS
    .filter(binding => ACTION_LABELS[binding.action] || /^priority\d$/u.test(binding.action))
    .map(binding => {
      const label = ACTION_LABELS[binding.action] || `優先順序 ${binding.action.at(-1)}`
      return `<tr><td>${label}</td><td><kbd>${shortcutText(binding)}</kbd></td></tr>`
    }).join('')
  dialog.innerHTML = `
    <header><div><small>MindFlow</small><h2>快速鍵</h2></div><button type="button" data-shortcut-close aria-label="關閉">×</button></header>
    <div class="shortcut-table-wrap"><table><thead><tr><th>功能</th><th>快速鍵</th></tr></thead><tbody>${rows}</tbody></table></div>`
  document.body.append(dialog)
  return dialog
}

function shortcutText(binding) {
  const parts = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.shift) parts.push('Shift')
  if (binding.alt) parts.push('Alt')
  const names = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Delete', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc' }
  parts.push(names[binding.key] || (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key))
  return parts.join(' + ')
}
