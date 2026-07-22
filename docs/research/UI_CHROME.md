> **Confidence**: high
>
> **Sources**:
> - https://gitmind.com/tw/faq/how-to-use-gitmind.html
> - https://gitmind.com/faq/how-to-use-gitmind.html
> - https://gitmind.com/faq/edit-node.html
> - https://gitmind.com/faq/create-mindmap.html
> - https://gitmind.com/faq/outline-mode.html
> - https://gitmind.com/faq/insert-link.html
> - https://gitmind.com/faq/question.html
> - https://gitmind.com/faq/share-collaborate.html
> - https://gitmind.com/faq/flowchart.html
> - https://gitmind.com/faq/file-management.html
> - https://gitmind.com/faq/theme-background.html
> - https://gitmind.com/faq/focus.html
> - https://gitmind.com/faq/change-layout.html
> - https://gitmind.com/faq/style-format.html
> - https://gitmind.com/faq/switch-layout.html
> - https://gitmind.com/faq/icon-sticker.html
> - https://gitmind.com/faq/relationship-summary.html
> - https://gitmind.com/faq/export-mind-map.html
> - https://gitmind.com/faq/edit-mind-map.html
> - https://gitmind.com/faq/shortcuts.html
> - https://gitmind.com/faq/prompt-to-mind-map.html
> - https://gitmind.com/faq/common-questions.html
> - https://gitmind.com/faq/whiteboard-tutorial.html
> - https://gitmind.com/faq/version-history.html
> - https://gitmind.com/faq/gitmind-changelog.html
> - https://leadingmrk.com/gitmind-tutorial/
> - https://welly.tw/blog/gitmind
> - https://benic360.com/gitmind-review/
> - https://deanlife.blog/gitmind-toturial/

---

# GitMind 編輯器 UI Chrome 研究報告（Implementation Spec 用）

> 研究方法說明：本報告以官方教學頁 `https://gitmind.com/tw/faq/how-to-use-gitmind.html` 的**原始 HTML**（含所有教學動圖 `alt` 文字與 GIF 圖檔網址）為主要依據，並**下載了教學頁內嵌的真實產品 GIF 截圖、用 ffmpeg 抽取影格、逐張目視比對**，因此以下多數細節是「螢幕截圖直接驗證」而非僅憑文字轉述，可信度較高。文字補充來源列於文末 Sources。凡標示「⚠️版本差異」代表不同時期截圖有出入，兩者都列出供你判斷。

---

## 0. 品牌視覺與色彩（screenshot-verified）

- **主色（accent）是橘色，不是藍/綠**：Share 按鈕填色、"一鍵搭配"按鈕、"升級"圖示、Hot 徽章、GitMind Logo 主色實測像素值約 **RGB(241,126,46) ≈ #F17E2E**（橘色系，官網其他 CSS 中另見 `#FA7534`、`#FE8346`、`#F67D28` 等相近橘色，可視為品牌橘的色域）。
- **Logo**：橘紅色漸層的環狀塗鴉筆刷圖案（類似手繪螺旋箭頭），旁邊搭配文字「GitMind」。
- **工具列（Toolbar chrome）底色**：純白／極淺灰，實測 RGB(254,254,254) ≈ `#FEFEFE`，呈**白色圓角膠囊（pill）**懸浮在畫布上方，不是佔滿整條的長方形列。
- **畫布（Canvas）底色**：**不是固定色**，會隨當前主題（Theme）而變——實測看到：近白 `#FFFFFF`（預設/簡約主題）、奶油杏色 `#FDEDDD`、薄荷水彩綠 `#9FF4ED` 系、深色主題近黑 `#0B0E1A`（深藍黑，適合簡報投影）。工具列本身的白色 pill **不隨畫布深色主題變色**，深色畫布下工具列仍是白色。
- **節點（Node）預設風格**：圓角矩形（rounded-rectangle），中心主題（root）通常用飽和填色（如橘、黃）+ 白字，子節點（branch）常用「淺底 + 同色系邊框」，且**每一大分支會各自分配不同顏色**（藍/綠/橘/黃/紫…），連接線為**貝茲曲線（bezier curve）**、粗細隨層級遞減、顏色跟隨分支色。這是 GitMind 多數內建主題的共同模式。

---

## 1. 編輯器頂部工具列（Top Toolbar）

版面切成**三個獨立白色圓角膠囊區塊**，中間有透出畫布背景的間隙，並非一條通長 bar：

