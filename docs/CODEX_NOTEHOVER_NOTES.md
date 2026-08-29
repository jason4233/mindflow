# NOTEHOVER 實作紀錄

## 行為

- 備註圖標停留 180ms 後顯示共用 popover，內容使用 `textContent`，不解析 HTML。
- 圖標移開時取消尚未觸發的預覽；預覽已顯示時允許滑鼠移入卡片閱讀，離開卡片即關閉。
- 點擊圖標仍會選取節點並開啟原備註 drawer。
- Esc、viewport 變更、canvas wheel／pointerdown（含平移與節點拖曳起點）立即關閉。
- 預設顯示在圖標右側，右側空間不足時翻到左側，垂直方向限制於 viewport 邊界。
- 卡片最大寬度 280px、最大高度 200px，多行內容以 line clamp 截斷並顯示省略號。
- 顯示時讀取文件 canvas 背景與 computed background，依相對亮度套用深色卡片。

## 測試

`tests/delta.test.mjs` 新增 fake DOM 行為測試，覆蓋：

- 180ms 延遲與延遲期間移開不閃現。
- 純文字內容、深色背景判定、靠近右緣翻轉。
- 圖標移入 popover 時保持、離開 popover 時隱藏。
- click 編輯 callback 不受影響。
- Esc、viewport 變更與拖曳起點關閉。

## 自首

- 圖標與 popover 間保留 8px 視覺間距，實作以透明 hit-test bridge 連接兩者；移往其他方向會同步隱藏，移向 bridge／popover 則保持。bridge 的可互動區是卡片整段高度，這是為了不用關閉延遲仍能穩定移入卡片的刻意取捨。
- 單元測試使用現有 Node runner 的最小 fake DOM，沒有新增 jsdom 依賴；事件與定位邏輯有驗證，但 Chromium 實際字型下的 line-clamp 像素結果不在此測試範圍。
- 未執行 git 操作。

## 主 session 簽字（2026-08-29）：真實 hover 實測——180ms 後浮出（280x60、內容正確）、移開即消失、delta 測試 17/17。✍️ 雙簽通過。
