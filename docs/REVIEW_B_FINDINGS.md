# REVIEW_B 完整確認缺陷清單（review 工作流 + 對抗性驗證）

> 每條均已被獨立驗證者實際執行代碼確認為真。修復歸屬見 docs/PHASE_FIX_BRIEF.md。

## 1. [critical] 樣式複製 (Ctrl+Alt+C/V) 會連 richText 內容、浮水印設定、間距一起搬走
- 檔案: keyboard.js:341 | 維度: undo-integrity
- 細節: copyStyle 用 structuredCloneSafe(node.style) 整份複製，其中 style.shape 是 ALPHA 的複合 token（例如 'rounded|richText=%3Cb%3E重點%3C%2Fb%3E|radius=12|watermarkText=...'）。pasteStyle 走 applyStyle → commands.js setStyle，而 NODE_STYLE_KEYS 白名單包含 'shape'，所以目標節點的整個 token 被來源 token 整串覆蓋。render.js setTextContent 又是 richText 優先於 node.text（render.js:240-250），因此：(1) 來源節點的「文字內容」會直接顯示在目標節點上；(2) 目標節點自己的 radius/align/lineHeight metadata 全部被清掉；(3) 若來源是根節點，浮水印五項設定與 spacingH/V 會被塞進普通節點；若貼到根節點，反而把浮水印設定和文件間距整個摧毀（doc.canvas.watermark 仍為 true，但設定全部歸零回預設）。這是 token 設計與 setStyle patch 互相破壞的直接證據。
- 觸發場景: 節點 A 文字「重點」加粗（shape token 內含 richText）。Ctrl+Alt+C 複製 A 樣式 → 選節點 B（文字「預算」）→ Ctrl+Alt+V。B 畫面上立刻顯示「重點」（A 的 richText HTML），但 B 的 model text 仍是「預算」，大綱/匯出與畫面不一致。另一路徑：對根節點開了浮水印後 Ctrl+Alt+C 根節點 → 貼到任意節點，或反向從普通節點貼到根節點，浮水印文字/透明度/角度與節點間距瞬間被清空重置。

## 2. [critical] 一次文字編輯 commit 產生 2~4 個獨立 undo 條目，undo 非原子且中間狀態自相矛盾
- 檔案: edit.js:80 | 維度: undo-integrity
- 細節: EditController.commit() 依序執行最多 4 個獨立 command：onCommit→updateText、runAction('setRichText')、runAction('applyStyle', pendingStyle)、runAction('setStyleMetadata', pendingMetadata)。而且只要文字有變 richChanged 必為 true（innerHTML 跟著變），所以「每一次」純文字編輯都至少產生 updateText + setRichText 兩條 undo 記錄。使用者按一次 Ctrl+Z 只會退掉 richText/metadata 那層，node.text 還是新值；因為 render 以 richText 為優先，中間狀態會出現「畫面顯示舊字、大綱與匯出顯示新字」的矛盾。這些應該用 composite/batch command 包成一個條目。
- 觸發場景: 節點原文「Hello」帶粗體 richText。選中後直接鍵入「X」→ commit 產生 updateText('X') + setRichText('')（移除 richText）兩條。按一次 Ctrl+Z：richText 還原成 '<b>Hello</b>'，畫面顯示回「Hello」，但 node.text 仍是 'X'——此時開大綱或匯出 JSON 看到的是 X，畫面是 Hello。再按一次才真正還原。使用者無從得知一次編輯要按幾次 Ctrl+Z（帶字型/對齊操作時要按到 4 次）。

