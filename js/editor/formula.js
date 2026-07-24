/**
 * 輕量 LaTeX 子集：公式以文字 token 持久化，render overlay 再轉為安全 inline HTML。
 */
import { registerAction } from './actions.js'
import { findNode } from './model.js'
import { registerOverlay } from './render.js'

const FORMULA_TOKEN_PATTERN = /⟦formula:([^⟧]*)⟧/gu
const SYMBOL_COMMANDS = Object.freeze({
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  pm: '±',
  times: '×',
  div: '÷',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  infty: '∞',
  sum: '∑',
  int: '∫'
})

const CHEAT_SHEET = Object.freeze([
  ['上標', 'x^2'],
  ['下標', 'x_{i}'],
  ['分數', String.raw`\frac{a}{b}`],
  ['根號', String.raw`\sqrt{x}`],
  ['希臘字母', String.raw`\alpha+\beta`],
  ['總和', String.raw`\sum_{i=1}^{n}`],
  ['積分', String.raw`\int_{a}^{b}`],
  ['比較', String.raw`a\le b\ne c`],
  ['運算', String.raw`a\pm b\times c\div d`],
  ['無限', String.raw`\infty`]
])

export function parseLatex(value) {
  const source = String(value ?? '')
  try {
    const parser = new LatexSubsetParser(source)
    const nodes = parser.parseSequence()
    if (!parser.done) throw new SyntaxError('公式含未配對的大括號')
    return { source, supported: true, nodes }
  } catch {
    return { source, supported: false, nodes: [{ type: 'fallback', value: source }] }
  }
}

export function renderLatexToHtml(value) {
  const parsed = typeof value === 'string' ? parseLatex(value) : value
  if (!parsed?.supported) {
    return `<code class="phasec-formula-fallback">${escapeHtml(parsed?.source ?? '')}</code>`
  }
  return `<span class="phasec-formula" role="math" aria-label="${escapeHtml(parsed.source)}">${renderNodes(parsed.nodes)}</span>`
}

export function createFormulaToken(latex) {
  return `⟦formula:${encodeURIComponent(String(latex ?? '').trim())}⟧`
}

export function createInsertFormulaCommand(doc, nodeId, latex) {
  const formula = String(latex ?? '').trim()
  const token = createFormulaToken(formula)
  let previous = null
  let next = null

  return {
    description: '插入公式',
    affectedIds: [nodeId],
    do: () => {
      const node = findNode(doc.root, nodeId)
      if (!node || !formula) return false
      if (!previous) {
        previous = { text: node.text, richText: node.richText }
        next = {
          text: `${node.text}${node.text && !/\s$/u.test(node.text) ? ' ' : ''}${token}`,
          richText: null
        }
      }
      if (node.text === next.text && node.richText === next.richText) return false
      node.text = next.text
      node.richText = next.richText
      return true
    },
    undo: () => {
      const node = findNode(doc.root, nodeId)
      if (!node || !previous) return
      node.text = previous.text
      node.richText = previous.richText
    }
  }
}

export function initFormula(ctx) {
  ensurePhaseCStyles()
  const dialog = createFormulaDialog(ctx)
  const open = () => {
    if (!ctx.selection.primaryId) {
      ctx.notify?.('請先選取節點')
      return false
    }
    dialog.open()
    return true
  }

  registerAction('insertFormula', open)
  // DELTA 插入選單在 C2 前已使用 formula 名稱，保留 alias 接上正式 action。
  registerAction('formula', open)
  registerOverlay(overlayCtx => decorateFormulaNodes(overlayCtx))

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-insert-action="formula"]')
    if (!button) return
    event.preventDefault()
    event.stopImmediatePropagation()
    open()
  }, { capture: true })

  return dialog
}

class LatexSubsetParser {
  constructor(source) {
    this.source = source
    this.index = 0
  }

  get done() {
    return this.index >= this.source.length
  }

