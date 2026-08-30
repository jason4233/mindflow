# CODEX B1 Notes

## 交付內容

- 建立獨立 `mobile/` Capacitor 6.2.1 專案；`appId=com.mindflow.app`、`appName=MindFlow`、`webDir=www`，根目錄 `package.json` 維持零依賴。
- `mobile/scripts/copy-web.mjs` 每次先清空 `www`，只複製 `index.html`、`editor.html`、`css/`、`js/`、`assets/`；不會帶入 `desktop/`、`tests/`、`docs/`。
- 將同步純函數移至 `js/sync-plan.mjs`；`desktop/sync-plan.mjs` 僅保留 `export * from '../js/sync-plan.mjs'`，desktop 舊 import 不變。
- 以 `npx cap add android` 建立 Android 專案；manifest 只有 `android.permission.INTERNET`，launcher 與 splash 由 `assets/favicon.svg` 衍生。
- 新增 `.github/workflows/android.yml`：push main／手動觸發、Node 22、JDK17、Android SDK 34、`assembleRelease`、`zipalign`、一次性 CI keystore 簽章、`apksigner verify`，最後以固定名 `MindFlow.apk` 上傳 rolling `latest` release。
- Capacitor 6 因 JDK17 限制不能升 7；mobile lockfile 以 `tar@7.5.22` override 排除已知 audit 漏洞，`postinstall` 只修正 Capacitor 6 CLI 的 CommonJS/default-export interop。

## 驗證

- `npm ci --prefix mobile`：可重建依賴並自動套用 tar interop patch。
- `npm audit --prefix mobile`：0 vulnerabilities。
- `npm run sync --prefix mobile`：copy-web 與 `cap sync android` 成功。
- `npm test --prefix mobile`：5/5 通過。
- `node --test tests/*.test.mjs`：root 全套（含並行流新增測試）全綠。
- `npm test --prefix desktop`：136/136 通過。
- `actionlint .github/workflows/android.yml`：actionlint v1.7.12 通過。

## 本機驗證界限

- 本機沒有 Java、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`，因此沒有宣稱本機 Gradle build 或 APK 安裝成功。
- APK build、zipalign、簽章與 release upload 必須由 GitHub Actions 首次 push 後驗證。

## 主動自首

1. B1 所有權清單漏列 `desktop/package.json`，但 re-export 在 packaged Electron 中會從 `app.asar` 解析到 `resources/js/sync-plan.mjs`；為避免桌面正式版 `ERR_MODULE_NOT_FOUND`，我額外新增一個精確 `extraResources` mapping，並同步擴充既有 packaging test。這是唯一非清單檔案的必要改動。
2. 第一次用 `tar@7.5.22` 執行 `npx cap add android` 失敗：Capacitor 6 CLI 固定呼叫 `default.extract`，而 tar 7 只有具名 `extract`。失敗只留下空 `mobile/android/`；驗證為空後已移除，再以 idempotent `postinstall` 相容補丁重跑成功。
3. `@capacitor/assets@3.0.5` 生成時 console 顯示 `NaN undefined total`，但實際 74 個 Android 資產均產出；PNG signature/尺寸測試通過，且已人工檢視 xxxhdpi launcher 與 favicon 一致。
4. `npm ci` 仍會警告 Capacitor 6 相容鏈中的 `rimraf@4 → glob@9.3.5` 已 deprecated；`npm audit` 為 0 vulnerabilities。glob 最新版已跨多個 major，沒有為消除警告而冒險硬 override CLI API。
5. 沒有執行任何 git 指令，也沒有修改 C1/C2 擁有的 `css/mobile.css`、`js/editor/touch.js`、`js/editor/mobilechrome.js` 或 `js/editor/main.js`。

## 主 session 簽字（2026-08-30）：遷移零破壞（desktop 136/136）、mobile 5/5、workflow actionlint 過、copy-web 排除清單正確。✍️ 雙簽通過（APK 實體待 CI 首跑驗證）。
