> **Confidence**: medium
>
> **Sources**:
> - https://gitmind.com/faq/how-to-use-gitmind.html
> - https://gitmind.com/tw/faq/how-to-use-gitmind.html
> - https://gitmind.com/faq/theme-background.html
> - https://gitmind.com/faq/style-format.html
> - https://gitmind.com/faq/edit-text.html
> - https://gitmind.com/faq/add-watermark.html
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/12/pin-theme-top.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/12/default-theme.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2025/02/save-customized-theme.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/11/change-node-style.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/11/format-painter.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/11/text-format.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/11/change-background.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2024/01/mindmap-background.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2024/04/add-watermark.gif
> - https://webusupload.apowersoft.info/gitmind/wp-content/uploads/2022/11/change-theme.gif
> - https://mrmad.com.tw/gitmind

---


# GitMind 主題（Theme）與樣式面板（Style Panel）研究報告

## 研究方法與來源可信度說明

本報告資料來自：
1. GitMind 官方教學頁（英文版為主，繁中版對照）：
   - `https://gitmind.com/faq/how-to-use-gitmind.html`（英）／`https://gitmind.com/tw/faq/how-to-use-gitmind.html`（繁中）
   - `https://gitmind.com/faq/theme-background.html`（主題與背景專頁）
   - `https://gitmind.com/faq/style-format.html`（樣式與格式刷專頁）
   - `https://gitmind.com/faq/edit-text.html`（文字編輯，含字型工具列）
   - `https://gitmind.com/faq/add-watermark.html`（浮水印專頁）
2. **上述頁面內嵌的官方操作示範 GIF/截圖**（CDN: `webusupload.apowersoft.info/gitmind/wp-content/uploads/...`），我已下載並用 ffmpeg 逐格抽幀（共約 500 張影格）後逐一檢視畫面像素內容 —— 這是本報告中「精確 UI 標籤、下拉選單選項、色票配置」的主要依據，比純文字教學可靠得多，因為 GitMind 教學文字本身寫得很籠統，真正的控制項細節只存在於截圖裡。
3. 少量第三方部落格（瘋先生、Welly SEO 等）僅用於交叉參考「11 種主題」這類籠統說法，**未在官方頁面獨立驗證，标注为不可靠次要來源**。

以下所有「精確標籤」（如按鈕文字、tab 名稱、下拉選單選項）皆為**英文版 UI 實際截圖中逐字辨識**的結果（GitMind 網頁版介面本身就是英文，繁中版教學頁的操作示範 GIF 也是同一套英文介面）。顏色的十六進位值為**目視估算**（截圖沒有色彩取色器數據），已在文中標明「估算」。

---

## 一、右側面板總覽（整個「樣式/主題」side panel 的頂層結構）

點選節點後，畫面右側會彈出一個浮動面板，頂部有 4 個分頁 tab（逐字辨識自截圖）：

```
Style │ Theme │ Layout │ Icon
```

- **Style**：單一節點/連接線的形狀、邊框、連接線、結構方向、節點間距（本報告重點之一）
- **Theme**：套用整份心智圖的主題與畫布背景（本報告重點之一），內有兩個次分頁：`Theme` │ `Background`
- **Layout**：整體圖表型態切換（依第三方教學提及選項包含 Mind Map / Logic Chart / Tree Chart / Org Chart / Fishbone，本次未深入截圖驗證，僅供參考）
- **Icon**：節點圖示/貼圖庫（本次未展開，超出本次主題範圍）

面板可用右上角 `×` 關閉。未選取任何節點、直接點頂部工具列的「魔杖」圖示（Magic Wand）也能開啟同一面板並停在 Theme 分頁。

---

## 二、主題（Theme）分頁詳細規格

### 2.1 進入方式（三種，官方教學逐字敘述）
> "In the top toolbar, use the 'Magic Wand' function to quickly apply a theme to your mind map. Alternatively, click on 'Style' on the right side, then select 'Themes'. Clicking 'Change Theme' in the pop-up window will quickly apply a random theme style."

