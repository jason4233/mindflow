# CODEX GAMMA NOTES

日期：2026-07-23

## 完成項目

- `layout.js` 改為純函數遞迴佈局核心，支援：
  - 心智圖雙向平衡：`mindmap` / `mindmap-both`
  - 邏輯結構圖：`logic-right` / `mindmap-right`、`logic-left` / `mindmap-left`
  - 組織圖向下：`org`
  - 目錄縮排樹：`tree` / `tree-right`（相容既有 `tree-left`）
  - 時間軸：`timeline-h`、`timeline-v`
  - 魚骨圖：`fishbone`
- 子樹會讀取 `node.style.structure` 作為局部結構覆蓋；父層與其他分支不受影響。
- 佈局讀取 `offsetX/offsetY/manualX/manualY/manualOffset`，`tidyLayout` 會清除手動偏移並重新 fit。
- `render.js`：
  - 節點換位使用 300ms CSS `left/top` transition。
  - `org` 使用 elbow、`tree` 使用直角、`fishbone` 使用斜骨路徑。
  - 保留既有 overlay hook，並提供純函數 `getConnectionPath()` 測試特殊路徑。
- `viewmode.js`：
  - 在既有 Layout 分頁佔位容器掛載 mini-SVG 佈局網格，未修改 `sidepanel.js`。
  - 註冊 `setLayout`、`tidyLayout`、`setStructure`、`toggleOutline`、`setViewMode`、`toggleMinimap` actions。
  - 右下三模式：心智圖／大綱／大綱＋心智圖並排。
- `outline.js`：
  - 與心智圖共用 Doc model，所有異動走 command。
  - `Tab` 新增下級、`Enter` 新增同級、`Shift+Tab` 減少縮排、`Shift+Enter` 保留換行。
  - 文字編輯同步清理過期 richText；地圖異動會透過 render overlay 即時刷新大綱。
  - 雙擊大綱節點會切到並排並置中該節點。
- `minimap.js`：
  - 右下 toggle、縮圖節點/連線、紅色視野框。
  - 紅框可拖曳；點擊縮圖可置中對應世界座標。
  - 縮圖更新走 `registerOverlay()`，視野框透過 viewport subscriber 即時更新。
- `viewport.js` 新增 `setPan()`、`setView()`、`getVisibleWorldRect()`、`subscribe()`，供小地圖導航使用。
- 新增 `css/layouts.css`，由 GAMMA init 動態載入；未修改 `editor.html`。

## 持久化相容處理

`model.js` 不在 GAMMA 所有權內，而且目前白名單尚未包含 `timeline-v` 與 `style.structure`。為避免碰並行檔案，GAMMA 以 `mindflow.gamma.<docId>` localStorage 保存全域 layout 與局部 structure，載入編輯器時再套回 Doc；瀏覽器 reload 已驗證可恢復。既有合法 layout 仍照原本文件儲存流程保存。

## 測試

Node 全套：58/58 通過。

- `core.test.mjs`：22/22
- `delta.test.mjs`：9/9
- `io.test.mjs`：11/11
- `layout.test.mjs`：7/7
- `store-search.test.mjs`：9/9

GAMMA layout 測試覆蓋：所有方向變體無節點重疊、輸入 Doc 不變、mindmap/logic/org/tree 方位、局部 structure、timeline-h/v 順序與交錯、fishbone 主骨座標、三種特殊連接線、mini-SVG 無點陣資源。

## 瀏覽器自測

Playwright headed，1440×1000，console 0 errors / 0 warnings：

- 8 個 layout 卡逐一切換成功，最後回到心智圖。
- `Ctrl+Shift+L` action 可執行並 fit。
- 局部 Structure `org → 跟隨全域` 可切換。
- 小地圖 toggle 正常；拖曳紅框後 world transform 從 `translate(65.3684px, 482.632px)` 變為 `translate(216.474px, 381.895px)`。
- 大綱模式執行 Tab、Enter、Shift+Tab，節點數 5 → 7，階層為 level 2/3 正確。
- 雙擊大綱節點成功跳到心智圖＋大綱並排。
- reload 後並排模式、小地圖開啟狀態、7 節點大綱均恢復。

## 偏離／限制

- 因本輪明確禁止修改 `sidepanel.js`，Layout UI 由 `viewmode.js` 掛入既有佔位 DOM；功能相同但組裝位置不同於舊 brief。
- `timeline-v` 與局部 structure 目前由 GAMMA localStorage 補充持久化，不會進入現有原生 JSON schema；若之後統一 schema，應由擁有 `model.js` 的工作流把兩欄納入 normalize/serialize 白名單，再移除相容層。
- 未修改任何明確禁止檔案，未執行 git。
