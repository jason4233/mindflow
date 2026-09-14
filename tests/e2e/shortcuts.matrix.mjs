#!/usr/bin/env node
/**
 * MindFlow 永久快捷鍵行為矩陣。
 *
 * 執行：
 *   node tests/e2e/shortcuts.matrix.mjs
 *   node tests/e2e/shortcuts.matrix.mjs --project=chromium
 *   node tests/e2e/shortcuts.matrix.mjs --project=electron
 *
 * 測試只用 Playwright 的真實 keyboard / mouse API。原生 color input 先透過
 * CDP Input.dispatchMouseEvent 走完整 pointer 路徑，再模擬 OS picker 回填值；
 * 這能永久覆蓋「mousedown 先摧毀 contenteditable Range」的回歸。
 */
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ACTION_BINDINGS } from '../../js/editor/keyboard.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOG_DIR = join(ROOT, 'tests', 'e2e')
const PROJECT_ARG = process.argv.find(arg => arg.startsWith('--project='))?.split('=')[1] || 'all'
const FILTER_ARG = process.argv.find(arg => arg.startsWith('--filter='))?.slice('--filter='.length) || ''
// 正式報告只由「全矩陣、全 project」的執行產生；--filter／--project 的部分執行寫到 .partial.md（gitignore），
// 否則一次過濾執行就會把 repo 裡 200+ 列的紀錄蓋成幾列、甚至蓋成修正前的 FAIL。
const REPORT_PATH = join(ROOT, 'docs', (FILTER_ARG || PROJECT_ARG !== 'all') ? 'SHORTCUT_MATRIX.partial.md' : 'SHORTCUT_MATRIX.md')
const HEADLESS = !process.argv.includes('--headed')
const FIXTURE_ID = 'matrix-doc'
const FIXTURE_NODE_COUNT = 6
const FIXTURE = createFixture()

class MatrixFailure extends Error {
  constructor(actual) {
    super(actual)
    this.actual = actual
  }
}

function matrix(shortcut, state, expected, run, options = {}) {
  return {
    shortcut,
    state,
    expected,
    run,
    electron: Boolean(options.electron),
    targetedSynthetic: Boolean(options.targetedSynthetic),
    imeBinding: options.imeBinding || null,
    imeCode: options.imeCode || '',
    orphanKeyup: Boolean(options.orphanKeyup),
    orphanBinding: options.orphanBinding || null
  }
}

