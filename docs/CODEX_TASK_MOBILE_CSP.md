# CSP-FIX 任務書 — 行動版 CSP 擋死同步

這是非互動模式：絕對禁止詢問確認、禁止等待回覆——立刻動手直到完成。

## Bug（主 session 實測抓到，Blocker）

root `index.html` / `editor.html` 的 CSP `connect-src 'self'` 被 `mobile/scripts/copy-web.mjs` 原樣複製進 `mobile/www/`。手機同步（C3 `js/sync-mobile.mjs`）是 webview 內直接 fetch `https://api.github.com`，被這條 CSP 擋死 → APK 上同步 100% 失敗（實測錯誤：`GitHub request failed: Failed to fetch`）。

## 修法（最小權限，不動 root 頁面）

1. `mobile/scripts/copy-web.mjs`：複製 HTML 時把 CSP 內 `connect-src 'self'` 改寫為 `connect-src 'self' https://api.github.com`。**僅行動版副本**；root `index.html`/`editor.html` 一個字都不許動（web 版不啟用同步，維持嚴格 CSP）。改寫要對所有複製的 HTML 檔生效（index.html、editor.html），用精確字串或正則替換，替換不到（未來 CSP 改版）時 build 直接 throw 報錯，不許靜默略過。
2. `mobile/test/` 加測試：跑 copy-web 後斷言 (a) `mobile/www/index.html` 與 `mobile/www/editor.html` 的 connect-src 含 `https://api.github.com`；(b) root `index.html` 的 connect-src 仍是 `'self'` 無 github。
3. 跑 `mobile/` 全套測試 + root `node --test tests/core.test.mjs` 確認零迴歸。
4. 寫 `docs/CODEX_MOBILE_CSP_NOTES.md`：做了什麼、測試結果、**自首節**（任何沒驗的、任何風險）。
5. 不要 git 操作。

## 檔案所有權

只准動：`mobile/scripts/copy-web.mjs`、`mobile/test/**`、`mobile/www/**`（重新生成）、`docs/CODEX_MOBILE_CSP_NOTES.md`。其他一律不碰。
