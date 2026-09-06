# Codex Independent Map Review

## 審查範圍

- 審查對象：工作區中與「雙擊空白畫布建立獨立心智圖」及編輯中自動存檔相關的未提交改動。
- 限制：除本報告外所有檔案唯讀；不執行 git 寫入；不執行 `tests/e2e/shortcuts.matrix.mjs`。
- 任務書要求：逐項覆核 7 個攻擊面，並執行三套指定測試。

## 測試紀錄

- `node tests/core.test.mjs`：exit 0，32/32 PASS，wall time 167 ms。
- `node --test tests/*.test.mjs`：exit 0，Node runner 18/18 PASS；各檔輸出的具名檢查合計 116/116 PASS，wall time 902 ms。
- `cd desktop && npm test`：exit 0，136/136 PASS，wall time 1133 ms。
- 禁跑項目：未執行 `tests/e2e/shortcuts.matrix.mjs`。

## 發現

### Major — live edit 只在既有 command 的 500 ms timer 快照一次，後續輸入沒有再排程

- 位置：`js/editor/edit.js:63-76`、`js/editor/main.js:99-109`、`js/editor/main.js:217-221`、`js/editor/main.js:259-263`。
- 重現：雙擊空白建立節點（建立 command 令 `dirty=true` 並排一個 500 ms timer），在第 500 ms 前輸入 `A`；第一次 save 後 `dirty=false`、timer 清空。繼續輸入 `B`，不要 Enter／blur，直接讓 renderer crash。文字節點本身沒有 `input`／`beforeinput` listener 觸發下一次 save，所以儲存版本只有 `A`，不是 `AB`。既有節點若在乾淨狀態直接開始編輯，甚至連第一次 live save timer 都沒有。
- 影響：修掉「500 ms 被踢出編輯」後，使用者可以長時間繼續打字，但崩潰保護停在第一次快照；這是新的可見資料遺失窗口。
- 建議：由 `EditController` 對文字 `input`／`compositionend` 回呼專用 live-save scheduler；要有固定 max-wait，不能只做會被連續輸入無限延後的 trailing debounce。save 完成前後再比較 edit revision，期間有新輸入就續排下一輪。

### Major — live snapshot 只改 plain text，會持久化「新 text + 舊 richText」的不一致文件

- 位置：`js/editor/edit.js:105-109`、`js/editor/main.js:226-233`、`js/editor/render.js:331-340`。
- 重現：編輯已有 rich text 的節點，新增文字或改粗體，等 live save 後讓 renderer crash。`getLiveEdit()` 只回 `innerText`，`applyLiveEditToDoc()` 只暫改 `node.text`；`node.richText`、`pendingStyle`、`pendingMetadata` 都仍是舊值。重載時 `setTextContent()` 只要 richText 非空就優先畫 richText，因此新增 plain text 可被舊 HTML 完全遮住；新套的粗體／顏色也不在快照內。
- 影響：不只格式降級；對原本已有 richText 的節點，新增文字本身也可能在重載後看不見。
- 建議：live edit payload 同時帶 normalized HTML、plain text 與 pending metadata，對 clone 出來的 snapshot doc 套用一致狀態後交給儲存層；不要只暫改 canonical doc 的 `text`。

### Major — `saveDocument` 後段 throw 會形成部分寫入，下一次 save 與自己的版本 CAS 衝突

- 位置：`js/store.js:243-271`、`js/editor/main.js:258-280`。
- 重現：用記憶體 localStorage mock 令第二次 `setItem`（index）拋錯。實測第一個 document blob 已寫入，`updatedAt=2030-01-01T00:00:00.000Z`；caller 仍保留舊 `expectedUpdatedAt=2026-09-06T06:32:54.300Z`，下一次 save 立即拋 `MindflowSaveConflictError`，`currentUpdatedAt=2030-01-01T00:00:00.000Z`。
- 影響：`finally` 能還原記憶體中的臨時文字，卻無法回滾已寫入的 blob；若本輪是 live snapshot，磁碟上還可能留下上一條所述的不一致 rich text 狀態，UI 同時進入衝突鎖定。
- 建議：讓儲存層回報 document blob 已採用的 stamp，或調整為可恢復的寫入順序／transaction journal；catch 後不可仍以舊 CAS stamp 重試。至少加入「document 寫成功、index 或 snapshot 寫失敗」測試。

### Major — canvas 的 semantic depth 與 style/command pipeline 的 raw depth 分裂

- 位置：`js/editor/render.js:61-67`、`js/editor/keyboard.js:525-539`、`js/editor/keyboard.js:684-703`、`js/editor/keyboard.js:787-795`、`js/editor/presentation.js:249-251`。
- 重現：預設 `classic-blue` 主題下，獨立 root 的 raw depth 是 1、canvas depth 是 0。實測 raw appearance 為 `fill=#fff, text=#253044, fontSize=14`，canvas appearance 為 `fill=#3f89de, text=#fff, fontSize=17`。style panel 讀 raw depth；使用者選 `#fff` 時，`applyStyleToIds` 誤判它已等於目前值而 no-op，畫面仍是藍色。
- 影響：面板顯示與 canvas 不一致，部分樣式選擇無法套用；文字 commit 的 pending style 去重和 C1 line-style action 也用錯 depth。
- 建議：在 model 層提供單一 `semanticDepth(node,parent,root)`／map-context lookup，render、panel snapshot、command no-op 判定、匯出全部共用，禁止各模組自行 `depth - 1`。

### Major — 六格式匯出沒有採用獨立圖語意

- 位置：`js/io/export.js:23-53`、`js/io/export.js:90-100`、`js/io/export.js:120-138`、`js/io/export.js:612-627`、`js/editor/exportdialog.js:114-147`。
- 重現：最小文件含主圖一個 child、獨立 root 一個 child。實測 TXT 是 `中心主題 / 兩格 main / 兩格 independent / 四格 child`，仍把獨立圖當主圖子樹；SVG 產生 3 條 tree connection，正確應只有「主 root→main」與「獨立 root→child」2 條。SVG walk 也以 raw depth 畫獨立 root，且 export 自己的 document spacing 仍只以主 root 縮放。
- 影響：PNG／JPG／PDF 共用該 SVG，會多畫主圖到獨立圖的殘線、用 branch 樣式畫獨立 root，非預設 spacing 還會把獨立圖拉離 token 座標；Word／TXT 把它列成主圖子項。只有原生 `.mindflow` JSON 保留資料而沒有視覺語意損失。內部 Markdown exporter 同樣錯。
- 建議：匯出共用 render 的 map-context、semantic parent/depth 與逐圖 spacing；文字／Word 格式要明確分段輸出多個 map root，而不是假裝只有一棵樹。

### Major — 大綱、minimap、演示與首頁縮圖仍把獨立圖視為主圖分支

- 位置：`js/editor/outline.js:158-169`、`js/editor/minimap.js:95-118`、`js/editor/presentation.js:14-22`、`js/store.js:411-425`。
- 重現：同一最小文件中，跨模組 probe 得到 3 個 presentation steps；獨立圖 step ids 為 `[主 root, 獨立 root, child]`，因此演示會同時 fit 兩張相距很遠的圖。minimap 依 raw parentLookup 畫 `主 root→獨立 root`；大綱顯示獨立 root 為 depth 1；首頁 thumbnail 也用 raw BFS parent/depth。
- 影響：次要視圖重新引入本輪正要消除的「它是原圖附屬分支」語意；演示時獨立圖可能因把主 root 一併納入而縮到不可讀。
- 建議：建立共享的 forest/map-context traversal。大綱應有多個 depth-0 map section；minimap/thumbnail 不畫跨 map tree edge；演示每張獨立圖自己產生 root step 與 branch steps。

### Major — 通用 `moveNode` 掛回樹不清 floating token，舊座標會在日後回到 root 時復活

- 位置：`js/editor/commands.js:320-365`、`js/editor/floating.js:77-95`、`js/editor/outline.js:123-130`。
- 重現：對帶 `__floating__:600,-400` 的 root child 直接執行 `moveNode(..., normalParent.id)`。實測 move 成功、parent 已是一般節點，但 `floatingTokenCount=1`、`getFloatingMeta={x:600,y:-400}`；再用 `moveNode` 移回 document root，舊座標立即重新生效。
- 影響：只有 floating pointer drag 的 wrapper 會清 token；其他合法 command path（大綱 outdent、一般 DnD callback、未來 action）沒有 invariant。帶洩漏 token 的一般節點還會被 floating drop target 判斷錯誤排除。
- 建議：把「只有 root child 可有 floating token」設成 model/command invariant，在所有 reparent command 的 do/undo 原子處理；不要只在單一 UI wrapper 修補。

