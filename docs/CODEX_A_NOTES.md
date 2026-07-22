# Phase A 實作紀錄

完成日期：2026-07-23

## 實作摘要

- 依 `docs/ARCHITECTURE.md` 建立完整目錄骨架，共 26 個規定檔案；Phase A 未納入的 context menu、大綱與進階匯入/匯出保留中文 TODO stub。
- 完成最小首頁儀表板：新建、開啟、重新命名、刪除、更新時間與 localStorage 多文件 index。
- 完成 v1 Doc/Node schema、資料正規化、序列化、唯一 ID、樹查詢與左右平衡估算。
- 完成 Command Pattern：`addChild`、同級前後新增、`deleteNodes`、`updateText`、`moveNode`、`toggleCollapse`、`setStyle`，另含標題修改與子樹貼上 command。undo/redo 上限 100；新 command 會清空 redo。
- 完成純函數 `mindmap-right` / `mindmap-both` layout：後序計算子樹高度、40px 水平距離、12/24px 垂直距離、摺疊截斷與左右平衡。
- 完成隱藏 DOM 文字量測、250px 最大節點寬度、冪等全量 HTML/SVG render、三次 Bézier 連線與 `classic-blue` 資料驅動主題。
- 完成單選、Ctrl 多選、空白框選、contenteditable、集中式 keyboard action table、app 內子樹剪貼簿、拖曳重掛、摺疊、pan/zoom/fit、工具列與可收合側欄。
- 文件修改後 500ms debounce 自動存檔；Ctrl+S 與離頁時立即存檔。
- 所有 runtime UI 字串集中於 `js/strings.js`，runtime 無 CDN、npm package 或其他外部依賴。

## 完成定義逐條檢查

1. **新建文件與初始置中：通過**
   - 真實 Chromium 新建後顯示中心主題 + 4 分支，`fit` 已執行，首頁與編輯器 console 皆為 0。
2. **快捷鍵與 undo/redo：通過**
   - Browser smoke：Tab、Enter、Delete、F2、方向鍵、Ctrl+Z/Y、Ctrl+C/V、Ctrl+S、Ctrl+-。
   - Node 測試連續執行 20 次 undo，再執行 20 次 redo，狀態正確；另驗證 100 步 stack 上限及新 command 清空 redo。
3. **拖曳換父、排序、左右側：通過**
   - Chromium pointer drag 已驗證換父與重繪；純函數 command 測試驗證 index、side、undo 及禁止移入自身後代。UI 實作會依目標上/中/下區域決定同級排序或換父，拖到根/空白另一側會傳入新 side。
4. **摺疊、展開與無重疊：通過**
   - Browser smoke 驗證 `−` → `+1`、後代隱藏及再次展開。
   - Node layout 測試驗證摺疊後代不進 positions，並對全部測試座標做矩形重疊檢查。
5. **縮放、平移、fit 與 100+ 節點：通過**
   - Space+左鍵、右鍵拖曳、Ctrl 縮放、wheel 與 fit 均在 Chromium 操作成功。
   - 151 節點 browser stress：151 個 node div、150 條 SVG path、navigation duration 約 69.4ms、fit 為 20%、console 0。
6. **重新整理持久化：通過**
   - 編輯文字、拖曳重掛與改名後 Ctrl+S/reload，節點結構與標題均恢復；首頁卡片同步顯示並可重新命名、刪除。
7. **無 console error：通過**
   - 首頁、一般編輯流程、reload 與 151 節點 stress 均為 0 errors / 0 warnings。

## 自測

執行方式：

```text
node tests\core.test.mjs
```

結果：`13/13 tests passed`。

覆蓋範圍：schema/正規化/序列化、全部必備 commands、子樹刪除、移動 cycle guard、樣式與摺疊回復、20 次 undo/redo、100 步限制、兩種 layout、純函數不修改 Doc、垂直間距、無重疊、摺疊排版、左右高度平衡、151 節點效能與 bounds。

額外稽核：

- 架構規定檔案：26/26。
- 全部 JavaScript `node --check`：通過。
- 外部 runtime script/import 掃描：無。
- Playwright 只用於交付前驗證，未加入專案依賴；測試 server、browser session 與暫存 snapshots 已清理。

## 偏離與範圍說明

- 無已知 Phase A 功能偏離。
- v1 schema 內其餘 layout 值（org、tree、timeline、fishbone 等）尚未實作，Phase A layout 會安全降級為 `mindmap-right`；`mindmap-right` 與 `mindmap-both` 已完整實作。
- 進階 context menu、大綱、PNG/SVG/PDF/TXT/Markdown 匯入匯出依任務書留待 Phase B；Phase A 的 JSON 序列化/反序列化基礎已提供。