## 3. [major] token encode 把「當下主題的形狀」烙進 node.style.shape，之後切主題該節點形狀永遠不再跟隨
- 檔案: keyboard.js:360 | 維度: undo-integrity
- 細節: applyShape / applyStyleMetadata / setWatermark / setDocumentSpacing 都用 `const current = node.style.shape || getNodeAppearance(...).shape` 再 encodeStyleToken 回寫。對從未自訂過形狀的節點，這會把主題預設形狀（'underline'、'pill'…）變成明確的節點級覆蓋。更嚴重的是配合上一條發現：每次文字編輯的 commit 都會呼叫 setRichText → applyStyleMetadata → 無條件 `node.style.shape = encodeStyleToken(...)`，等於「編輯過文字的每一個節點」形狀都被釘死在編輯當下的主題。applyTheme 的 undo/redo 本身正確，但主題切換的視覺結果被 token 汙染。
- 觸發場景: 在深色星空主題（level2 為 pill）下把幾個節點文字改一改（不碰任何樣式面板），然後按 F6 或在主題面板切到經典藍（level2 應為 rounded、末端 underline）：所有編輯過的節點仍是 pill，沒編輯過的變成新主題形狀，整張圖形狀混雜。同理：開一次浮水印或動一次節點間距滑桿後，根節點形狀從此不再跟主題走。

## 4. [major] 滑桿與浮水印輸入每個 input 事件生成一條 undo 記錄，一次拖曳就淹掉 undo 歷史
- 檔案: sidepanel.js:133 | 維度: undo-integrity
- 細節: 圓角滑桿（sidepanel.js:133 'input' → setStyleMetadata）、水平/垂直間距滑桿（:151）、浮水印透明度/字級滑桿與文字欄（:200，文字欄每個按鍵一次 setWatermark）全都沒有 coalescing/debounce，每個 input tick 都走 manager.execute 各自入棧。CommandManager limit=100，且每次 execute 清空 redoStack。拖一次滑桿產生 30+ 條記錄，會把先前真正的結構編輯從 undo 棧擠掉；undo 時則要一格一格退回拖曳軌跡。連續型控制項應在 pointerup/commit 時合併為單一 command。
- 觸發場景: 使用者做了 60 步節點編輯後，把圓角滑桿從 6 拖到 40（約 34 個 input 事件）再把水平間距從 30 拖到 80（50 個事件）：100 條上限被塞爆，最早的節點編輯永久無法復原。接著按住 Ctrl+Z 想退回拖曳前，得連按數十次，每次只動 1px。

## 5. [minor] 無變化操作仍回傳 true 入棧：幽靈 undo 條目並摧毀 redo 歷史
- 檔案: keyboard.js:374 | 維度: undo-integrity
- 細節: mutateSelectedStyles 的 do() 只要選區非空一律回傳 true（不比對 mutate 前後是否真的有變），setWatermark 的 do() 也無條件回傳 true；commands.js setStyle 對「patch 值與現值相同」同樣照常入棧。CommandManager.execute 對回傳 true 的 command 會清空 redoStack。對比之下 applyTheme/setLayout/setCanvasBackground/updateText 都有 no-op 防護，行為不一致。
- 觸發場景: 使用者 Ctrl+Z 退了 3 步，想先確認目前形狀於是點了一下「目前已是」的形狀按鈕（畫面毫無變化）→ redoStack 被清空，那 3 步再也 redo 不回來；同時 undo 棧多了一條按下去沒任何視覺效果的幽靈記錄。

## 6. [minor] undo/redo 完全不還原 selection；undo 新增節點後選取直接消失
- 檔案: commands.js:36 | 維度: undo-integrity
- 細節: 各 command 執行後由呼叫端 selection.set(...) 設定選取，但 CommandManager.undo/redo 沒有任何 selection memento；main.js renderAll 只做 selection.prune()。undo 一個 addChild/duplicate 後，被選取的新節點消失，prune 把選取清成空集合（primaryId=null），此時 Tab/Enter/方向鍵全部失效，必須用滑鼠重新點一個節點。undo 刪除後恢復的節點也不會被重新選取。題目要求『undo 後狀態完整還原（含 selection）』，目前不符。
- 觸發場景: Tab 新增子節點（自動選中新節點）→ Ctrl+Z：節點移除、選取變空。使用者接著按 Tab 想繼續加節點，毫無反應（insertChild fallback 到 root 是有的，但 Enter 加同級、方向鍵導覽、Space 編輯全部無效），要先用滑鼠點回節點才能繼續鍵盤操作。