### 1-A 左側區塊（檔案資訊）
由左至右：
1. **返回箭頭 `<`**（Back，回到我的檔案列表）
2. **檔名文字**（如「文檔」「未命名」），點擊可重新命名
3. 分隔線 `|`
4. **⏱ 最近儲存 HH:MM**（自動儲存時間戳，圖示為時鐘），部份錄影中顯示「⏳ 自動儲存所有內容」或「✔ 儲存成功」的暫態文字

### 1-B 中間區塊（主編輯工具列，白色膠囊）
screenshot 中實測到 **11 個圖示**（左至右），對照官方文字說明逐一核實：
1. **↶ 復原 Undo**
2. **↷ 重做 Redo**
3. **添加下級節點**圖示（虛線框→實線框，斜角相接）— 對應快捷鍵 Tab
4. **添加同級節點**圖示（虛線框在上、實線框在下，直向相接）— 對應快捷鍵 Enter
5. **添加上級節點**圖示（實線框→虛線框，反向斜角）— 對應快捷鍵 Shift+Tab
   > 這三顆的準確中文標籤與快捷鍵，已在**節點右鍵選單截圖中逐字核對**：「添加上級節點 Shift+Tab」「添加同級節點 Enter」「添加下級節點 Tab」（見第 5 節）
6. **格式刷 Format Painter**（油漆刷圖示）— Ctrl+Alt+C / Ctrl+Alt+V 對應複製/貼上格式
7. **`[T]` 文本 Text**（方括號包 T，字體/字級/顏色/對齊/行距設定入口）
8. **⊕ 插入 Insert**（圓圈加號，下拉含：連結 Link／圖片 Image／備註 Note／公式 Formula；圖示 Icon／貼紙 Sticker 則另外走右側樣式面板）
9. **概括 Summary**（方框+分支小箭頭圖示）
10. **關係線 Relationship Line**（兩個交纏圓圈圖示，快捷鍵 F4）
11. **✻ 魔法棒 Magic Wand（一鍵換主題）**（星芒/煙火狀圖示）— 點擊會**直接隨機套用一組配色主題**並跳出綠色勾選提示「設置成功」（screenshot 實測），這是**快速換主題**功能，不是 AI

> ⚠️版本差異：較新的截圖（AI 相關教學 GIF，2023 年後）工具列在「魔法棒」之後**多出兩顆圖示**：
> 12. **演示模式 Presentation**（旗幟/相框狀圖示）
> 13. **`AI` 圖示**（方框內直接寫「AI」字樣的按鈕）— 點擊在節點旁彈出三段式下拉選單：「一鍵獲得答案 ›」「一鍵提出問題 ›」「一鍵生成心智圖 ›」（其中「一鍵生成心智圖」再展開三選一子選單：「至少3個節點」「至少5個節點」「至少8個節點」）
> 較舊截圖只有 1–11 顆、沒有 12–13，判斷是後期加入 AI 功能時擴充的工具列，實作時建議直接做 13 顆的新版。

### 1-C 右側區塊（分享／匯出／更多，白色膠囊）
由左至右 3 個圖示：
1. **分享 Share**（社群節點圖示 ⁠— 三顆小圓圈用線相連）；在教學 GIF 中此鍵常態顯示為**橘色實心藥丸按鈕「分享」**（文字而非純圖示），點擊開啟「邀請協作者」彈窗（見第 8 節）
2. **匯出/開啟 Export**（方框+右上斜箭頭，外部連結樣式圖示），點擊開啟「匯出」彈窗（見第 7 節）
3. **`···` 更多 More**（三個點），hover 有 tooltip「更多 / 查看更多功能」，點擊展開完整下拉選單（見第 3 節，**已完整截圖核對**）

### 1-D 浮動主題按鈕（獨立於工具列之外）
右側邊緣（工具列下方、垂直置中略偏上）有一顆**獨立圓形白色浮動按鈕**，圖示同樣是橘色魔法棒／星芒，功能與工具列上第 11 顆相同（一鍵換主題捷徑），**在深色主題下依然固定顯示、不隨畫布變暗**。此按鈕位置固定在畫面右側、不隨其他面板開合而移動（Style 面板打開時它會被面板部分遮蓋、退到面板左緣之外可見一小截）。

---

## 2. 右下角控制群（Bottom-right cluster）

