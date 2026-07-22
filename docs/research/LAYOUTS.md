> **Confidence**: medium
>
> **Sources**:
> - https://gitmind.com/tw/faq/how-to-use-gitmind.html
> - https://gitmind.com/faq/how-to-use-gitmind.html
> - https://gitmind.com/tw/faq/change-layout.html
> - https://gitmind.com/faq/change-layout.html
> - https://gitmind.com/faq/shortcuts.html
> - https://gitmind.cn/faq/gitmind-hot-key.html
> - https://gitmind.com/faq/outline-mode.html
> - https://gitmind.com/faq/slideshow.html
> - https://gitmind.com/tw/faq/question.html
> - https://gitmind.com/tw/faq/flowchart.html
> - https://gitmind.com/design-balanced-map.html
> - https://gitmind.com/vertical-mind-map.html
> - https://welly.tw/blog/gitmind
> - https://leadingmrk.com/gitmind-tutorial/

---

# GitMind 佈局（Layout）與畫布（Canvas）行為 — 研究報告

來源：GitMind 官方繁中版（gitmind.com/tw）與英文版（gitmind.com）FAQ / 教學頁面，含直接瀏覽器擷取（get_page_text，非 AI 摘要，逐字引用）與 WebFetch AI 摘要（已標註）。

---

## 一、佈局（佈局 / Layout）模式

### 1.1 官方原文（繁中版 change-layout.html，逐字擷取）

> 「在GitMind裡，我們提供了**中心發散的傳統心智圖布局**、**上下分佈的邏輯結構圖**、**時間軸**、**組織結構圖**、**目錄結構圖**和**魚骨圖**」

這是官方頁面唯一一段完整列舉 6 種全域佈局的原文，逐一附帶官方說明：

| # | 中文名稱（官方原文） | 官方說明（逐字） | 對應英文名稱（英文版 change-layout.html） |
|---|---|---|---|
| 1 | 心智圖（中心發散的傳統心智圖布局） | 「主要用於呈現和組織思想和信息，適合用來進行頭腦風暴或總結想法」 | **Mind Map** — "ideal for organizing and brainstorming thoughts and information" |
| 2 | 邏輯結構圖（上下分佈） | 「用來描繪因果關係，或者是步驟和流程，非常適合說明清楚每一個步驟都影響著最終結果」 | **Logic Chart** — "depicting hierarchical structures, causal relationships, or step-by-step processes" |
| 3 | 時間軸 | 「用於表示事件的發展順序和過程，可以用來做歷史時間線、項目規劃等」 | **Timeline** |
| 4 | 組織結構圖 | 「用於表示等級關係和上下級關係，比如說公司的組織結構，或者是家譜等」 | **Org Chart** — "representing hierarchical relationships within an organization" |
| 5 | 目錄結構圖 | 「表示多層次的信息架構時較為常見，比如網站設計、軟件架構、書稿的章節安排等」 | **Tree Chart** |
| 6 | 魚骨圖 | 「用於發現和分析問題的原因和結果（因果分析），常見於質量管理和業務流程分析」 | **Fishbone** — "Ishikawa / cause-and-effect diagram" |

注意：英文行銷頁清單常只列 5 項（Mind Map, Logic Chart, Tree Chart, Org Chart, Fishbone），Timeline 有時被分開描述；但**官方繁中 FAQ 明確列出 6 種**，應以此為準。

另外，官方頁面同段文字裡舉例時寫道：「使用**平衡圖**可以清晰地展示各個部門之間的等級關係」——這裡官方原文用詞是「平衡圖」而非上面列的「組織結構圖」，疑似官方文案本身的用詞不一致（可能是編輯疏漏），予以如實記錄。

### 1.2 額外命名：Balanced Map（平衡圖）

獨立頁面 gitmind.com/design-balanced-map.html（AI 摘要）指出 GitMind 另有 **Balanced Map（平衡圖）** 概念：
- 定義：中心主題左右兩側「均分」呈現分支，特別適合呈現「優缺點對比」（pros and cons）。
- 建立方式：進入 Layout 選單選擇 balanced map layout，雙擊中心主題編輯文字，Enter 加同層節點、Tab 加子節點。
- 與英文行銷頁提到的「可用『+』號在主題兩側新增等量分支」一致。
- **不確定**：這是否為 1.1 節 6 種 layout 之外的第 7 種獨立佈局，或只是「心智圖」佈局在雙側分支下的別稱——官方 FAQ 未將其列入 6 種清單，資料來源為行銷落地頁而非核心教學頁，需標記為待查證。

