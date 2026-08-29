# CODEX SYNC-FIX NOTES

日期：2026-08-30

## 缺陷狀態

| # | 等級 | 狀態 | 修復與正式回歸 |
|---|---|---|---|
| 1 | critical | 已修復 | tombstone 改為三方 delta；base 有、remote 無視為刻意移除。purge 直接比較 `local.updatedAt` 與 `purgedAt`。正式測試覆蓋 C 復活 → A 合併 → C 再同步三機三輪，唯一副本不再被反殺。 |
| 2 | major | 已修復 | `buildLocalState` 回傳選填 `quarantinedIds`；key 存在但 JSON 損壞或 id 不符時禁止推斷永久刪除、禁止 push，健康 remote 可 pull 修復。engine 以非阻斷 `status.warning` 回報隔離 id。 |
| 3 | minor | 已修復 | index row 沒有有效 blob 時不再加入 `local.docs`，因此不會進入 push/manifest；同步會產生修正後 index，不再因 `thumbnailFromBlob(undefined)` 整輪中止。 |
| 4 | minor | 已修復 | index 缺失或損壞時加 `rebuilt:true`；該輪 favorites 與 trash/restore 狀態以 base/remote 為準，本機重建出的空 favorites/active 不再被當成使用者意圖。 |
| 5 | minor | 已修復 | 同毫秒勝負後，若 remote `lastWriter` 已跨過本機 base，敗方 follow-up 強制 pull 遠端勝方 blob；index 與實際文件內容同步收斂。 |
| 6 | major | 已修復 | repo 建立後以 case-insensitive `full_name` 驗證 `cfg.repo`；不符即明確失敗。404 後 POST 422 name-exists 轉成 fine-grained PAT Repository access 指引。 |
| 7 | major | 已修復 | `/user/repos` 加 `auto_init:true` 與 configured `default_branch`。既有空 repo 的 getRef 409 改為「建立第一個 commit／刪除後讓 MindFlow 重建」指引。 |
| 8 | minor | 已修復 | settings JSON SyntaxError 時原檔 rename 為 `sync-settings.json.corrupt*` 保存，安全停用並透過 getConfig 選填 `warning` 呈現；重新儲存有效設定後 warning 消失。 |
| 9 | major | 已修復 | sync-applied 先 commit 活躍 contenteditable session，再走既有 dirty/CAS 橫幅；850ms reload callback 觸發前再次檢查 session/dirty。Playwright 實測兩個競態均為 reload=0、文字保留、橫幅可見。 |
| 10 | minor | 已修復 | `syncNow` 回傳與 sync status 增加選填 `warning`；public repo 保持同步成功但 UI 使用黃色非阻斷警告，狀態卡與手動同步 feedback 都可見。 |
| E4 | self-report | 已修復 | `sync-state.json` 增加選填 `lastSyncAt`，不改既有欄位與 IPC channel。 |

## 正式測試收編

`desktop/test/sync-plan.test.mjs` 現含 55 案，已收編：

- 三機三輪 initial-sync resurrection。
- tombstone direct-time purge gate。
- corrupt blob quarantine 與 phantom tombstone 防護。
- orphan index row / missing blob 修復。
- rebuilt index 的 favorites/trash 保護。
- equal-millisecond loser follow-up 收斂。
- ensureRepo owner mismatch、422 PAT 指引、auto-init、empty repo 指引。
- settings corruption quarantine。
- sync-applied edit/reload guard。
- public repo 非阻斷 warning channel。

另外在 `desktop/test/sync-engine.test.mjs` 收編 public repo warning、quarantine status 與 settings warning IPC；`desktop/test/sync-github.test.mjs` 更新 auto-init contract。

## 驗證快照

- `npm test`（cwd=`desktop`）：136/136 pass，0 fail，0 skip。
- `node --test tests/*.test.mjs`（repo root）：13/13 runner pass，0 fail。
- 9 個改動 JS/MJS：`node --check` 全部 exit 0。
- Playwright 真頁面：編輯 session 先存在、以及 reload timer 排定後才開始編輯，兩案皆 `reloads=0`、CAS banner 存在、輸入文字仍在 DOM。
- scratch probe 的核心結果：三機三輪不再 data loss；corrupt key 不產生 tombstone；missing blob 不再 throw；rebuild 保留 favorites/trash；tie follow-up 產生 `pullDocs`。

## 自首

1. scratchpad 的 probe 是「舊缺陷展示腳本」，不是修復後 assertion harness。三支原檔不能直接作為綠燈：`probe-sync-github.mjs` 對 owner mismatch 沒有 catch，正確 throw 後反而 exit 1；`probe-tie.mjs` 在 Windows 使用無 `file:///` 的裸 `C:/` ESM import，且修復後排入 pull 卻不提供 `pulledBlobs`；`probe2.mjs` 的 P2-F 同樣不提供新要求的 pulled blob。沒有修改未授權的 Temp 腳本；等價情境已改成有正確 fixture 與 assertion 的正式測試並全綠。
2. owner mismatch 是在 GitHub POST 回應後驗證，因此能阻止「錯誤回報成功」，但 GitHub 可能已在 token 使用者帳號建立同名 private repo。要完全消除副作用需新增 authenticated-user preflight 或 org create API，超出凍結 adapter 流程；目前錯誤訊息會要求修正 owner/PAT。
3. equal-millisecond follow-up 以 `lastWriter` 強制 pull，安全優先；當另一台只改了別份文件時，可能對相同 timestamp 的未變文件多做一次 pull，但不會覆寫較新的 timestamp 或製造資料遺失。
4. 本輪未做真 GitHub repo 對測：沒有使用或索取使用者 PAT，也沒有建立外部 repo。fake GitHub HTTP E2E 與完整 desktop suite 已通過。
5. 全程未執行 Git 指令、未 commit。

## 主 session 簽字（2026-08-30）：12 項逐條驗證狀態表+正式回歸收編（sync-plan 55 案）+136/136 零 skip。✍️ 雙簽通過（待真 repo 實測後 Stage A 正式放行）。