實測（screenshot 逐一核對，由左至右）：
1. **檢視模式切換下拉**：文字＋chevron，如「大綱+心智圖 ▾」／「心智圖 ▾」，hover tooltip 顯示「切換視圖 / 切換心智圖/大綱視圖」。點擊展開可選：純心智圖 / 純大綱 / 心智圖+大綱分屏（三選一）
2. 分隔線 `|`
3. **－**（縮小 zoom out）
4. **百分比數字**（如 `92%`、`100%`）— 純顯示，可能也可點擊重置（快捷鍵 Ctrl+0 重置縮放）
5. **＋**（放大 zoom in）
6. 分隔線 `|`
7. **手形/拖曳工具圖示**（畫布平移工具）
8. **全螢幕圖示**（expand/四角箭頭，對應快捷鍵 F11）
9. **眼睛圖示 👁**（最右端，推測為「預覽/簡報預覽」或「唯讀檢視」切換，確切彈窗內容未截取到）

此群組固定貼在畫面右下角，白底、與頂部工具列同款圓角膠囊風格，即使開啟右側 Style 面板也維持可見（面板不會完全遮住它，只會往左退讓）。

另外文字教學提及**分屏模式（Split-screen）**入口也在右下角：點擊【分屏模式】後可選【上傳文件】(支援 pdf/doc/docx) 或【打開網頁】，畫面會左右分割，一邊顯示參考資料一邊編輯心智圖——這顆按鈕應該就是視圖切換下拉裡「大綱+心智圖」同一組選項之一，或緊鄰其旁（原文寫「右下角點擊【分屏模式】」，暗示可能是視圖下拉展開後的第三個選項）。

---

## 3.「···」更多選單（screenshot 完整核對，逐字無誤）

點擊右上角三個點後，彈出的下拉選單由上到下：

1. **專注 Focus**（圖示：圓圈+中心點，靶心狀）
   — 分隔線 —
2. **團隊協作 Team Collaboration**（雙人圖示）
3. **尋找 & 取代 Find & Replace**（放大鏡圖示）— 右側灰字顯示快捷鍵 `Ctrl+F`
4. **歷史版本 Version History**（時鐘/歷史圖示）
5. **一鍵整理 One-Click Organize**（文件/列表圖示）
   — 分隔線 —
6. **顯示評論 Show Comments**（對話框圖示）— 右側附**開關 toggle switch**（可開/關評論顯示）
7. **快速鍵 Shortcuts**（鍵盤相關圖示，開啟快捷鍵速查表）
8. **設定 Settings**（齒輪圖示）
   — 分隔線 —
9. **選單底部狀態列**（非按鈕，純資訊文字）：「評論: N」「節點總數: N」— 顯示目前檔案的留言數與節點總數

> 對照空白畫布右鍵選單（第 6 節），可發現「一鍵整理」「歷史版本」「尋找 & 取代」在兩處都能觸發（右鍵選單多了「展開/收起」「全選 Ctrl+A」「懸浮節點」「更多 ›」等項目，兩個選單有重疊但不完全相同）。

---

## 4. 右側樣式面板（Style Panel，screenshot 完整核對）

選取節點後點擊工具列 [T] 旁的樣式入口，或右下角/其他觸發點，會從畫面右側滑出一片**白色面板**（有 `✕` 關閉鈕），面板頂部是 **4 個分頁 tab**（文字＋底線標示當前選中，選中色同樣是品牌橘）：

**`樣式` │ `主題` │ `佈局` │ `圖示`**

### 4-A「樣式 Style」分頁
由上到下的區塊（每區塊標題＋對應控制項一列，每列通常 2–4 個下拉/色塊控制項）：
- **形狀 Shape**：形狀下拉選單（矩形/圓角矩形等）＋填色色塊（含下拉展開色盤）
- **圓角 Corner Radius**：橫向滑桿（slider）＋右側數字輸入框（如 `6`、`5`，單位隱含 px）
- **邊框 Border**：線型下拉（實線/虛線）＋顏色色塊＋粗細下拉（如 `0px`）
- **連接線 Connector Line**（子節點被選取時才出現此區）：線形（如直角轉折/曲線）下拉＋顏色色塊＋線型下拉＋粗細下拉（如 `2px`）
- 面板可上下捲動（右緣有 scrollbar），文字版 FAQ 另補充此分頁下還能調整「節點間距、背景顏色」等，惟未實際截到那幾區

### 4-B「主題 Theme」分頁
分頁內頂部又有**次分頁（pill 切換鈕）**：`主題` │ `背景`
- **主題子分頁**：
  - **「一鍵搭配」大按鈕**（橘色實心，全寬），旁邊有一顆小提示圖示，說明文字：「點擊『一鍵搭配』，可以快速搭配主題樣式！」
  - **彩虹線條 Rainbow Lines**：下拉選單，預覽是一條漸層色帶（用來設定連接線是否採用彩虹漸層配色）
  - **熱門主題 Popular Themes**：縮圖網格（2 欄以上，可捲動），每個縮圖是一張迷你心智圖預覽圖
  - 文字版 FAQ 補充：主題縮圖右鍵/hover 有 `···` 可選「置頂」（最多釘選 6 個常用主題）或「設為預設」
