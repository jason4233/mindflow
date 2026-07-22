> **Confidence**: medium
>
> **Sources**:
> - https://gitmind.com/faq/whiteboard-tutorial.html
> - https://gitmind.com/tw/faq/insert-video.html
> - https://gitmind.com/pricing
> - https://gitmind.com/faq/shortcuts.html
> - https://gitmind.com/faq/edit-node.html
> - https://gitmind.com/faq/insert-function.html
> - https://gitmind.com/tw/faq/change-layout.html
> - https://gitmind.com/tw/faq/how-to-use-gitmind.html
> - https://gitmind.ai/pricing

---

# GitMind 研究完整性稽核與補充報告(Addendum)

## 摘要
依優先順序列出六份既有報告的 TOP 缺口與矛盾,並附上本次追加研究(WebSearch/WebFetch 直接查證官方頁面)的結果與信心等級。

---

### 1.(重大缺口)GitMind Whiteboard 白板模式完全未被涵蓋
`ui-chrome` 報告的來源列表列出 `whiteboard-tutorial.html`,但內文完全沒有討論白板功能——這是一個與心智圖平行的獨立產品模式,對「忠實 clone」是重大遺漏。

**新查證(`https://gitmind.com/faq/whiteboard-tutorial.html`,官方教學頁):**
- 定位:「an unrestricted canvas,允許自由加形狀、輸入文字、建立關係線、插入圖片」,支援無限畫布尺寸。
- 建立方式:登入 → 右上角「我的思維(My Mind)」→「新建白板 +(New Whiteboard +)」,與心智圖檔案同一入口但分開列出。
- 工具列逐項確認:**形狀(Shapes)**、**文字(Text)**、**線條與箭頭(Line/Arrow)**、**自由繪圖(Freehand,鉛筆圖示)**、**圖片(Image,支援 JPG/PNG,可調透明度/圖層)**、**畫布平移(Hand tool)**、**雷射筆(Laser Pointer,簡報用)**。
- 左側樣式面板:可自訂背景色、邊框、文字大小、對齊、線寬(形狀/文字/線/箭頭共用)。
- 平台限制:「mobile support is limited to viewing whiteboard files」——手機版僅能檢視、不能編輯。
- 官方頁面未提及:便利貼(sticky notes)、表格(tables)、框架(frames)、白板專屬快捷鍵。

**結論**:白板應在 SPEC 中列為獨立模組,工具集接近 FigJam/Miro 基礎版,但明顯沒有表格/便利貼/框架等進階要素。

---

### 2.(矛盾釐清)「插入附件」(Insert Attachment) 極可能不是獨立功能
多輪搜尋(含直接搜尋 `insert-attachment.html`、「插入附件」)找不到任何同名官方教學頁。唯一相關的「檔案上傳」其實是已記載的**分屏模式(Split-Screen)**裡「上傳 PDF/DOC/DOCX 供參考」,並非掛在節點上的附件功能。

**結論(中高信心)**:應從 SPEC 中移除「節點插入附件」條目,或改標為分屏模式的參考文件功能。

---

### 3.(缺口補齊)插入影片(Insert Video)完整步驟
**新查證(`https://gitmind.com/tw/faq/insert-video.html`):**
1. 開啟心智圖 → 選中節點 → 點擊工具列「+(插入)」→ 選「影片」
2. 選擇本機影片檔或拖放上傳
3. 上傳完成後節點顯示播放按鈕,點擊觀看

未查到:支援格式清單、是否支援 URL/YouTube 嵌入、檔案大小限制、移除操作、專屬快捷鍵。且手機 App 插入選單**沒有**「影片」選項(見第 8 點),推測為 Web/桌面限定功能。

---

### 4.(矛盾解決)免費/付費方案確切數字 — 官方定價頁直接擷取
**新查證(`https://gitmind.com/pricing`,官方最新定價頁,信心:高):**

| 項目 | Basic(免費 $0) | Monthly $9/mo 或 Annual $4.08/mo | 3-Year(一次性 $79) |
|---|---|---|---|
| 心智圖/白板數量 | 最多 10 個 | 不限 | 不限 |
| 白板圖片數 | 最多 10 張 | 最多 30 張 | 最多 30 張 |
| 心智圖圖片數 | 最多 30 張 | 最多 500 張 | 最多 500 張 |
| 思想星球數 | 最多 1 個 | 最多 5 個 | 最多 5 個 |
| 每星球成員數 | 最多 5 人 | 最多 30 人 | 最多 30 人 |
| 背景上傳張數 | 1 張 | 12 張 | 12 張 |
| 浮水印 | 不支援 | 支援 | 支援 |
| 匯出 | 一般格式 | HD 格式 | HD 格式 |
| 優先客服 | 無 | 有 | 有 |