### 1.3 Timeline 的方向子選項

gitmind.com/vertical-mind-map.html（AI 摘要）提到操作路徑：進入 Layout 選單選 **Timeline**，再選 **「Vertical Layout-Down」**（垂直向下佈局）。這暗示 Timeline 底下至少有「垂直（Vertical / Down）」與預設「水平（Horizontal）」兩種子方向可切換，但未找到官方頁面完整列出所有子選項名稱（如是否有「Vertical Layout-Up」）。

### 1.4 切換方式（官方原文，繁中版 how-to-use-gitmind.html 直接擷取，逐字）

> **切換全域佈局**：「在右側點擊『 樣式 』，選擇『 佈局 』，有多種佈局供你選擇，選中後即可應用到全域。」
>
> **切換單個節點佈局**：「選中單個節點後，在右側點擊『 樣式 』，在樣式的下方選擇『 結構 』，可以為單個節點調整結構和方向。」

即：
- **全域佈局**入口：右側面板『樣式』→『佈局』（英文版：Style button → Layout）
- **單一節點/分支局部佈局**入口：選中節點 → 右側『樣式』→『結構』（可調整該節點以下分支的「結構」與「方向」，但方向的具體選項名稱——如「向右」「向左」「雙向」——**未在官方文件中找到逐字列表**，僅能從其他二手資料側面推測分支結構有方向性差異，此點列為未確認事項）。
- 切換後提示：「在切換布局後，您可能還需要調整節點的位置以匹配新的布局。」（官方原文）

### 1.5 個別圖形（流程圖模式）的排列調整

繁中版 flowchart.html 提到另一組類似但用詞不同的操作，適用於**流程圖模式**（非心智圖）：「選中畫布中圖形，在右側排列編輯方塊內，你可以對圖形進行**位置、角度、方向以及排列方式**等進行調整。」這是流程圖圖形的 arrange 面板，與心智圖的『佈局/結構』面板是分開的兩套 UI。

---

## 二、畫布（Canvas）行為

### 2.1 官方位置說明（二手引用官方教學文字轉述）

編輯畫面的**右下角**有放大、縮小、全螢幕、導航器（小地圖）與快捷鍵說明。全螢幕可以用螢幕的大小來綜觀全部的節點，當放大時，可以利用**導航器視窗內的紅色框**來移動可視的範圍。

即畫布右下角固定有一組控制列，包含：
- 縮小 / 放大（zoom out / zoom in）按鈕
- 全螢幕（fullscreen）按鈕
- **導航器（Navigator / 小地圖 minimap）**：放大後会显示一个缩略图窗口，內有**紅色方框**代表目前可視範圍，可拖動紅框移動視野
- 快捷鍵說明入口

**未找到**官方文件標示具體的縮放百分比範圍（例如是否為 25%–400%），多次搜尋均未取得官方數字，此為確認缺口。

### 2.2 鍵盤快捷鍵（畫布調整類，繁中版 gitmind.cn/faq/gitmind-hot-key.html 與英文版 gitmind.com/faq/shortcuts.html **逐字比對一致**，可信度高）

| 操作（中文） | Operation（English） | 快捷鍵 |
|---|---|---|
| 重置縮放 | Reset Zoom | `Ctrl+0` |
| 畫布縮放 | Canvas Zoom | `Ctrl+滑鼠滾輪` / `Ctrl+Mouse Wheel` |
| 整理布局 | Arrange Layout | `Ctrl+Shift+L` |
| 大綱視圖 | Outline View | `Ctrl+O` |
| 拖動畫布 | Drag Canvas | 滑鼠左鍵 / Left Click（按住拖曳） |
| 全屏顯示 | Full Screen | `F11` |
| 適合整個畫布 | Fit Entire Canvas | `Ctrl+Alt+F` |
| 定位到中心主題 | Center on Main Topic | `Ctrl+Shift+R` |

（`F11` 為瀏覽器全螢幕快捷鍵，非 App 專屬；「適合整個畫布 Ctrl+Alt+F」即 fit-to-view 功能。）

其他非畫布類但完整擷取到的快捷鍵（供實作參考）：

