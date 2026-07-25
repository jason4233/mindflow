# DESKTOP2 任務書 — Setup 安裝檔 + 資料持久化修復 + 2 分鐘磁碟備份

> 背景：使用者回報桌面版「開過的專案關掉再開就不見」。根因＝Electron 殼每次啟動用隨機 port，localStorage 按 origin 分隔，換 port＝換儲存空間。此外使用者要求標準 Setup 安裝檔（非 portable）。

## 1. 儲存來源固定化（資料遺失根修）

- Electron main process 改用 **custom protocol**（`registerSchemesAsPrivileged` + `protocol.handle`，scheme 例 `mindflow://`，standard+secure+supportFetchAPI）直接服務靜態檔案，`loadURL('mindflow://app/index.html')`。origin 永遠固定 → localStorage 永久持久。
- 若 custom protocol 與 ES modules/fetch 有相容問題，退而求其次：**固定 port**（預設 8931；被占用時往上找 8932-8940，但把「實際資料 origin」透過 `session.setPermission...` 不行——直接改為：被占用時提示並結束，請使用者關閉占用程式。優先做 custom protocol，這才是正解）。
- 舊資料救援：掃描 Electron userData partition 內既有的 `http://127.0.0.1:*` localStorage（levelDB），若找到含 `mindflow.docs.index` 的資料就合併匯入新 origin（能做多少做多少，做不到就在 NOTES 誠實說明）。

## 2. 每 2 分鐘磁碟備份（使用者明確要求的雙保險）

- Electron main 每 2 分鐘把全部文件（透過 executeJavaScript 從 renderer 取 localStorage 的 mindflow.* 全量）寫入 `userData/backups/mindflow-backup.json`（保留最近 10 份，滾動命名）。
- App 啟動時：若 localStorage 是空的但備份存在 → 自動還原最新備份並在 UI toast 告知「已從備份還原」。
- 網頁版（非 Electron）不受影響；此機制只在殼內。

## 3. NSIS Setup 安裝檔（標準程式體驗）

- electron-builder 加 `nsis` target：產出 `MindFlow-Setup.exe`——安裝精靈、**per-user 安裝（不需系統管理員）**、自動建立桌面捷徑＋開始功能表捷徑、可從「解除安裝程式」移除、oneClick:false（讓使用者選安裝路徑）。
- 保留 portable target 繼續產出（兩種都上 release）。
- 安裝檔 icon 用現有 favicon 轉的 .ico。

## 4. CI 工作流同步更新

- `.github/workflows/release.yml`：同時打包 nsis + portable，兩個資產都以固定檔名上傳 `latest` release：`MindFlow-Setup.exe`、`MindFlow-portable.exe`。

## 5. 存檔 UX 對齊 GitMind

- 左上膠囊的「已保存 HH:MM」時間戳必須在每次自動存檔後即時更新（目前有，驗證仍正常）。
- 關窗前（beforeunload / Electron 'close'）強制 flush 一次存檔＋一次磁碟備份。

## 驗收（主 session 會實測）

1. 裝 Setup.exe → 桌面捷徑出現 → 開啟建圖 → 關閉 → 重開 → **文件還在**（連做 3 次）。
2. 備份檔案在 userData/backups/ 且每 2 分鐘滾動。
3. 解除安裝乾淨（捷徑消失）。
4. CI 跑綠、latest release 兩個資產都更新。

完成寫 docs/CODEX_DESKTOP2_NOTES.md。不要 git（主 session 統一推）。
