# Phase B 任務書 — 四條並行工作流（ALPHA / BETA / GAMMA / DELTA)

> 執行者：Codex（gpt-5.6-sol, xhigh）。共同依據：docs/SPEC.md（行為規格）、docs/ARCHITECTURE.md（架構）、docs/research/UI_VISUAL_NOTES.md（視覺細節）、docs/research/DIGEST.md（快捷鍵與參數）。
> 執行順序：**第一輪 ALPHA ∥ BETA 並行**；完成後**第二輪 GAMMA ∥ DELTA 並行**。
> 每條工作流只能改自己「擁有」的檔案（下表），讀取不限。main.js 只能在標記區塊內加自己的 init 行。

## 防衝突公約

1. **action registry**（ALPHA 建立）：`js/editor/actions.js` 提供 `registerAction(name, fn)` / `runAction(name)`。keyboard.js 只綁 SPEC §1 的「鍵→action 名」對照表，之後永遠不用再改 keyboard.js；各工作流在自己的模組裡 registerAction。
2. **overlay hooks**（ALPHA 建立）：render.js 提供 `registerOverlay(drawFn)`，每次重繪呼叫所有 overlay（關聯線、概要、小地圖視野框等都走這裡），其他流不改 render.js 核心。
3. **main.js 標記區**：`// === PHASE-B INIT (每流一行) ===` 區塊內各自加一行 `initXxx(ctx)`。
4. 完成後寫 `docs/CODEX_B_<流名>_NOTES.md`：摘要、自測結果、偏離。

---

## 工作流 ALPHA — A-fix + 主題系統 + 樣式面板 + 文字工具列

**擁有**：js/editor/（keyboard, actions[新], render, themes, sidepanel, edit, toolbar, viewport, selection, dnd）、css/editor.css、css/node.css、editor.html

### A-fix（快捷鍵/互動對齊官方，SPEC §1 全表逐條）
- 移除 F2、純方向鍵導覽、Ctrl+Shift+F。
- `Space`=選中節點進入編輯；`左鍵拖曳空白`=平移畫布；`Ctrl+左鍵拖曳`=框選；`Shift+Tab`=插入上級節點（原節點成為新節點的子）；`Ctrl+/`=展開收合；`Ctrl+Delete`=刪除保留子節點（=右鍵「分解」）；`Alt+↑/↓`=同級上移下移；`Shift+↑/↓`=選上/下同級；`Ctrl+D`=duplicate 節點；`Ctrl+Alt+C/V`=複製/貼上樣式；`Ctrl+Alt+F`=fit；`Ctrl+Shift+R`=置中回根；`Ctrl+0`=100%；`F6`=循環下一主題；`Ctrl+P`=開主題面板；`Alt+Y`=開樣式面板；`F11`=全螢幕；編輯中 `Shift+Enter` 換行、`Ctrl+B/I/U` 粗斜底。
- 拖曳放置指示改為**橘色**標記（SPEC §6）。

### 主題系統（SPEC §4 + UI_VISUAL_NOTES 主題配方）
- **≥12 個內建主題**，資料驅動 `{id, name, canvasBg, rootStyle, level2Style, leafStyle, branchPalette[], rainbow, lineShape(curved|dotted|orthogonal), lineWidthByDepth[4,3,2,1]}`。
- 必含：經典藍（現有）、粉紅範本主題（LIVE_DOM_FACTS 完整參數）、深色星空（#0B0B2A）、灰階 outline、藍橘雙藥丸、水彩薄荷綠、秋色暖棕、奶油筆記、紫紅彩虹、+3 自創（風格對齊官方三情境：深色簡報/日記筆記/繽紛多彩）。
- Theme 分頁：縮圖網格（**縮圖用主題資料即時渲染 mini-SVG**，勿用點陣圖）、點擊即套用、hover 顯示名稱；釘選（最多 6 個置頂）。
- Background 子分頁：隨機背景、5 快選色+完整色票、漸層背景庫（CSS 漸層原創 ≥10 張）、浮水印（勾選+文字≤30字+顏色+旋轉3向+透明度0-100+字級，畫布平鋪顯示）。

### 樣式面板 Style 分頁（SPEC §3 順序與規格）
形狀 10 種（含 underline/圓/橢圓/菱形/平行四邊形）+填色、圓角滑桿(預設6)、邊框(5線型+色+寬0-5)、連接線(曲/直/直角+色+5線型+寬0-5預設3)、結構(6樹狀圖示+向右/向左/平衡，先影響整體佈局方向)、節點間距(H/V 滑桿預設30/30+範圍下拉)。色票：10欄×7列+預設+最近+更多顏色(原生 color input)。多選時批次套用。

### 文字浮動工具列（編輯節點文字時浮現於節點上方）
字型下拉(系統字型棧5-6組)、字級、B/I/U/S、文字色、反白底色、對齊(左中右)、行距、格式刷入口。支援選取範圍局部格式化（document.execCommand 或手動 span 包裹，v1 可全節點粒度+粗斜底局部）。

---