| 分類 | 操作 | 快捷鍵 |
|---|---|---|
| 節點操作 | 插入下級節點 / 同級節點 / 上級節點 | `Tab` / `Enter` / `Shift+Tab` |
| 節點操作 | 展開/收起節點 | `Ctrl+/` |
| 節點操作 | 刪除選中節點（保留子節點）/ 刪除節點 | `Shift+Delete` / `Delete` |
| 節點操作 | 上移/下移節點 | `Alt+Up` / `Alt+Down` |
| 節點操作 | 框選節點 | `Ctrl+滑鼠左鍵` |
| 節點操作 | 複製節點樣式 / 貼上節點樣式 | `Ctrl+Alt+C` / `Ctrl+Alt+V` |
| 節點操作 | 複製節點 | `Ctrl+D` |
| 節點操作 | 同級多選-上/下 | `Shift+Up` / `Shift+Down` |
| 基礎操作 | 復原/取消復原/複製/貼上/剪下/儲存/刷新 | `Ctrl+Z` / `Ctrl+Y` / `Ctrl+C` / `Ctrl+V` / `Ctrl+X` / `Ctrl+S` / `Ctrl+R` |
| 樣式 | 更換主題 / 開啟主題 / 開啟樣式 / 清除樣式 | `F6` / `Ctrl+P` / `Alt+Y` / `Ctrl+D` |
| 文本編輯 | 換行 / 進入編輯 / 粗體 / 斜體 / 底線 / 格式刷 / 加優先級 / 增減字號 | `Shift+Enter` / `Space` / `Ctrl+B` / `Ctrl+I` / `Ctrl+U` / `Ctrl+G` / `Ctrl+數字` / `Ctrl+Shift+">"` `Ctrl+Shift+"<"` |
| 插入 | 連結 / 備註 / 概括 / 圖片 / 圖示 / 關係線 / 評論 | `Ctrl+Alt+K` / `Ctrl+Alt+M` / `Ctrl+Alt+T` / `Alt+P` / `Alt+I` / `F4` / `Ctrl+Alt+R` |
| 進階 | 開啟協作 / 歷史版本 / 自由節點開關 | `Shift+Alt+O` / `Shift+Alt+H` / `Shift+Alt+F` |

### 2.3 大綱（Outline）視圖與同步

官方繁中原文逐字擷取（how-to-use-gitmind.html）：

> 「**大綱編輯**：滑鼠放置右下角按鈕，點擊『 心智圖 』視圖可切換進入大綱模式，在大綱模式下，同樣可以使用『 Tab鍵 』添加下級節點，使用『 Enter鍵 』添加同級節點，使用『 Shift + Enter 』鍵快速換行。」

英文版 outline-mode.html（AI 摘要）補充更完整的視圖切換邏輯：
- 進入方式：畫布**右下角**有視圖切換按鈕
- **三種視圖模式**：
  1. 純心智圖檢視（Mind map view only）
  2. 純大綱檢視（Outline view only）
  3. **心智圖＋大綱並排合併檢視**（Side-by-side combined view）— 此三段式切換亦見於中文部落格（leadingmrk.com）描述為「心智圖／大綱視圖／大綱＋心智圖」，與英文頁互相印證
- 大綱模式下支援節點操作：`Enter` 加同級節點、`Shift+Enter` 換行、`Tab` 增加縮排（等同加子節點）、`Shift+Tab` 減少縮排；亦可用滑鼠拖曳節點調整層級與順序
- 快捷鍵 `Ctrl+O` 可直接切換大綱視圖（見 2.2 節）
- **未明確證實**是否為「即時雙向同步」（real-time two-way sync）——AI 摘要僅表示「文件未明確確認」，但依切換邏輯（同一份資料兩種呈現）合理推斷應為同一資料模型即時互相反映，此為合理推論而非官方明文保證

繁中版另提到 2023 年更新：「大綱模式下，支援多人實時協作」（welly.tw 引用官方更新說明）。

### 2.4 演示 / 簡報模式（Presentation / Slideshow）

**Web／桌面版流程**（官方繁中 how-to-use-gitmind.html 逐字）：

> 「演示模式可以讓您透過動畫的形式，形象生動地展示您的心智圖，操作方法很簡單，打開心智圖，點擊工具欄的「演示」開始演示，演示過程中，**滑鼠單擊畫面即可進入下一頁**。除此之外，選中節點後，滑鼠右鍵選擇「**從當前節點演示**」，可以從該節點開始演示。」

