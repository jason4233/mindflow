/**
 * IO 純函數自測：直接以 Node 執行，不需要 DOM、Canvas 或外部套件。
 */
import assert from 'node:assert/strict'
import {
  documentToSvg,
  exportDocumentJson,
  exportDocumentMarkdown,
  exportDocumentTxt,
  exportDocumentWord,
  parseRichTextRuns
} from '../js/io/export.js'
import { EXPORT_FORMATS } from '../js/editor/exportdialog.js'
import {
  importDocumentJson,
  importDocumentMarkdown,
  importDocumentTxt,
  importOutline
} from '../js/io/import.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

function node(id, text, children = [], overrides = {}) {
  return {
    id,
    text,
    children,
    collapsed: false,
    side: null,
    style: {},
    richText: null,
    notes: null,
    link: null,
    icons: [],
    image: null,
    ...overrides
  }
}

function fixtureDoc() {
  return {
    id: 'doc_io_roundtrip',
    title: 'IO 往返 <測試>',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T01:02:03.000Z',
    root: node('root', '中心 & <Root>', [
      node('branch-a', '分支 A', [
        node('leaf-a1', '第一行\n第二行\t\\path', [], {
          style: { fill: '#ffeeaa', bold: true, lineStyle: 'dashed' },
          notes: '備註 <內容>',
          link: 'https://example.com/?a=1&b=2',
          icons: ['1', '旗']
        })
      ], { side: 'right', style: { textColor: '#123456' } }),
      node('branch-b', '  首尾空白  ', [
        node('leaf-empty', '')
      ], { side: 'left', collapsed: true })
    ], { style: { shape: 'pill' } }),
    layout: 'mindmap-both',
    themeId: 'deep-space',
    relations: [{
      id: 'rel-1', fromId: 'branch-a', toId: 'branch-b', label: '跨線',
      cp1: { x: -12, y: -30 }, cp2: { x: 44, y: 80 }, style: { color: '#f59e0b', width: 3 }
    }],
    summaries: [{ id: 'sum-1', parentId: 'root', startIndex: 0, endIndex: 1, text: '概要', style: {} }],
    canvas: {
      background: '#0B0B2A',
      watermark: { enabled: false, text: 'MindFlow', color: '#64748b', rotation: 'left', opacity: 12, size: 18 },
      spacingH: 30,
      spacingV: 30
    }
  }
}

function textTree(root) {
  return {
    text: root.text,
    children: root.children.map(textTree)
  }
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1
}

test('原生 JSON export→import 完整深度相等且不修改來源', () => {
  const doc = fixtureDoc()
  const before = structuredClone(doc)
  const compact = exportDocumentJson(doc)
  const pretty = exportDocumentJson(doc, { space: 2 })

  assert.deepEqual(importDocumentJson(compact), doc)
  assert.deepEqual(importDocumentJson(pretty), doc)
  assert.deepEqual(doc, before)
  assert.ok(pretty.includes('\n  "title"'))
})

test('TXT 縮排大綱保留樹深、空文字與特殊字元', () => {
  const doc = fixtureDoc()
  doc.root.collapsed = false
  const txt = exportDocumentTxt(doc)
  const restored = importDocumentTxt(txt)

  assert.deepEqual(textTree(restored.root), textTree(doc.root))
  assert.match(txt, /第一行\\n第二行\\t\\\\path/u)
  assert.match(txt, /\\s\\s首尾空白\\s\\s/u)
  assert.match(txt, /\\0/u)
})

test('Markdown export→import 保留完整文字樹', () => {
  const doc = fixtureDoc()
  doc.root.collapsed = false
  const markdown = exportDocumentMarkdown(doc)
  const restored = importDocumentMarkdown(markdown)

  assert.ok(markdown.startsWith('# 中心 & <Root>\n\n- 分支 A'))
  assert.deepEqual(textTree(restored.root), textTree(doc.root))
})

test('Markdown 標題、項目符號與編號清單可混合匯入', () => {
  const markdown = '\uFEFF# 專案\r\n\r\n- 研究\r\n  1. 市場\r\n  2. 法規\r\n- 執行\r\n## 里程碑\r\n內容'
  const doc = importDocumentMarkdown(markdown, { id: 'doc-md' })

  assert.equal(doc.id, 'doc-md')
  assert.deepEqual(textTree(doc.root), {
    text: '專案',
    children: [
      { text: '研究', children: [{ text: '市場', children: [] }, { text: '法規', children: [] }] },
      { text: '執行', children: [] },
      { text: '里程碑', children: [{ text: '內容', children: [] }] }
    ]
  })
})

test('空大綱產生合法空根，且同輸入結果完全固定', () => {
  const first = importOutline(' \n\t\n')
  const second = importOutline(' \n\t\n')

  assert.deepEqual(first, second)
  assert.equal(first.root.text, '')
  assert.deepEqual(first.root.children, [])
  assert.equal(first.title, '未命名')
  assert.equal(first.createdAt, '1970-01-01T00:00:00.000Z')
})

