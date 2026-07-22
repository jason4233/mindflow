async page => {
  const results = []
  const check = async (id, fn) => {
    try { await fn(); results.push({ id, pass: true }) }
    catch (error) { results.push({ id, pass: false, error: error.message }) }
  }
  const makeDoc = (overrides = {}) => ({
    id: 'browser-fix', title: 'FIX Browser', createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
    root: { id: 'root', text: '中心', children: [
      { id: 'a', text: '右一', children: [], collapsed: false, side: 'right', style: {}, richText: null, notes: null, link: null, icons: [], image: null },
      { id: 'b', text: '左一', children: [], collapsed: false, side: 'left', style: {}, richText: null, notes: null, link: null, icons: [], image: null },
      { id: 'c', text: '右二', children: [], collapsed: false, side: 'right', style: {}, richText: null, notes: null, link: null, icons: [], image: null },
      { id: 'd', text: '左二', children: [], collapsed: false, side: 'left', style: {}, richText: null, notes: null, link: null, icons: [], image: null }
    ], collapsed: false, side: null, style: {}, richText: null, notes: null, link: null, icons: [], image: null },
    layout: 'mindmap-both', themeId: 'classic-blue', relations: [], summaries: [],
    canvas: { background: '#f4f7fb', watermark: { enabled: false, text: 'MindFlow', color: '#64748b', rotation: 'left', opacity: 12, size: 18 }, spacingH: 30, spacingV: 30 },
    ...overrides
  })
  const seed = async (doc = makeDoc(), suffix = '') => {
    await page.goto('http://127.0.0.1:4173/index.html')
    await page.evaluate(doc => {
      localStorage.clear()
      localStorage.setItem(`mindflow.doc.${doc.id}`, JSON.stringify(doc))
      localStorage.setItem('mindflow.docs.index', JSON.stringify({ version: 2, docs: [{ id: doc.id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, thumbnail: '' }], trash: [], favorites: [] }))
    }, doc)
    await page.goto(`http://127.0.0.1:4173/editor.html?id=${doc.id}${suffix}`)
    await page.waitForSelector('#nodes-layer [data-node-id="a"]')
  }
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('mindflow.doc.browser-fix')))
  const node = id => page.locator(`#nodes-layer [data-node-id="${id}"]`)
  const fail = (condition, message) => { if (!condition) throw new Error(message) }

  await check(11, async () => {
    await seed()
    await page.locator('#insert-button').click()
    fail(await page.locator('.insert-menu').isVisible(), '#insert-button 未開啟插入選單')
    await page.locator('#summary-button').click()
    fail(await page.locator('#feature-toast').isVisible(), '#summary-button 無可見回應')
    await page.locator('#relation-button').click()
    fail(await page.locator('#canvas').evaluate(element => element.classList.contains('is-relation-picking')), '#relation-button 未進入關聯線選取')
    for (const selector of ['#export-button', '#share-button', '#presentation-button', '#ai-button']) {
      await page.locator(selector).click()
      fail(await page.locator('[data-mindflow-toast]').isVisible(), `${selector} 無 fallback 回應`)
    }
    await page.locator('#more-button').click()
    fail(await page.locator('.more-menu').isVisible(), '#more-button 未開啟更多選單')
    await page.keyboard.press('Control+F')
    fail(await page.locator('.find-replace-panel').isVisible(), 'Ctrl+F 未開啟尋找與取代')
    const errors = await page.evaluate(() => window.__fixErrors || [])
    fail(errors.length === 0, '頁面有 action 註冊錯誤')
  })
  const toolbarResult = results.find(result => result.id === 11)
  results.push({ ...toolbarResult, id: 15 })

  await check(13, async () => {
    await seed()
    const svgChecks = await page.evaluate(async () => {
      const { documentToSvg } = await import('/js/io/export.js')
      const doc = JSON.parse(localStorage.getItem('mindflow.doc.browser-fix'))
      doc.root.children = [
        { ...doc.root.children[0], style: { shape: 'diamond', borderStyle: 'dash-dot', lineStyle: 'solid|shape=straight' } },
        { ...doc.root.children[2], style: { shape: 'parallelogram', lineStyle: 'solid|shape=orthogonal' } }
      ]
      const svg = documentToSvg(doc)
      return { polygon: /<polygon\b/.test(svg), straight: /d="M [^"]+ L /.test(svg), orthogonal: /d="M [^"]+ H [^"]+ V /.test(svg), dash: /stroke-dasharray="10 4 2 4"/.test(svg) }
    })
    fail(Object.values(svgChecks).every(Boolean), `SVG 新 schema 不完整：${JSON.stringify(svgChecks)}`)
  })

  await check(14, async () => {
    await seed()
    const state = await page.evaluate(async () => {
      const store = await import('/js/store.js')
      store.deleteDocument('browser-fix')
      store.permanentlyDeleteDocument('browser-fix')
      window.dispatchEvent(new Event('beforeunload'))
      return { loaded: store.loadDocument('browser-fix'), docs: store.listDocuments(), trash: store.listTrashedDocuments() }
    })
    fail(state.loaded === null && state.docs.length === 0 && state.trash.length === 0, 'beforeunload autosave 復活永久刪除文件')
  })

  await check(16, async () => {
    await seed(makeDoc(), '&focus=c')
    await page.waitForTimeout(100)
    fail(await node('c').evaluate(element => element.classList.contains('is-selected')), 'focus URL 未選取搜尋命中節點')
  })

  await check(17, async () => {
    await seed()
    const colors = await page.evaluate(async () => {
      const { createDocumentThumbnail } = await import('/js/store.js')
      const doc = JSON.parse(localStorage.getItem('mindflow.doc.browser-fix'))
      return {
        classic: createDocumentThumbnail({ ...doc, themeId: 'classic-blue' }).toLowerCase(),
        mono: createDocumentThumbnail({ ...doc, themeId: 'monochrome-outline' }).toLowerCase()
      }
    })
    fail(colors.classic.includes('#3f89de'), 'classic-blue 縮圖未用實際藍色')
    fail(colors.mono.includes('#262626') && !colors.mono.includes('#d55f78'), '灰階縮圖仍使用 hash 粉色')
  })

  await check(18, async () => {
    await seed()
    await page.locator('[data-panel-tab="theme"]').click()
    const card = page.locator('.theme-card', { hasText: '深色星空' })
    await card.locator('.theme-card__name').click(); await page.waitForTimeout(650)
    const saved = await stored()
    fail(saved.themeId === 'deep-space', '點主題卡標籤未套用主題')
    fail(await card.evaluate(element => element.classList.contains('is-active')), '整卡點擊後 active 狀態未更新')
  })

  return results
}