- 頂部工具列有一個獨立的「魔杖」(Magic Wand) icon，點一下 = 立即隨機換一次主題（不開面板）
- 或開右側面板 → `Theme` tab → `Theme` 子分頁

### 2.2 Theme 子分頁內的控制項（由上到下，逐字辨識）

1. **`Change Theme`**：大顆橘色按鈕，右側有一個「?」說明圖示（hover 顯示 tooltip）。點擊 = 隨機套用一個新的、配色協調的主題（等同繁中教學所述「一鍵搭配」概念）。
2. **`Multi-branch Color`**（多分支配色）：
   - 下方是一條「色條預覽」— 一條橫向色塊，顯示目前主題各分支的顏色序列（例如某主題顯示：橘黃→米色→灰褐→深褐→褐色→橘紅，共 6 色對應 6 條分支）
   - 右側有一個下拉箭頭（未能在截圖中捕捉到展開後的選單內容，但另一個範例畫面顯示同一控制項可能顯示為下拉選單文字 `- Default theme color -`，代表除了色條快選外也有下拉選單模式）
3. **分類 Tab（三個，逐字辨識自截圖）**：`Recommended` │ `Custom` │ `Purchased`
   - **Recommended**：內建主題縮圖畫廊，2 欄格狀排列，每個縮圖是一個迷你心智圖預覽（1 根節點 + 4～6 個分支節點，各自著色），可上下捲動看更多。滑鼠 hover 縮圖右上角會出現「...」按鈕，點開有兩個選項：`Pin`（釘選到頂部，繁中教學說明最多可釘 6 個）與 `Set as default`（設為預設主題）。被釘選的主題縮圖右上角會出現一個「↑」小圖示；被設為預設的主題縮圖右上角會出現橘色 `Default` 徽章。
   - **Custom**：使用者自訂並儲存的主題。畫面顯示一個「+」新增方塊，旁邊是已儲存的自訂主題縮圖。自訂主題的建立流程（見下）需要 Pro 付費權限。
   - **Purchased**：已用點數（credits）購買的付費主題。部分主題縮圖左上角有橘色 `Pro` 徽章，代表需要消耗點數才能使用；官方原文："Most themes and backgrounds in GitMind can be used for free, while some exquisite themes require credits. If you have enough credits, you can confirm the deduction directly."

### 2.3 自訂主題（Custom Theme）流程細節（逐字辨識自截圖彈窗）

點擊 `Custom` 分頁的「+」後彈出「Custom Theme」浮層，內容逐字辨識：

- 頂部標題：`Custom Theme`
- 一個迷你預覽卡：畫出「根節點（深紫底白字）+ 兩側各 3 個子節點（藍底白字）」的示意圖，代表即將擷取的樣式結構
- 說明文字（帶 info 圖示）：`Extract the style of the first node of each level by default`（預設會擷取每一層級「第一個節點」的樣式，套用給該層所有節點）
- 連結：`View detailed settings`（可進一步微調每層要擷取的具體節點，未展開截圖細節）
- 大顆橘色按鈕：`Save current theme`，右上角有 `Pro` 徽章
- 次要文字按鈕：`Exit preview and edit the current`
- 儲存成功後彈出 toast：`Custom theme saved successfully`

過程中畫布上方會出現提示條：`Custom theme is in preview...`（帶眼睛圖示），代表此時畫布顯示的是「自訂主題預覽」而非正式套用狀態。

### 2.4 內建主題實際外觀（從縮圖與實測畫布逐一截圖辨識，色碼為目視估算）

以下是我在示範 GIF 中實際看到並套用到畫布上的主題範例（並非窮舉全部主題，因為 Recommended 清單需持續下捲，GIF 只展示了約 10 幾種，但已涵蓋各種代表性風格）：