3-Year 為限時優惠(Black Friday, Nov.21–Dec.12)、一次性付費。

**⚠️ 重大新發現**:`gitmind.ai`(注意是 `.ai`)是完全不同的產品「**GitMind Chat**」(AI 聊天助理,Premium Monthly $19/月、Annual $69/年、內含 2000 AI credits/月),與 `gitmind.com` 心智圖工具無關。此前 `files-export-ai` 報告提到的「5 層方案 + AI credits 2000/4000/5000」第三方資料,極可能是把兩個不同網站的產品混為一談。**實作應只採用 `gitmind.com/pricing` 這張三層表**,排除 `gitmind.ai` 資料。

---

### 5.(確認為官方頁面真實瑕疵,非擷取誤差)Ctrl+D 衝突
再次以不同 prompt 對 `https://gitmind.com/faq/shortcuts.html` 逐表核對,確認:
- 「節點操作」分類:`Duplicate Node | Ctrl+D`
- 「樣式設定」分類:`Clear Style | Ctrl+D`

**結論(高信心)**:這是 GitMind 官方頁面本身的重複標示,不是 AI 摘要造成的誤差。建議 SPEC 依 context 分流(節點聚焦=複製節點,樣式面板聚焦=清除樣式),並記錄為官方已知瑕疵。

---

### 6.(矛盾解決)「刪除節點但保留子節點」的按鍵
對比兩份官方頁面原文:
- `shortcuts.html`:「Delete Selected Node」=`Shift+Delete`,「Delete Node」=`Delete`,**完全沒有 `Ctrl+Delete` 條目**。
- `edit-node.html`(官方逐字):「If you want to delete the selected node and keep its child node, you can select "Delete selected node" or press "**Ctrl+Delete**" on the keyboard.」

**結論(中高信心)**:採用 `edit-node.html` 的說法——`Ctrl+Delete` = 刪除節點但保留子節點(子節點上移遞補);`Delete` = 刪除節點(含子節點)。`Shift+Delete` 語意仍不夠明確,建議實測但不要重複做成「保留子節點」以免與 `Ctrl+Delete` 衝突。

---

### 7.(缺口補齊)節點編號(Node Numbering)極可能不是獨立功能
搜尋只找到「GitMind provides preset symbols... including number numbering (數字編號) and task progress indicators」,與既有報告已完整記載的「優先順序 Priority 數字圖示 + 進度圓餅圖示」是同一件事。

**結論(中高信心)**:GitMind 沒有「自動為所有節點依序編號」的獨立功能,先前報告中「節點編號」存疑項目應撤銷,併入既有 Priority Icon 規格。

---

### 8.(缺口補齊)手機 App 插入選單完整清單
**新查證(`https://gitmind.com/faq/insert-function.html`,官方 Mobile App 教學):**
插入選單依序為:**Image、Summary、Comment、Icon、Stickers & Illustrations**(共 5 類)。

明確不包含:附件、影片、音訊、連結、備註、公式——這些在桌面/Web 版插入選單中都存在。實作行動版時插入功能需明確裁切,不可照搬 Web 版全部選項。

---

### 9. 仍未解決的缺口(建議實測,而非查證失敗)
- **Structure(結構)方向選項具體名稱**:再次核對 `change-layout.html` 原文,仍只有「可以為單個節點調整結構和方向」的籠統敘述,沒有列出具體選項(Left/Right/Both 等)。這是唯一本次仍查無官方逐字清單的項目,建議登入 `app.gitmind.com` 實測截圖確認。
- **版本歷史保留天數**:找到第三方彙整說法「免費版 7 天 / 付費版 30 天,Trash 免費版 7 天 / 付費版不限」,但未能在官方 `version-history.html` 原文中逐字核對到這組數字,列為中等信心。
- **連接線形狀下拉選單完整選項**:`themes-styles` 報告已標注為推論,本次未找到新資料補上,維持存疑。

---

## 給實作團隊的三個關鍵行動項
1. 新增 **Whiteboard 白板** 作為獨立產品模組(形狀/文字/線與箭頭/手繪/圖片/手形平移/雷射筆 + 左側樣式面板),與心智圖分開但共用「我的思維」檔案庫入口。
2. 採用本次直接抓取的官方 `gitmind.com/pricing` 三層表(Basic 免費/Monthly $9 或 Annual $4.08/3-Year $79 一次性),**排除 `gitmind.ai`(不同產品 GitMind Chat)的定價資料**。
3. 刪除節點邏輯定案為:`Delete`=刪除含子節點、`Ctrl+Delete`=刪除但保留子節點;移除「插入附件」節點功能條目;「節點編號」併入既有 Priority Icon 規格。
