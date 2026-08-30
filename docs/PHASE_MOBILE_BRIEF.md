# Stage B/C 任務書 — Android APP + 行動觸控適配

> 總計劃 Stage B/C 章節。四條流：B1（Capacitor+CI）∥ C1（觸控手勢）∥ C2（行動 chrome）先行並行；C3（行動同步）待 B1 完成。共同鐵則：非互動立即動手、嚴守檔案所有權、tests 全綠、寫 `docs/CODEX_<流名>_NOTES.md`（含自首）、不要 git。

## 流 B1 — Capacitor 骨架 + Android CI

**擁有**：`mobile/**`（新）、`.github/workflows/android.yml`（新）、`js/sync-plan.mjs`（自 desktop/ 遷移）、`desktop/sync-plan.mjs`（改為 re-export 一行）、desktop/test 中受遷移影響的 import 路徑

1. `mobile/` 獨立 Capacitor 專案（自己的 package.json；不污染根目錄零依賴）：appId `com.mindflow.app`、appName MindFlow、webDir 指向 build script 產出的資產副本
2. `mobile/scripts/copy-web.mjs`：複製根目錄 index.html/editor.html/css/js/assets 進 webDir（排除 tests/docs/desktop）
3. **sync-plan 共用化**：`desktop/sync-plan.mjs` 內容遷至 `js/sync-plan.mjs`（零依賴純函數，webview 可直接 import），desktop 側改 `export * from '../js/sync-plan.mjs'` 保持既有 import 與測試不變；驗證 desktop 全套測試仍綠
4. Android 平台：`npx cap add android`；權限最小化（INTERNET 即可）；app 圖示用 assets/favicon 衍生
5. `.github/workflows/android.yml`：ubuntu runner + JDK17 + Android SDK，build release APK（未簽章 debug keystore 或自產 keystore 簽章以便安裝）、以固定名 `MindFlow.apk` 上傳到 `latest` release（沿用既有 gh release upload --clobber 模式）；push to main 觸發
6. 本機驗證界限（誠實聲明用）：本機無 Android SDK，APK 由 CI 產出；B1 需推送前先本機驗證 `copy-web` 產物完整（index/editor/js/css/assets 齊全、無 desktop 洩入）與 capacitor config 合法

## 流 C1 — 觸控手勢引擎

**擁有**：`js/editor/touch.js`（新）、`css/mobile.css`（新、僅手勢相關部分）、`js/editor/main.js` 標記區一行 init

- 單指拖空白=平移；雙指 pinch=縮放（以雙指中點為中心）；單指拖節點=重掛（沿用 dnd 的 command 路徑）；tap=選取；double-tap 節點=編輯；double-tap 空白=新增懸浮節點（複用 DBLCLICK 邏輯）；long-press 節點=呼出節點選單（複用 contextmenu 內容）
- 全部經 pointer events / touch events 轉接**既有** viewport/selection/dnd/edit API，不重寫邏輯；desktop 滑鼠行為零改動（touch 事件才啟用）
- 選取節點時浮出「＋子節點／＋同級」兩顆浮動按鈕（GitMind 行動版模式，僅 touch 環境顯示）
- 測試：tests/touch.test.mjs（座標換算、手勢辨識純函數）+ Playwright 375×812 touch 模擬實測平移/縮放/選取/建節點

## 流 C2 — 行動版 chrome 適配

**擁有**：`css/mobile.css`（佈局部分，與 C1 分節共用檔案——C1 寫檔案上半 gesture 區、C2 寫下半 layout 區，各自標記區塊）、`js/editor/mobilechrome.js`（新）、`js/editor/main.js` 標記區一行

- `<768px` 或 touch 主要輸入時：頂部三膠囊縮為單列精簡工具列+底部工具欄（新增節點/撤銷/重做/⊕/佈局/主題）；右側面板改全螢幕抽屜；文字工具列貼齊軟鍵盤上緣；快捷鍵說明與鍵盤診斷隱藏；`···` 選單觸控友善間距
- dashboard 行動版：卡片單欄、側欄改漢堡抽屜
- 測試：Playwright 375×812 逐頁截圖檢查無爆版、桌面視口零迴歸（1280 寬截圖對比）

## 流 C3 — 行動同步（待 B1 完成後啟動）

**擁有**：`js/sync-mobile.mjs`（新）、`js/settings.js`（行動分支）、`mobile/` 內 Capacitor Preferences 接線

- webview 內直接 fetch GitHub API（api.github.com 支援 CORS），複用 `js/sync-plan.mjs` 合併核心與 desktop 相同觸發語意（開 app pull、存檔 debounce push、visibilitychange pull）
- token 存 Capacitor Preferences（行動端）；web 瀏覽器環境不啟用（維持「同步僅桌面版與手機 App」）
- 設定 UI 共用 js/settings.js：偵測環境（Electron preload／Capacitor／純 web）分流
- 測試：fake server 整合測 + 與桌面實例互通 E2E（桌面推→模擬行動 webview 拉）

## 驗收里程碑

B1+C1+C2 交付 → 我逐流驗收簽字（Playwright 行動視口實測）→ push 觸發 android.yml → CI 產 APK → 我驗 APK 內容物 → C3 → 手機↔桌面同步 E2E → 晨睿真機（手機）安裝實測 = 最終簽收。
