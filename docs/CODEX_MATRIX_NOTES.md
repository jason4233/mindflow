# CODEX MATRIX 驗收紀錄

## 最終結果

- Chromium 完整矩陣：**92 / 92 PASS**
- Electron 關鍵子集：**14 / 14 PASS**
- 合併矩陣：**106 / 106 PASS**
- Root Node tests：**6 個 test files、86 個行為案例全部 PASS**
- Desktop tests：**18 / 18 PASS**
- 詳細逐格結果：`docs/SHORTCUT_MATRIX.md`

最終 E2E command：

```powershell
node tests\e2e\shortcuts.matrix.mjs
```

矩陣使用 Playwright 真實 `keyboard` / `mouse` 輸入。文字色、反白色與節點填色會先以 CDP `Input.dispatchMouseEvent` 送出真實 mouse down/up，再模擬 OS color picker 回填 `change`。Alt+P 使用 CDP `Page.setInterceptFileChooserDialog` 與 `Page.fileChooserOpened` 驗證 native chooser 確實被打開。

## 修復清單

### 1. Space 編輯被畫布 pan 攔截

檔案：`js/editor/viewport.js`

根因是 `ViewportController` 比 `KeyboardController` 更早收到 `keydown`，先對 Space 執行 `preventDefault()`；快捷鍵分派看到 `defaultPrevented` 後直接 no-op。

修復後，有選取節點、關聯線或概要時，Space 保留給「編輯」action；沒有編輯目標時才進入 Space-pan。

### 2. 原生 color picker 破壞 contenteditable Range

檔案：`js/editor/edit.js`

文字色與反白色改成共用 `bindNativeColor()`：

- pointerdown capture 階段先保存 Range。
- `input` 可即時預覽。
- 部分 Chromium / Electron 只可靠送 `change`，因此 change 會補做 Range 還原與套色。
- 同一手勢已在 input 套用時，change 不重複包一層格式。
- 套用後重新 capture Range 並把焦點還給 contenteditable。

紅燈證據：只送 `change` 時，修復前文字色與反白色的 `richText` 都是空字串。修復後兩格都 PASS。

### 3. 文字工具列格式刷接錯 action

檔案：`js/editor/edit.js`

原本按鈕只呼叫 `copyStyle`，沒有進入一次性格式刷狀態。改接 `formatPainter`，現在會顯示 armed 狀態並等待下一個目標節點。

### 4. 備註與同批附加功能

目前 checkout 在 MATRIX 開始時已存在 `initializeDelta()` → `initializeAttachments()` → `createNoteDrawer()` 的完整掛載路徑，因此無需再修改 `attachments.js`。

永久矩陣已鎖定：

- Ctrl+Alt+K：連結 dialog 開啟。
- Ctrl+Alt+M：drawer 已掛載、開啟且 textarea 聚焦；未選取與面板焦點狀態也有斷言。
- Ctrl+Alt+T：多選連續同級後產生概要 DOM。
- Alt+P：image input click 且 native file chooser 開啟。
- F4：進入關聯線選點模式，點目標後產生 relation。
- Ctrl+Alt+R：評論佔位提供可見回饋。

Chromium 與 Electron 關鍵子集全部 PASS。

### 5. 填色

樣式面板的 native color input 原本已有 preview / change commit 路徑。CDP 真實 pointer 測試確認選取節點的 `style.fill` 會提交為指定色，Chromium 與 Electron 都 PASS，因此沒有為了「看起來有改」而動 production code。

## Electron 驗收

沒有修改 `desktop/` 殼代碼。

`desktop/node_modules/electron` 當時只有 package metadata，沒有 binary；已打包的 `desktop/dist/win-unpacked` 又含舊版 editor bundle，不能拿來代表目前 source。矩陣因此透過 `npx electron@43.2.0` 把 runtime 放在使用者 npm cache，再用：

```text
electron.exe --remote-debugging-port=9337 --user-data-dir=<temp> .
```

載入目前的 `desktop/main.mjs`，等待 `mindflow://app/index.html` ready 後，以 Playwright `connectOverCDP` 執行。

Electron 功能差異：**沒有**。四方向、Ctrl+Alt 系列、Alt+P、F4、文字色、反白色、節點填色皆與 Chromium 相同。

Electron harness 差異：CDP endpoint 會早於 app 首頁 ready；若立即 `goto`，會中止 `mainWindow.loadURL()` 並造成 `ERR_ABORTED`。runner 已永久等待主頁穩定後才開始案例。

## 主動自首

1. 使用者提供的 B 現象「備註 drawer DOM 根本沒掛載」在本輪目前 checkout **無法重現**。我沒有假裝改過 `attachments.js`；實際做法是確認現有掛載路徑，並用 Chromium / Electron 行為測試永久鎖死。
2. 第一版矩陣曾把隱藏 measure probe 也算成 `.mind-node`，並讓 outline row 與 canvas node 的共用 `data-node-id` 造成 strict-selector FAIL。這些是測試錯，不是產品錯，後來全部限縮到 `#nodes-layer`。
3. 第一版 fit/tidy 測試錯誤假設「fit 必定縮小」。小文件實際會放大填滿畫布；已改驗所有節點落在 canvas 邊界內。
4. Alt+P 一度 flaky，是 CDP observer 忘了先送 `Page.enable`。補上後 headless 與 headed Chromium 都 PASS，最終 combined 也 PASS。
5. 最初背景 server 的兩個 log 被 process 鎖住，第一次清理只刪掉其他 log；後來明確終止本輪啟動的 `tools\serve.mjs 4173` 後才完成清理。
6. 沒有執行 git commit、沒有修改 `desktop/`、沒有修改使用者系統設定。

## 變更檔案

- `js/editor/edit.js`
- `js/editor/viewport.js`
- `tests/e2e/shortcuts.matrix.mjs`
- `docs/SHORTCUT_MATRIX.md`
- `docs/CODEX_MATRIX_NOTES.md`

---

## 主 session 抽驗與雙簽字（2026-07-26）

抽驗（真實環境重測，不採信報告）：Ctrl+Alt+M 備註抽屜開啟+textarea 聚焦 ✅；Space 保留原文進入編輯 ✅；文字色真實滑鼠路徑（real click 後選取存活+套色成功）✅。自首 6 條全採認——特別採認 #1 的誠實（沒有為了交差假裝修過 attachments.js），我昨日的「drawer 未掛載」重現判定為選擇器手法誤判，予以更正。矩陣 106/106 + 永久回歸測試架構是本輪最大資產。

- ✍️ 主 session（Claude）：簽字通過
- ✍️ Codex（MATRIX）：矩陣全綠、保留事項已全數揭露

v1.2 工作項關閉。
