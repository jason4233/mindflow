# Codex IME 修復紀錄

## 根因

`keyboard.js` 原本只用 `event.key` 比對快捷鍵。Windows 中文輸入法組字期間，字母／數字實體鍵會送出 `key='Process'`、`keyCode=229`，所以 `Ctrl+Alt+M` 等所有含英數鍵的 binding 都無法命中。

選取節點後直接打字的入口也只接受 `event.key.length === 1`，因此同一個 `Process` 事件不會把焦點移入 `contenteditable`，IME 組字流無處接收。

## 修復

- 每個 `ACTION_BINDINGS` 項目都帶有 key→codes 對照，`matchesBinding` 對對照內的已知實體 `event.code` 採決定性比對；`code` 缺失、`Unidentified` 或為未納入對照的非標準碼（例如 `IntlRo`）時才退回 `event.key`。
- 字母使用 `KeyA`～`KeyZ`；數字同時接受 `Digit0`～`Digit9` 與 `Numpad0`～`Numpad9`；功能鍵、方向鍵與符號鍵也有明確 code。
- 無修飾鍵的 `Process + KeyX/DigitX` 在有選取節點時以空字串 seed 啟動編輯，且不呼叫 `preventDefault()`，讓後續 composition 能進入新取得焦點的 `contenteditable`。
- `EditController.start(id, initialText)` 原本就能正確接受空字串，因此沒有為了湊修改範圍去改 `edit.js`。

## 矩陣

- 每條英數 binding 都重用原本 canonical matrix case 的同一個行為函式，只把目標快捷鍵替換成 `KeyboardEvent(key='Process', code=正確實體鍵, keyCode/which=229, 修飾鍵一致)`。
- 數字 binding 分別掃 `Digit` 與 `Numpad`。
- 另有一格 `Process + KeyM` 驗證直接輸入會以空 seed 進入編輯。
- 報告在 `docs/SHORTCUT_MATRIX.md`，原有矩陣與 IME targeted synthetic 分節呈現。

## 自首與限制

舊矩陣即使全 PASS，也沒有覆蓋 Windows IME 送出的 `Process/229`，所以曾經把「一般鍵盤可用」誤當成「中文輸入模式也可用」。這是測試矩陣的盲點，不是使用者操作問題。

Playwright 無法真實切換 Windows 注音／微軟 IME。新增案例是 targeted synthetic，只能證明應用層對事件欄位的路由與最終行為，不能冒充真實 OS IME E2E。另因 untrusted synthetic keydown 不會觸發瀏覽器 default paste，`Ctrl+V` 案例會在 Process keydown 後補送 synthetic `paste` event，以保留 production 原本的 paste 資料流。

## 驗證結果

- `node tests/core.test.mjs`：26/26 PASS。
- `node tests/e2e/shortcuts.matrix.mjs`：160/160 PASS。
- 其中 IME 模式掃描：54/54 PASS（Chromium 全掃；Electron 執行原矩陣既有標記案例）。

## 主 session 簽字（2026-08-29）：模擬 IME 事件（Process/KeyM/229 + Ctrl+Alt）實測開啟備註抽屜且聚焦；矩陣 160/160；自首（舊矩陣盲點、synthetic 侷限）誠實採認。✍️ 雙簽通過。
