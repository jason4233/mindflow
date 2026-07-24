# 最終階段任務書 — FIX3 ∥ C1 ∥ C2 三流並發

> 依據 docs/REVIEW_D_FINDINGS.md（編號對應）與 docs/SPEC.md。三流檔案所有權互斥，嚴禁越界。main.js 標記區只有 C1 可改（C1 會替 C2 的模組預掛 init 行，函數名照本文件約定）。

## 工作流 FIX3 — 缺陷修復（REVIEW_D #1–#8）

**擁有**：keyboard.js、edit.js、findreplace.js、summary.js、relations.js、js/io/export.js、tests/
- #1 findReplace 加入 COMMIT_BEFORE_GLOBAL_ACTIONS（編輯中 Ctrl+F 先 commit）
- #2 dissolve（Ctrl+Delete）比照 remove 走 deleteNodesWithOverlaysCommand 的清理+可逆語意
- #3 概要連續性判斷改用「目前佈局的實際視覺順序」（單側佈局下不再看 node.side）
- #5 匯出文字剝離 icons/__floating__ token 字串前綴
- #6 documentToSvg 的連線幾何 import render.js 的 getConnectionPath（org/tree/timeline/fishbone 各自正確）
- #7 修 mindmap-left 匯出雙重鏡像
- #8 匯出套用 doc.canvas.spacingH/V

## 工作流 C1 — 面板補完 + 演示模式 + 專注模式

**擁有**：sidepanel.js、themes.js、viewport.js、dnd.js、presentation.js(新)、focus.js(新)、css/editor.css、css/features.css、css/presentation.css(新)、main.js 標記區
- #4 面板只送使用者實際改動的欄位；線形解析 fallback 用主題 lineShape（勿把主題值釘進節點 token）
- #9 節點寬度：拖節點左右邊緣調寬（min 60/max 500），多選批次套用
- #10 右下控制群加「手形工具」toggle（開啟時左鍵拖曳一律平移、不選取）
- #11 樣式面板「結構」改為**單節點局部方向覆蓋**（寫 node.style.structure，GAMMA 佈局已支援）
- #12 節點間距「適用範圍」下拉生效（所有節點/僅選取子樹）
- #13 主題分頁加「自訂」區：目前樣式存為自訂主題（localStorage）、可刪除
- #14 「設為預設」生效：新建文件採用預設主題
- #16 選中概要時樣式面板顯示概要樣式控制（線色/線型/填色）
- **演示模式** presentation.js：export `initPresentation(ctx)`；註冊 action `presentation`。全螢幕深色底、逐分支聚焦播放（先根、依序每條一級分支子樹）、單擊/→ 下一步、← 上一步、右鍵選單（從當前節點開始/跳結尾/退出）、Esc 退出、底部進度點
- **專注模式** focus.js：export `initFocus(ctx)`；action `focus`。隱藏全部 chrome 只留畫布+右下退出鈕，Esc 退出
- main.js 標記區加五行 init：`initPresentation/initFocus/initHistory/initFormula/initSplitscreen`（後三個模組由 C2 同步撰寫，函數名已約定，import 路徑 `./history.js` `./formula.js` `./splitscreen.js`）

## 工作流 C2 — 歷史版本 + 公式 + 分屏 + 匯入入口

**擁有**：history.js(新)、formula.js(新)、splitscreen.js(新)、js/store.js、js/dashboard.js、toolbar.js、css/phasec.css(新)
- **歷史版本** history.js：export `initHistory(ctx)`；action `history`（Shift+Alt+H 與 ··· 選單已綁）。store.js 加快照 API：每次存檔若距上個快照 >5 分鐘或節點數變化 >10% 就存快照（每文件上限 30 個，FIFO）；面板列出時間點+節點數，預覽（唯讀 mini 渲染）+「還原」（還原本身也是可 undo 的 command 或再存一個快照防呆）
- **公式** formula.js：export `initFormula(ctx)`；action `insertFormula`（toolbar ⊕ 插入選單加「公式」項——toolbar.js 歸你）。LaTeX 子集自寫解析器：上下標 ^ _、分數 \frac{}{}、根號 \sqrt{}、希臘字母常用集、± × ÷ ≤ ≥ ≠ ∞ ∑ ∫，渲染成節點內 inline SVG/HTML；不支援的語法原文顯示等寬字。含公式速查面板（點選插入樣板）
- **分屏** splitscreen.js：export `initSplitscreen(ctx)`；action `splitScreen`（··· 選單項由你在 toolbar.js 補）。右半屏 iframe/物件顯示使用者提供的 URL 或上傳的 pdf（用瀏覽器原生 pdf 檢視）、可調分隔線、關閉鈕
- **匯入入口** #15：dashboard「新增文檔」旁加「匯入」按鈕接 io/import.js（.mindflow/.json/.txt/.md），匯入後開啟編輯器

## 共同要求

非互動模式立刻動手；tests 全綠+各自補測；瀏覽器自測；各寫 docs/CODEX_<流名>_NOTES.md；不要 git。
