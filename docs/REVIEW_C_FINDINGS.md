# REVIEW_C 確認缺陷清單（第二輪審查 + 對抗性驗證 + 主 session 實測）

## 1. [major] REGRESSION-13/3 殘留：orthogonal 主題下只改「線型」會把整條連線形狀改成曲線
- 檔案: js/editor/sidepanel.js:320 | 維度: regression-18
- 細節: refreshPanel 用 `parseLineToken(appearance.lineStyle, 'solid', 'curved')` 推導面板的連接線形狀，但主題級的 lineShape（如 monochrome-outline、cream-notes 的 'orthogonal'）不在 node style 的 lineStyle token 裡，fallback 寫死 'curved'，於是面板顯示「曲線」而畫布實際是直角。mountStyleControls 的 updateLine（sidepanel.js:147）又把兩個 select 的值一起送 `setLineStyle({shape, style})`，applyLineStyle 比對 current.shape='orthogonal' vs next='curved' 視為真實變更，寫入 `lineStyle='dotted|shape=curved'`。已用 node 腳本實測：灰階綱要主題節點，只把線型改成 dotted，連線 shape 從 orthogonal 變 curved。這同時是 finding 3 的家族問題（把面板當下值釘進節點覆蓋）：正確做法是 refreshPanel 的 fallback 用 theme.lineShape，且 updateLine 只送使用者實際變更的那一個欄位。
- 觸發場景: 文件套用「灰階綱要」或「奶油筆記」主題（直角連線）。選取節點，在樣式面板「連接線」把線型從實線改成細點虛線（完全不碰形狀下拉）→ 該節點連線立刻從直角變成曲線，且 lineStyle token 永久記住 shape=curved，之後切任何主題該節點連線都不再跟隨主題形狀。

## 2. [minor] REGRESSION-15 半修：openExport/share/presentation/aiMenu 仍是 stub，export.js 依舊零使用者可達路徑
- 檔案: js/editor/toolbar.js:49 | 維度: regression-18
- 細節: #export-button 綁的 'openExport' 沒有任何模組註冊真實作（全 repo grep 僅 keyboard.js:198 的 showComingSoon fallback 註冊），點擊只彈「此功能即將推出」toast。這滿足了 PHASE_FIX_BRIEF「不准 silent no-op」的字面要求，Ctrl+F 也已有真實 findReplace，所以 finding 15 的原始觸發場景（無任何反應、無提示）不再重現；但該 finding 的核心抱怨——js/io/export.js（JSON/TXT/MD/Word/SVG 匯出全部完成且測試通過）交付後沒有任何 UI 入口——在本輪之後依然成立。tidyLayout、insertComment、toggleOutline、history 同樣是 toast stub。
- 觸發場景: 使用者點工具列「匯出」按鈕或分享/簡報/AI 按鈕：只看到「此功能即將推出」toast，無法取得任何一種已實作完成的匯出格式；整個 IO-CORE 匯出能力對使用者仍然不存在。

## 3. [minor] REGRESSION-13 殘留子項：SVG/PNG 匯出仍丟棄 richText 局部格式
- 檔案: js/io/export.js:207 | 維度: regression-18
- 細節: finding 13 明確列出「richText 局部格式同樣被丟棄（只用 node.text）」。本輪 svgNode/svgConnection 已補齊 10 種形狀、straight/orthogonal 線形、borderStyle dasharray 與圓角（皆已腳本實測通過），但 measureSvgNode/wrapSvgText 仍只讀 node.text，節點內局部加粗/斜體/顏色（node.richText）在匯出圖裡整段變回統一樣式。PHASE_FIX_BRIEF 第 9 點只要求「形狀/線型/圓角進 SVG 匯出」，故此屬 brief 未涵蓋的原 finding 殘留，非新回歸；若原版 GitMind 匯出保留局部格式，需在下一輪補（SVG tspan 已按行輸出，可擴充為按格式片段輸出）。
- 觸發場景: 節點文字「重點事項」中只把「重點」兩字加粗紅色，匯出 SVG/PNG：整行以統一字重與 textColor 呈現，局部加粗與紅色消失，畫布所見與匯出圖不一致。