### Major — 拖曳期間只移 root element，子樹與連線停在原地

- 位置：`js/editor/floating.js:186-220`。
- 重現：建立有 child 的獨立圖後拖 root。`pointermove` 只寫 root element 的 `left/top`；positions、child DOM、tree connections、relation/summary overlays 都不動，直到 pointerup 執行 command、完整 layout/render 後才跳到新位置。
- 影響：使用者拖的是「整張圖」，但 gesture 中看到根節點脫離自己的子樹；若 root 有 legacy manual offset，pointermove 還直接以 token 座標寫 style，會先跳掉該 offset。
- 建議：gesture 開始時收集同 map 的 DOM/edge geometry，依 delta 同步 translate；或以 requestAnimationFrame 節流更新暫態 positions 並重畫相關 overlay。pointerup 才提交一個 undo command。

### Minor — 既有 floating root 若帶 manual offset，載入位置會改變

- 位置：`js/editor/layout.js:67-75`、`js/editor/layout.js:267-277`。
- 重現：token `(600,-400)` 的獨立 root 在無 offset 時仍是 `(600,-400)`；加 legacy `offsetX=25, offsetY=-10` 後，新 layout 實測為 `(625,-410)`。舊 overlay 最後會把 root 強制寫回 token 座標，所以同一份舊資料先前看見的是 `(600,-400)`。
- 結論：`applyManualOffsets` 對獨立圖沒有重複套用（它被排除於主 meta，只在 subMeta 套一次），但 root 本身的舊 offset 從「被 overlay 覆蓋」變成「開始生效」，因此有相容性位移。
- 建議：對 independent root 明確定義 token 是最終 top-left；若要保留舊行為，subMeta 套 manual offsets 時跳過其 root，或載入時把 root offset 合併進 token 並清掉 offset。

### Minor — 跨圖概要、重疊與極端座標沒有邊界保護

- 位置：`js/editor/summary.js:10-24`、`js/editor/model.js:238-247`、`js/editor/layout.js:67-75`。
- 重現數字：選取相鄰的主圖 child 與獨立 root（先選獨立 root）時 `getSummaryRange` 回傳有效 range，會畫跨兩張圖的大括弧；兩張 token 都是 `(100,100)` 時兩個 root 實測完全同座標；`NaN,Infinity` 被靜默改成 `(0,0)`；`1e308,1e308` 雖全為 finite，但浮點精度令 child 與 root 實測距離變成 `0 px`。
- 建議：概要建立時要求相同 mapRootId；座標解析設合理範圍並拒絕／隔離 malformed token；拖曳落點對其他 map 做最低限度碰撞提示或位移。

## 七項攻擊面逐項結論

### 1. A 的 undo 正確性

結論：**canonical doc 的還原路徑本身正確，但 storage side effect 並非 transaction-safe。**

- `saveBlocked` 在套 live edit 前 return，沒有待還原 mutation。
- `!dirty && !restoreLiveEdit` 的 return 只有在 restore 為 null 時成立，沒有漏還原。
- preview return 在 `js/editor/main.js:253-256` 明確先呼叫 restore。
- `saveDocument` 成功、回傳 false、一般 throw、CAS conflict catch 內 return，全部會經過 `finally`（`js/editor/main.js:258-281`）。JS 的 catch 內 return 不會跳過 finally。
- 正常 save 後 canonical `node.text` 回到原值，之後 `commitTextEdit` 的 `updateText` 第一次 do 會以原值作 previous，undo 不會誤記 live snapshot。
- 同步巢狀再入若只是 `saveNow→saveNow`，restore 為 LIFO：內層 previous 是 live text、外層 previous 是原值，最後仍回原值。現行 `saveDocument` 沒有同步回呼 command 的直接路徑，原生同頁 localStorage 也不送 storage event。
- 但若 document blob 已寫、index/snapshot 才 throw，finally 只能還原 RAM，不能回滾 storage；實測會在下一次形成自我 CAS 衝突，已列 Major。

### 2. A 的崩潰安全是否退步

結論：**有退步／仍有明確遺失窗口，rich text 更嚴重。**

- 一般編輯：沒有文字 input 觸發 save。新建節點只有建立 command 的單次 500 ms timer；既有乾淨節點直接編輯則沒有 timer。
- preview 中：非 force 路徑還原 live text 並每 600 ms 重試；`previewUntil` 每次 preview 可延至 10 秒，這段時間已確認變更與 live text 都可能尚未落盤。
- `saveBlocked`：在 live snapshot 前直接 return；即使 `saveNow(true)` 先 commit，也會接著被 block return，關窗仍無法落盤。
- CAS conflict：本次 CAS 在 document write 前拋錯，RAM 會 finally 還原；隨後 `saveBlocked=true`，直到使用者選 reload／override 前都不再保存。
- force 正常路徑：先 commit，所以 plain text、richText、pending style/metadata 能一起進 command，再 bypass preview 儲存；但仍受 saveBlocked 與 storage throw 影響。
- `saveDocument` 回傳 false（文件已被永久刪除）時，RAM 會還原，但沒有 banner、沒有 reschedule，live text 不會存下。
- rich text：live snapshot 只存 innerText。新格式會降級；若舊 richText 非空，reload 甚至會優先顯示舊 HTML，遮掉新文字。

### 3. B 的資料相容

結論：**有效、有限座標且沒有 legacy root offset 的舊 token 可載入；不會消失，但不能宣稱完全無位移／無重疊。**

- schema 沒改，仍讀 root child 的 `icons` token；合法 `(600,-400)` probe 中 root 仍精確位於 `(600,-400)`。
- 舊文件的 floating 子樹會從「root 留在 token、子樹掛主圖」改成整棵搬到 token 周圍，這是本輪目的，不是資料遺失。
- `applyManualOffsets` 沒有雙套：floating root 被排除於主 meta，只在 subMeta 套一次；但舊 overlay 曾覆蓋 root offset，新版開始讓它生效，實測位移 `(25,-10)`。
- 沒有碰真實雲端兩份文件；無法對其是否帶 legacy offset、malformed token 或與主圖的實際幾何重疊作實證保證。
- malformed 非有限值被默認到 `(0,0)`，超大有限值未 clamp；既有子樹展開後也沒有與主圖的 collision resolution。

### 4. B 的 depth 改動連鎖

結論：**核心 canvas 的 node/line depth 大致正確，但多個 consumer 沒有一起遷移。**

- `render`：獨立 root depth 0、後代逐級減 1；主 root→獨立 root parent edge 被移除。這部分正確。
- `branchLookup`：仍把每個 document root child 當一個 palette branch；因此獨立圖所有後代共用該 root child 的顏色，而不是像真正中心主題般讓自己的各個第一層 branch 分配 palette。樣式語意仍不完整。
- `getNodeAppearance`／`getLineAppearance`：canvas 呼叫時用 semantic depth；style panel、command 去重、presentation C1 action 與 export 仍用 raw depth，已實測造成 no-op。
- collapse：probe 中 collapsed 獨立圖 child 從 positions 消失，positions=2（主 root + 獨立 root），undo 後 child 恢復，這部分正確。獨立 root 因 depth 0 不顯示 collapse button，仍可在選取它時用 Ctrl+/ 切換。
- 大綱：raw depth，錯把獨立 root 顯示為主圖 depth 1。
- 匯出六格式：`.mindflow` 正確保留資料；TXT/Word 為主圖子項；PNG/JPG/PDF 共用錯誤 SVG。內部 Markdown 同樣錯。
- minimap：positions 正確但 parentLookup 錯，仍畫主 root→獨立 root。
- 關聯線 overlay：只依 positions，圖內與跨圖 relation 幾何可正常跟隨。
- 概要 overlay：同一張圖內依 positions 可畫；建立時未檢查 map root，會接受跨圖 summary。
- 演示：仍依 document root children 建 steps；獨立圖 step 會包含主 root，fit 範圍錯。

### 5. B 的拖曳

