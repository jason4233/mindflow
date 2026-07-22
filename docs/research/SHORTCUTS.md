> **Confidence**: medium
>
> **Sources**:
> - https://gitmind.com/faq/shortcuts.html
> - https://gitmind.com/tw/faq/shortcuts.html
> - https://gitmind.com/faq/how-to-use-gitmind.html
> - https://gitmind.com/tw/faq/how-to-use-gitmind.html
> - https://gitmind.com/faq/edit-node.html
> - https://gitmind.com/faq/outline-mode.html
> - https://gitmind.cn/faq/gitmind-hot-key.html

---


# GitMind 快捷鍵（快捷鍵/Keyboard Shortcuts）完整調查報告

## 資料來源與方法說明
官方英文版快捷鍵專頁：**https://gitmind.com/faq/shortcuts.html**（標題 "Keyboard Shortcuts For GitMind Mind Map"，作者 Norlyn Opinaldo，發布 2024/04/19、更新 2024/07/03，分類標籤 "Advanced Skills"）
繁體中文版快捷鍵專頁：**https://gitmind.com/tw/faq/shortcuts.html**（確認存在，內容分類與英文版一致，繁中版標註「最後更新 2024/10/31」）
輔助交叉比對頁面：
- https://gitmind.com/faq/how-to-use-gitmind.html（英文教學總覽）
- https://gitmind.com/tw/faq/how-to-use-gitmind.html（繁中教學總覽）
- https://gitmind.com/faq/edit-node.html（節點編輯教學）
- https://gitmind.com/faq/outline-mode.html（大綱模式教學）
- https://gitmind.cn/faq/gitmind-hot-key.html（簡中版快捷鍵頁，經 WebSearch 確認存在，內容結構與英文版一致）

**重要方法論警告**：本報告透過 WebFetch（會用一個小型模型把 HTML 轉 markdown 後再摘要）取得內容，並非直接讀取原始 HTML/DOM。我對英文版 shortcuts.html 做了 3 次獨立擷取（不同 prompt），三次結果的表格列完全一致（含下方會提到的 Ctrl+D 重複疑點也每次都出現），可信度較高；但仍建議正式開發前用瀏覽器實際打開頁面核對一次原始 HTML，尤其是符號類按鍵（如 `Ctrl+/`、`Ctrl+Shift+">"`）在渲染時可能有轉義差異。繁中頁面因版權保護機制拒絕逐字重現整份表格，故以下中文標籤為我根據英文版及繁中教學頁交叉比對後的翻譯，並非逐字截圖自繁中頁。

---

## 完整快捷鍵表（Windows）

### 一、節點操作（Node Operations）

| 功能（Action） | 快捷鍵（Shortcut） | 備註 |
|---|---|---|
| 插入下級節點 Insert Subordinate Node | `Tab` | 官方教學頁原文：「按下鍵盤的『Tab鍵』即可添加下級節點」 |
| 插入同級節點 Insert Sibling Node | `Enter` | 教學頁原文：「按下『Enter鍵』可添加同級節點」；大綱模式（Outline Mode）下同樣是 Enter |
| 插入上級節點 Insert Parent Node | `Shift+Tab` | 大綱模式下 Shift+Tab＝降低縮排層級（decrease indentation） |
| 展開/收起節點 Expand/Collapse Node | `Ctrl+/` | 快捷鍵專頁列出，未在教學頁中另外提及 |
| 刪除選中節點（含子節點）Delete Selected Node | `Shift+Delete` | ⚠️見下方「發現的不一致」— edit-node.html 教學頁另稱刪除節點但保留子節點的操作為 `Ctrl+Delete` |
| 刪除節點 Delete Node | `Delete` | 教學頁原文：「按下鍵盤的『Delete鍵』可快速刪除該節點」 |
| 節點上移 Move Node Up | `Alt+Up` | |
| 節點下移 Move Node Down | `Alt+Down` | |
| 框選節點 Select Nodes by Box | `Ctrl+滑鼠左鍵`（Ctrl+Left Click） | |
| 複製節點樣式 Copy Node Style | `Ctrl+Alt+C` | |
| 貼上節點樣式 Paste Node Style | `Ctrl+Alt+V` | |
| 複製節點（Duplicate Node） | `Ctrl+D` | ⚠️見下方不一致：同一頁「樣式設定」分類中 `Ctrl+D` 又被列為「清除樣式 Clear Style」 |
| 向上選取同級節點 Select Siblings-Above | `Shift+Up` | |
| 向下選取同級節點 Select Siblings-Below | `Shift+Down` | |

### 二、基本操作（Basic Operations）

