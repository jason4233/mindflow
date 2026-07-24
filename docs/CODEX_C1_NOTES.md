# CODEX C1 交付筆記

## 完成範圍

- REVIEW_D #4：Style 面板維持只送實際變更欄位；C1 覆寫 `setLineStyle` action，只有使用者明確改 shape 才寫 override，且等於主題 shape 時移除 metadata。瀏覽器驗證 `monochrome-outline → 只改 dotted → classic-blue` 後 token 不含 `shape=`，面板回到 `curved`。
- #9：節點左右 resize handle，寬度限制 60–500px；多選時批次套用同一寬度，command 可 undo。寬度存於 `lineStyle` metadata，避免 model 的 legacy shape migration 清除資料；reload 後保留。
- #10：右下控制群動態加入手形工具。開啟後左鍵拖任意節點只平移、不變更選取；Space 暫時平移亦可用。
- #11：Style「結構」與方向改接 `setStructure`，只寫選中節點的局部 structure，不再改全域 layout。
- #12：間距範圍改為「所有節點／僅選取子樹」。子樹值以 metadata 持久化，render 前只縮放該子樹座標；全域 `doc.canvas.spacingH/V` 不被修改。
- #13：Theme 分頁加入自訂區，可把目前文件樣式存為 custom theme、套用及刪除；資料存 localStorage。
- #14：推薦與自訂卡皆有可見的「設為預設」按鈕；新建空白文件套用預設 theme。刪除預設 custom theme 時，raw default key 與文件都回退 `classic-blue`。
- #16：選取概要時 Style 面板切換為概要專用線色、線型、填色控制；command 可 undo，DOM bracket/label 與存檔同步。
- 演示模式：`initPresentation(ctx)`、`presentation` action、全螢幕深色畫布、根節點起始、依一級分支子樹播放、click/→/←、進度點、右鍵「從當前節點開始／跳到結尾／退出」、Esc 退出及 viewport 還原。
- 專注模式：`initFocus(ctx)`、`focus`/`focusMode` action、只留畫布與右下退出鈕、Esc 退出。
- `main.js` C1 標記區已預掛 `initPresentation/initFocus/initHistory/initFormula/initSplitscreen`，另接上節點寬度量測、子樹間距與新文件預設主題 hook。

## 檔案

- 修改：`js/editor/sidepanel.js`、`themes.js`、`viewport.js`、`dnd.js`、`main.js`
- 新增：`js/editor/presentation.js`、`focus.js`
- 修改：`css/editor.css`、`features.css`
- 新增：`css/presentation.css`

## 驗證

- 既有測試：`core 22/22`、`delta 13/13`、`io 13/13`、`layout 7/7`、`store-search 9/9`，合計 64/64。
- C1 補測：先確認缺少 C1 API 的 RED，再以臨時 Node 行為 suite 驗證 metadata、寬度量測與批次 undo、子樹間距、線形跟隨主題、概要樣式 undo、custom/default theme、serialize/deserialize、演示步驟順序。任務書明定 `tests/` 歸 FIX3，因此未落盤修改測試檔。
- Playwright 真實瀏覽器：
  - 手形拖節點：world transform 改變，selected id 不變。
  - 多選寬度：兩節點 86px → 178px，reload 後皆 178px。
  - 局部 org：全域仍 `mindmap-both`；reload 後 structure 仍在。
  - 子樹 spacingV=60：`doc.canvas.spacingV` 保持 30，無關分支座標不變。
  - 概要樣式持久化為 `dashed/#cc3344/#ffeeaa`，實際 DOM stroke/dash/fill 同步。
  - custom theme 建立、設預設、新文件套用、刪除與 fallback 全部通過。
  - 專注模式 chrome 隱藏／Esc 還原通過。
  - 演示模式 5 步、下一步／上一步、from-current、跳結尾、右鍵退出與 Esc 退出通過；canvas 高度 900px。
  - Browser console：0 errors、0 warnings；靜態請求成功。

未執行 commit 或其他 git 寫入操作。
