# SYNC-C 完成紀錄

## 實作範圍

- `desktop/sync-settings.mjs`
  - `loadSyncSettings(userDataPath)`：讀取 `userData/sync-settings.json`，缺檔或 JSON 損壞時回安全預設值。
  - `saveSyncSettings(userDataPath, patch)`：只接受白名單欄位；token 必須經 Electron `safeStorage.encryptString()` 後以 base64 `tokenCipher` 落盤。
  - `getDecryptedToken(settings)`：只在 main process 邊界將 `tokenCipher` 還原成 token；未設定時回 `null`。
  - 寫檔採同目錄暫存檔加 rename，避免留下半份含密文的 JSON。
- `desktop/preload.cjs`
  - 以 CJS `contextBridge` 暴露 `window.mindflowSync`，可供 `sandbox:true` preload 使用。
  - 五個方法及五條 IPC channel 均依 `PHASE_SYNC_BRIEF.md` 凍結介面實作。
  - `getConfig()` 採欄位白名單，即使 main process 誤回 `token` 或 `tokenCipher`，renderer 也只會收到 `{enabled, repo, hasToken}`。
  - `onStatus(cb)` 會移除同一個 listener，unsubscribe 後不再推播。
- `desktop/test/sync-settings.test.mjs`
  - 使用真實暫存目錄與真實檔案 I/O；只 mock Electron `safeStorage`、`contextBridge`、`ipcRenderer` 邊界。

## 不變式與安全紅線

- SYNC-C 不參與 merge、push、pull 或機器間通訊；沒有新增任何依賴另一台機器在線的路徑。
- `safeStorage.isEncryptionAvailable()` 不為 `true` 時，token 儲存直接失敗；沒有明文 fallback。
- settings JSON 不含明文 `token` 欄位或 token 值。
- `getConfig()` 不回傳 token 本體或 `tokenCipher`。
- 測試期間設置 console/localStorage token 洩漏 guard；production 檔沒有 console、localStorage、backup 或 GitHub commit 寫入路徑。

## 測試證據

- TDD RED：`node --test test\sync-settings.test.mjs`，因 `desktop/sync-settings.mjs` 尚不存在而得到 `ERR_MODULE_NOT_FOUND`。
- SYNC-C GREEN：`node --test test\sync-settings.test.mjs`，5/5 pass、0 fail。
- 語法：`node --check sync-settings.mjs` 與 `node --check preload.cjs` 均 exit 0。
- 全套：首次基線已有並行中的 SYNC-B 測試失敗；後續重跑時 SYNC-B 已全綠，但 SYNC-A 的 `sync-plan.mjs` 與非本流 updater 仍在並行施工。最終全套結果見下方「最終驗證」。

## SYNC-E 交接

- 由 SYNC-E 在 `desktop/main.mjs` 設定 `webPreferences.preload` 並註冊五條 `ipcMain` handler/event；SYNC-C 依所有權表不碰 `main.mjs`。
- 由 SYNC-E 在 `desktop/package.json` 的 `build.files` 納入 `preload.cjs` 與 `sync-settings.mjs`；SYNC-C 依所有權表不碰 `package.json`。
- main process 的 `get-config` handler 應從 settings 產生 `hasToken`，不可把 `getDecryptedToken()` 結果放進回傳物件、log 或 renderer storage。

## 主動自首

- 實際寫入僅限 SYNC-C 所有權檔：`desktop/sync-settings.mjs`、`desktop/preload.cjs`、`desktop/test/sync-settings.test.mjs`，以及任務明定的本紀錄檔；沒有修改其他流檔案。
- 為讓原生 Node 測試可跑，測試透過 `Module._load` 精準替換 `electron` 模組；production 沒有測試專用 export 或 global hook。
- `saveSyncSettings()` 使用同步小檔 I/O。理由是凍結介面未標示 async，且它只處理單一極小設定檔；同步 engine 的網路／文件 I/O 不在此模組。
- 全套測試曾因其他並行流的測試先落地、實作尚未落地而變紅；我沒有越界代修或刪除那些測試。
- 沒有執行任何 git 指令。

## 最終驗證

- `node --check sync-settings.mjs`：exit 0。
- `node --check preload.cjs`：exit 0。
- `node --test test\sync-settings.test.mjs`：5 tests、5 pass、0 fail。
- Stage A 前既有全套（`backup-store`、`legacy-storage`、`packaging`、`protocol`、`window-focus`）：23 tests、23 pass、0 fail。
- 共享工作區聚合 `npm test`：112 tests、108 pass、0 fail、4 skipped。4 個 skip 是 SYNC-F 在 SYNC-E 尚未整合前的預期標記；SYNC-C 5 案在同一次聚合執行中全綠。
