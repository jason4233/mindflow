# 工作流 ALPHA 完成紀錄

## 摘要

- 完成 A-fix：移除 F2、純方向鍵、Ctrl+Shift+F、Ctrl+Shift+Z 等非官方綁定；SPEC §1 改為「鍵 → action 名」集中表。
- 新增 `js/editor/actions.js`：`registerAction(name, fn)` / `runAction(name, ...args)`，後續工作流可自行註冊，不必再修改 keyboard 核心。
- 完成官方快捷鍵與互動：Shift+Tab 插入上級、Ctrl+/ 收合、Ctrl+Delete 分解、Alt+↑/↓ 排序、Shift+↑/↓ 選同級、Ctrl+D 複製、Ctrl+Alt+C/V 樣式、F6、Ctrl+P、Alt+Y、Ctrl+Alt+F、Ctrl+Shift+R、F11 等。
- 修正 REVIEW_A 三條：選中直接打字清空進入編輯、Space 保留原文進入編輯；首次開啟固定 100% 並置中；根節點不顯示摺疊鈕。
- 修正畫布互動：空白左鍵拖曳平移；Ctrl/Meta+拖曳框選；Ctrl/Meta+點擊逐一多選；拖放指示改品牌橘。
- `render.js` 新增 `registerOverlay(drawFn)`，每輪 render 依序呼叫；內建浮水印也走 overlay hook。
- 內建 12 主題：經典藍、粉紅範本、深色星空、灰階綱要、藍橘雙藥丸、水彩薄荷綠、秋色暖棕、奶油筆記、紫紅彩虹、午夜簡報、鼠尾草日記、繽紛派對。
- 主題縮圖全部由主題資料即時產生 mini-SVG；支援點擊套用、名稱 tooltip、最多 6 個釘選置頂。
- Theme / Background 子分頁完成：隨機背景、5 快選色、10 原創漸層、完整 10×7 色票、最近使用、原生更多顏色。
- 浮水印完成：開關、30 字限制、顏色、左斜/右斜/水平、透明度、字級，畫布 SVG pattern 平鋪。
- Style 分頁完成：10 形狀、填色、圓角、邊框 5 線型/色/0–5px、連接線 3 形狀/色/5 線型/0–5px、6 結構入口、向右/向左/平衡、H/V 間距與範圍下拉；多選批次套用。
- 文字浮動工具列完成：6 字型棧、字級、B/I/U/S、文字色、反白、左中右、行距、格式刷；B/I/U/S 與顏色可保存局部 rich text，其他控制採全節點粒度。
- 編輯器 chrome 改為三個獨立浮動膠囊，補 reduced-motion / reduced-transparency / high-contrast fallback，零外部依賴。

## 檔案邊界

本流只寫入 ALPHA 所有檔：

- `editor.html`
- `css/editor.css`、`css/node.css`
- `js/editor/actions.js`
- `js/editor/keyboard.js`、`render.js`、`themes.js`、`sidepanel.js`、`edit.js`、`toolbar.js`、`viewport.js`、`selection.js`、`dnd.js`
- `tests/core.test.mjs`
- 本紀錄

未修改 `main.js`、`model.js`、`commands.js`、`layout.js`、`index.html`、dashboard、store、io。執行期間工作目錄另有 BETA 工作流並行改動，本流沒有回退或覆寫。

因 `model.js` 不屬 ALPHA，radius、alignment、spacing、rich text、watermark 詳細設定統一 encode 在既有可序列化的 `node.style.shape` token，並由 `themes.js` 集中解析；不擴張或破壞 v1 schema。

## 自測

### Node

- `node --check`：全部 ALPHA JS 模組通過。
- `node tests/core.test.mjs`：**19/19 passed**。
- 新增測試涵蓋：action registry、A-fix 快捷鍵存在/移除、12 主題資料完整性、mini-SVG 無點陣引用、樣式/線型 token、經 model serialize/deserialize 往返。
- `git diff --check`：通過。

### Chromium / Playwright（localhost:8931，1440×900）

- 首次載入 100%，內容置中，根節點無摺疊鈕。
- 直接輸入清空原文字並開文字列；Space 保留原文進入編輯；Ctrl+B 與 Enter 提交可用。
- Shift+Tab 建立上級、Ctrl+/ 收合/展開、Ctrl+Delete 分解且保留原子節點。
- 空白左鍵拖曳使 world `translate(640,360)` → `translate(700,400)`；Ctrl 框選選中 5 節點。
- Ctrl+點擊多選 2 節點後，批次套用 circle、4px 邊框、直角長虛線 5px 成功。
- 瀏覽器實測曾抓到 DnD `pointerdown` 與 Ctrl+click toggle 衝突，已在 `dnd.js` 修正並重測通過。
- Ctrl+P / Alt+Y / F6、左向結構、12 張主題 mini-SVG、10 個背景、浮水印持久化、70 色格 + 最近色列均通過。
- console：**0 errors / 0 warnings**。
- 視覺檢查：三膠囊工具列、Theme grid、畫布浮水印、右側面板與右下控制列無遮擋；修正與並行 `base.css` 整合時出現的預設黑框。
- 截圖：`.playwright-cli/page-2026-07-22T18-34-11-937Z.png`。

## 偏離 / 後續邊界

- 內建 Browser runtime 回報無可用 browser（清單為空），依工具規則改用真實 Chromium 的 Playwright CLI 完成同等瀏覽器驗收。
- Structure 六個入口已寫入既有 `doc.layout` 並完成向右/向左/平衡方向；組織圖、目錄樹、魚骨、時間軸的專用演算法仍由工作流 GAMMA 所有的 `layout.js` 接手，ALPHA 未越權修改。
- 未 git commit。
