/**
 * DELTA 純函數與 command 自測：不依賴瀏覽器 DOM。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createDefaultDoc, createNode, findNode } from '../js/editor/model.js'
import { CommandManager } from '../js/editor/commands.js'
import {
  createRelationCommand,
  deleteNodesWithOverlaysCommand,
  relationGeometry,
  removeRelationCommand,
  setRelationStyleCommand,
  updateRelationCommand
} from '../js/editor/relations.js'
import {
  createSummaryCommand,
  getSummaryRange,
  getSummaryNodes,
  removeSummaryCommand,
  summaryGeometry,
  updateSummaryCommand
} from '../js/editor/summary.js'
import {
  isLikelyUrl,
  normalizeUrl,
  setAllCollapsedCommand,
  updateNodeFieldsCommand
} from '../js/editor/attachments.js'
import {
  attachFloatingNodeCommand,
  createFloatingNodeCommand,
  getFloatingMeta,
  sanitizeFloatingClone,
  updateFloatingPositionCommand
} from '../js/editor/floating.js'
import { createProgressSvg, createPrioritySvg, flattenStickerManifest, toggleNodeIconCommand } from '../js/editor/iconpanel.js'
import { createReplaceAllCommand, findTextMatches, replaceText } from '../js/editor/findreplace.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('關聯線新增、調控制點/樣式、刪除皆可 undo/redo', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const [from, to] = doc.root.children
  const add = createRelationCommand(doc, from.id, to.id, { id: 'rel-delta' })
  assert.equal(manager.execute(add), true)
  assert.equal(doc.relations.length, 1)
  assert.equal(manager.execute(updateRelationCommand(doc, add.item.id, { cp1: { x: 20, y: -12 }, label: '影響' })), true)
  assert.deepEqual(doc.relations[0].cp1, { x: 20, y: -12 })
  manager.execute(setRelationStyleCommand(doc, add.item.id, { lineColor: '#112233', lineWidth: 4, lineStyle: 'dash-dot' }))
  assert.deepEqual(doc.relations[0].style, { color: '#112233', width: 4, lineStyle: 'dash-dot' })
  manager.execute(setRelationStyleCommand(doc, add.item.id, { lineWidth: 5 }))
  assert.deepEqual(doc.relations[0].style, { color: '#112233', width: 5, lineStyle: 'dash-dot' })
  manager.execute(removeRelationCommand(doc, add.item.id))
  assert.equal(doc.relations.length, 0)
  manager.undo()
  assert.equal(doc.relations[0].label, '影響')
  manager.redo()
  assert.equal(doc.relations.length, 0)
})

test('關聯線幾何使用 cubic Bézier 且控制點偏移可預測', () => {
  const positions = new Map([
    ['a', { x: 0, y: 20, w: 80, h: 30 }],
    ['b', { x: 260, y: 120, w: 90, h: 40 }]
  ])
  const geometry = relationGeometry(positions, { fromId: 'a', toId: 'b', cp1: { x: 10, y: -20 }, cp2: { x: -5, y: 30 } })
  assert.match(geometry.path, /^M .+ C .+,.+,.+$/u)
  assert.equal(geometry.cp1.x, geometry.baseCp1.x + 10)
  assert.equal(geometry.cp2.y, geometry.baseCp2.y + 30)
})

test('概要依同側視覺順序建立並以 nodeId 錨定，兄弟增刪不會漂移', () => {
  const doc = createDefaultDoc()
  const right = doc.root.children.filter(node => node.side === 'right')
  const left = doc.root.children.filter(node => node.side === 'left')
  const ids = right.map(node => node.id)
  assert.deepEqual(getSummaryRange(doc.root, ids), {
    parentId: doc.root.id,
    startNodeId: ids[0],
    endNodeId: ids[1]
  })
  assert.equal(getSummaryRange(doc.root, [right[0].id, left[0].id]), null)
  const manager = new CommandManager()
  const add = createSummaryCommand(doc, ids, { id: 'sum-delta', text: '三段概要' })
  manager.execute(add)
  const inserted = createNode('先插入', { side: 'right' })
  doc.root.children.unshift(inserted)
  assert.deepEqual(getSummaryNodes(doc.summaries[0], doc.root).map(node => node.id), ids)
  manager.execute(updateSummaryCommand(doc, add.summary.id, { startNodeId: ids[1], text: '後一段' }))
  assert.equal(doc.summaries[0].startNodeId, ids[1])
  manager.execute(removeSummaryCommand(doc, add.summary.id))
  manager.undo()
  assert.equal(doc.summaries[0].text, '後一段')
  const positions = new Map(doc.root.children.map((node, index) => [node.id, { x: 120, y: index * 55, w: 80, h: 30 }]))
  const geometry = summaryGeometry(doc.summaries[0], doc.root, positions)
  assert.ok(geometry.bottom > geometry.top)
  assert.match(geometry.path, /^M .+ C /u)
})

test('概要更新驗證失敗時不修改懸空資料', () => {
  const doc = createDefaultDoc()
  doc.summaries.push({
    id: 'sum-orphan',
    parentId: 'missing-parent',
    startNodeId: 'missing-a',
    endNodeId: 'missing-b',
    text: '原文',
    style: {}
  })
  const command = updateSummaryCommand(doc, 'sum-orphan', { text: '不該寫入' })
  assert.equal(command.do(), false)
  assert.equal(doc.summaries[0].text, '原文')
})

test('關聯線重接端點會拒絕既有的相同配對', () => {
  const doc = createDefaultDoc()
  const [a, b, c] = doc.root.children
  const manager = new CommandManager()
  const first = createRelationCommand(doc, a.id, b.id, { id: 'rel-ab' })
  const second = createRelationCommand(doc, a.id, c.id, { id: 'rel-ac' })
  manager.execute(first)
  manager.execute(second)
  assert.equal(manager.execute(updateRelationCommand(doc, second.item.id, { toId: b.id })), false)
  assert.equal(doc.relations.length, 2)
  assert.equal(doc.relations.find(item => item.id === second.item.id).toId, c.id)
})

test('刪除節點同步清理關聯線與概要，undo/redo 完整還原', () => {
  const doc = createDefaultDoc()
  const right = doc.root.children.filter(node => node.side === 'right')
  const left = doc.root.children.find(node => node.side === 'left')
  const middle = createNode('概要中段', { side: 'right' })
  doc.root.children.splice(doc.root.children.indexOf(right[0]) + 1, 0, middle)
  const manager = new CommandManager()
  manager.execute(createRelationCommand(doc, middle.id, left.id, { id: 'rel-cleanup' }))
  manager.execute(createSummaryCommand(doc, [right[0].id, middle.id, right[1].id], { id: 'sum-cleanup' }))
  manager.execute(deleteNodesWithOverlaysCommand(doc, [middle.id]))
  assert.equal(findNode(doc.root, middle.id), null)
  assert.equal(doc.relations.length, 0)
  assert.equal(doc.summaries.length, 0)
  manager.undo()
  assert.ok(findNode(doc.root, middle.id))
  assert.equal(doc.relations[0].id, 'rel-cleanup')
  assert.equal(doc.summaries[0].id, 'sum-cleanup')
  manager.redo()
  assert.equal(doc.relations.length, 0)
  assert.equal(doc.summaries.length, 0)
})

test('備註/連結/圖片欄位以同一 command 原子更新與復原', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  const manager = new CommandManager()
  manager.execute(updateNodeFieldsCommand(doc, node.id, {
    notes: '重要備註',
    link: 'https://example.com/',
    image: { src: 'data:image/png;base64,AA==', w: 120, h: 80 }
  }))
  assert.equal(node.notes, '重要備註')
  assert.equal(node.image.w, 120)
  manager.undo()
  assert.equal(node.notes, null)
  assert.equal(node.image, null)
  assert.equal(normalizeUrl('www.example.com'), 'https://www.example.com/')
  assert.equal(isLikelyUrl('https://example.com/a?q=1'), true)
  assert.equal(normalizeUrl('javascript:alert(1)'), '')
})

test('圖示同類互斥、再點移除，SVG 為自包含原創向量', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  const manager = new CommandManager()
  manager.execute(toggleNodeIconCommand(doc, node.id, 'priority', '1'))
  manager.execute(toggleNodeIconCommand(doc, node.id, 'flag', 'blue'))
  manager.execute(toggleNodeIconCommand(doc, node.id, 'priority', '7'))
  assert.deepEqual(node.icons.sort(), ['flag:blue', 'priority:7'])
  manager.execute(toggleNodeIconCommand(doc, node.id, 'priority', '7'))
  assert.deepEqual(node.icons, ['flag:blue'])
  assert.match(createPrioritySvg(3), /^<svg[\s\S]+<circle[\s\S]+<text/u)
  assert.match(createProgressSvg(62.5), /<path d="M12 12 L12 4 A8 8/u)
  assert.doesNotMatch(createProgressSvg(100), /<image|http/iu)
})

test('貼紙 manifest 正好展平 36 張且每張檔案存在', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/stickers/manifest.json', import.meta.url), 'utf8'))
  const stickers = flattenStickerManifest(manifest)
  assert.equal(stickers.length, 36)
  for (const sticker of stickers) {
    assert.match(sticker.file, /^assets\/stickers\/.+\.svg$/u)
    const local = new URL(`../${sticker.file}`, import.meta.url)
    assert.ok((await readFile(local, 'utf8')).startsWith('<svg'))
  }
})

test('懸浮節點座標可持久化、移動、掛回樹並 undo', () => {
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const target = doc.root.children[0]
  const add = createFloatingNodeCommand(doc, { x: 321, y: 123 }, { id: 'floating-delta' })
  manager.execute(add)
  assert.deepEqual(getFloatingMeta(findNode(doc.root, add.nodeId)), { x: 321, y: 123 })
  manager.execute(updateFloatingPositionCommand(doc, add.nodeId, { x: 400, y: 220 }))
  assert.deepEqual(getFloatingMeta(findNode(doc.root, add.nodeId)), { x: 400, y: 220 })
  manager.execute(attachFloatingNodeCommand(doc, add.nodeId, target.id))
  assert.equal(getFloatingMeta(findNode(doc.root, add.nodeId)), null)
  assert.equal(target.children[0].id, add.nodeId)
  manager.undo()
  assert.deepEqual(getFloatingMeta(findNode(doc.root, add.nodeId)), { x: 400, y: 220 })
})

test('懸浮節點 clone 掛入樹時清 token，root 複製時位移且清除後代 token', () => {
  const source = createNode('懸浮 clone', {
    icons: ['__floating__:300,200'],
    children: [createNode('後代', { icons: ['__floating__:10,20'] })]
  })
  const attached = sanitizeFloatingClone(structuredClone(source), { asRootChild: false })
  assert.equal(getFloatingMeta(attached), null)
  assert.equal(getFloatingMeta(attached.children[0]), null)
  const duplicated = sanitizeFloatingClone(structuredClone(source), { asRootChild: true })
  assert.deepEqual(getFloatingMeta(duplicated), { x: 332, y: 224 })
  assert.equal(getFloatingMeta(duplicated.children[0]), null)
})

test('尋找與取代支援逐筆/全部並保留 undo', () => {
  const doc = createDefaultDoc()
  doc.root.text = 'Alpha alpha'
  doc.root.richText = '<b>Alpha</b> alpha'
  doc.root.children[0].text = 'alpha beta alpha'
  const matches = findTextMatches(doc.root, 'alpha')
  assert.equal(matches.length, 2)
  assert.equal(matches.reduce((sum, match) => sum + match.count, 0), 4)
  assert.equal(replaceText('Alpha alpha', 'alpha', 'X'), 'X alpha')
  const manager = new CommandManager()
  const command = createReplaceAllCommand(doc, 'alpha', '完成')
  manager.execute(command)
  assert.equal(doc.root.text, '完成 完成')
  assert.equal(doc.root.richText, null)
  assert.equal(doc.root.children[0].text, '完成 beta 完成')
  manager.undo()
  assert.equal(doc.root.text, 'Alpha alpha')
  assert.equal(doc.root.richText, '<b>Alpha</b> alpha')
})

test('全部展開/收起只改有子節點的非根節點', () => {
  const doc = createDefaultDoc()
  doc.root.children[0].children.push(createNode('子節點'))
  const manager = new CommandManager()
  manager.execute(setAllCollapsedCommand(doc, true))
  assert.equal(doc.root.collapsed, false)
  assert.equal(doc.root.children[0].collapsed, true)
  manager.undo()
  assert.equal(doc.root.children[0].collapsed, false)
})

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

console.log(`\n${passed}/${tests.length} DELTA tests passed`)
