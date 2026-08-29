# Stage A 任務書 — 跨電腦同步（GitHub 私有 repo）／介面凍結版

> 總計劃：`C:\Users\ASUS\.claude\plans\app-gitmind-hashed-waffle.md`（Stage A 章節）。本文件是六條 Codex 流（A/B/C/D/E/F）的合約：**介面簽名一字不可改**，實作內部自由。共同鐵則：非互動模式立即動手、只改自己擁有的檔案、tests 全綠、寫 `docs/CODEX_SYNC_<流名>_NOTES.md`（含主動自首章節）、不要 git。

## 四大不變式（違反=打回）

1. State-based 三方合併（local × remote × base），不是操作日誌
2. Pull-before-push；updateRef 422 → 重拉重合重推，上限 3 次
3. 永不靜默丟資料：LWW 輸方一律成「衝突副本」；tombstone 撞上較新編輯 → 復活為副本
4. **雲端中樞制（晨睿要求）**：GitHub repo 是唯一真相來源，機器之間零直接通訊——任何一台關機都不影響其他機器與雲端的同步；設計中不得出現任何依賴「另一台機器在線」的路徑

## 凍結介面

### `desktop/sync-plan.mjs`（流 A；零 I/O、零 Electron 依賴的純函數，未來手機共用）

```js
export const MANIFEST_SCHEMA_VERSION = 1
export function emptyManifest() // → {schemaVersion:1, docs:{}, favorites:[], tombstones:{}, lastWriter:null}
// manifest.docs[id] = {title, createdAt, updatedAt, state:'active'|'trashed', deletedAt?}
// tombstones[id] = purgedAt(ISO)

export function buildLocalState(entries)
// entries = {['mindflow.docs.index']: json字串, ['mindflow.doc.<id>']: json字串, ...}（backup normalizeMindflowEntries 的輸出）
// → {docs: {id: {title, createdAt, updatedAt, state, deletedAt?}}, favorites: [id], docBlobs: {id: docJson字串}}
// 忽略 mindflow.history.*；index 損壞時盡力從 doc keys 重建

export function computeSyncPlan({local, remoteManifest, base, machineId, now})
// base = {manifest, perDoc: {id: lastSyncedUpdatedAt}}（首次同步 base=null → 視為雙向聯集、零 tombstone 套用）
// → {
//   pushDocs: [id], pullDocs: [id],
//   conflicts: [{id, winner:'local'|'remote', loserCopyFrom:'local'|'remote'}],
//   purgeLocal: [id],            // tombstone 生效：本地徹底清除
//   resurrect: [{id}],           // tombstone 撞較新編輯 → 該 doc 轉衝突副本
//   favoriteAdds: [id], favoriteRemoves: [id],
//   trashSet: [{id, deletedAt}], trashRestore: [id],
//   nextManifest,                // 合併後要推上遠端的 manifest（含 lastWriter）
//   nextPerDoc                   // 同步成功後的新 base.perDoc
// }

export function buildConflictCopy(docJsonString, machineLabel, now)
// → {id: 新id, title: 原題+`（衝突副本・${machineLabel} ${MM-DD HH:mm}）`, json: 新doc字串}

export function computeLocalWrites({plan, pulledBlobs, localState})
// pulledBlobs = {id: docJson字串}
// → {setKeys: {storageKey: value字串}, removeKeys: [storageKey], }
// 規則：index 最後寫（doc keys 全成功才 patch index）；index thumbnail 從 doc blob 取
```

### `desktop/sync-github.mjs`（流 B；只用全域 fetch，零 npm 依賴）

```js
// cfg = {apiBase='https://api.github.com', token, repo:'owner/name', branch='main'}
export class SyncHttpError extends Error {} // .status, .retryable(bool)
export async function getRef(cfg, {etag}={})      // → {sha, etag, notModified:bool}；304→notModified:true 且不計 rate limit
export async function getCommit(cfg, sha)          // → {treeSha}
export async function getTreeRecursive(cfg, treeSha) // → {byPath: {path: {sha, size}}}
export async function getBlobRaw(cfg, blobSha)     // → utf-8 字串（走 git/blobs base64 解碼，免疫 1MB JSON 限制）
export async function createBlob(cfg, content)     // → sha
export async function createTree(cfg, {baseTreeSha, entries}) // entries=[{path, sha|null}]（null=刪除）→ treeSha
export async function createCommit(cfg, {message, treeSha, parentSha}) // → commitSha
export async function updateRef(cfg, commitSha)    // 422 → throw SyncHttpError{status:422, retryable:true}
export async function validateRepo(cfg)            // → {exists, private, canWrite}
export async function ensureRepo(cfg)              // 404→POST /user/repos {private:true}；無權→throw 帶指引訊息
// 全部函數讀 x-ratelimit-remaining，掛在回傳物件 .rateRemaining（可選）
```