英文版 how-to-use-gitmind.html 補充（AI 摘要）：演示過程中「**右鍵點擊**投影片可跳到結尾或退出演示（right-click on the slide to skip to the end of slides or exit presentation）」，且「演示模式下可更換背景（change backgrounds）」。

**行動 App／不同版本流程**（gitmind.com/faq/slideshow.html，AI 摘要，注意此為手機端操作方式，與桌面滑鼠操作不同）：
- 進入：打開心智圖 → 點擊右上角三點選單 → 選擇 **Slideshow mode**
- 顯示選項：可選擇「**單一節點**顯示」或「**含子節點**顯示」（display single node or subnodes）
- 播放中：點擊畫面中央可再次叫出右上角三點選單，內含更換背景等操作
- 退出：點擊紅色 **Exit** 按鈕返回心智圖視圖

**已知限制**（官方繁中 question.html 使用者留言區，客服 Echo Green 回覆逐字）：
> 「iPad暫時無法使用演示功能哦，請使用桌面端或是網頁端進行演示。」

**PPT 匯出**：頁面標題雖為「How to Convert Mind Map to PPT」，但內文實際描述的是內建 Slideshow 播放功能，**未見到直接匯出成 .pptx 檔案格式**的說明（匯出格式另見一般匯出功能，含 PDF 與多種圖片格式）。

### 2.5 分屏模式（Split-Screen）與專注模式（Focus Mode）

官方繁中原文逐字：

> **分屏模式**：「GitMind支持分屏模式。打開心智圖文件，右下角點擊【分屏模式】，選擇【上傳文件】（支持pdf/doc/docx格式）或者【打開網頁】，成功之後即可開始一邊查閱資料，一邊做心智圖了。」

> **專注模式**：「打開心智圖檔，點擊上側工具列『 專注 』按鈕即可。如果需要退出專注模式，按下『 Esc 』鍵或者右上角點擊『 退出 』即可。」

兩者皆非本題核心「畫布縮放/佈局」範疇，但均與畫布右下角/工具列的操作群直接相關，故一併記錄供實作參考。

---

## 三、資料可信度與缺口說明

| 項目 | 可信度 | 說明 |
|---|---|---|
| 6 種全域 Layout 名稱與官方逐字說明 | 高 | 繁中官方 FAQ 逐字擷取，且與英文版 5+1 分類互相印證 |
| 畫布調整快捷鍵表 | 高 | .com 與 .cn 兩站快捷鍵頁面內容逐字比對完全一致 |
| 大綱三視圖切換（心智圖／大綱／大綱＋心智圖） | 中高 | 英文官方頁 + 獨立中文部落格互相印證，但非同一官方頁面完整列出 |
| 演示模式桌面版操作 | 高 | 繁中官方逐字擷取，英文版補充細節相符 |
| 演示模式行動版操作 | 中 | 來自 slideshow.html 的 AI 摘要，非逐字原文核對，且明顯與桌面版操作邏輯不同（可能對應舊版或手機 App） |
| Balanced Map（平衡圖）是否為第 7 種獨立佈局 | 低 | 僅見於行銷落地頁，未見於核心 FAQ 的 6 種清單中 |
| 個別節點「結構」方向選項的具體名稱（如向右/向左/雙向） | 低 | 官方文件僅說「可調整結構和方向」，未列出具體選項名稱，多次搜尋未獲得逐字清單 |
| Timeline 是否有多個方向子選項及其確切名稱 | 低 | 僅發現「Vertical Layout-Down」一詞，來自行銷頁 AI 摘要，未見完整清單 |
| 縮放百分比範圍（min/max %） | 無 | 多次搜尋未找到官方公開數字 |
| 小地圖／導航器紅框機制 | 中 | 來自二手部落格引用官方教學文字轉述，非逐字官方原文，但描述具體且合理 |

---

**給實作團隊的建議**：1.1 節的 6 種全域佈局（心智圖／邏輯結構圖／時間軸／組織結構圖／目錄結構圖／魚骨圖）與 2.2 節快捷鍵表是本次研究中信度最高、可直接寫入 SPEC 的兩塊；「個別節點結構方向選項」「縮放數值範圍」「Balanced Map 是否獨立於 6 種佈局之外」這三點官方文件均未給出逐字清單，若 SPEC 需要精確數值/選項名稱，建議後續改用實機操作 GitMind 網頁版（需登入帳號）直接截圖核對，而非僅靠公開文件推敲。