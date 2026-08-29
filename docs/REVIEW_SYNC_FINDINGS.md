# REVIEW_SYNC 確認缺陷清單（三維度審查+對抗性驗證，發版前必修）

## 1. [critical] 首次同步復活的文件在下一輪被 tombstone 聯集反殺，唯一副本靜默清除（違反不變式 3 與 base=null 不得誤刪）
- 檔案: desktop/sync-plan.mjs:273 | 維度: merge-correctness
- 細節: line 294-297 依 brief 在 initialSync 時刪除撞上本機文件的 remote tombstone 並重新上傳原 id；但 line 273 的 tombstones = {...base.tombstones, ...remote.tombstones} 是 append-only 聯集，任何一台 base 裡還留著該 tombstone 的機器（例如當初執行永久刪除的 A）下一次 sync 都會把 tombstone 加回 manifest 並把該 doc 從 docs 刪掉。之後 C 再 sync 時，localChanged = updatedAt !== baseStamp 為 false（C 第一輪已把自己的 updatedAt 寫進 base），line 304 的守門直接走 purgeLocal，完全不比較 updatedAt 與 purgedAt——即使 C 的副本內容比刪除時間更新也一樣被清掉，且無 conflict/resurrect。實測（實 import 模組跑三輪）：R1 C 初次同步 pushDocs=[X]、tombstone 移除；R2 A 合併後 docs=[]、tombstones=[X]；R3 C purgeLocal=[X]、resurrect=[]。復現腳本：C:\Users\ASUS\AppData\Local\Temp\claude\C--Users-ASUS-Desktop----AI----\664fbcc5-98c6-459a-8daa-b50c20a69216\scratchpad\probe1.mjs（S2）與 probe3.mjs。NOTES 自首第 1 點只承認「首次連線復活政策」，未揭露復活只能存活一輪。修法方向：tombstone 也做三方（base 有、remote 沒有 → 視為刻意移除，不回加），或 initial-sync 復活時改配新 id 徹底繞開 tombstone。若 C 在復活後有編輯且時鐘正常則會轉 resurrect 副本（probe3 已驗），但未編輯（最常見）與時鐘落後的編輯都會靜默消失。
- 觸發場景: A 永久刪除 doc X 並同步；C（sync-state 被重置或從備份還原的機器）本地持有 X 的唯一或較新副本並做首次同步——X 短暫回到雲端；A 下一次自動同步把 tombstone 從自己的 base 加回並移除 X；C 再下一次自動同步 purgeLocal 把本地 X 徹底刪除，全程無衝突副本、無任何提示。

## 2. [major] 本地儲存損壞被推斷為「使用者永久刪除」，幽靈 tombstone 會清除其他機器上的健康副本
- 檔案: desktop/sync-plan.mjs:276 | 維度: merge-correctness
- 細節: line 276-289 把「base.docs 有、localState.docs 沒有」一律推斷為本機永久刪除並產生 tombstone。但 buildLocalState 會丟棄解析失敗或 id 不符的 blob（line 61-67），index 損壞重建時也只收錄可讀 blob（line 75-81）——entries 裡明明還存在 mindflow.doc.<id> 這個 key（只是值壞了），卻被當成使用者刻意刪除。line 285 的保護只涵蓋 remote 已偏離 base 的文件；remote 未變時直接 tombstone。實測（probe2.mjs P2-B）：index 與單一 doc blob 同時損壞（Electron localStorage 的 LevelDB 損壞常一次波及多 key）→ B 推出 tombstones={X}；持有乾淨副本的 A 下一輪 purgeLocal=[X]、resurrect=[]——單機損壞演變成全艦隊靜默刪除健康資料。修法：buildLocalState 已能看到原始 entries，key 存在但不可讀的 doc 應標記（如回傳 quarantinedIds）並排除在 purge 推斷之外；只有 key 真正不存在才可推斷為永久刪除。凍結簽名允許在回傳物件上加欄位。
- 觸發場景: 機器 B 一次 localStorage 損壞事件同時弄壞 index 與 doc X 的 blob（或僅 index 損壞且 X 的 blob 解析失敗）→ B 同步時把 X 判成已永久刪除並推送 tombstone → 機器 A/C 上完好未動的 X 在下一次同步被 purgeLocal 徹底清除，無副本、無提示。

