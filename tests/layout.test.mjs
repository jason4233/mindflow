/**
 * GAMMA 佈局純函數測試：覆蓋全域變體、局部 structure 與特殊連接線。
 */
import assert from 'node:assert/strict'
import { createDefaultDoc, createNode } from '../js/editor/model.js'
import {
  LAYOUT_DEFINITIONS,
  createLayoutPreviewSvg,
  layout,
  normalizeLayoutName
} from '../js/editor/layout.js'
import { getConnectionPath } from '../js/editor/render.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const measure = (node, depth) => ({
  w: Math.min(190, 70 + node.text.length * 5 + depth * 2),
  h: 30 + (node.text.split('\n').length - 1) * 18
})

function createLayoutDoc(layoutName) {
  const doc = createDefaultDoc()
  doc.layout = layoutName
  doc.root.children = Array.from({ length: 6 }, (_, branchIndex) => createNode(`分支 ${branchIndex + 1}`, {
    side: branchIndex % 2 === 0 ? 'right' : 'left',
    children: Array.from({ length: 3 }, (_, childIndex) => createNode(`節點 ${branchIndex + 1}-${childIndex + 1}`, {
      children: childIndex === 0 ? [createNode(`細節 ${branchIndex + 1}`)] : []
    }))
  }))
  return doc
}

test('八個全域變體皆產生有限且無重疊座標', () => {
  for (const { id } of LAYOUT_DEFINITIONS) {
    const doc = createLayoutDoc(id)
    const before = JSON.stringify(doc)
    const positions = layout(doc, measure)
    assert.equal(positions.size, 31, `${id} 節點數錯誤`)
    assertNoOverlaps(positions, id)
    for (const position of positions.values()) {
      assert.ok([position.x, position.y, position.w, position.h].every(Number.isFinite), `${id} 有非有限座標`)
    }
    assert.equal(JSON.stringify(doc), before, `${id} 修改了輸入 Doc`)
  }
})

test('mindmap 雙向平衡，logic-right/left 單向層疊', () => {
  const mindmap = createLayoutDoc('mindmap')
  const mindPositions = layout(mindmap, measure)
  const mindRoot = mindPositions.get(mindmap.root.id)
  assert.ok(mindmap.root.children.some(node => mindPositions.get(node.id).x < mindRoot.x))
  assert.ok(mindmap.root.children.some(node => mindPositions.get(node.id).x > mindRoot.x + mindRoot.w))

  for (const [name, direction] of [['logic-right', 1], ['logic-left', -1]]) {
    const doc = createLayoutDoc(name)
    const positions = layout(doc, measure)
    const root = positions.get(doc.root.id)
    assert.ok(doc.root.children.every(node => direction > 0
      ? positions.get(node.id).x > root.x + root.w
      : positions.get(node.id).x + positions.get(node.id).w < root.x), name)
  }
})

test('org 向下、tree 縮排，局部 structure 只改指定子樹', () => {
  const org = createLayoutDoc('org')
  const orgPositions = layout(org, measure)
  const orgRoot = orgPositions.get(org.root.id)
  assert.ok(org.root.children.every(node => orgPositions.get(node.id).y > orgRoot.y + orgRoot.h))

  const tree = createLayoutDoc('tree')
  const treePositions = layout(tree, measure)
  const branch = tree.root.children[0]
  assert.ok(treePositions.get(branch.id).x > treePositions.get(tree.root.id).x)
  assert.ok(treePositions.get(branch.children[0].id).x > treePositions.get(branch.id).x)

  const mixed = createLayoutDoc('logic-right')
  const localBranch = mixed.root.children[0]
  localBranch.style.structure = 'org'
  const mixedPositions = layout(mixed, measure)
  const localPosition = mixedPositions.get(localBranch.id)
  assert.ok(localBranch.children.every(node => mixedPositions.get(node.id).y > localPosition.y + localPosition.h))
  const normalBranch = mixed.root.children[1]
  assert.ok(normalBranch.children.every(node => mixedPositions.get(node.id).x > mixedPositions.get(normalBranch.id).x))
  assertNoOverlaps(mixedPositions, '局部 structure')
})

