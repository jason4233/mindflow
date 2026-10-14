# 交接說明（2026-10-14）

> 給接手的 session：先讀這份，再讀 `docs/android-sync-plan.md`（計畫，jason4233/mindflow#2）、
> `docs/M1_NOTES.md`（M1 交付說明）、`docs/M2A_DESIGN.md`（M2a 設計，在 M2a 分支）。
> 回覆使用者一律用**繁體中文**。

## 1. 任務與紅線（使用者原話的重點）

- 目標：MindFlow 做成 Android App，手機↔電腦即時雙向同步、自動處理衝突（單一使用者、多裝置，雲端中樞制），$0／月。
- 已定案：方案 A＝Firebase Realtime Database＋Firebase Auth（REST／SSE、零 SDK）。
- 依序做里程碑 M1→M2a→M2b→M3→M4→M5，盡量推進。
- 每個里程碑在 `claude/*` 分支開一個 PR，**全部先別 merge**，等使用者（晨睿）同意才合併。後一個里程碑可以建在前一個分支上。
- 開發全程用 **Firebase 本機模擬器**，**不建立真的 Firebase 專案**、不碰真實資料。到 M3 最後一步才由使用者手動建立免費專案。
- **不部署、不碰正式資料、不開通任何付費服務。**
- 每個 PR 交出前，先由**獨立審查代理做對抗式審查**。
- 聯絡不到 CEO：不確定的事就寫下假設並據此繼續；所有產出都放 GitHub。
- 同步紅線：
  - PAT 永不出現在 localStorage、備份、repo commit、`getConfig` 回傳值、電腦版 renderer、log。
  - 不 commit keystore 或密碼。
  - 不 force-push（之前被權限擋過，不要嘗試繞過）。

## 2. 分支與 PR 狀態

| 分支 | PR | 狀態 |
|---|---|---|
| `claude/android-sync-plan` | jason4233/mindflow#2（draft） | STAGE ① 計畫，已完成 |
| `claude/m1-android-foundation` | jason4233/mindflow#3（draft） | M1 完成，CI 全綠；**複審發現待修**（見第 3 節） |
| `claude/m1-rereview-wip` | jason4233/mindflow#5（draft，勿合併） | M1 複審修正的半成品，**未測試**（見 3.2）；修完併回 M1 分支後關閉 |
| `claude/m2a-sync-engine-v2` | jason4233/mindflow#4（draft，base 是 M1 分支） | M2a 實作與驗證完成；**對抗式審查尚未完成**（被中斷，要重跑） |
| `claude/m2b-node-merge` | jason4233/mindflow#6（draft，勿合併） | M2b 合併核心初稿（`js/sync/merge-doc.mjs`），**未測試** |

這個 session 已**取消訂閱**所有 PR 的 GitHub 事件，接手的 session 請自己訂閱需要的 PR。

## 3. M1（PR #3）

### 3.1 已完成

全部功能與第一輪對抗式審查的修正，詳見 `docs/M1_NOTES.md`。CI（`tests.yml` 的 4 個 job，加上 `android.yml` 的 APK 建置）在 `79e4f80` 全部通過。

### 3.2 第二輪複審（針對 `79e4f80`）的發現：待處理

複審的重現腳本放在 scratch，已隨容器消失，以下是重點：

