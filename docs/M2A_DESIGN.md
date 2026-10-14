# M2a 設計：同步引擎 v2（統一實作與資料格式）

> 對應 `docs/android-sync-plan.md` 第 4 章 M2a；以 M1（jason4233/mindflow#3）為基礎。
> 傳輸仍是 GitHub 私有 repo；Firebase 在 M3 接上，節點級合併在 M2b。

## 1. 目標與不做的事

**做**

1. `js/sync/` 一份引擎，電腦（Electron renderer）與手機（Capacitor WebView）共用，取代
   `desktop/sync-engine.mjs` 與 `js/sync-mobile.mjs` 兩份重複實作。
2. 傳輸介面（Transport）＋ `GitHubTransport`：之後 M3 只要多一個 `FirebaseTransport`。
3. 雲端格式 `schemaVersion: 2`：文件加 HLC（混合邏輯時鐘），圖片在同步層抽成獨立資產。
4. base（上次同步成功的狀態）改存 IndexedDB，避開 localStorage 配額。
5. GitHub 推拉節奏改成計畫 3.8 的加速版。

**不做（留給後續里程碑）**

- 節點級三方合併：M2b。M2a 的衝突仍是「整份衝突副本」，但勝負改用 HLC 判斷，不再用牆鐘 `updatedAt`。
- 編輯器就地套用遠端修改：M2b（M2a 仍沿用「重新載入目前文件」的既有行為）。
- 本機儲存遷到 IndexedDB：M4。M2a 只把同步自己的資料（base、資產快取、時鐘）放 IndexedDB；
  心智圖本體仍在 localStorage，**本機格式與匯出功能完全不變**。

## 2. 雲端格式 v2（GitHub repo 內）

```text
manifest.json            { schemaVersion: 2, docs: {id: meta}, favorites: [...], tombstones: {id: iso}, lastWriter }
docs/<id>.json           雲端文件：本機文件 JSON，圖片換成 mf-asset:<sha256>，外加 schemaVersion: 2、hlc
assets/<sha256>.txt      圖片原始 data URI（內容不變；同一張圖只存一次）
```

- `meta` = `{ title, createdAt, updatedAt, state, deletedAt?, hlc, writer }`。
  `updatedAt` 仍是「版本戳」（三方比對用），`hlc` 決定衝突勝負。
- **HLC**：字串 `<13 位毫秒>-<4 位十六進位計數>-<裝置 id>`，可以直接用字串比較大小。
  每台裝置的時鐘存在 IndexedDB；收到遠端 HLC 時往前推（`receive`）。
  手機與電腦時間差幾分鐘也不會讓舊修改蓋掉新修改。
- **HLC 在哪裡蓋章**（實作中修正過兩次，見第 9 節）：引擎第一次發現某份文件和 base 不同時，
  以**這個版本的 `updatedAt`（同一台裝置的時鐘在修改當下的時間）**蓋章，而且要在接收這一輪遠端時間戳**之前**蓋；
  章記在同步狀態裡，重試與失敗後都沿用同一個。base 不可信時（首次同步、資料遺失、從備份還原）**不蓋章**，
  衝突改比 `updatedAt`（與 v1 相同），推送時才補章。本機文件 JSON 不加欄位，
  所以 `normalizeDoc` 與舊的匯出／匯入都不受影響。
- **base 可不可信**：沿用 M1 審查後加入的本機儲存區識別碼 `mindflow.sync.storeEpoch`
  （存在同步狀態與 localStorage、不進備份）；兩邊對不上就當首次同步。
- **圖片抽出**：只處理 `node.image.src` 以 `data:` 開頭的值（貼紙是 `assets/stickers/...` 路徑，不動）。
  雜湊用 SHA-256（`crypto.subtle`）。下載時用本機資產快取或 `assets/<sha>.txt` 換回原 data URI，
  **往返後與原文件逐字相同**（測試斷言）。
- **大小上限**：GitHub blob 上限 100 MB，而 localStorage 整體配額約 5 MB，單張圖片不可能超過；
  M2a 不做重新編碼。Firebase 單一字串上限 10 MB，M3 再加上限檢查（屆時也不會超過 localStorage 配額）。
  **刻意不做「太大就略過」**：略過會讓另一台的文件缺圖，下次推回時把圖刪掉。
- **版本閘門**：M2a 支援 v1 與 v2；看到 `schemaVersion > 2` 就停止同步並提示更新（M1 的閘門同一套）。
  M1 的手機與電腦看到 v2 會停止同步並提示更新，這正是 M1 先上閘門的目的。
- **從 v1 升級**：v2 引擎讀到 v1 manifest 時照常比對；第一次推送就整份寫成 v2
  （所有文件補上 `schemaVersion: 2` 與 HLC，圖片抽成資產）。之後 M1 以前的版本就會被閘門擋下。