| 主題外觀特徵 | 畫布背景 | 根節點 | 分支節點 | 連接線 | 節點形狀 |
|---|---|---|---|---|---|
| **水彩薄荷綠**（watercolor teal） | 薄荷綠水彩暈染（估算 `#B8ECDD`→`#7FDBC4` 漸層雲霧狀） | 白底、深綠邊框、深色粗體字 | 白底、綠色細邊框、深色字 | 綠色（估算 `#8BC34A`），曲線 | 直角小圓角矩形 |
| **極簡淺藍**（plain blue） | 極淺藍灰（估算 `#DFE7EA`） | 實心藍底（估算 `#2196F3`）、白色粗體字 | 白底、無明顯邊框、深色字 | 細灰線（估算 `#B0BEC5`），曲線 | 圓角矩形 |
| **秋色暖棕橘**（autumn/warm，範例中央節點文字為"1122"） | 白色 | 實心深咖啡棕（估算 `#3E2723`）、白色粗體字 | 6 條分支各自實心不同色：金黃 `#FFC107`、淺褐 `#BFA074`、橘紅 `#FF5722`、深褐 `#5D4037` 等，白字 | 每條連接線顏色與對應分支同色（多彩分支線） | 圓角矩形 |
| **奶油底＋教育塗鴉插畫**（cream + doodle illustration） | 奶油白／米色（估算 `#FDF6E3`），右下角有畢業帽、燈泡、尺、書等淺色裝飾插畫 | 灰褐色藥丸形（pill）實心、白字 | 淺黃邊框藥丸形（outline only，底透明/白）、深色字 | 橘黃色細線，曲線 | 藥丸/膠囊形（stadium shape） |
| **藍橘雙色藥丸outline** | 米色/淺褐 | 橘色藥丸outline實心根節點 | 藍色藥丸outline（白底藍框藍字）分支 | 橘色線 | 藥丸形 |
| **灰階/黑白 outline** | 白色 | 黑色藥丸outline | 灰色藥丸outline分支 | 黑/灰線 | 藥丸形 |
| **黑白+單一紅色強調分支** | 白色 | 黑色藥丸outline | 大多數為黑色outline，其中一條分支是紅色實心強調 | 黑線 | 藥丸形 |
| **深色星空主題（dark/starfield，實測於真實內容案例）** | 深藏青／黑色星空背景圖（估算 `#0B0B2A`，散布星點與淡橘色星雲光斑） | 深靛紫實心（估算 `#241B50`）、白色粗體字，圓角矩形，節點內右側有一個「CC」小徽章圖示 | 亮藍實心（估算 `#1565C0`）、白字，圓角矩形 | 淺藍細線（估算 `#4FC3F7`），大幅度曲線（近似圓弧） | 圓角矩形 |
| **紫紅彩虹（rainbow）** | 白色 | 深紫/深藍實心 | 紅、藍、橘、綠等多彩實心分支（每條不同色） | 對應分支同色 | 圓角矩形 |

**重要事實**：整個瀏覽過程中，**主題縮圖沒有任何文字名稱標籤**（不像「一鍵搭配」某些工具會寫"Ocean Blue"、"Sunset"之類的名字），使用者只能靠縮圖的視覺配色去辨認與選擇。因此若要做 clone，「主題命名」這件事是我們自己需要發明的（GitMind 官方本身不對外命名）。

繁中版教學原文對主題風格類型的文字描述（`theme-background.html` 繁中／英文皆同義）：
> "GitMind offers a variety of themes designed by professional designers, suitable for different scenarios and styles. These include **dark styles** suitable for conference presentations, **diary styles** ideal for taking notes while reading, and **colorful styles** suitable for presentations."

即官方將主題分為三大情境調性：**深色系（簡報用）**、**日記/筆記風（閱讀筆記用）**、**繽紛多彩系（簡報展示用）**，並非固定分類 tab，只是設計理念敘述。

---

## 三、Theme 分頁 → Background 子分頁詳細規格

點 `Theme` tab 下的 `Background` 次分頁，控制項（逐字辨識）：

