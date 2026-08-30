# CODEX C2 交付筆記

完成日期：2026-08-30

## 實作範圍

- `js/editor/mobilechrome.js`
  - `<768px` 或主要輸入為 coarse pointer 時啟用 `is-mobile-chrome`。
  - 新增 6 鍵底部工具欄：節點、復原、重做、插入、佈局、主題；全部代理既有按鈕或 `sidepanel.showTab()`，沒有複製 command 邏輯。
  - 進入行動模式時把既有 sidepanel 收合，之後由佈局／主題按鈕開成滿版 drawer。
  - 以 `visualViewport` 更新 `--mobile-keyboard-inset`，供文字工具列貼齊軟鍵盤上緣。
  - 內含 dashboard hamburger／drawer mount；若 dashboard 載入本模組即可直接使用。
- `css/mobile.css`
  - 嚴守共用檔分區：C1 gesture block 在上半，C2 只維護 `C2 MOBILE CHROME LAYOUT BEGIN/END` 下半區塊。
  - 頂部三膠囊縮成單列文件列，主要編輯動作移至底部工具欄。
  - sidepanel 滿版 drawer、文字工具列鍵盤 inset、行動版 insert/more menu、快捷鍵與鍵盤診斷隱藏。
  - dashboard 卡片單欄與 hamburger drawer 樣式。
  - 修正既有 view-mode selector 與 zoom controls 在 375px 的碰撞。
- `js/editor/main.js`
  - 增加 C2 import 與一行 `initMobileChrome(featureContext)`；未改其他流初始化。

## TDD 與 Playwright 驗證

- C2 pure assertions：先因 `mobilechrome.js` 不存在得到 `ERR_MODULE_NOT_FOUND`（RED），完成後 6/6（GREEN）。涵蓋 767/768px 邊界、coarse pointer 與鍵盤 inset。
- 375×812 editor：
  - 初次驗證發現滿版 drawer 沿用桌面開啟狀態；assertion 先失敗，再以 mode transition 收合修正，GREEN。
  - 底部「節點」確實新增節點，既有 undo 狀態同步為 enabled。
  - 「佈局」打開 375×812 滿版 drawer，active tab 為 `layout`。
  - insert menu rect `8..367px`，document `scrollWidth === clientWidth === 375`。
  - more menu 可見按鈕最小高度 48px，快捷鍵入口不可見，整體無水平 overflow。
  - 文字工具列以 300px 模擬 keyboard inset 時，底邊位於鍵盤頂緣上方 8px。
  - 截圖檢查發現 view-mode／zoom 交疊面積 2444px²；先 RED，再調整堆疊後為 0px² GREEN。
- 375×812 dashboard：
  - 實際頁面現有 responsive CSS 已是單欄卡片（343px 寬）且無水平 overflow。
  - 手動 dynamic import C2 module 後，hamburger mount 成功，drawer 為 320×812 並可正常開啟。
- 1280×900 fresh desktop：
  - `bodyClass === "editor-page"`、行動工具列 `display:none`、中央膠囊 `display:flex`、sidepanel 326px、無水平 overflow。
  - desktop 與 mobile Playwright session：console 0 errors、0 warnings。
- Playwright 截圖：
  - `.playwright-cli/page-2026-08-30T03-10-40-206Z.png`（實際 dashboard 375×812）
  - `.playwright-cli/page-2026-08-30T03-12-21-395Z.png`（修正後 editor 375×812）
  - `.playwright-cli/page-2026-08-30T03-13-27-473Z.png`（fresh desktop 1280×900）

## 全套測試

- `node --test tests/*.test.mjs`：18/18 registered tests，0 fail；內含 C1 `touch.test.mjs` 5/5。
- `npm test --prefix desktop`：136/136，0 fail。
- `npm test --prefix mobile`：5/5，0 fail。
- `node --check js/editor/mobilechrome.js`、`node --check js/editor/main.js`：通過。

## 主動自首

1. **dashboard 正式掛載缺口尚未解決。** C2 所有權只有 `css/mobile.css`、`js/editor/mobilechrome.js` 與 editor `main.js` 一行；`index.html`、`js/dashboard.js`、`css/dashboard.css` 都不在所有權內。實際 dashboard 導航證據是 `mobileStylesLoaded:false`、`hasHamburger:false`，所以正常進入 dashboard 時目前只有既有單欄 responsive layout，沒有 C2 hamburger。C2 module 與 CSS 在手動 import 後已驗證可用，但要正式交付此項，必須由 dashboard 所有權流加掛 `initMobileChrome()`，或明確放寬 C2 可改 `js/dashboard.js`。我沒有偷改其他流檔案。
2. Headless Chromium 無法叫出 Android 真實軟鍵盤；本輪驗證的是純函數計算與瀏覽器內注入 300px inset 後的實際 computed rect，不等同真機 IME 測試。
3. 任務開始前沒有可用的 1280px pixel baseline，因此桌面驗證是 fresh screenshot + DOM/computed geometry 檢查，不是自動 pixel diff。
4. C2 沒有新增持久化 test file，因 brief 的 C2 所有權未包含 `tests/`；RED/GREEN 使用一次性 Node assertions 與 Playwright assertions。既有與並行流新增的全套 tests 都有執行。
5. Playwright 在既有 `.playwright-cli/` 產生 snapshot/screenshot artifacts，並在隔離 session localStorage 建立測試文件；沒有修改正式資料。
6. 未執行任何 git 指令、commit 或其他 git 寫入。

## 主 session 簽字（2026-08-30，行動版 C2）：375×812 實測底部工具欄/精簡頂欄/無溢出、1280 桌面零迴歸（mobile class 與底欄消失）。✍️ 雙簽通過。
