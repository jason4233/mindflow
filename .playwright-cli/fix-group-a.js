async page => {
  const results = []
  const check = async (id, fn) => {
    try { await fn(); results.push({ id, pass: true }) }
    catch (error) { results.push({ id, pass: false, error: error.message }) }
  }
  const makeDoc = (overrides = {}) => ({
    id: 'browser-fix', title: 'FIX Browser', createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
    root: { id: 'root', text: '中心', children: [
      { id: 'a', text: '重點', children: [], collapsed: false, side: 'right', style: {}, richText: null, notes: null, link: null, icons: [], image: null },
      { id: 'b', text: '預算', children: [], collapsed: false, side: 'left', style: {}, richText: null, notes: null, link: null, icons: [], image: null },
      { id: 'c', text: '右二', children: [], collapsed: false, side: 'right', style: {}, richText: null, notes: null, link: null, icons: [], image: null },
      { id: 'd', text: '左二', children: [], collapsed: false, side: 'left', style: {}, richText: null, notes: null, link: null, icons: [], image: null }
    ], collapsed: false, side: null, style: {}, richText: null, notes: null, link: null, icons: [], image: null },
    layout: 'mindmap-both', themeId: 'classic-blue', relations: [], summaries: [],
    canvas: { background: '#f4f7fb', watermark: { enabled: true, text: 'Brand', color: '#123456', rotation: 'right', opacity: 22, size: 24 }, spacingH: 42, spacingV: 36 },
    ...overrides
  })
  const seed = async doc => {
    await page.goto('http://127.0.0.1:4173/index.html')
    await page.evaluate(doc => {
      localStorage.clear()
      localStorage.setItem(`mindflow.doc.${doc.id}`, JSON.stringify(doc))
      localStorage.setItem('mindflow.docs.index', JSON.stringify({ version: 2, docs: [{ id: doc.id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, thumbnail: '' }], trash: [], favorites: [] }))
    }, doc)
    await page.goto(`http://127.0.0.1:4173/editor.html?id=${doc.id}`)
    await page.waitForSelector('#nodes-layer [data-node-id="a"]')
  }
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('mindflow.doc.browser-fix')))
  const node = id => page.locator(`#nodes-layer [data-node-id="${id}"]`)
  const fail = (condition, message) => { if (!condition) throw new Error(message) }

  await check(1, async () => {
    const doc = makeDoc()
    doc.root.children[0].richText = '<b>重點</b>'
    doc.root.children[0].style = { shape: 'diamond', radius: 12, align: 'right', lineHeight: 1.7 }
    await seed(doc)
    await node('a').click(); await page.keyboard.press('Control+Alt+C')
    await node('b').click(); await page.keyboard.press('Control+Alt+V')
    await page.waitForTimeout(650)
    const saved = await stored()
    fail((await node('b').locator('.mind-node__text').innerText()) === '預算', 'B 畫面文字被樣式貼上污染')
    fail(saved.root.children[1].text === '預算' && saved.root.children[1].richText === null, 'B model 內容被污染')
    fail(saved.canvas.spacingH === 42 && saved.canvas.watermark.text === 'Brand', 'canvas 設定被樣式貼上污染')
  })

  await check(2, async () => {
    const doc = makeDoc()
    doc.root.children[0].text = 'Hello'; doc.root.children[0].richText = '<b>Hello</b>'
    await seed(doc)
    await node('a').dblclick(); const text = node('a').locator('.mind-node__text')
    await text.press('Control+A'); await text.type('X'); await text.press('Enter')
    await page.keyboard.press('Control+Z'); await page.waitForTimeout(650)
    const saved = await stored()
    fail(saved.root.children[0].text === 'Hello', '一次 undo 未恢復 plain text')
    fail(saved.root.children[0].richText === '<b>Hello</b>', '一次 undo 未恢復 richText')
    fail((await node('a').locator('.mind-node__text').innerText()) === 'Hello', 'DOM 與 model 不一致')
  })

  await check(3, async () => {
    const doc = makeDoc({ themeId: 'deep-space', canvas: { ...makeDoc().canvas, background: '#0B0B2A' } })
    await seed(doc)
    await node('a').dblclick(); const text = node('a').locator('.mind-node__text')
    await text.press('Control+A'); await text.type('編輯後'); await text.press('Enter')
    await page.keyboard.press('F6'); await page.waitForTimeout(650)
    const saved = await stored()
    fail(!Object.hasOwn(saved.root.children[0].style, 'shape'), '文字編輯把主題 shape 寫成節點 override')
    fail((await node('a').getAttribute('data-shape')) === 'rounded', '切換主題後節點未跟隨新主題')
  })

  await check(4, async () => {
    await seed(makeDoc())
    await node('a').click()
    const slider = page.locator('[data-style-range="radius"]')
    await slider.evaluate(element => {
      for (let value = 7; value <= 20; value += 1) {
        element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.keyboard.press('Control+Z'); await page.waitForTimeout(650)
    const saved = await stored()
    fail(!Object.hasOwn(saved.root.children[0].style, 'radius'), '一次 undo 未還原整次 slider drag')
    fail(!(await page.locator('#redo-button').isDisabled()), 'undo 後沒有單一可 redo 記錄')
  })

  await check(5, async () => {
    await seed(makeDoc())
    await node('a').click(); await page.locator('[data-shape="diamond"]').click(); await page.keyboard.press('Control+Z')
    fail(!(await page.locator('#redo-button').isDisabled()), '建立 redo 歷史失敗')
    await page.locator('[data-panel-view="style"] button[data-shape="rounded"]').click()
    fail(!(await page.locator('#redo-button').isDisabled()), '無變化形狀操作清空 redo')
  })

  await check(6, async () => {
    await seed(makeDoc())
    await node('a').click(); await page.keyboard.press('Tab'); await page.keyboard.press('Control+Z'); await page.keyboard.press('Enter')
    await page.waitForTimeout(650)
    const saved = await stored()
    fail(saved.root.children.length === 5, 'undo 新增後未恢復 selection，Enter 無法新增同級')
  })

  await check(7, async () => {
    await seed(makeDoc())
    await node('a').dblclick(); await node('a').locator('.mind-node__text').press('Control+B'); await node('b').click(); await page.waitForTimeout(650)
    const saved = await stored()
    fail(saved.root.children[0].richText && /<(b|strong)>/i.test(saved.root.children[0].richText), 'A richText 未提交到 session node')
    fail(saved.root.children[1].text === '預算' && saved.root.children[1].richText === null, 'A richText 被寫進 B')
    fail((await node('b').locator('.mind-node__text').innerText()) === '預算', 'B 畫面內容被 A 覆蓋')
  })
  const sessionResult = results.find(result => result.id === 7)
  results.push({ ...sessionResult, id: 12 })

  await check(8, async () => {
    await seed(makeDoc())
    await page.locator('[data-panel-tab="theme"]').click(); await page.locator('[data-theme-subtab="background"]').click()
    const input = page.locator('[data-watermark-text]')
    await input.fill(''); await input.press('Tab'); await page.waitForTimeout(650)
    const saved = await stored()
    fail((await input.inputValue()) === '', '空浮水印被 UI 寫回預設字')
    fail(saved.canvas.watermark.text === '' && saved.canvas.watermark.enabled === true, '空文字或 enabled 語意未保留')
  })
  return results
}