  parseSequence(stopAtBrace = false) {
    const nodes = []
    while (!this.done) {
      const character = this.source[this.index]
      if (character === '}') {
        if (!stopAtBrace) throw new SyntaxError('多餘的右大括號')
        this.index += 1
        return nodes
      }
      if (character === '^' || character === '_') {
        if (nodes.length === 0) throw new SyntaxError('上下標缺少基底')
        this.index += 1
        const argument = this.parseArgument()
        const previous = nodes.pop()
        const script = previous.type === 'script'
          ? previous
          : { type: 'script', base: previous, superscript: null, subscript: null }
        const key = character === '^' ? 'superscript' : 'subscript'
        if (script[key]) throw new SyntaxError('重複上下標')
        script[key] = argument
        nodes.push(script)
        continue
      }
      nodes.push(this.parseAtom())
    }
    if (stopAtBrace) throw new SyntaxError('缺少右大括號')
    return mergeTextNodes(nodes)
  }

  parseAtom() {
    const character = this.source[this.index]
    if (character === '{') {
      this.index += 1
      return { type: 'group', children: this.parseSequence(true) }
    }
    if (character === '\\') return this.parseCommand()
    this.index += 1
    return { type: 'text', value: character }
  }

  parseCommand() {
    this.index += 1
    const match = this.source.slice(this.index).match(/^[A-Za-z]+/u)
    if (!match) throw new SyntaxError('不支援的跳脫字元')
    const name = match[0]
    this.index += name.length
    if (name === 'frac') {
      return {
        type: 'fraction',
        numerator: this.parseRequiredGroup(),
        denominator: this.parseRequiredGroup()
      }
    }
    if (name === 'sqrt') {
      return { type: 'sqrt', radicand: this.parseRequiredGroup() }
    }
    if (Object.hasOwn(SYMBOL_COMMANDS, name)) {
      return { type: 'symbol', value: SYMBOL_COMMANDS[name] }
    }
    throw new SyntaxError(`不支援 \\${name}`)
  }

  parseRequiredGroup() {
    if (this.source[this.index] !== '{') throw new SyntaxError('此命令需要大括號參數')
    this.index += 1
    return this.parseSequence(true)
  }

  parseArgument() {
    if (this.done) throw new SyntaxError('上下標缺少內容')
    if (this.source[this.index] === '{') {
      this.index += 1
      return this.parseSequence(true)
    }
    return [this.parseAtom()]
  }
}

function mergeTextNodes(nodes) {
  const merged = []
  for (const node of nodes) {
    const previous = merged.at(-1)
    if (node.type === 'text' && previous?.type === 'text') previous.value += node.value
    else merged.push(node)
  }
  return merged
}

function renderNodes(nodes) {
  return (nodes || []).map(node => {
    if (node.type === 'text' || node.type === 'symbol') return escapeHtml(node.value)
    if (node.type === 'group') return `<span class="phasec-formula-group">${renderNodes(node.children)}</span>`
    if (node.type === 'fraction') {
      return `<span class="phasec-fraction"><span class="phasec-fraction__numerator">${renderNodes(node.numerator)}</span><span class="phasec-fraction__denominator">${renderNodes(node.denominator)}</span></span>`
    }
    if (node.type === 'sqrt') {
      return `<span class="phasec-sqrt"><span aria-hidden="true">√</span><span class="phasec-sqrt__radicand">${renderNodes(node.radicand)}</span></span>`
    }
    if (node.type === 'script') {
      const superscript = node.superscript
        ? `<sup>${renderNodes(node.superscript)}</sup>`
        : ''
      const subscript = node.subscript
        ? `<sub>${renderNodes(node.subscript)}</sub>`
        : ''
      return `<span class="phasec-script"><span>${renderNodes([node.base])}</span>${superscript}${subscript}</span>`
    }
    return `<code class="phasec-formula-fallback">${escapeHtml(node.value || '')}</code>`
  }).join('')
}

function decorateFormulaNodes({ nodesLayer, nodeLookup }) {
  for (const [id, record] of nodeLookup) {
    if (!record.node.text.includes('⟦formula:')) continue
    const textElement = nodesLayer.querySelector(`.mind-node[data-node-id="${cssEscape(id)}"] > .mind-node__text`)
    if (!textElement) continue
    const parts = splitFormulaTokens(record.node.text)
    if (!parts.some(part => part.type === 'formula')) continue
    const fragment = document.createDocumentFragment()
    for (const part of parts) {
      if (part.type === 'text') {
        fragment.append(document.createTextNode(part.value))
        continue
      }
      const wrapper = document.createElement('span')
      wrapper.className = 'phasec-formula-host'
      wrapper.innerHTML = renderLatexToHtml(part.value)
      fragment.append(wrapper)
    }
    textElement.replaceChildren(fragment)
  }
}

