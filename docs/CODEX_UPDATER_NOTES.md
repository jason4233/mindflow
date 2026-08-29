# Codex Updater Notes

## 完成內容

- 新增 `desktop/updater.mjs`：app ready 後立即檢查 GitHub latest release，之後每 6 小時檢查一次。
- 版本來源依序讀取 release `tag_name`、`name`、`body`；rolling `latest` 使用 body 的 `Version: v1.0.<run_number>`。
- 新版提示為「發現新版本 vX.Y.Z，要現在更新嗎？」；選「稍後」後，本次啟動不再 fetch 或提示。
- `MindFlow-Setup.exe` 串流下載到 Windows temp；下載百分比同步到視窗標題與 taskbar progress。
- 安裝前以落盤後的實際檔案大小驗證必須嚴格大於 50 MiB。
- 安裝器以 detached `MindFlow-Setup.exe /S --force-run` 啟動；`--force-run` 是 assisted NSIS 在 silent 模式安裝後重啟 app 的必要旗標。成功 spawn 後呼叫 `app.quit()`。
- `desktop/main.mjs` 只有 import 與 ready/launch 後的 `initUpdater(mainWindow)` 接線。
- `desktop/package.json` 已把 `updater.mjs` 納入 `build.files`，並明寫 `nsis.runAfterFinish: true`。
- `.github/workflows/release.yml` 每次 build 都用 `1.0.<github.run_number>` 注入 package version；rolling latest 的 title/body 同步帶入版本。

## 測試

- `node --test test/updater.test.mjs`：7/7 pass。
- `node --test test/packaging.test.mjs test/updater.test.mjs`：12/12 pass。
- 排除並行開發中的 `sync-*` 後，desktop 既有核心測試：30/30 pass。
- 最終完整 `npm test`：112 tests，108 pass、0 fail、4 skip。
- `node --check updater.mjs`、`node --check main.mjs` 通過；`package.json` 可解析。
- `.github/workflows/release.yml` 已由本機 `js-yaml` 成功解析。
- 現有 `desktop/dist/MindFlow-Setup.exe` 為 100,095,502 bytes，符合 >50 MiB 門檻。

## 自首

- 沒有實際啟動現有 Setup 做 silent overwrite，避免把這台開發機的 app 安裝狀態改掉；spawn 參數與重啟旗標由測試及本機 electron-builder 26.15.3 NSIS template 驗證。
- 沒有真的執行 GitHub Actions 或發布 release；只做 workflow YAML 與資料流檢查。
- 第一次完整 `npm test` 為 109 tests：71 pass、34 fail、4 skip。34 個失敗全部在當時尚未完成的並行 SYNC 工作範圍；本 updater 沒有修改那些檔案。並行流收斂後重跑，最終為 108 pass、0 fail、4 skip。
- 下載驗證只依需求做實際檔案大小合理性，沒有額外做 code signing 或 checksum 驗證。
- 成功啟動 detached installer 後不立刻刪除 temp 目錄，因為安裝器仍需讀取該 exe；殘留檔交由 Windows temp 清理。
- 全程未執行 git 指令。

## 主 session 簽字（2026-08-30）：7/7 測試綠、版本紀律閉環（CI 注入 1.0.<run>）、稍後抑制、50MiB 下載驗證。✍️ 雙簽通過（實機更新流程待 Stage A 發版後端到端驗證）。