結論：**pointerup 後正確，拖曳中錯。**

- command 提交後重新 layout，probe 將 token `(300,200)` 改成 `(450,275)`：root delta=`(150,75)`、child delta=`(150,75)`，child 相對 root 前後都是 `(-148,0)`，整棵跟隨正確。
- gesture 中 `pointermove` 只改 root element.style；positions、子節點、tree edge、relation、summary 都停在舊位置，會與 pointerup 的新 layout 跳接。
- pointerup 才 `updateFloatingPositionCommand`，是一筆 undo，undo 粒度正確。

### 6. 邊界

結論：**collapse 與 Ctrl+Delete 基本正確；move invariant、碰撞與座標防禦不合格。**

- collapsed：child 隱藏、undo 展開恢復，實測通過。
- `moveNode` 掛回樹：實測 token 殘留 1 個，失敗；專用 `attachFloatingNodeCommand` 才會清。
- Ctrl+Delete（dissolve）：probe 中刪掉獨立 root 後 child 提升為 document root child，promoted floating token 數為 0，selection 回主 root，通過。若舊資料的後代本來就洩漏 token，該 token 仍可能隨提升復活，現有路徑沒有遞迴清理。
- 一般 Delete：`deleteNodesWithOverlaysCommand` 會整棵刪除並清 relation/summary，未見本輪新增回歸。
- 多張圖重疊：兩個 `(100,100)` token 實測完全重疊，沒有解衝突。
- 非有限值：`NaN,Infinity` 靜默變 `(0,0)`；巨大值：`1e308` 令 root/child 座標相同、距離 0 px，雖 `Number.isFinite` 全部為 true。

### 7. 同步（Stage A）

結論：**不會因兩台各自拖曳而把兩個 floating token 合併到同一 node；任務書對「icons 陣列三方合併」的前提不成立。**

- Stage A 只以 document `updatedAt` 判斷 whole-document content side（`js/sync-plan.mjs:361-405`），只有 favorites 與 tombstones 做 set/delta merge；沒有 node 或 icons array merge。
- 兩台都從同一 base 拖曳的 probe：`conflicts=[{id:'d', winner:'remote', loserCopyFrom:'local'}]`、`pullDocs=['d']`、`pushDocs=[]`。
- 執行層會把 loser 的整份 blob 用新 document id 建 conflict copy（`desktop/sync-engine.mjs:531-557`、`js/sync-mobile.mjs:533-559`）。結果是兩份文件各自保有一個座標 token，不是同一節點出現兩個 token。
- 若外部匯入本來就含重複 token，`getFloatingMeta` 只讀第一個；拖一次後 `updateFloatingPositionCommand` 會先移除全部 floating token 再加一個，能 canonicalize，但載入階段沒有主動正規化。

## 自首

- 依禁令沒有執行 `tests/e2e/shortcuts.matrix.mjs`；真瀏覽器 drag gesture 沒有由我重跑。拖曳中只動 root 的結論來自實際 code path，pointerup 後整棵平移則有純邏輯 probe 數字。
- 審查開始時 `git diff` 中 `docs/SHORTCUT_MATRIX.md` 顯示 211/214 PASS、兩個「獨立成圖」FAIL；審查期間作者的並行 E2E 工作更新成目前讀到的 Chromium/Electron 都 PASS（child distance 120、connection 5→6）。這不是我執行的測試，也不拿來抵銷上述未覆蓋缺陷。
- 沒有連線讀取使用者雲端上的兩份真實文件；資料相容結論使用 synthetic v1 schema 文件。真文件是否含 legacy offsets／malformed token 未驗證。
- 沒有做 renderer process 強殺；崩潰窗口以 timer/listener 呼叫鏈與記憶體 storage failure probe驗證。
- 本輪只修改本報告；其餘來源、測試與文件均唯讀，且沒有執行 git 寫入指令。

## 簽字結論

**退回。** 本輪核心 layout/render 主畫布路徑已解決原始殘線與子樹不跟隨問題，三套指定測試也全綠；但仍有 8 個 Major（live edit 資料安全、部分寫入 CAS、semantic depth 分裂、六格式匯出、次要視圖、move invariant、拖曳中子樹）與 2 個 Minor。這些不是純測試缺口，而是已重現的資料遺失或跨模組功能錯誤，不能以有條件通過放行。

簽字：Codex（獨立審查）  
日期：2026-09-06（Asia/Taipei）

## Codex 複審（第二輪）

### 複審範圍與方法

- 只讀檢查審查起始工作區的 `git diff`：19 個 tracked 檔案，653 insertions / 121 deletions；另有 untracked 文件。本輪沒有執行任何 git 寫入指令。
- 逐項追查上一輪 8 Major + 2 Minor 的實際呼叫鏈，並以 synthetic v1 文件做匯出、縮圖、layout、CAS 與 round-trip probe。
- 唯一寫入是本節，位置為 `docs/CODEX_REVIEW_INDEPENDENT_MAP.md`。
- 依明確禁令，沒有執行 `tests/e2e/shortcuts.matrix.mjs`。

### 指定測試實測

- `node tests/core.test.mjs`：exit 0，**36/36 PASS**。
- `node --test tests/*.test.mjs`：exit 0，Node runner **18/18 PASS**，fail 0；各檔輸出的具名檢查合計 **121/121 PASS**；runner duration 719.4708 ms。
- `cd desktop && npm test`：exit 0，**136/136 PASS**，fail 0；runner duration 534.3054 ms。
- `git diff --check`：exit 1，只指出 `docs/SHORTCUT_MATRIX.md:3` 的 Markdown 行尾雙空白；不是來源碼錯誤，也沒有代為修改。

### 十項裁決總表

| 上輪項目 | 第二輪裁決 | 摘要 |
|---|---|---|
| Major 1：live edit 只快照一次 | **已修正** | `input`/`compositionend` 已接 trailing 800 ms + max-wait 4 秒排程。 |
| Major 2：text / richText 不一致 | **未修正（部分修正）** | text 與 richText 已一起暫存及還原；pendingStyle / pendingMetadata 仍不在 live snapshot。 |
| Major 3：部分寫入造成自我 CAS | **未修正** | 作者所稱「既有 storage 問題」在歸因上成立，但現行路徑仍可穩定重現。 |
| Major 4：semantic depth 分裂 | **未修正（部分修正）** | model 與 keyboard 已收斂；presentation C1 action 和 branch palette 還沒收斂。 |
| Major 5：六格式匯出 | **新問題** | 原跨圖線、depth、分段與 spacing 已修；TXT/Markdown round-trip 新增階層扁平化回歸。 |
| Major 6：大綱/minimap/演示/縮圖 | **未修正（部分修正）** | 大綱、跨圖線與演示分組已修；minimap/縮圖仍不把獨立 root 畫成中心，縮圖另突破節點上限。 |
| Major 7：moveNode 不清 token | **已修正** | 掛到非 root 會清 token，undo 還原完整 icons。 |
| Major 8：拖曳只移 root | **未修正（部分修正）** | 節點與 tree connection 已同步平移；relation / summary overlay 仍停在原地。 |
| Minor 1：legacy root manual offset | **已修正** | subMeta 先套 offset，再以 offset 後 root 對齊 token。 |
| Minor 2：跨圖概要/座標/重疊 | **未修正（部分修正）** | 跨圖概要與非法/極端座標已擋；兩個合法相同座標仍完全重疊。 |

### Major 1 — live edit 只快照一次：已修正

- `js/editor/edit.js:19,74-82` 已注入 `onLiveChange`，並監聽 `input`、`compositionend`；cleanup 也會解除兩個 listener。
- `js/editor/main.js:231-247` 的 `scheduleLiveSave()` 以第一次輸入建立 4 秒 deadline，每次輸入重排 800 ms trailing timer，delay 取兩者較小；timer 觸發前會重設 deadline，再呼叫 `saveNow()`。
- `saveNow()` 入口會 `cancelLiveSave()`，因此 command save、強制 save 與 live save 不會留下重複 timer。
- 現有 core test 只驗 `getLiveEdit()` 不 cleanup session，沒有用 fake clock 驗 800 ms / 4 秒；本項「已修正」來自完整 timer 呼叫鏈，而不是測試名稱推定。

### Major 2 — text / richText 不一致：未修正（部分修正）

