/**
 * ARROWS 空間導覽測試：演算法只看可見座標，不耦合任何佈局名稱或樹階層。
 */
import assert from 'node:assert/strict'
import { createDefaultDoc, createNode } from '../js/editor/model.js'
import { layout } from '../js/editor/layout.js'
import { KeyboardController } from '../js/editor/keyboard.js'
import { PresentationController } from '../js/editor/presentation.js'
import { SelectionManager, findDirectionalTarget } from '../js/editor/selection.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const measure = (_node, depth) => ({ w: depth === 0 ? 100 : 80, h: 32 })

function createSingleBranchDoc(layoutName) {
  const doc = createDefaultDoc()
  doc.layout = layoutName
  doc.root.children = [createNode('目標', {
    id: `${layoutName}-target`,
    side: layoutName === 'mindmap-both' ? 'right' : null
  })]
  return doc
}

function assertLayoutNavigation(layoutName, direction) {
  const doc = createSingleBranchDoc(layoutName)
  const positions = layout(doc, measure)
  assert.equal(
    findDirectionalTarget(positions, doc.root.id, direction),
    doc.root.children[0].id,
    `${layoutName} 的 ${direction} 導覽未選到視覺方向最近節點`
  )
}

test('心智圖佈局以右方向選中右側分支', () => {
  assertLayoutNavigation('mindmap-both', 'right')
})

test('邏輯結構圖以右方向選中層疊分支', () => {
  assertLayoutNavigation('mindmap-right', 'right')
})

test('時間軸佈局以右方向選中第一個事件', () => {
  assertLayoutNavigation('timeline-h', 'right')
})

test('組織結構圖以下方向選中下層節點', () => {
  assertLayoutNavigation('org', 'down')
})

test('目錄結構圖以下方向選中右下縮排節點', () => {
  assertLayoutNavigation('tree-right', 'down')
})

test('魚骨圖以左方向選中第一根分支', () => {
  assertLayoutNavigation('fishbone', 'left')
})

test('候選只取方向 90 度圓錐內節點', () => {
  const positions = new Map([
    ['current', box(0, 0)],
    ['inside-edge', box(100, 100)],
    ['outside', box(90, 100)],
    ['behind', box(-20, 0)]
  ])
  assert.equal(findDirectionalTarget(positions, 'current', 'right'), 'inside-edge')
})

test('偏軸距離加權，優先選取軸向對齊節點', () => {
  const positions = new Map([
    ['current', box(0, 0)],
    ['aligned', box(100, 0)],
    ['diagonal-shortcut', box(60, 40)]
  ])
  assert.equal(findDirectionalTarget(positions, 'current', 'right'), 'aligned')
})

test('positions 未包含的摺疊後代不會成為候選', () => {
  const doc = createDefaultDoc()
  const hidden = createNode('隱藏後代', { id: 'hidden-descendant' })
  const collapsed = createNode('已摺疊', {
    id: 'collapsed-parent',
    side: 'right',
    collapsed: true,
    children: [hidden]
  })
  doc.root.children = [collapsed]
  const positions = layout(doc, measure)
  assert.equal(positions.has(hidden.id), false)
  assert.equal(findDirectionalTarget(positions, doc.root.id, 'right'), collapsed.id)
})

test('懸浮節點與一般可見節點共用座標候選池', () => {
  const positions = new Map([
    ['current', box(0, 0)],
    ['tree-node', box(160, 0)],
    ['floating-node', box(70, 0)]
  ])
  assert.equal(findDirectionalTarget(positions, 'current', 'right'), 'floating-node')
})

test('未選取時任意方向鍵只選中根節點', () => {
  const doc = createSingleBranchDoc('mindmap-right')
  const positions = layout(doc, measure)
  for (const direction of ['up', 'down', 'left', 'right']) {
    const selection = {
      primaryId: null,
      getDoc: () => doc,
      getPositions: () => positions,
      set(ids) { this.primaryId = ids[0] || null }
    }
    const selectedId = SelectionManager.prototype.navigate.call(selection, direction)
    assert.equal(selectedId, doc.root.id, direction)
    assert.equal(selection.primaryId, doc.root.id, direction)
  }
})

test('演示模式優先 consume 四方向鍵，且上下鍵對應前後步驟', () => {
  const controller = Object.create(PresentationController.prototype)
  const calls = []
  controller.active = true
  controller.previous = () => calls.push('previous')
  controller.next = () => calls.push('next')

  for (const [key, expected] of [
    ['ArrowUp', 'previous'],
    ['ArrowLeft', 'previous'],
    ['ArrowDown', 'next'],
    ['ArrowRight', 'next']
  ]) {
    const eventTarget = new EventTarget()
    let globalHandlerCalls = 0
    eventTarget.addEventListener('keydown', event => controller.onKeydown(event), { capture: true })
    eventTarget.addEventListener('keydown', () => { globalHandlerCalls += 1 })
    const event = new Event('keydown', { cancelable: true })
    Object.defineProperty(event, 'key', { value: key })

    eventTarget.dispatchEvent(event)

    assert.equal(event.defaultPrevented, true, `${key} 未被演示模式 consume`)
    assert.equal(globalHandlerCalls, 0, `${key} 洩漏到全域 keyboard handler`)
    assert.equal(calls.at(-1), expected, `${key} 步驟語意錯誤`)
  }
  assert.deepEqual(calls, ['previous', 'previous', 'next', 'next'])
})

test('純大綱模式四方向鍵為 no-op，不 consume 事件也不驅動隱藏 map selection', () => {
  const doc = createSingleBranchDoc('mindmap-right')
  const positions = layout(doc, measure)
  let navigateCalls = 0
  const selection = {
    canvas: { hidden: true },
    primaryId: doc.root.id,
    navigate() { navigateCalls += 1 },
    getSelectedIds: () => [doc.root.id],
    selectAll() {},
    clear() {}
  }
  const controller = new KeyboardController({
    doc,
    manager: {},
    selection,
    viewport: {},
    edit: { isEditing: false, start() {} },
    save() {},
    getPositions: () => positions
  })

  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const event = keyboardEvent(key)
    controller.handleKeydown(event)
    assert.equal(event.defaultPrevented, false, key)
  }
  assert.equal(navigateCalls, 0)

  const directSelection = {
    canvas: { hidden: true },
    primaryId: doc.root.id,
    getDoc: () => doc,
    getPositions: () => positions,
    set() { throw new Error('隱藏 map 不得更新 selection') }
  }
  assert.equal(SelectionManager.prototype.navigate.call(directSelection, 'right'), null)
  assert.equal(directSelection.primaryId, doc.root.id)
})

function box(x, y, w = 20, h = 20) {
  return { x, y, w, h }
}

function keyboardEvent(key) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true }
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

console.log(`\n${passed}/${tests.length} ARROWS spatial navigation tests passed`)
