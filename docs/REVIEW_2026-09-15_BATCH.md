# 2026-09-15 批次：預備輸入（IME 首字）、右鍵框選、概要方向與範圍

三條使用者回報同一批交付。Codex 額度 2026-09-19 前用罄，審查改由三個獨立的 Claude 紅隊子代理（各自寫 Playwright 重現腳本）代替；Codex 額度回復後再補一輪跨體系審查。

## 流程（晨睿 2026-09-15 規則）

先寫「使用者情境的過關／不過關」測試 → 在舊碼跑出紅燈 → 實作到綠 → 紅隊攻擊 → 修到綠 → 全矩陣。

| 項目 | 測試檔 | 紅燈證據 |
|---|---|---|
| 概要方向 | `tests/summary-orientation.test.mjs`（7）、E2E `概要方向：*`（3） | 舊碼 6/7 紅、E2E 左側／組織圖紅 |
| 概要範圍與同級判定 | `tests/summary-range.test.mjs`（10）、E2E `概要單節點`／`概要不壓子節點（組織圖）`／`概要邊界拖曳：魚骨圖` | 修前 9/10 紅 |
| 把手被平移劫持 | E2E `概要邊界拖曳：直立／橫向`、`關聯線控制點拖曳` | 拿掉 viewport 修正 0/3、加回 3/3 |
| 右鍵框選（審查後補） | `tests/selection-frame.test.mjs`（+3）、E2E `右鍵框選後快捷鍵仍可用`／`右鍵拖出再拉回原點`／`編輯中右鍵框選` | 紅隊腳本 `rt-rightdrag-timing.mjs` 案例 8／3／9 重現 |
| 預備輸入（審查後補） | E2E `Shift+Enter（預備）`／`Shift+Space（預備）`／`Esc 取消後重新預備`／`Enter 提交未改字後重新預備`／`工具列加下級後直接打字`／`End 鍵不改變預備全選` | 紅隊腳本 `rt-armed-shortcuts.mjs`、`rt-armed-followup*.mjs`、`rt-armed-disarm.mjs` 重現 |

## 1. 預備輸入（armed input）— 修「第一個字變英文」

機制：單選節點時文字元素即為 contenteditable＋焦點＋全選（`is-armed`，非 `is-editing`），輸入法從第一鍵就在節點內組字；第一個 `beforeinput`／`compositionstart` 才升格為正式編輯。快捷鍵照常派發。

紅隊發現 → 處理：
- **F1 Major** Shift+Enter 以換行取代全選原文（節點被清空）→ `handleArmedBeforeInput` 白名單加 `insertLineBreak|insertParagraph|format`（Ctrl+B/I/U 在選取狀態維持 no-op，同改動前）。
- **F2 Minor** Shift+Space 以一個空白取代原文 → `insertText(' ')` 視同 Space：升格並把游標放尾端。
- **F3 Major** Esc 取消／沒改字的 Enter 之後不再預備（沒有 render 就沒有 selectionchange），下一個字走回舊路徑 → `EditController.cleanup()` 尾端呼叫 `onSessionEnd`，main.js 接 `syncArmedInput`；畫布重新取得焦點（對話框關閉）也同步一次。
- **F4 Minor** 工具列按鈕新增節點後焦點留在按鈕、打字無效 → `focusIsFree()` 把 `.toolbar-capsule` 內的焦點視為可搶。
- **F6 Minor** Home/End／帶修飾鍵的方向鍵偷偷改掉隱形全選 → 預備狀態下 `preventDefault`。
- 未處理（記錄）：**F7** Windows 高對比模式忽略 `::selection` 顏色，預備節點會整段反白；**F8** 螢幕閱讀器語意；**F9** 演示模式打字仍走舊路徑（改動前相同）；Surface 類「粗指標＋鍵盤」機器整場不預備（`COARSE_POINTER` 只在載入時判一次）。

## 2. 右鍵框選 ＋ overlay 把手

- 右鍵在空白處按住拖曳＝框選（4px 門檻），放開不彈選單；短按仍開選單；Ctrl+左鍵框選不變。
- **把手被平移劫持（新發現的舊 bug）**：`viewport.js` 的平移 listener 掛在 capture 階段、比把手自己的 pointerdown 先跑；畫布跟著指標走、指標世界座標不變 → 概要邊界與關聯線控制點自「空白拖曳＝平移」上線起就拖不動。把手類別（`.summary-boundary .relation-control .relation-endpoint`）與 `.minimap-panel` 列為互動元件。
- 紅隊發現 → 處理：**#1 Major** 焦點在面板控制項時框選後快捷鍵失效／**#7** 編輯中框選不結束編輯 → `startFrame` 把焦點拉回畫布；**#2** 畫布外放開沒擋原生選單 → 消費旗標時 `preventDefault`；**#3/#4/#6** 小地圖／文字工具列上會起框或被平移 → `onControl` 排除；**#8/#9/#10** 250ms 時間窗改為布林旗標（門檻超過即設、消費一次即清、下一次按下清除、pointercancel 不套用不留旗標）；**#5** 所有把手加 `button !== 0` 守衛（右鍵不改文件）。
- 記錄：Ctrl+右鍵不累加選取（設計）；macOS/Linux 的 contextmenu 在 mousedown 觸發，此模型只對 Windows 正確（桌面版只出 win/nsis）。

## 3. 概要方向與範圍

- 幾何抽成 `js/editor/summary-geometry.js` 純函數，畫面與 SVG 匯出共用（原本 export.js 手抄一份）。
- 方向：沿同級排列軸（org／timeline-h／fishbone＝橫向，其餘直立；以 position 的 `connector` 為準，子樹覆寫結構也正確），側邊依 position.side（全 left→左、全 right→右、全 up→上、全 down→下；交錯固定右／下），沒有 side 才比父節點中心。
- 範圍：涵蓋覆蓋節點**整棵子樹**外緣（收合的後代與獨立心智圖不計）；允許**單節點**概要（GitMind 語意）。
- 同級順序一律以畫面位置判定（魚骨圖陣列與畫面相反、父節點覆寫結構後 node.side 失效）；起訖錨點視為無序對，舊文件不會因順序相反而消失。
- 紅隊發現 → 處理：2.1 魚骨圖把手顛倒、2.2 括號壓子節點、2.3 覆寫結構後相鄰判定錯、3.1 目錄樹寬根翻面、3.2 垂直時間軸隨字寬翻面、3.3 懸浮圖被算進 covered、3.4 touch 忽略清單、2.4 `--filter` 覆寫正式報告（改寫到 `.partial.md`，已 gitignore）。
- 未處理（記錄）：GitMind 的「概括 N」自動編號與選取態的橘色範圍框（研究報告 L-01）；`model.js LAYOUTS` 缺 `timeline-v`（靠 viewmode sidecar 還原，直接寫 localStorage 的文件會降級）；概要在 org 建立後切回心智圖若跨側會靜默消失（改動前相同）；匯出 path 與畫面 path 因字寬估算不同而數值不同（既有設計）。

## 4. 驗證

- 單元：`node --test tests/*.test.mjs` 全綠（core 37、delta 21、io 21、layout 7、arrows 13、stickers 9、node:test 44）。
- E2E：全矩陣（Chromium＋Electron）見 `docs/SHORTCUT_MATRIX.md`。
- 真機：v1.0.18 由已安裝的 app 走更新器安裝後，用 computer-use 實打中文輸入法驗證首字（見 worklog）。
