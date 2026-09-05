# 第三輪複審任務書 — 孤兒 keyup 派發改為不 preventDefault

這是非互動模式：絕對禁止詢問確認、禁止等待回覆——立刻動手直到完成。

## 背景

第二輪已「有條件通過」且條件補齊、已推送為 v1.0.15。作者在**真機安裝版**實按 Ctrl+Alt+M 驗收：備註抽屜正確打開，但發現新副作用——Electron 自動隱藏的預設選單列（File Edit View Window）被翻出來。機制：`handleKeyup` 派發時 `event.preventDefault()` 讓 Electron 收不到這個 keyup（Electron 只收頁面未處理的鍵盤事件，見 `NativeWindowViews::HandleKeyboardEvent` → `RootView::HandleKeyEvent` 的「單獨按 Alt 才切換選單列」邏輯：Alt↓ 之後若沒有其他鍵事件到達 browser 端，Alt↑ 就切換選單列）。修復前 m↑ 未被頁面處理會到達 browser 端重置該狀態，所以舊版不會翻出選單列。

## 本輪變更（`git diff HEAD`）

- `js/editor/keyboard.js` `handleKeyup`：移除 `event.preventDefault()`，改設 `event.mindflowDispatched = true` 旗標。
- `js/editor/shortcuthelp.js`：診斷面板「已派發」標記改看 `defaultPrevented || mindflowDispatched`。
- `tests/core.test.mjs`：斷言 keyup 不得 `defaultPrevented`、旗標為 true。

## 你要做的事（審查者，不得修改非報告檔案）

1. 驗證推論：keyup 在瀏覽器／Electron 有沒有任何需要 `preventDefault` 抑制的預設行為？IME pending 路徑（`resolveImeFallbackBinding` 命中時）同樣不再 preventDefault，有無回歸？
2. 對照 Electron 原始碼／文件確認「頁面已處理的鍵盤事件不會進入 `HandleKeyboardEvent`」與 `RootView` 的 Alt 切換邏輯，判斷此修法是否根治、有無更好做法（例如 `Menu.setApplicationMenu(null)`——請評估但注意本輪只審此最小變更）。
3. 跑 `node tests/core.test.mjs`、`node --test tests/*.test.mjs`、`cd desktop && npm test`。**不要跑**矩陣（作者正在跑）。
4. 追加到 `docs/CODEX_REVIEW_ORPHAN_KEYUP.md` 末尾，標題 `## Codex 複審（第三輪：keyup 不 preventDefault）`：發現（標級別）、自首、簽字結論。
5. 不要 git 操作。
