# 右鍵拖曳圈選實作記錄

## 1. 變更內容

- `js/editor/selection.js`
  - 新增三個純函式供單元測試：
    - `shouldStartSelectionFrame`
    - `getSelectionFrameRect`
    - `isRectInSelectionFrame`
  - 新增門檻函式 `hasFrameDragExceeded`，使用 `FRAME_DRAG_THRESHOLD = 4`。
  - `startFrame` 接受右鍵 (`button:2`) 的空白框選流程，保留原本 `Ctrl/Meta + 左鍵` 邏輯。
  - 右鍵拖曳超過門檻才會套用 `selectInsideFrame`；低於門檻則視為單擊，不改選取。
  - 右鍵在節點上（含 `.mind-node` / `button`）不會起框，保留既有右鍵選單行為。
  - 透過 `markFrameContextMenuSuppressedUntilMouseUp` 記錄一次性的右鍵框選抑制旗標；由 `consumeFrameContextMenuSuppression` 在 contextmenu 發生時一次性消費。
  - 影像節點（`.mind-node--has-image`）仍保留既有 DOM rect 補判流程，並用純函式 `isRectInSelectionFrame`。
- `js/editor/contextmenu.js`
  - 引入 `consumeFrameContextMenuSuppression`。
  - 在 document `contextmenu` handler 最前面檢查該旗標，若為本次框選結果則直接忽略這次 contextmenu。
- `js/editor/viewport.js`
  - 明確限制 `handlePointerDown` 僅處理左鍵，避免右鍵路徑干擾。
- `tests/selection-frame.test.mjs`
  - 新增純函式單測，覆蓋：
    - 右鍵空白起框
    - 右鍵在節點上不起框
    - Ctrl + 左鍵起框
    - 純左鍵不起框
    - 拖曳未超過門檻不套用
    - 框內命中判定

## 2. 事件順序設計

- `canvas pointerdown`
  - 用 `shouldStartSelectionFrame` 判定是否啟動框選（右鍵空白 or Ctrl/Meta+左鍵，且非 pan mode、非節點/按鈕）。
  - 啟動後保存 frame 狀態、顯示 `#selection-rectangle`。
- `window pointermove`
  - 左鍵：持續套用 `selectInsideFrame`。
  - 右鍵：未超過 4px 先不改選取；超過後才套用 `selectInsideFrame`。
- `window pointerup / pointercancel`
  - 超過門檻才套用一次收斂選取，並在右鍵完成時標記 contextmenu 抑制一次。
  - 未超過門檻的右鍵視為單擊：清除 frame 並不改選取，不抑制 contextmenu。
  - 移除 pointer listeners，隱藏選框。
- `document contextmenu`
  - 先呼叫 `consumeFrameContextMenuSuppression()`。
  - 若為剛完成框選放開事件，返回（防開選單）。
  - 否則照舊打開節點／畫布右鍵選單。

## 3. 測試結果

- `node --test tests/*.test.mjs`
  - `core.test.mjs`：`37/37` PASS
  - `cursor-data-uri.test.mjs`：`5/5` PASS
  - `delta.test.mjs`：`21/21` PASS
  - `io.test.mjs`：`21/21` PASS
  - `layout.test.mjs`：`7/7` PASS
  - `touch.test.mjs`：`5/5` PASS
  - `spatial-navigation.test.mjs`：`13/13` PASS
  - `selection-frame.test.mjs`：`6/6` PASS
  - `store-search.test.mjs`：`9/9` PASS
  - 總計 `24/24` 個 node:test 單元測試 pass。
- E2E：`node tests/e2e/shortcuts.matrix.mjs --project=chromium --filter='右鍵'`
  - `2/2` PASS（右鍵拖曳圈選、右鍵單擊）

## 4. 自首節（未驗到的風險）

- 尚未新增觸控筆/多點輸入的針對性覆蓋；目前假設與滑鼠行為一致時不影響，但未驗證筆尖 hover/press 的微妙時間序差異。
- `contextmenu` 阻擋使用的是時間窗 + 一次性旗標，雖預期在 250ms 內生效；極端情境下若右鍵流程超過該時間未觸發 `contextmenu`，下一次正常右鍵可能仍被誤判，風險需在實機追蹤。
- `pointercancel` 目前採保守策略：右鍵取消時不進一步套用框選結果，但尚未有 E2E 對此路徑建立硬性回歸測試。

---

## Claude 審查（2026-09-15）

- 獨立重跑：`--filter='右鍵'` Chromium 2/2 PASS；`node --test tests/*.test.mjs` 24/24（含新增 selection-frame 6 案）。
- diff 審閱：`shouldStartSelectionFrame` 純函數化、右鍵 4px 門檻、超門檻才 `selectInsideFrame` 並以一次性旗標抑制緊接的 contextmenu、`viewport.handlePointerDown` 明確只處理左鍵（原本 `shouldPan` 已要求 button 0，無行為變更）、Ctrl+左鍵框選路徑保留。原 `distance<3 → clear()` 分支在左鍵框選下本就不可達（起框需 Ctrl），移除無回歸。
- Nit：`markFrameContextMenuSuppressedUntilMouseUp` 實為 250ms 時間窗 + 消費式旗標，命名誤導；風險已於自首節揭露（極端情況下 250ms 內的下一次正常右鍵可能被吞），可接受。

## 2026-09-15 紅隊審查後的修正（Claude）

上述 250ms 時間窗已移除，改為布林旗標：`suppressNextContextMenu()`（門檻一超過即設）／`consumeContextMenuSuppression()`（contextmenu 消費一次即清，並 `preventDefault` 擋原生選單）／`clearContextMenuSuppression()`（下一次按下、pointercancel 清除）。另：起框時把焦點拉回畫布（面板控制項／編輯中）、`onControl`（小地圖／縮放列／文字工具列／表單控制項）不起框、所有 overlay 把手加 `button !== 0`。完整清單見 `docs/REVIEW_2026-09-15_BATCH.md`。
- 限制聲明：computer-use 沒有右鍵拖曳能力，真機驗收以 E2E（Playwright 真實滑鼠事件，Chromium + Electron 專案）為證據。

**Claude 簽字：通過。**
