# 工作流 DELTA 交接紀錄

完成日期：2026-07-23

## 完成範圍

- 關聯線：F4 兩段式建立、cubic Bézier 虛線、黃色控制點與端點拖曳、標籤編輯、刪除與 undo/redo；線色、粗細、線型會與樣式面板連動。
- 概要：將同父、連續同級節點建立為右側大括弧與概要節點；可拖曳上下黃色邊界改變涵蓋範圍，也支援編輯、刪除及 undo/redo。
- 備註與連結：Ctrl+Alt+M 右側備註欄、📄 標示；Ctrl+Alt+K 連結視窗、URL 正規化、貼上 URL 自動偵測、hover tooltip。
- 圖片：Alt+P 上傳，也支援 drag/drop 與 clipboard paste；內容存成 base64，可拖右下角調整顯示尺寸。
- 圖示與貼紙：優先順序 1–9、八段進度圓餅、六色旗幟、emoji；Ctrl+數字快速套用優先順序，同類互斥且重按移除。貼紙面板直接讀取 `assets/stickers/manifest.json` 的 36 張素材。
- 懸浮節點：Shift+Alt+F 建立、拖移與掛回樹；位置會隨文件持久化。
- 格式刷：Ctrl+G 啟用單次格式複製，套用一次後自動退出。
- 尋找與取代：Ctrl+F 浮動面板、結果數量、前後跳轉、目前命中與全部命中高亮、單筆與全部取代。
- 右鍵選單：補齊 SPEC §2 的節點版與畫布版，含插入子選單與既有 action 派送。
- 快捷鍵說明：從 action 綁定資料產生說明面板，避免另維護一份不一致的快捷鍵表。

## 模組與掛接

- 新增 `js/editor/relations.js`、`summary.js`、`attachments.js`、`floating.js`、`findreplace.js`、`iconpanel.js`、`shortcuthelp.js`。
- 新增 `css/features.css`。
- `js/editor/main.js` 僅在 `PHASE-B INIT` 標記區載入 DELTA。
- `js/editor/contextmenu.js` 透過 action registry 派送操作。
- 所有跨模組功能使用 `registerAction`；SVG/HTML 額外圖層使用 `registerOverlay`；可復原資料異動均由新模組內 command 交給 `CommandManager.execute`。
- 未修改 `keyboard.js`、`render.js`、`edit.js`、`model.js`、`commands.js`、`themes.js`、`sidepanel.js`、`toolbar.js`、`export.js`。

## 資料格式

- 關聯線寫入 `doc.relations`，保留 source/target、label、style 與兩個控制點偏移。
- 概要寫入 `doc.summaries`，保留 parent、起訖同級節點與概要文字。
- 備註、連結、圖片沿用節點欄位；貼紙與圖示沿用 `node.icons`。
- 懸浮座標使用 `node.icons` 內的私有 `__floating__:x,y` token。這是為了遵守本輪禁止修改 model schema 的邊界；圖示面板會忽略該 token。

## 驗證結果

- `node --check`：9 個 DELTA/整合 JavaScript 全數通過。
- `tests/core.test.mjs`：22/22。
- `tests/delta.test.mjs`：9/9。
- `tests/io.test.mjs`：11/11。
- `tests/store-search.test.mjs`：9/9。
- 合計 51/51 tests passed。
- 獨立 Playwright session 實測：關聯線建立、標籤與三種樣式連動；概要合法/非法選取與邊界；備註、連結、圖片、圖示、貼紙；懸浮節點、格式刷；尋找取代；兩式右鍵選單；快捷鍵面板；reload 後圖片、貼紙、懸浮資料仍存在。最後 console 為 0 errors / 0 warnings。

## 本輪刻意不做與邊界

- 匯出彈窗與匯出格式引擎依範圍調整留給 FIX 流，未碰 `export.js`。
- 右鍵選單中超出本輪資料層範圍的公式、評論、團隊協作、設定入口保留為明確提示，不偽造未完成的持久化功能。
- 圖片雖會擴張節點 DOM，核心 layout 尺寸計算仍不含圖片；大圖可能需要手動縮小以避免與鄰近節點視覺重疊。要徹底納入自動排版，需在後續可修改 `render.js` / layout 層時處理。

本輪未執行 git commit 或其他 git 寫入操作。