const MATRIX_CASES = [
  matrix('Tab', '單選', '新增 1 個下級節點並選中新節點', async h => {
    await h.select('a')
    await h.press('Tab')
    return h.expect(await h.countNodes() === 7 && (await h.selected()).length === 1, `節點=${await h.countNodes()}；選取=${await h.selected()}`)
  }),
  matrix('Tab', '面板焦點', '只移動面板焦點，不新增節點', async h => {
    await h.focusPanel()
    const before = await h.countNodes()
    await h.press('Tab')
    return h.expect(await h.countNodes() === before, `節點 ${before}→${await h.countNodes()}`)
  }),
  matrix('Enter', '單選', '新增 1 個同級節點並選中新節點', async h => {
    await h.select('a')
    await h.press('Enter')
    return h.expect(await h.countNodes() === 7, `節點=${await h.countNodes()}`)
  }),
  matrix('Shift+Tab', '單選', '在目前節點上方插入新父節點', async h => {
    await h.select('a1')
    await h.press('Shift+Tab')
    const doc = await h.savedDoc()
    const a = findFixtureNode(doc.root, 'a')
    return h.expect(await h.countNodes() === 7 && a.children[0].id !== 'a1' && a.children[0].children[0]?.id === 'a1', `a 子節點=${JSON.stringify(a.children.map(node => node.id))}`)
  }),
  matrix('Ctrl+/', '單選', '收合有子節點的分支，再按一次展開', async h => {
    await h.select('a')
    await h.press('Control+/')
    const collapsed = await h.page.locator('[data-node-id="a"] [data-collapse-control]').getAttribute('class')
    const hiddenCount = await h.countNodes()
    await h.press('Control+/')
    return h.expect(collapsed?.includes('is-collapsed') && hiddenCount === 5 && await h.countNodes() === 6, `收合 class=${collapsed}；節點 ${hiddenCount}→${await h.countNodes()}`)
  }),
  matrix('Delete', '單選', '刪除節點及整個子樹', async h => {
    await h.select('a')
    await h.press('Delete')
    return h.expect(await h.countNodes() === 4 && !await h.hasNode('a1'), `節點=${await h.countNodes()}；a1=${await h.hasNode('a1')}`)
  }),
  matrix('Delete', '多選', '刪除所有選取節點及其子樹', async h => {
    await h.multiSelect('a', 'b')
    await h.press('Delete')
    return h.expect(await h.countNodes() === 3, `節點=${await h.countNodes()}`)
  }),
  matrix('Delete', '面板焦點', '不刪除節點', async h => {
    await h.focusPanel()
    await h.press('Delete')
    return h.expect(await h.countNodes() === FIXTURE_NODE_COUNT, `節點=${await h.countNodes()}`)
  }),
  matrix('Ctrl+Delete', '單選', '刪除目前節點但把子節點提升一層', async h => {
    await h.select('a')
    await h.press('Control+Delete')
    const doc = await h.savedDoc()
    return h.expect(await h.countNodes() === 5 && doc.root.children.some(node => node.id === 'a1'), `節點=${await h.countNodes()}；root=${doc.root.children.map(node => node.id).join(',')}`)
  }),
  matrix('Alt+↑', '單選', '節點在同側同級中上移', async h => {
    await h.select('b')
    await h.press('Alt+ArrowUp')
    const doc = await h.savedDoc()
    return h.expect(doc.root.children.indexOf(findFixtureNode(doc.root, 'b')) < doc.root.children.indexOf(findFixtureNode(doc.root, 'a')), `順序=${doc.root.children.map(node => node.id).join(',')}`)
  }),
  matrix('Alt+↓', '單選', '節點在同側同級中下移', async h => {
    await h.select('a')
    await h.press('Alt+ArrowDown')
    const doc = await h.savedDoc()
    return h.expect(doc.root.children.indexOf(findFixtureNode(doc.root, 'a')) > doc.root.children.indexOf(findFixtureNode(doc.root, 'b')), `順序=${doc.root.children.map(node => node.id).join(',')}`)
  }),
  matrix('Ctrl+左鍵拖曳', '未選取', '框選至少兩個右側節點', async h => {
    await h.press('Escape')
    const boxes = await Promise.all(['a', 'b'].map(id => h.node(id).boundingBox()))
    const left = Math.min(...boxes.map(box => box.x)) - 8
    const top = Math.min(...boxes.map(box => box.y)) - 8
    const right = Math.max(...boxes.map(box => box.x + box.width)) + 8
    const bottom = Math.max(...boxes.map(box => box.y + box.height)) + 8
    await h.page.keyboard.down('Control')
    await h.page.mouse.move(left, top)
    await h.page.mouse.down()
    await h.page.mouse.move(right, bottom, { steps: 8 })
    await h.page.mouse.up()
    await h.page.keyboard.up('Control')
    const selected = await h.selected()
    return h.expect(selected.includes('a') && selected.includes('b'), `選取=${selected.join(',')}`)
  }),
  matrix('Ctrl+點擊', '單選→多選', '逐一加入第二個節點', async h => {
    await h.multiSelect('a', 'b')
    const selected = await h.selected()
    return h.expect(selected.length === 2 && selected.includes('a') && selected.includes('b'), `選取=${selected.join(',')}`)
  }),
  matrix('Shift+↑', '單選', '選到視覺上方同級節點', async h => {
    await h.select('b')
    await h.press('Shift+ArrowUp')
    return h.expect((await h.selected())[0] === 'a', `選取=${await h.selected()}`)
  }),
  matrix('Shift+↓', '單選', '選到視覺下方同級節點', async h => {
    await h.select('a')
    await h.press('Shift+ArrowDown')
    return h.expect((await h.selected())[0] === 'b', `選取=${await h.selected()}`)
  }),
  matrix('Ctrl+Alt+C / Ctrl+Alt+V', '單選', '把來源節點樣式貼到目標節點', async h => {
    await h.setNodeShape('a', 'diamond')
    await h.select('a')
    await h.press('Control+Alt+c')
    await h.select('b')
    await h.press('Control+Alt+v')
    return h.expect(await h.node('b').getAttribute('data-shape') === 'diamond', `B shape=${await h.node('b').getAttribute('data-shape')}`)
  }, { electron: true }),
  matrix('Ctrl+D', '單選', '複製選取節點與子樹', async h => {
    await h.select('a')
    await h.press('Control+d')
    return h.expect(await h.countNodes() === 8, `節點=${await h.countNodes()}`)
  }),
  matrix('Ctrl+D', '多選', '複製兩個頂層選取項目', async h => {
    await h.multiSelect('a', 'b')
    await h.press('Control+d')
    return h.expect(await h.countNodes() === 9, `節點=${await h.countNodes()}`)
  }),

  matrix('Ctrl+Z', '單選', '復原上一個新增動作', async h => {
    await h.select('a')
    await h.press('Tab')
    await h.press('Control+z')
    return h.expect(await h.countNodes() === 6, `節點=${await h.countNodes()}`)
  }),
  matrix('Ctrl+Y', '單選', '重做剛復原的新增動作', async h => {
    await h.select('a')
    await h.press('Tab')
    await h.press('Control+z')
    await h.press('Control+y')
    return h.expect(await h.countNodes() === 7, `節點=${await h.countNodes()}`)
  }),
  matrix('Ctrl+C / Ctrl+V', '單選', '複製子樹並貼到目前節點', async h => {
    await h.select('a')
    await h.press('Control+c')
    await h.select('b')
    await h.press('Control+v')
    return h.expect(await h.countNodes() === 8, `節點=${await h.countNodes()}`)
  }),
  matrix('Ctrl+X / Ctrl+V', '單選', '剪下子樹後可貼回其他節點', async h => {
    await h.select('a')
    await h.press('Control+x')
    const cutCount = await h.countNodes()
    await h.select('b')
    await h.press('Control+v')
    return h.expect(cutCount === 4 && await h.countNodes() === 6, `節點 ${cutCount}→${await h.countNodes()}`)
  }),
  matrix('Ctrl+S', '編輯後', '立即把最新文件寫入 localStorage', async h => {
    await h.select('a')
    await h.press('Tab')
    const before = countFixtureNodes(await h.storedDoc())
    await h.press('Control+s')
    const after = countFixtureNodes(await h.storedDoc())
    return h.expect(before === 6 && after === 7, `儲存節點 ${before}→${after}`)
  }),

  matrix('F6', '單選', '循環切換到下一個主題', async h => {
    const before = (await h.storedDoc()).themeId
    await h.press('F6')
    const after = (await h.savedDoc()).themeId
    return h.expect(after !== before, `主題 ${before}→${after}`)
  }),
  matrix('F6', '面板焦點', '仍視為全域快捷鍵切換主題', async h => {
    await h.focusPanel()
    const before = (await h.storedDoc()).themeId
    await h.press('F6')
    const after = (await h.savedDoc()).themeId
    return h.expect(after !== before, `主題 ${before}→${after}`)
  }),
  matrix('Ctrl+P', '單選', '打開右側主題分頁', async h => {
    await h.select('a')
    await h.press('Control+p')
    return h.expect(await h.isPanelTab('theme'), `panel=${await h.panelState()}`)
  }),
  matrix('Alt+Y', '單選', '打開右側樣式分頁', async h => {
    await h.select('a')
    await h.press('Alt+y')
    return h.expect(await h.isPanelTab('style'), `panel=${await h.panelState()}`)
  }),

  matrix('Space', '單選', '進入 contenteditable 文字編輯', async h => {
    await h.select('a')
    await h.press('Space')
    return h.expect(await h.node('a').locator('.mind-node__text').getAttribute('contenteditable') === 'true', `contenteditable=${await h.node('a').locator('.mind-node__text').getAttribute('contenteditable')}`)
  }),
  matrix('Shift+Enter', '編輯中', '在節點文字內插入換行而不離開編輯', async h => {
    await h.edit('a')
    await h.press('Shift+Enter')
    const text = await h.node('a').locator('.mind-node__text').innerText()
    return h.expect(text.includes('\n') && await h.isEditing('a'), `文字=${JSON.stringify(text)}；editing=${await h.isEditing('a')}`)
  }),
  ...[
    ['Ctrl+B', 'Control+b', '<b'],
    ['Ctrl+I', 'Control+i', '<i'],
    ['Ctrl+U', 'Control+u', '<u']
  ].map(([shortcut, key, marker]) => matrix(shortcut, '編輯中', `套用 ${shortcut.slice(-1)} 文字格式`, async h => {
    await h.edit('a')
    await h.press(key)
    await h.press('Enter')
    const richText = findFixtureNode(await h.savedDoc().then(doc => doc.root), 'a').richText || ''
    return h.expect(richText.toLowerCase().includes(marker), `richText=${richText}`)
  })),
  matrix('Ctrl+G', '單選', '啟動格式刷並把來源樣式套到下一個點擊節點', async h => {
    await h.setNodeShape('a', 'diamond')
    await h.select('a')
    await h.press('Control+g')
    const armed = await h.page.locator('#canvas').evaluate(element => element.classList.contains('is-format-painting'))
    await h.select('b')
    return h.expect(armed && await h.node('b').getAttribute('data-shape') === 'diamond', `armed=${armed}；B shape=${await h.node('b').getAttribute('data-shape')}`)
  }),
  ...Array.from({ length: 9 }, (_, index) => {
    const value = index + 1
    return matrix(`Ctrl+${value}`, '單選', `設定優先順序圖示 ${value}`, async h => {
      await h.select('a')
      await h.press(`Control+${value}`)
      const node = findFixtureNode((await h.savedDoc()).root, 'a')
      return h.expect(node.icons.includes(`priority:${value}`), `icons=${node.icons.join(',')}`)
    })
  }),
  matrix('Ctrl+Shift+>', '單選', '字級增加 2px', async h => {
    await h.select('a')
    const before = await h.computedFontSize('a')
    await h.press('Control+Shift+Period')
    const after = await h.computedFontSize('a')
    return h.expect(after === before + 2, `字級 ${before}→${after}`)
  }),
  matrix('Ctrl+Shift+<', '單選', '字級減少 2px', async h => {
    await h.select('a')
    const before = await h.computedFontSize('a')
    await h.press('Control+Shift+Comma')
    const after = await h.computedFontSize('a')
    return h.expect(after === before - 2, `字級 ${before}→${after}`)
  }),

  matrix('Ctrl+Alt+K', '單選', '開啟連結輸入 dialog', async h => {
    await h.select('a')
    await h.press('Control+Alt+k')
    return h.expect(await h.page.locator('[data-link-form]').evaluate(form => form.closest('dialog').open), '連結 dialog 未開啟')
  }, { electron: true }),
  matrix('Ctrl+Alt+M', '單選', '備註 drawer 已掛載並開啟、textarea 取得焦點', async h => {
    await h.select('a')
    await h.press('Control+Alt+m')
    const state = await h.page.evaluate(() => ({
      mounted: Boolean(document.querySelector('.feature-drawer [data-note-editor]')),
      open: Boolean(document.querySelector('.feature-drawer:not([hidden])')),
      focused: document.activeElement?.matches?.('[data-note-editor]') || false
    }))
    return h.expect(state.mounted && state.open && state.focused, JSON.stringify(state))
  }, { electron: true }),
  matrix('Ctrl+Alt+M', '未選取', '不開 drawer 並提示先選取節點', async h => {
    await h.press('Escape')
    await h.press('Control+Alt+m')
    const open = await h.page.locator('.feature-drawer').evaluate(element => !element.hidden)
    const toast = await h.page.locator('#feature-toast').textContent()
    return h.expect(!open && toast.includes('請先選取'), `open=${open}；toast=${toast}`)
  }),
  matrix('Ctrl+Alt+M', '面板焦點', '保留面板輸入操作，不誤開備註', async h => {
    await h.focusPanel()
    await h.press('Control+Alt+m')
    const open = await h.page.locator('.feature-drawer').evaluate(element => !element.hidden)
    return h.expect(!open, `drawer open=${open}`)
  }),
  matrix('Ctrl+Alt+T', '多選', '對連續同級節點建立概要', async h => {
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    return h.expect(await h.page.locator('[data-summary-id]').count() >= 1, `summary DOM=${await h.page.locator('[data-summary-id]').count()}`)
  }, { electron: true }),
  // ═══ 測試先行（2026-09-15 晨睿要求）：先定義使用者情境的過關／不過關，再實作 ═══
  // 情境：使用者選了同一層的相鄰節點按 Ctrl+Alt+T 建概要。
  // 過關＝括號沿著「這些節點排列的方向」延伸，並放在遠離父節點的外側；不過關＝方向錯（例如組織圖
  // 底下水平排列的節點卻畫成直立括號）或放在節點內側／壓到節點。
  matrix('概要方向：右側同級（心智圖）', '多選', '括號直立、放在節點右外側', async h => {
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const bracket = await h.summaryBracketBox()
    const nodes = await h.unionBox(['a', 'b'])
    const vertical = bracket.height > bracket.width
    const outside = bracket.x >= nodes.right - 2
    return h.expect(vertical && outside, `直立=${vertical}；在右外側=${outside}（括號 x=${Math.round(bracket.x)}，節點右緣=${Math.round(nodes.right)}）`)
  }, { electron: true }),
  matrix('概要方向：左側同級（心智圖）', '多選', '括號直立、放在節點左外側（不可壓到節點或跑到右邊）', async h => {
    await h.multiSelect('c', 'd')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const bracket = await h.summaryBracketBox()
    const nodes = await h.unionBox(['c', 'd'])
    const vertical = bracket.height > bracket.width
    const outsideLeft = bracket.right <= nodes.x + 2
    return h.expect(vertical && outsideLeft, `直立=${vertical}；在左外側=${outsideLeft}（括號右緣=${Math.round(bracket.right)}，節點左緣=${Math.round(nodes.x)}）`)
  }, { electron: true }),
  matrix('概要方向：組織圖', '多選', '子節點水平排列時括號改為橫向、放在節點下方', async h => {
    await h.resetWithLayout('org')
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const bracket = await h.summaryBracketBox()
    const nodes = await h.unionBox(['a', 'b'])
    const horizontal = bracket.width > bracket.height
    const below = bracket.y >= nodes.bottom - 2
    return h.expect(horizontal && below, `橫向=${horizontal}；在下方=${below}（括號 y=${Math.round(bracket.y)}，節點下緣=${Math.round(nodes.bottom)}）`)
  }, { electron: true }),

  // 情境：使用者拖曳概要的黃色邊界點，改變涵蓋範圍。直立括號沿 y 拖、橫向括號沿 x 拖。
  // 過關＝放開後括號涵蓋到目標節點（DOM 上括號 bbox 延伸到該節點）；不過關＝範圍沒變（舊碼只看 y，
  // 組織圖同級 y 相同 → 拖不動）。
  matrix('概要邊界拖曳：直立（心智圖）', '多選', '把上邊界往下拖到第二個節點 → 概要只剩它', async h => {
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const control = await h.page.locator('#connections-layer .summary-boundary[data-summary-edge="startNodeId"]').boundingBox()
    const target = await h.unionBox(['b'])
    await h.page.mouse.move(control.x + control.width / 2, control.y + control.height / 2)
    await h.page.mouse.down()
    await h.page.mouse.move(control.x + control.width / 2, (target.y + target.bottom) / 2, { steps: 6 })
    await h.page.mouse.up()
    await h.page.waitForTimeout(250)
    const bracket = await h.summaryBracketBox()
    const a = await h.unionBox(['a'])
    const shrunk = bracket.y >= a.bottom - 2 && bracket.bottom >= target.bottom - 2
    return h.expect(shrunk, `括號 y=${Math.round(bracket.y)}（a 下緣=${Math.round(a.bottom)}）、括號下緣=${Math.round(bracket.bottom)}（b 下緣=${Math.round(target.bottom)}）`)
  }, { electron: true }),
  matrix('概要邊界拖曳：橫向（組織圖）', '多選', '把右邊界往右拖到第三個節點 → 概要涵蓋三個', async h => {
    await h.resetWithLayout('org')
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const control = await h.page.locator('#connections-layer .summary-boundary[data-summary-edge="endNodeId"]').boundingBox()
    const target = await h.unionBox(['c'])
    await h.page.mouse.move(control.x + control.width / 2, control.y + control.height / 2)
    await h.page.mouse.down()
    await h.page.mouse.move((target.x + target.right) / 2, control.y + control.height / 2, { steps: 6 })
    await h.page.mouse.up()
    await h.page.waitForTimeout(250)
    const bracket = await h.summaryBracketBox()
    const grown = bracket.right >= target.right - 2
    return h.expect(grown, `括號右緣=${Math.round(bracket.right)}（c 右緣=${Math.round(target.right)}）`)
  }, { electron: true }),

  // ═══ 2026-09-15 紅隊審查後補的使用者情境（預備輸入） ═══
  // 情境：選取節點（預備中）誤按 Shift+Enter。過關＝文字不動、不進編輯；不過關＝原文被換行取代（節點被清空）。
  matrix('Shift+Enter（預備）', '單選', '不清空原文、不進入編輯', async h => {
    await h.select('a')
    await h.press('Shift+Enter')
    await h.page.waitForTimeout(150)
    const text = await h.nodeText('a')
    const editing = await h.isEditing('a')
    return h.expect(text === 'Alpha' && !editing, `text=${JSON.stringify(text)}；editing=${editing}`)
  }, { electron: true }),
  // 情境：預備中按 Shift+Space。過關＝與 Space 相同進入編輯且原文保留；不過關＝原文被一個空白取代。
  matrix('Shift+Space（預備）', '單選', '進入編輯、原文保留', async h => {
    await h.select('a')
    await h.press('Shift+Space')
    await h.page.waitForTimeout(150)
    const text = await h.nodeText('a')
    const editing = await h.isEditing('a')
    return h.expect(editing && text === 'Alpha', `text=${JSON.stringify(text)}；editing=${editing}`)
  }, { electron: true }),
  // 情境：打了字按 Esc 取消。過關＝原文還原且節點重新預備（下一個中文字仍能直接組字）；不過關＝選取但未預備。
  matrix('Esc 取消後重新預備', '單選', '取消編輯後節點仍是預備狀態', async h => {
    await h.select('a')
    await h.page.keyboard.type('x')
    await h.page.waitForTimeout(100)
    await h.press('Escape')
    await h.page.waitForTimeout(200)
    const text = await h.nodeText('a')
    const armed = await h.isArmed('a')
    return h.expect(text === 'Alpha' && armed, `text=${JSON.stringify(text)}；armed=${armed}`)
  }, { electron: true }),
  // 情境：Space 進編輯、沒改字直接 Enter。過關＝節點重新預備；不過關＝文字沒變就沒有重繪、停在未預備。
  matrix('Enter 提交未改字後重新預備', '單選', '未變更的提交也要重新預備', async h => {
    await h.select('a')
    await h.press('Space')
    await h.page.waitForTimeout(100)
    await h.press('Enter')
    await h.page.waitForTimeout(200)
    const armed = await h.isArmed('a')
    return h.expect(armed, `armed=${armed}`)
  }, { electron: true }),
  // 情境：用工具列「加下級」按鈕新增節點後直接打字。過關＝新節點進入編輯且文字是打的字；
  // 不過關＝焦點留在工具列按鈕、打字無效（含中文輸入法）。
  matrix('工具列加下級後直接打字', '單選', '按鈕新增的節點要能直接輸入', async h => {
    await h.select('a')
    await h.page.locator('#add-child-button').click()
    await h.page.waitForTimeout(200)
    await h.page.keyboard.type('x')
    await h.page.waitForTimeout(150)
    const id = (await h.selected())[0]
    const text = id ? await h.nodeText(id) : ''
    return h.expect(Boolean(id) && text === 'x', `選取=${id}；text=${JSON.stringify(text)}`)
  }, { electron: true }),
  // 情境：預備中按 End 再打字。過關＝仍是「取代原文」（隱形全選沒被游標鍵改掉）；不過關＝變成 Alphax。
  matrix('End 鍵不改變預備全選', '單選', '游標鍵不得偷偷改掉全選範圍', async h => {
    await h.select('a')
    await h.press('End')
    await h.page.keyboard.type('x')
    await h.page.waitForTimeout(150)
    const text = await h.nodeText('a')
    return h.expect(text === 'x', `text=${JSON.stringify(text)}`)
  }, { electron: true }),

  // ═══ 2026-09-15 紅隊審查後補的使用者情境（概要） ═══
  // 情境：只選一個節點按 Ctrl+Alt+T。過關＝畫出概要；不過關＝toast 拒絕（GitMind 允許單節點概要）。
  matrix('概要單節點', '單選', '只選一個節點也能建概要', async h => {
    await h.select('a')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const brackets = await h.page.locator('#connections-layer .summary-bracket').count()
    return h.expect(brackets === 1, `括號數=${brackets}`)
  }, { electron: true }),
  // 情境：組織圖裡 a 有子節點 a1（在 a 正下方），對 a、b 建概要。過關＝括號、標籤、把手都不壓到 a1
  //（放在整棵子樹底下）；不過關＝括號畫過 a1。
  matrix('概要不壓子節點（組織圖）', '多選', '括號放在覆蓋節點整棵子樹的外側', async h => {
    await h.resetWithLayout('org')
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const overlaps = await h.page.evaluate(covered => {
      const rects = [
        ...document.querySelectorAll('#connections-layer .summary-bracket, #connections-layer .summary-boundary, .summary-node')
      ].map(el => el.getBoundingClientRect())
      const others = [...document.querySelectorAll('#nodes-layer .mind-node')]
        .filter(node => !covered.includes(node.dataset.nodeId))
        .map(node => ({ id: node.dataset.nodeId, r: node.getBoundingClientRect() }))
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      return others.filter(other => rects.some(rect => hit(rect, other.r))).map(other => other.id)
    }, ['a', 'b'])
    return h.expect(overlaps.length === 0, `壓到的節點=${overlaps.join(',') || '無'}`)
  }, { electron: true }),
  // 情境：魚骨圖的 children 陣列順序與畫面相反（a 在最右）。對 a、b 建概要後，拖「畫面最左」的把手再往左到 c。
  // 過關＝括號往左延伸涵蓋 c；不過關＝把手左右顛倒，範圍縮小或拖不動。
  matrix('概要邊界拖曳：魚骨圖', '多選', '陣列與畫面反向時把手仍照畫面位置運作', async h => {
    await h.resetWithLayout('fishbone')
    await h.multiSelect('a', 'b')
    await h.press('Control+Alt+t')
    await h.page.waitForTimeout(200)
    const boxes = {}
    for (const edge of ['startNodeId', 'endNodeId']) boxes[edge] = await h.page.locator(`#connections-layer .summary-boundary[data-summary-edge="${edge}"]`).boundingBox()
    const leftHandle = boxes.startNodeId.x < boxes.endNodeId.x ? boxes.startNodeId : boxes.endNodeId
    const target = await h.unionBox(['c'])
    if (!(target.right < leftHandle.x)) throw new MatrixFailure('前提不成立：c 應在左把手的左邊')
    await h.page.mouse.move(leftHandle.x + leftHandle.width / 2, leftHandle.y + leftHandle.height / 2)
    await h.page.mouse.down()
    await h.page.mouse.move((target.x + target.right) / 2, leftHandle.y + leftHandle.height / 2, { steps: 6 })
    await h.page.mouse.up()
    await h.page.waitForTimeout(250)
    const bracket = await h.summaryBracketBox()
    return h.expect(bracket.x <= target.x + 2, `括號左緣=${Math.round(bracket.x)}（c 左緣=${Math.round(target.x)}）`)
  }, { electron: true }),

  // ═══ 紅隊審查後補的使用者情境（右鍵框選） ═══
  // 情境：使用者先在右側面板改了樣式（焦點留在面板的 select），再右鍵圈選節點按 Delete。
  // 過關＝節點被刪；不過關＝Delete 被當表單鍵吞掉、沒反應。
  matrix('右鍵框選後快捷鍵仍可用（焦點原在面板）', '單選', '框選會把焦點拉回畫布', async h => {
    await h.select('b')
    await h.page.locator('#sidepanel').evaluate(element => element.classList.remove('is-collapsed'))
    await h.page.waitForTimeout(150)
    const focused = await h.page.evaluate(() => {
      const control = [...document.querySelectorAll('#sidepanel select, #sidepanel input:not([type="hidden"])')]
        .find(element => element.offsetParent !== null && !element.disabled)
      control?.focus()
      return document.activeElement?.tagName || ''
    })
    if (!['SELECT', 'INPUT'].includes(focused)) throw new MatrixFailure(`前提不成立：面板控制項未取得焦點（${focused}）`)
    const nodes = await h.unionBox(['a', 'a1'])
    const start = { x: nodes.x - 28, y: nodes.y - 28 }
    const end = { x: nodes.right + 28, y: nodes.bottom + 28 }
    if (!await h.isBlankPoint(start.x, start.y)) throw new MatrixFailure('起點不是空白畫布')
    await h.page.mouse.move(start.x, start.y)
    await h.page.mouse.down({ button: 'right' })
    await h.page.mouse.move(end.x, end.y, { steps: 8 })
    await h.page.mouse.up({ button: 'right' })
    await h.page.waitForTimeout(250)
    const selected = await h.selected()
    const before = await h.page.locator('#nodes-layer .mind-node').count()
    await h.press('Delete')
    await h.page.waitForTimeout(300)
    const after = await h.page.locator('#nodes-layer .mind-node').count()
    return h.expect(selected.includes('a') && selected.includes('a1') && after < before, `選取=${selected.join(',')}；節點數 ${before}→${after}`)
  }, { electron: true }),
  // 情境：右鍵拖出 40px 又拉回原點放開。這是一次「拖曳」（曾超過門檻），過關＝不彈選單、不平移；
  // 不過關＝選取先被清掉、選單卻照開（拖曳／單擊兩種語意混在一起）。
  matrix('右鍵拖出再拉回原點', '單選', '曾超過門檻就算拖曳：不開選單', async h => {
    await h.select('d')
    const nodes = await h.unionBox(['a'])
    const point = { x: nodes.x - 60, y: nodes.y - 60 }
    if (!await h.isBlankPoint(point.x, point.y)) throw new MatrixFailure('起點不是空白畫布')
    await h.page.mouse.move(point.x, point.y)
    await h.page.mouse.down({ button: 'right' })
    await h.page.mouse.move(point.x + 40, point.y + 40, { steps: 4 })
    await h.page.mouse.move(point.x + 1, point.y + 1, { steps: 4 })
    await h.page.mouse.up({ button: 'right' })
    await h.page.waitForTimeout(250)
    const menuOpen = await h.contextMenuOpen()
    return h.expect(!menuOpen, `選單開啟=${menuOpen}`)
  }, { electron: true }),
  // 情境：正在編輯 a 的文字時，右鍵圈選 c、d。過關＝編輯結束（文字已提交）、c/d 被選取；
  // 不過關＝a 仍在編輯、焦點留在文字裡（接著按 Delete 會刪到文字而不是節點）。
  matrix('編輯中右鍵框選', '單選', '框選會結束進行中的編輯', async h => {
    await h.node('a').dblclick()
    await h.page.waitForTimeout(150)
    if (!await h.isEditing('a')) throw new MatrixFailure('前提不成立：雙擊後未進入編輯')
    const nodes = await h.unionBox(['c', 'd'])
    const start = { x: nodes.x - 28, y: nodes.y - 28 }
    const end = { x: nodes.right + 28, y: nodes.bottom + 28 }
    if (!await h.isBlankPoint(start.x, start.y)) throw new MatrixFailure('起點不是空白畫布')
    await h.page.mouse.move(start.x, start.y)
    await h.page.mouse.down({ button: 'right' })
    await h.page.mouse.move(end.x, end.y, { steps: 8 })
    await h.page.mouse.up({ button: 'right' })
    await h.page.waitForTimeout(250)
    const editing = await h.isEditing('a')
    const selected = await h.selected()
    return h.expect(!editing && selected.includes('c') && selected.includes('d'), `a 編輯中=${editing}；選取=${selected.join(',')}`)
  }, { electron: true }),

  // 情境：使用者按住滑鼠右鍵在空白處拖出矩形，放開後矩形內的節點被選取，且不彈出右鍵選單、畫布不平移。
  // 過關＝矩形內節點全選、選單未開、畫布未動；不過關＝沒選到／彈出選單／畫布被平移。
  matrix('右鍵拖曳圈選', '未選取', '按住右鍵拖出矩形圈選節點，放開不彈選單、畫布不平移', async h => {
    const nodes = await h.unionBox(['a', 'a1'])
    const start = { x: nodes.x - 28, y: nodes.y - 28 }
    const end = { x: nodes.right + 28, y: nodes.bottom + 28 }
    if (!await h.isBlankPoint(start.x, start.y)) throw new MatrixFailure('起點不是空白畫布')
    const worldBefore = await h.page.locator('#world').evaluate(el => el.style.transform)
    await h.page.mouse.move(start.x, start.y)
    await h.page.mouse.down({ button: 'right' })
    await h.page.mouse.move(end.x, end.y, { steps: 8 })
    await h.page.mouse.up({ button: 'right' })
    await h.page.waitForTimeout(250)
    const selected = await h.selected()
    const menuOpen = await h.contextMenuOpen()
    const worldAfter = await h.page.locator('#world').evaluate(el => el.style.transform)
    const gotBoth = selected.includes('a') && selected.includes('a1')
    return h.expect(gotBoth && !menuOpen && worldBefore === worldAfter, `選取=${selected.join(',')}；選單開啟=${menuOpen}；畫布位移=${worldBefore !== worldAfter}`)
  }, { electron: true }),
  matrix('右鍵單擊', '未選取', '右鍵按下即放（沒有拖曳）仍打開右鍵選單', async h => {
    const nodes = await h.unionBox(['a'])
    const point = { x: nodes.x - 60, y: nodes.y - 60 }
    if (!await h.isBlankPoint(point.x, point.y)) throw new MatrixFailure('點擊處不是空白畫布')
    await h.page.mouse.click(point.x, point.y, { button: 'right' })
    await h.page.waitForTimeout(250)
    const menuOpen = await h.contextMenuOpen()
    return h.expect(menuOpen, `選單開啟=${menuOpen}`)
  }, { electron: true }),

  matrix('Alt+P', '單選', '打開圖片 file chooser', async h => {
    await h.select('a')
    await h.page.locator('input[type="file"][accept="image/*"]').evaluate(input => {
      input.addEventListener('click', () => { document.body.dataset.matrixFileInputClicked = 'true' }, { once: true })
    })
    const chooserOpened = await h.withFileChooserIntercept(() => h.press('Alt+p'))
    const clicked = await h.page.evaluate(() => document.body.dataset.matrixFileInputClicked === 'true')
    return h.expect(clicked && chooserOpened, `file input click=${clicked}；filechooser=${chooserOpened}`)
  }, { electron: true }),
  matrix('Alt+I', '單選', '打開右側圖示分頁', async h => {
    await h.select('a')
    await h.press('Alt+i')
    return h.expect(await h.isPanelTab('icon'), `panel=${await h.panelState()}`)
  }),
  matrix('F4', '單選', '進入關聯線選點模式，點目標後建立線', async h => {
    await h.select('a')
    await h.press('F4')
    const picking = await h.page.locator('#canvas').evaluate(element => element.classList.contains('is-relation-picking'))
    await h.select('b')
    return h.expect(picking && await h.page.locator('[data-relation-id]').count() === 1, `picking=${picking}；relation=${await h.page.locator('[data-relation-id]').count()}`)
  }, { electron: true }),
  // 情境：使用者拖曳選中關聯線的黃色控制點來改弧度。過關＝線的形狀改變且畫布沒被平移；
  // 不過關＝畫布跟著指標跑、線形不變（capture 階段的平移把把手劫走）。
  matrix('關聯線控制點拖曳', '單選', '拖曳控制點改變弧度，畫布不平移', async h => {
    await h.select('a')
    await h.press('F4')
    await h.select('b')
    await h.page.waitForTimeout(200)
    const handle = await h.page.locator('#connections-layer .relation-control[data-handle="cp1"]').boundingBox()
    if (!handle) throw new MatrixFailure('選中關聯線後沒有控制點')
    const pathBefore = await h.page.locator('[data-relation-id] path').first().getAttribute('d')
    const worldBefore = await h.page.locator('#world').evaluate(el => el.style.transform)
    await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await h.page.mouse.down()
    await h.page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 40, { steps: 6 })
    await h.page.mouse.up()
    await h.page.waitForTimeout(250)
    const pathAfter = await h.page.locator('[data-relation-id] path').first().getAttribute('d')
    const worldAfter = await h.page.locator('#world').evaluate(el => el.style.transform)
    return h.expect(pathBefore !== pathAfter && worldBefore === worldAfter, `線形改變=${pathBefore !== pathAfter}；畫布位移=${worldBefore !== worldAfter}`)
  }, { electron: true }),
  matrix('Ctrl+Alt+R', '單選', '評論佔位功能提供可見回饋', async h => {
    await h.select('a')
    await h.press('Control+Alt+r')
    const toast = await h.page.locator('[data-mindflow-toast]').textContent()
    return h.expect(Boolean(toast.trim()), `toast=${toast}`)
  }, { electron: true }),

  matrix('Ctrl+0', '畫布', '把縮放重設為 100%', async h => {
    await h.ctrlWheel(-220)
    await h.press('Control+0')
    return h.expect((await h.zoom()) === 100, `zoom=${await h.zoom()}%`)
  }),
  matrix('Ctrl+滾輪', '畫布', '真實 wheel 事件改變縮放', async h => {
    const before = await h.zoom()
    await h.ctrlWheel(-180)
    const after = await h.zoom()
    return h.expect(after > before, `zoom ${before}%→${after}%`)
  }),
  matrix('Ctrl+Shift+L', '畫布', '一鍵整理並重新 fit 畫布', async h => {
    await h.ctrlWheel(-400)
    const before = await h.zoom()
    await h.press('Control+Shift+l')
    await h.page.waitForTimeout(100)
    const after = await h.zoom()
    const fitted = await h.nodesWithinCanvas()
    return h.expect(fitted, `zoom ${before}%→${after}%；nodesWithinCanvas=${fitted}`)
  }),
  matrix('Ctrl+O', '畫布', '切換到大綱相關視圖', async h => {
    const before = await h.page.locator('#editor-shell').getAttribute('data-view-mode')
    await h.press('Control+o')
    const after = await h.page.locator('#editor-shell').getAttribute('data-view-mode')
    return h.expect(after && after !== before, `view ${before}→${after}`)
  }),
  matrix('左鍵拖曳空白', '畫布', '平移 world transform', async h => {
    const canvas = await h.page.locator('#canvas').boundingBox()
    const before = await h.page.locator('#world').getAttribute('style')
    await h.page.mouse.move(canvas.x + 24, canvas.y + canvas.height - 80)
    await h.page.mouse.down()
    await h.page.mouse.move(canvas.x + 104, canvas.y + canvas.height - 30, { steps: 6 })
    await h.page.mouse.up()
    const after = await h.page.locator('#world').getAttribute('style')
    return h.expect(before !== after, `transform ${before}→${after}`)
  }),
  matrix('F11', '畫布', '切換瀏覽器全螢幕狀態', async h => {
    await h.press('F11')
    await h.page.waitForTimeout(50)
    return h.expect(await h.page.evaluate(() => Boolean(document.fullscreenElement)), `fullscreen=${await h.page.evaluate(() => Boolean(document.fullscreenElement))}`)
  }),
  matrix('Ctrl+Alt+F', '畫布', '適應整張心智圖', async h => {
    await h.ctrlWheel(-500)
    const before = await h.zoom()
    await h.press('Control+Alt+f')
    const after = await h.zoom()
    const fitted = await h.nodesWithinCanvas()
    return h.expect(fitted, `zoom ${before}%→${after}%；nodesWithinCanvas=${fitted}`)
  }),
  matrix('Ctrl+Shift+R', '畫布', '把根節點置中畫布', async h => {
    const canvas = await h.page.locator('#canvas').boundingBox()
    await h.page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 70)
    await h.page.mouse.down()
    await h.page.mouse.move(canvas.x + 180, canvas.y + canvas.height - 20, { steps: 5 })
    await h.page.mouse.up()
    await h.press('Control+Shift+r')
    const root = await h.node('root').boundingBox()
    const rootCenter = root.x + root.width / 2
    const canvasCenter = canvas.x + canvas.width / 2
    return h.expect(Math.abs(rootCenter - canvasCenter) < 3, `rootCenter=${rootCenter.toFixed(1)}；canvasCenter=${canvasCenter.toFixed(1)}`)
  }),
  matrix('Ctrl+F', '畫布', '打開尋找與取代面板並聚焦搜尋框', async h => {
    await h.press('Control+f')
    const state = await h.page.evaluate(() => ({
      open: !document.querySelector('.find-replace-panel')?.hidden,
      focused: document.activeElement?.matches?.('[data-find-query]') || false
    }))
    return h.expect(state.open && state.focused, JSON.stringify(state))
  }),
  matrix('Ctrl+A', '畫布', '選取所有可見節點', async h => {
    await h.press('Control+a')
    return h.expect((await h.selected()).length === FIXTURE_NODE_COUNT, `選取=${(await h.selected()).length}`)
  }),
  matrix('Esc', '專注模式', '退出專注模式', async h => {
    await h.page.locator('#more-button').click()
    await h.page.locator('[data-more-action="focusMode"]').click()
    const before = await h.page.evaluate(() => document.body.classList.contains('is-c1-focus-mode'))
    await h.press('Escape')
    const after = await h.page.evaluate(() => document.body.classList.contains('is-c1-focus-mode'))
    return h.expect(before && !after, `focus ${before}→${after}`)
  }),
  matrix('Esc', '演示模式', '退出演示模式並恢復編輯畫布', async h => {
    await h.select('a')
    await h.page.locator('#presentation-button').click()
    await h.page.waitForFunction(() => document.body.classList.contains('is-presentation-mode'))
    await h.press('Escape')
    await h.page.waitForTimeout(50)
    const active = await h.page.evaluate(() => document.body.classList.contains('is-presentation-mode'))
    return h.expect(!active, `presentation active=${active}`)
  }),
  matrix('Shift+Alt+H', '畫布', '切換歷史版本 drawer', async h => {
    await h.press('Shift+Alt+h')
    return h.expect(await h.page.locator('.history-panel').evaluate(element => !element.hidden), `history hidden=${await h.page.locator('.history-panel').getAttribute('hidden')}`)
  }),
  matrix('Shift+Alt+F', '畫布', '新增並選取懸浮節點', async h => {
    await h.press('Shift+Alt+f')
    return h.expect(await h.countNodes() === 7 && await h.page.locator('.mind-node--floating').count() === 1, `節點=${await h.countNodes()}；floating=${await h.page.locator('.mind-node--floating').count()}`)
  }),

  // 空白畫布雙擊：真滑鼠事件；重點是「建立後必須留在編輯狀態」——自動存檔曾在 500ms 後
  // commit 掉 session，把使用者踢出輸入狀態，導致只留下一個空節點（看起來像沒反應）。
  matrix('雙擊空白畫布', '畫布', '建立懸浮節點並保持在編輯狀態', async h => {
    const before = await h.countNodes()
    await h.dblclickBlankCanvas()
    await h.page.waitForTimeout(1200)
    const editing = await h.page.locator('#nodes-layer .mind-node__text[contenteditable="true"]').count()
    const floating = await h.page.locator('.mind-node--floating').count()
    return h.expect(await h.countNodes() === before + 1 && editing === 1 && floating === 1,
      `節點 ${before}→${await h.countNodes()}；editing=${editing}；floating=${floating}`)
  }, { electron: true }),
  matrix('雙擊空白畫布 → 輸入', '畫布', '輸入中停頓超過存檔週期仍留在編輯狀態且文字完整', async h => {
    await h.dblclickBlankCanvas()
    await h.page.keyboard.type('市場策略')
    await h.page.waitForTimeout(900)
    const editingAfterPause = await h.page.locator('#nodes-layer .mind-node__text[contenteditable="true"]').count()
    await h.page.keyboard.type('A案')
    await h.page.keyboard.press('Enter')
    // 存檔是 500ms debounce；等它自然落盤才算數（不用 Ctrl+S 掩蓋週期存檔的行為）
    await h.page.waitForTimeout(900)
    const doc = await h.storedDoc()
    const saved = JSON.stringify(doc).includes('市場策略A案')
    return h.expect(editingAfterPause === 1 && saved, `停頓後 editing=${editingAfterPause}；已存檔=${saved}`)
  }, { electron: true }),
  matrix('雙擊空白畫布 → 獨立成圖', '畫布', '新圖自成中心主題、子節點跟著它、主圖不留連線殘段', async h => {
    const mainPathsBefore = await h.page.locator('#connections-layer .connection-path').count()
    await h.dblclickBlankCanvas()
    await h.page.keyboard.type('SecondMap')
    await h.page.keyboard.press('Enter')
    await h.page.waitForTimeout(400)
    const mapRoot = h.page.locator('#nodes-layer .mind-node--floating')
    const rootBox = await mapRoot.boundingBox()
    const isCenterTopic = await mapRoot.getAttribute('data-depth') === '0'
    // 新圖加一個子節點，必須排在新圖旁邊而不是回到原圖底下
    const idsBeforeChild = await h.page.evaluate(() =>
      [...document.querySelectorAll('#nodes-layer .mind-node')].map(node => node.dataset.nodeId))
    await mapRoot.click()
    await h.page.keyboard.press('Tab')
    await h.page.waitForTimeout(400)
    await h.page.keyboard.press('Escape')
    // 用 DOM 差異找新子節點：localStorage 有 500ms 存檔延遲，直接讀會抓到還沒寫入的舊快照
    const childId = await h.page.evaluate(existing => {
      const ids = [...document.querySelectorAll('#nodes-layer .mind-node')].map(node => node.dataset.nodeId)
      return ids.find(id => !existing.includes(id)) || ''
    }, idsBeforeChild)
    const childBox = childId ? await h.page.locator(`#nodes-layer [data-node-id="${childId}"]`).boundingBox() : null
    const distance = childBox ? Math.hypot(childBox.x - rootBox.x, childBox.y - rootBox.y) : Infinity
    // 主圖只多出「新圖 root → 子節點」這一條連線，沒有主圖連到新圖的殘段
    const pathsAfter = await h.page.locator('#connections-layer .connection-path').count()
    return h.expect(isCenterTopic && distance < 400 && pathsAfter === mainPathsBefore + 1,
      `depth0=${isCenterTopic}；子節點距離=${Math.round(distance)}；連線 ${mainPathsBefore}→${pathsAfter}`)
  }, { electron: true }),
  matrix('雙擊節點', '單選', '雙擊既有節點進入編輯且不新增懸浮節點', async h => {
    const before = await h.countNodes()
    await h.node('a').dblclick()
    await h.page.waitForTimeout(1200)
    const editing = await h.page.locator('#nodes-layer [data-node-id="a"] .mind-node__text[contenteditable="true"]').count()
    return h.expect(await h.countNodes() === before && editing === 1, `節點 ${before}→${await h.countNodes()}；editing=${editing}`)
  }, { electron: true }),

  ...[
    ['↑', 'ArrowUp', 'b', axisCheck('y', -1)],
    ['↓', 'ArrowDown', 'after-up', axisCheck('y', 1)],
    ['←', 'ArrowLeft', 'root', axisCheck('x', -1)],
    ['→', 'ArrowRight', 'root', axisCheck('x', 1)]
  ].map(([shortcut, key, from, check]) => matrix(shortcut, '單選', `選取視覺${shortcut}方向最近節點`, async h => {
    let source = from
    if (from === 'after-up') {
      await h.select('b')
      await h.press('ArrowUp')
      source = (await h.selected())[0]
    }
    await h.select(source)
    const before = await h.node(source).boundingBox()
    await h.press(key)
    const selected = (await h.selected())[0]
    const after = selected ? await h.node(selected).boundingBox() : null
    return h.expect(selected && selected !== source && check(before, after), `選取 ${source}→${selected}`)
  }, { electron: true })),
  ...[
    ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['←', 'ArrowLeft'], ['→', 'ArrowRight']
  ].map(([shortcut, key]) => matrix(shortcut, '未選取', '選取根節點', async h => {
    await h.press('Escape')
    await h.press(key)
    return h.expect((await h.selected())[0] === 'root', `選取=${await h.selected()}`)
  })),
  matrix('方向鍵', '編輯中', '只移動文字游標，不改節點選取', async h => {
    await h.edit('a')
    await h.press('ArrowLeft')
    return h.expect(await h.isEditing('a') && (await h.selected())[0] === 'a', `editing=${await h.isEditing('a')}；選取=${await h.selected()}`)
  }),
  matrix('方向鍵', '面板焦點', '保留面板控制原生行為，不移動節點選取', async h => {
    await h.select('a')
    await h.focusPanel()
    await h.press('ArrowDown')
    return h.expect((await h.selected())[0] === 'a', `選取=${await h.selected()}`)
  }),
  matrix('F2', '單選', '明確不進入文字編輯', async h => {
    await h.select('a')
    await h.press('F2')
    return h.expect(!await h.isEditing('a'), `editing=${await h.isEditing('a')}`)
  }),

  matrix('文字工具列：字型', '編輯中', '套用所選字型到選取文字', async h => {
    await h.edit('a')
    await h.page.locator('#text-font-family').selectOption({ label: '等寬字體' })
    await h.press('Enter')
    const node = findFixtureNode((await h.savedDoc()).root, 'a')
    return h.expect(node.style.fontFamily?.includes('Courier'), `fontFamily=${node.style.fontFamily}`)
  }),
  matrix('文字工具列：字級', '編輯中', '套用 24px 字級到選取文字', async h => {
    await h.edit('a')
    await h.page.locator('#text-font-size').selectOption('24')
    await h.press('Enter')
    const node = findFixtureNode((await h.savedDoc()).root, 'a')
    return h.expect(node.style.fontSize === 24, `fontSize=${node.style.fontSize}`)
  }),
  ...[
    ['B', '[data-text-command="bold"]', '<b'],
    ['I', '[data-text-command="italic"]', '<i'],
    ['U', '[data-text-command="underline"]', '<u'],
    ['S', '[data-text-command="strikeThrough"]', '<strike']
  ].map(([label, selector, marker]) => matrix(`文字工具列：${label}`, '編輯中', `對局部文字套用 ${label} 格式`, async h => {
    await h.edit('a')
    await h.page.locator(selector).click()
    await h.press('Enter')
    const richText = findFixtureNode((await h.savedDoc()).root, 'a').richText || ''
    return h.expect(richText.toLowerCase().includes(marker), `richText=${richText}`)
  })),
  matrix('文字工具列：文字色', '編輯中／真實 pointer', '原生 color input 點擊後仍對原 Range 套用文字色', async h => {
    await h.edit('a')
    await h.nativeColor('#text-color', '#ff0000')
    await h.press('Enter')
    const richText = findFixtureNode((await h.savedDoc()).root, 'a').richText || ''
    return h.expect(/color:\s*(rgb\(255,\s*0,\s*0\)|#ff0000)/iu.test(richText), `richText=${richText}`)
  }, { electron: true }),
  matrix('文字工具列：反白色', '編輯中／真實 pointer', '原生 color input 點擊後仍對原 Range 套用反白色', async h => {
    await h.edit('a')
    await h.nativeColor('#text-highlight', '#00ff00')
    await h.press('Enter')
    const richText = findFixtureNode((await h.savedDoc()).root, 'a').richText || ''
    return h.expect(/(background-color|background):\s*(rgb\(0,\s*255,\s*0\)|#00ff00)/iu.test(richText), `richText=${richText}`)
  }, { electron: true }),
  ...[
    ['靠左', 'left'], ['置中', 'center'], ['靠右', 'right']
  ].map(([label, value]) => matrix(`文字工具列：${label}`, '編輯中', `節點文字對齊設為 ${value}`, async h => {
    await h.edit('a')
    await h.page.locator(`[data-text-align="${value}"]`).click()
    await h.press('Enter')
    const actual = await h.node('a').locator('.mind-node__text').evaluate(element => getComputedStyle(element).textAlign)
    return h.expect(actual === value, `computed text-align=${actual}`)
  })),
  matrix('文字工具列：行距', '編輯中', '節點行距設為 1.75', async h => {
    await h.edit('a')
    await h.page.locator('#text-line-height').selectOption('1.75')
    await h.press('Enter')
    const node = findFixtureNode((await h.savedDoc()).root, 'a')
    return h.expect(Number(node.style.lineHeight) === 1.75, `lineHeight=${node.style.lineHeight}`)
  }),
  matrix('文字工具列：格式刷', '編輯中', '啟動一次性格式刷', async h => {
    await h.edit('a')
    await h.page.locator('#text-format-painter').click()
    const armed = await h.page.locator('#canvas').evaluate(element => element.classList.contains('is-format-painting'))
    return h.expect(armed, `format painter armed=${armed}`)
  }),
  matrix('樣式面板：填色', '單選／真實 pointer', '原生 color input 點擊後提交節點填色', async h => {
    await h.select('a')
    await h.press('Alt+y')
    await h.page.locator('[data-picker="fill"] .color-trigger').click()
    await h.nativeColor('.color-popover:not([hidden]) input[type="color"]', '#123456')
    const node = findFixtureNode((await h.savedDoc()).root, 'a')
    return h.expect(node.style.fill?.toLowerCase() === '#123456', `fill=${node.style.fill}`)
  }, { electron: true })
]

const IME_CANONICAL_CASES = Object.freeze({
  undo: ['Ctrl+Z', '單選'],
  redo: ['Ctrl+Y', '單選'],
  copy: ['Ctrl+C / Ctrl+V', '單選'],
  cut: ['Ctrl+X / Ctrl+V', '單選'],
  paste: ['Ctrl+C / Ctrl+V', '單選'],
  selectAll: ['Ctrl+A', '畫布'],
  save: ['Ctrl+S', '編輯後'],
  copyStyle: ['Ctrl+Alt+C / Ctrl+Alt+V', '單選'],
  pasteStyle: ['Ctrl+Alt+C / Ctrl+Alt+V', '單選'],
  duplicate: ['Ctrl+D', '單選'],
  openThemePanel: ['Ctrl+P', '單選'],
  openStylePanel: ['Alt+Y', '單選'],
  formatPainter: ['Ctrl+G', '單選'],
  ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`priority${index + 1}`, [`Ctrl+${index + 1}`, '單選']])),
  insertLink: ['Ctrl+Alt+K', '單選'],
  insertNote: ['Ctrl+Alt+M', '單選'],
  insertSummary: ['Ctrl+Alt+T', '多選'],
  insertImage: ['Alt+P', '單選'],
  openIcons: ['Alt+I', '單選'],
  insertComment: ['Ctrl+Alt+R', '單選'],
  zoomReset: ['Ctrl+0', '畫布'],
  tidyLayout: ['Ctrl+Shift+L', '畫布'],
  toggleOutline: ['Ctrl+O', '畫布'],
  fit: ['Ctrl+Alt+F', '畫布'],
  centerRoot: ['Ctrl+Shift+R', '畫布'],
  findReplace: ['Ctrl+F', '畫布'],
  history: ['Shift+Alt+H', '畫布'],
  floatingNode: ['Shift+Alt+F', '畫布']
})