## 3. [minor] index 有列但 blob 缺失時 computeLocalWrites 必然拋錯，同步每輪全滅直到手動修復
- 檔案: desktop/sync-plan.mjs:484 | 維度: merge-correctness
- 細節: index 列存在但 mindflow.doc.<id> 缺失（真實路徑：store.js permanentlyDeleteDocument 在 removeItem(blob)（line 304）與 writeIndex（line 314）之間崩潰/關窗；或部分還原）時，buildLocalState 產出 docs 有 X 但 docBlobs 沒有 X；computeSyncPlan 照樣把 X 放進 pushDocs 與 nextManifest；computeLocalWrites 在 line 484 對 effectiveBlobs[X]=undefined 呼叫 thumbnailFromBlob 直接 throw（訊息還誤稱「缺少遠端文件 pulled blob」，其實是本地文件），整份 setKeys/removeKeys 產不出來——之後每個同步週期都在同一點失敗，pull 也一併停擺。fail-closed 沒有資料損失，但同步永久不可用且錯誤訊息誤導診斷。實測：probe2.mjs P2-A。engine（SYNC-E）拿到 pushDocs 裡沒有 blob 的 id 也無從推送，交接文件未涵蓋此情形。
- 觸發場景: 使用者在回收筒永久刪除文件的瞬間應用崩潰（blob 已刪、index 未寫回）→ 之後每次同步 computeLocalWrites 拋「缺少遠端文件 pulled blob」，同步狀態永遠 error，任何新文件都不再上雲，直到使用者再手動永久刪除該殘留列。

## 4. [minor] index 損壞重建的副作用（收藏歸零、回收筒全部復活）被當成使用者意圖推播到全部機器
- 檔案: desktop/sync-plan.mjs:80 | 維度: merge-correctness
- 細節: index 損壞時 buildLocalState 回傳 favorites=[] 且所有文件 state='active'（line 75-81，註解已承認本地取捨）。但 computeSyncPlan 隨後把這個殘缺狀態當成三方合併的本地意圖：mergeFavorites 判定「base 有、local 沒有＝刻意取消收藏」→ nextManifest.favorites 清空並推送（下一台機器再產生 favoriteRemoves）；stateWinner 判定「base=trashed、local=active、remote 未變＝單邊 restore」→ 全部回收筒文件在所有機器上復活。實測：probe2.mjs P2-C（merged favorites=[]、T 變 active）。無內容損失，但單機損壞造成全艦隊收藏/回收筒狀態被改寫。修法：buildLocalState 重建路徑可回傳 rebuilt:true 之類旗標，computeSyncPlan 據此讓 favorites 與 state 在該輪偏向 remote/base 而非本地。
- 觸發場景: 機器 B 的 index 損壞（blob 都健康）→ B 同步後雲端 favorites 清空、回收筒文件全部轉 active → A/C 下一輪同步收藏全消失、回收筒傾巢而出，使用者以為被駭或掉資料。

## 5. [minor] 毫秒級同刻衝突的敗方機器永不拉取勝方內容，index 標題與 blob 內容長期分裂
- 檔案: desktop/sync-plan.mjs:339 | 維度: merge-correctness
- 細節: 變更偵測完全依賴 updatedAt !== baseStamp。當兩機在完全相同的 ISO 毫秒各自編輯（tie-break 專門處理的情境）：勝方（machineId/lastWriter 字典序）推送後，敗方下一輪看到 remote updatedAt 與自己的 baseStamp 相同 → remoteChanged=false、localChanged=false → 不 pull、不 conflict（line 332-343），mergedDocs 取 remote meta。實測 probe2.mjs P2-F：index 列標題變成勝方的 vB、縮圖與實際開檔內容仍是敗方的 vA，且 mindflow.doc.X 不在 setKeys。分歧持續到該文件下次被編輯為止。機率極低（需同毫秒），但這正是 tie-break 宣稱要決定性處理的邊界；probe1.mjs S5 已驗 tie-break 本身雙機收斂一致，問題只在後續收斂。可考慮 manifest 加內容 hash 或在 tie 情境強制 pull。
- 觸發場景: A、B 在同一毫秒各自存檔（或匯入相同 updatedAt 的備份後各自未再編輯）→ B 勝出推送 → A 的儀表板顯示 B 版標題但開啟後是 A 版內容，雲端與 A 本地內容不一致且無任何衝突提示，直到有人再編輯該文件。