function splitFormulaTokens(source) {
  const parts = []
  let cursor = 0
  for (const match of source.matchAll(FORMULA_TOKEN_PATTERN)) {
    if (match.index > cursor) parts.push({ type: 'text', value: source.slice(cursor, match.index) })
    let formula = match[1]
    try {
      formula = decodeURIComponent(formula)
    } catch {
      // 損壞 token 仍以原始內容 fallback，不讓整個節點 render 失敗。
    }
    parts.push({ type: 'formula', value: formula })
    cursor = match.index + match[0].length
  }
  if (cursor < source.length) parts.push({ type: 'text', value: source.slice(cursor) })
  return parts
}

function createFormulaDialog(ctx) {
  const dialog = document.createElement('dialog')
  dialog.className = 'phasec-dialog formula-dialog'
  dialog.setAttribute('aria-labelledby', 'formula-dialog-title')
  const form = document.createElement('form')
  form.method = 'dialog'

  const header = document.createElement('header')
  const heading = document.createElement('div')
  const eyebrow = document.createElement('span')
  eyebrow.className = 'phasec-eyebrow'
  eyebrow.textContent = 'LATEX SUBSET'
  const title = document.createElement('h2')
  title.id = 'formula-dialog-title'
  title.textContent = '插入公式'
  heading.append(eyebrow, title)
  const close = iconButton('×', '關閉公式面板')
  close.value = 'cancel'
  header.append(heading, close)

  const label = document.createElement('label')
  label.textContent = 'LaTeX'
  const input = document.createElement('textarea')
  input.rows = 3
  input.spellcheck = false
  input.placeholder = String.raw`\frac{x^2}{\sqrt{y}}`
  label.append(input)

  const preview = document.createElement('div')
  preview.className = 'formula-preview'
  preview.setAttribute('aria-live', 'polite')

  const cheatHeading = document.createElement('h3')
  cheatHeading.textContent = '快速插入'
  const cheat = document.createElement('div')
  cheat.className = 'formula-cheat-sheet'
  for (const [name, template] of CHEAT_SHEET) {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = template
    button.textContent = name
    button.addEventListener('click', () => {
      insertAtCursor(input, template)
      updatePreview()
    })
    cheat.append(button)
  }

  const footer = document.createElement('footer')
  const hint = document.createElement('span')
  hint.textContent = '未知語法會保留原文'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = '取消'
  const insert = document.createElement('button')
  insert.type = 'submit'
  insert.className = 'phasec-primary-button'
  insert.textContent = '插入'
  footer.append(hint, cancel, insert)

  form.append(header, label, preview, cheatHeading, cheat, footer)
  dialog.append(form)
  document.body.append(dialog)

  const updatePreview = () => {
    const source = input.value.trim()
    preview.innerHTML = source
      ? renderLatexToHtml(source)
      : '<span class="formula-preview__empty">公式預覽</span>'
    insert.disabled = !source
  }
  input.addEventListener('input', updatePreview)
  cancel.addEventListener('click', () => dialog.close('cancel'))
  form.addEventListener('submit', event => {
    event.preventDefault()
    const nodeId = ctx.selection.primaryId
    const command = createInsertFormulaCommand(ctx.doc, nodeId, input.value)
    if (ctx.manager.execute(command)) {
      ctx.notify?.('公式已插入')
      dialog.close('insert')
    }
  })

  return {
    open() {
      input.value = ''
      updatePreview()
      if (!dialog.open) dialog.showModal()
      queueMicrotask(() => input.focus())
    },
    close() {
      if (dialog.open) dialog.close('cancel')
    }
  }
}

function insertAtCursor(input, value) {
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  input.setRangeText(value, start, end, 'end')
  input.focus()
}

function iconButton(label, ariaLabel) {
  const button = document.createElement('button')
  button.type = 'submit'
  button.className = 'phasec-icon-button'
  button.textContent = label
  button.setAttribute('aria-label', ariaLabel)
  return button
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function ensurePhaseCStyles() {
  if (document.querySelector('link[data-phasec-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/phasec.css'
  link.dataset.phasecStyles = 'true'
  document.head.append(link)
}