1. **`Random Background`**：橘色大按鈕，右側「?」說明圖示。點擊即隨機套用一張背景。
2. **`Background color`**：純色背景快選列，一列 5 個色塊 + 1 個「...」更多顏色按鈕：
   - 淡黃（估算 `#FDF3C7`）
   - 淡綠（估算 `#C8E6C0`）
   - 靛紫/藍紫（估算 `#8C93D6`，飽和度略高於其餘四色）
   - 淡青（估算 `#AEEAF3`）
   - 淡薰衣草紫（估算 `#C9C3EA`）
   - 「...」開啟同款「標準色票網格」（見下方「色票選擇器規格」章節）
3. **`Recommended`**：內建背景圖庫，**有分頁**，畫面右下角顯示 `1 / 5`（共 5 頁）與左右箭頭 `‹ ›`。每頁約 6 張縮圖（2 欄 × 3 列），實測看到的背景款式包括：
   - 淺藍色＋左上/右下角手繪線條裝飾（近乎純色但有邊角插畫）
   - 深色星空／宇宙夜空圖（黑底+星點+橘色星雲光斑）
   - 純黃色 + 右上角小貼紙裝飾
   - 粉藍雙色抽象色塊/波浪
   - 淺灰大理石/紙紋理（兩種變化）
   - 淡藍色手繪塗鴉邊框（畢業帽、書本等，教育主題）
   - 粉色抽象波浪 + 右上角深藍色弧形色塊（實測套用於畫布，效果如上表「深色星空」旁的另一款粉色系）
4. **自訂背景（Custom）**：繁中教學原文：
   > "If you cannot find preferred backgrounds in our Pop category, simply select 'Custom' under 'Theme' and 'Background', and upload your own images to set as background."
   
   即在 Background 分頁選 `Custom`，可上傳自己的圖片當背景（本次未截到該上傳 UI 的畫面）。

5. **`Insert watermark`（浮水印，勾選框）**：見下一節。

---

## 四、浮水印（Watermark）完整規格（`add-watermark.html` + 內嵌 GIF 逐格辨識）

進入路徑（繁中/英文教學逐字）：`Style` icon → `Theme` → `Background` → 捲到最下方 → 勾選 `Insert watermark`。

勾選後展開的控制項（逐字辨識，附旁邊一個小型「⟳」重置圖示於 `Insert watermark` 標籤右側）：

| 控制項 | 型態 | 細節 |
|---|---|---|
| `Text watermark` | 文字輸入框 | **上限 30 字元**，即時顯示字數計數器（實測看到 `5/30`、`18/30`、`22/30`、`28/30`），預設文字為 `GitMind - Making Ideas Count` |
| `Color` | 色票下拉 | 開啟同款「標準色票網格」（見下節），實測套用過灰色與橘紅色 |
| `Rotation` | 下拉選單 | **恰好 3 個選項：`Left` / `Right` / `Horizontal`**（分別代表浮水印文字向左傾斜、向右傾斜、水平不旋轉；渲染效果是整個畫布鋪滿重複、傾斜的浮水印文字磚牆式排列） |
| `Transparency` | 滑桿 | 數值 0–100（實測拖曳出現 20、22、33），滑桿左端有一個小圓點手把，拖曳時上方彈出當前數值氣泡 |
| `Size` | 滑桿 | 浮水印文字大小（px），實測看到 14、19、20 |

視覺效果：浮水印文字會以固定角度重複鋪滿整個畫布（類似防盜浮水印牆），文字顏色/大小/透明度即時反映在畫布預覽上。

---

## 五、Style 分頁（節點/連接線樣式）完整規格 —— 逐格辨識自 `change-node-style.gif`

選取一個節點後，右側面板停在 `Style` tab，由上到下依序出現以下區塊（**全部為逐字辨識，非推測**）：