test('320 層大綱可迭代匯出與匯入，不截斷深度', () => {
  const depth = 320
  const root = node('deep-0', '第 0 層')
  let cursor = root
  for (let index = 1; index < depth; index += 1) {
    const child = node(`deep-${index}`, `第 ${index} 層`)
    cursor.children.push(child)
    cursor = child
  }
  const doc = { ...fixtureDoc(), id: 'doc-deep', root }
  const restored = importDocumentTxt(exportDocumentTxt(doc))

  let count = 1
  cursor = restored.root
  while (cursor.children.length > 0) {
    assert.equal(cursor.children.length, 1)
    cursor = cursor.children[0]
    count += 1
  }
  assert.equal(count, depth)
  assert.equal(cursor.text, `第 ${depth - 1} 層`)
})

test('Word .doc HTML 是完整文件、巢狀清單且正確 escape', () => {
  const html = exportDocumentWord(fixtureDoc())

  assert.ok(html.startsWith('<!DOCTYPE html>'))
  assert.match(html, /xmlns:w="urn:schemas-microsoft-com:office:word"/u)
  assert.match(html, /中心 &amp; &lt;Root&gt;/u)
  assert.match(html, /第一行<br>第二行/u)
  assert.equal(countOccurrences(html, '<ul>'), countOccurrences(html, '</ul>'))
  assert.equal(countOccurrences(html, '<li>'), countOccurrences(html, '</li>'))
})

test('SVG 為獨立向量內容，含節點、文字、主題色與 cubic Bézier', () => {
  const doc = fixtureDoc()
  const before = structuredClone(doc)
  const svg = documentToSvg(doc, { margin: 40, includeCollapsedChildren: true })

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(svg.endsWith('</svg>'))
  assert.match(svg, /viewBox="0 0 \d+ \d+"/u)
  assert.match(svg, /<path d="M [^"]+ C [^"]+"/u)
  assert.equal(countOccurrences(svg, 'data-node-id='), 5)
  assert.match(svg, /#0B0B2A/iu)
  assert.match(svg, /中心 &amp; &lt;Root&gt;/u)
  assert.doesNotMatch(svg, /foreignObject|<script|\[object Object\]/iu)
  assert.deepEqual(doc, before)
})

test('SVG 預設遵守 collapsed，可選透明背景，空 Doc 也回傳合法 SVG', () => {
  const doc = fixtureDoc()
  const visible = documentToSvg(doc, { transparent: true })
  const empty = documentToSvg(null, { margin: 0, transparent: true })

  assert.equal(countOccurrences(visible, 'data-node-id='), 4)
  assert.ok(visible.indexOf('<g transform=') < visible.indexOf('<rect '))
  assert.equal(empty, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>')
})

test('SVG 保留新節點形狀、圓角、邊框 dash 與 straight/orthogonal 線型', () => {
  const doc = fixtureDoc()
  doc.themeId = 'classic-blue'
  doc.root.children = [
    node('diamond', '菱形', [], { side: 'right', style: { shape: 'diamond', borderStyle: 'dash-dot', lineStyle: 'solid|shape=straight' } }),
    node('parallel', '平行', [], { side: 'right', style: { shape: 'parallelogram', lineStyle: 'solid|shape=orthogonal' } }),
    node('circle', '圓', [], { side: 'right', style: { shape: 'circle' } }),
    node('pill', '窄藥丸', [], { side: 'right', style: { shape: 'pill-narrow', radius: 3 } })
  ]
  const svg = documentToSvg(doc, { includeCollapsedChildren: true })
  assert.ok((svg.match(/<polygon\b/g) || []).length >= 2)
  assert.match(svg, /<circle\b/u)
  assert.match(svg, /stroke-dasharray="10 4 2 4"/u)
  assert.match(svg, /d="M [^"]+ L [^"]+"/u)
  assert.match(svg, /d="M [^"]+ H [^"]+ V [^"]+ H [^"]+"/u)
  assert.match(svg, /<rect[^>]+rx="[1-9][0-9.]*"/u)
})

test('SVG 以 tspan run 保留 richText 局部粗斜體、底線與顏色', () => {
  const doc = fixtureDoc()
  doc.root.text = '重點提示底線'
  doc.root.richText = '<b><span style="color: #dc2626">重點</span></b><i>提示</i><u>底線</u>'
  const runs = parseRichTextRuns(doc.root.richText)
  assert.deepEqual(runs, [
    { text: '重點', style: { bold: true, color: '#dc2626' } },
    { text: '提示', style: { italic: true } },
    { text: '底線', style: { underline: true } }
  ])
  const svg = documentToSvg(doc)
  assert.match(svg, /<tspan[^>]*font-weight="700"[^>]*fill="#dc2626"[^>]*>重點<\/tspan>/u)
  assert.match(svg, /<tspan[^>]*font-style="italic"[^>]*>提示<\/tspan>/u)
  assert.match(svg, /<tspan[^>]*text-decoration="underline"[^>]*>底線<\/tspan>/u)
})

test('匯出彈窗提供 SPEC 指定六格式', () => {
  assert.deepEqual(EXPORT_FORMATS.map(format => format.id), ['jpg', 'png', 'pdf', 'word', 'txt', 'mindflow'])
})

test('JSON 非物件輸入明確拒絕', () => {
  assert.throws(() => importDocumentJson('null'), /文件物件/u)
  assert.throws(() => importDocumentJson('[]'), /文件物件/u)
  assert.throws(() => importDocumentJson('{bad json'), SyntaxError)
})

let passed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    passed += 1
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    throw error
  }
}
console.log(`\n${passed}/${tests.length} IO tests passed`)