### `desktop/preload.cjs` + `desktop/sync-settings.mjs`（流 C）

```js
// preload 暴露 window.mindflowSync（contextBridge；sandbox:true 相容 → 必須 CJS）
getConfig()   // → {enabled, repo, hasToken}  ※永不回傳 token 本體
setConfig({token?, repo?, enabled?}) // → {ok, error?}；token 只寫不讀
syncNow()     // → {ok, error?}
getStatus()   // → {state:'disabled'|'idle'|'syncing'|'offline'|'error', lastSyncAt, lastError, docCount}
onStatus(cb)  // 狀態變更推播；回傳 unsubscribe
// ipc channel 名：mindflow-sync:get-config / set-config / sync-now / get-status / status-changed

// sync-settings.mjs：userData/sync-settings.json
// {enabled, repo, branch, tokenCipher(base64)}；safeStorage 加密；不可用時拒存並回報
export function loadSyncSettings(userDataPath)
export function saveSyncSettings(userDataPath, patch)  // token 傳入即加密
export function getDecryptedToken(settings)            // 只給 main process 內部用
```

### 狀態檔（流 E 實作，先凍結 schema）：`userData/sync-state.json`
`{lastSyncedCommitSha, baseManifest, perDoc:{id:updatedAt}, machineId, etag}`；machineId 首次生成（os.hostname + 隨機4碼）。

## 流別分工與檔案所有權

| 流 | 擁有檔案 | 核心驗收 |
|---|---|---|
| **SYNC-A** | `desktop/sync-plan.mjs`、`desktop/test/sync-plan.test.mjs` | 合併全矩陣：雙邊編輯衝突／trash-restore 對撞（deletedAt vs updatedAt 較新者贏）／favorites 三方 delta（取消收藏可傳播）／tombstone 三台機器情境／tombstone 撞新編輯復活副本／時鐘倒退／首次同步 base=null 聯集／index 損壞重建。≥20 案 |
| **SYNC-B** | `desktop/sync-github.mjs`、`desktop/test/sync-github.test.mjs` | mock fetch 全函數；304/ETag；422 retryable；大 blob（>1MB）走 raw；rate header 透傳；錯誤分類（401/403/404/5xx） |
| **SYNC-C** | `desktop/sync-settings.mjs`、`desktop/preload.cjs`、`desktop/test/sync-settings.test.mjs` | safeStorage 加密往返（Electron 環境測試可 mock safeStorage）；token 永不出現在 getConfig 回傳；settings 檔無明文 token |
| **SYNC-D** | `js/settings.js`(新)、`js/dashboard.js`（設定按鈕+側欄同步狀態+`mindflow:sync-applied` 重繪）、`js/editor/shortcuthelp.js`（···設定接入）、`js/editor/main.js`（sync-applied：開啟中文件乾淨→toast+重載；髒→交給既有 CAS 橫幅）、`css/features.css` | 設定 dialog（PAT password 欄/repo/開關/狀態列/立即同步/首次流程含 repo 自動建指引）；web 版無 mindflowSync → 顯示「同步僅桌面版」；Playwright 自測 |
| **SYNC-F** | `desktop/test/fake-github-server.mjs`、`desktop/test/sync-e2e.test.mjs` | 本地 HTTP 實作 8 端點（含 422 注入、304、斷網模擬開關）；雙實例 E2E 四場景（B 見 A 的圖／離線雙編→一贏+一副本／永久刪傳播／收藏傳播）——E2E 依賴流 E 完成後才能全綠，先寫好 harness 與場景，E 完成前可 skip 標記 |
| **SYNC-E**（等 A+B+C 完成後啟動） | `desktop/sync-engine.mjs`、`desktop/main.mjs`、`desktop/package.json`、`desktop/test/sync-engine.test.mjs` | backupQueue→storageQueue 統一；觸發五時機（startup 在備份還原後／15s 指紋+45s debounce push／5min ETag pull／focus 10s 節流／關窗 10s timeout flush）；單一 executeJavaScript 原子套用+失敗不推進 base；build.files 補齊 |

## 安全紅線（流 C/E/F 都要各自斷言）

- token 不得出現在：localStorage 任何 key、備份檔、repo 任何 commit、getConfig 回傳、console/log
- 同步寫入 renderer 不得使用 expectedUpdatedAt（sync 是權威寫入）；編輯器 CAS 行為不得被改動

## 里程碑

A+B+C+D+F 並行 → 我驗收簽字 → 發射 E 整合 → F 的 E2E 轉正全綠 → 我做雙實例真測 + 真 GitHub repo 對測 → 雙簽 → commit/push/發版。
