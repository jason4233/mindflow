# SYNC-E 整合紀錄

驗收日期：2026-08-30（Asia/Taipei）

## 完成範圍

- `desktop/sync-engine.mjs`
  - 實作 `disabled / idle / syncing / offline / error` 狀態機與 status listener。
  - 將備份捕捉、同步捕捉、同步權威套用收斂到同一條可復原的 `storageQueue` async mutex。
  - 實作 startup、15 秒指紋輪詢加 45 秒 debounce push、5 分鐘 ETag pull、focus 10 秒節流、關窗 10 秒 timeout flush。
  - 每輪固定 pull-before-push；`updateRef` 422 最多三輪重新 pull／merge／push，不使用 force。
  - 一般失敗自 30 秒開始指數退避，最高 5 分鐘；成功後重設退避。
  - renderer 權威寫入只呼叫一次 `executeJavaScript`，文件先寫、index 最後寫，途中失敗會 rollback；renderer 成功後才更新 base。
  - 讀寫 frozen schema 的 `userData/sync-state.json`；machineId 首次由 hostname 加隨機四碼產生。
  - 實作 preload 五條 channel 對應的四個 `ipcMain.handle` 與一條 status push event。
- `desktop/main.mjs`
  - `BrowserWindow.webPreferences.preload` 掛入 `preload.cjs`，保持 `contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`。
  - 在 legacy migration 與 backup restore 完成後才啟動 startup sync。
  - 備份與 engine 共用同一條 `storageQueue`；focus 與關窗 flush 接入 engine。
- `desktop/package.json`
  - `build.files` 納入 `sync-engine.mjs`、`sync-github.mjs`、`sync-plan.mjs`、`sync-settings.mjs`、`preload.cjs`。
- `desktop/test/sync-engine.test.mjs`
  - 覆蓋 mutex 排序與失敗復原、state schema／token 紅線、renderer 套用失敗不前進 base、offline 狀態、單一 transaction rollback、IPC 與所有 frozen 時間常數。
- `desktop/test/sync-e2e.test.mjs`
  - 永久移除 SYNC-E／SYNC-B 的 skip gate；缺少 runtime 會直接 fail。
  - 修正 tombstone 驗證：解析目前 HEAD 的 `manifest.json`，不再對二次 JSON 跳脫字串做錯誤 regex。
- `desktop/test/packaging.test.mjs`
  - 新增完整同步 runtime 與 sandbox preload 必須打包的回歸測試。

## 合約與安全紅線

- 未修改 `docs/PHASE_SYNC_BRIEF.md`。
- GitHub repo 是唯一中樞；engine 沒有 peer discovery、區網直連或等待另一台機器在線的路徑。
- PAT 只存在 main-process 設定解密結果與 HTTP Authorization header；不寫 localStorage、backup、sync-state、repo blob、status 或 logger。
- 同步套用 payload 只有 `{setKeys, removeKeys}`，不含 `expectedUpdatedAt`；既有 editor CAS 未修改。
- conflict loser 與 tombstone 撞新編輯都先建立衝突副本，再把副本和 manifest 放進同一輪 remote commit／renderer transaction。
- remote commit 成功但 renderer 套用失敗時，不寫 `sync-state.json` 新 base；下輪仍由舊 base 重拉重合。

## TDD 與驗證證據

- Baseline：`npm test`（cwd=`desktop`）為 114 tests、110 pass、0 fail、4 skip；四個 skip 均為等待 SYNC-E 的雙實例場景。
- RED：新增 `sync-engine.test.mjs` 後先得到 `ERR_MODULE_NOT_FOUND`，確認 engine 缺失會正確擋測試。
- Engine GREEN：`node --test test\sync-engine.test.mjs` 為 7/7 pass、0 skip。
- E2E 第一次正式執行為 11/12 pass；永久刪除本身與遠端 tombstone 都已成功，失敗根因是既有測試對二次 JSON 字串使用未跳脫 regex。改成解析 HEAD manifest 後為 12/12 pass、0 skip。
- Packaging：`node --check sync-engine.mjs`、`node --check main.mjs`、`node --check preload.cjs` 全部 exit 0；`node --test test\packaging.test.mjs` 為 6/6 pass。
- Desktop 全套：`npm test` 為 122 tests、122 pass、0 fail、0 skip。
- Repo root：`node --test tests\*.test.mjs` 為 13 test runners、0 fail、0 skip；各 runner 內部斷言全綠。
- 安全掃描：E-owned runtime／tests 未找到 `backupQueue`、`expectedUpdatedAt`、`localStorage.*token` 或 `token.*localStorage`。

## 主動自首

1. 本輪沒有真 GitHub PAT／真 private repo 對測，也沒有啟動可見 Electron 視窗做人工操作；跨實例與 Git Data round-trip 使用本地 fake GitHub HTTP server，避免建立外部狀態。
2. frozen `ensureRepo` 會自動建立 private repo，但其合約沒有 `auto_init`，Git adapter 也沒有建立初始 ref 的介面。因此「完全空的新 repo」若 GitHub 沒有 main ref，首次同步仍會回 repo/ref 錯誤；目前可靠路徑是既有 repo 或已具有初始 commit 的 repo。這是 A/B/E 凍結介面間的既有限制，未越界修改 SYNC-B 合約。
3. 422 compare-and-swap 衝突採立即重拉重合，總嘗試上限三次；30 秒到 5 分鐘的指數退避用於整輪網路／服務失敗後的背景重試。若把 30 秒退避套在 422 內，雙實例即時收斂與關窗 flush 都會被無謂拖慢。
4. frozen sync-state schema 沒有 `lastSyncAt` 欄位，所以狀態列的 `lastSyncAt` 是本次 process 記憶體狀態，重啟後先顯示 null，直到首次成功同步。
5. remote push 成功但 renderer transaction 失敗時，GitHub ref 可能已前進，但 local base 刻意不前進；下輪會重新 pull 並收斂。這符合「失敗不推進 base」，代價是極端重複失敗下可能留下未被 ref 引用的 dangling Git commit，由 GitHub 自行回收。
6. 沒有執行任何 git 指令，沒有 commit／push。
