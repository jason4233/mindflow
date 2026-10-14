# M1 交付說明：手機可日用、資料不因更新或關閉而遺失

> 對應 `docs/android-sync-plan.md`（jason4233/mindflow#2）第 4 章的 M1。
> 本里程碑**不動同步架構**（仍走 GitHub 私有 repo），只補安全網、升級平台，並修掉 1.3 節列出的高風險 bug。
> Firebase 即時同步從 M2a 才開始。

## 1. 這一版做了什麼

| 項目 | 做法 | 主要檔案 |
|---|---|---|
| 版本閘門 | 雲端 manifest 或任一文件的 `schemaVersion` 大於 1 時停止同步並提示更新：本機不動、不重試。**M2a 寫出 v2 之前，兩台裝置都必須先更新到這一版。** | `js/sync-plan.mjs` |
| 同步競爭 | 「讀快照→套用」期間如果使用者又存檔，套用前先逐 key 比對（CAS），不一致就重來；推送前再讀一次本機；最多重試 3 次。內容完全相同的衝突不產生副本；這一輪自己剛推上去的版本不會被當成衝突。電腦與手機都已修正。 | `desktop/sync-engine.mjs`、`js/sync-mobile.mjs` |
| 本機儲存區整個遺失 | 沒有索引、也沒有任何文件時當成首次同步，只把雲端拉回來，**不會**把每份文件都記成刪除推上雲端。使用者刻意刪光時（空索引仍在）照常處理。 | `js/sync-plan.mjs` |
| 「以我為準覆蓋」 | 覆蓋前先把儲存區裡對方的版本另存成「衝突副本・覆蓋前保留」；另存失敗就取消覆蓋。 | `js/store.js`、`js/editor/main.js` |
| GAMMA 版面（R7） | 本機的版面記錄只在文件版面沒被別台改過時才套用；別台同步來的版面優先。 | `js/editor/gamma-state.js` |
| 手機同步穩定度 | 所有 GitHub 請求都加 `cache: 'no-store'`；失敗後 30 秒起跳、每次加倍、最多 5 分鐘重試；網路恢復立刻同步；在前景時每 5 分鐘先比 ETag（沒變只會收到 304）；進背景時立刻推送；記憶體內保留最近 30 筆診斷紀錄（權杖一律遮蔽）。 | `js/sync-mobile.mjs` |
| 返回鍵／進背景 | 依序處理：關掉最上層對話框 → 結束文字編輯（commit，不是取消） → 存檔並推送後回首頁。在首頁 2 秒內按兩下才縮到背景。App 暫停時先存檔再推送。 | `js/mobile-app.mjs` |
| 手機檔案備份 | 每 2 分鐘把心智圖寫進 App 私有目錄，輪替保留 10 份，內容沒變就不寫。儲存區整個不見時自動還原，完成前不讓同步開始。設定裡可以匯出（分享選單），也可以從自動備份或檔案還原；還原的文件一律以「副本」加入，不覆蓋也不刪除現有文件。 | `js/mobile-backup.mjs`、`js/mobile-settings.mjs` |
| PAT 安全儲存 | 手機的 PAT 改存 Android Keystore 加密的 `MindflowSecureStorage`。舊版留在 Preferences 的明文會自動搬過去並刪除（明文會被 Google 備份，所以要刪）。安全儲存失敗時才退回 Preferences，不會讓 PAT 消失。 | `js/sync-mobile.mjs`、`MindflowSecureStoragePlugin.java` |
| App 內檢查新版 | 讀 `releases/tags/latest`，找版號最大的 `MindFlow-<versionCode>.apk`；比手機上的版本新就在首頁提示。每 6 小時最多查一次，按「稍後」可隱藏同一版 3 天。 | `js/mobile-update.mjs` |
| QR 配對 | 電腦的「同步設定」→「在手機上配對」：在獨立視窗顯示含 PAT 的 QR。這個視窗沒有 preload、停用 JavaScript 與 DevTools、防截圖，2 分鐘後自動關閉；PAT 從不進主視窗。手機的「掃描電腦上的配對 QR」使用 ML Kit 的 Google Code Scanner，不需要相機權限；也可以把配對碼直接貼進 PAT 欄。 | `js/pairing.mjs`、`desktop/pairing-window.mjs`、`js/qr-encode.mjs` |
| Android 平台 | Capacitor 6 → 8.5.3，minSdk 24、targetSdk 36、JDK 21，edge-to-edge 由原生處理（網頁不用改）。版號由 CI 自動遞增；設好 Secrets 後固定用正式金鑰簽章。PR 也會建置並附上 APK。 | `mobile/**`、`.github/workflows/android.yml`、`docs/android-release-signing.md` |
| 測試 CI | 新增 `tests.yml`：根目錄單元測試、手機、電腦版（Windows）、觸控 E2E。 | `.github/workflows/tests.yml` |

