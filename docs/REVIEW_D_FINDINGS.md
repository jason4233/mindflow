# REVIEW_D 確認缺陷與缺失清單（最終輪審查 + 對抗性驗證）

## 1. [major] REVIEW_C #12 只修一半：編輯中按 Ctrl+F 仍重現完整死亡連鎖（文字丟失、鍵盤假死、詐屍寫回並固化）
- 檔案: js/editor/edit.js:7 | 維度: regression-16
- 細節: COMMIT_BEFORE_GLOBAL_ACTIONS 只涵蓋 save/duplicate/nextTheme/priority1-9，但 findReplace 也在 keyboard.js FORM_GLOBAL_ACTIONS 白名單，且 findreplace.js 的 open() → recompute() → ctx.renderAll() 會 nodesLayer.replaceChildren() 整個節點層。瀏覽器實測（本機靜態站載入 editor.html）：雙擊節點編輯、打字後按 Ctrl+F → (1) contenteditable 被 detach（editableDetached=true）；(2) 文字工具列卡在畫面（textToolbarStuckVisible=true）；(3) 關閉搜尋框後 Enter 被吞、無法插入節點（edit.isEditing 卡 true、formMode 恆真）；(4) 下次雙擊任何節點時，殘留 session 把半截文字「打到一半的字」寫回原節點，並被 500ms autosave 固化——重新整理頁面後該髒文字仍在文件裡。對照組實測：Ctrl+1..9 / Ctrl+D / F6 的原始觸發場景已確實修復（先 commit、priority 套用、session 正常結束、鍵盤存活）。修法：把 findReplace 加入 COMMIT_BEFORE_GLOBAL_ACTIONS，或 findReplace 的 open() 在 edit.isEditing 時先 commit。
- 觸發場景: 使用者編輯節點文字打到一半，按 Ctrl+F 想搜尋：輸入中的文字消失、文字工具列殘留、關閉搜尋框後鍵盤全滅（Enter/字元鍵無效）；幾分鐘後雙擊別的節點時半截文字突然寫回原節點並隨 autosave 永久存檔。

## 2. [minor] REVIEW_C #11 只修一半：Ctrl+Delete（dissolve 保留子節點刪除）仍不清理 relations/summaries
- 檔案: js/editor/keyboard.js:262 | 維度: regression-16
- 細節: FIX2 只把 remove action 與 cut 接上 deleteNodesWithOverlaysCommand（該路徑已腳本實測：刪除即清理、undo 完整還原、redo 再清理，含孫節點關聯線）。但 dissolveSelected（Ctrl+Delete）是獨立 inline command，只動樹結構。瀏覽器實測：建立 A→B 關聯線後對 B 執行 dissolve → B 從樹中消失（bStillExists=false），doc.relations 仍留一筆懸空 A→B（danglingRelations=1），會隨 autosave 寫入並出現在 JSON 匯出。summary 的 parentId 或 startNodeId/endNodeId 指向被 dissolve 節點時同樣懸空。另 model.js normalizeDoc（禁區未動）載入時仍零引用驗證，匯入舊檔的垃圾也不會被過濾。修法：dissolveSelected 比照 remove 包進 batch 加 removeRelation/removeSummary 清理。
- 觸發場景: 使用者對掛著關聯線或被概要涵蓋的節點按 Ctrl+Delete 刪除並保留子節點：文件從此永久帶著看不見的懸空 relation/summary 記錄，JSON 匯出給他人再匯入依然存在。

