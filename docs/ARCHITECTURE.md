# MindFlow — 架構文件（GitMind 功能複刻）

> 本文件由主 session（Claude）撰寫與維護，是 Codex 實作的最高依據。
> 產品名稱用 MindFlow（避免使用 GitMind 商標），但功能、UI 佈局、快捷鍵、主題全面對齊 GitMind。

## 技術決策

- **純前端 Web App**：Vanilla JavaScript (ES2022 modules) + HTML + CSS。**不用框架、不用打包器、不用任何 npm runtime 依賴**。
  - 理由：GitMind 本體就是 Web 應用；零依賴 = 零建置失敗風險，`npx serve` 或任何靜態伺服器即可跑。
- **渲染方式**：節點 = 絕對定位的 HTML div（放在一個受 CSS transform 控制的容器內，實現 pan/zoom）；連接線 = 同一 transform 容器內的 SVG 底層。文字編輯用 contenteditable。
- **狀態管理**：單一 document state + Command Pattern（每個修改都是一個 command 物件，支援 undo/redo）。
- **持久化**：localStorage 自動存檔（多文件），之後加 JSON 檔匯出/匯入。
- **i18n**：所有 UI 字串集中在 `js/strings.js`，預設繁體中文。

## 目錄結構

```
gitmind-clone/
├── index.html          # 首頁儀表板（我的導圖：文件列表/新建/範本）
├── editor.html         # 編輯器頁（?id=<docId>）
├── css/
│   ├── base.css        # reset、變數、共用
│   ├── dashboard.css
│   ├── editor.css      # 編輯器 chrome（工具列、面板）
│   └── node.css        # 節點/連線視覺
├── js/
│   ├── strings.js      # UI 字串（繁中）
│   ├── store.js        # localStorage 文件庫（list/create/load/save/delete/rename）
│   ├── dashboard.js    # 首頁邏輯
│   ├── editor/
│   │   ├── main.js     # 編輯器組裝入口
│   │   ├── model.js    # 資料模型 + 序列化
│   │   ├── commands.js # Command Pattern + undo/redo stacks
│   │   ├── layout.js   # 佈局引擎（座標計算，純函數）
│   │   ├── render.js   # DOM/SVG 渲染（依 model+layout 全量/增量重繪）
│   │   ├── viewport.js # 畫布 pan/zoom/fit/縮放控制
│   │   ├── selection.js# 單選/多選/框選
│   │   ├── keyboard.js # 全部快捷鍵綁定（集中一處）
│   │   ├── dnd.js      # 節點拖曳改變父子/順序
│   │   ├── edit.js     # contenteditable 文字編輯生命週期
│   │   ├── contextmenu.js
│   │   ├── toolbar.js  # 頂部工具列
│   │   ├── sidepanel.js# 右側樣式/主題/佈局面板
│   │   ├── outline.js  # 大綱模式
│   │   └── themes.js   # 主題定義（資料驅動）
│   └── io/
│       ├── export.js   # PNG/SVG/PDF/TXT/Markdown/JSON
│       └── import.js   # JSON/TXT/Markdown
└── docs/               # 規格與階段簡報（Claude 維護）
```

## 資料模型（v1 schema）

```js
// 單一節點
Node {
  id: string,            // nanoid 風格隨機 id
  text: string,          // 純文字（v1）
  children: Node[],
  collapsed: boolean,
  side: 'left'|'right'|null, // 僅根節點的直接子節點使用（雙向佈局）
  style: {               // 節點級覆蓋，未設定則吃主題預設
    fill, textColor, borderColor, borderWidth, borderStyle,
    fontSize, fontFamily, bold, italic, underline, strike, shape, // shape: rect|rounded|pill|underline|ellipse
    lineColor, lineWidth, lineStyle,
  },
  notes: string|null,    // 備註（富文字 v2，先純文字）
  link: string|null,     // 超連結
  icons: string[],       // 圖示 key 列表（優先級/進度/旗幟/emoji）
  image: {src,w,h}|null,
}

// 文件
Doc {
  id, title, createdAt, updatedAt,
  root: Node,
  layout: 'mindmap-right'|'mindmap-left'|'mindmap-both'|'org'|'tree-left'|'tree-right'|'timeline-h'|'fishbone',
  themeId: string,
  relations: [{id, fromId, toId, label, cp1, cp2}],  // 關聯線（自由曲線可調控制點）
  summaries: [{id, parentId, startIndex, endIndex, text, style}], // 概要括弧
  canvas: {background, watermark:boolean},
}
```

## 核心不變式

1. **所有修改走 command**：`execute(cmd)` 進 undo stack；redo stack 在新命令時清空。command 物件含 `do()/undo()` 與描述。
2. **佈局是純函數**：`layout(doc, measureFn) -> Map<nodeId, {x,y,w,h}>`，不碰 DOM 之外先用隱藏測量層量文字尺寸。
3. **渲染冪等**：`render(doc, positions)` 可全量重繪；效能優化（增量）後做，先求正確。
4. **keyboard.js 是唯一快捷鍵入口**，用 action 名對映到 commands，方便對照 GitMind 快捷鍵表驗收。

## 編碼規範

- ES modules、`const`/`let`、無分號可但**保持一致**（Codex 自選並全案統一）。
- 關鍵邏輯加**中文註解**（使用者要求）。
- 禁止引入外部 CDN 腳本與 npm 依賴（匯出 PNG 用原生 canvas + SVG serialization；PDF 用列印樣式或後續評估）。
- 每個模組頂部一段中文說明職責。

## 驗收方式

主 session 會用真實瀏覽器逐條對照 docs/SPEC.md 操作驗證（快捷鍵、拖曳、主題切換、匯出……），缺陷會寫進 docs/REVIEW_*.md 回饋修正。
