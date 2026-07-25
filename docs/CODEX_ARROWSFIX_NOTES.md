# ARROWS-FIX 交付紀錄

## 完成項目

### 2.1 演示模式方向鍵

- 演示 active 時 consume `↑`、`↓`、`←`、`→`，並呼叫 `preventDefault()` 與 `stopImmediatePropagation()`。
- `↑` / `←` 為上一步；`↓` / `→` 為下一步。
- 測試驗證四個方向鍵不會再送到後續全域 keyboard handler。

### 2.6 純大綱模式方向鍵

- `canvas.hidden === true` 時，`KeyboardController` 對所有 Arrow key 直接 no-op，不 consume 瀏覽器事件，也不執行 map shortcut。
- `SelectionManager.navigate()` 同步加入隱藏 map guard，避免其他 action 直接呼叫時改動 selection。
- split 與 map 模式的 canvas 未隱藏，既有空間導覽維持不變。

### 已採認限制

- 新增 `docs/KNOWN_LIMITS.md`，記錄 2.2、2.3、2.4、2.5 的行為與觸發條件。

## 修改檔案

- `js/editor/presentation.js`
- `js/editor/keyboard.js`
- `js/editor/selection.js`
- `tests/spatial-navigation.test.mjs`
- `docs/KNOWN_LIMITS.md`
- `docs/CODEX_ARROWSFIX_NOTES.md`

`js/editor/viewmode.js` 不需修改；既有 `canvas.hidden` 已能精確表示純大綱模式。

## 驗證

- `node tests\spatial-navigation.test.mjs`：13/13 通過。
- `node --test <tests\*.test.mjs 全部檔案>`：6 個 test file、86/86 案例通過。
- 未執行 git。