### 5.1 `Shape`（形狀）
一列兩個下拉控制：
- 左：**形狀選擇器下拉**（icon 顯示目前形狀縮圖）。點開後彈出一個 **2 欄 × 5 列、共 10 種形狀**的選單網格：
  1. 直角/小圓角矩形（rectangle, small radius）
  2. 大圓角矩形（rectangle, larger radius）
  3. 藥丸/膠囊形（pill/stadium，較窄）
  4. 藥丸/膠囊形（pill/stadium，較寬）
  5. 更大圓角矩形（接近膠囊，但仍非全圓端）
  6. **底線樣式（underline）**：只有節點文字下方一條橫線，無外框、無填色背景
  7. 圓形（circle）
  8. 橢圓形（ellipse）
  9. 菱形（diamond）
  10. 平行四邊形（parallelogram）
- 右：**填色下拉（Fill color）**，色票 UI 與其他色票控制項共用同一套「標準色票網格」（見下節）

### 5.2 `Radius`（圓角半徑）
單一滑桿 + 右側數值輸入框（實測預設值 `6`，單位應為 px）。僅影響矩形類形狀的圓角弧度。

### 5.3 `Border`（邊框）
一列三個下拉控制：
1. **邊框線型下拉**：點開後彈出 **5 種線型**（由上到下）：實線（solid）、細點虛線（dotted）、中段虛線（dashed）、點劃線（dash-dot）、長虛點劃線（long dash-dot）
2. **邊框顏色下拉**：標準色票網格
3. **邊框寬度下拉**：**6 個選項：`0px / 1px / 2px / 3px / 4px / 5px`**（實測選 4px 後，圓形節點即時出現黑色 4px 虛線外框）

### 5.4 `Line`（連接線／connector）
一列四個下拉控制：
1. **連接線形狀下拉**（icon 圖示類似直角/elbow 轉折符號，代表連接線走法：本次未能截到展開選單內容，但可判斷此控制與畫布上實際觀察到的兩種連接線視覺一致：多數主題預設是**平滑曲線（curved）**，但此下拉存在意味著至少還有其他選項，合理推測為直線（straight）與/或直角折線（orthogonal/elbow），此點**未100%截圖驗證，屬合理推論，請在實作前以官方帳號實測確認**）
2. **連接線顏色下拉**：標準色票網格
3. **連接線線型下拉**：與 Border 線型下拉同款 5 種（實線/點/虛線/點劃線/長點劃線）
4. **連接線寬度下拉**：與 Border 寬度下拉同款 `0px–5px`（實測預設 `3px`）

### 5.5 `Structure`（結構，個別節點的展開方向）
一列兩個控制：
1. 左側一個 icon 下拉（形似 "⊐E" 符號，可能代表子節點的排列/收合圖示樣式）
2. 右側文字下拉，實測預設值為 **`Right`**（推測其他選項應包含 `Left` 與可能的 `Both sides`，因為在同一份 GIF 的其他畫面中，根節點確實同時往左、右兩側分別展開分支——但下拉選單本身未被展開截圖，此為合理推論）

繁中版教學原文（`how-to-use-gitmind.html` 繁中）將此對應到：
> 選節點 → 「樣式」→「結構」— 調整個別節點的結構與方向

### 5.6 `Node Spacing`（節點間距）
標題列右側有一個「⟳」重置圖示，以及一個範圍下拉 **`All nodes`**（暗示可切換成「僅選取節點」等其他套用範圍，但未截圖驗證其他選項文字）。下方兩條滑桿：
- `Horizontal spacing`：滑桿 + 數值框，預設 `30`
- `Vertical spacing`：滑桿 + 數值框，預設 `30`

### 5.7 標準色票選擇器 UI（Fill color / Border color / Line color / Font color / Watermark color 等所有色票控制項共用同一元件）

逐字辨識彈窗結構：
- 頂部：一個小色塊 + 文字 `Default`（勾選/點擊即恢復主題預設色，不使用自訂色）
- 主色票網格，大致 **10 欄 × 7 列**：
  - 第 1 列：白/透明、紅、洋紅、黃、灰、灰、橘、青、藍、黑（高飽和純色）
  - 第 2 列：更深一階的紅、橘金、黃綠、綠、青綠、青藍、藍、深藍、紫、紫（同色相但深一階）
  - 第 3～7 列：以上 10 個色相各自的**淺色調到深色調漸層**（由極淺 pastel 到接近黑的 5 個深淺階），形成完整的色相×明度網格