## 3. [minor] REVIEW_C #16 殘留：概要連續性用持久化 node.side 判斷，單側佈局下誤殺相鄰節點、誤放跨節點範圍
- 檔案: js/editor/summary.js:272 | 維度: regression-16
- 細節: getVisualSiblings 以 node.side 過濾兄弟，與 doc.layout 的實際視覺順序脫鉤。預設文件 root children side 交錯保存（right/left/right/left），mindmap-both 主場景已修好（同側相鄰可建、跨側拒絕、無效選取有 toast——均已驗證）。但切到單側佈局（邏輯圖 mindmap-right、組織圖 org、目錄樹、魚骨、時間軸）後所有子節點按陣列序單側排列：瀏覽器實測 layout() 座標確認 c0、c1 視覺相鄰，getSummaryRange(c0,c1) 卻回 null → runAction('insertSummary') 失敗並 toast「概要需要選取至少兩個同父、連續的同級節點」；反之 getSummaryRange(c0,c2)（中間夾著視覺上的 c1）被接受，summaryGeometry 以涵蓋節點的 min/max Y 畫括弧，會視覺罩住未被涵蓋的 c1，語意錯誤。修法：getVisualSiblings 應依 doc.layout（非 both 佈局時不按 side 過濾），或改用 positions 的實際 side/Y 排序（keyboard.js getVisualSiblings 已是這種做法）。
- 觸發場景: 使用者把結構切成邏輯圖或組織圖後，選取視覺相鄰的第 1、2 個分支按 Ctrl+Alt+T：被誤報「不連續」拒絕；改選第 1、3 個分支反而能建立概要，且大括弧視覺上罩住中間未被涵蓋的節點。

## 4. [minor] REVIEW_C #1 殘留後半：只改線型仍把 shape 釘進 lineStyle token，之後切主題該節點形狀不再跟隨
- 檔案: js/editor/keyboard.js:439 | 維度: regression-16
- 細節: 主症狀已修：sidepanel 現在只送實際變更欄位、refreshPanel fallback 讀主題 lineShape（瀏覽器實測 monochrome-outline 下面板顯示 orthogonal、只改 dotted 後 token=dotted|shape=orthogonal、畫布維持直角）。但 applyLineStyle 呼叫 encodeLineToken 時無條件把 nextShape 寫進 token metadata（themes.js encodeLineToken 對 shape 無「等於主題值就省略」的邏輯）。node 腳本實測：灰階綱要（orthogonal）下只把線型改 dotted，token 帶 shape=orthogonal；切到 classic-blue（curved）後 getLineAppearance 回傳 shape 仍是 orthogonal。原 finding 明列的第二半「lineStyle token 永久記住 shape、之後切任何主題該節點連線都不再跟隨主題形狀」依然成立，只是釘住的值從錯誤的 curved 變成當下正確的 orthogonal。修法：encodeLineToken 增加 themeShape 參數，shape 與主題一致時不寫 metadata；或 applyLineStyle 只在 config.shape 明確傳入時才編碼 shape。
- 觸發場景: 灰階綱要主題下把某節點線型改成虛線（完全沒碰形狀），之後 F6 切到經典藍：全圖連線變曲線，唯獨該節點連線永遠保持直角，必須手動改一次形狀才會跟回主題。

## 5. [minor] icons token（priority:1、__floating__:x,y）以原始字串前綴輸出到 SVG/PNG/JPG 匯出圖
- 檔案: js/io/export.js:208 | 維度: regression-16
- 細節: measureSvgNode 直接 `node.icons.join(' ')` 前綴到文字第一行（此行為 FIX2 前既有，本輪 diff 只把它搬進 runLines）。node 腳本實測：帶 priority:1 圖示的節點匯出 SVG 含字面「priority:1」；懸浮節點匯出含字面「__floating__:300,200」。畫布端 iconpanel.decorateNodeIcons 會把 token 畫成優先級圓形圖示、__floating__ token 完全不顯示，但匯出圖顯示原始 token 文字，畫布所見與匯出不一致。與 #7（token 洩漏）、#14（匯出保真）同族；FIX2 讓六格式匯出 UI 正式上線後，使用者第一次能直接踩到此問題。修法：匯出時過濾 __floating__ 前綴 token，並把 priority/progress/flag/emoji token 轉成對應 SVG 圖形或至少人類可讀符號。
- 觸發場景: 使用者給節點掛優先級/進度圖示、或文件裡有懸浮節點，點工具列匯出 PNG/JPG/PDF：圖上節點文字前出現「priority:1」「__floating__:300,200」等原始程式 token 字串。

