import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

import { CommandManager } from '../js/editor/commands.js'
import { createDefaultDoc, deserializeDoc, serializeDoc } from '../js/editor/model.js'
import * as iconPanel from '../js/editor/iconpanel.js'
import * as attachments from '../js/editor/attachments.js'

const STICKER_ROOT = new URL('../assets/stickers/', import.meta.url)
const MANIFEST_URL = new URL('manifest.json', STICKER_ROOT)
const EXPECTED_CATEGORIES = [
  'business',
  'education',
  'technology',
  'expressions',
  'travel',
  'weather',
  'animals',
  'food',
  'festivals',
  'symbols-arrows'
]

test('貼紙 manifest 完整列出 10 分類各 12 張、共 120 張唯一 SVG', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'))
  assert.deepEqual(Object.keys(manifest), EXPECTED_CATEGORIES)
  Object.entries(manifest).forEach(([category, entries]) => {
    assert.equal(entries.length, 12, `${category} 應有 12 張貼紙`)
  })

  const stickers = iconPanel.flattenStickerManifest(manifest)
  assert.equal(stickers.length, 120)
  assert.equal(new Set(stickers.map(sticker => sticker.id)).size, 120, '貼紙 id 不得重複')
  assert.equal(new Set(stickers.map(sticker => sticker.file)).size, 120, '貼紙檔案不得重複引用')

  const diskFiles = await listSvgFiles(STICKER_ROOT)
  const manifestFiles = stickers.map(sticker => sticker.file.replace('assets/stickers/', '')).sort()
  assert.deepEqual(diskFiles, manifestFiles, 'manifest 與磁碟 SVG 清單必須一一對應')
})

test('120 張貼紙都是可獨立載入的合法原創向量，沿用圓潤 2px 描邊規格', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'))
  for (const sticker of iconPanel.flattenStickerManifest(manifest)) {
    assert.match(sticker.id, new RegExp(`^${escapeRegExp(sticker.category)}-[a-z0-9-]+$`, 'u'))
    assert.ok(String(sticker.name || '').trim(), `${sticker.id} 缺少名稱`)
    assert.equal(sticker.file, `assets/stickers/${sticker.category}/${sticker.id.slice(sticker.category.length + 1)}.svg`)

    const source = await readFile(new URL(`../${sticker.file}`, import.meta.url), 'utf8')
    assertWellFormedSvg(source, sticker.id)
    assert.match(source, /viewBox="0 0 (?:128|256) (?:128|256)"/u, `${sticker.id} viewBox 不合規格`)
    assert.match(source, /stroke-width="2"/u, `${sticker.id} 缺少 2px 主描邊`)
    assert.doesNotMatch(source, /<image\b|\b(?:href|src)="|data:/iu, `${sticker.id} 不得嵌入外部或點陣素材`)
  }
})

test('貼紙搜尋可依分類、中文名稱與英文 id 過濾，空結果不混入其他分類', async () => {
  assert.equal(typeof iconPanel.filterStickerManifest, 'function')
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'))

  assert.deepEqual(
    iconPanel.filterStickerManifest(manifest, { category: 'animals', query: '貓咪' }).map(item => item.name),
    ['貓咪']
  )
  assert.deepEqual(
    iconPanel.filterStickerManifest(manifest, { category: 'all', query: 'rocket' }).map(item => item.id),
    ['technology-rocket']
  )
  assert.deepEqual(iconPanel.filterStickerManifest(manifest, { category: 'food', query: '衛星' }), [])
})

test('貼紙以 image 附件插入；同節點換貼紙會取代並可 undo，舊 sticker token 會清除', () => {
  assert.equal(typeof iconPanel.attachNodeStickerCommand, 'function')
  const doc = createDefaultDoc()
  const manager = new CommandManager()
  const node = doc.root.children[0]
  node.icons = ['priority:2', 'sticker:legacy-old']

  manager.execute(iconPanel.attachNodeStickerCommand(doc, node.id, {
    id: 'animals-cat',
    name: '貓咪',
    file: 'assets/stickers/animals/cat.svg'
  }))
  assert.deepEqual(node.image, {
    src: 'assets/stickers/animals/cat.svg',
    w: 96,
    h: 96,
    alt: '貓咪',
    kind: 'sticker',
    stickerId: 'animals-cat'
  })
  assert.deepEqual(node.icons, ['priority:2'])

  manager.execute(iconPanel.attachNodeStickerCommand(doc, node.id, {
    id: 'food-pizza',
    name: '披薩',
    file: 'assets/stickers/food/pizza.svg'
  }))
  assert.equal(node.image.stickerId, 'food-pizza')
  manager.undo()
  assert.equal(node.image.stickerId, 'animals-cat')
  manager.undo()
  assert.equal(node.image, null)
  assert.deepEqual(node.icons, ['priority:2', 'sticker:legacy-old'])
})

