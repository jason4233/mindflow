# CODEX SYNC-D NOTES

## 完成範圍

- 新增 `js/settings.js`：共用同步設定 dialog，僅呼叫凍結的 `window.mindflowSync` 五個方法。
- `js/dashboard.js`：首頁齒輪開啟設定、側欄顯示同步狀態、收到 `mindflow:sync-applied` 後清縮圖快取並重繪。
- `js/editor/shortcuthelp.js`：編輯器「···」選單新增「同步設定」入口。
- `js/editor/main.js`：收到同步套用事件時，乾淨文件顯示 toast 後重載；髒文件停止 pending save，沿用既有 CAS 衝突橫幅讓使用者選擇。
- `css/features.css`：同步 dialog、首次流程、狀態列、側欄入口、responsive 與 reduced-motion 樣式。

## 凍結介面與安全

- 未改動 `window.mindflowSync` 的方法名稱、參數或回傳格式。
- renderer 不讀 token：只依 `hasToken` 顯示是否已有加密憑證。
- PAT 欄位為 `type=password`；只在使用者儲存時傳給 `setConfig`，成功、失敗或關閉 dialog 都清空欄位。
- `js/settings.js` 不使用 localStorage、不呼叫 fetch、不寫 console/log，也不建立裝置間通訊。
- Web 版不存在 `window.mindflowSync` 時只顯示「同步僅桌面版」，不暴露無效設定欄位。
- 同步事件處理不呼叫 `saveDocument`，因此沒有把 `expectedUpdatedAt` 用於同步權威寫入；既有編輯器 CAS 儲存路徑與按鈕行為未改。
- UI 文案明示所有裝置只透過 GitHub 私有 repo 同步，沒有依賴另一台機器在線的路徑。

## 測試證據

- RED：`node -e "import('./js/settings.js')"` 原先以 `ERR_MODULE_NOT_FOUND` 失敗；Playwright 原先點齒輪只出現「設定功能正在準備中」。
- Node syntax：`node --check` 通過 `settings.js`、`dashboard.js`、`shortcuthelp.js`、`main.js`。
- Node pure assertions：Web fallback 與 disabled/idle/syncing/offline/error 狀態映射 6/6 通過。
- 根目錄：`node --test tests/*.test.mjs`，13/13 runner entries，0 fail。
- desktop：`npm test`，110 pass、0 fail、4 skip；4 個 skip 均為合約標註等待 SYNC-E 的雙實例 E2E。
- Playwright Web：側欄與 dialog 顯示「同步僅桌面版」，PAT/repo 欄位不在 accessibility tree。
- Playwright desktop mock：首次 PAT/repo/開關儲存成功；PAT 傳入為真、input 隨即清空、config 無 token property；立即同步呼叫一次並更新側欄/狀態列。
- Playwright dashboard：寫入測試 index 後派發 `mindflow:sync-applied`，文件數同步由 0 更新為 1。
- Playwright editor：更多選單可開設定；乾淨文件顯示「已套用雲端更新」toast；髒文件顯示既有 CAS 橫幅、無 reload toast、狀態保持「變更未儲存」。
- Playwright UI：375×667 與 667×375 無水平 overflow，dialog 可垂直捲動；reduced-motion 下同步動畫為 `none`；Web/desktop session 都是 0 console error、0 warning。

## 主動自首

1. 所有權表沒有分配 SYNC-D 永久測試檔，因此沒有新增 `tests/*` 或 Playwright spec；自測透過 Node stdin 與 Playwright CLI 執行。Playwright CLI 依工具預設在既有 `.playwright-cli/` 產生 YAML snapshots，另有本機靜態伺服器 log，皆不是產品來源檔。
2. SYNC-E 尚未發射，無法以真 Electron main process 驗證 IPC 與真 GitHub 同步；桌面 UI 使用與凍結介面同簽名的 preload mock 驗證。真 IPC/E2E 留待 SYNC-E/F 整合里程碑。
3. `mindflow:sync-applied` 沒有凍結 detail schema。editor 對無 detail 的事件採安全預設「目前文件受影響」；若 detail 帶 `changedDocIds`、`documentIds`、`docIds` 或 `ids` 陣列則精確過濾。
4. `ui-ux-pro-max` 的 `scripts` 是指向缺失目標的文字 pointer，design-system 查詢無法執行；本輪改依完整 SKILL checklist 做 accessibility、表單 feedback、responsive 與 reduced-motion 驗收。
5. 未執行任何 git 指令。