## 6. [major] documentToSvg 連線幾何未跟上 GAMMA getConnectionPath：org/tree/timeline/fishbone 匯出的線全畫成水平心智圖式
- 檔案: js/io/export.js:350 | 維度: integration-final
- 細節: 畫面渲染 render.js:88-93 以 childPosition.connector || doc.layout 呼叫 getConnectionPath（198-261 行），對 org（父底中→垂直肘形）、tree-right/left（縮排肘形）、timeline-h/v、fishbone（斜線）各有專屬路徑。export.js 的 svgConnection（350-370 行）完全沒讀 position.connector，一律用左右側邊中點 + curved/straight/orthogonal 的水平心智圖幾何。Node 實測對比（同一 doc、同 measure）：org 畫面路徑 `M 0 15 L 0 36 L -106 36 L -106 57`（父底垂直肘形），匯出卻是 `M -41.04 0 C -61.04 0, -35.68 82.92, -55.68 82.92`（父側邊出發的貝茲曲線，斜穿下方節點盒）；tree-right、timeline-h、fishbone 同樣全錯。GAMMA 的局部 structure override（node.style.structure）子樹也一樣中招。FIX2 新增的 exportdialog 讓 JPG/PNG/PDF 首次有真實入口，等於把這條縫直接暴露給使用者。svgConnection 需要接收並分派 connector，與 render.js getConnectionPath 對齊（或直接複用該純函數）。
- 觸發場景: 使用者切到組織圖/目錄樹/時間軸/魚骨圖任一佈局，開匯出彈窗下載 PNG/JPG 或列印 PDF：圖中節點位置正確，但所有親子連線從錯誤的邊緣水平拉出、貫穿節點方塊，與畫面所見完全不同。

## 7. [major] mirrorLeftLayout 與 GAMMA 原生 mindmap-left 佈局雙重鏡像：向左邏輯圖匯出變成向右
- 檔案: js/io/export.js:547 | 維度: integration-final
- 細節: GAMMA 的 layout.js 已原生處理 mindmap-left（composeSubtree→arrangeHorizontal direction=-1，子節點放根左側），export.js 第 87 行仍呼叫 mirrorLeftLayout（547-557 行）把所有非根節點再沿根軸鏡像一次，等於翻回右邊。Node 實測：doc.layout='mindmap-left' 時 layout() 給 child a 中心 x=-138（根中心 0，在左），documentToSvg 輸出的三個子節點 rect 全在 x=+89.04（在右）。匯出圖是自洽的（連線跟著鏡像後座標畫），但方向與畫面相反。tree-left 同樣命中判斷式。修法：刪除 mirrorLeftLayout 呼叫（layout() 已是畫面同款引擎）。
- 觸發場景: 使用者選『邏輯圖 · 向左』編輯，畫面所有分支在根節點左側；匯出 PNG/JPG/PDF 後整張圖的分支全部長在右側，與畫面左右相反。

## 8. [minor] 匯出未套用 applyDocumentSpacing：調過節點間距的文件，匯出圖與畫面比例不符
- 檔案: js/io/export.js:86 | 維度: integration-final
- 細節: render.js:53 在 layout() 後以 doc.canvas.spacingH/spacingV 對所有節點座標做縮放（applyDocumentSpacing，273-288 行，範圍 0.72~2.4 倍），documentToSvg 只呼叫 layout()（export.js:86）沒有做同樣的後處理。使用者在樣式面板把間距滑桿調離預設 30 後，畫面是放大/壓縮過的間距，匯出圖永遠是預設間距。純程式碼比對確認（export.js 無任何 spacing 縮放），未做瀏覽器截圖比對。與 svgConnection 修正同檔處理即可：layout() 後補一次相同的縮放。
- 觸發場景: 使用者把水平/垂直間距調到 80（畫面分支明顯拉開）後匯出 PNG：匯出圖的節點間距回到預設緊湊排列，與畫面所見不一致。

## 9. [minor] MISSING-§6 節點寬度調整未實作（拖左右邊緣調寬、多選批次調寬）
- 檔案: js/editor/render.js:113 | 維度: spec-completeness
- 細節: SPEC §6「節點寬度：拖節點左右邊緣調整；多選可批次調寬」完全沒有對應實作。render.js 建立 .mind-node 元素時不掛任何寬度 resize handle；全 repo 唯一的 resize 互動是 attachments.js:237 的節點圖片角落把手（node-image__resize）。節點寬度只由 measureFn 依文字自動決定（layout.js finiteDimension 上限 360），使用者無任何手動調寬途徑，style 也沒有 width 欄位的寫入路徑。
- 觸發場景: 使用者想把長文字節點拉窄強制換行（GitMind 核心排版操作）：滑鼠移到節點左右邊緣沒有任何 resize 游標或把手，拖曳只會觸發節點拖曳重掛；多選批次調寬同樣不存在。

