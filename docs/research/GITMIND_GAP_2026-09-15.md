# GitMind vs MindFlow 缺口報告（2026-09-15）

> 基準：`gitmind-clone` working tree @ 2026-09-15（含**尚未 commit** 的右鍵框選變更：`js/editor/selection.js`、`viewport.js`、`contextmenu.js`、`tests/selection-frame.test.mjs`）。
> 產出流程：7 個面向（editing / layouts-summary / style-theme / attachments / chrome-ux / views-modes / io-share）各自盤點 → P1 每項各派 1 名 refuter 對抗驗證 → 本檔合併去重。
> 所有 file:line 皆指向 working tree 當日快照，實作前請重新 grep 確認。

**圖例**
- 類型：`missing` 完全沒有 ／ `partial` 有但不完整 ／ `divergent-visual` 外觀不同 ／ `divergent-behavior` 行為不同
- 嚴重度：P0 阻斷核心流程 ／ P1 日常必用且明顯 ／ P2 進階或次要 ／ P3 邊角、Pro 功能、對齊 DOM
- 工作量：S ≤ 半天 ／ M 1–3 天 ／ L ≥ 1 週（單人 Codex 估計，含測試）
- 驗證：✅ 已反駁驗證（1 refuter）／ ⚠️ 未驗證候選 ／ 🔧 Owner 已在實作 ／ ✔ 已符合

---

## 1. 一頁摘要

### 1.1 數量

| 項目 | 原始條目 | 去重合併後 |
|---|---|---|
| Owner 回報（第一批） | 2（a 概要括號方向 🔧、b 右鍵框選 ✔已完成未 commit） | 2 |
| P0 | 1（⚠️ 未驗證） | 1 |
| P1 | 28（✅） | **27**（Boundary 在 layouts-summary 與 style-theme 各出現一次 → 合併） |
| P2 | 約 80（⚠️） | **46** |
| P3 | 約 33（⚠️） | **29** |
| **缺口總數** | 141 | **103** |
| 已符合（OK） | 7 面向共 ~100 條 | — |

去重原則：同一功能被多個面向各自描述（例如「富文字工具列」在 editing / style-theme / chrome-ux 各寫一次）→ 併成一列，`面向` 欄列出全部來源。合併後嚴重度取最高、工作量取最大。

### 1.2 面向分佈（去重後）

| 面向 | P0 | P1 | P2 | P3 | 小計 | 主要痛點 |
|---|---|---|---|---|---|---|
| layouts-summary | 1 | 7 | 8 | 1 | 17 | 時間軸／目錄／魚骨三個家族版面根本不同；沒有 Boundary；佈局分頁只有 8 張卡 |
| style-theme | 0 | 5 | 10 | 4 | 19 | 12 個主題 vs 92；沒有彩虹線條調色盤；連接線形狀只有 3 種 |
| attachments | 0 | 4 | 9 | 8 | 21 | 圖示浮在節點上方而非行內；超連結「顯示文字」會覆寫節點文字；沒有評論／待辦 |
| chrome-ux | 0 | 3 | 5 | 6 | 14 | 面板不會因選取節點自動開啟；工具列是 Unicode 字元；魔杖不是隨機主題 |
| views-modes | 0 | 5 | 8 | 4 | 17 | 大綱視圖無層級字級；演示沒有標題／總覽／逐葉；儀表板沒有資料夾 |
| io-share | 0 | 3 | 6 | 6 | 15 | PDF 匯出其實是列印視窗；浮水印匯出時遺失；匯入只支援 4 種格式 |
| editing | 0 | 0 | 8（併入他面向後） | 3 | — | 皆為 P2/P3，大多是選取／摺疊／拖曳的視覺細節 |

（editing 面向的條目多與其他面向重疊，已合併計入上表對應列；不重複計數。）

### 1.3 最影響日常使用的 12 項（建議第一、二批優先）

| # | 缺口 | ID | 嚴重度／工作量 | 為何影響大 |
|---|---|---|---|---|
| 1 | 時間軸／目錄組織圖／魚骨頭圖 版面與 GitMind 不同 | L-03 L-04 L-05 | P1 / M×3 | 6 大家族有 3 個畫出來就不像；使用者一切換就發現 |
| 2 | Boundary（外框）整個缺席 | L-07 | P1 / L | 工具列固定位置、Ctrl+Alt+B、Style 分頁都缺；GitMind 使用者第二常用的覆蓋物 |
| 3 | 概要範圍不含子樹、不能單節點、無自動編號 | L-00 | **P0** / M | 括號會壓到子節點；只選一個節點就被拒絕（⚠️ 未驗證，但與 Owner a 同檔案） |
| 4 | 概要選取態＋範圍調整把手 | L-01 | P1 / M | 拖把手只動圓點、放開才重算，體感卡 |
| 5 | 關係線預設外觀（藍色虛線＋箭頭） | L-06 | P1 / S | 沒箭頭 = 看不出方向；三處預設色不一致（editor 橘、CSS 橘、export #f59e0b） |
| 6 | 右側面板不會因選取自動開啟、無空狀態 | C-02 | P1 / S | SPEC.md:37 自己就寫了「選中節點開啟」但沒做；面板預設常開反而擋畫布 |
| 7 | 圖示畫在節點上方而非行內；圖示庫類別／顏色不對 | A-02 A-01 | P1 / M×2 | 每個加圖示的節點都看得出差異 |
| 8 | 超連結對話框「顯示文字」覆寫節點文字 | A-03 A-04 | P1 / S×2 | 語意錯誤會破壞使用者內容；編輯中貼 URL 不會變連結 |
| 9 | PDF 匯出＝開列印視窗；浮水印匯出時消失 | I-03 I-02 | P1 / M×2 | 匯出是交付動作，失真最傷 |
| 10 | 佈局分頁 6 家族 × 31 縮圖 ＋ 10 種連接線形狀 | L-02 S-03 | P1 / L+M | 需要先做 brace/bracket/rounded-elbow 連接線 renderer |
| 11 | 主題只有 12 個、無彩虹線條調色盤 | S-02 S-01 | P1 / L+M | 主題是 GitMind 的門面 |
| 12 | 魔杖按鈕＝開面板而非隨機主題；工具列 Unicode 字元 | C-01 C-03 | P1 / S+M | 第一眼就看得出的 chrome 差異 |

---

## 2. 逐面向表格

### 2.0 第一批（Owner 回報）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 狀態 |
|---|---|---|---|---|---|---|---|---|
| O-a | Summary／概要 括號方向（bracket orientation） | 括號永遠開口朝向被概括的節點、位於子樹外側 | Owner 已依測試先行流程實作中；`tests/summary-orientation.test.mjs` 已存在 | divergent-visual | P1 | M | `js/editor/summary.js`、`css/features.css`、`tests/summary-orientation.test.mjs` | 🔧 實作中（**不重新規劃**） |
| O-b | 右鍵拖曳框選（rubber-band select） | 空白畫布右鍵拖曳圈選節點；放開後不跳右鍵選單；單擊仍開選單 | 已完成：`selection.js:18-30` button 2、4px 門檻 `:32-34`、一次性選單抑制 `:49-57` → `contextmenu.js:69`；`viewport.js:82` 只允許左鍵平移；E2E「右鍵拖曳圈選」「右鍵單擊」2/2 PASS；`docs/CODEX_RIGHT_DRAG_NOTES.md` | — | — | 已完成 | `selection.js`、`viewport.js`、`contextmenu.js`、`tests/selection-frame.test.mjs` | ✔ **未 commit**（7 個面向全部確認；建議立刻 commit，抑制窗 250ms 是唯一 nit） |

> O-a 的 facets 輸入列了 10 個面向標籤，判讀為「概要」這個功能被所有面向都點名，不代表 10 個獨立工作；本報告僅列一列。

### 2.1 layouts-summary（佈局與概要）

| ID | Feature | GitMind 行為與外觀 | MindFlow 現況（file:line） | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| L-00 | 概要範圍涵蓋整棵子樹、允許單節點、自動編號 | 括號跨選取節點**及其所有後代**的垂直範圍，放在子樹 bbox 外側 ~10px；單節點可概括；巢狀概要往外疊；自動命名「概括 N」遞增 | `getSummaryRange()` 少於 2 節點回 null（`summary.js:12`），`insertSummary` 提示「至少兩個」（`:179`）；`summaryGeometry()` 只量同級節點本身不含後代（`:108-112`）→ 括號壓到子樹；固定文字「概要」無計數（`:37`）；無巢狀偏移 | divergent-behavior | **P0** | M | `js/editor/summary.js` | ⚠️（與 O-a 同檔，建議 O-a 落地後由同一 stream 接手） |
| L-01 | 概要選取態＋範圍調整把手 | 選取時橘色 #F17E2E 1.5–2px 圓角矩形框住被概括範圍，上／下中點各一個橘色**方形**把手；拖把手即時以整個同級節點為步進伸縮，括號與概要節點同步移動 | 選取＝括號加粗＋陰影（`css/features.css:60-63`）＋標籤黃色 outline（`:81`），無範圍矩形；把手是兩個黃色**圓形** r=7（`summary.js:218-226`、`features.css:32-39`）；拖曳只移圓點，pointerup 才重算（`summary.js:236-258`），無即時更新 | divergent-visual | P1 | M | `js/editor/summary.js`、`css/features.css` | ✅ |
| L-02 | 佈局分頁：6 家族 × 31 張連接線風格縮圖 | 縱向 6 個家族區段（心智圖 7／邏輯結構圖 9／組織結構圖 6／時間軸 4／目錄組織圖 3／魚骨頭圖 2＝31），3 欄 ~100×72 #F5F5F5 卡片；變體以**連接線風格**區分（curved / straight / orthogonal / rounded-elbow / brace / bracket）；選中 1px 橘框 | `viewmode.js:139-161 mountLayoutPanel()` 覆寫整個 Layout 分頁為單一「全域佈局」2 欄格（`css/layouts.css:20-24`）8 張卡（`layout.js:13-22`），變體只差方向不差線型；`createLayoutPreviewSvg`（`layout.js:323-348`）全用直線；連接線形狀只能 per-node 在 Style→Line 選 3 種（`sidepanel.js:109`、`render.js:258-266`），無 brace/bracket/rounded-elbow renderer；`sidepanel.js:44-47,152-161` 另有一組 6 卡 fix2-layout-grid 但被 `initializeGamma` 覆寫、實際不可達（`docs/CODEX_FIX2_NOTES.md:31`）；`docs/SPEC.md:63-65` 只規範 6 家族 | partial | P1 | L | `viewmode.js`、`layout.js`、`sidepanel.js`、`css/layouts.css`、`css/editor.css` | ✅ |
| L-03 | 時間軸家族：一級節點**在**主軸上、子清單垂直懸掛；4 變體 | 橫向：主軸從根中心向右延伸，一級節點坐在軸上等距排列，每個一級節點的子節點以 stub＋ticks 向**下**垂直列表；變體 2 上下交替；縱向：根在頂、軸向下、子節點列在右側（變體 3）或交替（變體 4） | `arrangeTimelineHorizontal`（`layout.js:195-209`）把一級節點交替放在根中心線**上／下**而非軸上；`composeSubtree`（`:100-111`）讓每層都繼承 timeline → 深層也交替；`getConnectionPath`（`render.js:235-249`）每個子節點各畫獨立 L 形，**沒有連續主軸元素**；timeline-v（`layout.js:211-224`）只有左右交替，缺變體 3、缺 2/4；timeline-v 不在 Structure 圖示（`sidepanel.js:39-42`）、Layout 卡（`:44-47`）、`keyboard.js:781` allowlist、`model.js:8-16` / `io/import.js:11` 白名單 → 只靠 localStorage 側通道存活（`CODEX_GAMMA_NOTES.md:38,67`）；`tests/layout.test.mjs:87-103` 把現行交替行為鎖成契約 | divergent-visual | P1 | M | `layout.js`、`render.js`、`sidepanel.js`、`tests/layout.test.mjs` | ✅ |
| L-04 | 目錄組織圖（Tree Chart）：一級橫排、二級起縮排目錄 | 根在頂；一級節點在正交 bus 下橫排；二級起在各自父節點下方渲染成縮排目錄列表（父節點左側垂直線＋ticks）；3 種 bus/elbow 變體 | `arrangeTree` 連一級節點也縮排成一長條垂直列表（`layout.js:180-193`）；連接線固定從 `parent.x+12` 起的 elbow（`render.js:217-224`）；無變體；`tree-left` 內部存在但沒卡片（`layout.js:31-34`） | divergent-visual | P1 | M | `layout.js`、`render.js` | ✅ |
| L-05 | 魚骨頭圖：主脊＋斜骨，二級沿骨附著；2 種頭向 | 頭（根）在左、骨向右（變體 1）或頭在右（變體 2）；水平主脊自頭延伸；一級節點在斜骨外端、上下交替、朝頭傾斜；二級沿骨以短水平線附著；三級以下水平列表 | 只有頭在右：`arrangeFishbone` 子節點放父節點**左側**（`cursorX = -HORIZONTAL_GAP`，`layout.js:226-240`）；無主脊線，每條一級連接線是根邊緣到子節點 12px 尾巴的獨立斜線（`render.js:226-233`）；二級以下繼承 fishbone（`layout.js:100-111`）也上下扇開而非沿骨列表；面板縮圖（`sidepanel.js:521-523`）畫了實際不存在的主脊 | divergent-visual | P1 | M | `layout.js`、`render.js` | ✅ |
| L-06 | 關係線預設外觀 | 未選取：2px **虛線藍色**（#3B7BFF 近似）貝茲曲線，目標端小實心三角箭頭；建立時中點出現「Press Space to edit」占位 | `DEFAULT_STYLE` 橘 #f17e2e 2px 虛線（`relations.js:11`）；`css/features.css:21-51` 亦全橘系；**沒有箭頭**：`drawRelations`（`relations.js:276-286`）只 append 透明 hit-area＋stroke path，全 repo 無 `<marker>`/marker-end；占位「雙擊輸入」只在選取或已有標籤時渲染（`:288`）；SVG export（`js/io/export.js:432-434`）用第三套預設（#f59e0b、dash '7 5'、中心到中心）也無箭頭；無測試斷言顏色／箭頭 | divergent-visual | P1 | S | `relations.js`、`css/features.css`、`js/io/export.js` | ✅ |
| L-07 | Boundary（外框）：工具列按鈕、子樹框、備註帶、伸縮、樣式、Ctrl+Alt+B | 工具列 ▢ 在 ⊕ Insert 與 Summary 之間；一鍵在節點＋整棵子樹外畫填色圓角矩形（2px 虛線、radius 8、~20px padding）；頂邊有「You can add notes here!」備註帶；橘色選取＋右上把手可伸到相鄰同級；Style 分頁「Boundary Style」[shape][fill] + Radius slider + 「Boundary Border」[line type][colour][width]；預設 fill rgba(57,130,252,.1)、stroke #3982fc 2px dash [4,2]；主題帶 boundary 顏色；Ctrl+Alt+B | **完全沒有**：`editor.html:26-36` 無按鈕；`js/`、`css/` grep 外框/boundary 只命中 summary 的 `summary-boundary` class（`summary.js:221`、`features.css:33`）；`model.js:92,178` 只有 summaries/relations；`keyboard.js:55-113` 無 Ctrl+Alt+B；`themes.js:38-56` 無 boundary key | missing | P1 | L | `editor.html`、`toolbar.js`、`model.js`、`keyboard.js`、`render.js`、`sidepanel.js`、`themes.js` | ✅（layouts-summary + style-theme 各驗一次，合併） |
| L-08 | 概括線條（Summary line）樣式列：括號形狀下拉、顏色、線型、寬度 | [括號形狀 2×5=10 種：round/square/rounded-square/curly/angled/bar 變體，預設 curly 帶 stub][顏色][線型][寬度 2px]；預設括號色＝主題 accent（藍），概要節點 accent 填色白字 | 只接受 lineColor/lineStyle/fill（`presentation.js:34-39`，經 `dnd.js:109-120`）；括號路徑固定 curly（`summary.js:121`）；無寬度控制；預設橘 #f17e2e 2.5px（`features.css:53-58`）、節點 #fff7ed 卡＋棕字（`:65-79`），不跟主題 | partial | P2 | M | `presentation.js`、`summary.js`、`sidepanel.js`、`dnd.js`、`features.css` | ⚠️ |
| L-09 | 各家族的連接線變體（心智圖 7／邏輯 9／組織 6）＋ Style 分頁 Structure 列 | 心智圖：curved／straight X／converging brace／square-bracket bus+stubs ×2／round-bracket／curly-brace；邏輯：右 6（round bracket／square bracket／rounded elbow／straight fan／curved converging／curly brace）左 3；組織：curved arc bus／square bus ⊤／rounded-corner bus／straight fan／curved fan／curly-brace bus；Structure 列 ~30 個模板＋依類別變化的方向下拉（mind: Evenly/Two-sided/Align center；org: TtB/BtT；filetree: Right/Left/Balanced/…） | 只有 `mindmap-both`／`mindmap-right`／`mindmap-left`／`org`（`layout.js:14-16,125-178`）；`getConnectionPath`（`render.js:208-269`）無 bus-and-stub / brace / fan 幾何；org 分支在查 appearanceShape 前就 return（`render.js:208`）所以線型選單對 org 無效；`sidepanel.js:39-42` Structure 只 6 顆、`:116` 固定 3 選項方向 select | partial | P2 | L | `render.js`、`layout.js`、`sidepanel.js`、`viewmode.js` | ⚠️（是 L-02 的子集，建議一起做） |
| L-10 | 節點間距：⟳ 重設、分層預設、真實 gap 語意、Align sibling nodes | 區段有 ⟳ 重設＋範圍下拉「All nodes / All peers」；滑桿 max 200、min -30 或 2；預設依層級 50 根／30 一級／20 更深；改的是真實版面 gap；滑桿左側橘色填充；底部「Align sibling nodes」checkbox 讓同層節點等寬 | 兩個 range 10–80 預設 30＋scope「所有節點／僅選取子樹」（`sidepanel.js:118-123,220-232`）；無重設；單一全域預設 30（`themes.js DEFAULT_SPACING`、`render.js:290-291`）；原生滑桿樣式；scoped spacing 存在 lineStyle token 字串裡（`themes.js:346-354`）並以 post-layout **縮放**套用（`themes.js:356-380`、`render.js:288-307`）而非改 `layout.js:7-11` 的 gap → 低值重疊、高值非均勻拉伸；**Align sibling 完全沒有**（grep 對齊/alignSibling/justify 只命中 execCommand） | divergent-behavior + missing | P2 | M | `sidepanel.js`、`themes.js`、`render.js`、`layout.js`、`dnd.js` | ⚠️（editing / layouts-summary / style-theme 三處合併） |
| L-11 | 一鍵整理（Ctrl+Shift+L）的「拖離後回彈」語意 | 被手動拖離自動位置的節點會回彈；快捷鍵／···／畫布右鍵皆可觸發 | 三個入口都呼叫 `tidyLayout`（`viewmode.js:98-137`）刪 offset key 並 re-fit，但**沒有任何模組會寫入** offsetX/manualX（`dnd.js:44-52` 只 reparent/reorder）→ tidy 實際只是「fit to canvas」 | partial | P2 | S | `viewmode.js`、`dnd.js`、`layout.js` | ⚠️ |
| L-12 | 關係線選取把手＋專屬「Relation line」樣式區段 | 選取：橘色高亮；端點是**空心橘方形**（可沿節點邊緣滑動附著點）；兩個橘色實心圓控制點各以細橘線連到端點；Style 分頁顯示單一「Relation line」區段 [形狀 2×2：straight／curved S（預設）／orthogonal elbow／zig-zag][colour][line type 預設 dashed][width 1–5 預設 2]；預設 #3982fc 2px dash [4,1]、marker-start line、marker-end triangle | 端點白圓橘框（`relations.js:322`、`features.css:41-47`），控制點黃圓棕框（`:316`、`:32-39`），導線黃色虛線（`:25-30`）；端點拖曳只能換到別的節點（`relations.js:353-380`），不能沿同節點邊緣滑（起迄永遠在面向對方那側的中點，`:108-110`）；無專屬區段：整個 node Style 面板照常顯示，關係線編輯經 node「Line」列（`sidepanel.js:200-216,243-251`）；形狀 select 對關係線明確忽略（`:211`），`relationGeometry` 永遠 cubic bezier（`relations.js:117-126`）；寬度 0–5（`sidepanel.js:111`）vs 1–5；寬度 clamp 1–8（`relations.js:471`） | divergent-visual + partial | P2 | M | `relations.js`、`sidepanel.js`、`features.css` | ⚠️（layouts-summary ×2 + style-theme 合併） |
| L-13 | 手機版佈局 grid／切換後提示 | 手機 ··· → Layout → 4 欄 9 圖示 popup 帶「Back」標頭 | 手機只有代理按鈕「佈局」開桌面側欄（`mobilechrome.js:97`）；切換後無 toast（`viewmode.js:52-71`） | partial | P3 | S | `mobilechrome.js`、`viewmode.js` | ⚠️ |

