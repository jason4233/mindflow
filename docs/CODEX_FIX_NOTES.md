# CODEX FIX Notes

完成日期：2026-07-23

## 架構修復

- `node.style.shape` 已恢復為純形狀字串；`radius`、`align`、`lineHeight` 成為 `NODE_STYLE_KEYS` 一級欄位，`node.richText` 成為節點內容欄位。
- `doc.canvas` 現為 `{background, watermark, spacingH, spacingV}`；`watermark` 是 `{enabled,text,color,rotation,opacity,size}`，空文字合法且不改變 enabled。
- `normalizeNode`／`normalizeDoc` 會把舊 `shape|key=value` 文件遷移到新欄位。`parseStyleToken`／`encodeStyleToken` 僅保留給舊資料與 line token 相容，不再用於節點樣式寫入。
- `CommandManager.batch(description, commands)` 以正序 do、逆序 undo 執行，整批只佔一筆 undo。文字、richText 與編輯工具列樣式現在一次提交。
- `setStyle`、進階樣式、浮水印、間距等 no-op 不入棧，也不會清空 redo。
- range、文字與 native color input 在 `input` 階段只做 preview，`change` 才提交一筆 command。
- command 帶 `affectedIds`；undo／redo render 後由 selection 選取第一個仍存在的 affected node。
- Edit session 的 plain text、richText 與樣式全部固定寫回 session node id，不讀 blur 當下 selection。
- 焦點守衛允許輸入框原生字元與剪貼簿，但全域攔截 Ctrl+S/P/O/D、Ctrl+1–9、Ctrl+F；快捷鍵與工具列 action 綁定前會 assert，未接功能有可見 fallback。
- Shift+↑/↓ 與 Alt+↑/↓ 依 layout position 的同側 Y 順序導覽／移動。

## 18 條 finding 結果

1. 樣式複製不再攜帶 richText、浮水印或文件間距。
2. 文字編輯一次 Ctrl+Z 同時還原 text、richText 與樣式。
3. 編輯文字、浮水印與間距不再把主題 shape 寫成 node override。
4. slider／色票／浮水印連續輸入一次操作只產生一筆 undo。
5. 無變化形狀與樣式操作不進 undo，redo 歷史保留。
6. undo／redo 結構命令後 selection 會落在仍存在或已恢復的 affected node。
7. 編輯 session 即使 selection 改變，richText 仍寫回原節點。
8. 浮水印文字可清空，enabled 保持原語意。
9. contenteditable、標題與面板 input 內的瀏覽器衝突快捷鍵會 preventDefault。
10. 同級選取與移動使用同側視覺順序。
11. SPEC action 全部已註冊；工具列插入、概要、關聯線等不再 silent no-op。
12. 點其他節點結束編輯時，不會把原節點 richText 寫入新 selection。
13. SVG 支援 circle、ellipse、diamond、parallelogram、pill variants、圓角、border dash 與 straight／orthogonal connection。
14. 永久刪除後，殘留 editor 的 autosave／beforeunload 無法復活文件。
15. 工具列所有按鈕綁定已註冊 action；Ctrl+F 會開啟尋找面板或可見 fallback。
16. `?focus=<nodeId>` 首次 layout 後會選取並置中目標節點。
17. mini-SVG 縮圖使用文件實際 theme palette/root/branch 配色。
18. 主題卡 preview、標籤與卡片外圍皆可點，並支援 Enter／Space。

## 驗證

- `tests/core.test.mjs`：22/22
- `tests/delta.test.mjs`：9/9
- `tests/io.test.mjs`：11/11
- `tests/store-search.test.mjs`：9/9
- 合計：51/51
- Playwright headed Chromium：REVIEW_B findings 1–18 全部 PASS。
- Browser console：0 errors、0 warnings。
- 瀏覽器回歸腳本：`.playwright-cli/fix-group-a.js`、`.playwright-cli/fix-group-b.js`。
- 最終畫面：`.playwright-cli/page-2026-07-22T19-18-12-995Z.png`。

## 邊界

- 未修改 DELTA 新模組或 `js/editor/contextmenu.js`。
- 未執行 git 指令。
