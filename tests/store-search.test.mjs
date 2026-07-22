/** Phase B store/search 純函數與 localStorage 相容性測試。 */
import assert from 'node:assert/strict'

class MemoryStorage {
  #data = new Map()

  get length() { return this.#data.size }
  clear() { this.#data.clear() }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null }
  key(index) { return Array.from(this.#data.keys())[index] ?? null }
  removeItem(key) { this.#data.delete(String(key)) }
  setItem(key, value) { this.#data.set(String(key), String(value)) }
}

globalThis.localStorage = new MemoryStorage()

const {
  DOC_KEY_PREFIX,
  INDEX_KEY,
  INDEX_VERSION,
  createDocument,
  createDocumentThumbnail,
  deleteDocument,
  duplicateDocument,
  listDocuments,
  listTrashedDocuments,
  loadDocument,
  permanentlyDeleteDocument,
  restoreDocument,
  saveDocument,
  toggleFavorite
} = await import('../js/store.js')
const { createDefaultDoc, createNode, walkNodes } = await import('../js/editor/model.js')
const { normalizeSearchText, searchDocuments } = await import('../js/search.js')
const { MIND_FLOW_TEMPLATES, TEMPLATE_CATEGORIES, createDocumentFromTemplate } = await import('../js/templates.js')

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const resetStorage = () => globalThis.localStorage.clear()

test('v1 index 在既有文件再次存檔時無損升級為 v2', () => {
  resetStorage()
  const doc = createDefaultDoc({ id: 'legacy-doc', title: '舊版文件' })
  globalThis.localStorage.setItem(`${DOC_KEY_PREFIX}${doc.id}`, JSON.stringify(doc))
  globalThis.localStorage.setItem(INDEX_KEY, JSON.stringify({
    version: 1,
    docs: [{ id: doc.id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt }]
  }))

  assert.equal(loadDocument(doc.id).title, '舊版文件')
  assert.equal(listDocuments()[0].thumbnail, '')
  saveDocument(doc)

  const upgraded = JSON.parse(globalThis.localStorage.getItem(INDEX_KEY))
  assert.equal(upgraded.version, INDEX_VERSION)
  assert.deepEqual(upgraded.trash, [])
  assert.deepEqual(upgraded.favorites, [])
  assert.match(upgraded.docs[0].thumbnail, /^<svg/)
  assert.equal(loadDocument(doc.id).title, '舊版文件')
})

test('文件可收藏、移入回收筒、還原與永久刪除，收藏狀態跟隨文件', () => {
  resetStorage()
  const doc = createDocument(createDefaultDoc({ title: '生命週期' }))
  assert.equal(toggleFavorite(doc.id), true)
  assert.equal(listDocuments({ favoritesOnly: true })[0].id, doc.id)

  assert.equal(deleteDocument(doc.id), true)
  assert.equal(listDocuments().length, 0)
  assert.equal(listTrashedDocuments()[0].favorite, true)
  assert.equal(loadDocument(doc.id).title, '生命週期')

  assert.equal(restoreDocument(doc.id), true)
  assert.equal(listDocuments()[0].favorite, true)
  assert.equal(deleteDocument(doc.id), true)
  assert.equal(permanentlyDeleteDocument(doc.id), true)
  assert.equal(loadDocument(doc.id), null)
  assert.equal(listTrashedDocuments().length, 0)
})

test('建立副本會換文件與全部節點 ID，且保留原始內容', () => {
  resetStorage()
  const source = createDefaultDoc({ title: '專案藍圖' })
  source.root.children[0].children.push(createNode('驗收清單'))
  createDocument(source)
  const copy = duplicateDocument(source.id)

  assert.ok(copy)
  assert.notEqual(copy.id, source.id)
  assert.equal(copy.title, '專案藍圖（副本）')
  const sourceIds = []
  const copyIds = []
  walkNodes(source.root, node => sourceIds.push(node.id))
  walkNodes(copy.root, node => copyIds.push(node.id))
  assert.equal(copyIds.some(id => sourceIds.includes(id)), false)
  assert.equal(loadDocument(copy.id).root.children[0].children[0].text, '驗收清單')
})

test('mini-SVG 會轉義使用者文字且包含實際節點內容', () => {
  resetStorage()
  const doc = createDefaultDoc({
    title: '<測試文件>',
    root: createNode('<script>危險</script>', { children: [createNode('安全節點')] })
  })
  const thumbnail = createDocumentThumbnail(doc)
  assert.match(thumbnail, /^<svg/)
  assert.ok(thumbnail.includes('&lt;script&gt;'))
  assert.equal(thumbnail.includes('<script>'), false)
  assert.ok(thumbnail.includes('安全節點'))
})

test('全文搜尋可命中文件標題、節點文字並回傳完整節點路徑', () => {
  resetStorage()
  const doc = createDefaultDoc({
    title: '網站改版專案',
    root: createNode('網站改版', {
      children: [
        createNode('設計階段', { children: [createNode('確認視覺規範')] }),
        createNode('發布階段', { children: [createNode('完成驗收清單')] })
      ]
    })
  })
  createDocument(doc)

  const nodeResults = searchDocuments('驗收')
  assert.equal(nodeResults.length, 1)
  assert.equal(nodeResults[0].titleMatch, false)
  assert.equal(nodeResults[0].matches[0].pathText, '網站改版 › 發布階段 › 完成驗收清單')

  const titleResults = searchDocuments('網站 改版')
  assert.equal(titleResults[0].titleMatch, true)
})

test('搜尋正規化支援全形英數與大小寫', () => {
  assert.equal(normalizeSearchText('  ＡＰＩ  設計 '), 'api 設計')
})

test('範本庫具備 8 分類與至少 16 個可建立的繁中範本', () => {
  assert.equal(TEMPLATE_CATEGORIES.length, 8)
  assert.ok(MIND_FLOW_TEMPLATES.length >= 16)
  for (const category of TEMPLATE_CATEGORIES) {
    assert.ok(MIND_FLOW_TEMPLATES.filter(item => item.categoryId === category.id).length >= 2)
  }
  const weeklyPlan = createDocumentFromTemplate('weekly-plan')
  assert.equal(weeklyPlan.title, '一週行動計畫')
  assert.ok(weeklyPlan.root.children.length >= 4)
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

console.log(`\n${passed}/${tests.length} tests passed`)