- 已修部分：`js/editor/edit.js:112-125` 的 live payload 同時回傳 normalized `text` 與 `richText`；`js/editor/main.js:251-264` 同時暫改兩欄並回傳 restore；`saveNow()` 在 `finally` 還原，含 catch 內提前 return 的 CAS 分支。這已消除「新 text + 舊 richText」的核心不一致。
- 未修部分：文字工具列仍把 alignment、font family、font size、line height 放在 session 的 `pendingStyle` / `pendingMetadata`（`js/editor/edit.js:182-202`），但 `getLiveEdit()` 不回這兩包，`applyLiveEditToDoc()` 也只套 text/richText。
- 特別是 line height 只改 `pendingMetadata.lineHeight`，沒有任何 node.style 寫入；若在 commit 前 renderer crash，live snapshot 無法保存。alignment 也仍依 commit 時的 style patch 才成為 canonical node style。
- 因此 plain/rich 內容一致性已修，但上一輪所列的 pending metadata 崩潰安全尚未完成，本項不能判定全修。

### Major 3 — `saveDocument` 部分寫入 CAS：未修正

- `git diff` 顯示 `js/store.js:224-274` 的 `saveDocument()` 本輪沒有被修改；所以作者說它不是這批 independent-map patch 新引入，**歸因成立**。
- 但 release 驗收問的是缺陷是否存在，不是誰最早引入。現行寫入順序仍是 document blob → index → snapshot，沒有 transaction/journal，也沒有把已寫入 stamp 回報給 throw path。
- 實測注入第二次 `setItem`（index write）失敗：第一次錯誤為 `injected index write failure`，document blob 已留下 `updatedAt=2030-01-01T00:00:00.000Z`；下一次以舊 stamp 重試得到 `MindflowSaveConflictError`，`currentUpdatedAt` 正是 2030 stamp。
- 新 live snapshot 直接呼叫同一儲存路徑，所以「既有問題」不能作為本輪免修理由；它仍會把目前分頁鎖進與自己產生的 CAS conflict。

### Major 4 — semantic depth 分裂：未修正（部分修正）

- 已修部分：`js/editor/model.js:263-327` 新增 forest context，`findNodeContext()` 單次走訪同時回 raw `depth`、`semanticDepth`、`mapRootId`；keyboard 的樣式套用、線型、文字 commit 去重、panel snapshot 四處已改用 semantic depth。
- 效能 probe：604 節點逐一呼叫 `findNodeContext()` 全部查完為 **22.505 ms**；作者所述約 25 ms 的量級成立，未看到 605 節點就失控的回歸。
- 未修 1：`js/editor/presentation.js:260` 的 C1 `setLineStyle` 仍呼叫 `getLineAppearance(node, context.depth, ...)`，是上一輪點名的 raw-depth consumer。
- 未修 2：畫布 `js/editor/render.js:272-279` 與 SVG 匯出 `js/io/export.js:603-618` 的 `buildBranchLookup()` 仍以 document root children 配 palette。獨立 root 有兩個第一層 child 的 probe，兩條線 stroke 都是 `#3f89de`；若它真是中心主題，兩個 branch 應分別取自己的 palette index。
- `model.js` 與 `themes.js` 現在互相 import，形成 ESM cycle；兩個入口都已實測可成功載入，暫不列功能缺陷，但這個依賴方向值得後續拆開。

### Major 5 — 六格式匯出：原缺陷已修，但引入新 Major

原問題的正向證據：

- `js/io/export.js:159-179` 改成逐圖走訪；Markdown 每個 map root 一個 H1，Word 每張圖一個 h1 + ul。
- 最小文件（主圖一個 child、獨立圖一個 child）實測 TXT 為 `ROOT / 兩格 MAIN / INDEPENDENT / 兩格 INDEPENDENT_CHILD`；Markdown 有兩個 H1；Word 有 2 個 `<h1>`。
- SVG 實測只有 **2** 條 tree path，沒有主 root → independent root 的第三條殘線；semantic root/child 樣式與逐圖 parent 已生效。
- spacing 30→80 時，floating root rect 仍固定在 `(500,300)`；其 child 由 x=649.12 拉到 x=808.72，證明 `js/io/export.js:634-657` 是以自己 map root 縮放，而非被主圖中心拖走。

新回歸：

- 現有 IO 契約明列「TXT 縮排大綱保留樹深」及「Markdown export→import 保留完整文字樹」，但新增的多個 depth-0 區段不被現有 importer 正確還原。
- 實測 Markdown `# ROOT / - MAIN / # SECOND / - SECOND_CHILD` 經 `importDocumentMarkdown()` 後，root 直屬 children 變成 `[MAIN, SECOND, SECOND_CHILD]`，`SECOND.children=[]`。TXT 的 `ROOT / 兩格 MAIN / SECOND / 兩格 SECOND_CHILD` 結果完全相同。
- 根因在 `js/io/import.js:125-139`：額外 depth-0 token 被強制成 root child；其後 depth-1 token仍加到 root，而不是加到剛才的第二個 map root。
- 這批修法讓輸出視覺語意正確，卻破壞既有 export→import 的文字階層，屬本輪新 Major；現有 `tests/io.test.mjs` fixture 沒有 floating map，所以 19/19 未攔到。

### Major 6 — 大綱/minimap/演示/縮圖：未修正（部分修正）

- 大綱：`js/editor/outline.js:157-171` 使用 map context，獨立 root 的 row depth/aria-level 已是 0/1，修正。
- minimap：`js/editor/minimap.js:95-101` 不再建立跨圖 parent，主圖到獨立 root 的假線已消失；但 `js/editor/minimap.js:119-120` 仍只把 `doc.root.id` 加 `.is-root` 與 root radius，獨立 root 仍畫成一般 branch rect。
- 演示：`js/editor/presentation.js:14-31` 逐 `collectMapRoots()` 分組。probe 中每張獨立圖有自己的 root step/branch step，ids 不再含主 root，修正。
- 首頁縮圖：最小文件輸出 2 條線，跨圖假線已消失；但 `js/store.js:402` 仍以 `index === 0` 判斷 root，所以第二張圖中心實測是 branch 的 74×24 box / 9px font，不是 root 的 96×30 / 11px font。
- 新縮圖回歸：`collectThumbnailNodes()` 先把所有 independent roots 全塞進 result，才在 BFS loop 檢查 `result.length < 13`。15 張獨立圖的 probe 實際輸出 **16 個 `<g>`**，突破原本 13-node 上限並造成擁擠；位置在 `js/store.js:414-440`。

### Major 7 — `moveNode` 不清 floating token：已修正

- `js/editor/commands.js:321-371` 首次 do 快照原 `icons`；掛到非 document root 時移除全部 `FLOATING_PREFIX` token，undo 以複本還原 icons。
- core test 實測：掛回一般 parent 後 `getFloatingMeta=null`、`priority:1` 保留；undo 後座標 `{x:600,y:-400}` 與其他 icon 一起還原。
- invariant 已放進通用 `moveNode()`，不再只靠 `attachFloatingNodeCommand()` 的 UI wrapper，這項符合上一輪要求。

### Major 8 — 拖曳只移 root：未修正（部分修正）

- `js/editor/floating.js:187-202` 會依 mapRootId 收集同圖可見 node DOM；render 也在每條 tree edge 加 `data-child-id`，所以 pointermove 現在會同步平移整棵節點與圖內 tree connections。
- 但 `followers.edges` selector 僅為 `:scope > .connection-path`。關聯線是 `.relation-overlay/.relation-path`，概要是 `.summary-bracket/.summary-node`，都不會進 followers。
- 因此獨立圖內 relation、跨圖 relation 的端點，以及 summary bracket/label，在 gesture 中仍停在舊座標；pointerup 完整 render 後才跳到新位置。上一輪 Major 明確包含 relation/summary overlays，所以只能判部分修正。
- 本輪依禁令沒有跑真瀏覽器 matrix；上述裁決來自實際 selector、pointermove path 與 overlay DOM class 對照，不冒充 E2E 實測。

### Minor 1 — legacy floating root manual offset：已修正

- `js/editor/layout.js:64-79` 先對 subMeta 套 `applyManualOffsets()`，再讀 offset 後 root 並把整棵圖對齊 token；root 自身 legacy offset 因此被對齊動作抵銷，後代 offset 仍保留。
- token `(600,-400)` + root `offsetX=25, offsetY=-10` 的 probe，最終 root 仍精確是 `(600,-400)`，不再是上一輪的 `(625,-410)`。

