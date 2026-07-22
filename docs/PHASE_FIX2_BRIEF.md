# FIX2 任務書 — REVIEW_C 全 16 條修復 + 匯出 UI + 佈局分頁

> 依據 docs/REVIEW_C_FINDINGS.md（16 條，每條含觸發場景）。與 GAMMA 流並行，**檔案分界絕對不可越**。

## FIX2 擁有（可改）
sidepanel.js、keyboard.js、edit.js、attachments.js、summary.js、relations.js、floating.js、findreplace.js、iconpanel.js、contextmenu.js、toolbar.js、themes.js、js/io/export.js、js/editor/exportdialog.js（新）、css/editor.css、css/features.css、tests/

## FIX2 禁區（GAMMA 正在改）
main.js、layout.js、render.js、outline.js、viewport.js、minimap.js、viewmode.js、model.js、commands.js、store/dashboard、index.html

## 修復重點提示

1. **#4 Ctrl+V 貼上失效**：keyboard 對 Ctrl+V 不要 preventDefault（讓原生 paste 事件發出，attachments 的 paste handler 接手）；但要防止重複處理（paste handler 內判斷 target）。
2. **#12 編輯中快捷鍵摧毀編輯 session**：編輯進行中，會觸發 renderAll 的全域快捷鍵（Ctrl+1..9、Ctrl+D、F6 等）一律先 commit 當前編輯再執行，或直接忽略——選前者（GitMind 行為）。
3. **#1 連接線 fallback**：refreshPanel 的線形 fallback 用 theme.lineShape 不是寫死 curved；updateLine 只送使用者實際改動的欄位。
4. **#16 概要建立失敗**：修「連續同級」判斷（用同側視覺順序，不是 children 陣列 index）；無效選取要有 toast 提示。概要定位改用 nodeId 錨定（#5：不能用 parentId+index，節點增刪會漂移）。
5. **#7 懸浮節點 token**：複製/貼上/duplicate 時 __floating__ 標記的正確處理。
6. **#11 刪除節點清理**：deleteNodes 執行時同步移除掛在被刪子樹上的 relations/summaries（batch 內含反向資料供 undo 完整還原）。
7. **匯出彈窗**（新 exportdialog.js，從 toolbar.js 掛入，不碰 main.js）：SPEC §9 六格式卡片 UI 接 io/export.js（JPG/PNG 走 documentToSvg→canvas；PNG 透明選項；PDF 走列印視窗；WORD/TXT/MINDFLOW 直接下載）；HD 邊距 80/比例 200%。#3 richText 進 SVG（tspan 按格式片段輸出）。
8. **佈局分頁 UI**（sidepanel Layout 分頁）：6 佈局縮圖格（mindmap/logic-right/org/tree/timeline-h/fishbone，mini-SVG 示意）+ 點擊 runAction('setLayout', id)。GAMMA 正在實作引擎，你只做 UI 與 action 呼叫（action 未註冊時顯示即將推出 toast，GAMMA 完成後自動接通）。
9. 其餘各條照 REVIEW_C 逐一修，修完逐條驗證觸發場景不再重現。

完成：tests 全綠+補測、瀏覽器自測、寫 docs/CODEX_FIX2_NOTES.md。