const ALPHANUMERIC_BINDINGS = ACTION_BINDINGS.filter(binding => /^[a-z0-9]$/iu.test(binding.key))
const IME_MATRIX_CASES = ALPHANUMERIC_BINDINGS.flatMap(binding => {
  const locator = IME_CANONICAL_CASES[binding.action]
  if (!locator) throw new Error(`IME 模式掃描缺少 ${binding.action} canonical case`)
  const baseline = MATRIX_CASES.find(testCase => testCase.shortcut === locator[0] && testCase.state === locator[1])
  if (!baseline) throw new Error(`IME 模式掃描找不到 ${binding.action} canonical case：${locator.join(' / ')}`)
  return imeCodesForBinding(binding).map(code => matrix(
    `${baseline.shortcut} [${code}]`,
    `IME 模式／${baseline.state}`,
    baseline.expected,
    baseline.run,
    {
      electron: baseline.electron,
      targetedSynthetic: true,
      imeBinding: binding,
      imeCode: code
    }
  ))
})

IME_MATRIX_CASES.push(matrix(
  '直接輸入 [KeyM]',
  'IME 模式／單選',
  '選取後文字元素已預備輸入（焦點就緒、原文全選），compositionstart 升格為編輯',
  async h => {
    await h.select('a')
    await h.page.waitForTimeout(50)
    // 預備：文字元素可輸入且擁有焦點，原文全選（輸入法從第一鍵就能組字並取代原文）
    const armed = await h.page.evaluate(() => {
      const text = document.querySelector('#nodes-layer [data-node-id="a"] .mind-node__text')
      const selection = window.getSelection()
      return {
        editable: text?.isContentEditable === true,
        focused: document.activeElement === text,
        isEditingClass: text?.closest('.mind-node')?.classList.contains('is-editing') === true,
        selectedAll: selection?.toString() === text?.innerText
      }
    })
    await h.dispatchImeKey({ code: 'KeyM' })
    // 真實輸入法會接著送 compositionstart；合成一個以驗證升格路徑
    await h.page.evaluate(() => {
      const text = document.querySelector('#nodes-layer [data-node-id="a"] .mind-node__text')
      text.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    })
    const text = await h.node('a').locator('.mind-node__text').innerText()
    return h.expect(armed.editable && armed.focused && !armed.isEditingClass && armed.selectedAll && await h.isEditing('a') && text !== '',
      `armed=${JSON.stringify(armed)}；editing=${await h.isEditing('a')}；文字=${JSON.stringify(text)}`)
  },
  { targetedSynthetic: true }
))

