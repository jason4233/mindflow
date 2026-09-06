# 審查任務書 — 雙擊空白畫布新建節點：自動存檔踢掉編輯狀態

這是非互動模式：絕對禁止詢問確認、禁止等待回覆——立刻動手直到完成。

## 角色

**Claude 是作者、Codex 是審查者。** 你只做審查、跑測試、寫報告；**不得修改任何非報告檔案**。發現問題寫進報告。

## 症狀與根因（作者用真瀏覽器實測，非推論）

晨睿回報「雙擊空白處開新節點還是沒修好」。單元測試（tests/delta.test.mjs 四案）全綠，但 E2E 矩陣**從未覆蓋**此互動。

真 Chrome 重現（Playwright 真滑鼠 dblclick）：節點**有建立**（5→6），但 `contenteditable` 在 50ms 時為 true、800ms 時變 false。MutationObserver + focus 記錄顯示：`+0ms focusin` → `+6ms contenteditable=true` → **`+506ms focusout` → `+515ms contenteditable=false`**。

500ms 正是 `js/editor/main.js` `scheduleSave()` 的 debounce。`saveNow()` 開頭原本無條件 `edit.commit()`，而 `commit()` 會 `cleanup()`（contenteditable=false + 移除 listener + 收工具列），等於**把使用者踢出輸入狀態**。雙擊建的是空文字節點，使用者還沒打字就被踢出 → 畫面上只剩一個空節點，看起來像「沒反應」。同一根因也影響所有新建節點（Tab/Enter）與「打字停頓超過 500ms」。

## 本輪修法（`git diff`）

1. `js/editor/edit.js` 新增 `getLiveEdit()`：讀出進行中編輯的即時文字，**不** cleanup、不結束 session；`finishing` 中回 null。
2. `js/editor/main.js`：
   - `saveNow(force)` 只有 `force`（關窗／強制存檔）才 `edit.commit()`。
   - 新增 `applyLiveEditToDoc()`：把即時文字**暫時**寫進 doc 供 `saveDocument` 快照，回傳還原函式；不進 undo 堆疊、不觸發重繪。
   - `!dirty` 早退改為 `!dirty && !restoreLiveEdit`：進行中編輯雖未 commit 成 command，這一頁確有較新內容，仍要落盤以維持崩潰安全。
   - 還原放在 `finally` 與 preview 早退路徑（衝突分支會提前 return）。
3. 測試：`tests/core.test.mjs` 加 `getLiveEdit` 契約測試；`tests/e2e/shortcuts.matrix.mjs` 加三案（雙擊空白建節點且 1.2 秒後仍在編輯／輸入中停頓 900ms 仍在編輯且文字完整落盤／雙擊既有節點不誤建懸浮節點），harness 加 `dblclickBlankCanvas()`（會先斷言該點 elementFromPoint 是基礎層）。

## 重點攻擊面（請逐項驗證並給結論）

1. **undo 正確性**：暫時寫入 doc 期間若發生任何再入（saveDocument 內部、CustomEvent、例外）會不會讓還原漏掉，導致 doc 留著未 commit 文字、後續 `commitTextEdit` 的 undo 記錄到錯的 previous 值？
2. **崩潰安全是否真的沒退步**：原本靠 commit→command→dirty→存檔；現在靠快照。列出所有「文字已輸入但不會被存下」的窗口（含 preview 進行中、saveBlocked、CAS 衝突、`!dirty` 分支、force 路徑）。
3. **多分頁／多實例**：`!dirty` 但有 live edit 就落盤，會不會讓「乾淨的舊分頁」在使用者只是點進節點卻沒改字時覆寫較新內容？（注意 `changed` 旗標與 CAS `expectedUpdatedAt`）
4. **同步（Stage A）互動**：sync 引擎會讀 localStorage 快照；快照含未 commit 文字會不會與 3-way merge 或 `lastSyncedCommitSha` 產生非預期行為？
5. **關窗路徑**：`beforeunload`／`pagehide`／Electron 關窗 flush 是否都走 `force=true`？若有路徑用 `saveNow()` 無參數，關窗時進行中的文字是否仍保住？
6. 其他：`getLiveEdit` 對 rich text（innerHTML 粗體等）只取 innerText，快照會不會丟格式而在崩潰還原後降級？是否可接受、要不要記為已知限制。

## 你要做的事

1. 逐項攻擊上述 6 點，能重現就寫重現步驟與實測數字。
2. 跑 `node tests/core.test.mjs`、`node --test tests/*.test.mjs`、`cd desktop && npm test`。**不要跑** `tests/e2e/shortcuts.matrix.mjs`（作者正在跑，會撞報告檔）。
3. 寫 `docs/CODEX_REVIEW_DBLCLICK.md`：每條發現標 **Blocker／Major／Minor／Nit** + 檔案行號 + 重現 + 建議修法；最後 **自首**節（沒驗到的、不確定的）與 **簽字結論：通過／有條件通過／退回**。
4. 不要 git 操作。