## 4. [major] 貼上 URL / 剪貼簿貼圖在真實 Ctrl+V 下完全失效（與 FIX keyboard.js 衝突）
- 檔案: js/editor/attachments.js:154 | 維度: delta-audit
- 細節: attachments.js 用 window 的原生 'paste' 事件實作「貼上 URL 自動偵測」與 clipboard 圖片貼上，但 FIX 的 keyboard.js dispatchGlobalShortcut 對命中 binding 的 Ctrl+V 一律 event.preventDefault()（keyboard.js:696），keydown 被 preventDefault 後瀏覽器不會再派發 native paste 事件。headless Chromium 實測：真實 page.keyboard.press('Control+v') 貼 URL → 0 個 .node-link badge、無 toast；改用合成 ClipboardEvent('paste') 直接 dispatch → 成功出現 badge（DELTA 的 Playwright 驗證應是走合成事件才誤判通過）。對照組證實同環境無 preventDefault 時 Ctrl+V 會正常觸發 paste。修法：把 URL/圖片貼上邏輯掛進 'paste' action 內（keyboard 的 paste() 內部剪貼簿為空時 async 讀 navigator.clipboard），或 keyboard 在內部節點剪貼簿為空時不 preventDefault。
- 觸發場景: 使用者複製任一網址，選取節點按 Ctrl+V：什麼都不發生（keyboard 內部節點剪貼簿為空回 false，native paste 已被抑制）。剪貼簿圖片 Ctrl+V 貼入節點同樣死亡。兩個 SPEC 功能在真實鍵盤操作下 100% 不可用。

## 5. [major] 概要用 parentId+startIndex/endIndex 錨定，兄弟節點增刪後蓋錯節點
- 檔案: js/editor/summary.js:22 | 維度: delta-audit
- 細節: summary 記錄的是 children 陣列索引而非節點 id，但 commands.js 的 addChild/addSibling/deleteNodes/moveNode splice children 時不會（也不能，FIX 禁區）同步 summaries。node 實測：4 個子節點，概要蓋 index 1-2；對 index 0 的節點按 Enter 插入同級 → 概要改蓋 ['NEW','分支主題']（新節點+原第一個），不再涵蓋原選取；刪除範圍前的兄弟 → 概要從蓋 child2+child3 變成只蓋 child3。GitMind 語意應跟節點走。修法：概要改存 startNodeId/endNodeId（或成員 id 陣列），渲染時反查 index；或 DELTA 在自己的 remove/insert 覆寫層加 summaries 索引補償。
- 觸發場景: 建立概要涵蓋節點 B、C 後，在 A 後插入新同級或刪除 A，大括弧立即滑到錯誤的節點區間；繼續編輯後錯誤永久化並存檔匯出。

## 6. [major] 尋找取代只改 node.text，富文字節點顯示不變且 text/richText 永久分歧
- 檔案: js/editor/findreplace.js:53 | 維度: delta-audit
- 細節: render.js setTextContent（render.js:239）在 node.richText 非空時優先渲染 richText、忽略 node.text。FIX 新增的 richText 由文字工具列格式化時寫入。createReplaceAllCommand 直接改 node.text（findreplace.js:53-57），單筆取代走 updateText（findreplace.js:141）也只改 text，兩者都不同步/清除 richText。結果：對加粗過的節點取代文字，畫面完全不變，但搜尋計數（吃 node.text）卻顯示已取代，text 與 richText 從此永久分歧且會存檔。修法：取代命中含 richText 的節點時，同步對 richText DOM 文字節點做同樣替換，或至少把 richText 清空退回 plain text。
- 觸發場景: 把某節點文字用文字工具列加粗 → Ctrl+F 搜尋該字詞 → 按「全部取代」→ toast 說已取代 N 個節點，但該節點畫面文字原封不動；undo 後 node.text 恢復但使用者全程看不到任何變化。