- **背景子分頁**：可選「隨機背景」「熱門背景」縮圖，或設定「純色背景」，付費版可「自訂上傳背景圖片」

### 4-C「佈局 Layout」分頁（文字核對，未截到畫面，但描述明確）
提供結構切換：**心智圖 Mind Map／邏輯圖 Logic Chart／樹狀圖 Tree Chart／組織圖 Org Chart／魚骨圖 Fishbone**，另外 Release Notes 提到還有**時間軸 Timeline（垂直/水平兩種）**版面。此分頁套用時分兩層：
- 選取**單一節點**時，面板改標示「結構 Structure」子選項，只調整該節點以下的區域走向/佈局
- 未選節點（或選 root）時套用到**全域佈局**

### 4-D「圖示 Icon」分頁（screenshot 部分核對）
再分兩個子項：
- **圖示 Icon**：分類含「優先順序 Priority／進度 Progress／旗幟 Flag／表情 Emotion／符號 Symbol／Logo」等圖示庫，插入後**在節點內再次點擊該圖示即可移除**
- **貼紙 Sticker**：分類含「商務 Business／教育 Education／科技 Technology／表情 Emotion／旅行 Travel／天氣 Weather」等，移除方式是**選取節點→右鍵→「移除貼紙」**
- 另有「插畫 Illustration」是透過頂部工具列「插入 Insert」→「貼紙」→「插畫」路徑，不在此面板內

---

## 5. 節點右鍵選單（screenshot 逐字核對）

選取節點按右鍵，彈出選單（由上到下，含分隔線分組）：

```
添加上級節點          Shift + Tab
添加同級節點          Enter
添加下級節點          Tab
──────────────
選擇                  ›
插入                  ›
分解
──────────────
複製                  Ctrl + C
黏貼                  Ctrl + V
刪除                  Delete
刪除當前節點          Ctrl + Delete
```

補充（文字版 FAQ 提到、螢幕截圖未直接顯示但邏輯上同一選單樹）：
- 若節點已加了圖示，右鍵可「移除貼紙」
- 若節點已加了連結/附件，右鍵可「移除」連結
- 「分解 Split」＝把選取節點連同其子樹拆成一份**全新的心智圖檔案**（獨立文件）

---

## 6. 空白畫布右鍵選單（screenshot 逐字核對）

在畫布空白處按右鍵，彈出選單：

```
一鍵整理
展開/收起
全選                  Ctrl + A
──────────────
懸浮節點  (= 自由節點 Free Node)
歷史版本
尋找 & 取代           Ctrl + F
──────────────
更多                  ›
```

文字版 FAQ 補充「更多 ›」子選單內含（未截圖，來自 how-to-use-gitmind.html 逐字內容）：
- **引入心智圖**（合併另一份心智圖檔案進來，用滑鼠拖拽合併節點）
- 其餘可能還包含「切換背景」等（演示模式簡報時右鍵有獨立的「切換背景」項，屬於演示模式專屬右鍵選單，非畫布右鍵選單）

---

## 7. 匯出 Export 彈窗（screenshot 完整核對）

點擊右上角匯出圖示，彈出**置中 modal**（背景蒙上半透明灰）：

- 標題「**匯出**」，右上角 `✕` 關閉
- 提示文字：「＊點擊『匯出』下載」
- **格式選擇區**：橫排 6 個「圖示卡片＋文字標籤」，各自獨立色系圖示：
  `JPG`（紫色）／`PNG`（橘色，圖示帶棋盤格紋樣代表可透明）／`PDF`（紅色）／`WORD`（藍色）／`TXT`（藍色）／`GITMIND`（橘色圓形 logo，即匯出成 .gitmind 原生格式）
  — 點擊某卡片會**橘色外框**標示當前選中
- **當選 PNG 時**，下方多出兩個 radio 選項：`● 帶背景`／`○ 透明無背景`
- 底部按鈕（右下對齊）：「**取消**」（灰底）／「**匯出**」（橘色實心，主要按鈕）

文字版 FAQ 補充（未截圖）：
- 另有 **HD 匯出**（高解析度模式，供列印用）：可調整「邊距」（預設 80）與「渲染比例」（預設 200%，列印建議 400%）
- 付費版可設定「隱藏 GitMind 浮水印」、自訂浮水印文字/顏色/旋轉角度/透明度/大小

