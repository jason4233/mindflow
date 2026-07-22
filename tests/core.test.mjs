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
  updateRichText,
  updateText
} from '../js/editor/commands.js'
import { getLayoutBounds, layout } from '../js/editor/layout.js'
import { getRegisteredActionNames, hasAction, registerAction, runAction } from '../js/editor/actions.js'
import { ACTION_BINDINGS, assertRegisteredActions, dispatchGlobalShortcut, findShortcutBinding } from '../js/editor/keyboard.js'
import {
  createThemePreviewSvg,
  encodeLineToken,
  encodeStyleToken,
  getNodeAppearance,
  getTheme,
  getThemeList,
  parseLineToken,
  parseStyleToken
} from '../js/editor/themes.js'

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
  assert.deepEqual(doc.canvas, {
    background: '#f5f5f5',
    watermark: { enabled: false, text: 'MindFlow', color: '#64748b', rotation: 'left', opacity: 12, size: 18 },
    spacingH: 30,
    spacingV: 30
  })
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

test('batch 將文字、richText 與樣式視為單一 undo/redo 記錄', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  node.richText = '<b>舊文字</b>'
  const manager = new CommandManager()

  assert.equal(manager.batch('編輯節點文字', [
    updateText(doc, node.id, '新文字'),
    updateRichText(doc, node.id, '<i>新文字</i>'),
    setStyle(doc, [node.id], { align: 'right', lineHeight: 1.8 })
  ]), true)
  assert.equal(manager.undoStack.length, 1)
  assert.deepEqual([node.text, node.richText, node.style.align, node.style.lineHeight], ['新文字', '<i>新文字</i>', 'right', 1.8])

  assert.equal(manager.undo(), true)
  assert.equal(node.text, '分支主題')
  assert.equal(node.richText, '<b>舊文字</b>')
  assert.deepEqual(node.style, {})
  assert.equal(manager.redo(), true)
  assert.equal(node.text, '新文字')
  assert.equal(node.richText, '<i>新文字</i>')
})

test('無變化 command 不入棧且不清空 redo', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  node.style.fill = '#fff'
  const manager = new CommandManager()
  manager.execute(updateText(doc, node.id, '暫存版本'))
  manager.undo()
  assert.equal(manager.canRedo, true)
  assert.equal(manager.execute(setStyle(doc, [node.id], { fill: '#fff' })), false)
  assert.equal(manager.undoStack.length, 0)
  assert.equal(manager.canRedo, true)
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

test('action registry 可註冊、執行、覆寫並以精確 cleanup 移除', () => {
  const name = 'test.alpha.registry'
  const unregisterOld = registerAction(name, value => value + 1)
  assert.equal(hasAction(name), true)
  assert.equal(runAction(name, 4), 5)
  const unregisterNew = registerAction(name, value => value * 3)
  unregisterOld()
  assert.equal(runAction(name, 4), 12)
  assert.ok(getRegisteredActionNames().includes(name))
  unregisterNew()
  assert.equal(hasAction(name), false)
  assert.equal(runAction(name), false)
})

test('ALPHA 快捷鍵表對齊 SPEC，且明確移除 Phase A 錯誤綁定', () => {
  const hasBinding = (action, key, modifiers = {}) => ACTION_BINDINGS.some(binding => binding.action === action
    && binding.key === key
    && Boolean(binding.ctrl) === Boolean(modifiers.ctrl)
    && Boolean(binding.shift) === Boolean(modifiers.shift)
    && Boolean(binding.alt) === Boolean(modifiers.alt))

  assert.equal(hasBinding('insertParent', 'Tab', { shift: true }), true)
  assert.equal(hasBinding('toggleCollapse', '/', { ctrl: true }), true)
  assert.equal(hasBinding('dissolve', 'Delete', { ctrl: true }), true)
  assert.equal(hasBinding('duplicate', 'd', { ctrl: true }), true)
  assert.equal(hasBinding('fit', 'f', { ctrl: true, alt: true }), true)
  assert.equal(hasBinding('centerRoot', 'r', { ctrl: true, shift: true }), true)
  assert.equal(hasBinding('openThemePanel', 'p', { ctrl: true }), true)
  assert.equal(hasBinding('openStylePanel', 'y', { alt: true }), true)
  assert.equal(hasBinding('edit', ' '), true)
  assert.equal(ACTION_BINDINGS.some(binding => binding.key === 'F2'), false)
  assert.equal(ACTION_BINDINGS.some(binding => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(binding.key) && !binding.alt && !binding.shift), false)
  assert.equal(ACTION_BINDINGS.some(binding => binding.key === 'f' && binding.ctrl && binding.shift), false)
})

test('焦點守衛放行一般輸入與原生剪貼簿，但攔截全域瀏覽器衝突鍵', () => {
  const calls = []
  const cleanups = [
    registerAction('save', () => calls.push('save')),
    registerAction('duplicate', () => calls.push('duplicate')),
    registerAction('priority1', () => calls.push('priority1'))
  ]
  const event = (key, modifiers = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    prevented: false,
    preventDefault() { this.prevented = true },
    ...modifiers
  })

  const plain = event('a')
  assert.equal(dispatchGlobalShortcut(plain, { formMode: true }), false)
  assert.equal(plain.prevented, false)
  const copy = event('c', { ctrlKey: true })
  assert.equal(dispatchGlobalShortcut(copy, { formMode: true }), false)
  assert.equal(copy.prevented, false)
  for (const current of [event('s', { ctrlKey: true }), event('d', { ctrlKey: true }), event('1', { ctrlKey: true })]) {
    assert.equal(dispatchGlobalShortcut(current, { formMode: true }), true)
    assert.equal(current.prevented, true)
  }
  assert.deepEqual(calls, ['save', 'duplicate', 'priority1'])
  assert.equal(findShortcutBinding(event('o', { ctrlKey: true })).action, 'toggleOutline')
  assert.throws(() => assertRegisteredActions(['definitely-missing-action']), /尚未註冊|未註冊/u)
  cleanups.forEach(cleanup => cleanup())
})