// 系統全域熱鍵（RegisterHotKey）指紋：修飾鍵 keydown 到達、字母鍵 keydown 被 OS 吞掉、只剩 keyup。
// 用 Playwright 真實 keyboard down/up 序列重現（trusted 事件），驗證孤兒 keyup 救援對每條 Ctrl／Alt 和弦生效。
const ORPHAN_MATRIX_CASES = ALPHANUMERIC_BINDINGS
  .filter(binding => (binding.ctrl || binding.alt) && binding.action !== 'paste')
  .map(binding => {
    const locator = IME_CANONICAL_CASES[binding.action]
    const baseline = MATRIX_CASES.find(testCase => testCase.shortcut === locator[0] && testCase.state === locator[1])
    if (!baseline) throw new Error(`孤兒 keyup 掃描找不到 ${binding.action} canonical case：${locator.join(' / ')}`)
    return matrix(
      `${baseline.shortcut} [keydown 被吞]`,
      `全域熱鍵吞 keydown／${baseline.state}`,
      baseline.expected,
      baseline.run,
      { electron: baseline.electron, orphanKeyup: true, orphanBinding: binding }
    )
  })

// 注意：以下兩案是 WebContents 層的輸入注入，不會真的觸發 OS 的 Alt+Tab／Win+D 與焦點切換；
// 只驗證 resolver 對「帶 Alt 的 Tab keyup」「帶 Win 鍵的字母 keyup」的排除規則。
ORPHAN_MATRIX_CASES.push(matrix(
  'Alt 按住時的孤兒 Tab keyup（注入）',
  '全域熱鍵吞 keydown／單選',
  'Tab 孤兒 keyup 不得插入子節點',
  async h => {
    await h.select('a')
    const before = await h.countNodes()
    await h.page.keyboard.down('Alt')
    await h.page.keyboard.up('Tab')
    await h.page.keyboard.up('Alt')
    // 修飾鍵先放開、Tab 才放開的順序：孤兒 Tab keyup 無修飾鍵，同樣不得插入
    await h.page.keyboard.up('Tab')
    return h.expect(await h.countNodes() === before, `節點 ${before}→${await h.countNodes()}`)
  },
  { electron: true, orphanKeyup: true }
), matrix(
  'Win 鍵按住時的孤兒 D keyup（注入）',
  '全域熱鍵吞 keydown／單選',
  'Win 鍵組合的 keyup 不得觸發 Ctrl+D 複製節點',
  async h => {
    await h.select('a')
    const before = await h.countNodes()
    await h.page.keyboard.down('Meta')
    await h.page.keyboard.up('d')
    await h.page.keyboard.up('Meta')
    return h.expect(await h.countNodes() === before, `節點 ${before}→${await h.countNodes()}`)
  },
  { electron: true, orphanKeyup: true }
))