---

## 8. 分享／邀請協作者彈窗（screenshot 完整核對）

點擊右上角「分享」（橘色藥丸按鈕），彈出置中 modal：

- 標題「**邀請協作者**」，右上角 `✕` 關閉
- 第一列：**權限下拉選單**（如「獲得連結的人，僅可查看 ▾」，其他選項含「可編輯」等）＋右側**「複製連結」橘色按鈕**
- 第二列（動畫展開）：「**分享設置**」文字，其下有連結權限的核取狀態列表（如「✓ 獲得連結的人，僅可查看」），以及「**關閉分享**」選項（可整體停用分享連結）

文字版 FAQ 補充：
- 步驟為：打開心智圖 → 右上角『分享』→ 勾選『獲得連結的人，可編輯』→ 複製連結 → 發給協作者 → 對方登入帳號即可即時協作（real-time collaboration，多人同時編輯）
- 可設定**分享密碼**（有「重新產生一組」的按鈕）
- 分享連結可設定「僅查看」「可編輯」「可查看/保存」等權限層級

---

## 9. 大綱視圖 Outline（screenshot 完整核對）

透過右下角「檢視模式」下拉切換為「大綱」或「大綱+心智圖」時：

- 從畫面**右側滑出一片白色面板**（半覆蓋在心智圖畫布上，非取代整個畫布——這與「大綱+心智圖」分屏模式相符）
- 面板頂部：**當前檔名**（如「人生規劃」）＋一個小圖示（形似「展開/彈出」icon）
- 面板右上角 `✕` 關閉
- 內容主體：**縮排式項目符號清單**（bullet list），依心智圖的父子階層自動縮排對應（`•` 圓點 bullet），可捲動（右緣可見 scrollbar）
- 大綱模式下仍可用 `Tab` 加下級、`Enter` 加同級、`Shift+Enter` 換行（與心智圖模式操作邏輯一致）

---

## 10. 節點被選取時的浮動小工具

- **留言/評論圖示**：選取（或 hover）節點時，節點**右上角**會浮現一顆小圓形圖示（`···` 或對話框樣式），點擊後跳出評論輸入框；此圖示只在滑鼠移到節點或節點被選取時才顯示，屬於**per-node 浮動 icon**，不是全域工具列的一部分。（此開關可在「···更多」選單的「顯示評論」toggle 全域關閉）
- **手機版浮動工具列**（文字版 FAQ 描述，行動 App 專屬，非網頁版）：選取中心主題或節點後，畫面浮出一排按鈕：`編輯 Edit` │ `同級節點 Sibling` │ `下級節點 Child` │ `格式 Format` │ `刪除 Delete`；右上角另有 `···` 選單含 `Undo`／`Redo`。此為 Mobile App 專屬版面，與 Web 版右鍵選單不同，實作 Web Clone 時可不必照搬，但若同時規劃行動版可參考。

---

## 11. 首頁儀表板（Home Dashboard，screenshot 完整核對，「我的檔案」）

### 11-A 頂部導覽列（Nav bar，白底）
左至右：
- **GitMind Logo**（橘紅漸層筆刷圖案 + 文字「GitMind」）
- **熱門範本**（Templates，橘色 `Hot` 小徽章貼在右上角）
- **下載 App**（Download App，⚠️版本差異：另一版截圖此位置是空的，直接接「我的檔案」）
- **我的檔案**（My Files，當前頁面高亮）

右至左：
- **升級 Upgrade**（橘色小圖示 + 文字，⚠️部分帳號無此鈕，可能與是否已購買 VIP 有關）
- **使用教程 ▾**（Tutorials 下拉選單）
- **使用者頭像**（圓形，實測為藍紫色底+白色姓名縮寫，如「F」）＋姓名文字「Fiona wu ▾」／「北宸 ▾」，VIP 帳號頭像右上角有一顆**小皇冠徽章**

### 11-B 左側側邊欄（Sidebar，白底，圖示＋文字兩欄式選單）
由上到下：
1. **新增文檔 New Document**（虛線畫框＋加號圖示）
2. **最近編輯 Recently Edited**（時鐘圖示）
3. **我的心智圖 My Mind Maps**（文件圖示，當前選中時整列呈**橘色底、白字**高亮）
4. **我的流程圖 My Flowcharts**（文件圖示）
5. **團隊協作 Team Collaboration**（雙人圖示）
6. **我的分享 My Shares**（分享圖示）
7. **我的收藏 My Favorites**（愛心圖示）
8. **資源回收筒 Trash**（垃圾桶圖示）

