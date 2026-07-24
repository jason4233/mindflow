# CODEX FIX2 NOTES

日期：2026-07-25

## 完成內容

1. `sidepanel.js` 的連接線 fallback 改讀目前主題 `lineShape`；形狀與線型各自只送實際變更欄位，避免 orthogonal 被寫成 curved。
2. 新增 `exportdialog.js` 並由 `toolbar.js` 註冊真實 `openExport`：JPG、PNG、PDF、WORD、TXT、MINDFLOW 六格式皆有使用者入口。
3. `export.js` 解析 richText 的 `b/strong/i/em/u/s/span/font`，依格式 run 輸出 SVG `tspan`，保留局部粗體、斜體、底線、刪除線、文字色、字型與字級。
4. Ctrl+V 不再於 keydown 階段 `preventDefault`；native paste handler 先處理內部節點剪貼簿，再處理圖片或 URL，並避開文字輸入欄與畫布外按鈕。
5. 概要改存 `startNodeId/endNodeId`；舊 `startIndex/endIndex` 仍可讀，更新時自動遷移。
6. 尋找取代命中 richText 節點時同步清除 richText、退回更新後純文字；undo 會還原原 richText。
7. 懸浮節點 clone 掛入一般樹時清除整棵子樹的 `__floating__` token；root 直屬 duplicate 保留懸浮語意並位移，避免重疊；渲染也只承認 root 直屬 token。
8. `relations.js` 不再覆寫節點 `applyStyle/setLineStyle`；關聯線改走獨立 `applyRelationStyle`，保留原節點有效值比對、`affectedIds` 與 undo selection 行為。
9. 關聯線端點重接會拒絕既有相同 `fromId/toId` 配對。
10. `updateSummaryCommand` 先完成 parent/anchor 驗證才套 patch，回傳 false 時不再修改文件。
11. 節點刪除與 cut 會同步移除被刪子樹相關 relations/summaries；command 保存反向資料，undo/redo 可完整還原/再次清理。
12. 編輯中的 Ctrl+1..9、Ctrl+D、F6 先 commit session 再執行 action，避免 detached contenteditable、文字延遲回寫與鍵盤失效。
13. 全域快捷鍵尊重 `event.defaultPrevented`，焦點守衛納入 BUTTON、role=button、role=menuitem。
14. richText SVG 殘留項與第 3 點一併完成。
15. 備註 textarea 的 Escape 會自動儲存並關閉 drawer。
16. 概要連續性改依同父、同側視覺順序判定；無效選取顯示 toast，不再靜默。

## 匯出與佈局 UI

- JPG/PNG：`documentToSvg → Image → Canvas → Blob`；PNG 有透明背景選項。
- PDF：獨立列印視窗。
- WORD/TXT/MINDFLOW：直接產生並下載 `.doc`、`.txt`、`.mindflow`。
- HD 預設邊距 80px、渲染比例 200%。
- 匯出 dialog 支援按鈕關閉與 Escape。
- `sidepanel.js` 提供六佈局 mini-SVG fallback 卡；GAMMA 初始化後在同一 Layout pane 掛入完整 layout panel，所有卡直接呼叫已註冊的 `setLayout`，一鍵整理呼叫 `tidyLayout`。

## 測試

- Syntax：11/11 modified JavaScript files 通過 `node --check`。
- Node：64/64 通過。
  - core 22/22
  - delta 13/13
  - IO 13/13
  - GAMMA layout 7/7
  - store/search 9/9
- 新增覆蓋：
  - native paste keydown 不攔截、按鈕/role/defaultPrevented 焦點守衛
  - 同側概要與 nodeId 錨定、懸空概要無副作用
  - 關聯線重複重接
  - 刪除中段節點時 relations/summaries 清理與 undo/redo
  - 懸浮 clone token
  - richText 取代同步與 undo
  - richText SVG tspan run
  - 六格式匯出清單

## 瀏覽器快測

Playwright headed，`http://127.0.0.1:4173/editor.html`：

- 六格式匯出 dialog 正常；PNG 透明背景實際下載成功；HD 顯示 80 / 200%；Escape 可關閉。
- Layout pane 的真 `setLayout` 可切到組織圖。
- 根節點左右交錯資料下，同側兩節點可建立概要；跨側選取顯示錯誤 toast。
- 編輯文字後按 Ctrl+1：文字先提交、priority 1 套用、session 正常結束，鍵盤可繼續使用。
- 主題卡聚焦按 Enter：套用主題且節點數不增加。
- 灰階綱要主題只把線型改 dotted 後，shape 仍為 orthogonal，token 為 `dotted|shape=orthogonal`。
- 真實 `Ctrl+V` 貼上 `https://example.com/fix2` 後出現 link badge。
- 備註 drawer 輸入後按 Escape：drawer 關閉且備註 badge 出現。
- Console：0 errors、0 warnings。

## 範圍

- 未修改 `main.js`、`layout.js`、`render.js`、`viewport.js`、`outline.js`、`minimap.js`、`viewmode.js`、`model.js`、`commands.js`、dashboard/store/index。
- 未執行 git。
