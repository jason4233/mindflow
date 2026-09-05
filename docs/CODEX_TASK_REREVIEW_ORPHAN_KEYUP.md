# 複審任務書 — 孤兒 keyup 救援第二版

這是非互動模式：絕對禁止詢問確認、禁止等待回覆——立刻動手直到完成。

## 角色

你是審查者（第二輪）。作者已依你的第一輪報告修訂，回應在 `docs/CODEX_REVIEW_ORPHAN_KEYUP.md` 末尾「作者回應」一節。你只做審查、跑測試、寫報告；**不得修改任何非報告檔案**。

## 你要做的事

1. 讀 `docs/CODEX_REVIEW_ORPHAN_KEYUP.md` 全文（含作者回應表）。
2. 對第二版 `git diff js/editor/keyboard.js tests/core.test.mjs tests/e2e/shortcuts.matrix.mjs` 逐條驗證你第一輪的 7 個 finding 是否被正確處置：
   - #1 武裝模型：用唯讀探針重現你第一輪的「reset 後直接送 Ctrl+Alt+M keyup」，確認 0 次派發；重按 Ctrl↓ Alt↓ 後 1 次。
   - #2 code 不對稱：重現 `code:''`→`KeyM`、`IntlYen`→`KeyM`，確認各 1 次。
   - #3 AltGr：`getModifierState('AltGraph')` 為 true 時 0 次。
   - #4 `defaultPrevented`：0 次。
   - #5 作者**拒絕**了你的淘汰建議，理由是「先按 Z 再按 Ctrl 放開 Z → 誤 undo」的 fail-unsafe；請正面評估這個理由成不成立，以及殘留 fail-closed + blur/pagehide/visibilitychange 自癒是否可接受。
   - #6、#7 的處置是否合理。
3. 再攻擊一次第二版可能新引入的問題：`heldModifiers` 的殘留（修飾鍵 keyup 沒到、Electron 選單吃掉 Alt keyup）會不會造成長期武裝而放大誤觸面？`trackKeydown` 對每個 keydown 呼叫 `findShortcutBinding` 有無副作用？Shift 武裝未被要求（Shift+Alt+H）是否有風險？
4. 跑 `node tests/core.test.mjs`、`node --test tests/*.test.mjs`、`cd desktop && npm test`。**不要跑** `tests/e2e/shortcuts.matrix.mjs`（作者剛跑完，結果在 `docs/SHORTCUT_MATRIX.md`，可讀）。
5. 把結果**追加**到 `docs/CODEX_REVIEW_ORPHAN_KEYUP.md` 末尾，標題 `## Codex 複審（第二輪）`：逐條 finding 的驗證結果、新發現（若有，標級別）、自首、**簽字結論：通過／有條件通過／退回**。
6. 不要 git 操作。
