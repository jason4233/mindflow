/**
 * Phase A 純函數自測：直接以 Node 執行，不需要 DOM 或外部套件。
 */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  chooseBalancedSide,
  createDefaultDoc,
  createNode,
  deserializeDoc,
  findNode,
  normalizeDoc,
  serializeDoc,
  walkNodes
} from '../js/editor/model.js'
import {
  CommandManager,
  addChild,
  addSiblingAfter,
  addSiblingBefore,
  deleteNodes,
  moveNode,
  setStyle,
  toggleCollapse,
  updateText
} from '../js/editor/commands.js'
import { getLayoutBounds, layout } from '../js/editor/layout.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const measure = (node, depth) => ({
  w: Math.min(250, 36 + Math.max(...node.text.split('\n').map(line => line.length), 1) * 7 + (depth === 0 ? 28 : 0)),
  h: 28 + (node.text.split('\n').length - 1) * 18
})

test('預設 Doc 符合 v1 schema，中心主題有四個左右平衡分支', () => {
  const doc = createDefaultDoc()
  assert.equal(doc.layout, 'mindmap-both')
  assert.equal(doc.themeId, 'classic-blue')
  assert.equal(doc.root.text, '中心主題')
  assert.equal(doc.root.children.length, 4)
  assert.deepEqual(doc.root.children.map(node => node.side), ['right', 'left', 'right', 'left'])
  assert.deepEqual(doc.canvas, { background: '#f5f5f5', watermark: false })
  const ids = []
  walkNodes(doc.root, node => {
    ids.push(node.id)
    assert.ok(Array.isArray(node.children))
    assert.ok(Array.isArray(node.icons))
    assert.equal(typeof node.style, 'object')
  })
  assert.equal(new Set(ids).size, ids.length)
})

test('序列化、反序列化與損壞欄位正規化可穩定往返', () => {
  const doc = createDefaultDoc({ title: '往返測試' })
  const restored = deserializeDoc(serializeDoc(doc))
  assert.deepEqual(restored, doc)

  const normalized = normalizeDoc({ root: { id: 'same', children: [{ id: 'same' }] }, layout: 'invalid' })
  assert.equal(normalized.layout, 'mindmap-both')
  assert.notEqual(normalized.root.id, normalized.root.children[0].id)
})

test('addChild 自動平衡左右側且 undo/redo 保留同一節點', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const command = addChild(doc, doc.root.id, undefined, { text: '新增分支' })
  assert.equal(manager.execute(command), true)
  assert.equal(findNode(doc.root, command.nodeId).side, 'left')
  manager.undo()
  assert.equal(findNode(doc.root, command.nodeId), null)
  manager.redo()
  assert.equal(findNode(doc.root, command.nodeId).text, '新增分支')
})

test('同級前後新增、刪除整棵子樹與 undo 正確恢復順序', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const anchor = doc.root.children[0]
  const before = addSiblingBefore(doc, anchor.id, { text: '前' })
  const after = addSiblingAfter(doc, anchor.id, { text: '後' })
  manager.execute(before)
  manager.execute(after)
  assert.deepEqual(doc.root.children.slice(0, 3).map(node => node.text), ['前', '分支主題', '後'])

  const nested = addChild(doc, anchor.id, undefined, { text: '會一起刪除' })
  manager.execute(nested)
  manager.execute(deleteNodes(doc, [anchor.id, nested.nodeId]))
  assert.equal(findNode(doc.root, anchor.id), null)
  assert.equal(findNode(doc.root, nested.nodeId), null)
  manager.undo()
  assert.equal(findNode(doc.root, anchor.id).children[0].id, nested.nodeId)
})

test('moveNode 可換父、排序、左右側，且拒絕移入自身後代', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const moving = doc.root.children[0]
  const newParent = doc.root.children[1]
  const oldIndex = doc.root.children.indexOf(moving)
  manager.execute(moveNode(doc, moving.id, newParent.id, 0))
  assert.equal(newParent.children[0].id, moving.id)
  assert.equal(moving.side, null)
  assert.equal(manager.execute(moveNode(doc, newParent.id, moving.id, 0)), false)
  manager.undo()
  assert.equal(doc.root.children[oldIndex].id, moving.id)
  assert.equal(moving.side, 'right')

  manager.execute(moveNode(doc, moving.id, doc.root.id, 3, 'left'))
  assert.equal(moving.side, 'left')
})

test('toggleCollapse、setStyle 與 updateText 都能完整復原', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const node = doc.root.children[0]
  manager.execute(addChild(doc, node.id, undefined, { text: '子節點' }))
  manager.execute(toggleCollapse(doc, node.id))
  manager.execute(setStyle(doc, [node.id], { fill: '#000000', bold: true, unknown: 1 }))
  manager.execute(updateText(doc, node.id, '新文字'))
  assert.equal(node.collapsed, true)
  assert.deepEqual(node.style, { fill: '#000000', bold: true })
  assert.equal(node.text, '新文字')
  manager.undo()
  manager.undo()
  manager.undo()
  assert.equal(node.text, '分支主題')
  assert.deepEqual(node.style, {})
  assert.equal(node.collapsed, false)
})

