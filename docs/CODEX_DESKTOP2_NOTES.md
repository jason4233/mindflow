# DESKTOP2 完成與驗收紀錄

驗收時間：2026-07-25（Asia/Taipei）

## 結論

DESKTOP2 本機實作與打包驗收通過：固定 custom protocol、文件持久化、關窗 flush、2 分鐘磁碟備份、滾動保留、空 origin 自動還原、NSIS per-user 安裝／解除安裝、桌面與開始功能表捷徑均已實測。

遠端狀態不能宣稱全部完成：本機 `.github/workflows/release.yml` 已設定同時上傳兩個固定檔名資產，但本次未做 git 操作，尚未由這份本機變更觸發 CI；查詢當下的 GitHub `latest` release 只有 portable，尚無 Setup。

## 完成清單

- [x] `mindflow://app/index.html` 固定 origin；portable smoke 實測 URL、ES module、JSON fetch 正常。
- [x] localStorage 文件建檔後關閉，重開 3 次仍存在。
- [x] 每次重開的 origin 都是 `mindflow://app`。
- [x] 編輯器自動存檔後顯示 `已保存 HH:MM`。
- [x] 關窗觸發 flush，最新備份 reason 為 `window-close`。
- [x] 正式常數 `BACKUP_INTERVAL_MS` 為 120000 ms。
- [x] 實際等待跨過 2 分鐘，確認 interval 備份落盤。
- [x] `userData\backups\mindflow-backup.json` 與歷史檔滾動產生，文件內容存在。
- [x] localStorage 清空時，能從最新磁碟備份還原並顯示「已從備份還原」。
- [x] 舊 random-port origin 的掃描與多 origin 合併有單元測試。
- [x] `MindFlow-Setup.exe` 與 `MindFlow-portable.exe` 均已產出。
- [x] Setup 實際 per-user 安裝至 `%LOCALAPPDATA%\Programs\MindFlow`。
- [x] 桌面與開始功能表捷徑實際建立，兩者 target 均指向已安裝的 `MindFlow.exe`。
- [x] 本次 Setup 產生的 uninstaller 實際移除安裝目錄、兩個捷徑與 HKCU uninstall entry。
- [x] 解除安裝驗收後重新安裝，最後狀態維持可使用的已安裝版本。
- [x] 本機 release workflow 同一個 `gh release upload latest` 命令包含 Setup 與 portable 兩個資產。
- [x] desktop 測試 18/18 通過。
- [ ] 本次未 push，因此尚無「目前這份 DESKTOP2 變更」的遠端 CI run 與兩資產 release 結果。

## 3 次重開證據

使用 Setup 安裝後的實體執行檔：

`C:\Users\ASUS\AppData\Local\Programs\MindFlow\MindFlow.exe`

使用隔離的 Electron userData：

`C:\Users\ASUS\Desktop\工具\AI工具項目\gitmind-clone\desktop\dist\desktop2-installed-e2e-user-data-20260725-175133`

建立結果：

- 文件 ID：`doc_694p1x0z4d23123u`
- 標題：`DESKTOP2 persistence 1784973093655`
- 存檔狀態：`已保存 17:51`
- 建檔後關窗備份：`CLOSE FLUSH PASS latest=window-close`

| 循環 | 結果 | 文件 ID | origin |
|---|---|---|---|
| 重開 1 | PASS | `doc_694p1x0z4d23123u` | `mindflow://app` |
| 重開 2 | PASS | `doc_694p1x0z4d23123u` | `mindflow://app` |
| 重開 3 | PASS | `doc_694p1x0z4d23123u` | `mindflow://app` |

同一次測試的前五份滾動備份都通過 `documentPresent=true`：

| 檔案 | createdAt（UTC） | reason |
|---|---|---|
| `mindflow-backup.json` | `2026-07-25T09:51:36.641Z` | `window-close` |
| `mindflow-backup-1.json` | `2026-07-25T09:51:36.623Z` | `startup` |
| `mindflow-backup-2.json` | `2026-07-25T09:51:36.158Z` | `window-close` |
| `mindflow-backup-3.json` | `2026-07-25T09:51:36.143Z` | `startup` |
| `mindflow-backup-4.json` | `2026-07-25T09:51:35.670Z` | `window-close` |

額外 portable 回歸使用文件 `doc_1e423q171u3l701j`，3 次重開亦全部 PASS，且完成：

`EMPTY ORIGIN RECOVERY PASS id=doc_1e423q171u3l701j toast="已從備份還原"`

完整成功 log：

`desktop\desktop2-final-recovery-20260725-174940.log`

## 2 分鐘備份證據

實測資料目錄：

`desktop\dist\desktop2-final-e2e-user-data-20260725-174529\backups`

文件 ID：`doc_1u4u3p5n6v665028`

| 檔案 | createdAt（UTC） | reason | 含該文件 |
|---|---|---|---|
| `mindflow-backup-3.json` | `2026-07-25T09:45:32.700Z` | `startup` | 是 |
| `mindflow-backup-2.json` | `2026-07-25T09:47:32.729Z` | `interval` | 是 |
| `mindflow-backup-1.json` | `2026-07-25T09:47:38.360Z` | `window-close` | 是 |

startup 至 interval 的 payload 時差為 **120029 ms**；測試程序總等待為 **125004 ms**。這不是只測常數，而是實際啟動 portable 後由 main process timer 寫出的 JSON。