## 7. [major] 複製/貼上/Ctrl+D 懸浮節點時 __floating__ token 洩漏，樹中子節點被渲染成脫離的懸浮節點
- 檔案: js/editor/floating.js:14 | 維度: delta-audit
- 細節: 懸浮座標塞在 node.icons 的 '__floating__:x,y' token（DELTA 為避開 model.js 禁區的 workaround）。keyboard.js 的 copy/paste/duplicate 走 cloneSubtreeWithFreshIds，icons 原樣保留。node 實測：建立懸浮節點後 clone 並 insertSubtrees 到一般節點下，貼出的子節點 getFloatingMeta 仍回 {x:300,y:200}。drawFloatingNodes 對任何帶 token 的節點都覆寫絕對座標並按 index 隱藏 connection path，於是這個真實的樹中子節點被畫在原懸浮位置、連線被藏起來，看起來像未掛接，且與原懸浮節點完全重疊。修法：cloneSubtreeWithFreshIds 後（keyboard 禁區）不可改，應在 floating.js 提供 strip 函式並於 DELTA 可控的 paste/duplicate hook 清除 token；短期至少在 drawFloatingNodes 只把「root 直屬子節點」視為懸浮。
- 觸發場景: 選取懸浮節點 Ctrl+C，選取任一節點 Ctrl+V：貼上的子節點不出現在父節點旁，而是疊在原懸浮節點座標上且無連線；Ctrl+D 複製懸浮節點也會兩個完全重疊。

## 8. [minor] DELTA 覆寫 setLineStyle/applyStyle 弱於 FIX 版：無變化也進 undo stack、丟失 affectedIds 與有效值過濾
- 檔案: js/editor/relations.js:206 | 維度: delta-audit
- 細節: relations.js 後註冊覆寫了 keyboard.js 已註冊的 'applyStyle'、'setLineStyle'（actions.js 後註冊者勝），而 sidepanel.js:142/147 都走 runAction，等於 FIX 剛修好的版本被旁路。DELTA 的 setLineStyle 節點分支：(1) do() 只要有節點就 return true，token 相同也算變化——重新引入 REVIEW_B「mutateSelectedStyles 無條件 true」同款問題（FIX 任務書第 3 條）；(2) 對本已與主題一致的節點也寫入顯式 lineStyle token，之後切主題這些節點線型不再跟隨；(3) encodeLineToken(node.style.lineStyle,...) 未帶主題 lineShape fallback（keyboard 版用 getLineAppearance）；(4) 兩個覆寫 command 都沒有 affectedIds，FIX 第 5 條的 undo/redo selection 還原對側欄樣式操作不再生效。applyStyle 覆寫同理丟失 keyboard.applyStyle 的有效外觀比對。建議：節點分支直接委派 runAction 前保存的原 handler（registerAction 回傳 cleanup 可拿到），或 overlay 分支獨立成 'applyRelationStyle' 由 sidepanel 判斷派發。
- 觸發場景: 選取多個未自訂線型的節點在側欄改線條形狀：所有節點（含原本就等效的）被寫入顯式 token，其後 F6 切主題時這些節點的線型/線態不再更新；且該操作 undo 後 selection 不會如 FIX 規格還原。

## 9. [minor] 關聯線端點拖曳重接沒有重複配對檢查，可產生兩條重疊的相同關聯線
- 檔案: js/editor/relations.js:41 | 維度: delta-audit
- 細節: createRelationCommand 的 validate 會擋同 fromId/toId 的重複（relations.js:27），但 updateRelationCommand 只檢查節點存在與 from!==to；beginEndpointDrag 重接端點（relations.js:363）走 update 路徑。node 實測：A→B、A→C 兩條線，把 A→C 的終點拖到 B，doc.relations 出現兩條 A→B。兩條完全重疊，使用者只看得到一條，刪除時只刪到上層那條，另一條繼續存在並匯出。
- 觸發場景: 建 A→B 與 A→C，選取 A→C 拖終點吸附到 B → doc.relations 有兩筆 A→B；刪一次後畫面看似還有一條「刪不掉」的關聯線（其實是第二筆），JSON 匯出含重複資料。

## 10. [minor] updateSummaryCommand 在 do() 回傳 false 前已套用 patch，違反 command 無副作用約定
- 檔案: js/editor/summary.js:56 | 維度: delta-audit
- 細節: do() 先 Object.assign(summary, patch) 再檢查 parent 是否存在（summary.js:56-58）；parent 懸空（其節點已被刪）時回 false，CommandManager 因 false 不入 undo stack，但 summary.text 等欄位已被改掉且無法復原。node 實測：對 parent 已刪除的懸空 summary 執行 update，execute 回 false 但 text 已變 'MUTATED'。觸發面窄（需先有懸空概要，見刪除連鎖 finding），但屬於「回 false 卻改了文件」的原則性缺陷，會隨存檔固化。修法：先驗證 parent 再套 patch。
- 觸發場景: 概要的 parent 節點被刪成懸空引用後，任何程式路徑對它執行 updateSummaryCommand：回傳 false（不可 undo）但文件已被修改並在 500ms 後 autosave。