## 2. 需要你（擁有者）做的事

1. **建立正式簽章金鑰並加入 4 個 GitHub Secrets**：照 `docs/android-release-signing.md` 操作，大約 15 分鐘。
   - 加好之前，CI 產生的 APK 仍是「拋棄式簽章」，無法覆蓋安裝前一版。
2. **唯一一次需要解除安裝的更新（R4）**：換成正式金鑰、升級到 Capacitor 8 之後的第一個 APK 必須先解除安裝舊版。步驟：
   1. 手機上先按「立即同步」，或在「手機備份」按「匯出備份」，存到雲端硬碟或傳給自己。
   2. 在電腦上確認心智圖都在。
   3. 解除安裝舊版 App。
   4. 安裝新版 APK。
   5. 電腦「同步設定」→「在手機上配對」，用手機掃描。
   6. 等第一次同步把資料拉回來。若沒有同步，就用「從檔案還原」匯入剛才的備份。
3. **之後每個里程碑打一個 `v*` tag**，讓 release 留下 `MindFlow-<versionCode>.apk`，需要時可以裝回舊版。
4. 照第 4 節的驗收清單在實機上試用約 30 分鐘。

## 3. 假設（聯絡不到 CEO，依此繼續；有不同意見請在 PR 留言）

| # | 問題 | 採用的假設 | 若不同意 |
|---|---|---|---|
| M1-A1 | 首頁按返回鍵要不要直接結束 App？ | 2 秒內按兩下才縮到背景（`minimizeApp`，與 Android 12 以後的預設相同），讓背景同步有時間跑完；不直接結束 App。 | 改成直接 `exitApp()` 只需改一行。 |
| M1-A2 | 手機還原備份要不要覆蓋現有文件？ | 不覆蓋，一律以副本（新 id）加入：覆蓋舊版會被同步當成「本機修改」推上雲端，蓋掉較新的版本。 | 若要「整庫回到某個時間點」，需要另外設計並先停用同步。 |
| M1-A3 | 自動還原的時機 | 只在儲存區整個不見（沒有索引、也沒有文件）時。使用者刻意刪光（空索引仍在）不會被復活。 | — |
| M1-A4 | 手機輪詢頻率 | 前景每 5 分鐘一次，與電腦相同；先比 ETag，沒變化時是 304，不耗 GitHub 限額。 | M2a 會改成計畫 3.8 的加速版節奏。 |
| M1-A5 | 版號規則 | `versionCode = 10000 + GitHub Actions run_number`，`versionName = 1.1.<run_number>`（PR 版本加 `-pr<N>`）。 | workflow 改名時 run_number 會歸零，要把 10000 調高。 |
| M1-A6 | 更新檢查讀哪個 release | 讀滾動的 `latest` tag（`releases/tags/latest`），`android.yml` 只把帶版號的 APK 放在那裡。 | — |
| M1-A7 | 手機換 repo／分支 | 換 repo 或分支時重設同步 base，第一次同步只做聯集，不會誤刪。電腦版維持原行為（未在 M1 範圍內修改）。 | 電腦版也要重設的話放進 M2a 統一引擎。 |
| M1-A8 | 單節點結構（structure）與「垂直時間軸」版面不跟著同步 | 維持只存在本機：要存進文件需要 schema v2，在 M2a 處理。 | — |
| M1-A9 | 快捷鍵矩陣 E2E（`tests/e2e/shortcuts.matrix.mjs`）放不放 CI | 不放：它是為 Windows 寫的，在 Linux 上跑超過 10 分鐘。CI 只放觸控 E2E。 | 可另外做一個 Windows 的手動觸發 job。 |
| M1-A10 | 電腦版測試在 CI 的哪個平台跑 | `windows-latest`：電腦版只發 Windows，而且有一個測試依賴 Windows 路徑（在 Linux 上本來就會失敗，main 也一樣）。 | — |

## 4. 驗收清單（實機）