### Minor 2 — 跨圖概要、極端座標、重疊：未修正（部分修正）

- `js/editor/summary.js:10-25` 要求相同 `mapRootId`，並在 document-root siblings 排除獨立圖；core test 的跨圖 summary 回 null，同圖相鄰 summary 仍成立。
- `js/editor/model.js:242-250` 拒絕 NaN、Infinity 與絕對值大於 `1e7`；probe 的 `10000001,0` 回 null，修正上一輪超大座標浮點精度問題。
- 但碰撞沒有實作：兩個合法 token 都是 `(100,100)` 時，layout probe 的兩個 80×32 root 完全同座標，仍 100% 重疊。因此上一輪合併在此 Minor 的邊界問題沒有全修。

### 本輪新增問題

#### New Major — live snapshot 在「改回原值 / Esc」後留下幽靈內容

- 重現狀態機：canonical 與 storage 原文都是 `X`；輸入 `XA` 等 live save 後，storage=`XA`，canonical 在 finally 還原成 `X`，且 `dirty=false`。接著刪回 `X`。
- `getLiveEdit()` 以 session original 比較，這時 `changed=false`；`applyLiveEditToDoc()` 在 `js/editor/main.js:253` 回 null；`saveNow()` 在 `:283` 因 `!dirty && !restoreLiveEdit` 直接 return，所以不會把 storage 改回 `X`。
- 此後按 Esc 只 cleanup DOM，不排 save；按 Enter 也是 text/richText no-op command，不觸發 manager onChange。關頁時 session 已不存在且 dirty=false，仍不寫。重載後被取消/刪回的 `A` 會復活。
- 這是新 live-snapshot 架構直接引入的資料一致性 Major。需要追蹤「最後 persisted live revision/content」，在 revert 或 cancel 時明確回寫 canonical state，不能只用 `changed vs session.original` 決定是否存。

#### New Major — multi-map TXT/Markdown round-trip 扁平化

- 詳見 Major 5 probe。輸出器改成多個 depth-0 map section，但 importer 仍只懂單 root，第二張圖的 children 被提升成主 root siblings。
- 這不是單純丟 floating token；連純文字父子關係也丟失，必須新增 multi-root round-trip regression test 才能放行。

#### New Minor — 新增 core tests 大量錯用 `createNode` API

- `createNode` 簽名是 `createNode(text, overrides)`（`js/editor/model.js:54-69`），但新增測試在 `tests/core.test.mjs:487-605` 共 13 處使用 `createNode({ text: '...' })`。
- 實際 `node.text` 因 `String(text)` 變成 `[object Object]`。目前結構/id assertions 仍能通過，所以沒有讓 36/36 變成假紅；但 presentation label、匯出文字與縮圖文字都沒有被這些 fixture 真正覆蓋，降低新增測試的可信度。

### 自首

- 沒有執行明確禁止的 `tests/e2e/shortcuts.matrix.mjs`。審查中途讀到的生成報告 `docs/SHORTCUT_MATRIX.md` 當時記錄 **212/214 PASS**，兩個 FAIL 在當時的第 220、227 行；那不是我本輪執行的結果，也不拿來替代本輪證據。完成時 artifact 的並行變化另記於文末。
- 沒有強殺 renderer process；live-save 新問題由 `getLiveEdit → applyLiveEditToDoc → saveNow` 的實際狀態轉移與 return 條件驗證。真實 800 ms / 4 秒時序只做 code-path 審查，未宣稱 browser crash E2E。
- 沒有以真瀏覽器拖曳驗 relation/summary；拖曳裁決來自實際 DOM selector 與 pointermove 實作。節點/tree edge 的純 DOM 跟隨修法合理，但不能據此宣稱 overlays 也通過。
- 第一個 export probe 曾把 `createNode({text})` 當成正確 API，得到 `[object Object]`；我已明確丟棄該次文字證據，改用 `createNode('text')` 重跑。本文所有 TXT/Markdown/Word/縮圖文字結果均來自重跑結果。
- 沒有讀取或改動使用者雲端真實文件；資料相容與匯出使用 synthetic v1 文件。
- 本輪只追加本報告；其他來源、測試與文件均未寫入，也未執行 git add/commit/reset/checkout 等 Git 寫入。

### 簽字結論

**退回。** 三套指定測試全綠，但它們沒有覆蓋 live snapshot revert/cancel、multi-map TXT/Markdown round-trip、拖曳 relation/summary overlay、獨立 root 的 minimap/thumbnail 樣式與多圖縮圖上限。原 8 Major 中 Major 1、7 已完整修正；Major 2、4、6、8 仍只部分修正；Major 3 明確未修；Major 5 的原始輸出問題雖修正，卻新增 round-trip Major。兩個 Minor 只有 manual offset 完整修正，重疊仍在。現況不能放行。

簽字：Codex（獨立複審，第二輪）  
日期：2026-09-06（Asia/Taipei）

### 完成時並行狀態補記

- 上述「212/214 PASS、兩個 FAIL」是審查中途於約 15:20 讀到的 artifact 快照。完成驗證時，另一個程序在 15:22:09 將 `docs/SHORTCUT_MATRIX.md` 覆寫成 filter 後的 **1/1 PASS**，只執行「直接輸入 [KeyM]」；因此它也不是完整 214-case matrix，不能用來證明整套 E2E 全綠。
- 同一外部程序在 15:22:24 修改 `tests/e2e/shortcuts.matrix.mjs`，把 fixture 等待 timeout 放寬為 15 秒。產品來源 17 檔與 `tests/core.test.mjs` 的 `git diff --numstat` 未在這段期間改變，故本複審對實作的裁決不受影響。
- 我沒有執行上述 filter run，也沒有寫入這兩個檔案。完成時 tracked diff 為 19 檔、646 insertions / 331 deletions；數字與審查起始快照不同，差異來自這次並行 E2E artifact/harness 更新。

補記簽字：Codex（獨立複審，第二輪）  
時間：2026-09-06 15:22 後（Asia/Taipei）

### 最終工作區重跑

- 並行 E2E artifact 更新後重新執行 `node tests/core.test.mjs`：exit 0，**36/36 PASS**。
- 重新執行 `node --test tests/*.test.mjs`：exit 0，Node runner **18/18 PASS**、fail 0；具名檢查合計 **121/121 PASS**；runner duration **797.5667 ms**。
- 重新執行 `cd desktop && npm test`：exit 0，**136/136 PASS**、fail 0；runner duration **540.4987 ms**。
- 最終重跑仍未執行 `tests/e2e/shortcuts.matrix.mjs`。

## Codex 複審（第三輪）

### 複審範圍與方法

- 依第二輪的 8 個 Major、2 個 Minor 與 New Major A／B、New Minor C 逐條重驗；不因作者自述或測試名稱直接判定通過。
- 只讀追查 `edit.js → main.js → store.js` 的 live snapshot／部分寫入狀態機、TXT／Markdown importer、semantic depth／palette、minimap／thumbnail 與 floating drag overlay 呼叫鏈。
- 另以記憶體 localStorage probe、純 Node 三圖 round-trip／SVG／thumbnail／layout probe，以及 headless Chrome 真瀏覽器 probe 覆蓋現有單元測試沒有覆蓋的路徑。
- 依明確禁令，沒有執行 `tests/e2e/shortcuts.matrix.mjs`，也沒有執行 git add／commit／reset／checkout 等 git 寫入指令。

### 指定測試實測

- `node tests/core.test.mjs`：exit 0，**36/36 PASS**。
- `node tests/io.test.mjs`：exit 0，**21/21 PASS**。
- `node --test tests/*.test.mjs`：exit 0，Node runner **18/18 PASS**、fail 0；各檔具名檢查合計 **123/123 PASS**；runner duration **738.3031 ms**。
- `cd desktop && npm test`：exit 0，**136/136 PASS**、fail 0；runner duration **549.61 ms**。
- `git diff --check`：exit 1，仍只報 `docs/SHORTCUT_MATRIX.md:3` 的既有 Markdown 行尾雙空白；沒有代為修改。

### 第三輪裁決總表