## 11. [minor] 刪除節點不清理掛在其上的關聯線/概要，懸空引用永久留在文件並隨 JSON 匯出傳播
- 檔案: js/editor/relations.js:187 | 維度: delta-audit
- 細節: DELTA 覆寫的 'remove' action（relations.js:174-190）刪節點只執行 deleteNodes，doc.relations/doc.summaries 中引用該節點的項目原樣保留。實測：刪 B 後 relation A→B 留在 doc.relations（不渲染、不可見），serializeDoc→deserializeDoc 後仍在——normalizeDoc（model.js:163-164）對兩個陣列只做 structuredClone、零引用驗證。正面效果：undo 刪除後關聯線/概要「免費」回得來（實測通過），這是本設計的優點。負面：redo 或永不 undo 時垃圾永久累積、匯出檔帶懸空引用，且與概要 index 漂移 finding 疊加時，殘留概要可能重新指向錯誤節點而「復活」。建議：remove 覆寫層把 deleteNodes 與 removeRelation/removeSummary 包進 manager 既有的 batch()（FIX 已提供），undo 語意不變又能清乾淨；或 normalizeDoc 載入時過濾懸空引用。
- 觸發場景: 建 A→B 關聯線後刪除 B 並繼續編輯：doc.relations 永遠帶著看不見的懸空記錄，JSON 匯出給他人再匯入依然存在；概要同理（刪 parent 後 doc.summaries 殘留）。

## 12. [critical] 節點文字編輯中按 Ctrl+1..9 / Ctrl+D：renderAll 銷毀編輯 session，未提交文字丟失、鍵盤假死、稍後還會詐屍寫回
- 檔案: js/editor/edit.js:55 | 維度: migration-focus
- 細節: FORM_GLOBAL_ACTIONS（keyboard.js:89）放行的快捷鍵中，priority1-9 與 duplicate 會改動文件並觸發 renderAll → nodesLayer.replaceChildren()，把正在編輯的 contenteditable 從 DOM 拔掉。但 edit.js 的 keydown 只對 'save' 先 this.commit()（第 55 行），其餘 FORM_GLOBAL action 直接 dispatch。瀏覽器實測確認四連鎖：(1) 編輯元素被移出 DOM，焦點掉到 BODY；(2) edit.session 未清理 → edit.isEditing 卡 true，之後所有字元鍵/Enter/Esc 在 window handler 被 formMode 吞掉，鍵盤全滅直到滑鼠點擊；(3) 文字浮動工具列卡在畫面上（cleanup 沒跑）；(4) 使用者下次雙擊任何節點時 edit.start 會 commit 這個殘留 session——從已 detach 的元素讀出當時打到一半的字，寫回原節點（實測：節點文字憑空變成「打到一半的字」）。修法：dispatchGlobalShortcut 前對所有會 mutate 文件的 FORM_GLOBAL action 先 commit（比照 save），或 renderAll 前保護/收掉 active session。
- 觸發場景: 雙擊節點進入編輯、打了幾個字，想到要標優先級順手按 Ctrl+1（SPEC §1 鍵）：優先級圖示套上了，但輸入中的文字消失、文字工具列卡在畫面上、鍵盤完全沒反應（打字/Enter/Esc 都無效），必須滑鼠點擊才能恢復；幾分鐘後雙擊別的節點編輯時，剛才消失的半截文字突然寫回原節點。

