# CODEX Mobile C3 行動同步交付筆記

## 完成範圍

- 新增 `js/sync-mobile.mjs`，在 Capacitor WebView 直接用 `fetch` 呼叫 GitHub Git Data API；沒有引入 Node API、desktop module 或 Contents API。
- 行動同步複用 `js/sync-plan.mjs` 的 `buildLocalState`、`computeSyncPlan`、`computeLocalWrites`、`buildConflictCopy` 與 `emptyManifest`，保留 desktop 的三方合併、衝突副本、tombstone、收藏與回收筒語意。
- push 使用 non-force ref update；遇到 HTTP 422 會重新 pull、重新合併，最多三次，不會 force push。
- lifecycle 已接上：app 啟動 pull、同頁 localStorage 文件存檔後 45 秒 debounce push、頁面從背景回到 visible 時 pull。
- 遠端套用採 doc-first、index-last 的單次 transaction；失敗時回復 touched keys，成功後送出 `mindflow:sync-applied` 與 `changedDocIds`，沿用既有 dashboard refresh 與 editor CAS reload guard。
- PAT、同步 config 與 sync state 由 Capacitor Preferences 保存；公開 API 只回 `hasToken`，PAT 不進 localStorage、status、事件或 Git repo。
- `js/settings.js` 完成三環境分流：Electron preload 優先、原生 Capacitor 建立 mobile sync API、純 web 不啟用同步。手機與桌面共用設定 UI，但 token 儲存文案依環境區分。
- `mobile/` 加入 exact dependency `@capacitor/preferences@6.0.4`；`cap sync android` 已產生 Gradle plugin 接線並更新 Web/Android assets。

## 檔案

- 新增：`js/sync-mobile.mjs`
- 修改：`js/settings.js`
- 修改：`mobile/package.json`、`mobile/package-lock.json`
- 更新：`mobile/android/capacitor.settings.gradle`、`mobile/android/app/capacitor.build.gradle` 與 `cap sync` 產生的 Web assets
- 新增：`mobile/test/sync-mobile.test.mjs`
- 新增：`mobile/test/sync-mobile.integration.test.mjs`
- 新增：`docs/CODEX_MOBILE_C3_NOTES.md`

## TDD 與整合驗證

- RED：`node --test mobile/test/sync-mobile.test.mjs mobile/test/sync-mobile.integration.test.mjs` 先因 `js/sync-mobile.mjs` 不存在得到 `ERR_MODULE_NOT_FOUND`。
- 第一輪 GREEN：C3 目標測試 5/5；涵蓋 Electron／Capacitor／純 web 分流、Preferences plugin 註冊、PAT 邊界、startup／debounce／visibility lifecycle，以及 fake server 的 desktop push → mobile pull。
- 加強 fake-server 整合測：mobile pull 後直接寫入 doc 與 index，確認只保留一個 debounce timer；執行 timer 後 mobile push，desktop 再 pull 可讀到手機存檔版本。
- `npm install --save-exact @capacitor/preferences@6.0.4`：安裝成功，audit 0 vulnerabilities。
- `npm run sync`（`mobile/`）：copy-web 與 `cap sync android` 成功；輸出明確顯示找到 `@capacitor/preferences@6.0.4` 這 1 個 Android plugin。
- `npm test`（`mobile/`）：10/10 通過。
- `node --test tests/*.test.mjs`：exit 0，root 既有九個測試檔全綠。
- `npm test`（`desktop/`）：136/136 通過。
- `node --test tests/e2e/touch.mobile.mjs`：7/7 通過，含 375×812 touch 與 1280×800 desktop browser 回歸。

## 主動自首

1. 本機沒有 Java、`ANDROID_HOME`、`ANDROID_SDK_ROOT` 或 adb，因此沒有宣稱 Gradle build、APK 安裝、Android WebView 或原生 Preferences bridge 真機成功；本輪只驗證 `cap sync android` 的 plugin 接線與生成資產。
2. 沒有用真實 GitHub PAT 對 `api.github.com` 做網路測試；HTTP 契約、Git Data 八端點、CAS、desktop/mobile 互通與 token 不落 repo 均由本機 fake HTTP server 驗證。真實 GitHub CORS、rate limit 與 fine-grained PAT 權限仍需真機簽收。
3. Capacitor Preferences 在 Android 底層是 SharedPreferences，不是 Electron safeStorage 等級的加密容器。這次依 C3 指定把 PAT 放在 Preferences，並明確避免在手機 UI 使用「已加密」文案；若威脅模型要求 at-rest encryption，後續應另換 secure-storage plugin。
4. 未執行 `tests/e2e/shortcuts.matrix.mjs`，因該腳本會覆寫非 C3 所有權的 `docs/SHORTCUT_MATRIX.md`；沒有把它宣稱為本輪已跑。其餘不寫共享報告的 Node、desktop、mobile 與 touch E2E 已全綠。
5. 第一次唯讀盤點把不存在的 `test/` 目錄交給 `rg`，因此命令 exit 1；沒有修改檔案，之後改成精確目錄重跑。
6. 沒有執行任何 git 指令；沒有修改 `js/editor/touch.js`、`js/editor/mobilechrome.js` 或 `desktop/**` 原始碼。

---

## 雙簽驗收（2026-08-30）

### Claude 主 session 覆核

- 程式碼審閱：`js/sync-mobile.mjs`（三環境偵測、Preferences 存取、lifecycle 觸發語意）、`js/settings.js` 三分流——與 PHASE_MOBILE_BRIEF C3 合約一致。
- 實彈關卡（補自首 #2 的缺口）：`desktop/scripts/phone-path-e2e.mjs` 以 Chromium 模擬 Capacitor 環境，載入 **`mobile/www/` 出貨副本**，用真 PAT 對真 repo `jason4233/mindflow-data` 執行 `syncNow` → **PASS**（拉下雲端 2 份真文件、blob 齊全；測試前清空本地文件確保純拉、不污染真 repo）。
- **覆核抓到 Blocker**：root CSP `connect-src 'self'` 被原樣複製進 `mobile/www/`，webview 直連 api.github.com 必被擋（實測 `Failed to fetch`）。桌面同步走 main process 不受影響，故 Stage A 未爆。已派 CSP-FIX（見 `docs/CODEX_TASK_MOBILE_CSP.md` / `docs/CODEX_MOBILE_CSP_NOTES.md`）：copy-web 僅對行動副本開放 `https://api.github.com`，root 維持嚴格 CSP，替換不到即 build fail。修復後重跑實彈 E2E 通過。
- 迴歸：root 18/18、desktop 136/136、mobile 12/12 全綠。
- 已知限制（隨版聲明）：Capacitor Preferences＝未加密 SharedPreferences（UI 無「已加密」文案）；真機 Android WebView 同步以晨睿實機安裝為最終簽收。

**Claude 簽字：C3 + CSP-FIX 通過驗收。**

### Codex 簽字

C3 交付與自首見上；CSP-FIX 交付與自首見 `docs/CODEX_MOBILE_CSP_NOTES.md`（12/12 測試、root core 27/27、無未揭露風險）。

**Codex 簽字：完成，無保留事項。**