| 等級 | 發現 | 建議修法 |
|---|---|---|
| **HIGH** | 識別碼 `mindflow.sync.storeEpoch` 設定後就不再變。Chromium 會延遲約 5 秒才把 localStorage 寫到磁碟，同步狀態卻是立刻寫入：在這段時間被殺掉時，舊內容帶著「相符」的識別碼，新的 base 被信任 → 剛拉下來的文件被刪、遠端修改被回退；「編輯中滑掉 App」時最後的修改可能被舊版蓋回 | 這一輪只要寫了本機或推了雲端，就換一個新識別碼。`claude/m1-rereview-wip` 已做 `rotateStoreEpoch()`，但**有缺口**：只推送、本機沒寫入時換了識別碼，`localChanged` 卻仍是 false，引擎不會套用寫入，標記沒寫進 localStorage，狀態卻存了新識別碼 → 之後每次都變首次同步。要在 rotate 之後重算 `localChanged`。兩個引擎（`js/sync-mobile.mjs`、`desktop/sync-engine.mjs`）都要改，並補「推送後程式被殺、localStorage 回到舊內容」的回歸測試 |
| MEDIUM | 升級後每台既有裝置被迫做一次聯集：舊 base 沒有識別碼 → 刪掉的文件復活、多出衝突副本 | WIP 的 `trustedBase()` 已改成「舊 base 沒有識別碼、本機也沒有標記」時信任一次。**還要**在備份還原與舊資料搬入時把 base 作廢：手機清 Preferences 的 `mindflow.sync.mobile.state`；電腦清 userData 的 `sync-state.json` 裡的 base |
| MEDIUM | base 不可信、而本機套用一直失敗（例如空間滿）時，每次重試都推一份新的衝突副本 | WIP 已讓衝突副本 id 不含時間（`buildConflictCopy`）。要補測試，也要檢查 `desktop/test`、`tests/` 裡有沒有斷言舊 id 格式的測試 |
| MEDIUM | 正式簽章之後又出現拋棄式簽章的建置時，`android.yml` 會刪掉最後一個正式簽章的帶版號 APK，並用裝不上去的 APK 蓋掉 `MindFlow.apk` | throwaway 模式下，如果 latest 已有 `MindFlow-<n>.apk`，就整個跳過發佈並發出 warning；否則只上傳 `MindFlow.apk`，不跑清理迴圈。同步更新 `mobile/test/android-workflow.test.mjs` |
| LOW | 還原與舊資料搬入不會移除既有的標記 | 寫入還原內容前先 `removeItem('mindflow.sync.storeEpoch')`，三處都要：`js/mobile-backup.mjs`、`desktop/main.mjs` 的 restore 與 legacy migration |
| LOW | `LOCAL_CHANGE_REASONS` 裡的 `'config'` 會多跑一次同步 | 移除（`setConfig` 本來就會等進行中的同步） |
| LOW | 文件在別台被永久刪除後，編輯器的 `saveDocument` 回傳 false：`dirty` 一直是 true 又沒有橫幅，返回鍵會永遠拒絕離開 | `saveNow` 在 `stamp === false` 時設 `saveBlocked` 並顯示橫幅「這份文件已在另一台裝置刪除［另存為新文件］」（用 `importDocumentCopy`） |

處理完要：

1. 跑三套測試；
2. 更新 `docs/M1_NOTES.md` 第 7 節；
3. 推到 `claude/m1-android-foundation`；
4. 再派一次獨立複審；
5. 把 PR #3 標題的「[進行中]」換掉，說明改成可交審。

## 4. M2a（PR #4，`claude/m2a-sync-engine-v2`）

- 內容：`js/sync/` 統一引擎，電腦版改在 renderer 執行，PAT 由 main 的 `desktop/sync-bridge.mjs` 代理加上；雲端格式 v2（HLC、圖片資產）、base 存 IndexedDB、GitHub 加速版節奏。設計、決策、實作中抓到的問題與驗證紀錄見 `docs/M2A_DESIGN.md`。
- 已驗證：
  - 根目錄 156、電腦版 117（唯一失敗是既有的 Linux 路徑測試）、手機 24 項；
  - 真實 Electron 端到端與瀏覽器實測（見設計文件第 10 節）。
- **待做**：
  1. 把 M1 複審修正移植過來：`js/sync/reconcile.mjs` 的識別碼要同樣輪換，並重算 `localChanged`；`js/sync/engine.mjs` 移除 `'config'`；還原時移除標記。`trustedBase` 與衝突副本 id 的修改在共用的 `js/sync-plan.mjs`，合併 M1 分支後會自動帶過來。
  2. **重跑獨立對抗式審查**（上一次被中斷，沒有結果）。審查重點：
     - v1→v2 升級；
     - 資產往返；
     - HLC 規則；
     - `sync-bridge` 白名單能否被繞過；
     - M1 與 M2a 客戶端混用期間的閘門；
     - `startGate` 與關窗 flush；
     - `createLocalStorageKv` 的 `mfsync.*` key 不能進備份或同步。
  3. 修完後把 PR #4 從「[審查中]」改成可交審。

## 5. M2b（`claude/m2b-node-merge`，PR #6）