- 網格下方：一條水平漸層/明度調整拉桿（可微調選定色相的明暗）
- `Recent`：最近使用過的顏色列（實測顯示 4–6 個色塊）
- 底部連結：`More Colors >`（推測開啟完整 HSB/RGB/HEX 自訂輸入面板，本次未截到該次頁面）

彈窗頂部有時會顯示情境化 tooltip 文字，實測捕捉到兩種明確文字：`Fill color`（文字色底/螢光標示色的彈窗）與 `Font color`（文字顏色彈窗），因此可確定色票元件本身是共用的，僅 tooltip 文字依情境變化。

---

## 六、文字/字型工具列（Text/Font Toolbar）—— 逐格辨識自 `text-format.gif`

此工具列**不在右側 Style 面板內**，而是點擊頂部工具列的「T」(Text) icon、或雙擊節點進入文字編輯模式時，於節點正上方彈出的**獨立浮動工具列**，逐字辨識由左到右：

```
[字型下拉] [字級下拉] │ [B] [I] [U] [S̶] │ [A▾ Font color] [A▾ Fill color] │ [對齊方式▾] [行距▾] │ [格式刷 icon]
```

細節：
- **字型下拉**：實測看到兩種顯示值 `Open S...`（截斷顯示，應為 "Open Sans"）與 `Default ...`（截斷顯示，可能是系統/GitMind 預設字型名稱），完整字型清單本次未展開截圖
- **字級下拉**：實測看到數值 `14`、`24`、`36`，推測為常見字級選項清單（如 12/14/16/18/24/36/48 等，未完整截圖驗證全部選項）
- **B**（Bold）、**I**（Italic）、**U**（Underline）、**S̶**（Strikethrough）：四個獨立切換按鈕，啟用時圖示變橘色
- **Font color**（字體顏色）：`A` + 底線色塊 + 下拉箭頭，tooltip 文字確認為 `Font color`
- **Fill color**（文字反白／螢光標示色）：另一個 `A` + 灰底色塊 + 下拉箭頭，tooltip 文字確認為 `Fill color`（即幫選取文字加上背景反白色，如螢光筆效果，非節點填色）
- **對齊方式**：一個排版 icon + 下拉箭頭（未截圖展開選項，推測為左/置中/右，未 100% 驗證）
- **行距**：一個列表 icon + 下拉箭頭（未截圖展開選項）
- **格式刷（Format Painter）**：獨立畫筆 icon，位於工具列最右側

支援**局部文字格式化**（partial formatting）：選取節點內任意一段文字（非整個節點）即可單獨改變該片段的字色/反白色，實測畫面中出現過整段文字反白選取（藍底白字）與單一字母變綠色的範例。

繁中/英文教學原文：
> "Select a node, then click on 'Text' to set text font, size, color, background, alignment, line spacing, and more."

---

## 七、格式刷（Format Painter）——逐格辨識自 `format-painter.gif`

- 觸發：選取來源節點 → 點擊頂部工具列的畫筆 icon（與文字工具列右側的格式刷共用同一功能）
- 使用時畫面下方彈出提示條：`Click target node to apply format painter, and press ESC to turn off.`
- 效果：一次點擊可將來源節點的**節點填色、文字顏色**等樣式完整複製到目標節點（實測套用黃色填色 `#FFF3B0`(估算) + 綠色文字到另外兩個兄弟節點）
- 官方原文：「Select a node and click on 'Format Painter'. Then select another node, and all the styles of the first node will be copied to the second node.」

---

## 八、Grid（網格）選項 —— 確認結果：**未發現**

