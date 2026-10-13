<!-- SECTION-1-2-DRAFT -->
## 1. 現況架構（2026-10-13，main @ b6cc4c8）

> 本章全部來自讀程式碼與既有文件；「推論」標記的是從程式路徑推得、尚未實測的結論。

### 1.1 技術棧

| 層 | 技術 | 位置 |
|---|---|---|
| 編輯器／首頁 | Vanilla JS（ES2022 modules）+ HTML + CSS，**零框架、零打包器、零 npm runtime 依賴** | `index.html`、`editor.html`、`js/`、`css/`（約 2 萬行） |
| 繪圖 | 節點＝絕對定位 div；連線＝SVG；文字編輯＝contenteditable；Command Pattern 做 undo/redo | `js/editor/render.js`、`commands.js`、`edit.js` |
| 本機儲存 | `localStorage`（同步 API），桌面與手機都一樣 | `js/store.js` |
| 桌面版 | Electron 43.3.0 殼，自訂 `mindflow://app` 協定、NSIS 安裝檔＋免安裝 exe | `desktop/` |
| 手機版 | **Capacitor 6.2.1** Android 殼（已存在），唯一外掛 `@capacitor/preferences` 6.0.4；minSdk 22、compile/targetSdk 34、JDK 17、AGP 8.2.1 | `mobile/` |
| 同步 | 私有 GitHub repo 當雲端中樞，三方合併；桌面在 main process、手機在 WebView 內 | `js/sync-plan.mjs`（共用純函數）、`desktop/sync-engine.mjs`、`js/sync-mobile.mjs` |
| CI／發版 | GitHub Actions：`release.yml`（Windows 安裝檔，版號 `1.0.<run>`）、`android.yml`（`MindFlow.apk`），都上傳到 rolling `latest` release；桌面版自動更新讀這個 release | `.github/workflows/` |

### 1.2 心智圖資料怎麼存

**格式**：每份文件是一個 JSON（`js/editor/model.js` 的 `normalizeDoc`／`normalizeNode`）。

```text
Doc  { id:'doc_<16碼>', title, createdAt, updatedAt(ISO, 每次存檔用本機時鐘重蓋),
       root: Node, layout, themeId, relations[], summaries[],
       canvas{background, watermark{…}, spacingH, spacingV}, thumbnail(SVG, 約 2KB) }
Node { id:'node_<16碼>', text, richText(HTML|null), children[](順序有意義), collapsed,
       side, style{18 個白名單 key}, notes, link, icons[], image{src(data URI),w,h}|null }
```

**位置（localStorage key）**：

| key | 內容 | 會同步嗎 |
|---|---|---|
| `mindflow.docs.index` | 文件目錄 `{version:2, docs[], trash[], favorites[]}`，含縮圖 | 會（由 manifest 重建） |
| `mindflow.doc.<id>` | 完整文件 JSON | 會（整份） |
| `mindflow.history.<id>` | 最多 30 份版本快照（每份是完整文件，含圖片） | **不會** |
| `mindflow.gamma.<id>` | 版面覆寫、單節點結構、`timeline-v` | **不會**（見 6.1 R7） |
| `mindflow.viewmode.<id>`、`mindflow.theme.*`、`mindflow.colors.recent`、`mindflow.minimap.open` | 檢視狀態、自訂主題、偏好 | **不會** |

**大小特性**：預設文件約 3.4 KB（其中縮圖約 2 KB）；一個空節點約 160 B；推論 500 節點純文字約 90–110 KB。**圖片是 data URI 直接嵌在文件裡**：從 UI 插入的圖會重新編碼到長邊 1280 px、上限 512K 字元（約 384 KiB），但從檔案匯入的圖沒有上限，而且每份版本快照都會再存一次。

**對同步重要的模型事實**：