test('timeline-h/v 主軸順序與交錯方向合理', () => {
  const horizontal = createLayoutDoc('timeline-h')
  const hPositions = layout(horizontal, measure)
  const hRoot = hPositions.get(horizontal.root.id)
  const hChildren = horizontal.root.children.map(node => hPositions.get(node.id))
  assertStrictlyIncreasing(hChildren.map(position => position.x))
  assert.ok(hChildren.filter((_item, index) => index % 2 === 0).every(position => position.y + position.h < hRoot.y))
  assert.ok(hChildren.filter((_item, index) => index % 2 === 1).every(position => position.y > hRoot.y + hRoot.h))

  const vertical = createLayoutDoc('timeline-v')
  const vPositions = layout(vertical, measure)
  const vRoot = vPositions.get(vertical.root.id)
  const vChildren = vertical.root.children.map(node => vPositions.get(node.id))
  assertStrictlyIncreasing(vChildren.map(position => position.y))
  assert.ok(vChildren.filter((_item, index) => index % 2 === 0).every(position => position.x + position.w < vRoot.x))
  assert.ok(vChildren.filter((_item, index) => index % 2 === 1).every(position => position.x > vRoot.x + vRoot.w))
})

test('fishbone 根節點在右，主骨由右往左且上下交錯', () => {
  const doc = createLayoutDoc('fishbone')
  const positions = layout(doc, measure)
  const root = positions.get(doc.root.id)
  const children = doc.root.children.map(node => positions.get(node.id))
  assert.ok(children.every(position => position.x + position.w < root.x))
  assertStrictlyDecreasing(children.map(position => position.x))
  assert.ok(children.filter((_item, index) => index % 2 === 0).every(position => position.y + position.h < root.y))
  assert.ok(children.filter((_item, index) => index % 2 === 1).every(position => position.y > root.y + root.h))
  assertNoOverlaps(positions, 'fishbone')
})

test('org/tree/fishbone 連接線分別使用 elbow、直角與斜骨路徑', () => {
  const parent = { x: 0, y: 0, w: 90, h: 34 }
  const child = { x: 150, y: 100, w: 80, h: 30 }
  const org = getConnectionPath(parent, child, 'curved', 'org')
  const tree = getConnectionPath(parent, child, 'curved', 'tree-right')
  const fishbone = getConnectionPath(parent, { ...child, x: -180 }, 'curved', 'fishbone')
  assert.equal((org.match(/ L /g) || []).length, 3)
  assert.equal((tree.match(/ L /g) || []).length, 2)
  assert.equal((fishbone.match(/ L /g) || []).length, 2)
  assert.doesNotMatch(fishbone, /[CQ]/)
})

test('別名與 Layout mini-SVG 完整且不依賴點陣圖', () => {
  assert.equal(normalizeLayoutName('mindmap'), 'mindmap-both')
  assert.equal(normalizeLayoutName('logic-right'), 'mindmap-right')
  assert.equal(normalizeLayoutName('logic-left'), 'mindmap-left')
  assert.equal(normalizeLayoutName('tree'), 'tree-right')
  for (const { id } of LAYOUT_DEFINITIONS) {
    const svg = createLayoutPreviewSvg(id)
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/)
    assert.doesNotMatch(svg, /<(?:image|foreignObject)\b/i)
    assert.ok((svg.match(/<rect\b/g) || []).length >= 5)
  }
})

function assertNoOverlaps(positions, label) {
  const entries = Array.from(positions.entries())
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const [leftId, a] = entries[left]
      const [rightId, b] = entries[right]
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      assert.equal(overlaps, false, `${label}: ${leftId} 與 ${rightId} 重疊`)
    }
  }
}

function assertStrictlyIncreasing(values) {
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index] > values[index - 1])
}

function assertStrictlyDecreasing(values) {
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index] < values[index - 1])
}

let passed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

console.log(`\n${passed}/${tests.length} GAMMA layout tests passed`)
