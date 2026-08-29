# FOCUS：第二實例拉回主視窗

## 結果

MindFlow 已維持單一實例，使用者再次點擊捷徑或 exe 時，既有主視窗會被還原、顯示並聚焦。Windows 另外立即切換一次 `alwaysOnTop: true → false`，避開背景程序直接 `focus()` 可能被系統拒絕的前景限制。

`desktop/main.mjs` 的 `requestSingleInstanceLock()` 成敗分支未改：拿不到鎖仍直接 `app.quit()`；拿到鎖才註冊 `second-instance` 並啟動 app。事件 handler 仍先排除不存在或已 destroyed 的主視窗，再呼叫 `bringWindowToFront(mainWindow)`。

## 實作與測試

- `desktop/window-focus.mjs`：集中 `isMinimized → restore → show → focus`；只在 `win32` 執行同步 `setAlwaysOnTop(true)`、`setAlwaysOnTop(false)`。
- `desktop/test/window-focus.test.mjs`：固定以 `win32` 驗證完整呼叫順序。TDD RED 曾正確失敗為 `bringWindowToFront is not implemented`，實作後 GREEN。
- `desktop/package.json`：把新的 runtime module 納入 `build.files`，避免開發版正常、打包版 module not found。
- `desktop/scripts/smoke-focus.mjs`：啟動 source Electron，使用隔離的 `--user-data-dir`，每輪以 Win32 將 HWND 最小化，再啟動同參數的第二實例。
- `desktop/scripts/window-state.ps1`：以 `IsIconic`、`IsWindowVisible`、`GetForegroundWindow` 讀取真正的 OS 視窗狀態；檔案為 UTF-8 with BOM，PowerShell 5.1 可直接執行。

真機命令：

```powershell
node desktop\scripts\smoke-focus.mjs
```

連續兩輪結果：

```text
round 1 PASS — primary PID 23240 alive；secondary PID 3604 exit 0；minimized → normal；foreground=true；focused=true；visibility=visible
round 2 PASS — primary PID 23240 alive；secondary PID 35356 exit 0；minimized → normal；foreground=true；focused=true；visibility=visible
```

desktop baseline 實際不是需求文字所稱的 18 項，而是當下工作樹的 22/22；新增本次單元測試後為 23/23。

## 主動自首

1. 接手時 `desktop/main.mjs` 已有 `second-instance`、`restore()`、`show()`、`focus()`；真正缺口只有 Windows 的 topmost toggle。我沒有把既有行為冒充成本次新增。
2. 前兩次 E2E 嘗試錯用 `Browser.getWindowForTarget`；Electron 43 的 browser/page raw CDP endpoint 都明確回覆該 method 不存在。最終改用 Win32 驗證 native window state，CDP 僅驗 renderer focus/visibility。
3. 第三次 E2E 因沿用 matrix 的 `windowsHide:true`，Electron process tree 所有 `MainWindowHandle` 都是 0。這是驗證器問題，不是 production 失敗；改成真正可見的 Electron 後，兩輪都通過。
4. repo 內可 import 的 Playwright package 與 `desktop/node_modules/electron/dist/electron.exe` 都不存在；依既有 MATRIX 做法使用 npm cache 的 Electron runtime，沒有安裝依賴或改 lockfile。
5. 未執行任何 git 指令；未碰 `assets/**`、`css/**`、`js/editor/keyboard.js`、`js/editor/edit.js`、`js/editor/attachments.js`、`tests/e2e/shortcuts.matrix.mjs` 或其他並行工作流檔案。
6. 第一次 final cleanup gate 用 command line 字串找殘留程序，誤把查詢指令自己的 PowerShell process 算成 1 個；已把條件收窄為 `electron.exe` 後重跑。該輪 syntax、23 項測試與兩輪 E2E 本身均已 PASS，exit 1 只來自這個自我匹配。

## 主 session 簽字（2026-08-29）：兩輪實機 E2E（最小化→二次啟動→還原+前景+聚焦）全過、desktop 測試 23/23、自首 6 條全採認。✍️ 雙簽通過。