## 3. 模組

| 檔案 | 職責 |
|---|---|
| `js/sync/hlc.mjs` | HLC：`now()`、`receive(remote)`、比較、序列化；狀態經 KV 保存 |
| `js/sync/kv.mjs` | 小型 KV 介面（`get/set/delete/entries`）：IndexedDB 實作＋記憶體實作（測試） |
| `js/sync/assets.mjs` | SHA-256、`mf-asset:` 參照、抽出／換回圖片（純函數＋注入的雜湊） |
| `js/sync/doc-codec.mjs` | 本機文件 ↔ 雲端文件：抽圖、加 `schemaVersion`／`hlc`；版本閘門 |
| `js/sync/transport-github.mjs` | Git Data API 傳輸：讀快照（ref→commit→tree→manifest，ETag）、讀文件與資產、一次 commit 寫入；HTTP 由注入的 `request()` 執行 |
| `js/sync/engine.mjs` | 排程（推送 debounce、最小間隔、前景輪詢、online／回前景）、比對（沿用 `js/sync-plan.mjs`）、CAS 套用、衝突副本、診斷 |
| `js/sync/platform-mobile.mjs` | 手機：Preferences＋Keystore 安全儲存的設定與 PAT；`request()` 直接帶權杖呼叫 GitHub |
| `js/sync/platform-desktop.mjs` | 電腦：經 `window.mindflowSync` 讀寫設定；`request()` 走 IPC，**由 main process 加上權杖**，renderer 永遠拿不到 PAT |

`js/sync-plan.mjs`（文件清單、垃圾桶、收藏、永久刪除的三方比對）繼續共用，只改兩點：
接受 v2 manifest 的 `hlc`，以及衝突勝負優先比 HLC。

## 4. 電腦版改成 renderer 執行，權杖仍留在 main process

- 新 IPC `mindflow-sync:github-request`：renderer 送 `{ method, path, body, etag }`，main process：
  - 只允許 `GET/POST/PATCH`，路徑必須以 `/repos/<設定的 owner>/<設定的 repo>/` 開頭（或 `/user`、建立 repo 的 `/user/repos`）；
  - 加上 `Authorization` 後用 `net.fetch` 送出，回傳 `{ status, etag, body }`；錯誤訊息遮蔽權杖。
- `desktop/sync-engine.mjs` 的排程、比對、套用全部移除；main process 只保留：
  設定（safeStorage）、權杖代理請求、關窗前要求 renderer flush（逾時 10 秒）、備份。
- 關窗流程：main 先寫備份 → `executeJavaScript('window.__mindflowSyncFlush?.()')`（有逾時）→ 關窗。
- 每次換頁（首頁 ↔ 編輯器）引擎會重建；手機一直是這樣。推送中途換頁時，commit 要嘛成功、要嘛沒發生，
  下一頁重新比對即可（CAS 保護）。
- 啟動救援（舊資料遷移、備份還原）做完前，renderer 的引擎不開始同步：preload 的 `waitForStartup()` 當 `startGate`。
- 開發模式（`app.isPackaged` 為 false）可以用 `MINDFLOW_GITHUB_API_BASE` 指向本機假伺服器做端到端測試；安裝版一律忽略。

## 5. 推拉節奏（GitHub 加速版，計畫 3.8）

- 推送：存檔後等 5 秒，連續修改最多等 30 秒；**兩次推送至少間隔 60 秒**
  （GitHub 次級限制約每小時 500 次建立內容請求；一次推送約 4–5 次寫入）。
- 拉取：前景每 20 秒一次 ETag 條件請求（304 不算額度），取得焦點、回前景、恢復網路時立刻拉。
- 進背景／返回鍵離開／關窗：不受最小間隔限制，立刻推送（M1 的 flush）。

## 6. base 與 IndexedDB

- 資料庫 `mindflow-sync`，store `kv`：
  - `state`：`{ lastSyncedCommitSha, baseManifest, perDoc, etag, lastSyncAt, schemaVersion }`
  - `clock`：HLC 狀態
  - `pending:<docId>`：`{ localStamp, hlc }`（本機版本的 HLC 章）
  - `asset:<sha>`：data URI 快取
- 從 M1 升級：桌面的舊 `sync-state.json`（userData）與手機 Preferences 裡的 state，第一次啟動時搬進 IndexedDB 一次；
  搬不到就當首次同步（只做聯集，不會刪）。

## 7. 測試