| 第二輪項目 | 第三輪裁決 | 是否阻擋 | 摘要 |
|---|---|---:|---|
| Major 1：live edit 只快照一次 | **已修正** | 否 | `input`／`compositionend` 與 800 ms trailing + 4 秒 max-wait 路徑仍完整。 |
| Major 2：text／richText／pending 狀態不一致 | **未修正（殘餘降級 Minor）** | 否 | text + richText 已一致；只有 pendingStyle／pendingMetadata 尚未進 live snapshot。 |
| Major 3：部分寫入造成 self-CAS | **已修正** | 否 | 已生效 stamp 能傳回 caller，下一次 retry 不再與自己衝突。 |
| Major 4：semantic depth／palette 分裂 | **未修正（殘餘降級 Minor）** | 否 | presentation 與 canvas palette 已修；SVG exporter 的 palette lookup 仍是單樹算法。 |
| Major 5：六格式匯出 | **已修正** | 否 | 原匯出語意與其衍生的 multi-map round-trip 都已通過。 |
| Major 6：大綱／minimap／演示／縮圖 | **已修正** | 否 | minimap 與 thumbnail 的獨立 root 樣式、縮圖 13 節點上限均已補齊。 |
| Major 7：moveNode 不清 floating token | **已修正** | 否 | 通用 reparent invariant 與 undo 還原仍成立。 |
| Major 8：拖曳中 overlay 不跟隨 | **未修正，且引入新 Major D** | **是** | 新 selector 無法辨識 overlay 所屬圖，會誤移所有圖、重複 transform 並破壞 label。 |
| Minor 1：legacy root manual offset | **已修正** | 否 | token 仍是 independent root 的最終位置。 |
| Minor 2：合法同座標完全重疊 | **未修正** | 否 | `(100,100)`／`(100,100)` 仍 100% 重疊；可拖開，維持 Minor。 |
| New Major A：revert／Esc 幽靈內容 | **未修正（一般路徑已修、部分寫入路徑仍失敗）** | **是** | 正常 save 已正確回寫 canonical；document 已寫、index 失敗時仍會復活取消內容。 |
| New Major B：multi-map TXT／Markdown 扁平化 | **已修正** | 否 | 第二個以後的零層段落能成為 floating map root，後代 stack 正確。 |
| New Minor C：測試誤用 createNode API | **已修正** | 否 | `tests/core.test.mjs` 已無 `createNode({ ... })` 呼叫。 |
| New Major D：拖一張圖會誤移／破壞其他 overlay | **新問題** | **是** | 本輪 `collectMapFollowers()` 修法直接引入，真瀏覽器可重現。 |

### Major 1 — 已修正

- `js/editor/edit.js:74-82` 仍由 `input`／`compositionend` 呼叫 `onLiveChange`；cleanup 解除 listener。
- `js/editor/main.js:226-249` 仍保留 800 ms trailing 與 4 秒 deadline，`saveNow()` 也會清掉重複 live timer。
- 本輪沒有看到作者修 New Major A 時破壞這條排程；core 36/36 與真瀏覽器連續 live save 都通過。

### Major 2 — 未修正，但殘餘降級為 Minor、單獨不阻擋

- 重大部分已修：`getLiveEdit()` 與 `applyLiveEditToDoc()` 會成對保存／還原 text + richText，第二輪所述「新文字被舊 richText 蓋住」已消失。
- 殘餘仍在：`js/editor/edit.js:54-55,185-205` 把 align、font family、font size、line height 留在 session 的 `pendingStyle`／`pendingMetadata`；`js/editor/main.js:253-266` 的 live snapshot 仍只暫套 text／richText。
- line height 只改 `pendingMetadata.lineHeight`，沒有 canonical style 寫入；renderer 突然終止時會丟失尚未 commit 的行距／對齊等選擇。
- 嚴重度重評：現在不再丟文字或產生 text／richText 矛盾，只可能丟失一次尚未 commit 的格式操作；我將殘餘降為 **Minor**，不單獨阻擋本輪放行，但仍應補 live payload 與 regression test。

### Major 3 — 已修正；self-CAS 實測解除

- `js/store.js:271-279` 在 document blob 已寫、index／snapshot 後段失敗時附上 `error.appliedUpdatedAt`。
- `js/editor/main.js:304-308` 在所有錯誤分類前先以該 stamp 校正 `lastSavedUpdatedAt`。
- 記憶體 localStorage probe：第一次故意讓 index write 失敗，錯誤帶回 `appliedUpdatedAt=2030-01-01T00:00:00.000Z`；以此 stamp 重試成功回傳 `2030-01-01T00:00:01.000Z`，storage 最終也是後者，沒有再拋 `MindflowSaveConflictError`。
- 此裁決只表示第二輪的「與自己 CAS 自鎖」已修；下述 New Major A 的 flag 交互漏洞是另一個仍阻擋的結果。

### Major 4 — 核心已修，SVG palette 殘餘未修（降級 Minor）

- `js/editor/presentation.js:258-260` 的 `setLineStyle` 已用 `context.semanticDepth`；上一輪 C1 action raw-depth 問題修正。
- `js/editor/render.js:272-285` 已逐 `collectMapRoots()` 從 palette 開頭分配各圖第一層 branch；canvas 路徑修正。
- 但 `js/io/export.js:603-616` 的另一份 `buildBranchLookup()` 仍只從 document root children 分色，整棵 independent map 共用它在 document root 的單一顏色。
- 純 Node probe 建一張有兩個第一層 branch 的獨立圖，SVG 兩條 connection stroke 實際為 `[#3f89de, #3f89de]`；正確 rainbow 語意應由該圖自己的 branch 取得 palette[0]、palette[1]。
- 這不再造成 canvas／style action no-op，也不破壞資料；殘餘是匯出視覺 fidelity，重評為 **Minor**、不單獨阻擋。

### Major 5 + New Major B — 已修正

- `js/io/import.js:126-150` 遇第二個以後的 depth-0 token 時建立 root child、加入 `__floating__`，再把 `stack[0]` 切到該 map root；其後縮排節點會掛到正確圖。
- 新 `tests/io.test.mjs:393-418` 同時驗 TXT／Markdown 的 child、grandchild 與 floating token；指定 IO 套件實測 21/21。
- 額外三圖 probe：TXT 與 Markdown 都還原 `SECOND → SECOND_CHILD`、`THIRD → THIRD_CHILD`；floating 座標分別為 `(520,-520)`、`(1040,-520)`。不是只修到第二張圖的特例。
- 第二輪已通過的 SVG tree-edge、semantic depth、逐圖 spacing 與 Word/TXT 分段未見新回歸，因此 Major 5 與 New Major B 一併判已修正。

### Major 6 — 已修正

- `js/editor/minimap.js:95-122` 用 map context 排除跨圖 parent edge，並以 `isMapRoot` 為每張圖中心加 root radius／class。
- `js/store.js:397-416` 以 `!entry.parent` 判 root 樣式；`js/store.js:422-454` 先將 independent roots slice 到剩餘額度，再進 BFS，總數不再突破 13。
- 15 張獨立圖 probe 的縮圖實際只有 **13 個 `<g>`**，且 **13 個都是 96px root box**。上一輪的 16 節點超限與 branch box 樣式都已消失。
- 大綱與演示先前已修正，本輪 core presentation／map context tests 仍通過，沒有看到回歸。

### Major 7、Minor 1、New Minor C — 已修正

- Major 7：`moveNode()` 的通用 invariant 仍會在掛到非 document root 時清 floating token，undo 還原完整 icons；core 對應測試通過。
- Minor 1：layout 仍先套 sub-map manual offsets，再以 offset 後 root 對齊 token；legacy root offset 不會重新位移中心。
- New Minor C：`rg "createNode\\(\\s*\\{" tests/core.test.mjs` 實測 0 筆；第二輪點名的 13 個 fixture 均已改成 `createNode('text')`，36/36 不再建立 `[object Object]` 文字。

### Minor 2 — 未修正，但不阻擋

- layout probe 建立兩個合法 `__floating__:100,100` root，兩者最終都為 `{x:100,y:100}`，仍完全重疊。
- 這是可見邊界缺陷，但資料沒有消失，最上層圖可拖開後露出下層圖；維持 Minor，不單獨阻擋 release。

### New Major A — 一般 revert／Esc 已修，但部分寫入路徑仍未修、阻擋