test('文件重載剝除 image metadata 後，換貼紙仍保留使用者縮放尺寸', () => {
  const doc = createDefaultDoc()
  const node = doc.root.children[0]
  new CommandManager().execute(iconPanel.attachNodeStickerCommand(doc, node.id, {
    id: 'animals-cat',
    name: '貓咪',
    file: 'assets/stickers/animals/cat.svg'
  }))
  node.image.w = 146
  node.image.h = 146

  const restored = deserializeDoc(serializeDoc(doc))
  const restoredNode = restored.root.children[0]
  assert.equal(restoredNode.image.kind, undefined, 'schema 正規化確實會剝除非標準 metadata')
  new CommandManager().execute(iconPanel.attachNodeStickerCommand(restored, restoredNode.id, {
    id: 'food-pizza',
    name: '披薩',
    file: 'assets/stickers/food/pizza.svg'
  }))
  assert.deepEqual({ w: restoredNode.image.w, h: restoredNode.image.h }, { w: 146, h: 146 })
})

test('節點圖片四個角都可等比例縮放，且遵守最小與最大尺寸', () => {
  assert.equal(typeof attachments.calculateImageResize, 'function')
  assert.deepEqual(attachments.calculateImageResize({ w: 96, h: 96 }, { x: 32, y: 32 }, 'se'), { w: 128, h: 128 })
  assert.deepEqual(attachments.calculateImageResize({ w: 96, h: 96 }, { x: -32, y: -32 }, 'nw'), { w: 128, h: 128 })
  assert.deepEqual(attachments.calculateImageResize({ w: 96, h: 96 }, { x: -200, y: -200 }, 'se'), { w: 48, h: 48 })
  assert.deepEqual(attachments.calculateImageResize({ w: 96, h: 96 }, { x: 500, y: 500 }, 'se'), { w: 260, h: 260 })
})

async function listSvgFiles(rootUrl) {
  const categories = await readdir(rootUrl, { withFileTypes: true })
  const files = []
  for (const category of categories.filter(entry => entry.isDirectory())) {
    const entries = await readdir(new URL(`${category.name}/`, rootUrl), { withFileTypes: true })
    entries.filter(entry => entry.isFile() && entry.name.endsWith('.svg')).forEach(entry => files.push(`${category.name}/${entry.name}`))
  }
  return files.sort()
}

function assertWellFormedSvg(source, id) {
  assert.equal(source.charCodeAt(0), 60, `${id} 必須直接以 <svg 開頭`)
  assert.match(source, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>/u, `${id} 缺少 SVG namespace`)
  assert.match(source, /<svg\b[^>]*role="img"[^>]*aria-label="[^"]+"[^>]*>/u, `${id} 缺少可存取標籤`)
  assert.doesNotMatch(source, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/iu, `${id} 含未跳脫 entity`)

  const stack = []
  for (const match of source.matchAll(/<([^>]+)>/gu)) {
    const token = match[1].trim()
    if (!token || token.startsWith('!') || token.startsWith('?')) continue
    if (token.startsWith('/')) {
      const tag = token.slice(1).trim()
      assert.equal(stack.pop(), tag, `${id} 的 </${tag}> 閉合順序錯誤`)
      continue
    }
    const tag = token.match(/^([A-Za-z][\w:.-]*)/u)?.[1]
    assert.ok(tag, `${id} 含無效標籤 <${token}>`)
    const quoteCount = (token.match(/"/gu) || []).length
    assert.equal(quoteCount % 2, 0, `${id} 的 <${tag}> 屬性引號未閉合`)
    if (!token.endsWith('/')) stack.push(tag)
  }
  assert.deepEqual(stack, [], `${id} 含未閉合標籤`)
  assert.match(source, /<\/svg>\s*$/u, `${id} 缺少 </svg>`)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
