# 工作流 C2 交接紀錄

完成日期：2026-07-25

## 完成範圍

- 歷史版本：
  - `saveDocument()` 每次存檔會比較最近快照；相隔超過 5 分鐘或節點數變化超過 10% 時建立新快照。
  - 每文件最多保留 30 份，超出後 FIFO 移除；永久刪除文件會同步清除快照。
  - `history` action 與 Shift+Alt+H 可開啟版本面板；顯示時間、節點數與唯讀 mini-SVG。
  - 還原前會先建立安全快照，還原本身也走 `CommandManager`，可直接 Ctrl+Z/Ctrl+Y。
- 公式：
  - `insertFormula` action 已接上 toolbar ⊕ 插入選單，並保留 `formula` 相容 alias。
  - 自寫 LaTeX 子集支援上下標、分數、根號、常用希臘字母、`\pm`、`\times`、`\div`、`\le`、`\ge`、`\ne`、`\infty`、`\sum`、`\int`。
  - 不支援或括號不完整的語法整式以 escaped monospace 原文顯示，不執行任意 HTML。
  - 公式以可逆文字 token 持久化，render overlay 再轉成受控 inline HTML；插入 command 可 undo/redo。
  - 公式 dialog 含即時預覽與 10 個快速樣板。
- 分屏：
  - `splitScreen` action 已加入實際 `···` menu。
  - 支援 HTTP(S) URL iframe 與本機 PDF object URL；拒絕 `javascript:`、`file:` 等 protocol。
  - 分隔線支援 pointer drag 及鍵盤左右鍵；關閉會恢復完整畫布並 revoke PDF object URL。
- 匯入入口：
  - dashboard「新增文檔」下方新增「匯入」按鈕。
  - 支援 `.mindflow`、`.json`、`.txt`、`.md`，分別接既有 `io/import.js` parser。
  - 匯入一律建立新的 document ID，避免同 ID 靜默覆蓋現有文件，完成後直接進 editor。
- 樣式：
  - 新增 `css/phasec.css`，由 C2 模組動態載入，不需要修改 `index.html` / `editor.html`。
  - CSS 包含 keyboard focus、mobile、reduced-motion，且 selector 限定在 C2 命名空間。

## Store API

- `listDocumentSnapshots(documentId)`
- `getDocumentSnapshot(documentId, snapshotId)`
- `createDocumentSnapshot(doc, options)`
- `HISTORY_KEY_PREFIX`
- `SNAPSHOT_LIMIT`
- `SNAPSHOT_INTERVAL_MS`
- `SNAPSHOT_NODE_CHANGE_RATIO`

## 驗證結果

- `node --check`：`store.js`、`dashboard.js`、`toolbar.js`、`history.js`、`formula.js`、`splitscreen.js` 全數通過。
- 專案既有測試：
  - `tests/core.test.mjs`：22/22。
  - `tests/delta.test.mjs`：13/13。
  - `tests/io.test.mjs`：13/13。
  - `tests/layout.test.mjs`：7/7。
  - `tests/store-search.test.mjs`：9/9。
  - 合計 64/64。
- C2 一次性 Node 補測：
  - snapshot 初始建立、5 分鐘嚴格門檻、>10% 節點門檻、30 份 FIFO、clone 隔離與永久刪除清理。
  - 歷史還原 command 保留 doc object identity，undo/redo 可逆。
  - LaTeX parser 的巢狀分數/根號/上下標/希臘字母、未知語法 fallback、HTML escape、token 與 command undo/redo。
  - 分屏 URL protocol 與 PDF MIME/副檔名判斷。
- Playwright 真實瀏覽器：
  - dashboard import button 與四種副檔名 routing；以 in-memory Markdown File 端到端匯入，成功建立新 ID、三層樹與首份快照。
  - 歷史版本實測 6 節點還原到 5 節點，再 Ctrl+Z 回 6 節點；還原前安全快照存在。
  - 公式 preview 與節點內各產生 fraction/sqrt/sup/sub，token autosave 後仍存在。
  - 分屏拒絕不安全 URL；同源 iframe 載入成功；PDF blob 載入、divider 鍵盤調寬 640→620、關閉 revoke object URL。
  - 最終 browser console：0 errors / 0 warnings。
  - 像素檢查：歷史 drawer、版本列表、mini-SVG 與還原按鈕無重疊或裁切。

## 邊界

- `tests\` 明確由 FIX3 所有，C2 沒有競寫測試檔；補測以一次性 Node assertions 與 Playwright 實際流程執行，結果記錄於本文件。
- 未修改 `main.js`；C1 已依 brief 掛入 `initHistory/initFormula/initSplitscreen`。
- 未執行 git。