test('連續 20 次 undo/redo 不破壞文字狀態，且新命令清空 redo', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const id = doc.root.children[0].id
  for (let index = 1; index <= 20; index += 1) manager.execute(updateText(doc, id, `版本 ${index}`))
  assert.equal(findNode(doc.root, id).text, '版本 20')
  for (let index = 0; index < 20; index += 1) assert.equal(manager.undo(), true)
  assert.equal(findNode(doc.root, id).text, '分支主題')
  for (let index = 0; index < 20; index += 1) assert.equal(manager.redo(), true)
  assert.equal(findNode(doc.root, id).text, '版本 20')
  manager.undo()
  manager.execute(updateText(doc, id, '新分支歷史'))
  assert.equal(manager.canRedo, false)
})

test('undo stack 嚴格限制 100 步', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager({ limit: 100 })
  const id = doc.root.children[0].id
  for (let index = 0; index < 120; index += 1) manager.execute(updateText(doc, id, `步驟 ${index}`))
  assert.equal(manager.undoStack.length, 100)
  for (let index = 0; index < 100; index += 1) manager.undo()
  assert.equal(findNode(doc.root, id).text, '步驟 19')
})

test('mindmap-both 根在中央、左右展開，layout 不修改 Doc', () => {
  const doc = createDefaultDoc()
  const before = serializeDoc(doc)
  const positions = layout(doc, measure)
  const root = positions.get(doc.root.id)
  assert.equal(positions.size, 5)
  for (const child of doc.root.children) {
    const position = positions.get(child.id)
    if (child.side === 'left') assert.ok(position.x + position.w < root.x)
    else assert.ok(position.x > root.x + root.w)
  }
  assertNoOverlaps(positions)
  assert.equal(serializeDoc(doc), before)
})

test('mindmap-right 忽略 side 全向右，兄弟垂直間距至少 12px', () => {
  const doc = createDefaultDoc({ layout: 'mindmap-right' })
  const positions = layout(doc, measure)
  const root = positions.get(doc.root.id)
  const children = doc.root.children.map(child => positions.get(child.id)).sort((a, b) => a.y - b.y)
  assert.ok(children.every(position => position.x > root.x + root.w))
  for (let index = 1; index < children.length; index += 1) {
    assert.ok(children[index].y - (children[index - 1].y + children[index - 1].h) >= 12)
  }
  assertNoOverlaps(positions)
})

test('摺疊後代不佔版面且展開可還原所有座標項目', () => {
  const doc = createDefaultDoc()
  const branch = doc.root.children[0]
  branch.children.push(createNode('A', { children: [createNode('B')] }), createNode('C'))
  const expanded = layout(doc, measure)
  branch.collapsed = true
  const collapsed = layout(doc, measure)
  assert.equal(expanded.size, 8)
  assert.equal(collapsed.size, 5)
  assert.ok(collapsed.has(branch.id))
  assertNoOverlaps(collapsed)
})

test('左右平衡依可見子樹總高度，而非只看直接分支數', () => {
  const root = createNode('root', {
    children: [
      createNode('高左', { side: 'left', children: [createNode('1'), createNode('2'), createNode('3')] }),
      createNode('低右', { side: 'right' })
    ]
  })
  assert.equal(chooseBalancedSide(root), 'right')
})

test('150 節點 layout 在合理時間內完成、座標有限且 bounds 正確', () => {
  const doc = createDefaultDoc({ layout: 'mindmap-right' })
  doc.root.children = []
  for (let index = 0; index < 15; index += 1) {
    const branch = createNode(`分支 ${index}`)
    for (let child = 0; child < 9; child += 1) branch.children.push(createNode(`節點 ${index}-${child}`))
    doc.root.children.push(branch)
  }
  const started = performance.now()
  const positions = layout(doc, measure)
  const elapsed = performance.now() - started
  assert.equal(positions.size, 151)
  assert.ok(elapsed < 1000, `layout 耗時 ${elapsed.toFixed(1)}ms`)
  for (const position of positions.values()) {
    assert.ok([position.x, position.y, position.w, position.h].every(Number.isFinite))
  }
  const bounds = getLayoutBounds(positions)
  assert.ok(bounds.width > 0 && bounds.height > 0)
  assertNoOverlaps(positions)
})

function assertNoOverlaps(positions) {
  const entries = Array.from(positions.entries())
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const [leftId, a] = entries[left]
      const [rightId, b] = entries[right]
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      assert.equal(overlaps, false, `${leftId} 與 ${rightId} 發生重疊`)
    }
  }
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

console.log(`\n${passed}/${tests.length} tests passed`)