### 11-C 主內容區（檔案列表）
頂部一列（依版本略有不同，兩種都截到）：
- **版本 A**：純標題「我的心智圖」文字 + 右側：搜尋放大鏡圖示 🔍／「新增」／「多選」／「時間降序 ▾」／「網格式圖 ▾」
- **版本 B**：三顆按鈕「新增心智圖」「新增資料夾」「本地導入」（灰底圓角按鈕並排）+ 右側：搜尋 🔍／「多選」／「時間升序 ▾」／**格狀檢視／列表檢視**兩顆圖示切換鈕（grid view / list view toggle）

檔案卡片（Grid 排列，每張卡片＝一個縮圖圖示＋下方檔名文字）：
- 縮圖統一是「文件夾角摺頁＋分支線條」風格的**通用圖示**（並非心智圖內容縮圖預覽圖）
- 若該檔案已分享，卡片**右上角疊加一顆小圖示**：分享圖示（橘色「‹›」節點狀）或團隊圖示（人像），用以區分「我的分享」與「團隊協作」檔案
- 「範本 Template」以資料夾圖示（橘色描邊資料夾）呈現，混在檔案列表最前面

### 11-D 熱門範本 Templates 頁（另一個 tab，screenshot 完整核對）
- 左側篩選側欄：搜尋框「搜尋 🔍」＋分類樹狀清單：
  - `全部範本`（All Templates，當前選中橘底高亮）
  - `心智圖 Mind Map` 大類，其下子分類：教育學習／網站工具／商務職場／讀書筆記／個人規劃／行業分類／生活娛樂
  - `流程圖 Flowchart` 大類，其下子分類至少含：分析圖／泳道圖（其餘被截斷未見全）
- 主內容區標題「全部範本」，網格卡片：第一張固定是**「＋新增心智圖」大按鈕卡**（橘色虛線框＋大加號＋橘字），其餘為範本縮圖卡（每張是該範本的**實際心智圖縮圖預覽**＋底下檔名，如「專案成員結構圖」「如何畫心智圖」「減肥小妙招」「2020年讀書計劃」「個人自我分析」「七個學習資源與線上網站」「專案管理架構圖」），縮圖卡片背景色會依範本主題不同（白/粉/黃/紫等）

---

## 12. 個人中心（Personal Center，文字版核對）

點擊右上角頭像進入，可執行：
- 暱稱修改、頭像更改、帳號綁定（Google／Facebook／Twitter／Apple ID 等第三方登入）
- 「其他設置」內有「自動換行」開關（文字編輯時是否自動換行）
- 「檔案遷移」：輸入其他帳號的遷移碼、點擊「立即遷移」，把該帳號的心智圖檔案轉移到目前帳號

登入/註冊彈窗：右上角點『登錄』，支援 Email／Google／Facebook／Twitter／Apple ID 註冊登入。

---

## 13. 思想星球／團隊協作（Planets / Team Collaboration，文字版核對）

- **創建星球**：登入後選『我的星球』→『創建星球』命名即可；非會員限 1 個星球，付費會員最多 5 個
- **星球管理**：hover 星球項目點『···』可選重命名、允許成員評論、允許成員新建、「炸毀星球」（刪除星球）
- **邀請成員**：進星球→『邀請成員』→複製邀請連結發送
- **成員管理**：可設定成員權限為「僅查看」「可編輯」「可查看/保存」，也可設為「星球管理員」或直接移出星球
- 側邊欄選單同一功能後期似乎更名為「團隊協作 Team Collaboration」（兩份不同時期文件用詞不同，功能邏輯一致）

---

## 14. 完整鍵盤快捷鍵表（來自官方 `/faq/shortcuts.html`，逐條照抄）

**節點操作 Node Operations**
| 功能 | 快捷鍵 |
|---|---|
| 插入下級節點 | Tab |
| 插入同級節點 | Enter |
| 插入上級節點 | Shift+Tab |
| 展開/收合節點 | Ctrl+/ |
| 刪除選取節點（保留子節點）| Shift+Delete |
| 刪除節點 | Delete |
| 上移節點 | Alt+Up |
| 下移節點 | Alt+Down |
| 框選節點 | Ctrl+滑鼠左鍵 |
| 複製節點樣式 | Ctrl+Alt+C |
| 貼上節點樣式 | Ctrl+Alt+V |
| 複製節點（Duplicate）| Ctrl+D |
| 選取上方同級節點 | Shift+Up |
| 選取下方同級節點 | Shift+Down |