- 已有：`js/sync/merge-doc.mjs` 初稿，內容見該 commit 說明，**沒有任何測試**。
- 待做（計畫 3.7）：
  1. 單元測試＋模糊測試。用隨機編輯腳本，斷言四件事：不丟節點（除非兩邊都刪）、樹結構合法、合併結果與順序無關（`merge(base, L, R, local 勝)` 等於 `merge(base, R, L, remote 勝)`）、輸方的值一定進衝突紀錄。
  2. base 內容：每次同步成功後，把每份文件的已同步內容存進 KV（`base:<id>`）。
  3. `reconcile.mjs` 的 conflicts 迴圈：先試 `mergeDocuments`，失敗才退回整份衝突副本。
  4. `js/editor/model.js` 的 `normalizeDoc` 要保留 `conflicts`（只在非空時輸出，以免所有文件的 JSON 都變），並設上限。
  5. 衝突紀錄 UI：顯示「本文件有 N 個合併衝突」，可一鍵還原。
  6. 編輯器就地套用遠端修改：不整頁重載；打字中先延後；套用後清空 undo／redo（假設 A9）。
  7. 雙裝置 E2E。
- 假設：刪除對上修改時，計畫原本寫「掛到衝突暫存懸浮圖」，初稿改成「掛回最近仍存在的祖先」，要寫進設計文件。

## 6. M3–M5

尚未開始，照 `docs/android-sync-plan.md` 第 4 章：

- **M3**：FirebaseTransport＋Auth REST＋SSE、安全規則＋**本機模擬器**測試、首次搬家、CSP 三處。
- **M4**：IndexedDB 遷移、手機體驗。
- **M5**：穩定化。

## 7. 驗證環境小抄（這個容器裡試過可行的做法）

- 三套測試：
  - `node --test tests/*.test.mjs`
  - `cd desktop && node --test test/*.test.mjs`（`uses the repository root as the static root during development` 在 Linux 上本來就會失敗，CI 在 Windows 跑會過）
  - `node --test mobile/test/*.test.mjs`（先 `cd mobile && npm ci`）
- 觸控 E2E：準備兩樣東西後執行 `node tests/e2e/touch.mobile.mjs`。
  - `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  - `LOCALAPPDATA` 指到一個目錄，裡面有 `npm-cache/_npx/x/node_modules/playwright`，用 symlink 指向 `/opt/node22/lib/node_modules/playwright`
- 快捷鍵矩陣 E2E 是為 Windows 寫的，在 Linux 上跑超過 10 分鐘，不放 CI。
- 瀏覽器實測：用 `tools/serve.mjs <port>` 起站台。
  - 用 `addInitScript` 注入假的 `window.Capacitor`（Plugins：App、Preferences、MindflowSecureStorage、Filesystem、Share、BarcodeScanner）。
  - 測 GitHub API 時要用 `mobile/scripts/copy-web.mjs --web-dir <dir>` 產出的 APK 版網頁（CSP 才允許 api.github.com），並用 Playwright 的 `context.route` 攔截。
- 真實 Electron 端到端：
  1. 用 curl 下載 `https://github.com/electron/electron/releases/download/v43.3.0/electron-v43.3.0-linux-x64.zip`（electron 的 npm 安裝程式走不了代理）。
  2. `apt-get install gnome-keyring`。
  3. 用這個指令啟動：`dbus-run-session -- sh -c 'export HOME=<scratch>; printf test | gnome-keyring-daemon --unlock --components=secrets; exec xvfb-run -a <electron> --no-sandbox --password-store=gnome-libsecret --remote-debugging-port=<p> .'`（cwd 為 `desktop/`）。
  4. 用 Playwright `connectOverCDP` 連上。
  5. 注意事項：
     - 每次測試前刪掉 keyring 的 HOME。
     - 殘留的 electron 程序要清掉，否則會連到舊實例。
     - M2a 可以設 `MINDFLOW_GITHUB_API_BASE` 指到 `desktop/test/fake-github-server.mjs`（只在開發模式有效）。
     - 從頁面裡 `window.close()` 不等於使用者按 X。要測關窗 flush，請加 `--inspect=<port>`，再用 inspector 執行 `process.getBuiltinModule('module').createRequire('/main.js')('electron').BrowserWindow.getAllWindows().forEach(w => w.close())`。
- 推送前注意：GitHub 推送保護會擋權杖格式的字串。測試裡請用 `TEST-ONLY-NOT-A-REAL-TOKEN-…` 這類不像權杖的值。