## 工作流 BETA — 首頁儀表板完整版 + 文件庫

**擁有**：index.html、css/dashboard.css、js/dashboard.js、js/store.js、js/search.js[新]、js/templates.js[新]、css/base.css

- 版面對齊 SPEC §8：左側欄（新增文檔｜最近編輯｜我的心智圖｜團隊協作(佔位灰)｜我的分享(佔位灰)｜我的收藏｜資源回收筒）、頂欄（logo「MindFlow」原創 SVG、搜索框、設定齒輪佔位）。品牌橘 #F17E2E。
- 文件卡片：**縮圖 = 存檔時產生的 mini-SVG 快照**（store 存縮圖字串）、標題、更新時間；卡片 ⋯ 選單：開啟/重新命名(行內)/複製/收藏/刪除→回收筒。
- 回收筒：列表+還原+永久刪除(確認彈窗)。收藏：星標+側欄過濾。
- 全文檢索：搜標題+所有節點文字，結果列出 文件+命中節點路徑，點擊開啟該文件。
- 範本庫：8 分類（SPEC §8），**≥16 個原創範本**（週計畫、SWOT、讀書筆記、專案規劃、旅行計畫、會議記錄、考試複習、家譜…），內容原創繁中，套不同內建主題（讀 themes.js 的 id 引用即可，不改該檔）。
- store.js 升級：trash[]、favorites[]、thumbnail、documents 目錄 API；保持向下相容 Phase A 存檔。

---

## 工作流 GAMMA — 六佈局引擎 + 檢視 + 小地圖（第二輪）

**擁有**：js/editor/layout.js、js/editor/minimap.js[新]、js/editor/viewmode.js[新]、sidepanel.js 的 Layout 分頁區塊

- 六全域佈局（SPEC §5）：mindmap(雙向平衡)、logic-right/left(邏輯結構圖)、org(組織圖向下)、tree(目錄結構圖縮排)、timeline-h/v(時間軸)、fishbone(魚骨)。切換時節點位置 CSS transition 平滑過渡(300ms)。
- Layout 分頁：佈局縮圖網格(mini-SVG 示意圖)+點擊切換。
- 單節點 Structure 局部覆蓋（節點 style.structure，子樹方向覆蓋）。
- `Ctrl+Shift+L` 一鍵整理 action：重置手動偏移回演算法位置。
- 右下角檢視模式下拉（心智圖/大綱/大綱+心智圖並排，大綱用 Phase A outline 模組補完：Tab/Enter/Shift+Tab 可編輯、雙向同步、雙擊跳圖）。
- 小地圖：右下 toggle，縮圖+紅色視野框拖曳導航，overlay hook 實作。

## 工作流 DELTA — 節點附加物 + 匯出匯入（第二輪）

**擁有**：js/editor/relations.js[新]、summary.js[新]、attachments.js[新：備註/連結/圖片/圖示]、floating.js[新]、findreplace.js[新]、js/io/export.js、js/io/import.js、contextmenu.js、js/editor/shortcuthelp.js[新]

- 關聯線（SPEC §6）：F4/按鈕→點目標→虛線貝茲曲線；選中出現**黃色控制點**(2個)拖曳調弧度+端點可重新吸附節點；Space 或雙擊加線上標籤；Delete 刪除；樣式面板連動(色/線型/寬)。
- 概要：選同父連續同級→右側大括弧+概要節點；拖曳黃色邊界調範圍；Delete 移除。
- 備註：⊕插入選單+Ctrl+Alt+M；節點尾部 📄 圖示；右側備註編輯欄。
- 連結：Ctrl+Alt+K 彈窗(網址+顯示文字)；貼上 URL 自動轉連結；hover tooltip；右鍵移除。
- 圖片：Alt+P 上傳/拖放/貼上→base64；選中拖角縮放；節點內圖上文下。
- 圖示：Icon 分頁+Alt+I：優先順序(數字彩色圓標1-9,原創SVG)、進度(圓餅8檔,原創SVG)、旗幟(6色)、表情/符號(系統emoji)；同類互斥、再點移除；`Ctrl+1..9`=優先順序。
- 懸浮節點：Shift+Alt+F/畫布右鍵；自由拖放，可拖掛回樹。
- 格式刷：Ctrl+G/按鈕，單次套用後自動退出，游標變化。
- 尋找&取代：Ctrl+F 浮窗，上一個/下一個高亮跳轉+取代/全部取代。
- 匯出（SPEC §9）：彈窗 6 格式卡片（JPG/PNG(透明可選)/PDF(列印)/WORD(.doc 大綱)/TXT(縮排)/MINDFLOW(.json)）；PNG/JPG 用 SVG serialize→canvas（HTML 節點需繪入：可改為匯出時以純 SVG 重繪整圖）；HD 邊距80/比例200%。
- 匯入：.mindflow.json、.txt/.md 縮排大綱→樹。
- 右鍵選單補完（SPEC §2 節點/畫布兩式）+ 快捷鍵說明面板（`···`→快速鍵，表格彈窗）。