**基本操作 Basic Operations**
| 功能 | 快捷鍵 |
|---|---|
| 復原 | Ctrl+Z |
| 重做 | Ctrl+Y |
| 複製 | Ctrl+C |
| 貼上 | Ctrl+V |
| 剪下 | Ctrl+X |
| 儲存 | Ctrl+S |
| 重新整理 | Ctrl+R |

**樣式設定 Style Settings**
| 功能 | 快捷鍵 |
|---|---|
| 換主題 | F6 |
| 開啟主題 | Ctrl+P |
| 開啟樣式 | Alt+Y |
| 清除樣式 | Ctrl+D |

**文字編輯 Text Editing**
| 功能 | 快捷鍵 |
|---|---|
| 換行 | Shift+Enter |
| 編輯 | Space |
| 粗體 | Ctrl+B |
| 斜體 | Ctrl+I |
| 底線 | Ctrl+U |
| 格式刷 | Ctrl+G |
| 加優先順序 | Ctrl+數字 |
| 放大字級 | Ctrl+Shift+> |
| 縮小字級 | Ctrl+Shift+< |

**插入功能 Insert Functions**
| 功能 | 快捷鍵 |
|---|---|
| 插入連結 | Ctrl+Alt+K |
| 插入備註 | Ctrl+Alt+M |
| 插入概括 | Ctrl+Alt+T |
| 插入圖片 | Alt+P |
| 插入圖示 | Alt+I |
| 插入關係線 | F4 |
| 插入評論 | Ctrl+Alt+R |

**畫布調整 Canvas Adjustment**
| 功能 | 快捷鍵 |
|---|---|
| 重置縮放 | Ctrl+0 |
| 畫布縮放 | Ctrl+滑鼠滾輪 |
| 排列佈局 | Ctrl+Shift+L |
| 大綱視圖 | Ctrl+O |
| 拖曳畫布 | 滑鼠左鍵 |
| 全螢幕 | F11 |
| 適應整個畫布 | Ctrl+Alt+F |
| 置中主題 | Ctrl+Shift+R |

**進階功能 Advanced Features**
| 功能 | 快捷鍵 |
|---|---|
| 開啟協作 | Shift+Alt+O |
| 歷史版本 | Shift+Alt+H |
| 懸浮節點切換 | Shift+Alt+F |

（注意：F6/Ctrl+P 換主題快捷鍵與工具列「魔法棒」按鈕功能重疊；F4 關係線、Alt+I 插圖示、Ctrl+Alt+T 概括等都對應第 1 節工具列上的按鈕。）

---

## 15. 落差與待確認事項（給實作團隊）

1. **工具列 11 顆 vs 13 顆**兩種版本都出現在官方教學截圖裡，實作 clone 建議直接做**完整 13 顆**（含 Presentation + AI），並把「魔法棒」與「AI」視為兩個獨立按鈕。
2. **右下角眼睛圖示**功能未能從截圖確認具體彈窗內容（可能是「簡報預覽」或「唯讀模式」），建議之後用瀏覽器實測登入帳號後直接點擊確認。
3. **分屏模式（Split-screen）**的觸發入口文字說是「右下角」，但螢幕截圖中右下角只看到「檢視模式下拉／縮放/全螢幕/眼睛」這一組，分屏可能是檢視模式下拉裡的第三個選項（心智圖/大綱/分屏三選一），也可能是被裁切在截圖外的另一顆獨立按鈕，需要實測確認。
4. **付費牆（Credits/VIP）**：部分主題、部分匯出設定（隱藏浮水印、HD 匯出）、自訂背景上傳、多個思想星球等都是 Premium 限定，實作時要規劃 free/paid 兩層。
5. 「思想星球」與「團隊協作」在不同時期文件用詞不一致，兩者高機率是同一功能改版更名，建議統一為一套資料模型。

---

## Sources

