# Mobile CSP 修正紀錄

## 做了什麼

- `mobile/scripts/copy-web.mjs` 複製 `index.html`、`editor.html` 時，將精確字串 `connect-src 'self';` 改寫為 `connect-src 'self' https://api.github.com;`。
- 改寫只寫入 `mobile/www/`；root `index.html`、`editor.html` 維持原本的嚴格 CSP。
- 任一來源 HTML 找不到預期 directive 時，copy script 會帶檔名 throw，避免 CSP 改版後靜默產出無法同步的 APK 資產。
- `mobile/test/copy-web.test.mjs` 新增正式 copy pipeline 的 CSP 產物測試，以及未命中 directive 的 fail-fast 測試。
- 已重新生成 `mobile/www/**`。

## 測試結果

執行日期：2026-08-30

- `mobile/`：`npm run copy-web` — exit 0。
- `mobile/`：`npm test` — 12/12 tests passed，0 failed。
- root：`node --test tests/core.test.mjs` — 27/27 checks passed，0 failed。
- 直接檢查產物：`mobile/www/index.html`、`mobile/www/editor.html` 均為 `connect-src 'self' https://api.github.com;`；root 兩個 HTML 均仍為 `connect-src 'self';`。

## 自首

- 未 build APK，也未在 Android 實機 WebView 使用真實 GitHub token 做端到端同步；本次驗證涵蓋 copy pipeline、產物 CSP、mobile 全套自動測試與指定 root core test。
- 未跑 root 其他測試檔；任務書只指定 `tests/core.test.mjs`，其餘 root suite 不列入本次驗證範圍。
- CSP 僅開放 `https://api.github.com`。若未來同步流程新增其他 origin，仍會被 CSP 阻擋；這是目前最小權限設計的預期限制。
- 改寫依賴精確 directive `connect-src 'self';`；未來 root CSP 格式若改動，mobile build 會刻意失敗，需同步更新轉換規則與測試。