## 13. [major] 焦點守衛只認 INPUT/TEXTAREA/SELECT/contentEditable：焦點在按鈕/選單項/主題卡時，Enter/Space/字元鍵被全域綁定劫走
- 檔案: js/editor/keyboard.js:684 | 維度: migration-focus
- 細節: isFormTarget（keyboard.js:684）不含 BUTTON 或 role=menuitem/button 元素，且 dispatchGlobalShortcut（:692）不檢查 event.defaultPrevented。瀏覽器實測三個具體洩漏：(1) 右鍵選單開啟時自動 focus 第一個選單項（contextmenu.js:64），按 Enter 不會執行聚焦的「添加上級節點」，而是被全域 insertAfter 綁定 preventDefault 搶走、插入一個同級節點，選單還留在原地（實測節點 5→6、menu 未關）；(2) 主題卡（sidepanel.js:270，tabindex=0 role=button）自帶 Enter handler 有 preventDefault 但沒 stopPropagation，全域 handler 照樣再跑 insertAfter——按一次 Enter = 套主題 + 多出一個幽靈節點（實測 themeApplied=true 且節點 +1）；(3) 焦點在工具列按鈕上按 Enter 插入節點而非觸發按鈕（preventDefault 取消了按鈕 activation），按任意字元鍵則直接清空選中節點文字進入編輯（實測 editingText='a'）。修法：isFormTarget 納入 button/[role=menuitem]/[role=button]，或 dispatchGlobalShortcut 尊重 defaultPrevented。
- 觸發場景: 右鍵點節點開選單，用鍵盤操作（↑↓ 移動後按 Enter 確認）：執行的不是反白的選單項，而是憑空插入一個同級節點且選單不關閉；在主題面板用鍵盤選主題按 Enter，主題套用的同時圖上多出一個「新主題」節點。

## 14. [minor] richText 局部格式在 SVG 匯出中仍被丟棄（REVIEW_B #13 的殘留半條）
- 檔案: js/io/export.js:207 | 維度: migration-focus
- 細節: FIX 已把形狀（diamond/parallelogram/circle/pill-narrow/自訂 radius）、線型（straight/orthogonal/虛線 dash）、align/lineHeight 全部接進 SVG 匯出（本輪逐項實測通過），但 measureSvgNode/wrapSvgText 仍只吃 node.text（:207），getNodeAppearance 回傳的 richText 在 export.js 沒有任何消費者。Node 實測：node.richText='<b>重點</b>提示' 的節點匯出後是無 font-weight 的純文字 tspan。局部加粗/斜體/顏色是文字工具列的主打功能，畫面與匯出圖不一致。修法最小版：解析 richText 的 b/i/u/span 樣式切成帶屬性的 tspan run。
- 觸發場景: 使用者用文字工具列把節點裡的關鍵字加粗、改紅色，畫布上顯示正確；匯出 SVG/PNG 後所有局部格式消失，變成整段同字重同色的純文字，簡報用圖失去強調效果。

## 15. [minor] 備註欄聚焦時按 Esc 完全沒反應：關不掉備註抽屜
- 檔案: js/editor/attachments.js:294 | 維度: migration-focus
- 細節: noteDrawer 的 textarea keydown 只處理 Ctrl+Enter 儲存（:294-296）；全域 'escape' action（relations.js:248 會跑 featureHandlers.escape → noteDrawer.close）在 formMode 下被 dispatchGlobalShortcut 擋掉（escape 不在 FORM_GLOBAL_ACTIONS，keyboard.js:89）。瀏覽器實測：焦點在備註 textarea 按 Esc，抽屜維持開啟。開啟備註後焦點自動落在 textarea（open() 有 textarea.focus()），所以「打完備註按 Esc 關閉」這條最自然的路徑必然失效，只能點 × 按鈕。對照組：尋找取代框、連結 dialog 的 Esc 都正常（各自有本地 handler / native dialog cancel）。修法：textarea keydown 加 Escape → close()（close 內已含自動儲存）。
- 觸發場景: 使用者按 Ctrl+Alt+M 開備註、輸入完按 Esc 想關閉回到畫布——抽屜不動；再按幾次還是不動，最後只能用滑鼠點右上角 ×，與同 App 內尋找框/連結彈窗的 Esc 行為不一致。

## 16. [critical] 概要（概括）完全無法建立（主 session 實測）
- 檔案: js/editor/summary.js | Ctrl+Alt+T 與工具列「概括」按鈕都靜默失敗：選取根節點右側兩個相鄰 分支主題 後觸發，doc.summaries 仍為 0、無 DOM 元素、無任何提示。疑因根節點 children 陣列左右側交錯導致「連續同級」index 判斷誤殺。修好後也必須：無效選取時給出可見提示（toast），不准靜默。