## 10. [minor] MISSING-§2 右下角控制群缺「手形工具 toggle」
- 檔案: editor.html:85 | 維度: spec-completeness
- 細節: SPEC §2 右下角控制群應含「手形工具 toggle」。zoom-controls 只有縮小/縮放%/放大/fit/全螢幕（+GAMMA 動態加入的小地圖 toggle 與檢視模式下拉），沒有手形工具按鈕。viewport.js 的 spacePressed 屬性初始化為 false 後全 repo 無任何寫入路徑（main.js:68 的 isPanMode 讀它但永遠 false），連 Space 暫時平移也不存在。左鍵拖空白平移已實作，功能面影響低，但 SPEC 明列的 UI 控制項缺席。
- 觸發場景: 使用者想切到手形模式讓「點擊節點也變成平移」（在密集圖上避免誤選節點）：右下角找不到手形工具按鈕，此模式完全不可達。

## 11. [minor] MISSING-§3 樣式面板「結構 Structure」控制項改的是全域佈局而非單節點局部方向
- 檔案: js/editor/sidepanel.js:176 | 維度: spec-completeness
- 細節: SPEC §3 第 5 項：Style 分頁的「結構 Structure」應設定「單節點局部佈局方向（預設 Right）」。實作中 structure-grid 六顆按鈕與「方向」下拉（sidepanel.js:176-177）都直接 runAction('setLayout', ...) 改整份文件的全域佈局；真正的局部覆蓋 action 'setStructure'（viewmode.js:45）只有 Layout 分頁的下拉一個入口。等於 §3 這個控制項有 UI 但語意接錯，SPEC 定義的「在樣式面板對選中節點做局部方向覆蓋」在 Style 分頁不存在。
- 觸發場景: 使用者選中某個分支節點，在樣式面板 Structure 區點「組織圖」想只讓該子樹往下長：整份文件的全域佈局被切成組織圖，其他分支全部跟著變，與 GitMind 行為不符。

## 12. [minor] MISSING-§3 節點間距「適用範圍」下拉是死控制項
- 檔案: js/editor/sidepanel.js:104 | 維度: spec-completeness
- 細節: SPEC §3 第 6 項節點間距含「適用範圍下拉（預設『所有節點』）」。下拉存在且有三個選項（所有節點/目前分支/選中節點），但 mountStyleControls 只對 [data-spacing] 滑桿綁事件，[data-spacing-scope] 沒有任何 listener，值也從未被讀取；spacingH/V 永遠寫進 doc.canvas 全域生效。「目前分支」「選中節點」兩個範圍選了等於沒選。
- 觸發場景: 使用者把範圍切到「目前分支」再調垂直間距，期待只有該分支變鬆：整份文件所有節點間距一起變，下拉選什麼都沒有差別。

## 13. [minor] MISSING-§4 主題分頁無「自訂區」（自訂主題建立/儲存）
- 檔案: js/editor/sidepanel.js:111 | 維度: spec-completeness
- 細節: SPEC §4：主題分頁應有「推薦區（可釘選最多 6 個、可設為預設）；自訂區」。實作只有單一 theme-grid（釘選排序已做），沒有任何自訂主題的建立、儲存、顯示區塊；主題清單固定為 themes.js 的 12 個內建主題，使用者調整過的節點/背景樣式無法存成主題重用。
- 觸發場景: 使用者調好一套配色想存成自己的主題（GitMind 支援的自訂主題流程）：主題分頁沒有「儲存為自訂主題」或自訂區，只能每份文件手動重調。