## 7. [minor] commit 的 setRichText 目標是 selection.primaryId 而非編輯 session 的節點 id
- 檔案: edit.js:89 | 維度: undo-integrity
- 細節: commit() 內 updateText 用 session.id，但 setRichText 走 keyboard.js:168 `applyStyleMetadata({richText}, [this.selection.primaryId])`，applyStyle/pendingStyle 也吃整個 getSelectedIds()。編輯期間 selection 仍可能改變：SelectionManager.startFrame 對 pointerdown 做 preventDefault（selection.js:37），不會觸發 contenteditable blur，所以在編輯中 Ctrl+拖框選其他節點後再點空白處 commit，A 的 richText HTML（含 A 的整段文字）會寫進框選的最後一個節點 B 的 shape token。
- 觸發場景: 雙擊節點 A 進入編輯並加粗文字，不小心按住 Ctrl 在空白處拖出框選（框到節點 B，primaryId 變成 B，焦點仍在 A 的 contenteditable）→ 點畫布空白 blur 觸發 commit：updateText 正確寫回 A，但 setRichText 把 A 的粗體 HTML 寫進 B，B 從此顯示 A 的文字。

## 8. [minor] 浮水印文字無法清空：setWatermark 把空字串強制改回 'MindFlow' 並回寫輸入框
- 檔案: keyboard.js:434 | 維度: undo-integrity
- 細節: setWatermark 的 `String(config.text || 'MindFlow')` 把空字串視為未填而回退預設值；每次 execute 觸發 renderAll → selection.apply() 廣播 selectionchange → sidepanel.refreshPanel（sidepanel.js:295）把 token 裡的 'MindFlow' 直接寫回 [data-watermark-text]（此處沒有像 setValue 那樣的 activeElement 防護）。使用者刪到最後一個字的瞬間輸入框被改回 'MindFlow'，且每個按鍵還各生成一條 undo 記錄（見滑桿 coalescing 問題）。
- 觸發場景: 使用者想把浮水印文字從 'MindFlow' 改成自己的品牌：全選刪除 → input 事件發出 text='' → command 寫入 'MindFlow' → refreshPanel 把輸入框改回 'MindFlow'，游標位置也被重置，永遠刪不乾淨，只能先打新字再刪舊字來繞過。

## 9. [critical] 編輯節點文字／任何面板輸入框聚焦時，快捷鍵完全不做 preventDefault，瀏覽器原生行為（Ctrl+S/P/O/D/1-8）會蓋掉 App
- 檔案: keyboard.js:108 | 維度: keyboard-fidelity
- 細節: KeyboardController.handleKeydown() 第一行『if (this.edit.isEditing || isFormTarget(event.target)) return』會在任何節點正在編輯文字，或焦點落在任何 INPUT/TEXTAREA/SELECT/contentEditable（例如檔名輸入框 #document-title、右側樣式面板的浮水印文字框 data-watermark-text、字級/間距 slider 等）時，直接整段跳過——不呼叫 event.preventDefault()。而編輯階段真正掛在 textElement 上的本地 keydown（js/editor/edit.js 第51-63行）只對 Escape / Enter(非Shift) / Ctrl+B|I|U 呼叫 preventDefault，其餘按鍵只 stopPropagation()（只擋住往上層 App 監聽器冒泡，擋不住瀏覽器自己的原生動作）。結果是 SPEC §1 表列、且題目明確要求檢查的瀏覽器衝突鍵（Ctrl+P 列印、Ctrl+D 書籤、Ctrl+O 開檔、Ctrl+S 存檔）以及 Ctrl+1~Ctrl+8（Chrome/Edge/Firefox 切分頁）在編輯模式下完全沒被攔截，會直接觸發瀏覽器原生功能。toolbar.js 的 #document-title 輸入框（第52-61行）也是同一套『只 stopPropagation 不 preventDefault』寫法，同樣中招。
- 觸發場景: 使用者雙擊節點進入編輯、打幾個字後反射性按 Ctrl+S 想存檔——彈出瀏覽器原生『另存網頁』對話框而非 App 內建自動儲存；或編輯到一半按 Ctrl+1（SPEC 規定應設定優先順序圖示）——Chrome 直接切到分頁1，整個編輯焦點與上下文瞬間消失；重新命名文件標題時按 Ctrl+P，跳出瀏覽器列印對話框。三者皆可在目前程式碼上 100% 重現。