- 節點 id 是 `crypto` 隨機 16 碼，**在同一份文件內穩定**（改字、改樣式、拖曳移動、上下移都不變），但**不是全域唯一**：衝突副本與 `.mindflow` 匯入會沿用原節點 id。剪下貼上、複製、還原歷史版本會產生新 id（對合併器而言等於「刪除＋新增」）。
- **沒有任何節點層級的時間戳／版本、文件也沒有 `schemaVersion`**；唯一的時鐘是文件的牆鐘 `updatedAt`。
- `normalizeDoc`／`normalizeNode` 是**嚴格白名單**：不認得的欄位每次載入/存檔都會被丟掉。新舊版 App 混用時，舊版會默默刪掉新欄位。
- Command 是 do/undo 閉包，不是資料，無法直接序列化成操作日誌；但 `CommandManager.onChange` 是集中的掛鉤點，可以在這裡做差異比對。

### 1.3 既有的跨裝置同步（Stage A + C，已上線）

- **後端**：使用者自己的**私有 GitHub repo**（例如 `jason4233/mindflow-data`），根目錄 `manifest.json`＋每份文件一個 `docs/<id>.json`；透過 Git Data API（blob/tree/commit/ref）讀寫，每次推送是一個 commit，所以 git 歷史保有每一版。
- **登入**：fine-grained PAT（Metadata: Read、Contents: Read & write）。桌面用 Electron `safeStorage` 加密存檔；**手機存在 Capacitor Preferences（Android SharedPreferences，明文）**。
- **合併**：`js/sync-plan.mjs` 純函數，**以整份文件為單位**的三方合併（local × remote × base）。兩邊都改同一份文件 → 牆鐘 `updatedAt` 較新者贏、輸方變成「衝突副本」新文件；垃圾桶、收藏、永久刪除（tombstone）分開合併。四大不變式寫在 `docs/PHASE_SYNC_BRIEF.md`：state-based 三方合併、pull-before-push、**永不靜默丟資料**、**雲端中樞制（機器之間零直接通訊，任何一台關機都不影響其他機器）**。
- **觸發時機與延遲**：

| | 桌面（`desktop/sync-engine.mjs`） | 手機（`js/sync-mobile.mjs`） |
|---|---|---|
| 推送 | 每 15 秒比對指紋，有變更後**等 45 秒**沒有新修改才推（沒有最長等待上限） | 每次寫入 localStorage 後**等 45 秒**（沒有上限） |
| 拉取 | 每 5 分鐘 ETag 條件請求（304 不算額度）；視窗取得焦點（10 秒節流）；啟動；關窗 | 啟動／每次換頁（整套重跑一次）；回到前景；**前景時不會自動拉** |
| 失敗重試 | 30 秒起倍增到 5 分鐘 | **沒有**（設定畫面卻寫「恢復網路後會自動重試」） |
| 推論延遲 | 電腦改 → 手機看到：電腦 45–60 秒後才推，手機要等下次換頁或回前景 | 手機改 → 電腦看到：通常 1–6 分鐘，最差無上限 |

- **套用遠端變更**：送出 `mindflow:sync-applied` 事件；編輯器若沒有未存修改就 **整頁重新載入**（失去 undo、選取、視角），有未存修改就跳出 CAS 衝突橫幅。

**已知問題（調查發現，尚未修）**：

1. **同步期間的競爭條件**：同步先讀一次 localStorage 快照、走網路幾秒、再無條件寫回被拉下來的文件與整份重建的 index；編輯器存檔不經過同步佇列。期間存的修改可能被覆蓋、新文件可能從 index 消失（推論，未測）。
2. 「以我為準覆蓋」按鈕會蓋掉剛拉下來的版本且**不留衝突副本**，違反不變式 3（推論）。
3. 推送成功但本機 base 沒存到（App 被殺、換頁）時，下次同步會產生內容相同的衝突副本（推論）。
4. 桌面每次推送後的第一次輪詢一定拿到 200（ETag 是推送前的），白跑一次完整同步。
5. 手機 WebView 的 `fetch` 沒設 `cache: 'no-store'`，GitHub 回應帶 `Cache-Control: private, max-age=60`，可能讀到 60 秒前的分支頭（推論，未驗證）。
6. 桌面與手機各自複製了一份 GitHub 客戶端與協調流程（`sync-engine.mjs` vs `sync-mobile.mjs`），任何修改要做兩次。
7. 桌面的同步警告（公開 repo、隔離文件）被 preload 濾掉，UI 收不到（推論）。

