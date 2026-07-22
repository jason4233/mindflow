# FIX 任務書 — 核心架構修復（token 拆除 + undo 原子化）

> 執行者：Codex。依據：docs/REVIEW_B_FINDINGS.md 全部 18 條。本流**獨佔核心檔案**：model.js、commands.js、edit.js、keyboard.js、themes.js、render.js、sidepanel.js、toolbar.js、viewport.js、selection.js、js/io/export.js、js/store.js、js/dashboard.js。同時有 DELTA 流在寫全新模組（relations.js 等），不會碰你的檔案；你也**不准**碰它的新檔案。

## 架構決策（主 session 拍板，照做）

1. **拆除 style.shape 複合 token**，改為一級欄位：
   - `node.style` 新增：`radius:number`、`align:'left'|'center'|'right'`、`lineHeight:number`（進 NODE_STYLE_KEYS）。
   - `node.richText:string|null` —— **節點層欄位，不屬 style**（是內容不是樣式；Ctrl+Alt+C/V 絕不能搬它）。
   - `doc.canvas.watermark` 改為物件 `{enabled,text,color,rotation,opacity,size}`；`doc.canvas.spacingH/spacingV`。
   - `node.style.shape` 回歸純形狀枚舉字串。
   - normalizeNode/normalizeDoc 加**遷移**：載入時遇到含 `|` 的 shape token 就解析拆進新欄位（相容既有測試文件）。
2. **CommandManager 加 `batch(description, commands[])`** 複合命令：do 順序執行、undo 逆序，整體算一條 undo 記錄。文字編輯 commit（updateText+richText+樣式）必須包成一個 batch。
3. **無變化操作不得進 undo stack**：所有 command 的 do() 在無實際變化時 return false（含 mutateSelectedStyles 現在無條件 true 的問題）。
4. **滑桿/色票拖曳期間只做即時預覽**（直接改 DOM/暫存），`pointerup`/`change` 才產生一條 command；一次拖曳=一條 undo。
5. **undo/redo 還原 selection**：command 附 affectedIds，manager onChange 時通知 selection 重新選取。
6. **編輯 session 綁定節點 id**：edit.js 開始編輯時記下 nodeId，commit/blur 一律作用於該 id（不是 selection.primaryId）。
7. **鍵盤焦點守衛重做**：焦點在面板 input/連結彈窗時，字元鍵放行給輸入框；但 Ctrl+S/P/O/D/Ctrl+數字 等瀏覽器衝突組合鍵一律全域 preventDefault。SPEC §1 每一鍵都必須綁到「已註冊」的 action——綁定前 assert，未註冊直接 throw（開發期暴露）。
8. **Shift+↑/↓、Alt+↑/↓ 用視覺順序**（layout 結果的同側 Y 排序），不是 children 陣列順序。
9. 浮水印文字可清空（空字串=只關文字，enabled 語意不變）；主題卡片整卡可點；縮圖用文件實際 themeId 配色；編輯器 autosave 前檢查文件仍存在（永久刪除後不得復活）；export.js 支援新 schema（形狀/線型/圓角進 SVG 匯出）；工具列所有按鈕綁已註冊 action（含 Ctrl+F 尋找先做 stub action 顯示「即將推出」toast 也行，不准 silent no-op）。

## 驗收（我會逐條實測 REVIEW_B_FINDINGS 的 18 個觸發場景）

每條 finding 的 failure_scenario 必須不再重現。tests/ 全綠 + 為 batch/遷移/焦點守衛補測試。完成寫 docs/CODEX_FIX_NOTES.md。
