/**
 * 概要括號方向（2026-09-15 晨睿：「概括只有橫向沒有縱向，要修正成根據主題變換方向」）。
 *
 * 使用者情境與過關標準（先寫測試、先紅後綠）：
 *   - 心智圖右側兩個同級 → 括號直立、貼在節點「右」外側，標籤與邊界控制點也在右側
 *   - 心智圖左側兩個同級 → 括號直立、貼在節點「左」外側（不可跑到右邊、不可壓進節點框）
 *   - 組織圖（同級水平排列）→ 括號橫向、放在節點「下」方，並橫跨所有覆蓋節點
 *   - 父節點在下方（例：自訂結構讓子節點排在上面）→ 括號橫向、放在節點「上」方
 *   - 子樹用 style.structure 覆寫成組織圖時，即使 doc.layout 是心智圖，仍以實際排列（connector）為準
 *   - 時間軸／魚骨圖同級沿 x 交錯排列 → 橫向；目錄樹、垂直時間軸沿 y 排列 → 直立
 * 不過關：方向錯、括號任何一點落進覆蓋節點的聯集框、標籤或控制點跑到相反側。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultDoc, createNode } from '../js/editor/model.js'
import { layout } from '../js/editor/layout.js'
import { createSummaryCommand, summaryGeometry } from '../js/editor/summary.js'

const measure = (node, depth) => ({
  w: Math.min(250, 36 + Math.max(...node.text.split('\n').map(line => line.length), 1) * 7 + (depth === 0 ? 28 : 0)),
  h: 28 + (node.text.split('\n').length - 1) * 18
})

// 把 path 的 "M x y C x y, x y, x y ..." 拆成點座標
function pathPoints(path) {
  const numbers = (path.match(/-?\d+(?:\.\d+)?/gu) || []).map(Number)
  const points = []
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] })
  return points
}

function union(positions, ids) {
  const boxes = ids.map(id => positions.get(id))
  return {
    left: Math.min(...boxes.map(box => box.x)),
    top: Math.min(...boxes.map(box => box.y)),
    right: Math.max(...boxes.map(box => box.x + box.w)),
    bottom: Math.max(...boxes.map(box => box.y + box.h))
  }
}

// 建概要（走真正的 command）並回傳幾何
function geometryFor(doc, ids, positions) {
  const command = createSummaryCommand(doc, ids)
  assert.ok(command.summary, `應能對 ${ids.join(',')} 建概要`)
  assert.equal(command.do(), true)
  return summaryGeometry(command.summary, doc.root, positions, doc.layout)
}

// 共同斷言：括號所有點、標籤、控制點都在聯集框「指定側」的外面
function assertOutside(geometry, box, side) {
  const points = pathPoints(geometry.path)
  const controls = geometry.boundaries.map(item => ({ x: item.cx, y: item.cy }))
  const label = { x: geometry.labelX, y: geometry.labelY }
  const all = [...points, ...controls, label]
  const check = {
    right: point => point.x >= box.right,
    left: point => point.x <= box.left,
    bottom: point => point.y >= box.bottom,
    top: point => point.y <= box.top
  }[side]
  for (const point of all) assert.ok(check(point), `點 (${point.x},${point.y}) 應在節點框 ${side} 側外（框=${JSON.stringify(box)}）`)
  // 標籤要比括號更外側
  const outermost = { right: Math.max, left: Math.min, bottom: Math.max, top: Math.min }[side]
  const axisOf = point => (side === 'right' || side === 'left') ? point.x : point.y
  assert.equal(outermost(...points.map(axisOf), axisOf(label)), axisOf(label), '標籤應在括號的更外側')
}

// 括號沿主軸要涵蓋所有覆蓋節點（直立看 y、橫向看 x）
function assertSpans(geometry, box, orientation) {
  const points = pathPoints(geometry.path)
  if (orientation === 'vertical') {
    assert.ok(Math.min(...points.map(point => point.y)) <= box.top, '括號頂端應不低於最上節點')
    assert.ok(Math.max(...points.map(point => point.y)) >= box.bottom, '括號底端應不高於最下節點')
  } else {
    assert.ok(Math.min(...points.map(point => point.x)) <= box.left, '括號左端應不超過最左節點')
    assert.ok(Math.max(...points.map(point => point.x)) >= box.right, '括號右端應不少於最右節點')
  }
}

test('心智圖右側同級：括號直立、放在節點右外側', () => {
  const doc = createDefaultDoc()
  const positions = layout(doc, measure)
  const ids = doc.root.children.filter(node => node.side === 'right').map(node => node.id)
  const geometry = geometryFor(doc, ids, positions)
  assert.equal(geometry.orientation, 'vertical')
  assert.equal(geometry.side, 'right')
  assertOutside(geometry, union(positions, ids), 'right')
  assertSpans(geometry, union(positions, ids), 'vertical')
})

test('心智圖左側同級：括號直立、放在節點左外側（不可跑到右邊）', () => {
  const doc = createDefaultDoc()
  const positions = layout(doc, measure)
  const ids = doc.root.children.filter(node => node.side === 'left').map(node => node.id)
  const geometry = geometryFor(doc, ids, positions)
  assert.equal(geometry.orientation, 'vertical')
  assert.equal(geometry.side, 'left')
  assertOutside(geometry, union(positions, ids), 'left')
  assertSpans(geometry, union(positions, ids), 'vertical')
})

test('組織圖：同級水平排列 → 括號橫向、放在節點下方並橫跨所有節點', () => {
  const doc = createDefaultDoc()
  doc.layout = 'org'
  const positions = layout(doc, measure)
  const ids = doc.root.children.slice(0, 2).map(node => node.id)
  const geometry = geometryFor(doc, ids, positions)
  assert.equal(geometry.orientation, 'horizontal')
  assert.equal(geometry.side, 'bottom')
  assertOutside(geometry, union(positions, ids), 'bottom')
  assertSpans(geometry, union(positions, ids), 'horizontal')
})

test('父節點在下方時：橫向括號改放在節點上方', () => {
  const parent = createNode('父', { children: [createNode('a'), createNode('b')] })
  const [a, b] = parent.children
  const doc = { root: parent, layout: 'org', summaries: [] }
  const positions = new Map([
    [parent.id, { x: 100, y: 300, w: 100, h: 36, connector: null }],
    [a.id, { x: 0, y: 100, w: 100, h: 36, connector: 'org' }],
    [b.id, { x: 200, y: 100, w: 100, h: 36, connector: 'org' }]
  ])
  const geometry = geometryFor(doc, [a.id, b.id], positions)
  assert.equal(geometry.orientation, 'horizontal')
  assert.equal(geometry.side, 'top')
  assertOutside(geometry, union(positions, [a.id, b.id]), 'top')
})

test('子樹覆寫結構：doc.layout 是心智圖但實際以 org 排列 → 依 connector 判定為橫向', () => {
  const parent = createNode('父', { children: [createNode('a'), createNode('b')] })
  const [a, b] = parent.children
  const doc = { root: parent, layout: 'mindmap-both', summaries: [] }
  const positions = new Map([
    [parent.id, { x: 100, y: 0, w: 100, h: 36, connector: null }],
    [a.id, { x: 0, y: 100, w: 100, h: 36, connector: 'org' }],
    [b.id, { x: 200, y: 100, w: 100, h: 36, connector: 'org' }]
  ])
  const geometry = geometryFor(doc, [a.id, b.id], positions)
  assert.equal(geometry.orientation, 'horizontal')
  assert.equal(geometry.side, 'bottom')
  assertOutside(geometry, union(positions, [a.id, b.id]), 'bottom')
})

test('時間軸／魚骨圖（沿 x 交錯）→ 橫向；目錄樹／垂直時間軸（沿 y）→ 直立', () => {
  const expectations = {
    'timeline-h': 'horizontal',
    fishbone: 'horizontal',
    'tree-right': 'vertical',
    'timeline-v': 'vertical',
    'mindmap-left': 'vertical'
  }
  for (const [layoutName, orientation] of Object.entries(expectations)) {
    const doc = createDefaultDoc()
    doc.layout = layoutName
    const positions = layout(doc, measure)
    const ids = doc.root.children.slice(0, 2).map(node => node.id)
    const geometry = geometryFor(doc, ids, positions)
    assert.equal(geometry.orientation, orientation, `${layoutName} 應為 ${orientation}`)
    const box = union(positions, ids)
    assertOutside(geometry, box, geometry.side)
    assertSpans(geometry, box, orientation)
  }
  // 向左邏輯圖：父在右 → 括號在左
  const doc = createDefaultDoc()
  doc.layout = 'mindmap-left'
  const positions = layout(doc, measure)
  const geometry = geometryFor(doc, doc.root.children.slice(0, 2).map(node => node.id), positions)
  assert.equal(geometry.side, 'left')
})

test('邊界控制點跟著方向：直立時同 x、橫向時同 y，分別落在括號兩端', () => {
  const doc = createDefaultDoc()
  const verticalPositions = layout(doc, measure)
  const rightIds = doc.root.children.filter(node => node.side === 'right').map(node => node.id)
  const vertical = geometryFor(doc, rightIds, verticalPositions)
  assert.equal(vertical.boundaries.length, 2)
  assert.equal(vertical.boundaries[0].cx, vertical.boundaries[1].cx)
  assert.ok(vertical.boundaries[0].cy < vertical.boundaries[1].cy)

  const orgDoc = createDefaultDoc()
  orgDoc.layout = 'org'
  const horizontalPositions = layout(orgDoc, measure)
  const horizontal = geometryFor(orgDoc, orgDoc.root.children.slice(0, 2).map(node => node.id), horizontalPositions)
  assert.equal(horizontal.boundaries[0].cy, horizontal.boundaries[1].cy)
  assert.ok(horizontal.boundaries[0].cx < horizontal.boundaries[1].cx)
  assert.deepEqual(horizontal.boundaries.map(item => item.edge), ['startNodeId', 'endNodeId'])
})