## 14. [minor] MISSING-§4 主題「設為預設」寫入後無人讀取，預設主題功能實際無效
- 檔案: js/editor/sidepanel.js:302 | 維度: spec-completeness
- 細節: SPEC §4 推薦區主題「可設為預設」。實作是 pin 按鈕的 dblclick 寫 localStorage 'mindflow.theme.default'（sidepanel.js:302），但全 repo 只有這一處引用該 key：store.js createDocument / model.js createDefaultDoc（model.js:76）一律硬編 themeId:'classic-blue'，templates.js 也不讀。設定完預設主題後新建文件永遠還是經典藍。另外「設為預設」的唯一入口是釘選鈕雙擊，無任何可見 UI 提示，可發現性為零。
- 觸發場景: 使用者把「午夜簡報」設為預設主題（雙擊釘選鈕），回首頁新增文檔：新文件仍是 classic-blue，設定完全沒有生效。

## 15. [minor] MISSING-§9 匯入功能零使用者入口（import.js 全 repo 無人引用）
- 檔案: js/io/import.js:14 | 維度: spec-completeness
- 細節: SPEC §9：「匯入：原生 JSON、TXT/Markdown 縮排大綱」。js/io/import.js 的解析器完整（importDocumentJson/Txt/Markdown/Outline，io.test.mjs 有測試覆蓋），但 grep 全 repo 沒有任何模組 import 它：首頁（index.html/dashboard.js）沒有匯入按鈕，編輯器工具列/更多選單/匯出彈窗也都沒有匯入入口。這與 REVIEW_C finding 2 的匯出困境同構——FIX2 只補了匯出 dialog，匯入依然是「引擎完成、UI 缺席」，整個 B4 匯入能力對使用者不存在。
- 觸發場景: 使用者拿到別人分享的 .mindflow 檔或想貼一份 Markdown 大綱建圖：首頁與編輯器找不到任何「匯入」按鈕或拖放區，唯一辦法是打開 DevTools 手動呼叫模組函式。

## 16. [minor] MISSING-§6 概要「樣式可調」缺 UI 路徑
- 檔案: js/editor/relations.js:230 | 維度: spec-completeness
- 細節: SPEC §6 概要：「樣式可調」。summaries 資料結構有 style 欄位（summary.js:33），但樣式面板的 overlay 分派只認 relation：sidepanel.js 的 lineWidth/lineStyle/線色都走 getSelectedOverlay()?.type === 'relation' 判斷，applyRelationStyle（relations.js:230-235）對 type 'summary' 直接回 false，也沒有 applySummaryStyle 之類的對應 action。選中概要時可以 Delete/Space 編輯文字/拖黃色邊界，但線色、線型、粗細、概要節點樣式全部沒有使用者可達的調整方式。
- 觸發場景: 使用者選中概要大括弧，在樣式面板把顏色改成紅色、線寬改 5：面板操作要嘛落到一般節點分支要嘛回 false，概要外觀完全不變，doc.summaries[].style 永遠是空物件。

## 17. [minor] MISSING-DEFERRED Phase C/D 已知延後項盤點（演示/歷史版本/公式/分屏/AI/分享/設定）
- 檔案: js/editor/keyboard.js:199 | 維度: spec-completeness
- 細節: 以下為 SPEC §11 Phase C/D 明列延後、目前以 stub 存在的項目（標註即可，非本輪缺陷）：(1) 演示模式（§7）：presentation action 無人註冊，落 keyboard.js:199 的 showComingSoon toast；(2) 歷史版本（§9）：Shift+Alt+H/選單項存在，shortcuthelp.js:29 註冊「歷史版本尚未接入」notify，快照/列表/預覽/還原皆未做；(3) 公式（§6）：插入選單佔位 toast（attachments.js:390），連 SPEC 允許的 v1 等寬公式樣式簡化版也未做；(4) 分屏模式（§7）：無任何實作；(5) AI 介面層（§0/Phase D）：aiMenu 落 coming-soon toast，SPEC 的「佔位選單＋可設定 OpenAI-compatible API」介面未做；(6) 分享按鈕：toast stub（分享後端 §0 本就延後）；(7) 設定：更多選單與首頁齒輪均為「即將推出」。註：其餘 Phase C 項（大綱視圖、專注模式、小地圖、尋找取代、貼紙、快捷鍵面板）實際已完成，不在此列。
- 觸發場景: 使用者點演示模式/AI/分享/歷史版本按鈕只得到「即將推出」toast——此為已知分階段延後行為，符合 SPEC §11 規劃，列出供驗收時對照。