**官方教學／FAQ（gitmind.com）**
- [如何使用 GitMind（繁中，原始碼含完整逐字教學文＋圖片 alt／GIF 網址）](https://gitmind.com/tw/faq/how-to-use-gitmind.html)
- [How to use GitMind（英文版）](https://gitmind.com/faq/how-to-use-gitmind.html)
- [GitMind Node Editing Tutorial](https://gitmind.com/faq/edit-node.html)
- [GitMind Create & Import Mind Map Tutorial](https://gitmind.com/faq/create-mindmap.html)
- [GitMind Outline Mode Tutorial](https://gitmind.com/faq/outline-mode.html)
- [GitMind Link Insertion Tutorial](https://gitmind.com/faq/insert-link.html)
- [Frequently Asked Questions - GitMind](https://gitmind.com/faq/question.html)
- [GitMind Real Time Collaboration Tutorial](https://gitmind.com/faq/share-collaborate.html)
- [How to Make Flowcharts/Diagrams with GitMind?](https://gitmind.com/faq/flowchart.html)
- [File Management - GitMind Batch Operation Tutorial](https://gitmind.com/faq/file-management.html)
- [GitMind Theme & Background Customization Tutorial](https://gitmind.com/faq/theme-background.html)
- [GitMind Focus Mode Tutorial](https://gitmind.com/faq/focus.html)
- [GitMind Layout and Structure Changing Tutorial](https://gitmind.com/faq/change-layout.html)
- [GitMind Style Customization & Format Painter Tutorial](https://gitmind.com/faq/style-format.html)
- [Switch Layouts | GitMind（行動版）](https://gitmind.com/faq/switch-layout.html)
- [GitMind Icon and Sticker Insertion Tutorial](https://gitmind.com/faq/icon-sticker.html)
- [GitMind Relationship & Summary Insertion Tutorial](https://gitmind.com/faq/relationship-summary.html)
- [GitMind Export Tutorial](https://gitmind.com/faq/export-mind-map.html)
- [GitMind Mobile Phone Mind Map Editing Tutorial](https://gitmind.com/faq/edit-mind-map.html)
- [Keyboard Shortcuts For GitMind Mind Map](https://gitmind.com/faq/shortcuts.html)
- [GitMind AI Prompt to Mind Map Tutorial](https://gitmind.com/faq/prompt-to-mind-map.html)
- [GitMind Common Questions](https://gitmind.com/faq/common-questions.html)
- [How to Use Whiteboard](https://gitmind.com/faq/whiteboard-tutorial.html)
- [GitMind Version History Tutorial](https://gitmind.com/faq/version-history.html)
- [GitMind Release Notes](https://gitmind.com/faq/gitmind-changelog.html)

**第三方繁中評測（提供輔助文字描述）**
- [【2026 GitMind 評價】— 領先時代](https://leadingmrk.com/gitmind-tutorial/)
- [GitMind教學懶人包 - Welly SEO](https://welly.tw/blog/gitmind)
- [【GitMind】免費線上心智圖使用教學評價 - 班老大](https://benic360.com/gitmind-review/)
- [GitMind教學：6個線上免費心智圖實際應用 - deanlife.blog](https://deanlife.blog/gitmind-toturial/)

**截圖直接證據（本次研究下載並用 ffmpeg 抽格逐張比對的教學動圖，皆內嵌於上方 how-to-use-gitmind.html／tw 版頁面）**
- `how-to-use-gitmind-tw-1031-1.gif`（軟體簡介／官網首頁）
- `faq-2022-1.gif`（新增心智圖／範本頁）
- `how-to-use-gitmind-3.gif`（批量管理／我的檔案列表）
- `faq-2022-30.gif`（重新命名／我的檔案列表另一版）
- `how-to-use-gitmind-tw-1031-13.gif`（換主題／樣式面板 Theme 分頁）
- `how-to-use-gitmind-tw-1031-17.gif`（更改樣式／樣式面板 Style 分頁）
- `how-to-use-gitmind-tw-1031-19.gif`（插入圖示／樣式面板）
- `how-to-use-gitmind-tw-1031-18.gif`（大綱編輯／右下角檢視控制）
- `how-to-use-gitmind-tw-1031-9.gif`（刪除節點／節點右鍵選單）
- `how-to-use-gitmind-tw-1031-8.gif`（自由節點／畫布右鍵選單）
- `how-to-use-gitmind-tw-1031-33.gif`（專注模式／「···」更多選單完整內容）
- `how-to-use-gitmind-tw-1125-5.gif`（檔案匯出／匯出彈窗）
- `how-to-use-gitmind-tw-1125-3.gif`（分享協作／邀請協作者彈窗）
- `ai-creates-mindmap.gif`（AI創作／13顆工具列＋AI下拉選單，深色主題畫布）

**信心等級**：high（頂部工具列組成、右鍵選單、「···」更多選單、匯出/分享彈窗、Style 面板 4 分頁、右下角控制群、首頁儀表板版面 — 皆為螢幕截圖逐一目視核對；少數項目如分屏模式確切觸發位置、眼睛圖示彈窗內容、佈局/圖示分頁完整縮圖 — 僅有文字描述、未截圖驗證，已在第 15 節列為待確認）。