## 10. [major] Shift+↑/↓ 選同級、Alt+↑/↓ 移動同級，用平面陣列索引直接取值，未按 side 分組——與 layout.js 的視覺分組不一致
- 檔案: keyboard.js:294 | 維度: keyboard-fidelity
- 細節: selectSibling(delta)（第294-300行）與 moveSelected(delta)（第286-292行）都直接用 `context.parent.children[context.index + delta]` 存取『下一個』兄弟節點，把 children 陣列當成單一序列處理。但 layout.js（第79-83行）在 mindmap-both 佈局下，是把 root 的 children 依照 `.side`（left/right）各自獨立分組、各自往下堆疊繪製的。而 model.js 的 createDefaultDoc()（第47-56行，也就是每個新建文件的預設種子資料）把 root 的四個分支節點依序建成 side: right, left, right, left——交錯排列。這代表：選取第一個（畫面上最上方、右側）分支節點按 Shift+↓，會選到陣列裡下一格的『左側』節點，而不是視覺上同在右側、真正的下一個同級節點；對同一個右側節點按 Alt+↓（同級下移）第一次完全沒有可見變化（因為只是跟交錯的左側節點互換陣列順序，兩個右側節點的相對順序未變），要連按兩次才會真的移動到下一個右側同級節點之後。
- 觸發場景: 任何人新建一份文件（預設 mindmap-both 佈局），選取根節點最上方那個右側分支，按 Shift+↓：選取框跳到左側的另一個分支節點，而不是右側下面那個；改按 Alt+↓ 想把它往下移一位，畫面完全沒反應，得連按兩次才看到節點真的往下換位——使用者會以為快捷鍵壞了。