針對題目要求確認的「畫布網格」選項：
- 官方 `theme-background.html` 與 `style-format.html` 全文皆**未提及**任何 grid/dot-grid/网格 toggle
- 我逐格檢視的所有 Background 分頁截圖（含 Recommended 背景庫翻頁、純色背景、浮水印疊加畫面）中，**畫布本身沒有格線覆蓋層**，也沒有對應的開關控制項
- 結論：GitMind 心智圖編輯器**不提供**類似 Miro/FigJam 那種「顯示網格」開關；純色/圖片背景即代表整個背景選項的全部（此點信心中高，因為兩份官方專頁 + 全部截圖都一致缺席這個功能，但不能 100% 排除藏在其他未截圖的選單深處）

---

## 九、與 Layout / Icon 分頁的邊界（僅供上下文，非本次重點）

右側面板另外兩個 tab（`Layout`、`Icon`）未深入截圖驗證，僅記錄第三方搜尋結果作參考：`Layout` 分頁可切換整體圖表型態（Mind Map / Logic Chart / Tree Chart / Org Chart / Fishbone 等），`Icon` 分頁應為節點圖示/貼圖庫。這兩者與「主題/樣式面板」的核心需求（本次任務範圍）關聯較低，建議另開任務單獨截圖驗證。

---

## 十、給實作 Spec 的關鍵結論（Actionable Summary）

1. **主題沒有官方命名**——clone 版需要自己設計主題名稱與分類方式；但主題的「資料結構」很清楚：一個主題 = {畫布背景色/圖, 各層級節點的 shape+fill+border+font color, 各分支的 connector color 序列（multi-branch color palette）}。
2. **色票元件是全站共用的單一元件**（10 欄 hue × 7 列 tint/shade + Default + Recent + More Colors），只要做好這一個 ColorPicker 元件，Fill/Border/Line/Font/Watermark 全部共用即可。
3. **Shape 選單固定 10 種**，可直接照抄清單（矩形×2、膠囊×3、底線、圓形、橢圓、菱形、平行四邊形）。
4. **Border 與 Line 的「線型」下拉是同一組 5 種樣式**（實線/點/虛線/點劃線/長點劃線），**寬度下拉也是同一組 0–5px 六階**，可共用同一個子元件。
5. **主題三層分類**（Recommended／Custom／Purchased）+ **釘選（最多 6 個）／設為預設**的互動模式值得照抄，是使用者黏著度很高的功能。
6. **浮水印**是獨立、資料結構單純的功能（文字 30 字上限、顏色、3 種旋轉角度、透明度 0–100、字級滑桿），可直接实作為畫布的 CSS 平鋪浮水印層。
7. **確認無網格選項**，可以不必實作 canvas grid overlay（除非要超越原版）。
8. 少數推論未 100%截圖驗證的項目（連接線「形狀」下拉的具體選項、Structure 方向下拉的完整選項、對齊/行距下拉的完整選項、字型清單全貌）建議在寫 Phase B 之前，用真實帳號登入 GitMind 網頁版逐一點開這幾個下拉，用瀏覽器截圖 5 分鐘即可補完，成本很低。

---

## 附：本次下載並逐格分析的關鍵影格檔案位置（供追溯查證）

- 主題相關：`C:\Users\ASUS\AppData\Local\Temp\claude\...\scratchpad\frames2\pin_*.png`（釘選主題流程，含 Multi-branch Color、Recommended 主題縮圖）、`frames2\def_*.png`（設為預設流程）、`frames2\save_*.png`（自訂主題儲存流程，含深色星空主題實例）
- 樣式面板相關：`C:\Users\ASUS\AppData\Local\Temp\claude\...\scratchpad\frames3\style_*.png`（Shape/Radius/Border/Line/Structure/Node Spacing 全流程）、`frames3\paint_*.png`（格式刷）
- 文字工具列相關：`C:\Users\ASUS\AppData\Local\Temp\claude\...\scratchpad\frames4\txt_*.png`
- 背景與浮水印相關：`C:\Users\ASUS\AppData\Local\Temp\claude\...\scratchpad\frames\bg_*.png`、`frames5\wm_*.png`

（完整路徑前綴：`C:\Users\ASUS\AppData\Local\Temp\claude\C--Users-ASUS-Desktop----AI----\664fbcc5-98c6-459a-8daa-b50c20a69216\scratchpad\`）
