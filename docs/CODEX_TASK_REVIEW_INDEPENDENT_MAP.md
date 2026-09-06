# 審查任務書 — 雙擊空白畫布＝建立獨立心智圖（兩批改動一起審）

這是非互動模式：絕對禁止詢問確認、禁止等待回覆——立刻動手直到完成。

## 角色

**Claude 是作者、Codex 是審查者。** 只審查、跑測試、寫報告；**不得修改非報告檔案**。

## 背景與根因（作者用真瀏覽器實測，非推論）

晨睿兩次回報。第一次「雙擊空白處新建節點沒作用」，第二次附截圖「現在是建立在原本的心智圖，我要空白處點擊變成新的心智圖」。

**Bug 1（編輯狀態被踢掉）**：雙擊確實建立了節點，但 `contenteditable` 在 **506ms** 被關掉（MutationObserver + focus 實測）。500ms 正是 `main.js scheduleSave()` 的 debounce；`saveNow()` 原本無條件 `edit.commit()`，而 commit 會 `cleanup()`（contenteditable=false、移除 listener），等於把使用者踢出輸入狀態。使用者還沒打字就被踢出 → 只剩一個空節點。

**Bug 2（不是獨立的圖）**：懸浮節點是 `doc.root` 的子節點，只在 render **overlay 事後**把自己搬到自由座標。因此：
- 它的**子樹不會跟著搬**（實測：父在 (200,120)，子節點跑到 (330,493) 掛在原圖底下）
- 它仍**佔用主圖的一個子節點版位**，在原圖留下一條通往空位的連線殘段（晨睿截圖右側那條）
- overlay 用 `connectionPaths[orderedIds.indexOf(id)]` 索引隱藏連線，只要有節點沒有 position 就會錯位

## 本輪改動（`git diff`）

**A. 編輯狀態（Bug 1）**
1. `js/editor/edit.js` 新增 `getLiveEdit()`：讀出進行中文字，**不** cleanup、不結束 session；`finishing` 中回 null。
2. `js/editor/main.js`：`saveNow(force)` 只有 `force`（關窗）才 commit；新增 `applyLiveEditToDoc()` 把即時文字**暫時**寫進 doc 供快照，`finally` 還原（不進 undo 堆疊、不重繪）；`!dirty` 早退改為 `!dirty && !restoreLiveEdit` 以維持崩潰安全。

**B. 獨立心智圖（Bug 2）**
3. `js/editor/model.js`：新增零依賴的 `FLOATING_PREFIX`、`getFloatingMeta`（從 floating.js 搬來，因為 floating.js 反向 import render.js，layout/render 直接 import 會循環）、`isIndependentMap`、`buildMapRootLookup`。
4. `js/editor/layout.js`：`layout()` 把帶懸浮座標的 root 子節點**排除在主樹之外**（`buildMeta(..., excluded)`），再對每張獨立圖用同一套演算法從 **depth 0** 自成一棵樹並整棵平移到它的座標。
5. `js/editor/render.js`：走訪時標記獨立圖子樹 → 這些節點 **depth 減 1**（獨立圖 root 因此渲染成中心主題），且**不建立**「主圖 → 獨立圖 root」的 parentLookup 條目（連線根本不畫，不再靠索引隱藏）。
6. `js/editor/render.js` `applyDocumentSpacing` 與 `js/editor/themes.js` `applyScopedSpacing`：改為**逐圖**以各自 root 為中心縮放（用 `buildMapRootLookup`），否則調整間距會把獨立圖從座標拉走／扭曲。
7. `js/editor/floating.js` overlay 簡化成只加 class 與拖曳；CSS 移除「懸浮」小標籤。

## 重點攻擊面（逐項驗證並給結論）

1. **A 的 undo 正確性**：暫時寫入 doc 期間若 `saveDocument` 內部拋錯／再入，還原會不會漏掉，導致之後 `commitTextEdit` 的 undo 記到錯的 previous 值？列出所有 return 路徑是否都經過 `finally`。
2. **A 的崩潰安全是否退步**：列出「已輸入但不會被存下」的所有窗口（preview 中、saveBlocked、CAS 衝突、force 路徑）。rich text（粗體）只取 innerText，快照還原後會不會降級？
3. **B 的資料相容**：既有文件裡的懸浮節點（含使用者主力機雲端那兩份）載入後會不會位移、消失或重疊主圖？`applyManualOffsets` 對獨立圖是否重複套用？
4. **B 的 depth 改動連鎖**：`branchLookup`、`getLineAppearance`、`getNodeAppearance`、collapse 控制、大綱視圖、匯出（6 種格式）、minimap、關聯線/概要 overlay、演示模式——哪些依賴 depth 或 positions，改動後是否仍正確？特別是**匯出**與**大綱**會不會把獨立圖當成主圖的子節點。
5. **B 的拖曳**：`beginFloatingDrag` 改變 meta 後，整棵子樹是否正確跟隨？拖曳中的即時位移只動 element.style 還是會與新 layout 打架？
6. **邊界**：獨立圖被摺疊（collapsed）、獨立圖節點被 `moveNode` 掛回樹（token 應被清除）、獨立圖 root 被刪除但子樹保留（Ctrl+Delete）、多張獨立圖重疊、獨立圖座標為極端值（NaN/巨大值）。
7. **同步（Stage A）**：doc schema 沒變（仍是 icons token），但 3-way merge 對 icons 陣列的合併會不會在兩台機器各自拖曳後產生兩個 floating token？

## 你要做的事

1. 逐項攻擊，能重現就寫重現步驟與實測數字。
2. 跑 `node tests/core.test.mjs`、`node --test tests/*.test.mjs`、`cd desktop && npm test`。**不要跑** `tests/e2e/shortcuts.matrix.mjs`（作者正在跑）。
3. 寫 `docs/CODEX_REVIEW_INDEPENDENT_MAP.md`：每條發現標 **Blocker／Major／Minor／Nit** + 檔案行號 + 重現 + 建議修法；最後 **自首** 與 **簽字結論：通過／有條件通過／退回**。
4. 不要 git 操作。
