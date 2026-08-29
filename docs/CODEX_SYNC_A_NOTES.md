# SYNC-A（sync-plan 純函數合併規劃器）實作紀錄

驗收日期：2026-08-30（Asia/Taipei）

## 所有權範圍

本流只寫入以下三個指定檔案：

- `desktop\sync-plan.mjs`
- `desktop\test\sync-plan.test.mjs`
- `docs\CODEX_SYNC_A_NOTES.md`

未修改其他五條同步流的檔案，未執行 git 指令。

## 完成內容

- 凍結 export 與簽名完整保留：`MANIFEST_SCHEMA_VERSION`、`emptyManifest()`、`buildLocalState(entries)`、`computeSyncPlan({local, remoteManifest, base, machineId, now})`、`buildConflictCopy(docJsonString, machineLabel, now)`、`computeLocalWrites({plan, pulledBlobs, localState})`。
- `sync-plan.mjs` 零 import、零 I/O、零 Electron／Node runtime 依賴；所有結果由參數決定，可供未來手機端直接共用。
- `buildLocalState` 讀取 index v2 的 active／trash／favorites 與逐檔 blob；忽略 history 和其他設定。index 缺失或損壞時，以 key 與 blob id 一致的有效文件盡力重建；有效空 index 視為使用者刻意空庫，不把 orphan blob 擅自加回 index。
- 文件內容採 state-based 三方合併。是否變更用 `updatedAt !== base.perDoc[id]` 判斷，因此時鐘倒退仍能識別變更；雙邊內容都變更時才用 timestamp 做 LWW，timestamp 相同則以 `machineId`／remote `lastWriter` 字典序穩定決勝，輸方一律列入 `conflicts`。
- active／trash 狀態與 blob 內容分開合併。單邊純 restore 即使沒有新 timestamp 仍會傳播；trash 與另一端編輯對撞時，以 `deletedAt` 對 active `updatedAt` 決勝，因此較新的內容與較新的回收筒操作都能正確勝出，且 blob 內容不會因狀態勝負消失。
- favorites 使用 base set 的三方 delta：base 內任一端取消即移除，base 外任一端新增即加入，最後只保留仍存在的文件；可傳播取消收藏。
- tombstone 採永久聯集。既有 tombstone 不會因遠端快照漏欄位而消失；第三台機器只經 GitHub manifest 即可套用，不依賴任何 peer 在線。
- 遠端 tombstone 撞上 base 後的新本機編輯時，較新編輯列入 `resurrect`；若本機永久刪除與遠端內容變更同時發生，因 localStorage 不留真實 purgedAt，採保守策略拉取遠端並列入 `resurrect`，避免靜默吞掉內容。
- `buildConflictCopy` 產生新 id、指定繁中標題尾碼與新 createdAt／updatedAt。id 由完整輸入穩定雜湊，同一輪 422 重試不會重複建立不同副本。
- `computeLocalWrites` 對缺失、損壞或 id 不符的 pulled blob fail closed；doc key 先於 `mindflow.docs.index` 出現在 `setKeys`。index thumbnail 一律取 doc blob；purge 會移除 doc、history、gamma、viewmode 四種現存 per-doc key，且不使用 `expectedUpdatedAt`。

## 四大不變式與安全紅線

1. 本模組只做 local × remote × base 的 state-based 合併，沒有 operation log。
2. Pull-before-push、updateRef 422 重試上限 3 次屬 SYNC-E orchestration；本流輸出完整 pull／push／conflict plan，不建立任何網路控制流或 force-push 捷徑。
3. 雙邊內容輸方進 `conflicts`；tombstone 與較新編輯進 `resurrect`；推導本機永久刪除但遠端已偏離 base 時也保留遠端副本，沒有已知靜默丟內容路徑。
4. Production 無 fetch、socket、peer discovery 或機器直連；GitHub 中樞以 manifest 狀態作為唯一合併輸入。

本流不接觸 token、localStorage 實體 I/O、備份、repo commit、console/log 或 renderer CAS；production source 不含 `expectedUpdatedAt`。

