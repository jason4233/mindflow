# SYNC-F 完成筆記

## 所有權範圍

本流只寫入以下三個檔案：

- `desktop/test/fake-github-server.mjs`
- `desktop/test/sync-e2e.test.mjs`
- `docs/CODEX_SYNC_F_NOTES.md`

未執行 git，未修改 A/B/C/D/E 所有權內檔案。

## 完成內容

### Fake GitHub server

- 純 Node `http`、loopback 隨機 port、記憶體 refs/commits/trees/blobs。
- 實作 8 個 Git Data 路由：
  - `GET /repos/:owner/:repo/git/ref/heads/:branch`
  - `GET /repos/:owner/:repo/git/commits/:sha`
  - `GET /repos/:owner/:repo/git/trees/:sha?recursive=1`
  - `GET /repos/:owner/:repo/git/blobs/:sha`
  - `POST /repos/:owner/:repo/git/blobs`
  - `POST /repos/:owner/:repo/git/trees`
  - `POST /repos/:owner/:repo/git/commits`
  - `PATCH /repos/:owner/:repo/git/refs/heads/:branch`
- 額外提供既有私有 repo 的 `GET /repos/:owner/:repo`，供 `validateRepo` 相容使用。
- `If-None-Match` 命中回 304，且不扣 fake rate limit。
- `injectUpdateRef422(count)`／`failNextUpdateRef(count)` 可精確注入 updateRef 422。
- `setOffline(true)` 直接中斷 socket，讓 `fetch` 收到真網路錯誤；切回 `false` 可恢復。
- tree 支援 `sha:null` 刪檔；blob 上限 16 MiB，已用大於 1 MiB UTF-8 JSON 實測。
- request log 只存 method/path/status，不保存 Authorization、headers 或 body。
- `snapshot()` 可檢查 repo 內容與 token 紅線。

### 雙實例 E2E harness

- 兩份隔離的記憶體 renderer localStorage、兩個隔離 userData 暫存目錄、獨立 machineId 與可控 clock。
- 完整註冊四場景：
  1. A 建圖 push，B 只經 GitHub 中樞 pull 看見。
  2. 離線雙編同文件，重連後較新版本勝出，輸方成衝突副本。
  3. A 永久刪除，tombstone 經中樞讓 B 徹底移除。
  4. B 收藏，favorite delta 經中樞回到 A。
- request log 斷言 pull-before-push；衝突場景注入一次 422，斷言重新 GET ref 後再 PATCH 成功。
- 安全斷言涵蓋 localStorage、userData 內 backup/settings/state、repo commit/snapshot、getConfig、console/logger。
- authoritative renderer writes 明確斷言不得含 `expectedUpdatedAt`。
- 另外以 frozen `sync-github.mjs` 真打 fake HTTP server，完整走過 8 端點與 422/304。

## SYNC-E 測試接縫

`sync-engine.mjs` 尚未存在，所以四個雙實例場景依 brief 以具原因的 skip 註冊。E 落地後測試會自動取消 skip，並要求：

- export `createSyncEngineForTest(options)`（優先）或 `createSyncEngine(options)`。
- 回傳 instance 提供 `syncNow()`、`sync()` 或 `run()` 其中之一。
- options 內提供 cfg/config、userDataPath、machineId、now、logger，以及 renderer 的 read/apply callbacks；harness 同時提供常用 alias，避免綁死未凍結的內部命名。
- 可選 `getConfig()`、`close()`、`dispose()` 會由 harness 驗證或清理。

若 E 檔存在但沒有上述可驅動接縫，四案會 fail，不會繼續假 skip。

## 驗證證據

- `node --check desktop/test/fake-github-server.mjs`：exit 0。
- `node --check desktop/test/sync-e2e.test.mjs`：exit 0。
- `node --test desktop/test/sync-e2e.test.mjs`：8 pass、0 fail、4 skip（SYNC-E 尚缺）。
- `node --test tests/*.test.mjs`：13 test files pass、0 fail、0 skip。
- `node --test test/*.test.mjs`（cwd=`desktop`）：109 pass、0 fail、4 skip；共 113 tests（2026-08-30 最終驗證快照）。
- mutation check：暫時讓 304 扣 rate 後，專屬測試以 `7 !== 8` 如預期失敗；還原後該測試重新通過。

## 主動自首

1. 四個雙實例 E2E 目前是合約允許的 skip，因為 `desktop/sync-engine.mjs` 尚未落地；我不宣稱 SYNC-E 真整合已通過。
2. 「離線雙編」場景在 server offline 期間只做兩邊本地編輯，沒有要求 engine 當下 sync；真 fetch 斷網與恢復由獨立 server 測試覆蓋。
3. 422 注入只拒絕 ref update，不會在背後額外建立競爭 commit；它可驗證重拉重推控制流，實際兩邊內容競爭由雙實例衝突場景覆蓋。
4. fake server 沒實作 `POST /user/repos` 自動建 repo，因 SYNC-F frozen 驗收只要求 8 個 Git Data 端點；E2E 使用預先存在的私有 repo。`ensureRepo` 的建立分支由 SYNC-B mock tests 負責。
5. adapter 真整合測第一次 RED 是我的預期值寫錯：中間的 `getBlobRaw` 已消耗一次 rate；已改成鎖定 conditional GET 前的即時額度，之後通過。
