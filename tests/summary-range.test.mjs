/**
 * 概要涵蓋範圍與同級判定（GitMind 對齊；研究報告 L-00 ＋ 2026-09-15 紅隊審查 2.1／2.2／2.3／3.1／3.2／3.3）。
 *
 * 使用者情境與過關標準（先寫測試、先紅後綠）：
 *   1. 只選一個節點按 Ctrl+Alt+T → 也要能建概要（GitMind：「一個或多個相鄰同層節點」）。
 *   2. 被概括的節點底下還有子節點 → 括號放在「整棵子樹」外側，不能壓到子節點；子樹收合時看不見的後代不計。
 *   3. 魚骨圖的 children 陣列順序與畫面相反 → 「相鄰」與「起訖把手」一律看畫面位置，不看陣列。
 *   4. 父節點用「結構」面板覆寫成組織圖（或反過來覆寫成心智圖）→ 同級是否相鄰依實際排列，不依 doc.layout 的左右分側。
 *   5. 目錄樹根節點標題再長，括號也固定在子節點縮排的那一側；垂直時間軸左右交錯時固定放右側，不因文字寬度翻面。
 *   6. 獨立心智圖（懸浮圖）夾在同級之間時，不算進概要範圍。
 * 不過關：單節點回 null；括號任何一點落進子節點框；魚骨圖 a+b 相鄰卻拒建或把手左右顛倒；
 *         覆寫結構後視覺相鄰的節點拒建、跳一格的反而能建；括號隨根節點標題長度換邊；懸浮圖被包進括號。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOATING_PREFIX, createDefaultDoc, createNode } from '../js/editor/model.js'
import { layout } from '../js/editor/layout.js'
import { createSummaryCommand, getSummaryNodes, getSummaryRange, summaryGeometry } from '../js/editor/summary.js'

const measure = (node, depth) => ({
  w: Math.min(250, 36 + Math.max(...node.text.split('\n').map(line => line.length), 1) * 7 + (depth === 0 ? 28 : 0)),
  h: 28 + (node.text.split('\n').length - 1) * 18
})
const pathPoints = path => {
  const numbers = (path.match(/-?\d+(?:\.\d+)?/gu) || []).map(Number)
  return numbers.reduce((points, value, index) => (index % 2 === 0 ? [...points, { x: value, y: numbers[index + 1] }] : points), [])
}
const boxOf = (positions, ids) => {
  const boxes = ids.map(id => positions.get(id)).filter(Boolean)
  return {
    left: Math.min(...boxes.map(b => b.x)), top: Math.min(...boxes.map(b => b.y)),
    right: Math.max(...boxes.map(b => b.x + b.w)), bottom: Math.max(...boxes.map(b => b.y + b.h))
  }
}
const descendants = node => node.children.flatMap(child => [child.id, ...descendants(child)])
const centerX = position => position.x + position.w / 2

test('單一節點也能建概要', () => {
  const doc = createDefaultDoc()
  const [first] = doc.root.children
  assert.deepEqual(getSummaryRange(doc.root, [first.id], doc.layout), { parentId: doc.root.id, startNodeId: first.id, endNodeId: first.id })
  const command = createSummaryCommand(doc, [first.id])
  assert.ok(command.summary, '單節點應產生 summary')
  assert.equal(command.do(), true)
  const geometry = summaryGeometry(doc.summaries[0], doc.root, layout(doc, measure), doc.layout)
  assert.ok(geometry, '單節點概要應有幾何')
})

test('心智圖：括號放在覆蓋節點整棵子樹的右外側，不壓到子節點', () => {
  const doc = createDefaultDoc()
  const right = doc.root.children.filter(node => node.side === 'right')
  right[0].children.push(createNode('子節點很長很長很長', { side: 'right', children: [createNode('孫節點', { side: 'right' })] }))
  const positions = layout(doc, measure)
  createSummaryCommand(doc, right.map(node => node.id), {}, positions).do()
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout)
  const subtree = boxOf(positions, [...right.map(node => node.id), ...descendants(right[0])])
  const own = boxOf(positions, right.map(node => node.id))
  assert.ok(subtree.right > own.right, '前提：子樹比節點本身更寬')
  for (const point of pathPoints(geometry.path)) assert.ok(point.x >= subtree.right, `括號點 x=${point.x} 壓到子樹（子樹右緣 ${subtree.right}）`)
  assert.ok(geometry.labelX >= subtree.right, '標籤也在子樹外側')
  const ys = pathPoints(geometry.path).map(point => point.y)
  assert.ok(Math.min(...ys) <= subtree.top && Math.max(...ys) >= subtree.bottom, '括號沿 y 涵蓋整棵子樹')
})

test('組織圖：括號放在子樹底下', () => {
  const doc = createDefaultDoc()
  doc.layout = 'org'
  const [a, b] = doc.root.children
  a.children.push(createNode('a 的子節點', { children: [createNode('a 的孫節點')] }))
  const positions = layout(doc, measure)
  createSummaryCommand(doc, [a.id, b.id], {}, positions).do()
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout)
  const subtree = boxOf(positions, [a.id, b.id, ...descendants(a)])
  assert.equal(geometry.side, 'bottom')
  for (const point of pathPoints(geometry.path)) assert.ok(point.y >= subtree.bottom, `括號點 y=${point.y} 壓到子樹（子樹下緣 ${subtree.bottom}）`)
})

test('收合的子樹不計入：括號貼著節點本身', () => {
  const doc = createDefaultDoc()
  const right = doc.root.children.filter(node => node.side === 'right')
  right[0].children.push(createNode('看不見的子節點', { side: 'right' }))
  right[0].collapsed = true
  const positions = layout(doc, measure)
  assert.equal(positions.has(right[0].children[0].id), false, '前提：收合後代沒有位置')
  createSummaryCommand(doc, right.map(node => node.id), {}, positions).do()
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout)
  const own = boxOf(positions, right.map(node => node.id))
  const minX = Math.min(...pathPoints(geometry.path).map(point => point.x))
  assert.ok(minX >= own.right && minX < own.right + 60, `括號應貼著節點右緣（x=${minX}，節點右緣 ${own.right}）`)
})

test('魚骨圖：陣列順序與畫面相反時，相鄰判定與起訖把手都依畫面位置', () => {
  const doc = createDefaultDoc()
  doc.layout = 'fishbone'
  const [a, b, c] = doc.root.children
  const positions = layout(doc, measure)
  assert.ok(centerX(positions.get(a.id)) > centerX(positions.get(b.id)), '前提：魚骨圖 children[0] 在畫面最右')
  const range = getSummaryRange(doc.root, [a.id, b.id], doc.layout, positions)
  assert.ok(range, 'a、b 畫面相鄰 → 應可建概要')
  assert.equal(range.startNodeId, b.id, '起點是畫面上最左的節點')
  assert.equal(range.endNodeId, a.id)
  assert.equal(getSummaryRange(doc.root, [a.id, c.id], doc.layout, positions), null, 'a、c 中間隔著 b → 拒建')
  createSummaryCommand(doc, [a.id, b.id], {}, positions).do()
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout)
  const startHandle = geometry.boundaries.find(item => item.edge === 'startNodeId')
  const endHandle = geometry.boundaries.find(item => item.edge === 'endNodeId')
  assert.ok(startHandle.cx < centerX(positions.get(b.id)), 'startNodeId 把手在畫面最左節點的左邊')
  assert.ok(endHandle.cx > centerX(positions.get(a.id)), 'endNodeId 把手在畫面最右節點的右邊')
  // 舊文件可能存成陣列序（start=a、end=b）：讀取時要視為同一段，不可消失
  const covered = getSummaryNodes({ parentId: doc.root.id, startNodeId: a.id, endNodeId: b.id }, doc.root, doc.layout, positions)
  assert.deepEqual(covered.map(node => node.id).sort(), [a.id, b.id].sort())
})

test('父節點覆寫結構為組織圖：同級相鄰依實際排列，不依心智圖的左右分側', () => {
  const doc = createDefaultDoc()
  doc.root.style = { ...(doc.root.style || {}), structure: 'org' }
  const [a, b, c] = doc.root.children
  assert.notEqual(a.side, b.side, '前提：model 上 a、b 分屬左右')
  const positions = layout(doc, measure)
  assert.equal(positions.get(a.id).connector, 'org', '前提：實際以 org 排列')
  assert.ok(getSummaryRange(doc.root, [a.id, b.id], doc.layout, positions), '畫面相鄰的 a、b 應可建概要')
  assert.equal(getSummaryRange(doc.root, [a.id, c.id], doc.layout, positions), null, '中間隔著 b 的 a、c 應拒建')
})

test('組織圖裡的節點覆寫為心智圖：其子節點依左右分側判定相鄰', () => {
  const doc = createDefaultDoc()
  doc.layout = 'org'
  const [a] = doc.root.children
  a.style = { ...(a.style || {}), structure: 'mindmap-both' }
  a.children.push(createNode('a1', { side: 'left' }), createNode('a2', { side: 'right' }), createNode('a3', { side: 'left' }))
  const [a1, a2, a3] = a.children
  const positions = layout(doc, measure)
  assert.equal(positions.get(a1.id).connector, 'mindmap-both', '前提：a 的子節點以心智圖排列')
  assert.ok(getSummaryRange(doc.root, [a1.id, a3.id], doc.layout, positions), '同在左側且相鄰的 a1、a3 應可建概要')
  assert.equal(getSummaryRange(doc.root, [a1.id, a2.id], doc.layout, positions), null, '分屬左右的 a1、a2 應拒建')
})

test('目錄樹：根節點標題再長，括號仍在子節點縮排那一側', () => {
  const doc = createDefaultDoc()
  doc.layout = 'tree-right'
  doc.root.text = 'A very long central topic title for the tree layout'
  const positions = layout(doc, measure)
  const ids = doc.root.children.slice(0, 2).map(node => node.id)
  createSummaryCommand(doc, ids, {}, positions).do()
  assert.equal(summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout).side, 'right')
})

test('垂直時間軸：左右交錯的同級固定放右側，不隨文字寬度翻面', () => {
  for (const texts of [['Alpha', 'Beta'], ['Alpha', 'Beta 這個標題非常非常長'], ['Alpha 這個標題非常非常長', 'Beta']]) {
    const doc = createDefaultDoc()
    doc.layout = 'timeline-v'
    const [a, b] = doc.root.children
    a.text = texts[0]
    b.text = texts[1]
    const positions = layout(doc, measure)
    createSummaryCommand(doc, [a.id, b.id], {}, positions).do()
    assert.equal(summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout).side, 'right', `文字 ${texts.join('/')} 時應固定右側`)
  }
})

test('獨立心智圖夾在同級之間：不算進概要範圍', () => {
  const doc = createDefaultDoc()
  doc.layout = 'org'
  const floating = createNode('獨立圖', { icons: [`${FLOATING_PREFIX}900,-400`] })
  doc.root.children.splice(1, 0, floating)
  const [a, , b] = doc.root.children
  const positions = layout(doc, measure)
  assert.ok(positions.has(floating.id), '前提：獨立圖有位置')
  const range = getSummaryRange(doc.root, [a.id, b.id], doc.layout, positions)
  assert.ok(range, 'a、b 之間只隔獨立圖 → 仍算相鄰')
  createSummaryCommand(doc, [a.id, b.id], {}, positions).do()
  const covered = getSummaryNodes(doc.summaries[0], doc.root, doc.layout, positions)
  assert.equal(covered.some(node => node.id === floating.id), false, '獨立圖不在 covered 內')
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions, doc.layout)
  assert.ok(geometry.bounds.maxX < 900, `括號不可拉到獨立圖（maxX=${geometry.bounds.maxX}）`)
})