## TDD 與測試證據

RED／GREEN 歷程：

- 初始 `node --test test\sync-plan.test.mjs` 因 `desktop\sync-plan.mjs` 不存在得到 `ERR_MODULE_NOT_FOUND`。
- 先完成 schema／local state 後：8 pass、33 fail；失敗均為其餘三個凍結函數尚未實作。
- 完成三方合併後：34 pass、7 fail；剩餘只對應 conflict copy／local writes placeholder。
- 首輪完整實作：41/41 pass。
- 安全自審新增「本機推導 tombstone × 遠端 concurrent edit」案，先以 `pullDocs=[]` RED，再修成保留遠端副本。
- 徹底清除自審先證明 gamma／viewmode 影子 key 漏清，再補成四類 per-doc remove keys。
- 首次同步同 id／同 meta 因無 remote blob 無法證明內容相同，先以未保留輸方 RED，再改成保守 conflict。
- 最終 SYNC-A：`node --test test\sync-plan.test.mjs`，43 pass、0 fail。

最新聚合驗證：

- `node --check sync-plan.mjs`：exit 0。
- `npm test`（cwd=`desktop`）：114 tests，110 pass、0 fail、4 skip。4 個 skip 是 SYNC-F 明示等待 SYNC-E 的雙實例 E2E。
- `node --test tests\*.test.mjs`（repo root）：13 個 test files 全部通過、0 fail、0 skip。

## SYNC-E 整合交接

- `conflicts` 與 `resurrect` 是不丟資料的規劃訊號；engine 必須在 winner blob 覆寫前先取得 loser blob，呼叫 `buildConflictCopy`，再把副本加入本輪 manifest、push entries 與 renderer doc writes。
- `loserCopyFrom:'remote'` 時要額外拉 remote loser；`loserCopyFrom:'local'` 時直接用 `localState.docBlobs[id]`。`resurrect` 的來源可由原 id 是否仍存在於 localState 判斷；本機推導 tombstone × 遠端 concurrent edit 會同時出現在 `pullDocs`。
- `computeLocalWrites` 只負責凍結簽名能表達的 authoritative doc/index patch。engine 新建的衝突副本應自行把 `mindflow.doc.<newId>` 放進同一批 doc-first writes，並在最後才套用本函數產生的 index patch。
- renderer 套用 `setKeys` 時依 `Object.entries(setKeys)` 順序先寫 doc、最後寫 index；任一 doc 寫入失敗不得繼續 index，也不得推進 base。

## 主動自首

1. `base=null` 且遠端 tombstone 與本機同 id 文件碰撞時，我依 brief 的「首次同步雙向聯集、零 tombstone 套用」選擇移除該 tombstone 並重新 push 原 id。這是明確的首次連線復活政策，不是一般同步政策；有 base 後 tombstone 仍永久生效。
2. `base=null` 的兩端同 id 即使 title／updatedAt 相同，manifest 也無法證明 blob 相同，因此保守建立 conflict。若兩份內容其實完全相同，會多一份衝突副本；這是用少量重複換取不靜默覆蓋。
3. `computeSyncPlan` 無 remote blob，不能自行生成 remote loser 副本；`computeLocalWrites` 也沒有 machineLabel／now，不能自行命名副本。因此 conflict/resurrect 的 copy sequencing 必須由 SYNC-E 按上述交接完成，不能只套用 plan 的 winner。
4. purge 的 shadow key 清單覆蓋目前程式實際使用的 `mindflow.gamma.<id>` 與 `mindflow.viewmode.<id>`。如果未來新增其他 per-doc key，SYNC-A 清單或 SYNC-E 的 suffix 掃描必須同步更新。
5. 本流沒有真 GitHub repo 或雙實例 engine 對測；SYNC-A 是零 I/O 純函數，已由 43 案矩陣測試驗證。四個真雙實例場景仍依 brief 等待 SYNC-E 後由 SYNC-F 轉正。
6. 未執行 git 指令，沒有 commit／push。