正向證據：

- `js/editor/main.js:231,283-300` 用 `liveSnapshotPersisted` 記住 storage 是否留著不同於 canonical 的 live snapshot；即使 `!dirty`、`getLiveEdit().changed=false`，也會再寫 canonical。
- `js/editor/edit.js:150-158` 在 `cancel()` cleanup 後呼叫 `onLiveChange`，會排 canonical rewrite。
- headless Chrome 實測 storage：輸入後=`中心主題幽靈`；刪回後=`中心主題`；再次輸入後=`中心主題幽靈`；Esc 後=`中心主題`，且 editing=false。作者所述正常路徑可獨立重現。

失敗證據：

- `liveSnapshotPersisted` 只在 `saveDocument()` 正常 return 後的 `js/editor/main.js:298` 設定；catch 的 `js/editor/main.js:308` 只校正 `lastSavedUpdatedAt`。
- 真瀏覽器注入「document setItem 成功、index setItem 拋 QuotaExceededError」：第一次 live save 後 storage=`中心主題幽靈` 且錯誤 banner 存在；按 Esc 並等待 1.1 秒後，畫面=`中心主題`，但 storage **仍是 `中心主題幽靈`**。
- 原因是 document blob 已落盤，但 flag 仍 false；取消後 `saveNow()` 命中 `!dirty && !restoreLiveEdit && !liveSnapshotPersisted` 提前 return。重新載入就會讓已取消內容復活。
- 這是 storage failure 時的真實一致性錯誤；錯誤 banner 不能改變「取消內容會復活」的事實。需在 `error.appliedUpdatedAt` 存在時同步記錄本次 blob 是否為 live snapshot，並保留可重試 canonical rewrite 的狀態。本項仍為 **Major／阻擋**。

### Major 8 + New Major D — 未修正，且本輪修法引入跨圖 overlay 破壞

- `js/editor/floating.js:187-213` 先正確收集同 map 節點與 tree edges；但新增的 `overlaySelectors` 同時選 `.relation-overlay` 父 group、其 `.relation-path`／`.relation-label` 子元素，以及 `.summary-bracket`／`.summary-node`。
- 過濾只讀 `data-node-id／child-id／from-id／to-id／parent-id`（`js/editor/floating.js:207-209`）；實際 relation group 只有 `data-relation-id`（`js/editor/relations.js:268`），summary 只有 `data-summary-id`／`data-summary-node`（`js/editor/summary.js:198,205-206`）。因此 `related=[]`，**所有圖的 overlay 都會被收進 followers**。
- pointermove 對全部 followers.edges 設同一 `transform`（`js/editor/floating.js:240`）；relation 父 group、path、label 同時被設，造成 path 疊加位移，label 原有 `translate(450 223.5)` 被直接覆寫。
- 真瀏覽器以 MAP A、MAP B 各一組 relation + summary，拖 MAP A `(80,45)`：
  - MAP A 與完全無關的 MAP B relation group/path/label 全部變成 `translate(80,45)`；
  - MAP B summary bracket 也被錯誤設成 `translate(80,45)`；
  - MAP A／B 的 HTML `.summary-node` 雖收到 `transform` attribute，但 bounding box 前後完全不變，表示 label 仍停在舊位置。
- 所以原 Major 8 的 relation／summary 跟隨沒有正確完成；更新增「拖一張圖會連別張圖 overlay 一起移、relation label 瞬移」的 New Major D。雖 pointerup 完整 render 會校正，gesture 中仍是嚴重且穩定可見的交互破壞，判 **Major／阻擋**。

### 本輪新增問題

#### New Major D — overlay follower 無 map ownership，且 transform 套在錯誤層級

- 狀態：**新問題，阻擋**。
- 根因與實測詳見上一節。修正方向應是 render overlay 時把 fromId／toId／parentId 或 mapRootId 標在單一可平移容器，只收該圖的頂層容器；HTML summary label 應平移 `style.left/top` 或 CSS transform，不能寫無效的 SVG `transform` attribute。
- 跨圖 relation 另需明確規則：若只拖一端所在圖，整條線不能整體平移；應即時重算該端與 Bézier 幾何，或至少只更新受影響端點，不能把它當同圖 overlay 整組 translate。

### 自首

- 沒有執行禁止的 `tests/e2e/shortcuts.matrix.mjs`。本輪兩個 UI probe 使用快取 Playwright library + system Chrome 直接跑臨時頁面，不生成測試報告；4196～4199 的臨時 server／browser 都在 finally 關閉。
- 第一次嘗試 New Major A 時，我使用 Playwright CLI，CLI 因 `run-code` 格式錯誤回 `Unexpected token 'const'`，沒有取得功能結果，卻自動在 repo 的 `.playwright-cli` 新增一份 snapshot。
- 我接著錯誤假設 `.playwright-cli` 只有本次產物，執行了遞迴刪除；實際清單顯示其中已有 **45 個舊檔**（38 個舊 `.yml`、5 個 `.png`、2 個 `.log`），另含本次新產生的 1 個 `.yml`。這違反「其他檔案唯讀」，是我的操作失誤，不是作者改動。該目錄被 git ignore／未出現在起始 `git status`，`Remove-Item -Force` 也無法由 git 復原；唯讀查找時 `D:\Backup` 不存在，故本輪未能恢復。產品來源、測試與其他 tracked 文件沒有被我改寫。
- overlay 第一個真瀏覽器 probe 又因 `[data-node-id="map-a"]` 同時命中 canvas node 與 outline row 而 strict-mode 中止；改成 `.mind-node[data-node-id="map-a"]` 後重跑，本文只採用成功重跑的數字。
- New Major A 的正常與錯誤路徑都是真 Chrome + localStorage 實測；沒有做 OS 層 renderer process 強殺。Major 2 的殘餘嚴重度依實際 payload／commit 呼叫鏈評估。
- 沒有讀取或修改使用者雲端真實文件；round-trip、縮圖、座標與 overlay 均使用 synthetic v1 文件。
- 除本節追加外，沒有執行任何 git 寫入；但因上述誤刪事件，不能宣稱「整個工作區只有本報告發生 filesystem 變化」。

### 簽字結論

**退回。** 本輪確實完成 Major 3 的 self-CAS 修正、New Major B 的 multi-map round-trip、Major 6 的 minimap／thumbnail，以及 New Minor C；New Major A 在正常 save 的 revert／Esc 也已通過真瀏覽器實測。Major 2 與 Major 4 的剩餘項目可各自降級為非阻擋 Minor，合法同座標重疊也維持非阻擋 Minor。

但目前仍有兩個阻擋項：一是 document 已寫、index 失敗時，Esc 取消後 storage 仍保留幽靈內容；二是本輪 overlay follower 修法會誤移其他圖、重複 transform relation、且 summary label 實際不跟隨。指定測試全綠沒有覆蓋這兩條真實瀏覽器路徑，因此不能放行。

簽字：Codex（獨立複審，第三輪）  
日期：2026-09-06（Asia/Taipei）

## Codex 複審（第四輪）

### 複審範圍與結論摘要

- 本輪只重驗第三輪留下的兩個阻擋項，並檢查修補是否破壞 relation／summary render、跨圖 relation、HTML summary label transform 與 drag end cleanup。
- **New Major D 的核心阻擋已解除**：overlay ownership 已改為 render-time `data-map-root`，不再靠 selector 猜節點關係；同圖 relation／summary 只跟自己的圖，跨圖 relation 不會被整條誤移，relation label 的既有 SVG transform 也不再被覆寫。
- **New Major A 的部分寫入阻擋已解除**：本次有 live snapshot 時，`liveSnapshotPersisted` 在呼叫 `saveDocument()` 前先設為 true；document blob 已寫、index 後段失敗時，旗標與 `appliedUpdatedAt` 都會保留，取消／改回原狀後不會再命中乾淨頁面的提前 return。
- 沒有發現新的 Blocker／Major。另發現一個 summary 拖曳視覺殘餘，列為非阻擋 Minor，詳見下文。

### 阻擋 1／New Major D — 核心已修正

#### relation render ownership 與跨圖規則

