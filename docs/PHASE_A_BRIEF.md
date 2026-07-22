# Phase A 任務書 — 核心編輯器引擎

> 執行者：Codex（gpt-5.6-sol, xhigh）。先讀 `docs/ARCHITECTURE.md`，完全遵守其目錄結構、資料模型、不變式與編碼規範。
> 本階段目標：一個**可用的心智圖編輯器核心**。UI 外觀先做乾淨的基礎版（淺色 chrome），像素級對齊 GitMind 的細節由 Phase B/C 依研究報告調整，但**佈局骨架**（頂部工具列、右側面板容器、右下角縮放控制）現在就要放好。

## A-1 檔案骨架

按 ARCHITECTURE.md 目錄結構建立所有檔案（Phase A 未實作的模組留 stub + 中文 TODO 註解）。

## A-2 首頁儀表板（最小版）

- `index.html`：標題列（產品名 MindFlow）+「新建心智圖」按鈕 + 文件卡片格狀列表（標題、更新時間、開啟/重新命名/刪除）。
- `store.js`：localStorage 文件庫。key `mindflow.docs.index`（id 列表與 meta）、`mindflow.doc.<id>`（完整 Doc JSON）。
- 新建文件 → 建立預設 Doc（根節點文字「中心主題」+ 4 個子節點「分支主題」）→ 跳轉 `editor.html?id=<id>`。

## A-3 編輯器版面骨架

- 頂部工具列（高約 48px，白底、底部 1px 分隔線）：左側「返回首頁」箭頭、文件標題（可點擊改名）、undo/redo 按鈕；中間預留節點操作按鈕區（插入子節點/同級節點按鈕，Phase A 就要能用）；右側預留（主題、匯出等 Phase B）。
- 右側面板容器：可收合，Phase A 顯示「樣式」空面板骨架。
- 右下角浮動控制列：縮放百分比顯示、+/−、「適應畫布」(fit) 按鈕。
- 中央畫布：滿版，淺灰白背景 `#f5f5f5` 左右。

## A-4 資料模型與命令（model.js / commands.js）

照 ARCHITECTURE.md schema。必備 commands：
`addChild(parentId, index?)`, `addSiblingAfter(nodeId)`, `addSiblingBefore(nodeId)`, `deleteNodes(ids)`（整棵子樹）, `updateText(id, text)`, `moveNode(id, newParentId, index, side?)`, `toggleCollapse(id)`, `setStyle(ids, patch)`。
undo/redo 各自 stack，上限 100 步。文件變更後 debounce 500ms 自動存 localStorage。

## A-5 佈局引擎（layout.js）

- Phase A 實作 `mindmap-right`（邏輯圖：根在左、子樹向右展開）與 `mindmap-both`（經典心智圖：根在中央，子節點依 `side` 分左右；新增時自動平衡——哪邊子樹總高度小放哪邊）。預設 `mindmap-both`。
- 演算法：後序遍歷計算子樹包圍盒高度；父節點垂直置中於其子群；水平間距 40px、垂直間距 12px（同層兄弟）/ 24px（子樹之間）；摺疊的子樹不佔空間。
- 文字尺寸用隱藏測量 div（同字體樣式）量測；節點寬度 = 文字寬 + padding，上限 250px 後自動換行。

## A-6 渲染（render.js + node.css）

- transform 容器（`translate(panX,panY) scale(zoom)`）內：SVG 連線層在下、節點 div 層在上。
- 連線：三次貝茲曲線，從父節點右（或左）邊緣中點連到子節點近側邊緣中點，控制點水平外推 —— 視覺與 GitMind 的平滑弧線一致。
- 節點層級視覺（預設主題「經典藍」）：
  - 根節點：圓角矩形（radius 8px）、深藍底 `#3f89de`、白字 16px、粗體、padding 12×20。
  - 二級節點：圓角矩形、白底、深灰字 14px、細邊框、padding 8×14。
  - 三級以下：無底色、深灰字 13px、文字下方一條分支色底線（underline 形態）。
  - 主題物件驅動（themes.js 定義 `classic-blue`，含 branchPalette 供之後彩虹分支）。
- 摺疊節點在外側顯示小圓圈「+N」（N=隱藏後代數），點擊展開；hover 有展開/摺疊小按鈕。

## A-7 互動

- **選取**（selection.js）：點節點單選（藍色 2px 外框 + 四角 handle 視覺）；Ctrl+點多選；點空白清除；框選（左鍵在空白處按下拖出半透明藍色矩形）→ 因此**畫布平移改用：右鍵拖曳或按住 Space+左鍵拖曳**。
- **編輯**（edit.js)：雙擊節點或選取後按 F2 / 直接輸入字元 → contenteditable 編輯；Enter 或點外部確認；Esc 取消還原；編輯中 Shift+Enter 換行。
- **鍵盤**（keyboard.js，唯一入口，action 表驅動）：
  - Tab / Insert：插入子節點；Enter：插入同級（下方）；Shift+Enter（非編輯中）：同級上方
  - Delete / Backspace：刪除選取節點（子樹）
  - F2：編輯；Esc：取消選取
  - 方向鍵：朝該方向移動選取（左右沿父子關係、上下沿視覺相鄰）
  - Ctrl+Z / Ctrl+Y（及 Ctrl+Shift+Z）：undo/redo
  - Ctrl+C/X/V：複製/剪下/貼上子樹（app 內部剪貼簿；Ctrl+V 貼為選取節點的子節點）
  - Ctrl+A：全選節點；Ctrl+S：立即存檔（阻止瀏覽器預設）
  - Ctrl+= / Ctrl+-：縮放；Ctrl+0：回 100%；Ctrl+Shift+F：適應畫布
  - Space+拖曳：平移畫布
- **拖曳重掛**（dnd.js）：拖動節點 → 半透明 ghost 跟隨；懸停於潛在父節點時該節點高亮並顯示插入位置指示線；放下 = moveNode command；拖到根另一側可換 side。
- **視口**（viewport.js）：滾輪=垂直平移、Shift+滾輪=水平平移、Ctrl+滾輪=以游標為中心縮放（20%–400%）；右下角控制列同步顯示；fit = 置中並縮放至內容全部可見（留 60px 邊距）。

## A-8 完成定義（我會逐條實測）

1. 新建文件 → 出現中心主題+4分支，畫布置中。
2. Tab/Enter/Delete/F2/方向鍵/Ctrl+Z/Y 全部照上表工作，連按 20 次 undo/redo 不壞。
3. 拖曳節點可換父、換順序、換左右側，有視覺指示。
4. 摺疊/展開正確，佈局即時重排，無節點重疊。
5. 縮放平移流暢（100+ 節點不卡），fit 正確。
6. 重新整理頁面後文件還在（自動存檔）。
7. 無 console error。

## 交付

完成後把實作摘要與偏離事項寫進 `docs/CODEX_A_NOTES.md`。不要 commit（不是 git repo）。