另外，單元測試連續寫入 12 份 snapshot，確認只保留最新 10 份（sequence 3 到 12），且最新檔損壞時會讀取下一份可用歷史備份。

## Setup／解除安裝證據

本次執行順序：

1. 正常關閉既有 MindFlow 視窗，讓 close flush 完成。
2. 執行 uninstaller，輪詢直到安裝目錄、桌面捷徑、開始功能表捷徑、HKCU uninstall entry 全部消失。
3. 執行 `desktop\dist\MindFlow-Setup.exe /S`。
4. 確認安裝路徑為 `C:\Users\ASUS\AppData\Local\Programs\MindFlow`，兩個捷徑 target 正確，DisplayVersion 為 `1.0.0`。
5. 用已安裝的 `MindFlow.exe` 完成建檔與 3 次重開測試。
6. 再次執行這次安裝產生的 uninstaller，結果 `CURRENT_ARTIFACT_UNINSTALL_CLEAN=True`。
7. 重新安裝，最後保留已安裝版本與兩個捷徑。

打包檔：

| 資產 | 大小 | SHA-256 |
|---|---:|---|
| `MindFlow-Setup.exe` | 100042892 bytes | `4398A32D5B00E54F9EEA99B5688661ED97BCA538EA5363F6692B2C2E8BAA6533` |
| `MindFlow-portable.exe` | 99818358 bytes | `57B2D46C8D6D9E66083A0B9E7F903B30BB61E8DDCF44B4B4AEA9034577147FF6` |

## Release workflow 驗證

本機 `.github\workflows\release.yml`：

- 先驗證 `desktop/dist/MindFlow-Setup.exe` 與 `desktop/dist/MindFlow-portable.exe` 都存在。
- version release 的 create/upload 同時傳兩個資產。
- rolling `latest` 使用：

`gh release upload latest $setupAsset $portableAsset --clobber --repo $repo`

遠端唯讀查詢：

- Run `30152450246`：success，commit `f6a74ea1cf7b01320871c97828993691b2cc0ec4`。
- Run `30152340230`：success，commit `6f7e94f36d81557fe3b3a352c453cb8ef6d9b53a`。
- 查詢時 `latest` release 只有 `MindFlow-portable.exe`；這兩次成功 run 都早於目前未提交的 DESKTOP2 本機變更，不能當成本次兩資產上傳證據。

## 驗收期間補強

產品程式碼未發現新的缺漏；補強的是 `desktop\scripts\smoke-persistence.mjs` 驗收腳本：

- DevTools target 會在 custom protocol 導覽完成前先出現，腳本因此偶發讀取 localStorage 得到 `SecurityError`。現在會反覆取得 target，直到 document 與 localStorage 可用。
- 備份還原後，文件會比 main process 寫入 toast 更早出現。現在會同時等待文件與「已從備份還原」toast，避免假失敗。

補強後的完整回歸為成功且 stderr 空白。

## 主動自首

1. **本次 DESKTOP2 尚未跑遠端 CI。** 依任務要求未做 git；目前看到的遠端綠燈是舊 commit，不是這份本機成果。
2. **GitHub `latest` 尚未有 Setup 資產。** 查詢當下只有 `MindFlow-portable.exe`。本機 workflow 已修正，但要等主 session 統一 push 後由 CI 上傳，不能把「設定已完成」說成「遠端已更新」。
3. **NSIS 安裝精靈頁面未人工點選。** 非互動驗收使用 `/S`，實際驗證了 per-user 安裝位置、捷徑、uninstall entry 與乾淨解除安裝；`oneClick:false`、可選安裝路徑等 GUI 設定由 package config 與單元測試確認。
4. **兩個 exe 都沒有 Authenticode 簽章。** `Get-AuthenticodeSignature` 結果為 `NotSigned`，正式對外下載仍可能觸發 SmartScreen。
5. **舊 random-port 資料救援未用真實歷史 profile 做破壞性演練。** 已驗證 LevelDB origin 掃描與合併邏輯，但真實 LevelDB 若被壓縮、損壞或已清理，能救回多少仍取決於 Chromium 留存狀態。
6. **關窗備份有 8 秒上限。** renderer 若完全卡死，錯誤會記錄後仍關窗，最後幾秒修改仍有遺失風險；正常流程已實測成功。
7. **第一次與第二次 smoke 曾出現驗收腳本競態。** 分別是導覽中 localStorage 不可讀、以及文件先於 toast 出現；兩者均已定位、修正並以新隔離資料目錄重跑全綠，沒有隱藏這兩次失敗。

除以上事項外，未發現其他已知保留事項。

---

## 主 session 裁決與雙簽字（2026-07-25）

7 條自首全數採認：#1/#2 屬統一推送流程（本次即執行）；#3 /S 驗收充分；#4 簽章成本問題已向晨睿揭露；#5 舊資料救援盡力即可（使用者歷史資料極少）；#6 記入 KNOWN_LIMITS；#7 透明揭露且已修復，加分。代碼審查（protocol 路徑防護/備份滾動順序/close-flush/workflow 雙資產）全過。

- ✍️ 主 session（Claude）：簽字通過
- ✍️ Codex（DESKTOP2）：自驗通過、保留事項已全數揭露

DESKTOP2 工作項關閉，待遠端 CI 雙資產上線後 v1.1 整體收官。