- **GitHub 作為即時通道的硬上限**：主要額度 5,000 次/小時（同一使用者所有裝置共用）；**次級限制約每分鐘 80 次、每小時 500 次「建立內容」請求**。一次單文件推送約 5 次寫入（2 blob + tree + commit + ref），所以整個帳號**每小時最多約 100 次推送**；而且每次推送都要改同一個 `manifest.json`，兩台同時推一定撞 422 重試。→ GitHub 適合當「幾十秒級」的同步與版本封存，**不適合當逐字即時通道**。

### 1.4 Electron 桌面專屬功能與手機替換對照

| 桌面功能 | 位置 | 手機現況 | 計畫中的替換 |
|---|---|---|---|
| 固定來源 `mindflow://app` 協定（localStorage 不會因埠號變動遺失） | `desktop/main.mjs`、`protocol.mjs` | Capacitor 預設 `https://localhost` | 沿用；**鎖死 hostname/scheme**，改了會讓資料「消失」（新來源） |
| 每 2 分鐘磁碟備份 ×10 份、空儲存時自動還原 | `desktop/backup-store.mjs` | **無** | `@capacitor/filesystem` 定期備份到 App 私有目錄＋可匯出（M1） |
| 舊來源資料遷移 | `desktop/legacy-storage.mjs` | 不需要 | localStorage → IndexedDB 遷移時要寫一份同等的遷移（M3） |
| 單一實例＋喚回視窗 | `main.mjs`、`window-focus.mjs` | `launchMode="singleTask"` | 沿用 |
| 自動更新（讀 GitHub `latest` release、靜默安裝） | `desktop/updater.mjs` | **無；而且每次 CI 用隨機金鑰簽章、versionCode 固定 1 → 新版裝不上去，只能解除安裝（會刪光資料）** | 固定 release keystore（GitHub Secrets）、versionCode 自動遞增、App 內檢查更新並導向下載（M1，最優先） |
| PAT 加密（`safeStorage`） | `desktop/sync-settings.mjs` | Preferences 明文、`allowBackup="true"` | 安全儲存外掛（Android Keystore）＋關閉或限縮 Auto Backup（M1） |
| 同步引擎跑在 main process、用 `executeJavaScript` 讀寫 renderer | `desktop/sync-engine.mjs` | WebView 內 `js/sync-mobile.mjs`（另一份實作） | 合併成**一份 renderer 端同步核心**，桌面也改在 renderer 跑；Electron 只提供憑證存取與關窗 flush（M2） |
| 關窗前先存檔＋備份＋同步 | `main.mjs`、`sync-engine.mjs` | **無**（沒有 `@capacitor/app`，進背景不 flush） | `appStateChange`／`visibilitychange` 時立即存檔＋推送（M1） |
| 匯出用 `<a download>`、列印用 `window.open`+`print()` | `js/editor/exportdialog.js` | **都沒作用**（Capacitor 沒有下載處理、不支援新視窗） | `@capacitor/filesystem` 寫檔＋`@capacitor/share` 分享；PDF 改成產生檔案後分享（M3） |
| CSP 標頭＋meta | `desktop/protocol.mjs` | 只有 meta，`copy-web.mjs` 建置時把 `connect-src` 改寫為加上 `https://api.github.com` | 新增即時後端網域時同步改寫（M2） |
| 導覽守門、外部連結開瀏覽器 | `main.mjs` | Capacitor 預設把外部網域交給系統瀏覽器 | 沿用 |

### 1.5 既有 Android App 的成熟度