- `js/editor/relations.js:262-275` 在每次 overlay render 先建立 `buildMapContext(doc.root)`，再分別查 relation 的 `fromId`／`toId` 所屬 `mapRootId`。只有 `fromMap === toMap` 時才在最外層 `.relation-overlay` `<g>` 加 `data-map-root`。
- ownership 只標在 relation 的最外層 group；內部 `.relation-path`、hit area、`.relation-label` 沒有重複標記。因此 `collectMapFollowers()` 只會收一個可平移容器，不再發生第三輪「父 group、path、label 疊加三次 transform」。
- 兩端不同圖的 relation 不帶 `data-map-root`，`js/editor/floating.js:201-210` 的精確 selector 不會收它；這與本輪明定的跨圖規則一致。放開拖曳後由 command 觸發完整 render，以新座標重算跨圖 Bézier，而不是在 gesture 中把兩端一起錯移。
- relation label 的原始定位仍留在 child `<g transform="translate(...)" ...>`（`js/editor/relations.js:288-301`）；拖曳 transform 套在沒有既有 transform 的 parent relation group，所以 child label 定位不會被取代。

#### summary render、HTML transform 與清除

- `js/editor/summary.js:188-215` 依 `summary.parentId` 的 map context，同時在 SVG `.summary-bracket` 與 HTML `<button class="summary-node">` 加同一個 `data-map-root`。兩者分居 svgLayer／nodesLayer，`collectMapFollowers()` 會各收一次，沒有巢狀重複位移。
- `js/editor/floating.js:226-241` 只收目前被拖 map root 的節點、tree edges 與 `[data-map-root="目前圖"]` overlay；節點改 left/top，tree edge 用 SVG attribute transform，relation／summary overlay 用 CSS `style.transform`。HTML button 的 CSS transform 確實有效，不再是第三輪寫 SVG attribute 到 HTML 而完全不移動。
- `js/editor/floating.js:243-250` 的共同 end handler 同時服務 `pointerup` 與 `pointercancel`，並在 no-move、attach、update command 等分支之前先移除 tree-edge transform、清空所有 overlay inline transform；沒有留下拖曳殘值。語法檢查與 diff whitespace 檢查也都 exit 0。

#### 新 Minor：summary label 置中 transform 被暫時取代，selected boundary 不跟隨

- `css/features.css:65-78` 的 `.summary-node` 原本靠 `transform: translateY(-50%)` 垂直置中；拖曳時 `js/editor/floating.js:241` 寫入 inline `transform: translate(dx, dy)`，依 CSS cascade 會取代而不是合成 class transform。因此 label 會跟著正確的圖走，但 gesture 中實際 Y 位移會多出約半個 label 高度，放開清空 inline style 後再回到置中位置。
- summary 被選中時另有兩個 `.summary-boundary` circle（`js/editor/summary.js:217-223`），目前沒有 `data-map-root`，所以拖圖期間控制點留在原位，放開完整 render 才校正。
- 這兩點只影響拖曳中的短暫視覺 fidelity，不會再誤移別張圖、不會破壞 relation transform，也不會留下錯誤資料；判 **Minor／非阻擋**。後續可用 wrapper、獨立 `translate` property，或把 baseline `translateY(-50%)` 與 drag delta 合成，並替 boundary control 標 ownership。

### 阻擋 2／New Major A — 已修正

- `js/editor/main.js:283-287` 先把 live edit 暫套進 doc；只有 dirty、live snapshot 與既有 live snapshot flag 全部不存在時才提前 return。
- 關鍵修正在 `js/editor/main.js:294-301`：只要本次帶 `restoreLiveEdit`，呼叫 `saveDocument()` **之前**就先令 `liveSnapshotPersisted=true`；正常成功後才依本次實際寫入內容重設為 `Boolean(restoreLiveEdit)`。
- `js/store.js:249-278` 的部分寫入順序是 document blob 先寫、index／snapshot 後寫；後段 throw 會附 `error.appliedUpdatedAt`。`js/editor/main.js:307-324` 先校正 `lastSavedUpdatedAt`，保留預先設好的 live flag，最後一定還原 RAM 中的 canonical doc。
- 因此「live blob 已落盤、index write 才失敗」時，之後 `Esc` 取消所觸發的 `onLiveChange`（`js/editor/edit.js:150-158`）仍會排 canonical rewrite；下一次 `saveNow()` 不會被 `!dirty && !restoreLiveEdit` 擋掉，也會使用已校正的 CAS stamp。第三輪的幽靈內容成因已被封住。
- 若錯誤發生在 document 寫入之前，預先設 true 只會保守地促成一次額外 canonical rewrite，不會丟資料；`saveDocument()` 回 false 的永久刪除路徑也不會重建已刪文件。未見此修補引入新的資料一致性破壞。

### 指定驗證結果

| 驗證 | 實際結果 | Exit code |
|---|---:|---:|
| `node tests/core.test.mjs` | **36/36 PASS** | 0 |
| `node tests/io.test.mjs` | **21/21 PASS** | 0 |
| `node --test tests/*.test.mjs` | **18/18 TAP pass，0 fail** | 0 |
| `cd desktop && npm test`（以 `desktop` 為工作目錄執行 `npm test`） | **136/136 PASS，0 fail** | 0 |
| `node --check`：main／floating／relations／summary | **4/4 exit 0** | 0 |
| `git diff --check`：上述四個修補檔 | **無輸出、通過** | 0 |

- 聚合 Node 測試的 18 個 TAP 項包含自有 runner 檔；其中 core 36/36、cursor data URI 5/5、DELTA 21/21、IO 21/21、layout 7/7、spatial navigation 13/13、store/search 9/9 及其餘 node:test 個案均顯示全綠。
- 依指示沒有重跑完整 E2E。讀取 `docs/SHORTCUT_MATRIX.md:3-4` 確認報告產生時間為 **2026-09-06 16:05:04**、總結果 **214/214 PASS**；表格實際有 214 筆 PASS row。

### 發版聲明應保留的非阻擋 Minor

1. **Live snapshot 尚未涵蓋 pending 格式狀態**：`pendingStyle`／`pendingMetadata` 未進快照；renderer 突然終止時，可能丟失尚未 commit 的 align、font、font size、line height 等一次格式操作，但文字與 richText 已一致。
2. **SVG export 的 independent-map branch palette 仍是單樹配色**：`js/io/export.js:603-618` 的 `buildBranchLookup()` 尚未逐 map root 重啟 palette；多分支獨立圖在 SVG 可能共用同一 branch 色，屬匯出視覺 fidelity。
3. **兩張合法獨立圖可用完全相同座標重疊**：兩個 `__floating__:100,100` root 不會自動錯開；使用者可拖開，資料不會消失。
4. **概要拖曳中的短暫視覺偏差**：HTML summary label 的 `translateY(-50%)` baseline 會被 drag inline transform 暫時取代，selected boundary circles 也不跟隨；放開後完整 render 校正，未造成跨圖誤移或持久化錯誤。

### 自首

- 依指示沒有執行完整 E2E，也沒有自行冒充重現作者提供的真瀏覽器數字。兩個 blocker 的第四輪獨立裁決來自實際 source path／CSS cascade／狀態轉移複查、四組 fresh tests，以及作者已提供的真瀏覽器 probe 與既有 214/214 報告；現有正式 tests 並沒有直接 assertion「index 部分寫入後 Esc 回寫」或「兩圖 overlay drag ownership」。
- 本輪沒有啟動 Playwright CLI、沒有建立 `.playwright-cli`，也沒有刪除任何檔案或目錄。兩次 read-only 搜尋曾分別因 Windows glob 與 `rg` PATH 問題非零退出，均改用明確路徑／PowerShell `Select-String` 完成，未改變工作區。
- 沒有執行 commit、checkout、reset、clean、add 等 Git 寫入；Git 只用於 `status`、`diff` 與 `diff --check`。除本節追加外沒有修改其他檔案；起始工作樹原本就有多個 modified／untracked 檔，全部保留。

### 簽字結論

**通過。** 第三輪兩個 release blocker 均已在實際程式路徑上封住：部分寫入後的 live snapshot 旗標不再遺失；同圖 overlay 有明確 ownership，跨圖 relation 不再被誤移，relation transform 層級與 drag-end cleanup 也正確。新增看到的 summary drag 視覺偏差與既有三項殘餘均屬非阻擋 Minor，已完整列入發版聲明清單。

簽字：Codex（獨立複審，第四輪）  
日期：2026-09-06（Asia/Taipei）