test('內建主題至少 12 個且包含 ALPHA 指定主題與完整資料欄位', () => {
  const builtIns = getThemeList()
  assert.ok(builtIns.length >= 12)
  const required = [
    'classic-blue', 'office-pink', 'deep-space', 'monochrome-outline',
    'duo-capsule', 'watercolor-mint', 'autumn-warm', 'cream-notes', 'magenta-rainbow'
  ]
  required.forEach(id => assert.ok(builtIns.some(item => item.id === id), `缺少主題 ${id}`))
  for (const item of builtIns) {
    assert.equal(typeof item.name, 'string')
    assert.equal(typeof item.canvasBg, 'string')
    assert.ok(item.branchPalette.length >= 1)
    assert.ok(['curved', 'dotted', 'orthogonal'].includes(item.lineShape))
    assert.deepEqual(item.lineWidthByDepth, [4, 3, 2, 1])
    assert.ok(item.rootStyle && item.level2Style && item.leafStyle)
  }
  assert.equal(getTheme('deep-space').canvasBg, '#0B0B2A')
  assert.equal(getTheme('office-pink').rootStyle.fill, '#DAEEF3')
})

test('主題 mini-SVG 由資料即時產生且不引用點陣圖片', () => {
  for (const item of getThemeList()) {
    const svg = createThemePreviewSvg(item)
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/)
    assert.match(svg, new RegExp(item.canvasBg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    assert.equal(/<(image|foreignObject)\b/i.test(svg), false)
    assert.ok((svg.match(/<path\b/g) || []).length >= 5)
  }
})

test('樣式 token 與線型 token 可保留 shape、進階控制及繁中文字', () => {
  const token = encodeStyleToken('rounded', {
    radius: 13,
    align: 'right',
    lineHeight: 1.75,
    watermarkText: '晨睿測試',
    richText: '<b>局部粗體</b>'
  }, 'diamond')
  const parsed = parseStyleToken(token)
  assert.equal(parsed.shape, 'diamond')
  assert.equal(parsed.metadata.radius, '13')
  assert.equal(parsed.metadata.watermarkText, '晨睿測試')
  assert.equal(parsed.metadata.richText, '<b>局部粗體</b>')

  const lineToken = encodeLineToken('solid', 'dash-dot', 'orthogonal')
  assert.deepEqual(parseLineToken(lineToken), { lineStyle: 'dash-dot', lineShape: 'orthogonal' })
})

test('舊 shape 複合 token 載入時遷移到 node、style 與 canvas 一級欄位', () => {
  const restored = normalizeDoc({
    root: {
      id: 'legacy-root',
      text: '舊文件',
      style: { shape: encodeStyleToken('pill', {
      radius: 18,
      align: 'right',
      lineHeight: 1.7,
      richText: '<b>舊文件</b>',
      spacingH: 42,
      spacingV: 36,
      watermarkText: 'MindFlow',
      watermarkColor: '#123456',
      watermarkRotation: 'horizontal',
      watermarkOpacity: 22,
      watermarkSize: 24
      }) }
    },
    canvas: { background: '#fff', watermark: true }
  })
  const appearance = getNodeAppearance(restored.root, 0, getTheme(restored.themeId))
  assert.equal(restored.root.style.shape, 'pill')
  assert.equal(restored.root.style.radius, 18)
  assert.equal(restored.root.style.align, 'right')
  assert.equal(restored.root.style.lineHeight, 1.7)
  assert.equal(restored.root.richText, '<b>舊文件</b>')
  assert.equal(appearance.shape, 'pill')
  assert.equal(appearance.radius, 18)
  assert.equal(restored.canvas.spacingH, 42)
  assert.equal(restored.canvas.spacingV, 36)
  assert.deepEqual(restored.canvas.watermark, {
    enabled: true,
    text: 'MindFlow',
    color: '#123456',
    rotation: 'horizontal',
    opacity: 22,
    size: 24
  })
  assert.equal(restored.root.style.shape.includes('|'), false)

  const emptyText = normalizeDoc({
    root: { id: 'new-root' },
    canvas: { watermark: { enabled: true, text: '', color: '#64748b', rotation: 'left', opacity: 12, size: 18 } }
  })
  assert.equal(emptyText.canvas.watermark.text, '')
  assert.equal(emptyText.canvas.watermark.enabled, true)
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
