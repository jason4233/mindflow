# Phase B — BETA 完成紀錄

## 摘要

- 重做首頁儀表板：原創 MindFlow SVG logo、品牌橘 `#F17E2E`、頂部全文搜尋、完整左側欄、responsive 手機版。
- 文件卡片改用存檔時產生的 mini-SVG 內容縮圖，提供開啟、行內重新命名、建立副本、收藏、移到回收筒；卡片 `⋯` 與右鍵皆可開啟操作選單。
- 完成收藏檢視、回收筒還原、永久刪除確認 dialog、空狀態與操作 toast。
- 新增跨文件全文檢索：搜尋標題及所有節點文字，結果顯示完整節點路徑並可開啟文件。
- 新增 8 分類、17 個原創繁中範本，包含週計畫、SWOT、讀書筆記、專案規劃、旅行計畫、會議記錄、考試複習、家譜等；範本直接讀取 `themes.js` 可用 id 並輪替。
- `store.js` 升級為 index v2：`docs[]`、`trash[]`、`favorites[]`、`thumbnail`，保留原本 create/load/save/list/rename API，舊 v1 index 與文件可直接載入並在下次寫入時升級。

## Store / search API

- 文件目錄：`listDocuments`、`getDocumentMeta`、`createDocument`、`loadDocument`、`saveDocument`、`renameDocument`、`duplicateDocument`。
- 收藏：`toggleFavorite`、`isFavorite`、`listDocuments({ favoritesOnly: true })`。
- 回收筒：`deleteDocument` / `trashDocument`、`listTrashedDocuments`、`restoreDocument`、`permanentlyDeleteDocument`。
- 縮圖：`createDocumentThumbnail`；使用者文字有 XML escape，舊 meta 缺縮圖時 dashboard 會從原文件即時補繪。
- 搜尋：`normalizeSearchText`、`searchDocuments`；支援 NFKC、大小寫正規化與階層路徑。

## 自測結果

- `node tests/core.test.mjs`：**18/18 passed**（包含同時整合進來的 ALPHA 測試）。
- `node tests/store-search.test.mjs`：**7/7 passed**。
- `git diff --check`：通過。
- Playwright 真實瀏覽器：
  - 範本庫 8 分類與範本建立 → editor 載入正確主題/節點。
  - 收藏、全文搜尋節點路徑、行內改名、建立副本、移到回收筒、永久刪除 dialog、還原與空狀態皆通過。
  - 1440×900 與 375×812：無水平溢出；可見按鈕最小高度 44px；縮圖 0 破圖。
  - console：0 error、0 warning。
- 最終偵測到 `themes.js` 共 12 個主題；17 個範本已輪替引用全部 12 個 theme id。

## 所有權與偏離

- BETA 未修改 `js/editor/`。測試期間觀察到 ALPHA 並行更新 `editor.html`、editor CSS、`js/editor/*` 與 `tests/core.test.mjs`；均原樣保留。
- `團隊協作`、`我的分享`、設定齒輪依任務書維持明確灰色／提示佔位。
- 無外部 runtime 依賴，未建立 git commit。
