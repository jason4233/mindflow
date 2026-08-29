# SYNC-B（GitHub REST adapter）實作紀錄

驗收日期：2026-08-30（Asia/Taipei）

## 範圍

本流只寫入以下三個 owned／指定檔案：

- `desktop\sync-github.mjs`
- `desktop\test\sync-github.test.mjs`
- `docs\CODEX_SYNC_B_NOTES.md`

未修改其他五條同步流的檔案，未執行 git 指令。

## 實作

- 保持凍結介面：`SyncHttpError` 與 `getRef`、`getCommit`、`getTreeRecursive`、`getBlobRaw`、`createBlob`、`createTree`、`createCommit`、`updateRef`、`validateRepo`、`ensureRepo` 全數按原簽名 export。
- 僅使用 `globalThis.fetch`、`Response`、`Buffer` 等 Node/Electron 全域能力，零 npm runtime 依賴。
- 共用 request 層統一 GitHub API version、Bearer token、JSON body、HTTP 錯誤與網路錯誤分類；GitHub error body 或 fetch exception 即使回顯 PAT，也會先遮蔽且不保留含 secret 的 nested cause。
- `getRef` 支援 `If-None-Match`；304 不讀空 body，回傳 `notModified:true` 並保留 ETag。
- `getTreeRecursive` 使用 `?recursive=1`，只建立 blob `byPath`；GitHub 回傳 `truncated:true` 時拒絕提供部分遠端狀態，避免靜默漏資料。
- `getBlobRaw` 固定使用 Git blobs API 的 base64 payload，再以 UTF-8 解碼；不走有 1 MiB JSON 內容限制的 Contents API。
- `createTree` 保留 `sha:null` 刪除語意；`updateRef` 固定 `force:false`，HTTP 422 轉為 `SyncHttpError{status:422,retryable:true}`，供 SYNC-E 重拉、重合、重推。
- `validateRepo` 只有 repository GET 的 404 轉成 `exists:false`；401/403/其他 404 與 5xx 保持錯誤。`ensureRepo` 對不存在的 repo 呼叫 `POST /user/repos` 並強制 `{private:true}`，無寫入權限時提供 fine-grained PAT 的 `Contents: Read and write` 指引。
- `x-ratelimit-remaining` 在物件型回傳值上轉成數字 `rateRemaining`；字串／SHA 型凍結回傳不改型別。

## TDD 與測試證據

RED：

- 首案 `getRef` 在 source 不存在時為 0/1，因 export 缺失按預期失敗。
- 擴充完整矩陣後為 2/23 通過、21/23 失敗；失敗原因為 304 空 body 尚未處理及其餘凍結函數尚未實作。
- 安全自審把 fetch exception 改成回顯測試 PAT 後為 22/23 通過、1/23 失敗；確認原始 exception 會洩漏 token，再於 request boundary 修正並補上 HTTP error body 回顯案。

GREEN：

- `node --test desktop\test\sync-github.test.mjs`：24/24 通過。
- 覆蓋 mock fetch 全函數、預設 apiBase/branch、304/ETag、rate header、recursive tree、truncated tree、大於 1 MiB UTF-8 blob、`sha:null` tree deletion、non-force ref update、422 retryable、repo validate/create/permission guidance、401/403/404/500/503、fetch 失敗分類，以及 HTTP body／exception 回顯 PAT 的遮蔽。
- SYNC-F 的 active integration test 直接 import 本 adapter，經本地 fake HTTP server 完成 8 個 frozen endpoints、422 注入後重試、304/ETag/rateRemaining、raw blob 與 token 不進 repo snapshot；該案通過，但檔案所有權仍屬 SYNC-F。
- `node --test tests\*.test.mjs`：根層完整測試 exit 0，無既有回歸。
- `cd desktop; node --test test\*.test.mjs`：113 案中 109 通過、0 失敗、4 個依 SYNC-E 的預期 skip。

## 四大不變式／安全紅線對應

- State-based 三方合併與 LWW 衝突副本屬 SYNC-A；本 adapter 不加入 operation log 或自行裁決文件勝負。
- Pull-before-push 的 orchestration 屬 SYNC-E；本流提供 ETag pull primitives，且把 updateRef 422 明確標成 retryable，不在 adapter 內做盲目 force push。
- 本流不刪 localStorage、不處理 tombstone，因此不建立靜默丟資料路徑；recursive tree 截斷會直接失敗。
- 所有 I/O 只對 GitHub REST API，不含電腦間直連、peer discovery 或依賴另一台機器在線的路徑。
- token 只存在 Authorization request header；不寫 localStorage、repo blob、測試 snapshot、console 或 log。

## 主動自首

1. 本流沒有使用真實 GitHub PAT／真實 private repo 做外部網路對測，避免建立外部狀態；REST 契約以全域 fetch mock 完整驗證，另由 SYNC-F 本地 fake HTTP server 對本 adapter 做 round-trip。fake server integration 不是本流擁有的測試。
2. `updateRef` 只負責把 422 標成 retryable；「重拉重合重推、上限 3 次」必須由尚未發射的 SYNC-E engine 實作，本流沒有越權加入 orchestration。
3. `.rateRemaining` 只掛在物件型回傳。`getBlobRaw` 與 create/update 函數依凍結介面回傳 primitive／`undefined`，不能在不改回傳型別的前提下附加 property。
4. 並行期間完整 desktop suite 曾因 SYNC-A 的 `buildConflictCopy`／`computeLocalWrites` placeholder 出現 7 個 RED；本流沒有越界代修。SYNC-A 完成後已重跑，最終為 109 通過、0 失敗、4 個等待 SYNC-E 的預期 skip。
5. 沒有執行 git 指令，依任務要求也沒有 commit。
