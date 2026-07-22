> **Confidence**: medium
>
> **Sources**:
> - https://gitmind.com/tw/faq/how-to-use-gitmind.html
> - https://gitmind.com/faq/how-to-use-gitmind.html
> - https://gitmind.com/tw/faq/shortcuts.html
> - https://gitmind.com/faq/shortcuts.html
> - https://gitmind.com/faq/edit-mind-map.html
> - https://gitmind.com/faq/question.html
> - https://gitmind.com/faq/add-comment.html
> - https://gitmind.com/tw/faq/insert-link.html
> - https://gitmind.com/tw/faq/insert-image.html
> - https://gitmind.com/tw/faq/focus-mode.html
> - https://gitmind.com/faq/relationship-summary.html
> - https://gitmind.com/tw/faqs/help
> - https://gitmind.com/tw/faqs/help/page/2
> - https://gitmind.cn/faq/insert-formula.html
> - https://gitmind.cn/faq/formula-list.html
> - https://gitmind.com/tw/faq/change-style.html
> - https://welly.tw/blog/gitmind

---

# GitMind 編輯器功能盤點報告（Editor Feature Inventory）

> 研究對象：gitmind.com（Apowersoft 出品的思維導圖/心智圖工具）。以下資料交叉比對官方繁中教學（gitmind.com/tw/faq/*）、官方英文教學（gitmind.com/faq/*）、官方簡中站（gitmind.cn/faq/*）與第三方教學文章，僅陳述可查證到的事實（功能名稱、選單標籤、快捷鍵）。凡有來源衝突或無法查證細節之處，均已標註「未查證/存疑」。

---

## 0. 快捷鍵總表（來自官方 Shortcuts 頁 gitmind.com/tw/faq/shortcuts.html、gitmind.com/faq/shortcuts.html）

### 節點操作
| 快捷鍵 | 功能（官方標籤） |
|---|---|
| `Tab` | 插入下級節點（Insert Subordinate/Child Node） |
| `Enter` | 插入同級節點（Insert Sibling Node） |
| `Shift+Tab` | 插入上級節點（Insert Parent Node） |
| `Ctrl+/` | 展開/收起節點（Expand/Collapse Node） |
| `Delete` | 刪除節點 |
| `Shift+Delete` | 刪除選中節點（含子節點） |
| `Ctrl+Delete` | 刪除節點但保留子節點（另一來源記載） |
| `Alt+↑` | 節點上移 |
| `Alt+↓` | 節點下移 |
| `Ctrl+左鍵框選` | 多選節點（Select Nodes by Box） |
| `Shift+↑` | 選取上方同級節點 |
| `Shift+↓` | 選取下方同級節點 |
| `Ctrl+Alt+C` | 複製節點樣式（Copy Node Style） |
| `Ctrl+Alt+V` | 貼上節點樣式（Paste Node Style） |
| `Ctrl+D` | 官方兩處來源標籤不一致：一處記為「Duplicate/複製節點」，另一處記為「Clear Style/清除樣式」——**存疑，需實測確認**。 |

### 基本操作
| 快捷鍵 | 功能 |
|---|---|
| `Ctrl+Z` | 復原（Undo） |
| `Ctrl+Y` | 重做（Redo） |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+X` | 複製 / 貼上 / 剪下 |
| `Ctrl+S` | 儲存 |
| `Ctrl+R` | 重新整理 |

### 樣式設定
| 快捷鍵 | 功能 |
|---|---|
| `F6` | 更換主題（Change Theme） |
| `Ctrl+P` | 開啟主題面板 |
| `Alt+Y` | 開啟樣式面板 |

### 文字編輯
| 快捷鍵 | 功能 |
|---|---|
| `Shift+Enter` | 換行（同一節點內插入 line break） |
| `Space`（選中節點時） | 進入編輯狀態 |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | 粗體 / 斜體 / 底線 |
| `Ctrl+G` | 格式刷（Format Painter） |
| `Ctrl+數字鍵` | 添加優先順序圖示（Add Priority，數字對應優先級等級） |
| `Ctrl+Shift+>` / `Ctrl+Shift+<` | 放大 / 縮小字型 |

### 插入功能
| 快捷鍵 | 功能 |
|---|---|
| `Ctrl+Alt+K` | 插入連結（Insert Link） |
| `Ctrl+Alt+M` | 插入備註（Insert Note） |
| `Ctrl+Alt+T` | 插入概要（Insert Summary） |
| `Alt+P` | 插入圖片（Insert Image） |
| `Alt+I` | 插入圖示（Insert Icon） |
| `F4` | 插入關聯線（Insert Relationship） |
| `Ctrl+Alt+R` | 插入評論（Insert Comment） |

### 畫布操作
| 快捷鍵 | 功能 |
|---|---|
| `Ctrl+0` | 重設縮放 |
| `Ctrl+滑鼠滾輪` | 縮放畫布 |
| `Ctrl+Shift+L` | 整理佈局（Arrange Layout） |
| `Ctrl+O` | 切換大綱視圖（Outline View） |
| 左鍵拖曳空白處 | 拖曳畫布 |
| `F11` | 全螢幕 |
| `Ctrl+Alt+F` | 縮放至完整顯示全圖 |
| `Ctrl+Shift+R` | 置中回到主主題 |

### 進階功能
| 快捷鍵 | 功能 |
|---|---|
| `Shift+Alt+O` | 開啟協作（Collaboration） |
| `Shift+Alt+H` | 歷史版本（Version History） |
| `Shift+Alt+F` | 自由節點切換（Free/Floating Node Toggle） |

> 平板/手機藍牙鍵盤版另有一組較簡化的快捷鍵（Tab 插入下級、Enter 插入節點、Delete 刪除、方向鍵移動、Ctrl/Cmd+Z 復原、Ctrl/Cmd+C 複製），出自 gitmind.com/faq/edit-mind-map.html 與行動版教學。

---

## 1. 節點基本操作（Node Operations）

**新增節點**
- 下級節點（子節點）：選中節點按 `Tab`，或點擊工具列圖示。
- 同級節點（兄弟節點）：按 `Enter`。
- 上級節點（父節點）：按 `Shift+Tab`。
- 行動版：點擊中心主題會浮現按鈕，提供「新增子節點/同級節點」的專用按鈕。

**移動 / 拖曳重新掛接（Reparent）**
- 用滑鼠自由拖曳節點；拖曳節點 A 到節點 B 上，放開後 A 會變成 B 的子節點（拖曳中會出現橘色標記表示可放置的位置，"orange mark indicates valid drop"）。
- `Alt+↑` / `Alt+↓`：節點在同層級中上移/下移。
- 行動版：長按節點後可拖曳到任意位置；若被移動的節點有子節點，子節點會一併跟著移動。

**刪除節點**
- 選中節點按 `Delete`，或右鍵選單選擇「刪除」。
- `Ctrl+Delete`：刪除節點但保留其子節點（子節點會上移遞補）。
- 行動版：刪除父節點時，其所有子節點會一併被刪除（無「保留子節點」選項的說明）。

**複製 / 貼上**
- `Ctrl+C` 複製節點，`Ctrl+V` 貼到目標節點下（會成為該節點的子節點）；官方教學提及可跨心智圖檔案貼上分支（"works across mind maps for branches"）。
- `Ctrl+Alt+C` / `Ctrl+Alt+V`：專門複製/貼上「節點樣式」（不含文字內容，只搬樣式）。
- 行動版：點選「複製」再點選目標節點「貼上」，貼上結果為子節點。

**節點寬度調整**
- 直接拖曳節點左右邊框調整寬度；支援用右鍵框選（或 `Ctrl+左鍵`）多選多個節點後統一批次調整寬度。

**浮動節點（Floating Node）**
- 右鍵選單選擇「浮動節點/Floating Node」可插入不屬於任何主幹的獨立節點元素；亦有專屬快捷鍵 `Shift+Alt+F`（自由節點切換）。

**收合 / 展開（Collapse/Expand）**
- 快捷鍵 `Ctrl+/`；一般也可點擊節點旁的收合箭頭圖示（官方教學未給出圖示的精確像素位置，僅描述為節點邊上的按鈕）。

**節點編號（Numbering）**
- 僅查到片段資訊：「網頁版支援計算節點編號（counting node number）」，未查到精確的開關位置或顯示格式細節。**此項屬存疑/資訊不足**，未找到官方教學頁面明確說明「顯示節點編號」的設定路徑（樣式面板搜尋未命中）。建議之後另行以實測（開啟編輯器截圖）確認。
- 與編號功能相關、且已確認存在的是「大綱視圖（Outline）」：側邊欄／右下角有「大綱」按鈕，可切換成大綱模式列出所有階層項目；官方描述「支援大綱工具欄在右下角常駐顯示」。大綱模式下沿用與圖形模式相同的快捷鍵（Tab/Enter/Shift+Tab）。

**格式刷（Format Painter）**
- 選中來源節點 → 點擊「格式刷」按鈕（或 `Ctrl+G`）→ 點擊目標節點，即可複製全部格式設定（含樣式、顏色等）到目標節點。官方原文：「複製當前節點格式黏貼在選中節點上」。

---

## 2. 關聯線（關係線 / Relationship Line）

- 觸發方式：選中節點 → 點擊工具列（或左側工具列）的「關係線」按鈕 → 再點選第二個節點，即自動產生一條連接兩節點的關聯線；也可在節點上按右鍵選擇「插入關係線」。快捷鍵：`F4`。
- 文字標註：選中關聯線後按空白鍵（Space）即可輸入/編輯線上文字。
- 刪除：選中關聯線按 `Delete`。
- 調整形狀：關聯線上會顯示黃色控制點（黃色槓桿/handles），拖曳可調整線的角度、線頭與線尾的連接位置。
- 樣式自訂：選中關聯線後點擊「樣式」面板，可修改線條的形狀、粗細、顏色。

---

## 3. 概要 / 概括（Summary Bracket）

- 觸發方式：選取同一父節點下的多個（同級）節點 → 點擊工具列「概括」按鈕（快捷鍵 `Ctrl+Alt+T`），即以一個大括號將所選節點框起並產生一個「概要」節點。
- 調整範圍：選中已建立的概括，可拖曳其黃色選框邊界任意調整涵蓋的節點範圍（"支持對概括的節點進行任意拖動選擇，快速更換"）。
- 刪除：選中概括後按 `Delete` 鍵即可移除（僅刪除概括本身，不影響被概括的節點）。
- 樣式自訂：選中概括 → 點擊「樣式」，可修改概括的線條顏色、線條類型（樣式）、結構，以及概括的背景填色。

---

## 4. 備註（Notes / 備註）

- 觸發方式：選中節點 → 點擊工具列「插入」→ 選擇「備註」，右側會開啟一個輸入面板，輸入內容後自動同步顯示在節點上（節點上通常會出現一個備註圖示標記）。快捷鍵：`Ctrl+Alt+M`。
- 官方原文定位：「邊創建思維導圖邊添加備註，可以讓您的思考更有深度」。
- 未查到刪除/編輯備註的專屬按鈕文字（推測為再次點擊該圖示進入編輯，未經官方頁面明確證實，**存疑**）。

---

## 5. 評論（Comments）

- 觸發方式：選中節點後，節點上方會浮現一個「評論」圖示，點擊該圖示輸入文字，按下【OK】確認送出。快捷鍵：`Ctrl+Alt+R`。
- 刪除：點擊評論圖示叫出評論列表 → 找到目標評論 → 滑鼠移到三個點（⋯）圖示上 → 選擇【Delete】。
- 回覆/編輯：官方文案僅提及「you can reply to or edit the existing comment」，未給出詳細操作步驟（**存疑，缺乏細節**）。
- 中文教學另提及有「顯示所有評論」的彙總檢視功能，但未查到對應官方頁面確認其確切操作路徑（**存疑**）。
- 定位／用途：官方定位為多人協作時的意見反饋工具（"built-in comment option makes it easier for members of the group to communicate"）。

---

## 6. 超連結（Hyperlinks）

- 手動插入：選中節點 → 工具列「插入」→ 選擇「連結」（Link）→ 輸入網址與（可選）顯示文字。快捷鍵：`Ctrl+Alt+K`。
- 自動偵測：直接雙擊節點進入編輯狀態，貼上一個網址字串，系統會自動辨識並轉換為可點擊的超連結，不需手動走插入選單。
- 移除連結：右鍵點擊已加連結的節點，選擇移除連結的選項。
- 顯示：滑鼠移到已加連結的節點上方會顯示連結相關文字（tooltip）。

---

## 7. 圖片（Images）

- 插入方式（三種）：
  1. 選中節點 → 工具列「插入」→ 選擇「圖片」→ 選擇本機圖片檔案上傳；
  2. 直接把本機圖片檔案拖曳（drag）到畫布指定位置；
  3. 複製圖片後，選中節點按 `Ctrl+V` 直接貼上上傳。
  （快捷鍵：`Alt+P`。）
- 調整：選中圖片後可直接拖曳調整大小/位置。
- 數量限制：第三方文章提到「30 張／每張圖免費版；付費版 500 張」，但**此數字未在官方頁面中被直接核實到**，故列為「存疑」的第三方引用數字，需以官方頁面或實測再次確認。

---

## 8. 圖示 / 貼紙 / Emoji（Icons / Stickers）

- 觸發路徑：選中節點 → 右側「樣式」面板 → 「圖示」分類。快捷鍵：`Alt+I`。
- 圖示類別（官方教學列出）：優先順序、進度、旗幟（flags）、表情（emoji/expressions）、符號（symbols）、品牌/商標（logos）。
- 貼紙（Stickers）：在「圖示」內另有「貼紙」子分類，主題包含：「商務」、「教育」、「科技」、「表情」、「旅行」、「天氣」等多種類型。
- 移除：滑鼠選中節點後右鍵選擇「移除貼紙」即可清除。
- 行動版：選中節點 → 點擊「插入」→ 選擇「圖標」→ 在圖標欄點擊想要的圖示插入；再次點擊同一圖示可移除。

---

## 9. 優先順序與進度（Priority & Progress Markers）

- 觸發路徑：選中節點 → 點擊工具列（或樣式面板圖示分類）中的「優先順序 & 進度」按鈕 → 選擇想要的數字圖示。快捷鍵：`Ctrl+數字鍵`（數字對應優先級等級，例如 Ctrl+1 = 優先級1）。
- 優先順序圖示樣式：以數字圖示表示（1、2、3…），且不同數字搭配不同顏色（"順序圖示使用數字的圖示表示，且數字還有配色"）。
- 進度圖示：另有「進度圓餅圖示」（圓形/圓餅狀態圖），可指定圓餅填滿的比例大小來追蹤節點的完成/任務進度狀態。

---

## 10. 公式 / LaTeX（Formulas）

（此頁在簡中站 gitmind.cn 有專頁 insert-formula.html，繁中/英文站教學中僅簡略提及，內容邏輯應一致）

- 兩種插入方式：
  1. **LaTeX 直接輸入**：選中節點 → 點擊「插入」→ 選擇「公式」→ 選擇「LaTeX公式」→ 輸入 LaTeX 語法代碼 → 點擊「發送」插入。若不熟悉 LaTeX 語法，可點擊「公式速查」，在內建的公式速查表中直接點選需要的公式樣板插入，無需手打代碼。
  2. **智能識別公式（圖片辨識）**：同樣路徑選擇「公式」→「智能識別公式」→ 上傳或截圖含公式的圖片，系統自動辨識並轉換為 LaTeX 格式 → 點擊「發送」插入。
- 支援範圍：官方教學提到支援插入「物理公式、化學方程式」等各類常見公式，用戶輸入 LaTeX 數學命令即時轉化為公式顯示。
- 延伸資源：另有一篇「常見公式」（gitmind.cn/faq/formula-list.html）文章，列出常用 LaTeX 數學符號命令，可直接複製代碼貼到公式輸入框；若仍找不到需要的符號，可聯繫 support@gitmind.com。

---

## 11. 復原 / 重做（Undo / Redo）

- 快捷鍵：`Ctrl+Z`（復原）、`Ctrl+Y`（重做）。
- 滑鼠操作：點擊右上角選單（三個點「⋯」/選單圖示）選擇「復原」（Undo），出錯操作可被撤回；同一位置也提供「重做」（Redo）按鈕，可反向恢復被撤銷的操作。
- 行動版／藍牙鍵盤：`Ctrl/Cmd+Z` 復原（沒有明確查到行動版重做的快捷鍵，僅查到滑鼠/觸控點擊「⋯」選單裡的 Undo/Redo 按鈕）。

---

## 12. 尋找與取代（Find & Replace）

- 觸發方式：按 `Ctrl+F`，或在畫布空白處按右鍵選擇「查找&替換」（Find & Replace）選單項。
- 未查到進一步的細節（例如是否支援正規表達式、是否可限定搜尋範圍等），**此部分資訊不足**。

---

## 13. 專注模式（Focus Mode）

- 進入：開啟心智圖檔案 → 點擊右上角「⋯」（更多）選單 → 選擇「專注模式」。（另一頁描述為工具列上直接的「專注」按鈕，兩來源對「進入路徑」略有差異，可能是不同版本 UI，**建議實測確認目前版本的正確入口**。）
- 退出：按 `Esc` 鍵，或點擊畫面右上角的「退出」按鈕。
- 行為描述：官方定位為「排除頁面其他干擾元素，聚焦在內容上」的沉浸式編輯體驗（distraction-free editing），但未查到具體會隱藏哪些 UI 元件（工具列/側邊欄等）的逐項清單。

---

## 14. 多選（Multi-select）

- 桌面版：按住 `Ctrl` 再點選多個節點（逐一多選）；也支援 `Ctrl+左鍵框選（拖曳選取）` 進行區域多選（box select）。
- 多選後可批次操作：包含「同時調整多個節點寬度」、「按住 Ctrl 或右鍵框選多個節點統一修改樣式」（形狀、圓角、邊框、連接線等）。
- 「我的檔案」列表頁（雲端檔案管理介面，非畫布內）另有獨立的多選機制：右上角選擇「多選」後勾選多個檔案，可批次複製、移動、刪除——**這是檔案管理層級的多選，不是畫布內節點多選，兩者需在實作規格中分開處理**。

---

## 15. 其他確認到、與規格實作高度相關的周邊功能

雖非本次列點要求逐項但與編輯器行為緊密相關，一併記錄：

- **樣式面板（Style 面板）**：節點的「形狀」「圓角」「邊框」「連接線」樣式修改集中在右側「樣式」面板；佈局整理快捷鍵 `Ctrl+Shift+L`；主題切換 `F6`；「一鍵搭配」可隨機更換整體主題風格。
- **大綱模式（Outline）**：右下角視圖切換器可切換到大綱模式，沿用相同快捷鍵操作節點；大綱工具欄可常駐顯示於右下角。
- **簡報/演示模式（Presentation）**：點擊「演示」按鈕以簡報方式播放心智圖，滑鼠點擊翻頁；右鍵節點可選「從當前節點演示」開始播放。
- **分屏模式（Split Screen）**：右下角「分屏模式」按鈕，可在畫面一側上傳 PDF/DOC 文件或開啟網頁，與心智圖並排參照編輯。
- **插入附件（Insert Attachment）／插入影片（Insert Video）**：官方 FAQ 索引頁列出這兩項為獨立教學主題，功能名稱已確認存在，但操作細節未深入查證。
- **歷史版本（Version History）**：快捷鍵 `Shift+Alt+H`，可回溯/復原到先前版本。
- **多人即時協作（Collaboration）**：快捷鍵 `Shift+Alt+O`。
- **檔案匯出（Export）**：支援多種檔案格式輸出（具體格式列表本次未深入查證）。

---

## 資料可信度與缺口說明

1. **高可信度（多來源一致確認）**：節點新增/刪除/移動/複製貼上、關聯線、概要、備註、超連結、圖片、圖示/貼紙、優先順序與進度、公式插入、專注模式進出方式、絕大多數快捷鍵。
2. **中等可信度（單一來源或第三方教學，未見官方逐字確認）**：圖片數量上限（30/500 張）、評論的「顯示所有評論」彙總功能、備註的刪除操作方式。
3. **低可信度/存疑（需實測驗證）**：`Ctrl+D` 究竟對應「複製節點」還是「清除樣式」（兩官方鏡像頁面矛盾）；節點編號（numbering）功能的精確 UI 位置與顯示格式；尋找與取代的功能細節（是否支援進階選項）；專注模式的精確觸發入口（工具列按鈕 vs. 右上角選單，兩說法不一）。

建議：進入實作前，針對上述「存疑」項目直接開啟 gitmind.com 網頁版做一次操作性截圖驗證（尤其是 `Ctrl+D` 衝突與節點編號功能），以免規格文件裡帶入錯誤假設。

---

## 來源列表

- https://gitmind.com/tw/faq/how-to-use-gitmind.html （繁中官方主教學）
- https://gitmind.com/faq/how-to-use-gitmind.html （英文官方主教學）
- https://gitmind.com/tw/faq/shortcuts.html ／ https://gitmind.com/faq/shortcuts.html （官方快捷鍵表，繁中/英文）
- https://gitmind.com/faq/edit-mind-map.html （行動版編輯教學）
- https://gitmind.com/faq/question.html （常見問題 FAQ）
- https://gitmind.com/faq/add-comment.html （評論功能教學）
- https://gitmind.com/tw/faq/insert-link.html （插入連結教學）
- https://gitmind.com/tw/faq/insert-image.html （插入圖片教學）
- https://gitmind.com/tw/faq/focus-mode.html （專注模式教學）
- https://gitmind.com/faq/relationship-summary.html （關聯線與概括教學）
- https://gitmind.com/tw/faqs/help ／ https://gitmind.com/tw/faqs/help/page/2 （官方 FAQ 索引頁）
- https://gitmind.cn/faq/insert-formula.html （簡中站：插入公式教學）
- https://gitmind.cn/faq/formula-list.html （簡中站：常見公式/LaTeX 符號列表）
- https://gitmind.com/tw/faq/change-style.html （節點樣式設定）
- 第三方教學（交叉比對用，非第一手來源）：https://welly.tw/blog/gitmind、https://deanlife.blog/gitmind-toturial/、https://benic360.com/gitmind-review/