const ALL_MATRIX_CASES = [...MATRIX_CASES, ...IME_MATRIX_CASES, ...ORPHAN_MATRIX_CASES]

await main()

async function main() {
  const playwright = await loadPlaywright()
  const server = await ensureServer()
  const allResults = []

  try {
    if (PROJECT_ARG === 'all' || PROJECT_ARG === 'chromium') {
      const browser = await playwright.chromium.launch({
        headless: HEADLESS,
        executablePath: findSystemChromium()
      })
      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
        const page = await context.newPage()
        allResults.push(...await runCases({
          project: 'Chromium',
          page,
          baseURL: server.baseURL,
          cases: filterCases(ALL_MATRIX_CASES),
          connectCDP: async () => context.newCDPSession(page)
        }))
      } finally {
        await browser.close()
      }
    }

    if (PROJECT_ARG === 'all' || PROJECT_ARG === 'electron') {
      const electron = await launchElectron(playwright)
      try {
        const context = electron.browser.contexts()[0]
        const page = electron.page
        allResults.push(...await runCases({
          project: 'Electron',
          page,
          baseURL: 'mindflow://app',
          cases: filterCases(ALL_MATRIX_CASES.filter(testCase => testCase.electron)),
          connectCDP: async () => context.newCDPSession(page)
        }))
      } finally {
        await electron.close()
      }
    }
  } finally {
    await server.close()
  }

  writeReport(allResults)
  const failed = allResults.filter(result => !result.pass)
  const imeResults = allResults.filter(result => result.targetedSynthetic)
  console.log(`快捷鍵矩陣：${allResults.length - failed.length}/${allResults.length} PASS`)
  console.log(`IME 模式掃描（targeted synthetic）：${imeResults.filter(result => result.pass).length}/${imeResults.length} PASS`)
  console.log(`報告：${REPORT_PATH}`)
  for (const result of failed) {
    console.error(`FAIL [${result.project}] ${result.shortcut} / ${result.state}: ${result.actual}`)
  }
  if (failed.length > 0) process.exitCode = 1
}