| 功能 | 快捷鍵 | 備註 |
|---|---|---|
| 復原 Undo | `Ctrl+Z` | |
| 重做 Redo | `Ctrl+Y` | 未發現 `Ctrl+Shift+Z` 作為重做的替代鍵 |
| 複製 Copy | `Ctrl+C` | 教學頁也提到可右鍵選單「複製」 |
| 貼上 Paste | `Ctrl+V` | |
| 剪下 Cut | `Ctrl+X` | |
| 儲存 Save | `Ctrl+S` | |
| 重新整理 Refresh | `Ctrl+R` | |

### 三、樣式設定（Style Settings）

| 功能 | 快捷鍵 | 備註 |
|---|---|---|
| 切換主題 Change Theme | `F6` | |
| 開啟主題面板 Open Theme | `Ctrl+P` | |
| 開啟樣式面板 Open Style | `Alt+Y` | |
| 清除樣式 Clear Style | `Ctrl+D` | 與「複製節點」衝突，見下方說明 |

### 四、文字編輯（Text Editing）

| 功能 | 快捷鍵 | 備註 |
|---|---|---|
| 換行 Line Break | `Shift+Enter` | 教學頁原文：「按下『Shift + Enter』鍵可以快速換行」 |
| 編輯（進入節點文字編輯狀態）Edit | `Space` | 快捷鍵頁列為 Edit＝Space；教學頁另提到 Space 也用於「編輯關聯線上的文字」（edit text on relationship line） |
| 粗體 Bold | `Ctrl+B` | |
| 斜體 Italic | `Ctrl+I` | |
| 底線 Underline | `Ctrl+U` | |
| 複製格式（格式刷）Format Painter | `Ctrl+G` | |
| 加入優先級 Add Priority | `Ctrl+數字鍵`（Ctrl+Number） | 未列出對應 1-9 各代表的優先級圖示 |
| 放大字體 Increase Font Size | `Ctrl+Shift+">"` | |
| 縮小字體 Decrease Font Size | `Ctrl+Shift+"<"` | |

### 五、插入功能（Insert Functions）

| 功能 | 快捷鍵 | 備註 |
|---|---|---|
| 插入連結 Insert Link | `Ctrl+Alt+K` | |
| 插入備註 Insert Note | `Ctrl+Alt+M` | 對應使用者要的 "notes" |
| 插入摘要 Insert Summary | `Ctrl+Alt+T` | 對應使用者要的 "summary" |
| 插入圖片 Insert Image | `Alt+P` | |
| 插入圖示 Insert Icon | `Alt+I` | |
| 插入關聯線 Insert Relationship | `F4` | 對應使用者要的 "relation line" |
| 插入評論 Insert Comment | `Ctrl+Alt+R` | |

### 六、畫布調整（Canvas Adjustment）

| 功能 | 快捷鍵 | 備註 |
|---|---|---|
| 重設縮放 Reset Zoom | `Ctrl+0` | |
| 畫布縮放 Canvas Zoom | `Ctrl+滑鼠滾輪`（Ctrl+Mouse Wheel） | 未發現 `Ctrl++`／`Ctrl+-` 這種逐步縮放鍵 |
| 自動整理佈局 Arrange Layout | `Ctrl+Shift+L` | |
| 大綱檢視 Outline View | `Ctrl+O` | |
| 拖曳畫布 Drag Canvas | `滑鼠左鍵`（Left Click，按住拖曳） | |
| 全螢幕 Full Screen | `F11` | |
| 完整顯示整張畫布（Fit View）Fit Entire Canvas | `Ctrl+Alt+F` | 這就是使用者要找的「fit view」對應鍵 |
| 置中回主題 Center on Main Topic | `Ctrl+Shift+R` | |

### 七、進階功能（Advanced Features）

官方頁面此分類**確認只有 3 條**（我用不同 prompt 重複查證過，結果一致，無遺漏）：

| 功能 | 快捷鍵 | 備註 |
|---|---|---|
| 開啟協作 Open Collaboration | `Shift+Alt+O` | |
| 版本歷史 Version History | `Shift+Alt+H` | |
| 自由節點切換 Free Node Toggle | `Shift+Alt+F` | |

---

## 使用者原本詢問、但官方快捷鍵頁「查無」的按鍵

以下是使用者在題目中列出、但我在 `gitmind.com/faq/shortcuts.html` 這份官方快捷鍵表中**明確查無記載**的項目（多次不同角度查證，結果一致）：

