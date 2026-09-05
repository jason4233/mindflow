# 審查任務書 — 孤兒 keyup 救援（Ctrl+Alt+M 備註快捷鍵失效）

這是非互動模式：絕對禁止詢問確認、禁止等待回覆——立刻動手直到完成。

## 角色

本輪 **Claude 是作者、Codex 是審查者**。你只做審查、跑測試、寫報告；**不得修改任何非報告檔案**。發現問題就寫進報告，由作者修。

## 根因（作者已實測，Blocker 級）

晨睿主力機上用鍵盤診斷面板實按 Ctrl+Alt+M，app 收到的事件序列是：`Ctrl↓ Alt↓ m↑ Alt↑ Ctrl↑`——**M 的 keydown 從未到達，只有 keyup**。對照 Ctrl+Alt+N 的 keydown 正常到達。用 PowerShell `RegisterHotKey(MOD_CONTROL|MOD_ALT, 'M')` 探測回 **1409 ERROR_HOTKEY_ALREADY_REGISTERED**（Ctrl+Alt+N / Ctrl+Alt+L 則 FREE）。結論：某常駐程式以 RegisterHotKey 搶註 Ctrl+Alt+M，Windows 把 keydown 轉成 WM_HOTKEY 給它、只把 keyup 送到前景視窗。與 IME 無關（實測時輸入法在英文模式）。

## 修法（`js/editor/keyboard.js`，用 `git diff js/editor/keyboard.js` 看）

1. `trackKeydown`：window **capture** 階段記錄本視窗收到過的 keydown `event.code`（`seenKeydownCodes`）。
2. `handleKeyup`：先 `delete(code)` 得知該 keyup 有沒有對應 keydown；有 IME pending 走原路；否則若 **沒見過 keydown** → `resolveOrphanKeyupBinding(event)` → 通過既有 formMode／hasAction 檢查後派發。
3. `resolveOrphanKeyupBinding`：只救 Ctrl／Alt 和弦；`metaKey` 一律不救；code 必須是 `Key[A-Z]|Digit\d|Numpad\d`；排除 `paste`。
4. `resetKeyState`：window `blur` 時清空記錄與 IME pending。

## 測試（作者已寫，皆綠）

- `tests/core.test.mjs`：新增兩案（控制器層孤兒 keyup 派發／不重複／blur 重置／formMode；純函數排除規則）。`node tests/core.test.mjs` 29/29。
- `tests/e2e/shortcuts.matrix.mjs`：新增「全域熱鍵吞 keydown」一節——所有 Ctrl／Alt 英數和弦以 Playwright 真實 `keyboard.down(修飾鍵) → keyboard.up(字母)`（不送 keydown）重現，另加 Alt+Tab 切回、Win+D 兩個負向案例。作者正在跑完整矩陣（Chrome + Electron），結果在 `docs/SHORTCUT_MATRIX.md`。

## 你要做的事

1. **對抗式審查** `git diff`（keyboard.js、core.test.mjs、shortcuts.matrix.mjs）。重點攻擊：
   - 任何會造成**雙重派發**的路徑（keydown 已派發 + keyup 再派發）？含 IME pending 與 seen 集合的交互、自動重複（auto-repeat）、多鍵同時按。
   - 任何會造成**誤觸**的孤兒 keyup 來源：Alt+Tab／Win+數字／Ctrl+Alt+Del 回來、瀏覽器／Electron 選單加速鍵吃掉 keydown（例如 Electron 預設選單的 Ctrl+M minimize、Ctrl+0、Ctrl+R、F11）、DevTools、原生對話框（confirm／update prompt）關閉後落下的 keyup、焦點在 contenteditable／input 時、Ctrl+Alt 當 AltGr 打字的鍵盤配置（歐洲配置 AltGr+M＝µ）。
   - `seenKeydownCodes` 殘留或漏刪的情境（keydown 到、keyup 沒到；blur 沒觸發的失焦方式）。
   - 派發時機改到 keyup 對 `insertNote`／`insertLink`／`copyStyle`／`pasteStyle`／`fit` 等動作有無語意副作用。
   - Electron 端 `desktop/main.mjs`／preload 有沒有更好的攔截層（`before-input-event`、`globalShortcut`）——請說明為何可行或不可行（提示：keydown 根本沒進 Chromium）。
2. 跑 `node tests/core.test.mjs`、`node --test tests/*.test.mjs`、`cd desktop && npm test`，記錄結果。**不要跑** `tests/e2e/shortcuts.matrix.mjs`（作者正在跑，會撞 docs/SHORTCUT_MATRIX.md）。
3. 寫 `docs/CODEX_REVIEW_ORPHAN_KEYUP.md`：每條發現標 **Blocker／Major／Minor／Nit** 與檔案行號、重現情境、建議修法；最後一節 **自首**（沒驗到的、不確定的）；結尾給 **簽字結論：通過／有條件通過／退回**。
4. 不要 git 操作。