- 既有同步測試（假 GitHub 伺服器、競爭注入、版本閘門、儲存區遺失）改寫到新引擎，全部保留。
- 新增：HLC 單元測試（時鐘倒退、同毫秒、跨裝置）、圖片往返逐字相同、v1→v2 升級、
  兩個引擎實例（模擬手機與電腦）透過同一個假伺服器互通、推送節奏（假計時器）、
  桌面 IPC 代理的路徑與方法白名單、權杖不出現在 renderer 可見的任何回傳值。

## 8. 假設

| # | 假設 | 理由 |
|---|---|---|
| M2a-A1 | HLC 以文件的 `updatedAt` 蓋章（由引擎在發現變更時補蓋），而不是在編輯器裡蓋 | 本機文件格式不變；同一台裝置的時鐘在修改當下的時間就是事件時間 |
| M2a-A2 | 不做圖片大小上限與重新編碼 | 見第 2 節；M3 依 Firebase 限制再加 |
| M2a-A3 | 換頁時引擎重建 | 多頁應用的本質；CAS 與重試已處理中斷 |
| M2a-A4 | 電腦版改走 renderer 後，同步只在 MindFlow 視窗開著時進行 | 與現況相同（關窗前會 flush） |
| M2a-A5 | 不回收雲端裡已沒有文件引用的圖片資產 | GitHub repo 會慢慢變大，但不影響正確性；回收放在 M3（Firebase 有 1 GB 額度，才真的需要） |
| M2a-A6 | 每份 M1 以前的雲端資料第一次被 v2 推送時整份重寫一次 | 一次性成本；之後只推有變的文件 |

## 9. 實作中由測試抓到並修正的問題

| 問題 | 修正 |
|---|---|
| 只拉不推的一輪因為 `lastWriter` 不同就多推一次（M1 有排除，移植時漏掉） | 比較 manifest 時忽略 `lastWriter`（ETag 輪詢測試抓到） |
| 推送遇到 422 重試時，暫存的 HLC 章沒保留，重算時時鐘已看過對方較新的時間，較早的離線修改反而勝出 | 章存在引擎持有的同步狀態裡，重試、失敗都保留 |
| 在接收遠端時間戳之後才替本機修改蓋章，較早的本機修改會拿到較新的章 | 先蓋本機的章（用修改時間），再接收遠端 |
| 資料遺失後從備份還原的舊版被當成「新修改」蓋上最新的章，蓋掉雲端較新的版本 | base 不可信時不蓋章，改比 `updatedAt` |

## 10. 驗證紀錄

- 根目錄 156 項、電腦版 117 項（唯一失敗是既有、依賴 Windows 路徑的測試）、手機 24 項全過。
- 新引擎測試（`tests/sync-engine-v2.test.mjs`，兩個引擎經假 GitHub 伺服器互通）：
  - 圖片逐字往返，未變更的圖片不重傳；
  - 雙向編輯、離線雙編由較晚的版本勝出（另一份留作衝突副本），並有 422 重試；
  - v1→v2 升級；M1 狀態搬移；v3 閘門；同步中存檔；刪除傳播；收藏；
  - 推送後套用失敗不產生副本；public repo 警告；推送節奏；ETag 輪詢；
  - M1 審查的回歸測試（備份還原、遺失後新建、撞上進行中的同步、重新配對）；退避重試；online／背景啟動。
- 傳輸、權杖代理白名單、preload、假伺服器端點各有獨立測試。
- 瀏覽器實測（模擬原生外掛）：返回鍵、手機備份、掃描配對（含電腦端按鈕）、版面與覆蓋流程、觸控 E2E 都通過。
- 真實 Electron 43.3.0（xvfb＋gnome-keyring＋本機假 GitHub 伺服器）：
  - 從設定畫面啟用同步後，renderer 引擎推出 v2，圖片抽成資產；
  - IndexedDB 在 `mindflow://` 來源可用；
  - renderer 的 localStorage、DOM、`getConfig` 都沒有 PAT；
  - renderer 不能借 main 的權杖呼叫 repo 以外的 API；
  - 從 main 關窗時，等待中的修改會先推上去；
  - userData、程式輸出、伺服器紀錄都沒有 PAT。

## 11. 已知限制

1. 圖片資產只增不減（見 M2a-A5）。
2. 一次推送寫入 4–5 次加上每張新圖片一次，GitHub 次級寫入限制在一般使用下不會碰到；一次匯入大量圖片時可能被限速，引擎會退避重試。
3. IndexedDB 不可用時退回 localStorage（不含圖片快取）：仍可同步，只是每次都要重新下載圖片。
4. 換頁時引擎重建，換頁瞬間的同步會中斷，下一頁重新比對（CAS 保護）。
5. 發版前兩台都必須已是 M1 以後的版本（M1 的閘門會擋下 v2；更早的版本擋不了）。
