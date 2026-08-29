# DBLCLICK：雙擊空白畫布新增懸浮節點

## 結果

在心智圖畫布的空白處雙擊滑鼠左鍵，會以該次事件的螢幕座標呼叫既有 `viewport.screenToWorld()`，換算 pan / zoom 後的世界座標，再透過 `createFloatingNodeCommand()` 建立可 undo 的懸浮節點。建立完成後立即選取新節點，並以 `ctx.edit.start(nodeId, '')` 進入空字串文字編輯。

空白判定採基礎層 allowlist：事件 target 只有在 `canvas`、`world`、`nodesLayer` 或 `svgLayer` 本身時才接受。節點、一般分支線、relation、summary、selection / drop overlay 與畫布內 UI 都是上述層的子元素，因此不會誤建懸浮節點。

## 互動邊界

- 節點既有 `dblclick → EditController.start()` 未修改。
- 手形工具不列入禁用條件；空白雙擊仍會新增節點。
- 只新增 `dblclick` listener，未改 `pointerdown / pointermove / pointerup`，框選與平移流程不變。
- `.editor-shell[data-view-mode="outline"]` 與 `.is-presentation-mode` 直接拒絕；split 模式仍保留心智圖畫布行為。
- 新節點使用明確空字串；一般 `floatingNode` action 未傳文字時仍沿用「懸浮主題」。

## TDD 與驗證

先在 `tests/delta.test.mjs` 寫行為案例。RED 時 4 個案例皆因 canvas 尚未註冊 `dblclick` listener 而失敗；實作後 GREEN。

新增覆蓋：

- hand tool + pan / zoom 座標換算、空文字 seed、直接編輯與 undo。
- 空白基礎層接受；relation、summary、UI 與非左鍵拒絕。
- 節點雙擊不誤建。
- 大綱模式與演示模式不觸發。

最終驗證：

- `node --check js\editor\floating.js`：exit 0。
- `node --check tests\delta.test.mjs`：exit 0。
- `node tests\delta.test.mjs`：21/21。
- `node --test`：35/35，0 fail。

## 主動自首

1. 第一次 RED 同時發現既存貼紙斷言仍期待 36 張，但 STICKER2 當前 manifest 與新 `tests/stickers.test.mjs` 已明定 10 類、每類 12 張、共 120 張。為完成全套綠，只在本輪獲准修改的 `tests/delta.test.mjs` 將舊斷言同步為 120；沒有修改 STICKER2 的 production 檔。
2. 第一次全套測試是 34/35；唯一失敗是 STICKER2 測試要求 `attachments.calculateImageResize`，當時並行 production 檔尚未落盤。我只做唯讀監看；該流自行落盤後重跑為 35/35。
3. 我沒有修改 `viewport.js`；最小掛接直接放在 `initializeFloatingFeatures()`，避免擴大 ownership。
4. 我沒有修改 `keyboard.js`、`edit.js`、`iconpanel.js`、`attachments.js` 或 `css/features.css`。
5. `tests/e2e/shortcuts.matrix.mjs` 是會改寫報告的獨立矩陣，不屬 `node --test` 套件，本輪未執行。
6. 我沒有執行任何 git 指令。

## 主 session 簽字（2026-08-29）：實測空白雙擊建節點+即編輯 ✅、UI 元素上雙擊正確拒絕 ✅、delta 測試 21/21。✍️ 雙簽通過。