## 11. [major] 多個 SPEC §1 快捷鍵（與對應工具列按鈕）綁定到從未註冊過的 action，按下/點擊後靜默無反應
- 檔案: keyboard.js:68 | 維度: keyboard-fidelity
- 細節: ACTION_BINDINGS 裡列出了 insertLink(Ctrl+Alt+K)、insertNote(Ctrl+Alt+M)、insertSummary(Ctrl+Alt+T)、insertImage(Alt+P)、openIcons(Alt+I)、insertRelation(F4)、priority1~9(Ctrl+1~9)、tidyLayout(Ctrl+Shift+L)、floatingNode(Shift+Alt+F) 等 action 名稱，且 event.preventDefault() 都會正確執行；但用 `grep -rn "registerAction(" js/` 核對全專案，這些 action 名稱從頭到尾沒有任何地方呼叫 registerAction() 註冊實作。actions.js 的 runAction() 在查無對應項時單純回傳 false、不丟錯不提示，等同完全靜默的死快捷鍵。更嚴重的是 toolbar.js 第41、42、43行把 #insert-button、#summary-button、#relation-button 三顆看得到、點得到的工具列按鈕也綁到同一批未註冊的 action 名稱上，所以不只是快捷鍵，連對應的 UI 按鈕點下去也毫無反應、毫無提示。
- 觸發場景: 使用者在工具列點『插入⊕』(#insert-button，理當叫出圖片/連結/備註選單) 或『概括』(#summary-button) 或『關聯線』(#relation-button)——三顆按鈕點擊後畫面上什麼都不會發生，沒有錯誤、沒有 tooltip、沒有選單彈出；改按對應快捷鍵 Ctrl+Alt+K / Ctrl+Alt+T / F4 / Ctrl+1 結果一樣，使用者只會覺得這些功能整個是壞的（而非『尚未實作』）。

## 12. [critical] 編輯提交的 richText/樣式套用到 blur 當下選中的節點，而非被編輯的節點
- 檔案: edit.js:89 | 維度: integration-seams
- 細節: commit() 在第 89-91 行用 runAction('setRichText', ...) 與 runAction('applyStyle', pendingStyle) 收尾，但 keyboard.js:168 的 setRichText 實作是寫入 this.selection.primaryId、applyStyle 寫入 getSelectedIds()。事件順序是：pointerdown 落在節點 B → dnd.js pointerdown handler 先執行 selection.set([B]) → contenteditable 才觸發 blur → queueMicrotask 後 commit。此時 primaryId 已經是 B，於是節點 A 的富文字 HTML（含完整文字內容）被寫進 B 的 style.shape token。render.js 的 setTextContent 優先渲染 richText，B 會直接顯示 A 的文字與格式，並經 autosave 持久化。commit 內應該用 session.id 而非事後的 selection 來定位目標節點。
- 觸發場景: 使用者編輯節點 A 時按 Ctrl+B 加粗任意文字（或 A 本來就有富文字格式），然後點擊節點 B 結束編輯——這是最常見的收尾手勢。B 的內容立刻變成 A 的文字與格式，500ms 後 autosave 寫入 localStorage，undo 也救不回（該 mutation 走 mutateSelectedStyles command，但使用者不會意識到要 undo 兩步）。

## 13. [major] SVG/PNG 匯出的形狀與線型詞彙表未跟上 ALPHA 擴充，Phase B 樣式匯出全部退化
- 檔案: export.js:307 | 維度: integration-seams
- 細節: svgNode()（307-316 行）只認 ellipse / underline / pill / rect / rounded；ALPHA 的 sidepanel 提供 10 種形狀（pill-narrow、pill-wide、rounded-large、soft-rect、circle、diamond、parallelogram）。實測確認：diamond 節點匯出成 rx=12 的圓角矩形，pill-narrow 也不會命中 'pill' 分支。同時 svgConnection() 永遠畫 cubic Bézier，忽略 getLineAppearance 回傳的 shape（straight/orthogonal），所以灰階綱要、奶油筆記等 orthogonal 主題與使用者手選的直線/直角連線，匯出後全變曲線；節點 borderStyle（dotted/dash-dot 等）在匯出時也一律 solid；richText 局部格式同樣被丟棄（只用 node.text）。編輯器畫面與匯出圖不一致，這是 ALPHA↔IO-CORE 兩流各自定義形狀語彙造成的脫鉤，建議把形狀→SVG 的對映抽成 themes.js 的共用資料。
- 觸發場景: 使用者套用「深色星空」主題（pill 形狀，這個字面值剛好命中）以外的新形狀，例如把節點設成菱形、平行四邊形或窄藥丸，再匯出 PNG/SVG：圖檔中所有這些節點都變成普通圓角矩形；orthogonal 主題的直角連線全部變成曲線。匯出結果與畫布所見明顯不符。

## 14. [minor] 永久刪除的文件會被殘留編輯器分頁的 autosave/beforeunload 復活
- 檔案: store.js:148 | 維度: integration-seams
- 細節: saveDocument() 對 index 做 read-modify-write：doc 不在 docs 也不在 trash 時走第 148 行 index.docs.push(meta)，並重寫 mindflow.doc.<id>。編輯器分頁對同一份文件持有記憶體副本且在 beforeunload 無條件 saveNow()（main.js:159），與 dashboard 的 permanentlyDeleteDocument 形成跨分頁競態。實測確認：permanent delete 後再 saveDocument 同一 doc，文件連同內容完整復活回「我的心智圖」。可在 saveDocument 加防護：id 不在 docs/trash 且 doc key 已不存在時視為已刪除，拒絕寫入（或至少不寫回 index）。
- 觸發場景: 使用者開兩個分頁：分頁 1 開著文件 X 的編輯器，分頁 2 在 dashboard 把 X 移到回收筒並「永久刪除」（確認彈窗說『此操作無法復原』）。之後使用者關閉分頁 1——beforeunload 觸發 saveNow，X 完整復活回文件列表，與永久刪除的承諾矛盾。

## 15. [minor] 工具列多顆啟用狀態的按鈕綁定到未註冊的 action，點擊靜默無效；Ctrl+F 被吃掉
- 檔案: toolbar.js:48 | 維度: integration-seams
- 細節: toolbar.js 第 46-58 行把 #export-button 綁 'openExport'、另有 share/presentation/aiMenu/moreMenu、insert-button→insertImage、summary/relation 等；keyboard.js ACTION_BINDINGS 也綁了 findReplace(Ctrl+F)、insertLink、openIcons、priority1-9、tidyLayout、toggleOutline 等。但全 repo 只有 keyboard.js 與 sidepanel.js 呼叫 registerAction，上述 action 沒有任何實作，runAction 靜默回傳 false。這些是留給第二輪 DELTA/GAMMA 的縫，但目前的用戶可見後果是：(1) 匯出按鈕從 Phase A 的 disabled 變成啟用外觀卻點了沒反應——而 IO-CORE 的 export.js 明明已完成，整輪交付零使用者可達路徑；(2) keyboard handler 對命中 binding 的按鍵一律 event.preventDefault()，Ctrl+F 連瀏覽器原生搜尋都被封掉、Ctrl+1..9 同理。第二輪落地前建議：未註冊的 action 對應按鈕加 disabled 樣式，或 runAction 查無 action 時不 preventDefault。
- 觸發場景: 使用者點工具列「⇧ 匯出」或「分享」按鈕：無任何反應、無提示。在編輯器頁按 Ctrl+F 想搜尋：瀏覽器原生尋找被 preventDefault 攔截，應用內尋找又不存在，功能真空。

## 16. [minor] 搜尋結果的 focus 節點參數是 BETA 單方協議，編輯器從未讀取
- 檔案: dashboard.js:473 | 維度: integration-seams
- 細節: dashboard.js openDocument(id, nodeId) 在第 472-474 行把命中節點放進 `editor.html?id=...&focus=<nodeId>`，搜尋結果每條命中路徑都是可點按鈕、明顯暗示會跳到該節點。但 main.js 只讀 `id`（第 30 行），focus 參數無人消費，也沒有任何 TODO 或文件註記把它指派給第二輪。屬於 BETA→ALPHA 的單向假設。要嘛 main.js 補 focus 處理（selection.set + viewport.centerOn），要嘛搜尋結果只保留開啟文件的語意。
- 觸發場景: 使用者全文搜尋後點擊某個命中節點的路徑按鈕（例如『旅行計畫 › 交通 › 末班車時間』），期待定位到該節點；實際文件從根節點視角打開，選中的是根節點，使用者要在大圖裡自己再找一次。

## 17. [minor] 文件縮圖主色用 themeId 雜湊亂數挑色，與實際主題顏色不符
- 檔案: store.js:295 | 維度: integration-seams
- 細節: createDocumentThumbnail 的 colorFromTheme()（第 295-301 行）把 themeId 字串雜湊後從 6 色寫死調色盤挑一色。實測：classic-blue（藍色主題）縮圖是紫色 #8A62C7、monochrome-outline（灰階主題）是粉紅 #D55F78、深色星空是藍色。任務書要求『縮圖 = 存檔時產生的 mini-SVG 快照』，快照理應反映主題。同倉庫的 templates.js（同屬 BETA）已示範 import themes.js 沒有跨流問題，store.js 可直接讀 getTheme(themeId).branchPalette/rootStyle 取真實主色（canvas 背景已經正確讀 doc.canvas.background，只差節點/線條色）。
- 觸發場景: 使用者建立一份經典藍主題的心智圖，回到 dashboard：卡片縮圖是紫色節點；灰階綱要主題的文件縮圖是粉紅色。縮圖與開啟後的畫面顏色對不上，快照失去辨識功能。

## 18. [major] 主題卡片只有內層縮圖按鈕可點（主 session 實測）
- 檔案: sidepanel.js | 點 article.theme-card 外圍或標籤文字無反應，原版整卡可點。