| 使用者詢問項目 | 官方快捷鍵頁狀態 | 其他頁面的線索 |
|---|---|---|
| `F2`（重新命名節點） | 未列出 | 快捷鍵頁把「編輯節點文字」對應到 `Space`，不是 F2；其他教學頁也未提及 F2 |
| 純方向鍵（↑↓←→，無修飾鍵）在節點間移動焦點 | 未列出 | 只有 `Alt+Up/Down`（移動節點順序）與 `Shift+Up/Down`（選取同級節點），皆非單純方向鍵導覽 |
| `Ctrl+A`（全選） | 未列出 | 教學頁提到多選節點是用 `Ctrl+滑鼠左鍵` 框選/點選，未見「全選」快捷鍵 |
| `Ctrl+F`（尋找） | **快捷鍵專頁未列**，但教學頁 `how-to-use-gitmind.html` 明確提到：「使用『Ctrl+F』打開查找替換頁面」（Find & Replace） | 兩頁資訊不一致：查找/取代功能存在且鍵位是 Ctrl+F，只是沒被收錄進官方快捷鍵表 |
| `Esc` | **快捷鍵專頁未列**，但教學頁提到：「按下『Esc』鍵或者右上角點擊『退出』」可退出 Focus Mode（專注模式） | 同上，功能存在但未收錄在快捷鍵表中 |

## 發現的官方文件內部不一致（實作時務必注意）

1. **`Ctrl+D` 衝突**：快捷鍵頁的「節點操作」分類把 `Ctrl+D` 標為「複製節點 Duplicate Node」，但同一頁「樣式設定」分類又把 `Ctrl+D` 標為「清除樣式 Clear Style」。這是官方頁面本身的重複/矛盾標示（我三次獨立擷取都重現了同樣的矛盾，並非我的擷取誤差），複製此功能時建議兩者擇一，或推測實際產品中是依「目前焦點在節點 vs 在樣式面板」而有 context-dependent 行為。
2. **刪除節點的兩種鍵位說法不一致**：
   - 快捷鍵專頁：`Shift+Delete` = "Delete Selected Node"（刪除選中節點）；`Delete` = "Delete Node"（刪除節點）。
   - 教學頁 `edit-node.html` / `how-to-use-gitmind.html`：`Ctrl+Delete` = 「刪除選中節點但保留其子節點」（delete the selected node and keep its child node）。
   三個頁面對「刪除但保留子節點」到底是 `Shift+Delete` 還是 `Ctrl+Delete` 說法不一致，建議實作前用官方線上編輯器（app.gitmind.com/edit）實測驗證這兩個鍵各自的真實行為。
3. **重複性驗證**：英文版 shortcuts.html 我做了 3 次不同角度的獨立擷取，除上述兩處矛盾外，其餘所有列（Tab/Enter/Shift+Tab/Alt+Up/Alt+Down/Ctrl+Z/Ctrl+Y/Ctrl+C/V/X/S/R/F6/Ctrl+P/Alt+Y/Ctrl+B/I/U/Ctrl+G/Ctrl+數字/Ctrl+Shift+"<"/">"/Ctrl+Alt+K/M/T/Alt+P/Alt+I/F4/Ctrl+Alt+R/Ctrl+0/Ctrl+滾輪/Ctrl+Shift+L/Ctrl+O/F11/Ctrl+Alt+F/Ctrl+Shift+R/Shift+Alt+O/H/F）三次結果完全一致，可信度高。

## 其他確認事項

- 頁面**未提及** Mac 版是否用 `Cmd` 取代 `Ctrl`（無 Mac 專屬欄位或備註），也**未說明**線上版（web app.gitmind.com）與桌面版（Windows 應用程式）快捷鍵是否有差異。
- 頁面**未提供**編輯器內建的「快捷鍵面板/cheat sheet」相關說明或截圖線索（我原本被要求查證編輯器內是否有此面板，官方文字頁沒提到，需要實測 app.gitmind.com/edit 或桌面版介面才能確認）。
- 大綱模式（Outline Mode，`Ctrl+O` 進入）本身沒有獨立的快捷鍵子表，是沿用主要的 Tab/Enter/Shift+Tab/Shift+Enter。

## 給實作端的建議

由於官方文字頁本身有 `Ctrl+D` 衝突與刪除鍵位（`Shift+Delete` vs `Ctrl+Delete`）不一致兩處已知疑點，且 `F2`／`Ctrl+A`／方向鍵導覽等使用者關心的常見鍵位在官方頁面完全查無記載，強烈建議下一步是**直接打開 GitMind 線上編輯器（https://gitmind.com/edit.html 或登入後的 app.gitmind.com）用瀏覽器 DevTools 或實際按鍵測試**，逐一核對這份文字版快捷鍵表，而不要只依賴本報告的文字紀錄去實作最終規格。