**已有**：CI 自動產出可安裝的簽章 APK（約 3.5 MB）；觸控手勢引擎（單指平移、雙指縮放、點選、雙擊編輯、雙擊空白建懸浮節點、長按節點選單、拖曳重掛、選取後浮出「＋子節點／＋同級」）；行動版工具列、底部 6 鈕工具欄、全螢幕側欄抽屜、文字工具列貼齊軟鍵盤；手機端 GitHub 同步。

**缺口（依每天使用的影響排序）**：

1. **更新會毀資料**：隨機簽章＋固定 versionCode → 只能解除安裝再裝，localStorage 與 PAT 全清空。
2. **手機上沒有任何耐久備份**：資料只在 WebView localStorage（推論上限約 10 MiB UTF-16，約 520 萬字元），30 份快照×內嵌圖片很快就逼近上限；沒有磁碟備份。
3. **同步不即時也不夠穩**：見 1.3。
4. **返回鍵直接關掉 App**；進背景不存檔（推論最多約 4 秒的修改可能遺失）。
5. **匯出／分享／PDF 不能用**。
6. **平台版本老舊**：targetSdk 34；Google Play 自 2025-08 起要求新 App／更新 targetSdk ≥ 35（側載不受此限，但 targetSdk 35 會強制 edge-to-edge，而 `viewport-fit=cover` 尚未設定）。
7. **很多功能在手機上碰不到**：演示模式、概要、關聯線、格式刷、多選、全部展開/收合、上下移、複製等只能用鍵盤或被隱藏的工具列；首頁的漢堡抽屜程式碼存在但沒掛上。
8. **編輯手感**：編輯中的節點不會自動捲到鍵盤上方；Android 輸入法組字從未在實機驗證（桌面版曾為 IME 修過很多輪）。
9. **憑證輸入困難**：在手機上手打 fine-grained PAT 很痛苦，而且明文存放。
10. **從未在實體手機上驗證**：所有驗證都是 Chromium 375×812 模擬；手勢參數沒在實機調過；根目錄的單元測試與觸控 E2E 沒有跑在任何 CI。

## 2. Android 改造評估

### 2.1 結論：Capacitor 可行，而且已經是現況——繼續用，升級並補齊

- **可行性已被證明**：現有網頁 UI 不改一行就跑在 Capacitor 裡，建置只是「複製檔案＋改寫 CSP」，CI 已能產出可安裝 APK。
- **不需要打包器也能用外掛**：Capacitor 會在原生端產生 `window.Capacitor.Plugins.<名稱>` 代理，現有的 Preferences 已經這樣用（`js/sync-mobile.mjs`）。所以「零 npm runtime 依賴、零打包器」的原則可以維持：網頁程式只透過全域代理呼叫，npm 套件只存在於 `mobile/` 的原生建置端。
- **所有缺口都有官方或成熟的外掛**：`@capacitor/app`（返回鍵、前景/背景、深層連結）、`@capacitor/filesystem` + `@capacitor/share`（匯出）、`@capacitor/keyboard`、`@capacitor/network`、`@capacitor/status-bar`、安全儲存（社群外掛，走 Android Keystore）。
- **替代方案都更差**：PWA/TWA 會失去原生儲存與外掛、而且背景限制更多；React Native／Flutter 要重寫整個以 DOM 為基礎的編輯器（數月工作量）。

**結論：不換技術，採「Capacitor 升級＋補齊」。**

### 2.2 平台升級