function filterCases(cases) {
  if (!FILTER_ARG) return cases
  const pattern = new RegExp(FILTER_ARG, 'iu')
  return cases.filter(testCase => pattern.test(`${testCase.shortcut} ${testCase.state}`))
}

async function runCases({ project, page, baseURL, cases, connectCDP }) {
  const results = []
  const runtimeErrors = []
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
  })
  // 長工作階段（單一瀏覽器跑完 200+ 案）末段的 UI 等待，5 秒過緊會產生假紅燈；
  // 單獨重跑同案 3/3 皆通過。放寬到 8 秒仍足以抓出真正卡住的互動。
  page.setDefaultTimeout(8000)
  page.setDefaultNavigationTimeout(10000)

  const h = createHarness({ page, baseURL, connectCDP })
  for (const testCase of cases) {
    runtimeErrors.length = 0
    let actual = ''
    let pass = false
    try {
      h.setSyntheticImeTarget(null)
      h.setOrphanKeyup(null)
      await h.reset()
      h.setSyntheticImeTarget(testCase.imeBinding ? { binding: testCase.imeBinding, code: testCase.imeCode } : null)
      h.setOrphanKeyup(testCase.orphanBinding)
      actual = await testCase.run(h)
      if (runtimeErrors.length > 0) throw new MatrixFailure(runtimeErrors.join('；'))
      pass = true
    } catch (error) {
      actual = error instanceof MatrixFailure ? error.actual : `${error.name || 'Error'}: ${error.message || error}`
    } finally {
      h.setSyntheticImeTarget(null)
      h.setOrphanKeyup(null)
    }
    results.push({
      project,
      shortcut: testCase.shortcut,
      state: testCase.state,
      expected: testCase.expected,
      actual: String(actual || (pass ? '行為符合預期' : '未取得結果')),
      pass,
      targetedSynthetic: testCase.targetedSynthetic,
      orphanKeyup: testCase.orphanKeyup
    })
    console.log(`${pass ? 'PASS' : 'FAIL'} [${project}] ${testCase.shortcut} / ${testCase.state}`)
    if (!pass) console.log(`  ${actual}`)
  }
  return results
}