## 6. [major] ensureRepo 建錯地方也回報成功：不驗證建出的 repo full_name 是否等於 cfg.repo
- 檔案: desktop/sync-github.mjs:271 | 維度: security-adapter
- 細節: GET /repos/{owner}/{name} 回 404 有兩種意義：repo 不存在，或 fine-grained PAT 無權看見（GitHub 對無權限 repo 一律回 404）。ensureRepo 一律走 POST /user/repos，而該端點只會把 repo 建在「token 使用者」名下。mock 實測：cfg.repo='someorg/mindmaps'、POST 回傳 full_name='tokenuser/mindmaps'，ensureRepo 照樣回 {exists:true, private:true, canWrite:true}，完全不比對 body.full_name 與 cfg.repo。衍生第二型：repo 其實存在但 PAT 未授權該 repo → 404 → 嘗試建立 → 422 'name already exists on this account'，此 422 未被包裝、無任何 PAT 指引（程式只包 401/403，違反任務書「錯誤訊息對使用者有指引」）。修法：POST 後比對 body.full_name（case-insensitive）與 cfg.repo，不符即丟帶指引的 SyncHttpError；422 name-exists 包裝成「repo 已存在但 PAT 未授權存取，請在 fine-grained PAT 勾選該 repo」。註：desktop/test/sync-github.test.mjs:316 只測 owner==token user 的情境，測不到此 bug。
- 觸發場景: 使用者填 org repo（如 'mycompany/mindmaps'）或 owner 打錯字 → ensureRepo 在自己帳號下建了一個同名 repo 並回報成功 → 之後每次 getRef/updateRef 都對 cfg.repo 打 → 永遠 404，同步永久失敗，且使用者帳號多出一個莫名其妙的空 repo。或：repo 已存在但 fine-grained PAT 沒勾它 → 看到毫無指引的 'name already exists on this account'。

## 7. [major] ensureRepo 建的空 repo（無 auto_init）是死路：首次同步必失敗，凍結介面無法 bootstrap
- 檔案: desktop/sync-github.mjs:292 | 維度: security-adapter
- 細節: POST /user/repos 只送 {name, private:true}，沒有 auto_init:true → 建出的 repo 零 commit、零 branch。GitHub Git Database API（GET git/ref、POST git/blobs 等）對空 repo 回 409 'Git Repository is empty.'。mock 實測 adapter 對 409 的處理：SyncHttpError{status:409, retryable:false}，訊息無任何指引；且凍結介面沒有 createRef，createCommit 恆送 parents:[parentSha]（實測 parentSha=null 時 body 為 parents:[null] → 422），engine 完全沒有合法路徑做出第一個 commit + ref。也就是任務書設計的首次流程「repo 自動建 → 立即同步」在真 GitHub 上必然卡死。修法（不動凍結簽名）：POST body 加 auto_init:true（可加 default_branch: cfg.branch），建出來就有 initial commit 與 branch，getRef/updateRef 全部照常。另注意 desktop/test/fake-github-server.mjs:64 #seedRepository 預埋了 initial commit 且未實作 POST /user/repos，所以 F 流的 E2E 永遠測不到這條死路——真 GitHub 對測時才會爆。
- 觸發場景: 新使用者首次設定：ensureRepo 成功建立私有 repo → 首次 syncNow 呼叫 getRef → GitHub 回 409 'Git Repository is empty.' → 非 retryable 錯誤、無指引，同步永遠停在 error 狀態，唯一解法是使用者自己去 GitHub 手動塞一個 commit。

## 8. [minor] loadSyncSettings 把損壞的 settings JSON 靜默重設為預設值，token 與 enabled 無聲消失
- 檔案: desktop/sync-settings.mjs:64 | 維度: security-adapter
- 細節: catch 裡 SyntaxError 與 ENOENT 同等對待、直接回 DEFAULT_SETTINGS（enabled:false、tokenCipher:null）。sync-settings.json 若因斷電/磁碟問題半損（原子 rename 保護的是本程式的寫入，擋不住外部損壞），同步會無聲關閉、加密 token 遺失，UI 只會顯示未啟用，使用者不知道發生過什麼。建議至少把損壞檔改名保留（如 sync-settings.json.corrupt）並讓 main process 能回報一次性警告，而不是與「檔案不存在」無差別處理。安全面沒問題（不會洩漏，只是可用性）。
- 觸發場景: sync-settings.json 被截斷（例如系統崩潰時檔案半寫）→ 下次啟動 loadSyncSettings 回預設值 → 同步靜默變成停用、hasToken=false，使用者以為同步還開著，直到發現兩台機器早就沒在同步、需重新輸入 PAT。

