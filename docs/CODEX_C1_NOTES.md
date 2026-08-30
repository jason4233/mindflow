# CODEX C1（觸控手勢引擎）交付筆記

## 完成範圍

- 新增 touch-only Pointer Events 控制器；非 touch 環境不掛 class、不建立浮動按鈕，mouse path 不攔截。
- 單指拖曳空白畫布改走既有 `viewport.setPan()`。
- 雙指 pinch 走既有 `viewport.setView()`，以起始雙指中點的世界座標為錨點，並同步處理中點位移與 0.2–4 倍縮放夾限。
- 節點單指拖曳不另寫搬移邏輯，事件保留給既有 `DragDropController`，最後仍由既有 `moveNode` command path 重掛。
- tap 節點走既有 `SelectionManager.set()`；double-tap 節點走既有 `EditController.start()`。
- double-tap 空白轉送帶座標的 `dblclick`，複用 `floating.js` 原有空白雙擊建懸浮節點與編輯流程。
- long-press 節點轉送 `contextmenu`，複用 `contextmenu.js` 原有節點選單內容與 action 分派。
- touch 環境選取節點時顯示「＋子節點／＋同級」兩顆 44px 浮動按鈕，透過既有 `insertChild`／`insertAfter` actions 執行；根節點的同級按鈕保留顯示但 disabled。
- `css/mobile.css` 僅寫檔案上半 `C1 MOBILE TOUCH GESTURES` 區塊；C2 下半 layout 區完整保留。
- `main.js` 僅新增 C1 import 與一行 `initTouchGestures(featureContext)`；C2 init 保留。

## 檔案

- 新增：`js/editor/touch.js`
- 新增：`tests/touch.test.mjs`
- 新增：`tests/e2e/touch.mobile.mjs`
- 修改：`js/editor/main.js`（C1 import + 一行 init）
- 修改：`css/mobile.css`（只限 C1 上半標記區）
- 覆寫：`docs/CODEX_C1_NOTES.md`（舊檔為前一階段同名 C1 筆記）

## TDD 與驗證

- Unit RED：`node --test tests\touch.test.mjs` 先因 `js/editor/touch.js` 不存在而得到 `ERR_MODULE_NOT_FOUND`。
- Browser RED：375×812／`hasTouch: true` 初次為 0/5；確認缺少 touch class、pinch、double-tap、long-press、dnd touch 行為。
- Browser 測試曾誤點視口外節點；用事件 trace 證實 `a` 中心為 x=380.5、實際 target 是 body。測試改先走既有 Fit，且空白座標強制要求 `canvas.contains(elementFromPoint)`，沒有靠 force click 掩蓋問題。
- `node --test tests\touch.test.mjs`：5/5。
- `node --test tests\e2e\touch.mobile.mjs`：7/7；涵蓋 375×812 的 pan、pinch、tap、兩顆新增按鈕、double-tap 節點／空白、long-press、dnd 重掛，以及 1280×800 無 touch 的 mouse 點選／平移回歸。
- 根目錄全部 `*.test.mjs`：Node runner 18/18。
- desktop 全部 `desktop/test/*.test.mjs`：136/136。
- `node --check`：`touch.js`、`main.js`、touch E2E 均 exit 0。

## 主動自首

- 沒有 Android 真機或 Android WebView 測試；行動驗證是 Chromium 375×812、`hasTouch: true`，pan／pinch／drag／long-press 由 CDP `Input.dispatchTouchEvent` 送真實 Chromium touch/pointer 事件。它不能冒充實體手機的觸控取樣、系統手勢仲裁或 OEM WebView 行為。
- double-tap 視窗採 350ms／24px，long-press 採 520ms／10px；這些是 C1 明確常數，尚未經晨睿真機手感調校。
- 未執行 `tests/e2e/shortcuts.matrix.mjs`：該腳本會覆寫非 C1 所有權的 `docs/SHORTCUT_MATRIX.md`。桌面 mouse 零回歸改由本流不寫共享報告的 1280×800 Playwright 案覆蓋；沒有宣稱 shortcut matrix 本次已重跑。
- 沒有執行 git 指令、commit、branch 或任何 repo 狀態修改。

## 主 session 簽字（2026-08-30，行動版 C1）：touch 測試 5/5、手勢全數轉接既有 API、非 touch 環境零掛載。✍️ 雙簽通過。