function createHarness({ page, baseURL, connectCDP }) {
  const editorURL = `${baseURL}/editor.html?id=${FIXTURE_ID}`
  let syntheticImeTarget = null
  let orphanBinding = null
  return {
    page,
    setSyntheticImeTarget(target) {
      syntheticImeTarget = target
    },
    setOrphanKeyup(binding) {
      orphanBinding = binding || null
    },
    async reset() {
      await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(({ fixture, id }) => {
        localStorage.clear()
        localStorage.setItem('mindflow.docs.index', JSON.stringify({
          version: 2,
          docs: [{ id, title: fixture.title, createdAt: fixture.createdAt, updatedAt: fixture.updatedAt, thumbnail: '' }],
          trash: [],
          favorites: []
        }))
        localStorage.setItem(`mindflow.doc.${id}`, JSON.stringify(fixture))
      }, { fixture: FIXTURE, id: FIXTURE_ID })
      await page.goto(editorURL, { waitUntil: 'domcontentloaded' })
      await page.locator('#nodes-layer .mind-node').first().waitFor({ state: 'visible' })
      try {
        // fixture 準備是前置條件不是斷言：逾時放寬到 15 秒，避免機器忙碌時
        // 產生「節點數=6（預期 6）」這種數值正確卻失敗的假紅燈，掩蓋真正的問題。
        await page.waitForFunction(expected => document.querySelectorAll('#nodes-layer .mind-node').length === expected, FIXTURE_NODE_COUNT, { timeout: 15000 })
      } catch {
        throw new MatrixFailure(`reset 節點數=${await page.locator('#nodes-layer .mind-node').count()}（預期 ${FIXTURE_NODE_COUNT}）`)
      }
      // 每格案例的 fixture 前置條件，不把「收合面板」本身混入快捷鍵行為。
      await page.locator('#sidepanel').evaluate(element => element.classList.add('is-collapsed'))
      await page.locator('#canvas').focus()
    },
    press(shortcut) {
      if (syntheticImeTarget && shortcutMatchesBinding(shortcut, syntheticImeTarget.binding)) {
        return dispatchSyntheticImeKey(page, {
          code: syntheticImeTarget.code,
          binding: syntheticImeTarget.binding
        })
      }
      if (orphanBinding && shortcutMatchesBinding(shortcut, orphanBinding)) return pressWithSwallowedKeydown(page, shortcut)
      return page.keyboard.press(shortcut)
    },
    dispatchImeKey: ({ code, binding = null }) => dispatchSyntheticImeKey(page, { code, binding }),
    // 以指定佈局重置 fixture（同 reset，但 doc.layout 改為 layout）
    async resetWithLayout(layout) {
      await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(({ fixture, id, layoutName }) => {
        localStorage.clear()
        const doc = { ...fixture, layout: layoutName }
        localStorage.setItem('mindflow.docs.index', JSON.stringify({
          version: 2,
          docs: [{ id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, thumbnail: '' }],
          trash: [],
          favorites: []
        }))
        localStorage.setItem(`mindflow.doc.${id}`, JSON.stringify(doc))
      }, { fixture: FIXTURE, id: FIXTURE_ID, layoutName: layout })
      await page.goto(editorURL, { waitUntil: 'domcontentloaded' })
      await page.locator('#nodes-layer .mind-node').first().waitFor({ state: 'visible' })
      await page.waitForFunction(expected => document.querySelectorAll('#nodes-layer .mind-node').length === expected, FIXTURE_NODE_COUNT, { timeout: 15000 })
      await page.locator('#sidepanel').evaluate(element => element.classList.add('is-collapsed'))
      await page.locator('#canvas').focus()
    },
    // 概要括號的螢幕 bbox（SVG path）與其覆蓋節點的 bbox 聯集
    async summaryBracketBox() {
      return page.locator('#connections-layer .summary-bracket').first().evaluate(path => {
        const r = path.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
      })
    },
    async unionBox(ids) {
      const boxes = []
      for (const id of ids) boxes.push(await page.locator(`#nodes-layer [data-node-id="${id}"]`).boundingBox())
      return {
        x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
        right: Math.max(...boxes.map(b => b.x + b.width)), bottom: Math.max(...boxes.map(b => b.y + b.height))
      }
    },
    async isBlankPoint(x, y) {
      return page.evaluate(p => {
        const el = document.elementFromPoint(p.x, p.y)
        return ['SECTION#canvas', 'DIV#world', 'DIV#nodes-layer', 'svg#connections-layer'].includes(el ? `${el.tagName}#${el.id}` : '')
      }, { x, y })
    },
    contextMenuOpen: () => page.locator('.context-menu').evaluate(menu => !menu.hidden && getComputedStyle(menu).display !== 'none').catch(() => false),
    // 在畫布左上角一塊確定空白的位置雙擊：先斷言該點的 elementFromPoint 真的是基礎層，
    // 免得版面改動後測試在節點上雙擊卻仍然「通過」。
    async dblclickBlankCanvas() {
      const box = await page.locator('#canvas').boundingBox()
      const point = { x: box.x + 160, y: box.y + 120 }
      const target = await page.evaluate(p => {
        const el = document.elementFromPoint(p.x, p.y)
        return el ? `${el.tagName}#${el.id}` : 'null'
      }, point)
      if (!['SECTION#canvas', 'DIV#world', 'DIV#nodes-layer', 'svg#connections-layer'].includes(target)) {
        throw new MatrixFailure(`雙擊點不是空白基礎層：${target}`)
      }
      await page.mouse.dblclick(point.x, point.y)
    },
    node: id => page.locator(`#nodes-layer [data-node-id="${id}"]`),
    hasNode: id => page.locator(`#nodes-layer [data-node-id="${id}"]`).count().then(count => count > 0),
    countNodes: () => page.locator('#nodes-layer .mind-node').count(),
    selected: () => page.locator('#nodes-layer .mind-node.is-selected').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId)),
    async select(id) {
      await page.locator(`#nodes-layer [data-node-id="${id}"]`).click()
    },
    async multiSelect(first, second) {
      await page.locator(`#nodes-layer [data-node-id="${first}"]`).click()
      await page.locator(`#nodes-layer [data-node-id="${second}"]`).click({ modifiers: ['Control'] })
    },
    async edit(id) {
      await page.locator(`#nodes-layer [data-node-id="${id}"]`).dblclick()
      await page.locator(`#nodes-layer [data-node-id="${id}"] .mind-node__text[contenteditable="true"]`).waitFor()
    },
    // 「編輯中」以 is-editing class 為準：選取節點會先進入「預備輸入」（contenteditable=true 但非編輯，
    // 讓輸入法從第一鍵就能組字），只看 contenteditable 會把預備狀態誤判成編輯。
    isEditing: id => page.locator(`#nodes-layer [data-node-id="${id}"]`).evaluate(node => node.classList.contains('is-editing')),
    isArmed: id => page.locator(`#nodes-layer [data-node-id="${id}"]`).evaluate(node => node.classList.contains('is-armed')),
    nodeText: id => page.locator(`#nodes-layer [data-node-id="${id}"] .mind-node__text`).evaluate(text => text.innerText.replace(/​/gu, '')),
    async focusPanel() {
      await page.locator('[data-style-input="borderStyle"]').focus()
    },
    async storedDoc() {
      return page.evaluate(id => JSON.parse(localStorage.getItem(`mindflow.doc.${id}`)), FIXTURE_ID)
    },
    async savedDoc() {
      await page.keyboard.press('Control+s')
      return this.storedDoc()
    },
    expect(condition, actual) {
      if (!condition) throw new MatrixFailure(actual)
      return actual
    },
    async isPanelTab(name) {
      return page.evaluate(tab => {
        const panel = document.querySelector('#sidepanel')
        return !panel.classList.contains('is-collapsed')
          && document.querySelector(`[data-panel-tab="${tab}"]`)?.classList.contains('is-active')
          && !document.querySelector(`[data-panel-view="${tab}"]`)?.hidden
      }, name)
    },
    async panelState() {
      return page.evaluate(() => ({
        collapsed: document.querySelector('#sidepanel')?.classList.contains('is-collapsed'),
        tab: document.querySelector('[data-panel-tab].is-active')?.dataset.panelTab
      })).then(JSON.stringify)
    },
    async setNodeShape(id, shape) {
      await this.select(id)
      await page.keyboard.press('Alt+y')
      await page.locator(`[data-shape="${shape}"]`).click()
    },
    async computedFontSize(id) {
      return page.locator(`#nodes-layer [data-node-id="${id}"] .mind-node__text`).evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))
    },
    async zoom() {
      return page.locator('#zoom-display').textContent().then(text => Number.parseInt(text, 10))
    },
    async ctrlWheel(deltaY) {
      const canvas = await page.locator('#canvas').boundingBox()
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, deltaY)
      await page.keyboard.up('Control')
    },
    async nodesWithinCanvas() {
      return page.evaluate(() => {
        const canvas = document.querySelector('#canvas').getBoundingClientRect()
        const nodes = Array.from(document.querySelectorAll('#nodes-layer .mind-node'), element => element.getBoundingClientRect())
        return nodes.every(rect => (
          rect.left >= canvas.left + 8
          && rect.top >= canvas.top + 8
          && rect.right <= canvas.right - 8
          && rect.bottom <= canvas.bottom - 8
        ))
      })
    },
    async extremeNode(axis, mode) {
      return page.locator('#nodes-layer .mind-node').evaluateAll((nodes, options) => {
        const coordinate = element => {
          const rect = element.getBoundingClientRect()
          return options.axis === 'x' ? rect.x + rect.width / 2 : rect.y + rect.height / 2
        }
        return nodes
          .slice()
          .sort((left, right) => (options.mode === 'min' ? 1 : -1) * (coordinate(left) - coordinate(right)))[0]
          ?.dataset.nodeId
      }, { axis, mode })
    },
    async nativeColor(selector, value) {
      const input = page.locator(selector)
      await input.waitFor({ state: 'attached' })
      const box = await input.boundingBox()
      if (!box) throw new MatrixFailure(`color input ${selector} 沒有可點擊座標`)
      const cdp = await connectCDP()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      // OS color picker 不在 renderer DOM；回填值只模擬 picker 的輸出，pointer 路徑仍是真實 CDP 事件。
      await input.evaluate((element, next) => {
        element.value = next
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }, value)
    },
    async withFileChooserIntercept(trigger) {
      const cdp = await connectCDP()
      await cdp.send('Page.enable')
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true })
      const opened = new Promise(resolveOpened => {
        cdp.once('Page.fileChooserOpened', () => resolveOpened(true))
      })
      try {
        await trigger()
        return await Promise.race([opened, delay(5000).then(() => false)])
      } finally {
        await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {})
        await cdp.detach?.().catch(() => {})
      }
    }
  }
}

// 重現全域熱鍵指紋：修飾鍵正常 down，字母鍵只送 keyup（keydown 被 OS 攔走），再放開修飾鍵。
async function pressWithSwallowedKeydown(page, shortcut) {
  const tokens = shortcut.split('+')
  const key = tokens.at(-1)
  const modifiers = tokens.slice(0, -1)
  for (const modifier of modifiers) await page.keyboard.down(modifier)
  await page.keyboard.up(key)
  for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier)
}

function imeCodesForBinding(binding) {
  if (/^[a-z]$/iu.test(binding.key)) return [`Key${binding.key.toUpperCase()}`]
  if (/^\d$/u.test(binding.key)) return [`Digit${binding.key}`, `Numpad${binding.key}`]
  throw new Error(`IME 模式掃描只接受英數 binding：${binding.action} / ${binding.key}`)
}

function shortcutMatchesBinding(shortcut, binding) {
  const tokens = shortcut.split('+')
  const keyToken = tokens.at(-1)
  const code = /^[a-z]$/iu.test(keyToken)
    ? `Key${keyToken.toUpperCase()}`
    : /^\d$/u.test(keyToken)
      ? `Digit${keyToken}`
      : keyToken
  return imeCodesForBinding(binding).includes(code)
    && (tokens.includes('Control') || tokens.includes('Meta')) === Boolean(binding.ctrl)
    && tokens.includes('Shift') === Boolean(binding.shift)
    && tokens.includes('Alt') === Boolean(binding.alt)
}