## 9. [major] sync-applied 時進行中的文字編輯 session 被誤判為乾淨，未送出文字靜默遺失（實測重現）
- 檔案: js/editor/main.js:323 | 維度: ui-preload-integration
- 細節: 編輯器的 mindflow:sync-applied handler 只檢查 `dirty` 旗標，但 MindFlow 的 dirty 是在 command commit 後才設立——使用者雙擊節點進入 contenteditable 編輯 session、打字尚未 blur/Enter 時，dirty 仍為 false。此時 handler 走「乾淨路徑」：toast + 850ms 後 location.reload()。reload 觸發 beforeunload 的 saveNow(true)，它會 edit.commit() 把打到一半的文字轉成 command 並嘗試寫入，但因同步引擎已權威改寫該 doc 的 updatedAt，CAS（expectedUpdatedAt）擲出 MindflowSaveConflictError——showConflictBanner() 在頁面卸載瞬間顯示後隨即消失，文字未寫入，reload 後載入雲端版本，本機輸入無聲消失。已在瀏覽器實測完整重現（模擬引擎改寫 localStorage updatedAt + 派發事件：tookCleanPath=true → pageReloaded=true → typedTextLost=true）。同一 handler 還有第二個等價競態：乾淨路徑排定 reload 後、850ms 視窗內使用者開始編輯（dirty 轉 true），timer 不會取消也不在觸發時複查，同樣以 CAS 衝突+卸載收場。兩者都違反任務書「髒→交給既有 CAS 橫幅」與不變式 3「永不靜默丟資料」的意圖。建議修法：(1) handler 開頭先 `if (edit?.session && !edit.session.finishing) edit.commit()`（與 saveNow 同款堵洞），讓在編輯中的內容轉為 dirty 走 CAS 橫幅；(2) reload timer callback 內觸發前複查 `dirty || edit?.session`，成立則改走衝突橫幅而非 reload。其餘路徑實測正確：不相關 docIds 事件被忽略、乾淨文件 toast+reload 正常、已 commit 的 dirty 正確彈出 CAS 橫幅且不 reload、dashboard 收到事件後清 previewCache 重繪正常。
- 觸發場景: 機器 A 使用者雙擊節點正在打「這段是雲端沒有的本機輸入」尚未按 Enter；同步引擎剛套用機器 B 的更新並派發 sync-applied（E 的五個觸發時機在使用者工作中隨時會發生）→ 編輯器顯示「已套用雲端更新」toast，850ms 後自動 reload → beforeunload 存檔因 CAS 衝突失敗且橫幅隨頁面卸載 → 使用者那句話永久消失、毫無提示。

## 10. [minor] 「repo 非私有」沒有非阻斷式警告的呈現通道
- 檔案: js/settings.js:260 | 維度: ui-preload-integration
- 細節: 凍結介面 setConfig/syncNow 只回 {ok, error?}，settings.js 的 feedback 只有 error/success 兩種 kind、狀態卡只呈現五種 state + lastError。sync-github 的 validateRepo 能偵測 {exists, private}，但當 repo 存在且為 public 時，E 引擎只有兩個選擇：包裝成 error 字串（同步被阻斷、UI 紅字）或視為 ok（UI 完全沉默，心智圖內容持續推上公開 repo）。dialog 對 token 無效/repo 不存在的呈現實測沒問題（error 字串完整顯示於 feedback、lastError 顯示於狀態卡、字串截斷 300 字、token 遮蔽都驗證過），唯獨「非私有」這種該警告但不必阻斷的情境缺乏表達方式。建議：feedback 增加 kind='warning'（CSS 已有 offline 黃色調可沿用），或約定 E 以 error 字串阻斷並在訊息中指引使用者把 repo 轉私有——擇一並寫進 E 的任務書，避免 E 自行決定成「靜默同步到公開 repo」。
- 觸發場景: 使用者手滑把同步 repo 建成 public（或事後在 GitHub 把它轉公開），E 引擎 validateRepo 查到 private:false 但介面沒有警告通道，選擇照常同步——使用者的全部心智圖內容（可能含商業資訊）持續發佈在公開 repo 上，UI 顯示「同步待命」一切正常。

---

## 主 session 裁決（2026-08-30）

10 條全採認、全部發版前必修。另併入 SYNC-E 自首兩項：E2=空 repo 無初始 ref 無法 bootstrap（與 #7 同修：ensureRepo 建 repo 帶 auto_init:true，既有空 repo 則由 adapter 走 create-ref 路徑或給使用者明確指引）；E4=lastSyncAt 允許以「附加選填欄位」加入 sync-state schema（不破壞既有欄位）。

關鍵修法指示：
- **#1（critical）**：tombstones 改**三方 delta 合併**（比照 favorites）：base 有+remote 無＝他機刻意移除→不得回加；purge 判定必須直接比較「本地 doc updatedAt vs purgedAt」，不得只依 localChanged；復活路徑必須保證跨輪存活（審查者的兩個方向擇一或並用，用 probe 腳本迴歸驗證三機三輪情境）。
- **#2**：buildLocalState 回傳物件加 quarantinedIds（key 存在但不可讀）；quarantined 文件排除在「永久刪除推斷」與 push 之外，並在狀態列回報。
- **#9**：sync 套用前檢查編輯 session（比照 COMMIT_BEFORE_GLOBAL_ACTIONS 的教訓）：編輯中先 commit 再套用，或該文件延後套用至編輯結束。
- 其餘各條照審查建議修。

修復完成後：全套測試+審查的 probe 腳本全綠 → 雙簽 → 真 repo 對測 → 發版。