- [ ] 用新 APK 覆蓋安裝後，資料仍在（加好 Secrets 之後的第二個 APK 起）。
- [ ] 編輯到一半直接滑掉 App，再開啟時最後的修改仍在，而且已同步到電腦。
- [ ] 「手機備份」→「匯出備份」可以存到雲端硬碟；「從檔案還原」可以把它以副本加回來。
- [ ] 在 Android 設定裡只「清除快取」不影響心智圖；手機備份清單裡看得到每 2 分鐘的自動備份（App 開著且有修改時）。
- [ ] 餵 v2 測試資料（雲端 `manifest.json` 的 `schemaVersion` 改成 2）時，手機與電腦都停止同步並提示更新，本機不變。
- [ ] 電腦「在手機上配對」顯示 QR，手機掃描後不必手打 PAT 就能同步；設定裡顯示「PAT 已以 Android Keystore 加密存在這支手機」。
- [ ] Release 裡有 `MindFlow-<versionCode>.apk`；裝舊版時首頁會提示有新版。
- [ ] 返回鍵：編輯中按一下會結束編輯，再按一下回到首頁；在首頁按兩下會縮到背景。
- [ ] PR 的 CI 全綠（Tests、Android）。

## 5. 驗證紀錄（本 session 實際執行）

- 根目錄單元測試：`node --test tests/*.test.mjs`，118 項全過。
- 電腦版：`desktop` 156 項中 155 項通過。唯一的失敗是既有、依賴 Windows 路徑的測試（main 上同樣失敗）。
- 手機：`mobile` 36 項全過，包含 Android 平台、CI workflow 與同步整合測試（對假 GitHub 伺服器）。
- 觸控 E2E（375×812 與桌面滑鼠）：7 項全過。
- 瀏覽器實測（Chromium，模擬原生外掛）：
  - 「以我為準覆蓋」會留下副本；
  - 同步來的 org 版面不會被本機記錄蓋掉（移除修正後確實重現失敗）；
  - 返回鍵流程；
  - 備份的匯出、從自動備份還原、清空後自動還原；
  - 新版提示：使用 APK 版 CSP 的網頁副本，GitHub API 回應由測試攔截；
  - 手機掃描配對：PAT 只存在安全儲存，不在 DOM、localStorage 或 Preferences。
- 真實 Electron 43.3.0（xvfb＋gnome-keyring）：
  - 設定 PAT 後，「在手機上配對」開出獨立視窗；
  - 視窗沒有 preload 橋接；
  - 截圖中的 QR 可以用 jsQR 解回完整配對資料；
  - 主視窗 DOM、userData 目錄與程式輸出都沒有明文 PAT。
- Android 實際建置（平台代理，本機 Android SDK）：
  - `assembleDebug`、`assembleRelease`、單元測試、lint 全部成功；
  - APK 為 versionCode 10042、minSdk 24、targetSdk 36；
  - 權限只有 INTERNET、ACCESS_NETWORK_STATE，以及 androidx 的 App 私有權限，沒有 CAMERA；
  - 外掛已註冊：BarcodeScanner、App、Filesystem、Preferences、Share、MindflowSecureStorage。
- QR 編碼器：與 segno、python-qrcode、node qrcode 交叉比對，逐位元相同；並以 jsQR、zxing-cpp 實際解碼驗證。
- workflow：actionlint 檢查通過。

## 6. 已知限制與風險

1. **沒有在實機或模擬器上執行過**（這個雲端環境沒有 KVM）：Keystore、edge-to-edge、返回鍵與掃描都只有編譯和單元測試。請以第 4 節的清單實機驗收。
2. 只有 debug 版 APK 的 Capacitor 會把外掛呼叫參數（含 PAT）寫進 logcat；CI 發佈的是 release 版，不受影響。
3. ML Kit 會帶入 Google 的使用統計函式庫（datatransport），因此多了 `ACCESS_NETWORK_STATE` 權限。
4. 殘留的邊角情況：一次同步在推送成功後、連續 3 次都因為本機又被修改而放棄套用時，下一次同步可能把自己較舊的版本另存成一份衝突副本（不會遺失資料，只是多一份副本）。M2b 的節點級合併會解決。
5. 手機自動備份存在 App 私有目錄（`DATA`），解除安裝 App 時會一起刪除；要跨越解除安裝，請用「匯出備份」。
6. 手機的定期備份只在 App 開著時執行；App 進背景時會再補備份一次。