async function dispatchSyntheticImeKey(page, { code, binding }) {
  const modifiers = {
    ctrlKey: Boolean(binding?.ctrl),
    metaKey: false,
    shiftKey: Boolean(binding?.shift),
    altKey: Boolean(binding?.alt)
  }
  const observed = await page.evaluate(({ eventCode, eventModifiers }) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Process',
      code: eventCode,
      keyCode: 229,
      which: 229,
      bubbles: true,
      cancelable: true,
      ...eventModifiers
    })
    // Chromium 的 constructor 可能忽略 deprecated keyCode/which；測試事件仍需精確重現 Windows IME 229。
    if (event.keyCode !== 229) Object.defineProperty(event, 'keyCode', { configurable: true, value: 229 })
    if (event.which !== 229) Object.defineProperty(event, 'which', { configurable: true, value: 229 })
    const target = document.activeElement || window
    target.dispatchEvent(event)
    return {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey
    }
  }, { eventCode: code, eventModifiers: modifiers })

  const exact = observed.key === 'Process'
    && observed.code === code
    && observed.keyCode === 229
    && observed.which === 229
    && observed.ctrlKey === modifiers.ctrlKey
    && observed.metaKey === modifiers.metaKey
    && observed.shiftKey === modifiers.shiftKey
    && observed.altKey === modifiers.altKey
  if (!exact) throw new MatrixFailure(`synthetic IME event 欄位錯誤：${JSON.stringify(observed)}`)

  // untrusted keydown 不會觸發瀏覽器 default paste；補送 paste event，保留 production 的原生 paste 資料流。
  if (binding?.action === 'paste') {
    await page.evaluate(() => {
      const target = document.activeElement || window
      target.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      }))
    })
  }
}

function axisCheck(axis, direction) {
  return (before, after) => {
    if (!before || !after) return false
    const start = before[axis] + before[axis === 'x' ? 'width' : 'height'] / 2
    const end = after[axis] + after[axis === 'x' ? 'width' : 'height'] / 2
    return direction < 0 ? end < start : end > start
  }
}

function createFixture() {
  const now = '2026-07-26T00:00:00.000Z'
  const node = (id, text, overrides = {}) => ({
    id,
    text,
    children: [],
    collapsed: false,
    side: null,
    style: {},
    richText: null,
    notes: null,
    link: null,
    icons: [],
    image: null,
    ...overrides
  })
  return {
    id: FIXTURE_ID,
    title: 'Shortcut Matrix',
    createdAt: now,
    updatedAt: now,
    root: node('root', 'ROOT', {
      children: [
        node('a', 'Alpha', { side: 'right', children: [node('a1', 'Alpha child')] }),
        node('b', 'Beta', { side: 'right' }),
        node('c', 'Charlie', { side: 'left' }),
        node('d', 'Delta', { side: 'left' })
      ]
    }),
    layout: 'mindmap-both',
    themeId: 'classic-blue',
    relations: [],
    summaries: [],
    canvas: {
      background: '#f5f5f5',
      watermark: { enabled: false, text: 'MindFlow', color: '#64748b', rotation: 'left', opacity: 12, size: 18 },
      spacingH: 30,
      spacingV: 30
    }
  }
}

function findFixtureNode(root, id) {
  if (!root) return null
  if (root.id === id) return root
  for (const child of root.children || []) {
    const found = findFixtureNode(child, id)
    if (found) return found
  }
  return null
}

function countFixtureNodes(doc) {
  let count = 0
  const visit = node => {
    count += 1
    for (const child of node.children || []) visit(child)
  }
  visit(doc.root)
  return count
}

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    // CI / clone 不強迫修改 package.json；先使用 Playwright CLI 的 npx cache。
  }
  const cacheRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  let candidates = findCachedPlaywright(cacheRoot)
  if (candidates.length === 0) {
    const result = runNpx(['-y', 'playwright', '--version'], { cwd: ROOT })
    if (result.status !== 0) throw new Error(`無法透過 Playwright CLI 安裝 runtime：${result.stderr || result.stdout}`)
    candidates = findCachedPlaywright(cacheRoot)
  }
  if (candidates.length === 0) throw new Error('找不到 Playwright runtime')
  return import(pathToFileURL(candidates[0]).href)
}

function findCachedPlaywright(cacheRoot) {
  if (!cacheRoot || !existsSync(cacheRoot)) return []
  return readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(cacheRoot, entry.name, 'node_modules', 'playwright', 'index.mjs'))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
}

function findSystemChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean)
  const executable = candidates.find(existsSync)
  if (!executable) throw new Error('找不到 Chrome / Edge executable')
  return executable
}

async function ensureServer() {
  const port = 4187
  const baseURL = `http://127.0.0.1:${port}`
  if (await responds(`${baseURL}/editor.html`)) return { baseURL, close: async () => {} }

  mkdirSync(LOG_DIR, { recursive: true })
  const stdout = openSync(join(LOG_DIR, '.matrix-server.stdout.log'), 'a')
  const stderr = openSync(join(LOG_DIR, '.matrix-server.stderr.log'), 'a')
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(port)], {
    cwd: ROOT,
    detached: false,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr]
  })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await responds(`${baseURL}/editor.html`)) {
      return {
        baseURL,
        async close() {
          child.kill()
          closeSync(stdout)
          closeSync(stderr)
        }
      }
    }
    await delay(100)
  }
  child.kill()
  closeSync(stdout)
  closeSync(stderr)
  throw new Error('MindFlow E2E server 啟動逾時')
}

async function launchElectron({ chromium }) {
  const executable = ensureElectronExecutable()
  const port = 9337
  const userDataDir = join(tmpdir(), `mindflow-matrix-electron-${process.pid}`)
  mkdirSync(userDataDir, { recursive: true })
  const stdout = openSync(join(LOG_DIR, '.matrix-electron.stdout.log'), 'a')
  const stderr = openSync(join(LOG_DIR, '.matrix-electron.stderr.log'), 'a')
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '.'
  ], {
    cwd: join(ROOT, 'desktop'),
    windowsHide: true,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    stdio: ['ignore', stdout, stderr]
  })
  const endpoint = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await responds(`${endpoint}/json/version`)) {
      const browser = await chromium.connectOverCDP(endpoint)
      const context = browser.contexts()[0]
      const page = await waitForElectronMainPage(context)
      return {
        browser,
        page,
        async close() {
          await browser.close().catch(() => {})
          if (!child.killed) child.kill()
          closeSync(stdout)
          closeSync(stderr)
        }
      }
    }
    if (child.exitCode !== null) break
    await delay(100)
  }
  if (!child.killed) child.kill()
  closeSync(stdout)
  closeSync(stderr)
  throw new Error(`Electron remote debugging port ${port} 啟動失敗`)
}

async function waitForElectronMainPage(context) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const page = context.pages().find(candidate => candidate.url().startsWith('mindflow://app/'))
    if (page && !page.isClosed()) {
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      // main.mjs 在首次 load 後仍可能執行 storage recovery / reload；留一個穩定窗，
      // 避免 E2E goto 中止主程序正在 await 的啟動導覽。
      await delay(1000)
      if (!page.isClosed() && page.url().startsWith('mindflow://app/')) return page
    }
    await delay(100)
  }
  throw new Error('Electron CDP 已連線，但找不到穩定的 mindflow://app 主頁')
}

function ensureElectronExecutable() {
  const direct = join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  if (existsSync(direct)) return direct

  const cacheRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  let cached = findCachedElectron(cacheRoot)
  if (cached) return cached

  const result = runNpx(['-y', 'electron@43.2.0', '--version'], {
    cwd: tmpdir(),
    timeout: 180_000
  })
  if (result.status !== 0) {
    throw new Error(`無法下載 Electron 43.2.0 runtime：${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`)
  }
  cached = findCachedElectron(cacheRoot)
  if (!cached) throw new Error('Electron CLI 已執行，但 npm cache 內仍找不到 electron.exe')
  return cached
}

function runNpx(args, options = {}) {
  const common = { encoding: 'utf8', ...options }
  if (process.platform !== 'win32') return spawnSync('npx', args, common)
  const npxCLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  return spawnSync(process.execPath, [npxCLI, ...args], common)
}

function findCachedElectron(cacheRoot) {
  if (!cacheRoot || !existsSync(cacheRoot)) return ''
  const candidates = readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(cacheRoot, entry.name, 'node_modules', 'electron', 'dist', 'electron.exe'))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  return candidates[0] || ''
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) })
    return response.ok
  } catch {
    return false
  }
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

function writeReport(results) {
  const generatedAt = new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Taipei'
  }).format(new Date())
  const passed = results.filter(result => result.pass).length
  const regularResults = results.filter(result => !result.targetedSynthetic && !result.orphanKeyup)
  const imeResults = results.filter(result => result.targetedSynthetic)
  const orphanResults = results.filter(result => result.orphanKeyup)
  const renderRows = sectionResults => sectionResults.map(result => [
    result.project,
    result.shortcut,
    result.state,
    result.expected,
    result.actual,
    result.pass ? 'PASS' : 'FAIL'
  ].map(escapeCell).join(' | '))
  const renderSection = sectionResults => {
    if (sectionResults.length === 0) return '_本次 filter 未執行此節案例。_'
    const rows = renderRows(sectionResults)
    return `> 結果：**${sectionResults.filter(result => result.pass).length}/${sectionResults.length} PASS**

| 執行環境 | 快捷鍵／控制 | 狀態 | 預期 | 實測 | PASS/FAIL |
|---|---|---|---|---|---|
| ${rows.join('\n| ')} |`
  }
  const markdown = `# MindFlow 快捷鍵與文字工具列 E2E 矩陣

> 產生時間：${generatedAt}  
> 總結果：**${passed}/${results.length} PASS**

## 原有矩陣

> 驅動：Playwright 真實 keyboard/mouse；color input 使用 CDP \`Input.dispatchMouseEvent\` 真實 pointer 路徑。

${renderSection(regularResults)}

## IME 模式掃描（targeted synthetic）

> 自首：Playwright 無法真實切換 Windows 注音／微軟 IME。本節用 \`dispatchEvent(new KeyboardEvent(...))\` 合成 \`key='Process'\`、正確 \`code\`、\`keyCode/which=229\` 與修飾鍵；untrusted keydown 不會產生瀏覽器 default paste，因此 paste 案例另補 synthetic \`paste\` event。這批案例只驗證應用層事件路由，不冒充真實 OS IME E2E。

${renderSection(imeResults)}

## 全域熱鍵吞 keydown（孤兒 keyup 救援）

> 背景：Windows 常駐程式以 RegisterHotKey 搶註和弦（實測晨睿主力機 Ctrl+Alt+M 即被佔用）時，OS 只把 keyup 送到前景視窗。本節以 Playwright 真實 keyboard down/up 序列重現「修飾鍵 down → 字母鍵只有 up」，驗證應用層改由 keyup 派發。
> 自首：兩個「（注入）」負向案例只是 WebContents 層輸入注入，不會真的執行 OS 的 Alt+Tab／Win+D 與焦點切換；回焦未武裝、AltGr、code 不對稱、defaultPrevented 等負向情境由 \`tests/core.test.mjs\` 控制器層測試覆蓋。

${renderSection(orphanResults)}
`
  writeFileSync(REPORT_PATH, markdown, 'utf8')
}

function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\r?\n/gu, '<br>')
}
