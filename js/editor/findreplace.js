/**
 * 節點全文尋找、逐筆跳轉與可逆取代浮窗。
 */
import { registerAction } from './actions.js'
import { updateRichText, updateText } from './commands.js'
import { findNode, structuredCloneSafe, walkNodes } from './model.js'
import { registerOverlay } from './render.js'

export function findTextMatches(root, query, { caseSensitive = false } = {}) {
  const needle = String(query || '')
  if (!needle) return []
  const normalizedNeedle = caseSensitive ? needle : needle.toLocaleLowerCase('zh-Hant')
  const matches = []
  walkNodes(root, node => {
    const haystack = caseSensitive ? node.text : node.text.toLocaleLowerCase('zh-Hant')
    let from = 0
    const indexes = []
    while (from <= haystack.length) {
      const index = haystack.indexOf(normalizedNeedle, from)
      if (index < 0) break
      indexes.push(index)
      from = index + Math.max(1, normalizedNeedle.length)
    }
    if (indexes.length) matches.push({ id: node.id, count: indexes.length, indexes })
  })
  return matches
}

export function replaceText(source, query, replacement, { all = false, caseSensitive = false } = {}) {
  const text = String(source || '')
  const needle = String(query || '')
  if (!needle) return text
  const flags = `${all ? 'g' : ''}${caseSensitive ? '' : 'i'}u`
  return text.replace(new RegExp(escapeRegExp(needle), flags), () => String(replacement || ''))
}

export function createReplaceAllCommand(doc, query, replacement, options = {}) {
  let records = null
  return {
    description: '全部取代',
    do: () => {
      if (!records) {
        records = findTextMatches(doc.root, query, options).map(match => {
          const node = findNode(doc.root, match.id)
          return {
            id: match.id,
            previous: node.text,
            previousRichText: node.richText || null,
            next: replaceText(node.text, query, replacement, { ...options, all: true })
          }
        }).filter(record => record.previous !== record.next)
      }
      if (records.length === 0) return false
      records.forEach(record => {
        const node = findNode(doc.root, record.id)
        if (node) {
          node.text = record.next
          // richText 會優先於 text 顯示；取代後退回純文字，避免兩份內容永久分歧。
          node.richText = null
        }
      })
      return true
    },
    undo: () => records?.forEach(record => {
      const node = findNode(doc.root, record.id)
      if (node) {
        node.text = record.previous
        node.richText = record.previousRichText
      }
    }),
    get records() { return structuredCloneSafe(records || []) }
  }
}

export function initializeFindReplace(ctx) {
  const state = { open: false, query: '', matches: [], activeIndex: -1 }
  const panel = createPanel()
  const queryInput = panel.querySelector('[data-find-query]')
  const replaceInput = panel.querySelector('[data-replace-query]')
  const count = panel.querySelector('[data-find-count]')

  const recompute = ({ reset = false } = {}) => {
    state.query = queryInput.value
    state.matches = findTextMatches(ctx.doc.root, state.query)
    if (reset) state.activeIndex = state.matches.length ? 0 : -1
    else if (state.activeIndex >= state.matches.length) state.activeIndex = state.matches.length - 1
    count.textContent = state.matches.length ? `${state.activeIndex + 1} / ${state.matches.length}` : '0 / 0'
    panel.querySelectorAll('[data-needs-match]').forEach(button => { button.disabled = state.matches.length === 0 })
    ctx.renderAll()
  }

  const jump = delta => {
    if (state.matches.length === 0) return false
    state.activeIndex = (state.activeIndex + delta + state.matches.length) % state.matches.length
    count.textContent = `${state.activeIndex + 1} / ${state.matches.length}`
    const id = state.matches[state.activeIndex].id
    ctx.selection.set([id])
    ctx.viewport.centerOn(ctx.getPositions().get(id))
    ctx.renderAll()
    return true
  }

  const close = () => {
    if (!state.open) return
    state.open = false
    panel.hidden = true
    state.matches = []
    state.activeIndex = -1
    ctx.renderAll()
  }

  const open = () => {
    state.open = true
    panel.hidden = false
    recompute({ reset: true })
    queryInput.focus()
    queryInput.select()
    return true
  }

  registerOverlay(({ nodesLayer }) => {
    if (!state.open || !state.query) return
    const activeId = state.matches[state.activeIndex]?.id
    state.matches.forEach(match => {
      const element = nodesLayer.querySelector(`[data-node-id="${cssEscape(match.id)}"]`)
      element?.classList.add('is-find-match')
      if (match.id === activeId) element?.classList.add('is-find-current')
    })
  })

  // 輸入 debounce：大圖下每個字元同步全掃＋整圖重繪會逐字卡頓
  let queryDebounceTimer = null
  // 任何「使用結果清單」的動作（跳轉、取代）前一律 flush，不得作用在過期的清單上
  const flushQuery = () => {
    if (!queryDebounceTimer) return
    window.clearTimeout(queryDebounceTimer)
    queryDebounceTimer = null
    recompute({ reset: true })
  }
  queryInput.addEventListener('input', () => {
    window.clearTimeout(queryDebounceTimer)
    queryDebounceTimer = window.setTimeout(() => { queryDebounceTimer = null; recompute({ reset: true }) }, 120)
  })
  queryInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      flushQuery()
      jump(event.shiftKey ? -1 : 1)
    }
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); queryInput.select() }
  })
  replaceInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); panel.querySelector('[data-replace-current]').click() }
    if (event.key === 'Escape') { event.preventDefault(); close() }
  })
  panel.querySelector('[data-find-previous]').addEventListener('click', () => { flushQuery(); jump(-1) })
  panel.querySelector('[data-find-next]').addEventListener('click', () => { flushQuery(); jump(1) })
  panel.querySelector('[data-find-close]').addEventListener('click', close)
  panel.querySelector('[data-replace-current]').addEventListener('click', () => {
    flushQuery()
    const match = state.matches[state.activeIndex]
    const node = findNode(ctx.doc.root, match?.id)
    if (!node) return
    const next = replaceText(node.text, state.query, replaceInput.value)
    const commands = [updateText(ctx.doc, node.id, next)]
    if (node.richText) commands.push(updateRichText(ctx.doc, node.id, null))
    if (ctx.manager.batch('取代節點文字', commands)) {
      recompute()
      ctx.notify('已取代目前結果')
    }
  })
  panel.querySelector('[data-replace-all]').addEventListener('click', () => {
    flushQuery()
    const command = createReplaceAllCommand(ctx.doc, state.query, replaceInput.value)
    if (!ctx.manager.execute(command)) return
    const total = command.records.length
    recompute({ reset: true })
    ctx.notify(`已取代 ${total} 個節點`)
  })

  registerAction('findReplace', open)
  ctx.featureHandlers.escape.push(close)
}

function createPanel() {
  const panel = document.createElement('section')
  panel.className = 'find-replace-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', '尋找與取代')
  panel.innerHTML = `
    <div class="find-row">
      <input data-find-query type="search" placeholder="尋找節點文字" aria-label="尋找">
      <span data-find-count>0 / 0</span>
      <button type="button" data-find-previous data-needs-match title="上一個">↑</button>
      <button type="button" data-find-next data-needs-match title="下一個">↓</button>
      <button type="button" data-find-close aria-label="關閉">×</button>
    </div>
    <div class="find-row">
      <input data-replace-query type="text" placeholder="取代為" aria-label="取代為">
      <button type="button" data-replace-current data-needs-match>取代</button>
      <button type="button" data-replace-all data-needs-match>全部取代</button>
    </div>`
  document.body.append(panel)
  return panel
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&') }
