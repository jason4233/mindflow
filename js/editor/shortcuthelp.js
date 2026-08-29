/**
 * 更多選單、專注模式與快捷鍵說明面板。
 */
import { hasAction, registerAction, runAction } from './actions.js'
import { ACTION_BINDINGS, findShortcutBinding, isFormTarget } from './keyboard.js'
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
  const diagnostic = createKeyDiagnostic()
  dialog.querySelector('[data-key-diagnostic]').addEventListener('click', () => {
    closeDialog()
    diagnostic.show()
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
    <header><div><small>MindFlow</small><h2>快速鍵</h2></div>
      <button type="button" data-key-diagnostic class="shortcut-diagnostic-button">鍵盤診斷</button>
      <button type="button" data-shortcut-close aria-label="關閉">×</button></header>
    <div class="shortcut-table-wrap"><table><thead><tr><th>功能</th><th>快速鍵</th></tr></thead><tbody>${rows}</tbody></table></div>`
  document.body.append(dialog)
  return dialog
}

// 鍵盤診斷浮動面板：即時顯示 app 實際收到的鍵盤事件，供排查「快捷鍵沒反應」時
// 判斷是（a）事件根本沒送達（OS/輸入法攔截）還是（b）事件有到但比對失敗。
function createKeyDiagnostic() {
  const style = document.createElement('style')
  style.textContent = `
    .key-diagnostic { position: fixed; left: 12px; bottom: 12px; z-index: 9999; width: 360px;
      background: rgba(20, 24, 34, .95); color: #e6e9f0; border-radius: 10px; padding: 10px 12px;
      font: 12px/1.5 Consolas, monospace; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    .key-diagnostic header { display: flex; justify-content: space-between; align-items: center;
      font-family: system-ui, sans-serif; font-size: 13px; margin-bottom: 6px; }
    .key-diagnostic header button { background: none; border: 0; color: #9aa3b5; cursor: pointer; font-size: 16px; }
    .key-diagnostic ol { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; }
    .key-diagnostic li { padding: 2px 0; border-top: 1px solid rgba(255,255,255,.08); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .key-diagnostic li b { color: #7dd3a7; }
    .key-diagnostic li i { color: #f0a662; font-style: normal; }
    .shortcut-diagnostic-button { margin-left: auto; margin-right: 8px; font-size: 12px; cursor: pointer;
      border: 1px solid currentColor; border-radius: 6px; padding: 2px 8px; background: none; color: inherit; }`
  document.head.append(style)

  const panel = document.createElement('div')
  panel.className = 'key-diagnostic'
  panel.hidden = true
  panel.innerHTML = `<header><span>鍵盤診斷（按任意鍵）</span><button type="button" aria-label="關閉">×</button></header><ol></ol>`
  document.body.append(panel)
  const list = panel.querySelector('ol')

  const onKeydown = event => {
    const binding = findShortcutBinding(event)
    const mods = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean).join('+') || '-'
    const row = document.createElement('li')
    row.innerHTML = `key=<b></b> code=<b></b> kc=${event.keyCode} mod=${mods}`
      + `${event.isComposing ? ' <i>組字中</i>' : ''}${isFormTarget(event.target) ? ' <i>表單焦點</i>' : ''}`
      + ` → ${binding ? `<b></b>` : '<i>無對應</i>'}`
    const bolds = row.querySelectorAll('b')
    bolds[0].textContent = event.key
    bolds[1].textContent = event.code || '(空)'
    if (binding) bolds[2].textContent = binding.action
    list.prepend(row)
    while (list.children.length > 10) list.lastChild.remove()
  }

  const show = () => { panel.hidden = false; window.addEventListener('keydown', onKeydown, true) }
  const hide = () => { panel.hidden = true; window.removeEventListener('keydown', onKeydown, true) }
  panel.querySelector('header button').addEventListener('click', hide)
  return { show, hide }
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