### 2.2 style-theme（樣式與主題）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| S-01 | 彩虹線條（Multi-branch Color）調色盤控制 | Theme 分頁有 6 色 swatch bar＋84 組調色盤下拉（multiColor1…84）；選一組即在 root 設 connect-multicolor / fill-multicolor，第 i 條分支取 palette[i mod 6]；表頭列「- Default theme color -」 | **無控制項**：rainbow 是 per-theme boolean（`themes.js:43` 預設 true，`:58-143` 各主題覆寫），在 `render.js:272-286` / `export.js:604-608` 套用；`branchPalette` 燒在主題裡，文件只存 `themeId`（`model.js:90,176`）→ 無 per-document 覆寫；Theme pane（`sidepanel.js:125-135`）無 swatch bar；自訂主題存檔（`themes.js:432-451`）也只是複製 base.branchPalette | missing | P1 | M | `sidepanel.js`、`themes.js`、`render.js`、`export.js`、`model.js` | ✅ |
| S-02 | 內建主題目錄 | Recommended 分頁 92 個可見主題（＋6 ja-only、~100 legacy），每頁 6 個帶「‹ 1 / N ›」分頁器；VIP/Pro 徽章；縮圖無文字名稱 | 12 個硬編碼（`themes.js:58-143`）；不分頁全部渲染（`sidepanel.js:329-384`）且縮圖下有文字名稱（`:348-352`、`editor.css:663-669`）；`SPEC.md:57` 刻意寫「至少 12」 | partial | P1 | L | `themes.js`、`sidepanel.js`、`editor.css` | ✅ |
| S-03 | Style 分頁 Line（連接線）形狀清單 | 10 種（arc, bezier, fork, fork-rounded, hayfork, hayfork-rounded, y, parabola, t, bracket）2×5 圖示格，依當前佈局過濾；寬度 1–5（無 0） | `sidepanel.js:109` 只 3 種（曲線／直線／直角）；`render.js:207-270` 只實作 cubic bezier／straight／orthogonal＋org/tree/fishbone/timeline 固定 elbow；寬度 select 允許 0（`:111 numberOptions(0,5,3)`） | partial | P1 | M | `sidepanel.js`、`render.js`、`themes.js` | ✅（renderer 部分與 L-02/L-09 共用） |
| S-04 | Style 分頁 Shape 列（形狀集合與選擇器呈現） | 下拉開 2 欄 × 5 列引擎形狀格；根節點隱藏「underline」 | 形狀集合 `sidepanel.js:30-33` 的 10 種**與 repo 自己的研究一致**（`docs/research/THEMES.md:169-181`、`DIGEST.md:34`），refuter 指出「arc-roof-rect／flat-hexagon」等說法在 repo 無任何佐證 → 集合差異**不成立**。真正差異：(1) 呈現 — 研究記錄是下拉觸發鈕開 2×5 popup，MindFlow 是常駐 5 欄 × 2 列按鈕格（`editor.css:451-456`、`sidepanel.js:94-95`）；(2) rounded/rounded-large/soft-rect 都是固定 radius 4/10/16 的 rect（`render.js:180-181`），Radius slider 只對無自訂 radius 的 rect 有效；(3) 根節點不排除 underline（`sidepanel.js:478`）— 但 GitMind 這行為本身也無研究佐證 | partial | P1（實際 P2） | M | `sidepanel.js`、`render.js`、`editor.css` | ✅（refuter 已削弱：只剩呈現方式） |
| S-05 | 線條漸細（Tapered line）＋ Initial width / Thickness 滑桿 | 主題格下方 checkbox；開啟後滑桿 startWidth 5–20、linePower -1…3（step .1）；分支線從父端粗到子端細 | 沒有：`render.js:194-205` 單一 stroke-width（`themes.js:404-414` lineWidthByDepth 4→3→2→1）；無 polygon path、無 checkbox、無 doc/theme key | missing | P2 | M | `render.js`、`themes.js`、`sidepanel.js`、`model.js` | ⚠️ |
| S-06 | 邊框虛線預設的渲染 | 5 種 dash（[] / [1,1] / [2,1] / [3,1,1,1] / [5,3]）在節點外框上各不相同 | `sidepanel.js:35-37` 列了 5 種，但 `render.js:376-378 cssBorderStyle` 把 dashed／dash-dot／long-dash 全映到 CSS `dashed` → 5 種有 3 種長一樣；連接線有各自 dasharray（`:380-382`） | divergent-visual | P2 | M | `render.js`、`css/node.css` | ⚠️ |
| S-07 | 共用色彩選擇器調色盤 | 「☐ Default」checkbox 列、固定 10×8「Standard」80 個精確 hex（r1 #C40007…#71309F … r8 #333333…#3E2723）、第二組「Art」粉彩、tint/shade 滑桿、Recent 列、「More Colors ›」RGB/hex；≈250×370、格 18px/3px gap | `sidepanel.js:551-650 mountPicker`：10×7 由 HSL 生成（`createPalette :636-640`）— GitMind 的 hex 一個都沒有；無 Art、無 tint；「預設」是按鈕非 checkbox（`:605-608`）；more colours 是原生 `<input type=color>`（`:609-616`）；252px 寬、20px 格（`editor.css:528-538`） | divergent-visual | P2 | S | `sidepanel.js`、`editor.css` | ⚠️ |
| S-08 | 富文字／字型浮動工具列：停靠、字型、字級、行距、[T] 行為、Ctrl+B/I/U 於選取態 | 直接停靠在主工具列**正下方**左對齊；[T] 點了就出現（不必進編輯）；13 種字型（Default/宋体/楷体/黑体/隶书/Andale Mono/Open Sans/Comic Sans/Impact/Times/M PLUS 1p/Noto Sans JP/Noto Serif JP）；16 級字 12…48；行距 1.0–2.0 step .1 預設 1.5；字色／填色用共用 swatch；B/I/U/S、對齊、格式刷、清除格式；Ctrl+B/I/U 對**選取節點**有效；Ctrl+Shift+>/< 沿字級清單步進 | `edit.js:367-382` 只在有 edit session 時顯示 `#text-toolbar` 並浮在節點**上方**；[T] 映到 `edit`（`toolbar.js:46`）永遠進編輯；`editor.html:58-68` 6 字型 6 字級（12/14/16/18/24/36）；行距 5 值預設 1.35（`:80-82`）；顏色是原生 `<input type=color>`（`:74-75`、`edit.js:305-334`）；Ctrl+B/I/U 只在 edit session（`edit.js:194-197`），`ACTION_BINDINGS`（`keyboard.js:55-113`）無選取態 b/i/u；Ctrl+Shift+>/< 是 ±2px（`keyboard.js:605-609`）；Ctrl+[ 刪除線、Ctrl+Alt+0 清除樣式未綁 | partial | P2 | M | `edit.js`、`editor.html`、`editor.css`、`keyboard.js`、`toolbar.js` | ⚠️（editing / style-theme / chrome-ux 三處合併） |
| S-09 | 格式刷：持續模式、資訊列、右鍵「貼樣式到同層」 | 選來源 → 刷子／Ctrl+G → 點目標，複製**全部**樣式；持續有效直到 ESC 或再點圖示；底部置中常駐提示列「Click target node to apply format painter, and press ESC to turn off.」帶 ×；游標不變、刷子高亮；hover 目標橘框；右鍵「Paste style to same level / All peers」 | `floating.js:118-141` 只 clone `source.style`（顯式覆寫）→ 主題樣式的來源 style 是 {} 時 `setStyle()` 回 false（`commands.js:406-412`）什麼都不套；一次性（`clearPainter` 在 `:135` 先跑）；提示是 2.2s toast（`attachments.js:680-696`）；游標強制 `copy`（`features.css:473-474`）；`contextmenu.js:7-28` 無貼樣式項；`keyboard.js:296` 與 `floating.js:118` 雙重註冊（後者覆蓋）；`SPEC.md:79` 記為刻意的 single-shot | divergent-behavior | P2 | S | `floating.js`、`keyboard.js`、`contextmenu.js`、`features.css` | ⚠️（editing + style-theme 合併；含 SPEC 決策，需 Owner 拍板） |
| S-10 | 「Change Theme」／F6 隨機主題 ＋ 右邊緣浮動魔杖 | 工具列魔杖、浮動魔杖、F6、「Change Theme」全跑同一個加權隨機（35% dopamine / 35% classic / 20% dark / 10% other）並 toast「Set successfully」；設定「Random theme」讓每個**新檔**隨機主題；右邊緣獨立圓形白鈕橘色星芒、tooltip「樣式／更改節點樣式」 | `sidepanel.js:258-263` 一鍵搭配＝12 個中排除當前的均勻隨機、無 toast；F6 → `nextTheme` 順序循環（`keyboard.js:80,299`、`themes.js:221-224`），`SPEC.md:18` 明訂「循環下一個」；無浮動魔杖（`editor.html:14-45`）；新檔用使用者預設主題（`themes.js:210-219`）無隨機選項 | divergent-behavior + missing | P2 | S | `keyboard.js`、`themes.js`、`sidepanel.js`、`editor.html`、`docs/SPEC.md` | ⚠️（與 C-01 同根；含 SPEC 決策） |
| S-11 | Theme 分頁：分頁器、hover「…」選單、toast、Pro/VIP | 每頁 6 個（Custom 5）帶「‹ 1 / N ›」且各分頁記憶頁碼；縮圖 hover 出「…」→ Pin / Set as default；套用時 toast「Theme set successfully.」；Recommended / Custom / Purchased 分類 tab | 不分頁（`sidepanel.js:329-384`）；pin（○/●）與「設為預設」是常駐 inline 按鈕（`:353-371`、`editor.css:656-680`）；套用無 toast（`:344-347`）；分類 tab 改為兩段 推薦主題／自訂主題（`:129-134`）；Pin max-6 與移到最前有做（`:333,:433-440`） | divergent-visual | P3 | S | `sidepanel.js`、`editor.css` | ⚠️ |
| S-12 | Background 子分頁：圖片背景、分類、自訂上傳 | Recommended 縮圖是平鋪／cover PNG 材質（americanGrid, grain1–4, papertexture, cartoonGrid…）分類（Study Note / Grid Texture / Gradient Color / Business Plan / Fresh）分頁；Custom 上傳 PNG/JPG ≤20MB 帶比例裁切；swatches #FDF4BD #C0E5BC #8C8FD5 #BDF4FC #C3BCE6 | `themes.js:148-159` 只 10 個 CSS gradient 字串；`sidepanel.js:296-306` 不分頁不分類無上傳；`canvas.background` 是純 CSS 字串（`render.js:109`）無 texture/resource-id 資料路徑；快速 swatch 每個差一位 hex（`sidepanel.js:278`） | partial | P2 | M | `themes.js`、`sidepanel.js`、`render.js`、`model.js` | ⚠️ |
| S-13 | 浮水印：範圍、預設、重設、tile 尺寸 | 旋轉 Left=-30°／Right=+30°／Horizontal=0°（預設 Horizontal）；透明度 10–100 預設 100；大小 12–48 預設 14；⟳ 重設；tile 依文字寬＋textSpacing 80 / lineSpacing 80 計算；premium-gated | 角度 ±24°（`render.js:395`）預設 `left`（`model.js:38-45`）；opacity 0–100 預設 12（`sidepanel.js:146`、`keyboard.js:905`）；size 10–48 預設 18（`:147`、`:906`）；無重設；tile 固定 260×150 SVG（`render.js:397`、`editor.css:198-199`）長文字會裁切；30 字限制、計數器、色選、3 向旋轉有做 | partial | P3 | S | `render.js`、`model.js`、`keyboard.js`、`sidepanel.js`、`editor.css` | ⚠️（匯出遺失部分見 I-02） |
| S-14 | 主題資料模型：relLine / summary / boundary / background-image / floatRoot 槽位 | Theme = {map:{background-color, background-image?}, root, main, sub, floatRoot?, relLine:{line-color,color}, summary:{summary-connect-color, fill-color, color}, boundary:{color, fill-color, stroke-color}}；node keys 含 fill-multicolor / connect-multicolor / connect-tapered* / text-vertical-align / stroke-dasharray | `themes.js:38-56 theme()` = {canvasBg, branchPalette, rainbow, lineShape, lineWidthByDepth, rootStyle, level2Style, leafStyle}；關係線預設是常數（`relations.js:11`）、概要顏色是固定 CSS（`features.css:53-79`）→ 深色主題仍是橘色覆蓋物；`NODE_STYLE_KEYS`（`model.js:32-36`）無 multicolor/tapered/vertical-align | partial | P2 | M | `themes.js`、`model.js`、`relations.js`、`features.css` | ⚠️（S-01 / L-07 / L-08 / L-12 的資料層前置） |
| S-15 | 未綁定的樣式／主題快捷鍵 | Ctrl+Alt+0 清除樣式；Ctrl+[ 刪除線；Ctrl+= / Ctrl+- 縮放；Ctrl+Shift+F 適應；Ctrl+Shift+/ 深層展開；PageUp/PageDown；Ctrl+Alt+B 外框；Shift+Delete 刪除選取節點；Shift+Alt+O 協作 | `keyboard.js:55-113` 都沒有；zoomIn/zoomOut action 存在（`:272-273`）但只綁 Ctrl+0（`:103`）；fit 是 Ctrl+Alt+F（`:107`）非 Ctrl+Shift+F；Shift+Delete 未綁（`:67-68` 只 Ctrl+Delete／Delete）；Ctrl+Alt+R 落到 coming-soon | partial | P3 | S | `keyboard.js`、`shortcuthelp.js`、`docs/SPEC.md` | ⚠️（editing / style-theme / chrome-ux 三處合併） |
| S-16 | 節點寬度：常駐把手 vs hover 邊緣、近似換行量測 | 無可見把手：選取節點 hover 左右邊緣游標變 ew-resize 拖曳；半透明橘預覽；文字以真實量測重排（max 400px 自動換行）；把手視覺是單一 #FEA261 圓＋黑 ↔ | `dnd.js:88-107` 給每個選取節點兩根常駐橘色 3×22px 把手條（`features.css:580-607`），無箭頭；寬度 clamp 60–500（`themes.js:10-11`）；`measureNodeWithWidth`（`themes.js:321-333`）用 ceil(naturalWidth/available) × 行高估算而非重新量 DOM → 高的換行節點可能算錯；多選批次 resize 與 undo 有做 | divergent-visual | P3 | S | `dnd.js`、`themes.js`、`features.css` | ⚠️（editing + style-theme 合併） |

### 2.3 attachments（附件與圖示）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| A-01 | 圖示庫：類別、數量、顏色、格線 | 優先級 10 個編號圓（1 #E5453B、2 #F5A623、3 #4C6EF5、4 #B23AC0、5 #2DBE60、6 #2AAFE0、7-10 灰系）；進度（灰 − ＋ 7 個餅 ＋ ✓）；旗幟 10；星星 10；頭像 10；箭頭 10 橘；月份 12 綠；星期 7 藍；符號 48 彩色 flat glyph 6×8；~22px 圖示在 32px 格、每列 8；子分頁「Icon ｜ Sticker ｜ Illustration」 | `iconpanel.js:8 PRIORITY_COLORS` 9 個彩虹色（`:53` clamp 1..9，`:148` 只註冊 priority1..9）— 無 10、顏色不同；`PROGRESS_VALUES :9` 8 階（缺 87.5）；0% 畫空圓無「−」、100% 實心綠無 ✓（`:58-71`）；FLAGS 6 色、EMOJIS 18、SYMBOLS 12 個純文字（`:10-15`）；只渲染 優先順序／進度／旗幟／表情／符號（`:163-200`），無 星星／頭像／箭頭／月份／星期；子分頁只有 圖示｜貼紙（`:165`）；每列 6（`features.css:508,524`；窄版 5 `:672`）28px | partial | P1 | M | `iconpanel.js`、`features.css` | ✅ |
| A-02 | 圖示在節點內的渲染 | ~18px 圓形徽章**行內**排在節點文字左側，~6px gap；多個圖示左→右排；節點高度不變 | `iconpanel.js:296-330 decorateNodeIcons` 在版面後 append `.node-icon-strip`；`features.css:257-268` `position:absolute; left:4px; bottom:calc(100% + 4px)` → **浮在節點框上方**；20×20（`:270`）；`layout.js`／`render.js` 無圖示處理 → 節點寬高不因圖示調整；無測試 | divergent-visual | P1 | M | `iconpanel.js`、`features.css`、`render.js`、`layout.js` | ✅ |
| A-03 | 超連結對話框：欄位與語意 | Modal「連結」：「連結位址」（必填 http(s)）＋「提示文字」（選填，**只作 hover tooltip**，不改節點文字）；取消／確定（橘）；focus 輸入橘框＋ⓧ 清除 | `createLinkDialog attachments.js:522-572`：標題「插入連結」，欄位「網址」＋「顯示文字」且其值**覆寫 node.text**（`:553-555 if (label) patch.text = label`）；model 只存 `link: string`（`model.js:64,144`）無法保存 hover 文字；多一顆「移除連結」＋「套用」（`:531`）；無 ⓧ | divergent-behavior | P1 | S | `attachments.js`、`model.js` | ✅ |
| A-04 | 超連結：節點指示、tooltip、自動辨識（含編輯中貼 URL） | ~16px 鏈條 glyph **行內**在節點文字右側（節點內）、hover 淡桃底；灰 tooltip 在右下「Text(URL)」；點擊開新分頁；編輯中貼 URL → 節點文字變 URL 並附連結 glyph | `attachments.js:313-326` 建 `<a>` 文字「↗」放進 `.node-attachment-badges`，`features.css:152-177` 絕對定位 `top:-12px; right:-14px` 23px 白圓徽章在節點右上角外；tooltip 是 CSS ::after 深藍（`:179-201`）只顯 URL；點擊開新分頁 ✓；**貼 URL**：window paste handler（`attachments.js:184-204`）對 editable 提前 return（`:185`；`isEditableTarget :707-715`），edit session 中無 URL 偵測（`edit.js` 無 paste/isLikelyUrl）→ 編輯中貼 URL 變純文字；選取態貼 URL 有附 link 但不改文字 | divergent-visual + partial | P1 | S | `attachments.js`、`features.css`、`edit.js` | ✅（editing P3「編輯中貼 URL」併入） |
| A-05 | Insert（⊕）下拉：項目集合與視覺 | 白色圓角卡、16px 線條 glyph、列高 ~44px；2022 繁中順序 圖片／備註／評論／連結／公式／貼紙；2025+ 加 靈感／互鏈／影片／浮水印／附件 帶橘色 Pro 徽章；2026 順序 Image / Note / Hyperlink / Sticker / Ideas / Equation / Comment / Interlink / Video / Watermark / Attachment；⊕ tooltip 兩行「插入／為選中的節點添加其他元素」；列無快捷鍵字 | `attachments.js:574-610 createInsertMenu` 6 列 [圖片 ▧, 連結 ↗, 備註 📄, 公式 ∑, 評論 ◌, 貼紙 ✿] 各帶 `<kbd>`，emoji/unicode glyph；順序不同；無 靈感／互鏈／影片／浮水印／附件；`editor.html:31` tooltip 單行「插入」；min-width 210px（`features.css:398-409`） | divergent-visual | P2 | S | `attachments.js`、`features.css`、`editor.html` | ⚠️（attachments / chrome-ux / io-share 三處合併） |
| A-06 | 節點內圖示的移除／替換 | hover 節點內圖示（pointer）點擊 → 移除（EN）或開 popover 含完整類別＋「移除」（繁中）；手機「Remove all」 | 面板側 toggle 有效（`iconpanel.js:29-50`）；但節點內圖示 inert：`features.css:267 pointer-events:none`、`.node-inline-icon` 無 click handler（`iconpanel.js:319-326`）、無 popover | partial | P2 | S | `iconpanel.js`、`features.css` | ⚠️ |
| A-07 | 貼紙：面板版面、類別、節點行為 | 類別 商務／教育／科技／表情／旅行／假日／天氣／運動 分區段標題，每列 5，~40px；節點內置於文字上方置中 ~56-64px、自動長高；貼紙與圖片可**共存**；選取 8 個橘把手；拖曳本體 → 3×2 橘色 drop-zone 格重定位；右鍵「移除貼紙」 | `assets/stickers/manifest.json` 10 類 × 12（含 animals/food/symbols-arrows，無 假日／運動）；面板是搜尋框＋pill tab＋每列 3 帶文字標籤（`iconpanel.js:173-181,229-245`、`features.css:545-559`）；`attachNodeStickerCommand iconpanel.js:94-132` 寫進 `node.image` → 貼紙**取代**圖片（互斥），預設 96×96；只 4 角把手＋紅 × 刪除（`attachments.js:271-292`）；無 3×2 drop-zone；`contextmenu.js:7-28` 無「移除貼紙」 | divergent-behavior | P2 | M | `iconpanel.js`、`attachments.js`、`contextmenu.js`、`assets/stickers/manifest.json`、`features.css` | ⚠️ |
| A-08 | 圖片：插入對話框三種方法 | Insert › Image（Alt+P）開 modal「插入圖片」~520×430：橘鈕「方法1 選擇圖片」、虛線拖放區「方法2 拖放」、「方法3 截圖後選中節點 Ctrl+V」；區內預覽；確定／取消 | 無 modal：`registerAction('insertImage') attachments.js:147-151` 直接點隱藏 `<input type=file>`（`:612-625`）；拖放在整個畫布（`:169-182`）與貼上（`:184-197`）可用但無對話框框架；Alt+P ✓ | divergent-behavior | P2 | M | `attachments.js`、`features.css` | ⚠️ |
| A-09 | 圖片：節點內渲染、選取／縮放／移動／放大 | 圖片在文字上方置中，節點隨圖變寬（~180px 預覽）；點擊 → 1px 橘框＋8 個 8px 橘把手；拖本體 → 半透明橘 3×2 格覆蓋、吸附 左／上／下；hover 放大鏡游標 | `decorateNodeAttachments attachments.js:253-295` 永遠置於文字上方，寬 = max(w, img+16)、高 += img+10；`readImageFile :64` 顯示尺寸 max 240×160；只 4 角把手（`:271-279`、`features.css:114-129`）＋紅 ×（`:280-292`）；無拖曳重定位、無 zoom 游標／lightbox（`features.css:111 pointer-events:none`） | partial | P2 | M | `attachments.js`、`features.css` | ⚠️ |
| A-10 | 備註／Notes：面板行為與節點 glyph | 右側「備註」~320px 全高、無框 textarea；輸入**即時**更新節點；節點顯示線條文件 glyph 行內在文字右側；hover tooltip、點擊重開；無選取時面板顯示「請選擇節點」；2025+ 支援 B/I/U/清單/Markdown 貼上 | `createNoteDrawer attachments.js:479-520`：360px 抽屜（`features.css:312-326`）帶 eyebrow「節點附加物」、有框 textarea、「0 / 10000」計數與「儲存備註」鈕；只在 save/Ctrl+Enter/close 提交（`:492-506`）非即時；無選取 toast「請先選取節點」（`:136-137`）；glyph 是 emoji 📄 放右上浮動徽章（`:300-311`）；純文字無格式 | partial | P2 | S | `attachments.js`、`features.css` | ⚠️ |
| A-11 | 評論／Comments：節點泡泡、徽章、面板、composer、清單、顯示評論 toggle | hover/select 節點右上「···」對話泡；點擊（或 Insert › Comment / Ctrl+Alt+R）開右側「Comment (N)」面板：composer（引用節點文字、textarea、Enter 送出、Shift+Enter 換行、藍 OK）、評論卡（頭像、名稱、相對時間、讚、回覆、···→Edit/Delete）、「Show all comments」；發表後徽章變橘色計數圓；toast「評論成功」；··· 選單「顯示評論」toggle 控制徽章；footer「評論: N 節點總數: N／圖片: N 文字: N」 | **未實作**：Insert 評論列只 toast「評論將在後續版本接入」（`attachments.js:583,593`）；Ctrl+Alt+R（`keyboard.js:102`）落到 `showComingSoon`（`:323-326,926-941`）；e2e 只斷言 toast；無泡泡／徽章／面板；`model.js:60-66,140-146` 無 `comments`；`shortcuthelp.js:57,84-86` 的「顯示評論」toggle 只切 body class `hide-comments` 無人消費、footer 數 `node.comments` 永遠 0；無 圖片／文字 計數；`SPEC.md:9` 明訂延後評論後端，但本機評論串可行 | missing | P2 | M | `attachments.js`、`keyboard.js`、`model.js`、`shortcuthelp.js`、`css/features.css` | ⚠️（attachments ×2 + chrome-ux「hover affordances」合併） |
| A-12 | 待辦事項／To-do（2026-08） | ⊕ 後的 ☑ 工具列鈕開「To-do settings」面板（Due date、Priority High/Medium/Low segmented、Remove to-do）；節點文字左側行內 checkbox、右端 pill（時鐘＋日期＋優先級字母）；點 checkbox 完成 | 未實作：`editor.html:22-37` 無按鈕；`model.js:60-66` 無欄位；無 renderer | missing | P2 | M | `editor.html`、`toolbar.js`、`model.js`、`attachments.js` | ⚠️ |
| A-13 | 公式／LaTeX popover 編輯器 | ~460×330 popover 錨在選取節點**下方**：多行 LaTeX 輸入、placeholder「輸入或黏貼LaTeX公式在此處」、左「公式速查」、右橘 ➤、分隔線、灰「預覽區」KaTeX 即時渲染；➤ **取代**節點內容；2024+ chip「Σ LaTeX 公式 ｜ 智慧識別公式」；完整 LaTeX（矩陣、運算子、集合、箭頭、括號、化學） | `createFormulaDialog formula.js:317-411` 是置中 `<dialog>.showModal()`（`:404`；`phasec.css:271-283`）非錨定 popover；eyebrow「LATEX SUBSET」、placeholder `\frac{x^2}{\sqrt{y}}`、10 鍵 cheat 列、取消／插入；`createInsertFormulaCommand :95-126` 把 `⟦formula:…⟧` token **append** 進 node.text（`:110`）而非取代；渲染器是手刻子集（`LatexSubsetParser :156-242`：只 ^ _ {} \frac \sqrt ＋ ~45 個符號），其餘退回 monospace（`:86`、`phasec.css:488-495`）— 無矩陣／\sin／\lim／\left(／\operatorname；自製 CSS 數學樣式非 KaTeX | partial | P2 | M | `formula.js`、`phasec.css` | ⚠️ |
| A-14 | 公式速查表側欄 | 右側面板：搜尋「搜尋公式」、類別 chips Maths/Physics/Chemistry/Symbol（彩色）、虛線卡（標題＋渲染公式）；點擊複製 LaTeX 進 popover；空狀態吉祥物＋「查看更多」 | 只有 dialog 內 10 個泛用片段按鈕（`formula.js:58-69,349-363`、`phasec.css:384-405`）；無側欄／類別／搜尋／具名方程 | missing | P3 | M | `formula.js`、`phasec.css` | ⚠️ |
| A-15 | 智慧識別公式（OCR，Pro） | 下拉「智慧識別公式」把輸入變貼上／上傳區；toast「識別中...」；辨識出的 LaTeX 寫進輸入框並附縮圖 | 未實作（`formula.js` 無圖片輸入、無 OCR/AI hook） | missing | P3 | L | `formula.js` | ⚠️ |
| A-16 | 互鏈／Interlink（Pro） | ⊕ › Interlink popover（搜尋「Search files, nodes, or ideas…」、tabs All/File/Node/Ideas）；選後節點顯示雙重疊方框 glyph；點擊跳到檔案／節點 | 未實作：Insert menu 無互鏈；model 只有外部 `link`（`model.js:64,144`）且 `normalizeUrl` 只收 http(s) → 無法存內部引用；`js/store.js` 知道其他文件，本機 picker 可行 | missing | P3 | M | `attachments.js`、`model.js`、`store.js` | ⚠️ |
| A-17 | 影片／Video（2024-02） | Insert › 影片 →「上傳影片」modal（mp4/rmvb/mov/wmv、進度條、取消）；節點 ▶ 圓 glyph；點擊開深色置中播放器 | 未實作：無入口、無欄位、無播放器（`attachments.js:578-585`） | missing | P3 | L | `attachments.js`、`model.js` | ⚠️ |
| A-18 | 附件／Attachments（檔案，2026-02 Pro） | Insert › Attachment 上傳 PDF/DOC/DOCX/XLS/XLSX/PPT/PPTX/TXT/CSV（每節點 ≤10）；迴紋針 glyph 在文字後；popover 列表帶眼睛／垃圾桶；分屏文件檢視 | 未實作：`ATTACHMENT_FIELDS`（`attachments.js:14`）只有 notes/link/image/text/icons；`readImageFile :55-56` 拒非圖片；分屏（`splitscreen.js`）存在但未與節點附件綁；檔案儲存需 IndexedDB（圖片已因 localStorage 限 512KB，`:50-53`） | missing | P3 | L | `attachments.js`、`model.js`、`splitscreen.js`、`features.css` | ⚠️（attachments + io-share 合併） |
| A-19 | Illustrations（Icon 分頁第三個 pill） | 「Illustration」pill：每列 3、~80px 3D 風圖（Travel、Holiday…）；插入節點文字左側行內 ~48px | 未實作：`iconpanel.js:165` 只 圖示／貼紙；`assets/` 無 illustration 素材 | missing | P3 | L | `iconpanel.js`、`assets/` | ⚠️ |
| A-20 | Insert 選單的「浮水印」入口（Pro） | 2026 Insert 列「Watermark」（圖＋波紋 glyph＋Pro 徽章）作為畫布文字浮水印的額外入口 | 浮水印本體存在（`render.js:384-405`；Theme › Background 設定），但 Insert 選單無「浮水印」列（`attachments.js:578-585`） | missing | P3 | S | `attachments.js`、`render.js` | ⚠️ |

### 2.4 chrome-ux（外框介面）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| C-01 | 魔杖工具列鈕＝立即隨機主題＋toast | 魔杖（F6）立刻套用隨機主題並顯示綠色 toast「設置成功」 | `editor.html:34 #theme-button`（✦）綁 `openThemePanel`（`toolbar.js:50` → `sidepanel.js:77 showTab('theme')`）只開 Theme 分頁；隨機邏輯只在面板「一鍵搭配」（`sidepanel.js:258-263`）且無 toast；`applyTheme`（`keyboard.js:611-625`）不 toast；repo 無「設置成功」字串；F6 → `nextTheme` 順序循環是 `SPEC.md:18` 明訂；無測試 | divergent-behavior | P1 | S | `toolbar.js`、`sidepanel.js`、`keyboard.js`、`editor.html` | ✅（S-10 為同根的 P2 延伸：加權隨機、浮動魔杖、新檔隨機） |
| C-02 | 右側樣式面板隨選取節點滑入；無選取時空狀態 | 選取節點 → 面板在 Style 分頁開啟；無選取時 Style 分頁顯示吉祥物＋「需要先選中節點，才能調整樣式哦～」；~340px 白卡、tab 16px 文字＋2px 橘底線 | 面板**預設常開**：`editor.html:95 <aside id="sidepanel">` 無 `is-collapsed`，`main.js` 不加（`editor.css:284` 只在有 class 時隱藏；e2e reset `shortcuts.matrix.mjs:964` 得手動加）→ 桌面從載入起 Style 分頁永遠可見，所有控制項照常渲染（`sidepanel.js:86-124`）無空狀態（該字串只在 `docs/research/UI_VISUAL_NOTES.md:273`）；關閉後選取節點**不會重開**：`mindflow:selectionchange` 監聽（`sidepanel.js:75`）只 `refreshPanel()`；重開只靠 tab 鈕／Alt+Y／Ctrl+P／魔杖（開的是 Theme 而非 Style）／Alt+I／mobile 代理鈕；`refreshPanel`（`:462-505`）在 `primaryAppearance` 為 null 時所有控制項照常啟用；寬 326px（`editor.css:273`）、tab 12px（`:319`）；`SPEC.md:37` 已寫「選中節點或點魔杖開啟」 | divergent-behavior | P1 | S | `sidepanel.js`、`main.js`、`editor.html`、`editor.css` | ✅（style-theme P2「右側面板空狀態」併入） |
| C-03 | 工具列圖示與強調色 | 自訂線條 icon（~#666）、子／同級／父節點關係 glyph、油漆滾筒、方括 T、圓加號、交扣環、橘色星芒魔杖、螢幕＋播放、「AI」方框；active/hover 橘 #F67D28；深色 hover tooltip 帶說明 | `editor.html:26-36` 中央工具列是 Unicode 字元（↳ ＋ ↰ ▰ T ⊕ } ⌁ ✦ ▷ AI）；back/undo/redo 來自 `strings.js:34-39`（← ↶ ↷）經 `toolbar.js:23-30`；`editor.css:47-60` `.icon-button` 14px 粗體 #4b5563；hover（`:70-80`）#1f2937 on #f2f4f7；`--editor-orange`（`editor.css:3`）存在但主工具列無 active/hover 橘；tooltip 是原生 `title`（`toolbar.js:27,30`）；`features.css:191` 的深色 data-tooltip 只接在節點連結（`attachments.js:320`）；無 SVG、無說明式 tooltip | divergent-visual | P1 | M | `editor.html`、`editor.css`、`strings.js`、`toolbar.js` | ✅ |
| C-04 | 右下控制叢集（單一 pill） | 一條 32px bar：[心智圖 ▾ view-mode] ｜ 分隔 ｜ − ｜ % ｜ ＋ ｜ 分隔 ｜ 手 ｜ 全螢幕 ｜ 橘色眼睛（navigator／fit）；縮放 −/＋ 是 20px #F5F5F8 圓；眼睛 32×32 #F5F5F8 橘框 icon；2024 加 split-screen icon；focus／split／presentation 時隱藏；outline 模式縮成「Outline View ▾ ｜ ?」 | 兩個分離 pill：`.zoom-controls`（`editor.html:86-92`、`editor.css:231-265`）= [−][100%][＋][適應 文字鈕（`main.js:409`）][✋ 手（`viewport.js:122-137`）][⛶][⌖ minimap（`minimap.js:30-38`）] 無分隔、文字 glyph、無橘眼；`.viewmode-control` 另一個 pill 在 `right:316px`（`viewmode.js:198-233`、`layouts.css:72-92`）；無 split icon；focus（`editor.css:348`）與 presentation（`presentation.css:10`）有隱藏 ✓，但 split-screen 未隱藏（`phasec.css:605` 只移 #canvas）；outline 模式只移位（`layouts.css:157`）無「?」 | divergent-visual | P2 | M | `editor.html`、`editor.css`、`layouts.css`、`viewmode.js`、`minimap.js`、`main.js`、`viewport.js`、`phasec.css` | ⚠️（chrome-ux + views-modes 合併） |
| C-05 | 縮放百分比預設清單 | 點 % 標籤開 120px 卡（bar 上方）9 個預設 300/200/150/120/100/80/50/20/10 % | `main.js:414` 把 `#zoom-display` click 直接綁 `zoomReset`（100%）；無清單；clamp 0.2–4（`viewport.js:6-7`；SPEC §10 選 20–400%）vs GitMind 10–300% | missing | P2 | S | `main.js`、`viewport.js`、`editor.css` | ⚠️ |
| C-06 | 全螢幕（F11／按鈕）隱藏 chrome 並停用編輯 | 全螢幕時編輯 UI 隱藏、編輯停用，只能平移縮放 | `keyboard.js:943-946 toggleFullscreen()` 只呼叫 requestFullscreen/exitFullscreen；工具列、側欄、底欄仍在、所有編輯快捷鍵有效；e2e 只斷言瀏覽器 fullscreen flag（`shortcuts.matrix.mjs:445-449`） | divergent-behavior | P2 | S | `keyboard.js`、`editor.css` | ⚠️ |
| C-07 | AI 按鈕下拉 ＋ AI 功能整體 | 「AI」開 3 項選單 一鍵獲得答案／一鍵提出問題／一鍵生成心智圖（子選項 至少 3/5/8 個節點）；右側 Copilot 面板 ~430px（chat、「AI is editing…」、chips Replace/Insert as note/Insert as child）；儀表板 GitMind AI「Mind Mapping」modal（Prompt/Long Text/PDF-Doc/Website/Image、模型＋語言下拉、credits）；model picker；Idea Flow；2025 手機 AI 首頁 | `editor.html:36` title「AI（即將推出）」；`aiMenu` 未註冊 → `showComingSoon`（`keyboard.js:323-326,926-941`）；儀表板無 AI 卡（`index.html:34-50`）；無 Copilot／generator／model 設定；`SPEC.md:9,117` 延到 Phase D（「介面層先做，可設定 OpenAI-compatible API」）；SPEC §2 要求「AI（佔位選單）」 | missing | P2 | S（佔位選單）／L（真功能） | `keyboard.js`、`toolbar.js`、`editor.html`、`dashboard.js`、`index.html` | ⚠️（chrome-ux + io-share 合併） |
| C-08 | 分享按鈕 → 邀請協作者 modal | 橘色分享 pill 開 modal ~470×300「邀請協作者」：「Link sharing on」toggle、權限下拉 僅可查看／可編輯＋橘「複製連結」（https://gitmind.com/app/docs/{id}）、分享設置 checkbox「Anyone with the link can save」「Password: ****」（隨機 4 位、Change）；關閉時 toast「Collaboration function is closed」；Shift+Alt+O | `editor.html:40`＋`editor.css:118-128` 橘 pill 正確，`toolbar.js:53` 綁 `share` 但未註冊 → `showComingSoon` toast「此功能即將推出」；儀表板「我的分享」disabled「即將推出」（`index.html:73-76`）；無 Shift+Alt+O；`SPEC.md:9` 明訂延後協作後端；app 為 local-only（localStorage＋GitHub 私庫同步，`settings.js:1-29`） | missing | P2 | S（本機版：複製本機連結／唯讀匯出）／L（真後端） | `toolbar.js`、`keyboard.js`、`editor.html`、`index.html` | ⚠️（chrome-ux + io-share 合併） |
| C-09 | 節點右鍵選單：根節點變體、標籤、Split、情境項 | 非根：Insert parent／Insert node／Insert subnode／──／Select ›／Insert ›／Split／──／Copy／Paste／Delete／Delete selected node (Ctrl+Delete)；**根節點更短**：Insert subnode／Insert ›／──／Copy／Paste；繁中「分解」= Split（分支 → 新圖）；情境項 移除貼紙／移除連結／插入關係線／從當前節點演示 | `contextmenu.js:7-28` 單一 NODE_MENU 給所有節點含根（`:73-77` 不判根）→ 根顯示 添加上級／同級 與 刪除 但靜默 no-op（`keyboard.js:346-347,378-386`）；「分解（保留子節點）」接到 dissolve（Ctrl+Delete）— GitMind 的分解是 Split；無 Split、無獨立「刪除當前節點」標籤；「移除連結」常駐（不依 node.link）；Select › 只有 選擇目前節點／全選；Insert › 缺 關聯線／概要／公式；無 移除貼紙／插入關係線／從當前節點演示；卡片樣式 ✓（`features.css:398-441`） | divergent-behavior | P2 | S | `contextmenu.js`、`features.css` | ⚠️（editing + chrome-ux 合併） |
| C-10 | 摺疊／展開 expander（根可摺疊、圓形 glyph、計數、位置） | 根與主節點也能摺（根 expander 灰）；expander = r=7.5 圓、fill＝畫布底色、1px 分支色框、距節點邊 nodeHalfWidth+13、13px stub；展開態分支色減號，收起態只顯示 11px 摺疊計數（無加號）；hover 變灰並拉長 stub | `render.js:139-140` 明確跳過 depth 0（「根節點永遠不顯示摺疊鈕」）→ 根只能 Ctrl+/ 摺（`keyboard.js:435-438`）且無視覺可展開；收起文字 `+${count}`（`render.js:145`）；`node.css:70-96` 19px 白 pill、固定 #d1a27f 框／#9a4e19 字、±28px、無 stub、展開態 opacity:0 只 hover 顯示 | divergent-visual | P2 | M | `render.js`、`node.css`、`commands.js` | ⚠️（editing + chrome-ux 合併） |
| C-11 | 選取節點外觀、「···」快捷泡泡、關係／概要選取視覺 | 選取框 ~2px 淡橘（#FEA261 系）圓角矩形、偏移 ~3px、**跟隨節點 radius**、無角把手；~22px 白「···」圓（#AAAAAA 框、小尾巴）在節點右上於 select/hover 出現（hover 變 #FFA261）；marquee 1px #FEA261 ~8% 填；關係線選取 #FE5723＋箭頭＋橘空心方端點；概要藍 #0874B0＋黃色可拖範圍框 | `node.css:44-62` 2px #f17e2e outline inset -4px **固定 8px radius**（pill/circle/diamond 上會錯）＋4 個白／橘角方塊；無「···」泡泡（grep 只命中 `#more-button`）；marquee 1.5px #F17E2E 10% 填（`editor.css:203-210`）；關係／概要見 L-06／L-01 | divergent-visual | P2 | S | `node.css`、`editor.css`、`render.js` | ⚠️（editing + chrome-ux 合併；「···」泡泡與 A-11 評論相關） |
| C-12 | ··· More 選單：項目、順序、分組、設定、focus 退出位置 | 2024：Focus · Split screen ── Find & Replace · Version history · Reset layout · Save as copy ── Show comments [toggle] · Node overlap [toggle] · Hotkeys · Setting ── 「Comment: N Total nodes: N」；focus 退出是右上「退出」鈕 | `shortcuthelp.js:47-61`：專注／團隊協作（placeholder toast `:77`）／尋找與取代／歷史版本／一鍵整理／顯示評論／快速鍵／同步設定 GitHub＋footer；`toolbar.js:110-127` 把「分屏參考」插在歷史版本**後**（應為第 2）；缺 另存為副本／主題重疊 toggle／設定；無分隔線；focus 退出是右下深色 pill（`focus.js:19-26`、`editor.css:360-375`） | divergent-visual | P2 | S | `shortcuthelp.js`、`toolbar.js`、`focus.js`、`editor.css` | ⚠️（chrome-ux + views-modes 合併） |
| C-13 | 畫布右鍵 2025 新增項 ＋ 更多›「引入心智圖」 | 2025 加「Random theme 🪄」「Clear node text」「Personal Flow [New]」；「Unfold / Fold」單項；更多› 含「引入心智圖」（把另一張圖併入當前） | `contextmenu.js:30-46` CANVAS_MENU 是 2022 集合；更多› 是 專注模式／快速鍵／更多選項（`:41-45`）；匯入只在儀表板建新文件無合併 | missing | P3 | S（選單）／M（引入合併，見 I-07） | `contextmenu.js`、`themes.js`、`io/import.js` | ⚠️（editing + chrome-ux 合併） |
| C-14 | 導航器／minimap 面板視覺 | 191×136 在 right:0 bottom:54、無框無陰影、底＝畫布色、SVG 縮放 ~0.13 的真實地圖、viewport 指示 #ffa261 stroke 1、游標 move | `layouts.css:247-294` 218×138 在 right:18 bottom:66 帶框／圓角／陰影／白底；`minimap.js:81-126` 畫簡化 rect/line 代理非真圖；指示紅 #ef4444 stroke 1.5 半透明填；crosshair 游標；click-to-centre 是加項 | divergent-visual | P3 | S | `layouts.css`、`minimap.js` | ⚠️ |
| C-15 | 儲存狀態文案與 icon | 時鐘 icon＋「最近儲存 HH:MM」，暫態「⏳ 自動儲存所有內容」→「✔ 儲存成功」 | `toolbar.js:36,83-108`「已保存」／「已保存 HH:MM」／「變更未儲存…」／「⚠ 儲存失敗」無 icon（`editor.css:109-116` 灰 11px） | divergent-visual | P3 | S | `toolbar.js`、`editor.css` | ⚠️ |
| C-16 | 游標樣式 | 畫布 rest 為 auto、控制項 pointer、navigator 預覽 move | `editor.css:140-154`、`node.css:11` 畫布與節點 rest 用自訂手形 SVG 游標（`docs/CODEX_CURSOR_NOTES.md` 刻意）；minimap crosshair | divergent-visual | P3 | S | `editor.css`、`node.css`、`layouts.css` | ⚠️（含既有設計決策） |
| C-17 | 公開範本檢視器唯讀 chrome | 60px 白 header：home／返回／view-use-like-fav 計數／share／橘「使用範本」；右下只 − % ＋ 與眼睛 | 無唯讀檢視器；`dashboard.js:189-192` 範本格直接建新文件 | missing | P3 | M | `dashboard.js`、`templates.js` | ⚠️ |
| C-18 | 新節點編輯態與預設文字 | 新節點立刻進編輯且整段文字可見選取（藍 #1382F8 原生 selection、白字），預設「Topic branch N」遞增計數 | `edit.js:43-68`「arm」節點（contenteditable＋select-all）但 `node.css:119-127` 把 caret 與 ::selection 設透明 → 看不到選取（輸入仍會取代）；預設固定「新主題」（`strings.js:54`、`keyboard.js:331/338/348`）而初始圖用「分支主題」（`model.js:76-79`）；無計數 | divergent-visual | P3 | S | `edit.js`、`node.css`、`strings.js`、`keyboard.js` | ⚠️（editing） |
| C-19 | 拖曳移動的 drop 標記與 ghost | 標記是實心 #FEA260 圓角條 ≈40×12 畫在目標父節點連接線上的插入索引處；ghost ≈40% 不透明；原件降不透明 | `dnd.js:276-282`＋`editor.css:212-220` 畫 3px 橘線跨 hover 節點寬（rect.left-10…right+10）在上／下緣；child-drop 只 glow 父節點（`node.css:64-66`）— 無連接線上的條；ghost .7（`node.css:104-112`）、source .34（`:68`）；語意皆符合 | divergent-visual | P3 | S | `dnd.js`、`editor.css`、`node.css` | ⚠️（editing） |
| C-20 | 節點 DOM 結構（renderer 保真） | 整張圖是一個 SVG：g#branch-node-N（path shape＋foreignObject 文字）＋g#node-content-expander-N＋minder-* 容器群 | `render.js:121-156` 節點是絕對定位 HTML `<div class=mind-node>`（`#nodes-layer`）＋獨立 SVG `#connections-layer`（`editor.html:49-52`）；SPEC §10 明確允許 hybrid；只影響 DOM 級對齊／SVG export | divergent-visual | P3 | L | `render.js`、`editor.html` | ⚠️（editing；建議不做） |

### 2.5 views-modes（視圖與模式）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| V-01 | 大綱視圖：頁面版面 | 全寬文件編輯器：根 ~26-28px 粗標題、一級 14px 粗＋▾ 摺疊三角、更深 13px＋5px 圓點；hover 帶＋列尾評論 icon；中央工具列隱藏；底部 pill 縮成「Outline View ▾ ｜ ?」；可關閉的提示卡（Enter/Tab/Shift+Tab/Shift+Enter）帶 × | `outline.js:159-190` 每節點一個扁平 `.outline-row` 文字標記 ◆/●/○（`:177`）＋contenteditable；`layouts.css:230-240` 所有深度同 14px regular（無層級、無粗體、無三角、無 hover 帶／評論 icon）；header 是 sticky「大綱 · N 個節點」＋inline 提示（`outline.js:31-36`、`layouts.css:159-184`）非可關閉卡；無 CSS 在 `[data-view-mode="outline"]` 時隱藏 `.editor-toolbar`（只 `presentation.css:8`、`editor.css:346`）→ 13 顆工具列仍在；pill 只移位（`layouts.css:157`） | divergent-visual | P1 | M | `outline.js:30-39,152-190`、`layouts.css:130-245`、`editor.css:346-351` | ✅ |
| V-02 | 大綱視圖：Tab 鍵語意 | Tab = **當前列**增加縮排（成為前一同級的子）；Shift+Tab 減縮排；Enter 新同級；Shift+Enter 換行 | `outline.js:81-85` Tab → `insertChild(id)` → `commands.addChild` **新建**子節點並 focus；當前列不會重掛到前一同級（無「縮排當前列」路徑；header `:34` 寫「Tab 下級」）；Shift+Tab → `outdent`（`:123-132`）是真減縮排 → Tab/Shift+Tab 不對稱；Enter/Shift+Enter ✓；無 outline-row 鍵盤測試（所有 Tab case 都是畫布節點）。**注意** repo 研究自相矛盾：`docs/research/LAYOUTS.md:128` 引 GitMind 官方文字「Tab 添加下級節點」（＝MindFlow 現況），`LAYOUTS.md:136`／`SHORTCUTS.md:39` 寫「increase indent」 | divergent-behavior | P1 | S | `outline.js:64-86,108-132`、`commands.js` | ✅（但 GitMind 前提待人工確認，見 §4） |
| V-03 | 演示：投影片文法與動畫 | 序列：TITLE（根文字特大＋「Author: <name> YYYY / MM / DD」）→ OVERVIEW 一級文字格 → 每分支 BRANCH → LEAF 逐節點帶麵包屑「Parent ｜ Child」→ 結尾「Thank you for listening!」；fade+scale ~0.5s；無頁碼／進度條；預設深色星空背景 | `presentation.js:14-32 buildPresentationSteps` 每張圖：一個 root step＋每個一級分支一個 step（ids＝mapRoot＋整棵子樹）；`show()`（`:218-236`）保留即時畫布，用 `.is-presentation-visible/.is-presentation-muted`（`presentation.css:36-49`，muted opacity .045＋灰階）＋caption＋`viewport.fit()` 130px padding；無標題頁（codebase 無 author/date 字串）、無總覽格、無逐葉、無麵包屑、無結尾頁；多了頂部 caption（`presentation.css:59-71`）與底部進度點 pill（`:73-105`）；背景固定深藍 radial（`:26`）無星空、右鍵無「change background」（只 從當前節點開始／跳到結尾／退出演示 `:360-364` — 這三項符合）；轉場 180ms（`:37`）非 ~0.5s；`SPEC.md:87`、`PHASE_FINAL_BRIEF.md:27` 刻意規範 branch-focus 設計 | divergent-behavior | P1 | L | `presentation.js:14-32,204-247`、`presentation.css:1-105` | ✅（含 SPEC 決策；需 Owner 拍板重做或保留） |
| V-04 | 分屏：入口與右側 Home pane（＋文件檢視器、編輯器收縮） | 入口：右下 pill 雙 pane icon 或 ··· → Split screen；右 pane 是瀏覽器式 tab 條（Home／檔案 tab ×、＋、全域 ×）、「ESC to exit」chip、Home 內容（標題、「‹ Upload File」、大 drop zone「Choose a file or drag it here」pdf/doc/docx、最近檔案、「Open Web Page」）；PDF 用 Chromium 檢視器、DOC/DOCX 用 Word-web 式檢視器；分屏時左編輯器工具列縮成 6 顆、隱藏 Share/export/···與右下 pill；拖曳時畫布自動跟隨 | 唯一入口 ··· → 分屏參考（`toolbar.js:110-127`）→ `runAction('splitScreen')`（`splitscreen.js:33-37`）開 **modal** `<dialog>`（`:197-253`）URL 輸入＋「或」＋PDF picker；提交後單 iframe aside（`:40-71`，header「參考資料」＋另開視窗＋×）；無 pill icon、無 tab 條、無 drop zone／拖放、無最近清單、無 ESC chip；只收 PDF（`isPdfFile :25-28`、accept `.pdf` `:232`）無 Word 檢視器；`phasec.css:605-607` 只移 #canvas，工具列／Share／···／pill 全留；無 auto-follow；Esc 關閉（`:174-178`）與可拖分隔（`:156-173`）超出觀察 | partial | P1 | M | `splitscreen.js:30-253`、`toolbar.js:110-127`、`phasec.css:524-631` | ✅（views-modes ×2 + io-share 合併） |
| V-05 | 儀表板：檔案管理（資料夾、排序、檢視、多選） | Content header「New map」「New folder」「Import local file」；右側「MultiSelect」／「Time ASC ▾」／「Grid view ▾」；卡片右鍵 重命名／移動到／複製到／刪除；拖卡到資料夾；2024 加快速卡、list view 列帶 ···（Open/Share/Rename/Copy to/Move to/MultiSelect/Delete）；「···」含 Document encryption（Pro） | **無資料夾概念**（`store.js:29 emptyIndex = {docs, trash, favorites}`；`readIndex/writeIndex 51-117` 無 folder；js/css/tests 零命中 folder/資料夾/移動到/複製到）；content header（`index.html:94-101`）只 eyebrow＋heading＋描述＋計數；排序硬編碼 newest-first（`store.js:129`）；卡片選單（`dashboard.js:299-326`）開啟／重新命名／建立副本／加入收藏／移到回收筒；右鍵（`:264-269`）開同一 popover；無 dragstart/drop；側欄符合 2022-23 GitMind（`index.html:55-85`）；匯入鈕由 `initializeImportEntry`（`dashboard.js:489-527`）動態注入；無加密欄位（`store.js`）；`docs/research/UI_CHROME.md:298` 記錄了目標 header 控制項 | partial | P1 | L | `index.html:53-118`、`dashboard.js:149-168,226-326`、`store.js:29-115`、`css/dashboard.css` | ✅（io-share P3「文件加密／··· 選單」併入） |
| V-06 | 大綱視圖：拖曳列重排／改層 | hover 列後拖放到新位置／層級（2023-07-25） | `outline.js:41-62` 只有 focusin/click/dblclick/blur/keydown，無 pointer-drag；只能 Shift+Tab 改層或地圖上 Alt+↑/↓ | missing | P2 | M | `outline.js:41-62`、`dnd.js` | ⚠️（editing P3 + views-modes P2 合併） |
| V-07 | 演示：入口下拉、右鍵選單、背景、從當前節點演示 | 工具列 icon 開 2 項下拉「Display single node」／「Display subnodes」（單節點從選取起）；節點右鍵「從當前節點演示」在 分解 與 copy 群之間；演示中右鍵（白，5 列）「Change background」／「Set as default」／「From beginning」／「Skip to end」／「Exit ESC」；背景循環預設 | `editor.html:35 #presentation-button` → `toolbar.js:51` → `presentation.js:65 controller.enter()` 直接進入無選擇；`enter()`（`:109-121`）永遠從 index 0；NODE_MENU 無「從當前節點演示」；演示中選單 3 項（`:353-367`，深色半透明 `presentation.css:107-136`）缺 從頭開始／Change background／Set as default／ESC 提示；Esc 與視圖還原 ✓ | partial | P2 | M | `presentation.js:60-131,194-202,353-367`、`contextmenu.js:7-28`、`toolbar.js:51`、`presentation.css:107-136` | ⚠️（views-modes ×2 + chrome-ux 合併） |
| V-08 | 歷史版本：面板、手動具名版本、列 affordance | ~300-330px 右滑面板「Version history」；「Create (Input file name and click Add)」輸入＋橘 Add 存具名版本；兩行列（名稱／時間戳＋灰時間）新→舊；hover 灰帶＋眼睛／⟲ 圖示；空狀態「No data」；保留 7/30 天 | `history.js:42-83` 620px `.phasec-drawer`（`phasec.css:153-166`）分列表欄＋SVG 縮圖欄；無 Create/Add 具名輸入 — 只有自動快照（`store.js:527-544`，5 分鐘或 10% 節點變動門檻、上限 30 `store.js:19`）→ 短編輯爆發沒有可還原版本；列顯示 datetime＋「N 個節點」（`:125-129`）無自訂名、無眼睛；空文字「尚無歷史快照…」（`:109`）；入口 ··· ／畫布右鍵／Shift+Alt+H 皆有 | divergent-visual | P2 | M | `history.js:32-176`、`store.js:19-21,207-221,527-544`、`phasec.css:153-262` | ⚠️（views-modes + io-share 合併） |
| V-09 | 歷史版本：預覽與還原流程 | 眼睛 → 預覽模式：該版本渲染在畫布、灰化、工具列停用、頂部置中橫幅「You are browsing "…" history version ｜ Exit preview mode ｜ Restore」；Restore → 「Tips」modal「Are you sure… It will overwrite the current content」[Cancel][OK]；還原不可 undo | `history.js:88-101 select()` 在抽屜內顯示靜態 SVG 縮圖（`createDocumentThumbnail`）— 無畫布預覽／橫幅；`restore`（`:143-154`）無確認直接執行 `createRestoreSnapshotCommand`、先快照當前（`:147`）、toast「已還原歷史版本，可使用 Ctrl+Z 復原」— 可 undo（比 GitMind 安全，但流程／UI 不同） | divergent-behavior | P2 | M | `history.js:12-30,88-101,143-161` | ⚠️ |
| V-10 | 範本庫 | 頂部「Templates」帶橘「Hot」；**左側欄**搜尋＋類別樹（All Templates / MindMap›… / Flowchart›…）；4 欄格首卡虛線「+ New map」；卡＝縮圖＋名稱；hover 深色覆蓋＋置中橘「Use Template」；點擊開以範本命名的副本 | `index.html:34-37`「範本庫」鈕帶「16+」徽章（非 Hot）；`dashboard.js:201-214` 類別是水平按鈕列（`#template-categories`）— 無搜尋／樹／側欄；卡（`:347-382`）預覽＋類別 chip＋標題＋描述＋常駐「使用此範本」鈕（無 hover 覆蓋）；無虛線「+ New map」；8 個 TW 類別符合 2026（`templates.js:5-14`）；17 個心智圖範本、無流程圖；Use → 副本 → 開編輯器 ✓ | partial | P2 | M | `index.html:34-37,113-116`、`dashboard.js:189-214,347-382`、`templates.js:5-14`、`css/dashboard.css` | ⚠️ |
| V-11 | 資源回收筒 | header「🗑 Empty trash」「↺ Revert all」；表格 Name / Date deleted；右鍵列 → Undo 還原；從 My Mind 刪除立即（無確認） | 同一卡片格（`dashboard.js:154-168,226-282`）每卡「還原」／「永久刪除」（`:328-345`）＋「刪除於 <time>」；永久刪除有確認 `<dialog>`（`index.html:120-132`、`dashboard.js:464-474`）；缺 Empty trash／Revert all 批次、無表格、無右鍵 Undo；移到回收筒立即＋toast ✓ | partial | P2 | S | `dashboard.js:149-168,328-345,464-474`、`store.js:285-316`、`index.html:120-132` | ⚠️ |
| V-12 | 全域／全文搜尋 | 輸入＋Enter；結果頁 tabs All / Folders / Files（active 橘）、「Search results(N)」、列＝文件 icon＋標題（命中詞橘）＋摘要行（命中詞橘、以「;」結尾）＋meta「Owner:<name>」／「Type:Collaborated」／「Folder:」 | Topbar 搜尋（`index.html:39-46`）live-debounce 140ms（`dashboard.js:101-106`）、Ctrl+K focus（`:112-118`）；結果（`:170-187,384-426`）縮圖＋標題鈕＋「標題命中」徽章＋命中節點路徑清單（「a › b › c」）；引擎 `search.js:12-73` 匹配標題＋所有節點文字 ✓；缺 tabs、命中子字串橘色高亮、摘要／「;」格式、Owner meta | partial | P2 | M | `index.html:39-46`、`dashboard.js:101-118,170-187,384-426`、`search.js:12-73` | ⚠️ |
| V-13 | 大綱＋心智圖 合併視圖 | 右側白面板以**檔名**為 header＋× 關閉；左畫布可見；兩邊同鍵可編輯 | Split 模式存在（`viewmode.js:256-282`、`layouts.css:142-155`：outline pane 右、寬 min(420px,42vw)、畫布縮）且可編輯；header 固定「大綱」＋節點數（`outline.js:31-36`）非檔名；無 × 關閉 — 得重開模式下拉才能離開 | partial | P3 | S | `outline.js:30-39`、`viewmode.js:256-282`、`layouts.css:142-202` | ⚠️ |
| V-14 | 模式切換鈕 hover tooltip | 深色兩行 tooltip「Mode switcher / Switch between mind map & outline.」；下拉項 ~13px 灰字無 icon | `viewmode.js:203-224` `.viewmode-button` 無 title/tooltip；項目帶前置 glyph（⌘/☷/◫，`:212-216`）；其餘（標籤、上開、Ctrl+O）符合 | partial | P3 | S | `viewmode.js:198-233`、`layouts.css:72-128` | ⚠️ |
| V-15 | 專注模式：退出 affordance 與進入平移 | 進入時地圖短平移置中；無常駐 Exit 鈕 — 「Exit」在右上（推測 hover 出現）；Esc 退出 | `focus.js:19-26` 常駐「退出專注」pill 固定右下（`editor.css:360-379`）；`enter()`（`:39-49`）只切 body class＋focus 畫布、無置中；chrome 隱藏、··· 首項入口、Esc 皆符合 | divergent-visual | P3 | S | `focus.js:14-61`、`editor.css:346-379` | ⚠️ |
| V-16 | 手機編輯器 chrome、··· sheet、幻燈片入口 | 手機頂欄：‹ back ｜ AI planet ｜ 魔杖（Style）｜ outline toggle ｜ ···；··· 開每列 4 的 bottom-sheet 格：Undo, Redo, Save, Layout, Read, OCR, Slide show, Export, Share；右緣「›」抽屜 tab；右下 AI robot FAB；Slide show →「Display single node / subnodes」、橫向標題卡於 Starry Sky | `mobilechrome.js:83-128` 隱藏中央工具列（`mobile.css:90-92`）與 `#share-button`（`:98-102`），保留右上 匯出＋···（`editor.css:993-994`），加固定 6 鈕底欄 節點／復原／重做／插入／佈局／主題（`:92-99`）；無 bottom-sheet 格、無 Share、演示鈕在被隱藏的中央膠囊 → **手機無幻燈片入口**（`editor.html:35` vs `mobile.css:90`）；手機匯出重用桌面 dialog 2 欄（`editor.css:998-999`） | divergent-visual | P2 | M | `mobilechrome.js`、`mobile.css`、`presentation.js`、`editor.html` | ⚠️（io-share） |
| V-17 | 手機節點浮動工具列與 Format sheet | 點節點 → 上方浮動列：✎ Edit ｜ add-sibling ｜ add-child ｜ 🗑 Delete ｜ ⊕ Insert ｜ [T] Format ｜ ▶ more（Copy/Paste）；編輯時鍵盤 accessory strip；[T] 開 bottom sheet：Done ｜ ‹ Format ｜ Reset、B/I/U/S segmented、Size ˄28˅ stepper、Font color ›、Background color › | `touch.js:377-395 mountNodeActions` 只兩顆「＋子節點」／「＋同級」；Delete/Insert/Format/Copy/Paste 只能長按 → 右鍵選單（`touch.js:65-84`）；手機格式化重用桌面側抽屜（`mobilechrome.js:97-98`）與桌面文字工具列 — 無 bottom-sheet Format；手勢本身符合（pinch 0.2–4、長按、雙擊 `touch.js:3-8,47-84`） | partial | P3 | M | `touch.js`、`mobile.css`、`mobilechrome.js` | ⚠️（editing + io-share 合併） |

### 2.6 io-share（匯入匯出與分享）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| I-01 | 匯出對話框：標準分頁結構與格式清單（＋視覺） | 2024 ~480×570：segmented「Export ｜ HD export [Pro]」；標準分頁是單選 radio **8 列**：jpg／png 帶背景／png 透明／PDF／Word(docx)／Text(txt)／GitMind Project(gmind)／Bulleted list(txt, keywords for AI)；footer Cancel（灰 pill）＋Export（橘 pill）；摺疊節點匯出時自動展開；標題「匯出」＋提示「＊點擊「匯出」下載」；各格式彩色 icon（JPG 紫、PNG 橘、PDF 紅、WORD 藍、TXT 青） | `exportdialog.js:12-19` 6 格式（JPG/PNG/PDF/WORD/TXT/MINDFLOW）role=radio 卡 3 欄格（`:37-44`；`editor.css:870-874`）於 720px dialog（`editor.css:824`）；無 Export｜HD segmented：HD 是 checkbox（`:46`）在常駐選項列（`:45-50`）；PNG 透明是 checkbox（`:49`）非獨立列；無 Bulleted list；**摺疊節點不自動展開**：`documentToSvg` 只在 `options.includeCollapsedChildren` 時展開（`export.js:94`），`exportSelectedFormat` 只傳 `{margin, transparent}`（`:131-134`）；heading 是 eyebrow「匯出文件」＋h2「選擇匯出格式」無提示；icon 是全橘文字徽章（`editor.css:892-903`）；無 dialog 版面測試；此版面刻意依 `SPEC.md:100`／`UI_CHROME.md:213-224`（舊 6 卡）→ 修補需同步更新 spec | divergent-visual | P1 | M | `exportdialog.js`、`editor.css`、`io/export.js`、`docs/SPEC.md` | ✅（chrome-ux P2「匯出 modal 視覺」併入） |
| I-02 | 浮水印在匯出圖片中渲染（2025 export「Add Watermark」toggle） | 匯出 dialog「Add Watermark [Customize]」toggle；Style→Theme→Background 設定的浮水印（文字 ≤30、色、旋轉 L/R/H、透明度、大小）平鋪在匯出的 JPG/PNG；另有「Advanced Settings」摺疊與「Hide GitMind Branding」 | 面板有浮水印 UI（`sidepanel.js:141-147`、`applyWatermark :443-448`）但 `export.js documentToSvg`（`:87-155`）**從不讀 `doc.canvas.watermark`**、不輸出浮水印層 → JPG/PNG/PDF 靜默丟掉使用者設的浮水印；export dialog 無 watermark/branding toggle（`exportdialog.js:45-50`）；branding pill 對 clone 不適用 | missing | P1 | M | `io/export.js`、`exportdialog.js`、`sidepanel.js` | ✅ |
| I-03 | PDF 匯出產生真正的 .pdf 下載（GitMind 無 Print） | 「PDF file(pdf)」列直接觸發瀏覽器下載 PDF；心智圖編輯器**沒有**列印指令（官方：匯出 PDF 再列印） | `exportdialog.js:135-138`＋`openPrintWindow()`（`:180-202`）開新視窗放 SVG 並 `print()`；狀態「已開啟列印視窗」（`:101`）；使用者得手動「另存為 PDF」；popup blocker 會失敗（「瀏覽器已阻擋列印視窗」`:182`）→ 等於做了 GitMind 沒有的 Print，卻缺 PDF 下載；零依賴（`ARCHITECTURE.md:96`）→ 需最小客戶端 PDF writer 嵌入光柵化 JPEG | divergent-behavior | P1 | M | `exportdialog.js`、`io/export.js` | ✅ |
| I-04 | 匯入本機檔：入口、對話框、支援格式 | 儀表板「More +」卡 → 下拉（New folder / New Flowchart / New Whiteboard / Import local file）；2026「Local Import」modal ~770×740 虛線拖放區（「Click to [upload] or drag a file here」）、支援格式行、漸層「Confirm Import」；格式：Xmind, GitMind, AirMoreMind, Freemind, Mindmanager, Edrawmax, Opml, Html, Markdown, Mindmeister（圖片 jpg/png only） | `dashboard.js:489-527` 在「新增文檔」後注入側欄「匯入」鈕開原生 picker；accept `.mindflow,.json,.txt,.md`（`:501`）；`parseDashboardImport`（`:529-536`）只處理 .mindflow/.json/.txt/.md 並拋「只支援 .mindflow、.json、.txt、.md」；無拖放 modal；`io/import.js:1-31` 只 JSON/TXT/Markdown；XMind（zip）在零依賴下需自寫 inflate | partial | P1 | L | `dashboard.js`、`io/import.js`、`index.html`、`css/dashboard.css` | ✅ |
| I-05 | 匯出 HD 分頁（Pro） | 獨立「HD export」tab：Image format radio JPG｜PNG（JPG 預設）；「Transparent background No｜Yes」只在 PNG 時出現；「Keep original images No｜Yes」；「Margins (px)」stepper [−][80][+]；「Rendering scale」下拉預設 200%（列印建議 400%）；可中途取消（toast）；HD 限 JPG/PNG | 單一「HD 高畫質」checkbox 預設勾（`exportdialog.js:46`）＋純數字輸入 邊距（80，`:47`）／渲染比例（200 step 25，`:48`）；取消 HD 強制 margin 24 / scale 1（`:129-130`）；HD 內無 JPG/PNG radio、無「Keep original images」（節點圖片插入時一律重編碼 ≤1280px/512KB，`attachments.js:52-53,83-104`）、無 stepper／下拉、非圖片格式仍顯示選項、無中途取消（只狀態文字 `:93-107`） | partial | P2 | M | `exportdialog.js`、`editor.css` | ⚠️ |
| I-06 | Bulleted list（keywords for AI drawing）TXT 匯出 | 「Bulleted list(txt)」–「Keywords (For AI drawing)」列把節點關鍵字輸出成扁平 bullet 清單（2022-12） | 只有縮排大綱 TXT（`export.js:24-29`，2 空格／層＋跳脫 `:180-194`）與 Markdown（`:32-50`，測試可見但不在 dialog）；`EXPORT_FORMATS`（`exportdialog.js:12-19`）無關鍵字變體 | missing | P2 | S | `io/export.js`、`exportdialog.js` | ⚠️ |
| I-07 | 引入心智圖（merge 進當前圖）與 Split 分支成新檔 | 畫布右鍵 → More › 引入心智圖 開右側面板（搜尋＋檔案／資料夾清單＋「連結引入」）；選檔後把其節點拖進當前圖。節點右鍵 → 分解/Split 從子樹建新心智圖檔（toast「✓ Split successfully」、右側「Split map」列出新檔；原分支保留）；畫布右鍵 → More → Split map | `contextmenu.js:30-46` CANVAS_MENU 無 引入心智圖／Split；NODE_MENU `:23` 把 Ctrl+Delete dissolve 標成「分解（保留子節點）」— 與 GitMind Split 同字但語意是刪節點；無 merge-from-file、無 split-to-file；`store.js createDocument` 存在所以 Split 多為 plumbing | missing | P2 | M | `contextmenu.js`、`commands.js`、`store.js`、`io/import.js` | ⚠️（editing P3 + chrome-ux P3 + io-share P2 合併） |
| I-08 | 即時協作 presence | 協作者頭像堆在左上檔名 pill 下；遠端使用者在其編輯節點旁顯示彩色點＋名牌 pill；無人數上限 | 無協作傳輸；··· 顯示「團隊協作 即將推出」（`shortcuthelp.js:53,77`）；只有多分頁衝突偵測（`main.js:432-436` storage event、`:356-361` CAS banner）；`SPEC.md:9` 延後 | missing | P3 | L | `shortcuthelp.js`、`main.js` | ⚠️（明確 out of scope） |
| I-09 | 流程圖編輯器 I/O | 流程圖有自己的 Export modal（JPG/PNG/PNG透明/SVG/PDF/Visio、Margins 20、Quality 200%、Hide branding）、Share modal（URL＋Copy、FB/Twitter/Telegram、密碼、可存副本）、「Import Visio File」、「Page Setup」 | 完全無流程圖編輯器；`SPEC.md:9` 延到 Phase D（`:117`）；`js/` 無 flowchart/Visio/Mermaid | missing | P3 | L | `docs/SPEC.md`、`dashboard.js` | ⚠️（明確 out of scope） |
| I-10 | 自動儲存失敗 UX 與當機復原橫幅 | 頂部置中白 pill：「ⓘ Network error, auto-save failed [Retry]」→「auto-save retry failed [Save to your device]」＋modal（Save to your device / Leave without saving）；儲存中關閉：「Please hold on… A file is being saved」；當機重開：「ⓘ Unexpected exit detected… Check [Version History]」；檔名 pill「Recent save HH:MM」 | 狀態 pill ✓（`toolbar.js:83-108`）；失敗橫幅是全寬固定紅條只有「重試儲存」（`main.js:347-349,364-395`）— 無「Save to your device」（匯出）備援；多分頁衝突橫幅是加項（`:356-361`）；損毀檔復原用 `window.alert`（`:54-63`）而非指向歷史版本的橫幅；無 unexpected-exit 偵測；`beforeunload` 同步儲存（`:418`）→ 不需「please hold on」；完全離線可用（優於 GitMind） | partial | P3 | S | `main.js`、`toolbar.js` | ⚠️ |
| I-11 | 大綱視圖匯出受限清單 | Outline View 的匯出 modal 只 5 列：jpg、png (bg)、png (transparent)、PDF、Word — 無 TXT／gmind／bulleted | 所有視圖用同一 6 格式 dialog；`viewmode.js`／`outline.js` 無匯出 hook、`exportdialog.js:173-178 openDialog` 無視圖感知 → 大綱視圖可匯 TXT/MINDFLOW — 無害超集 | divergent-behavior | P3 | S | `exportdialog.js`、`viewmode.js` | ⚠️（建議不做） |

### 2.7 editing（僅列未併入他面向的殘餘項；其餘已併入上表）

| ID | Feature | GitMind | MindFlow 現況 | 類型 | 嚴重度 | 工作量 | 涉及檔案 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| E-01 | 跨心智圖複製／貼上與貼上格式選擇 | Ctrl+C 複製分支可貼到**另一張**心智圖；2023-05 起貼上可選「keep format」或「text only」；貼到根時新增分支並配新分支色 | `keyboard.js:135 this.clipboard = []` 是每頁記憶體陣列；`copy()/paste()`（`:491-511`）不碰 `navigator.clipboard` → 另一分頁／文件無法貼；無 keep-format/text-only 選擇；同文件內行為符合（`commands.js:198-225`） | partial | P2 | M | `keyboard.js`、`attachments.js` | ⚠️ |
| E-02 | Find & Replace 面板（視覺＋結果清單） | 右側 ≈330px 滑入面板「Find & Replace」：搜尋框（放大鏡＋ⓧ）、「Replace with」列附灰「Replace All」、**結果清單**列出每個命中節點並橘色高亮命中子字串、空狀態吉祥物「No content」、toast「✓ Replaced successfully.」 | `findreplace.js:186-203` 兩列 popup 固定 top:76px 置中 520px（`features.css:478-503`）只「1 / N」計數＋↑/↓ — 無清單、無標題、無空狀態；命中以整節點黃圈高亮（`features.css:502-503`）；replace-all toast「已取代 N 個節點」（`:179`）；搜尋／取代語意符合 | divergent-visual | P2 | M | `findreplace.js`、`features.css` | ⚠️ |
| E-03 | 懸浮節點預設外觀 | 預設文字「Floating node」；白底、1px 灰（#9AA0A6 系）框、~6px radius、深色 16px 字；其子節點用橘色分支色；選取橘框＋「···」泡 | `floating.js:33-38` shape `rounded-large`、文字「懸浮主題」；`render.js:59-68`／`layout.js:67-79` 當成獨立圖根（depth 0）→ 套主題 ROOT 樣式（大粗中心主題外觀）＋陰影＋move 游標（`features.css:465-469`）；子節點取 palette[0..]（`render.js:272-286`）非橘；建立入口全部可用 | divergent-visual | P2 | S | `floating.js`、`render.js`、`features.css` | ⚠️ |

---

## 3. 建議的並行實作分流（Codex 工作流）

### 3.0 共同規則（避免六條 stream 互踩）

1. **檔案所有權唯一**：每個檔案只屬於一條 stream；其他 stream 需要改到時，改成「在自己的模組內用 `registerAction()` 註冊 action」＋「請 owner stream 加一行 hook」。
2. **共用檔案的 append-only 協議**：
   - `js/editor/keyboard.js ACTION_BINDINGS`：owner = Stream F；其他 stream 只能提交「單行新增綁定」的 patch，由 F 合併。
   - `editor.html`：owner = Stream F；工具列新增按鈕（Boundary、To-do）由 F 一次加好，綁到尚未註冊的 action name（未註冊會自動落到 `showComingSoon`，這是既有行為，不會壞）。
   - `js/editor/model.js`：owner = Stream C；只允許 append 新欄位／新集合的 normalize，不改既有欄位語意。
   - `css/features.css`：**凍結**。除 Stream A 的 summary 區塊（`:32-81`）外，任何新 CSS 一律放新檔（`css/overlays.css`、`css/icons.css`、`css/outline.css`…），並由 F 在 `editor.html` 加一行 `<link>`。
   - `css/editor.css`：以區段切分 — sidepanel 區段（`:267-700`）歸 D、toolbar／zoom 區段歸 F、export dialog 區段（`:824-972`）歸 G。
3. **測試先行（紅→綠）**：每項先寫測試（單元 `tests/*.test.mjs` 或 E2E `tests/e2e/shortcuts.matrix.mjs` 新 case），確認**紅**、附截圖或輸出到 `docs/CODEX_<STREAM>_NOTES.md`，再實作到綠。既有「鎖住錯誤行為」的測試（如 `tests/layout.test.mjs:87-103`）要先改成新契約再翻紅。
4. **驗收由 Claude 審**：Codex 交付 = diff + 測試輸出 + NOTES；Claude 跑 `node --test tests/` 與 `node tests/e2e/shortcuts.matrix.mjs --project=chromium --filter='<stream 關鍵字>'`，再對照本表逐列打勾。
5. **與 SPEC 衝突的項目**（V-03 演示、S-09 格式刷、S-10/C-01 F6、I-01 匯出版面）：Codex 不得自行決定；先在 NOTES 提出「照 GitMind」與「照 SPEC」兩案，Owner 拍板後才寫測試。

### 3.1 第一批分流總覽

| Stream | 名稱 | Owned files | 第一批必做 | 第二批 |
|---|---|---|---|---|
| **A** | 概要 Summary（Owner 🔧 實作中） | `js/editor/summary.js`、`css/features.css` summary 區塊、`tests/summary-orientation.test.mjs`、新 `tests/summary-range.test.mjs` | O-a（實作中，不重規劃）→ L-00（P0）→ L-01 | L-08 |
| **B** | 佈局引擎與連接線 | `js/editor/layout.js`、`js/editor/render.js`（`getConnectionPath`／`createConnection`）、`js/editor/viewmode.js`、`css/layouts.css`、`tests/layout.test.mjs` | L-03、L-04、L-05 | L-02、L-09、S-03（renderer 部分）、S-05、S-06、L-10 |
| **C** | 覆蓋物：外框 Boundary＋關係線 | 新 `js/editor/boundary.js`、`js/editor/relations.js`、`js/editor/model.js`（append）、新 `css/overlays.css`、`js/io/export.js` 的 relation/boundary 輸出段、新 `tests/boundary.test.mjs` | L-06、L-07 | L-12、S-14（資料層） |
| **D** | 右側面板：樣式／主題／圖示庫 | `js/editor/sidepanel.js`、`js/editor/themes.js`、`js/editor/iconpanel.js`、`js/editor/main.js`（sidepanel 初始狀態）、`css/editor.css` sidepanel 區段、新 `css/icons.css` | C-02、A-02、A-01 | S-01、S-02、S-04、S-03（UI 部分）、S-07、S-11、S-12、A-06、A-07 |
| **E** | 附件與編輯互動 | `js/editor/attachments.js`、`js/editor/edit.js`、`js/editor/formula.js`、`js/editor/contextmenu.js`、`js/editor/floating.js`、`js/editor/findreplace.js`、新 `css/attachments.css` | A-03、A-04 | A-05、A-08、A-09、A-10、A-11、A-13、C-09、E-01、E-02、E-03、S-09 |
| **F** | Chrome 與視圖 | `editor.html`、`js/editor/toolbar.js`、`js/strings.js`、`js/editor/keyboard.js`（ACTION_BINDINGS）、`js/editor/outline.js`、`js/editor/presentation.js`、`js/editor/splitscreen.js`、`js/editor/shortcuthelp.js`、`css/editor.css` toolbar/zoom 區段、`css/presentation.css`、`css/phasec.css`、新 `css/outline.css` | C-01、V-02、V-01 | C-03、V-03（待拍板）、V-04、V-07、C-04、C-05、C-06、C-12、S-08、S-15 |
| **G** | IO 與儀表板 | `js/editor/exportdialog.js`、`js/io/export.js`（除 C 的 overlay 段）、`js/io/import.js`、新 `js/io/pdf.js`、`js/dashboard.js`、`js/store.js`、`index.html`、`css/dashboard.css`、`css/editor.css` export 區段、`tests/io.test.mjs` | I-03、I-02 | I-01、I-04、V-05、I-05、I-06、I-07、V-08、V-09、V-10、V-11、V-12 |

> 7 條看起來多於「4–6」，但 A 是 Owner 已在跑的 stream，實際新開 6 條（B–G）。若人力只有 4 條，合併順序：C 併入 A（都是 overlay，等 O-a 落地後接手）、G 併入 F。

### 3.2 各 stream 細節

#### Stream A — 概要 Summary（🔧 實作中）

- **狀態**：O-a 由 Owner 依測試先行實作中，本報告不重新規劃、不改其測試。
- **排隊項**（O-a merge 後才開工，同一 worker）：
  1. **L-00（P0）範圍涵蓋子樹／允許單節點／自動編號**
     - 過關：選取「分支 A」（含 3 個子節點）→ Ctrl+Alt+T → 括號垂直範圍涵蓋 A 與其所有後代的 bbox、水平位置在最右後代外側 ≥10px；只選一個葉節點 → 仍能建立概要；連續建立兩個概要 → 文字為「概要 1」「概要 2」。
     - 不過關：括號與任何後代節點 bbox 相交；單節點被拒絕並 toast；第二個概要仍叫「概要」。
     - 測試：`tests/summary-range.test.mjs`（純幾何：給 positions 算 `summaryGeometry`）＋ E2E case「概要/單節點」「概要/含子樹」。
  2. **L-01 選取態＋範圍把手**
     - 過關：點選概要 → 出現橘色圓角矩形框住被概括範圍＋上下中點兩個橘色方形把手；按住下把手往下拖過下一個同級節點的中線 → 括號、矩形、概要節點**在拖曳中**同步延伸；放開後 `doc.summaries[i].range` 多含一個節點。
     - 不過關：拖曳中只有把手移動、括號不動；把手是圓形／黃色；放開才跳。
     - 測試：E2E「概要/拖把手即時延伸」（在 pointermove 中斷言 bracket path 的 bbox 高度已變）。
- **驗收**：`node --test tests/summary-*.test.mjs` 全綠；E2E `--filter='概要'` 全 PASS；截圖對照 `docs/research/UI_VISUAL_NOTES.md` 的概要選取態描述。

#### Stream B — 佈局引擎與連接線

- **Owned**：`layout.js`、`render.js`（連接線相關函式）、`viewmode.js`、`css/layouts.css`、`tests/layout.test.mjs`。
- **第一批必做**：
  1. **L-03 時間軸**：一級節點在主軸上、子清單懸掛、加入連續主軸元素；補齊 4 變體並讓 `timeline-v` 進白名單（`model.js:8-16`、`io/import.js:11` — 請 C stream append；`keyboard.js:781` — 請 F append）。
     - 過關：根＋3 個一級、各含 2 子；套用 timeline-h → 3 個一級節點的中心 y **相等**且＝根中心 y；每個一級的子節點 x 相等、y 遞增在其下方；SVG 中存在一條從根右緣到最後一個一級節點的連續 path（`data-role="spine"`）。
     - 不過關：一級節點 y 交替上下；子節點也交替；無 spine 元素。
     - 測試：先把 `tests/layout.test.mjs:87-103` 改成新契約（翻紅），新增 4 變體各 1 個幾何斷言；E2E「佈局/時間軸 spine 存在」。
  2. **L-04 目錄組織圖**：一級橫排在正交 bus 下、二級起縮排目錄。
     - 過關：一級節點 y 相等、x 遞增；二級節點 x ＝ 父 x＋固定縮排、y 在父下方遞增；連接線為父左側垂直線＋水平 tick。
     - 不過關：一級節點 y 遞增（整張圖一條長列）。
  3. **L-05 魚骨頭圖**：加主脊、一級在斜骨外端、二級沿骨附著、頭左／頭右兩變體。
     - 過關：存在水平 spine path；一級節點交替在 spine 上／下且與 spine 之間有斜線；二級節點沿該斜線排列（其中心到斜線的距離 < 節點高／2）；`fishbone-left`／`fishbone-right` 兩張卡都能選且根位置左右對調。
     - 不過關：無 spine；二級也扇開；只有一種頭向。
- **第二批**：L-02（6 家族 × 31 縮圖，需先有 brace/bracket/rounded-elbow/fan renderer）、L-09、S-03 renderer（10 種形狀＋依佈局過濾）、S-05 漸細、S-06 dash、L-10 真實 gap。
- **驗收**：`node --test tests/layout.test.mjs`；E2E `--filter='佈局'`；每個家族各出一張 PNG 放 `docs/CODEX_LAYOUT_NOTES.md` 供人工比對 GitMind 縮圖。

#### Stream C — 覆蓋物：Boundary 外框＋關係線

- **Owned**：新 `boundary.js`、`relations.js`、`model.js`（append `boundaries[]` normalize）、新 `css/overlays.css`、`io/export.js` 的 relation/boundary 段、新 `tests/boundary.test.mjs`。
- **第一批必做**：
  1. **L-06 關係線預設外觀**（S）
     - 過關：F4 → 點目標 → 產生的 path stroke 為藍色（與主題 relLine 色一致，預設 #3982fc）、2px、dasharray；path 帶 `marker-end` 指向目標且 `<defs>` 內有三角 marker；SVG export 中同一條線顏色／dash／箭頭與畫布一致。
     - 不過關：橘色；無 marker-end；export 顏色不同。
     - 測試：`tests/delta.test.mjs` 新增 relation 預設樣式斷言；`tests/io.test.mjs` 斷言 export SVG 含 `<marker`；E2E「關係線/箭頭存在」。
  2. **L-07 Boundary**（L）— 順序：model → renderer → action → 樣式控制。
     - 過關：選取有 2 個子節點的節點 → Ctrl+Alt+B（或工具列 ▢）→ 出現圓角虛線矩形，其 bbox 包含該節點與所有後代 bbox 外擴 ~20px；頂邊有可編輯備註帶；點選外框 → 橘色選取＋右上把手；拖把手到相鄰同級 → range 擴大；Style 分頁出現「外框樣式」「外框邊框」列（由 D 提供容器、C 提供內容）；Delete 可刪；Ctrl+Z 可復原；存檔重開後仍在。
     - 不過關：快捷鍵無反應／toast 即將推出；矩形不含後代；刷新後消失。
     - 測試：`tests/boundary.test.mjs`（幾何＋command undo）；E2E「外框/Ctrl+Alt+B 建立」「外框/Delete 移除」「外框/重新載入保留」。
     - 依賴：F 在 `editor.html` 加 `#boundary-button`（action `insertBoundary`）與 `keyboard.js` 加一行 `Ctrl+Alt+B`；D 在 Style 分頁留 `[data-section="boundary"]` 掛點。
- **第二批**：L-12 關係線把手／專屬區段／形狀、S-14 主題資料模型槽位（relLine／summary／boundary 色進 theme）。
- **驗收**：`node --test tests/boundary.test.mjs tests/delta.test.mjs tests/io.test.mjs`；E2E `--filter='外框|關係線'`。

#### Stream D — 右側面板：樣式／主題／圖示庫

- **Owned**：`sidepanel.js`、`themes.js`、`iconpanel.js`、`main.js`（sidepanel 初始狀態那幾行）、`css/editor.css` sidepanel 區段、新 `css/icons.css`。
- **第一批必做**：
  1. **C-02 面板隨選取開啟＋空狀態**（S）
     - 過關：載入頁面 → 側欄 **collapsed**；點一個節點 → 側欄滑入且 active tab 為「樣式」；點 × 關閉 → 再點另一節點 → 再度滑入；Esc 清空選取後切到樣式分頁 → 顯示吉祥物＋「需要先選中節點，才能調整樣式哦～」且無任何樣式控制項；Ctrl+P／魔杖仍開主題分頁。
     - 不過關：載入即開；關閉後選節點不開；無選取時控制項照常可點。
     - 測試：E2E「面板/選取自動開啟」「面板/空狀態」；同時把 `tests/e2e/shortcuts.matrix.mjs:964` 手動加 `is-collapsed` 的 reset 移除。
  2. **A-02 圖示行內渲染**（M）
     - 過關：Ctrl+1 → 節點內文字**左側**出現 ~18px 圓形徽章、與文字同一行、間距 ~6px；再加旗幟 → 兩個徽章左→右排；節點寬度增加、高度不變；`layout.js` 量測含圖示寬（需與 B 協調：D 在 measureFn 回傳含 icon 寬度，B 不改）。
     - 不過關：徽章浮在節點框上方；節點寬度不變導致重疊。
     - 測試：E2E「圖示/行內位置」（斷言 icon 的 bbox.top ≥ node.bbox.top 且 icon.right < text.left）。
  3. **A-01 圖示庫**（M）：優先級 10 色照 GitMind hex、進度 −/8 餅/✓、加 星星／頭像／箭頭／月份／星期、符號 48、每列 8、子分頁加 Illustration 佔位。
     - 過關：Alt+I → 面板列出 9 個類別區段；優先級 1 的圓為 #E5453B；Ctrl+0 不觸發、Ctrl+1…9 對應 1–9 且面板可點到 10。
     - 測試：`tests/iconpanel.test.mjs`（新）斷言類別／數量／色值；E2E「圖示/類別數」。
- **第二批**：S-01 彩虹調色盤（需 model append `paletteId` — 請 C）、S-02 主題目錄擴充（先做分頁器＋去名稱，再逐批加主題）、S-04 形狀下拉呈現、S-03 UI 列（消費 B 匯出的 `CONNECTOR_SHAPES`）、S-07 色盤、S-11、S-12、A-06 節點內圖示可點移除、A-07 貼紙面板／共存。
- **驗收**：`node --test tests/iconpanel.test.mjs`；E2E `--filter='面板|圖示'`。

#### Stream E — 附件與編輯互動

- **Owned**：`attachments.js`、`edit.js`、`formula.js`、`contextmenu.js`、`floating.js`、`findreplace.js`、新 `css/attachments.css`（把 `features.css` 的 link/note/image 規則搬過來，features.css 對應行改成註解指向新檔——這是唯一允許的 features.css 刪改，且需 A 知會）。
- **第一批必做**：
  1. **A-03 超連結對話框語意**（S）
     - 過關：Ctrl+Alt+K → 標題「連結」、欄位「連結位址」「提示文字」、按鈕 取消／確定；填 URL＋提示文字「官網」→ 確定 → 節點文字**不變**、hover 鏈條 glyph 顯示「官網(https://…)」；model 存 `link: {url, title}`（或 `link` + `linkTitle`，由 C append normalize 並向下相容舊字串）。
     - 不過關：節點文字被改成「官網」；重開後提示文字遺失。
     - 測試：`tests/core.test.mjs` 新增 link normalize 相容測試；E2E「連結/提示文字不覆寫」。
  2. **A-04 節點指示／tooltip／編輯中貼 URL**（S）
     - 過關：有連結的節點在文字**右側同一行**出現 ~16px 鏈條 glyph；hover 出灰色 tooltip「Text(URL)」；雙擊節點進編輯 → Ctrl+V 貼「https://example.com」→ 節點文字變 URL 且附連結 glyph。
     - 不過關：glyph 在右上角外；編輯中貼上只是純文字。
     - 測試：E2E「連結/行內 glyph」「連結/編輯中貼 URL」。
- **第二批**：A-05 Insert 選單、A-08／A-09 圖片對話框與 8 把手、A-10 備註即時、A-11 本機評論串（含「···」泡泡＝C-11 的一半）、A-13 公式 popover＋取代語意、C-09 根節點選單變體、E-01 跨文件剪貼簿（`navigator.clipboard` 帶 MIME）、E-02 尋找取代清單、E-03 懸浮節點外觀、S-09 格式刷（待拍板）。
- **驗收**：`node --test tests/core.test.mjs`；E2E `--filter='連結|附件|貼上'`。

#### Stream F — Chrome 與視圖

- **Owned**：`editor.html`、`toolbar.js`、`strings.js`、`keyboard.js`（ACTION_BINDINGS 表）、`outline.js`、`presentation.js`、`splitscreen.js`、`shortcuthelp.js`、`css/editor.css` toolbar/zoom 區段、`css/presentation.css`、`css/phasec.css`、新 `css/outline.css`。
- **第一批必做**：
  1. **C-01 魔杖＝隨機主題＋toast**（S）
     - 過關：點工具列 ✦ → 主題立即改變（≠ 前一個）且 toast「設置成功」；Ctrl+P 仍開主題分頁；F6 維持 SPEC 的循環（除非 Owner 拍板改隨機）。
     - 不過關：點 ✦ 只開面板。
     - 測試：E2E「魔杖/隨機主題 toast」（斷言 `doc.themeId` 變且 toast 文字存在）。
  2. **V-02 大綱 Tab 語意**（S；**先做 §4 的人工確認**）
     - 過關（若 GitMind＝縮排）：在大綱第 2 列按 Tab → 該列成為第 1 列的子（node.parent 改變、無新節點）；Shift+Tab 反向；Enter 新同級。
     - 不過關：Tab 新建子節點。
     - 測試：`tests/core.test.mjs` 新增 outline indent command 測試；E2E「大綱/Tab 縮排」（新 case，現無任何 outline-row 鍵盤 case）。
  3. **V-01 大綱版面**（M）
     - 過關：切到大綱 → `.editor-toolbar` 不可見；根列 font-size ≥ 26px 粗體；一級列 14px 粗體帶 ▾；深層列 13px 帶圓點；hover 列出現底色帶；提示卡可點 × 關閉且重整後不再出現（localStorage）；底部 pill 顯示「大綱視圖 ▾ ｜ ?」。
     - 不過關：工具列仍在；所有列同字級。
     - 測試：E2E「大綱/工具列隱藏」「大綱/層級字級」。
  - 同時代其他 stream 加：`#boundary-button`（C）、`Ctrl+Alt+B`、`Shift+Delete`、`Ctrl+= / Ctrl+-`（S-15 順手）、`timeline-v` 進 `keyboard.js:781` allowlist（B）。
- **第二批**：C-03 SVG 工具列 icon＋橘色 active＋說明 tooltip、V-03 演示文法（待拍板）、V-04 分屏 Home pane／DOC 檢視／工具列收縮、V-07 演示入口下拉＋選單、C-04 單一 pill、C-05 縮放預設、C-06 全螢幕唯讀、C-12 ··· 分組、S-08 文字工具列停靠、S-15 其餘快捷鍵。
- **驗收**：E2E `--filter='魔杖|大綱|演示|分屏'`；全套 `node tests/e2e/shortcuts.matrix.mjs --project=chromium` 不得有既有 case 翻紅。

#### Stream G — IO 與儀表板

- **Owned**：`exportdialog.js`、`io/export.js`（overlay 段除外）、`io/import.js`、新 `io/pdf.js`、`dashboard.js`、`store.js`、`index.html`、`css/dashboard.css`、`css/editor.css` export 區段、`tests/io.test.mjs`。
- **第一批必做**：
  1. **I-03 真正的 PDF 下載**（M）
     - 過關：匯出 dialog 選 PDF → 匯出 → 觸發 `<a download="xxx.pdf">` 且 blob 前 5 bytes 為 `%PDF-`、可被 Chromium PDF viewer 開啟顯示整張圖；不開新視窗、不呼叫 `print()`；popup blocker 開啟時仍成功。
     - 不過關：開列印視窗；檔案不是 PDF。
     - 測試：`tests/io.test.mjs` 新增 `createPdfFromJpeg()` 產出 header/xref 結構斷言（零依賴：一頁、一張 DCTDecode 影像）；E2E「匯出/PDF 下載」攔截 download 事件。
  2. **I-02 浮水印進匯出**（M）
     - 過關：主題 › 背景 開浮水印「機密」→ 匯出 PNG → 影像中平鋪出旋轉文字（測試：export SVG 字串含 `<pattern` 且含「機密」）；dialog 有「加入浮水印」toggle，關閉時不含。
     - 不過關：匯出 SVG 無浮水印層。
     - 測試：`tests/io.test.mjs`「documentToSvg 含 watermark pattern」。
- **第二批**：I-01 8 列 radio＋Export｜HD segmented＋自動展開摺疊（同步改 `SPEC.md:100`）、I-04 匯入 modal＋OPML/FreeMind/HTML/MindMeister/XMind（XMind 需 `io/inflate.js`）、V-05 資料夾／排序／檢視／多選（store index 加 `folders`）、I-05、I-06、I-07（Split 到新檔＋引入合併）、V-08／V-09 歷史版本具名＋確認 modal、V-10 範本側欄、V-11 回收筒批次、V-12 搜尋高亮。
- **驗收**：`node --test tests/io.test.mjs tests/store-search.test.mjs`；E2E `--filter='匯出|匯入'`；人工開匯出的 PDF／PNG 各一次。

### 3.3 第一批合併順序建議

1. 先 commit O-b（右鍵框選，已完成）。
2. A（O-a）與 C（L-06 關係線，S）、D（C-02，S）、F（C-01，S）、E（A-03，S）四個 S 項同日可 merge — 互不碰檔。
3. B（L-03/04/05）與 G（I-03/I-02）為 M 級，第 2–3 天 merge。
4. C 的 L-07 Boundary 最後 merge（需要 F 的 editor.html hook 與 D 的 Style 分頁掛點先進）。

---

## 4. 未知／需人工看官方 UI 確認

輸入的 UNKNOWNS 欄位為空，以下是各面向 refuter 在描述中標記「待確認」或**多份研究互相矛盾**的項目：

| # | 面向 | 疑點 | 影響的 ID | 建議確認方式 |
|---|---|---|---|---|
| 1 | views-modes | 大綱 Tab 到底是「縮排當前列」還是「新增下級」：`docs/research/LAYOUTS.md:128` 引官方文字「Tab 添加下級節點」，`LAYOUTS.md:136`／`SHORTCUTS.md:39` 寫 increase indent | V-02 | 登入 GitMind 開大綱視圖，在第 2 列按 Tab 看是否新增節點 |
| 2 | layouts-summary / chrome-ux | 概要括號預設顏色：L-01 說選取態橘 #F17E2E，L-08 說預設括號＝主題 accent 藍、C-11 說 #0874B0 | L-01、L-08、S-14 | 截 GitMind 預設主題下未選取／選取的概要各一張 |
| 3 | layouts-summary / style-theme / chrome-ux | 關係線預設色：#3B7BFF、#3982fc、#FE5723（選取）三種說法 | L-06、L-12 | 同上；並確認 marker-start 是否真有「line」型 |
| 4 | style-theme | Shape 集合中的 arc-roof-rect／arc-sides-rect／flat-hexagon／roof-hexagon 是否真的存在（repo 研究只記 10 種傳統形狀）；根節點是否隱藏 underline | S-04 | 開 Style › Shape 下拉截圖 |
| 5 | layouts-summary | 時間軸 4 變體與目錄組織圖 3 變體的精確幾何（哪些是 bus／elbow／交替） | L-03、L-04、L-02 | 在 Layout 分頁每張縮圖套一次並截圖 |
| 6 | style-theme | 主題總數 92 是哪個地區／方案看到的；Pro/VIP 徽章規則 | S-02 | 未登入 vs 登入各數一次 |
| 7 | style-theme | 節點間距分層預設 50/30/20 與 min -30／2 的依據；「All peers」語意 | L-10 | 開 Style 分頁把三個層級各拉一次看數值 |
| 8 | attachments | 圖示格「8 per row on 32px grid」與優先級 7–10 的確切 hex | A-01 | DevTools 讀 CSS |
| 9 | attachments | 超連結 tooltip 是否真的是「Text(URL)」格式；提示文字是否影響任何非 hover 行為 | A-03、A-04 | 建一條有提示文字的連結截圖 |
| 10 | io-share | 匯出 dialog 是 2022 六卡還是 2024 八列（repo SPEC 跟舊版）；Owner 要對齊哪一代 | I-01、I-05 | Owner 拍板目標世代 |
| 11 | views-modes | 演示標題頁「Author: <name>」在未登入／本機時顯示什麼；是否要複刻 | V-03 | Owner 拍板保留 SPEC branch-focus 或改 GitMind 文法 |
| 12 | chrome-ux | Boundary 的把手在右上角還是上下中點（與概要不同？）；備註帶是否預設顯示 | L-07 | 建一個外框截圖 |
| 13 | style-theme | F6／魔杖加權隨機的 35/35/20/10 分組來源；「Random theme」設定是否影響範本建立 | C-01、S-10 | Owner 拍板 F6 是否從循環改隨機 |
| 14 | editing | 格式刷 sticky 模式是否在所有版本都如此（SPEC 決定 single-shot） | S-09 | Owner 拍板 |
| 15 | views-modes | 專注模式的「Exit」到底是 hover 出現還是常駐 | V-15 | 進專注模式截圖 |
| 16 | attachments | Illustration 子分頁是否所有帳號可見 | A-19 | 未登入檢查 |

---

## 5. 自首：資料來源與可信度限制

1. **GitMind 側描述的來源混雜世代**：`docs/research/*.md` 混用 2022–2026 各代截圖、changelog 與 LIVE_DOM_FACTS；同一功能在不同世代長得不一樣（Insert 選單、匯出 dialog、儀表板、More 選單），本表盡量標註年份但無法保證每列都對到同一代。Owner 需先定「目標世代」，否則 P2 裡有些「缺口」其實是「對齊到不同版本」。
2. **只有 P1 經過對抗驗證**：每個 P1 各派 1 名 refuter 重讀原始碼；結果有 2 項被明顯削弱（S-04 形狀集合說法不成立、V-02 GitMind 前提有矛盾）。**P2／P3 全部未經反駁**，file:line 是盤點者一次讀碼的結果，可能有：行號漂移、把「未接線」誤判成「未實作」、或漏掉透過 registry 動態註冊的行為。實作前請先 grep 重驗。
3. **file:line 基準是含未 commit 變更的 working tree**：`selection.js`／`viewport.js`／`contextmenu.js` 的行號在 commit 後可能變動；其他檔案若 Owner 同時在改（summary.js），行號亦會漂。
4. **工作量估計是粗估**：S/M/L 依單人 Codex＋測試先行估，不含 Owner 拍板等待、不含跨 stream 依賴排隊（例如 L-07 要等 F/D 的 hook）。L-02 與 S-02 這類「量」的工作可能被低估。
5. **部分「缺口」是 SPEC 的刻意決策**：V-03 演示、S-09 格式刷、S-10/C-01 F6、I-01 匯出版面、C-16 游標、C-20 hybrid DOM、I-08/I-09 協作與流程圖。這些列在表裡是為了完整，不代表建議修；已在驗證欄標註「含 SPEC 決策」。
6. **Pro／付費功能未分開計數**：A-15、A-16、A-18、A-19、S-13、I-05 等在 GitMind 是付費功能；clone 是否要做由 Owner 決定。
7. **去重是人工判斷**：141 → 103 的合併以「同一使用者可感知功能」為準；若 Owner 偏好按檔案切分，某些合併列（如 L-10、S-08、A-11）會再拆開。
8. **未實際跑過任何測試或開過 GitMind**：本檔純粹整合各面向的文字報告與 refuter 結論；E2E「PASS」是引用 `docs/CODEX_RIGHT_DRAG_NOTES.md` 與各面向的自述，不是本次重跑。