| 項目 | 現況 | 目標 | 理由 |
|---|---|---|---|
| Capacitor | 6.2.1 | 最新穩定大版（假設 A3：7 或 8，以當時官方文件為準） | 跟上 targetSdk 要求與外掛相容性 |
| JDK | 17 | 21 | 新版 Capacitor／AGP 要求；CI 只需改 `setup-java` |
| targetSdk / compileSdk | 34 / 34 | ≥ 35（依當年 Play 要求） | 上架 Play 必須；側載可暫緩但會累積技術債 |
| minSdk | 22 | 26 以上（假設 A4） | 程式已用 `Object.hasOwn`、`.at()`、`100dvh`（需 Chrome 93+ WebView）；同時設定 `minWebViewVersion` 擋掉過舊 WebView |
| Edge-to-edge | 未處理 | `viewport-fit=cover`＋已存在的 `env(safe-area-inset-*)` 生效 | targetSdk 35 強制 edge-to-edge |
| 簽章 | 每次 CI 隨機產生金鑰 | **固定 release keystore**，存在 GitHub Actions Secrets；`.gitignore` 確保金鑰不入庫 | 能覆蓋安裝 = 更新不刪資料 |
| versionCode | 寫死 1 | CI 用 `github.run_number` 自動遞增 | Android 不允許相同或更小的版號覆蓋 |

### 2.3 為手機調整的清單

**觸控／操作**

- 補齊手機上碰不到的功能：長按空白處叫出畫布選單（全部展開/收合、貼上、新增懸浮節點）；長按節點選單加入「概要、關聯線、上移/下移、複製」；底部工具欄的「更多」抽屜放演示模式、格式刷、尋找。
- 觸控多選：長按節點進入「多選模式」，之後點選切換選取。
- 收合按鈕在觸控環境改成常駐顯示（目前只在 hover 時出現）。
- 備註預覽：觸控上點一下圖示開啟（目前是 hover 預覽）。
- 編輯中的節點自動捲到軟鍵盤上方（`visualViewport` 已經在算鍵盤高度，補上「把節點平移進可視區」）。
- 手勢參數（雙擊間隔、長按時間、點按容忍距離）在實機上調校。

**版面**

- 首頁掛上已寫好但沒接上的漢堡抽屜（`js/editor/mobilechrome.js` 的 dashboard 部分）。
- 分屏參考在手機上停用或改成全螢幕切換（WebView 不能顯示 blob PDF）。
- 實機驗證橫向／直向切換、平板寬度、深色模式系統列顏色。

**Electron API 替換與 App 生命週期**

- `@capacitor/app`：返回鍵在編輯器 → 回首頁、在首頁 → 再按一次離開；`appStateChange` 進背景時**立即存檔＋推送**、回前景時拉取。
- 匯出：產生 Blob → `Filesystem.writeFile`（App 快取目錄）→ `Share.share` 讓使用者存到雲端硬碟或傳給自己；列印/PDF 改成產生檔案後分享。
- 匯入：保留 `<input type=file>`，`.mindflow` 補上 MIME 對應，避免檔案選擇器把它濾掉。
- 憑證：同步權杖改存 Android Keystore 支援的安全儲存；`allowBackup` 改為排除敏感檔案或關閉。
- 儲存：localStorage → IndexedDB（非同步、配額遠大於 localStorage），手機與桌面同一套（M3，見第 4 章）；在那之前先做「快照數量隨裝置空間調整」與定期檔案備份。
- 更新：App 內讀 GitHub `latest` release 的版本號，有新版就提示並開啟 APK 下載頁（側載無法靜默安裝，需使用者確認，這是 Android 的安全限制）。

### 2.4 發佈方式

- **主路線：繼續側載 APK**（GitHub release `latest`），$0。
- **風險：Android 2026 開發者驗證制度**（見第 6 章 R3）：Google 宣布在認證 Android 裝置上，側載 App 也要來自已驗證身分的開發者，分國家逐步實施。對策：(1) 先確認台灣的生效時間；(2) 註冊驗證或免費的業餘/學生帳號類型（若適用）；(3) 最後手段：開發者可用 `adb install` 安裝自己的 App（Google 表示會保留開發用安裝路徑）。
- **Google Play**：一次性 US$25 註冊費（**選用**，不是必要）。上架需 targetSdk 達標、隱私權政策、資料安全表單；個人新帳號另需封閉測試期。單人使用不建議上架，除非側載被驗證制度擋住。
