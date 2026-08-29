# CODEX 畫布手形游標修復紀錄

日期：2026-08-29

## 結果

- 新增原創 32×32 張開手掌與握拳 SVG，統一使用白色填充、2px 黑色描邊、圓形線端與圓角接合。
- hotspot 統一設為 `16 17`，落在手掌中心附近。
- `grab` 使用張開手掌，`grabbing` 使用握拳；所有宣告保留瀏覽器關鍵字 fallback。
- `css/editor.css` 4 處與 `css/node.css` 1 處均改為 URL-encoded SVG data URI，同狀態共用相同 SVG。

## 修改範圍

| 路徑 | 內容 |
| --- | --- |
| `css/editor.css` | 2 個 `grab`、2 個 `grabbing` 宣告改用自訂 SVG cursor。 |
| `css/node.css` | 1 個 `grab` 宣告改用同一張開手掌 cursor。 |
| `assets/cursors/hand-open.svg` | 張開手掌原始 SVG。 |
| `assets/cursors/hand-closed.svg` | 握拳原始 SVG。 |
| `tests/cursor-data-uri.test.mjs` | 驗證 5 處宣告、URL decode、SVG/XML 結構、尺寸、配色、描邊、hotspot、fallback、同組一致性及原檔一致性。 |
| `docs/SHORTCUT_MATRIX.md` | 執行既有矩陣時由 runner 自動刷新。 |

## 驗證

### TDD RED

先建立 `tests/cursor-data-uri.test.mjs`，在 CSS 尚未修改時執行：

```text
AssertionError [ERR_ASSERTION]: 應找到 5 個 SVG cursor 宣告，實際找到 0
```

這證明測試能捕捉原本只使用瀏覽器內建 `grab/grabbing` 的狀態。

### TDD GREEN

執行：

```text
node tests/cursor-data-uri.test.mjs
cursor-data-uri: 5/5 宣告可解碼，SVG 合法、統一且與原始檔一致
```

### 視覺檢查

- 使用 Chrome headless 將兩個 SVG 各自渲染成 64×64 預覽。
- 在預設亮底與 `#202020` 暗底分別目視檢查；兩種手勢可辨，白色掌面與黑色輪廓在兩種背景都清楚。

### 快捷鍵矩陣

執行：

```text
node tests/e2e/shortcuts.matrix.mjs
快捷鍵矩陣：106/106 PASS
```

額外交叉檢查結果：最終 fresh run exit 0、106 個 `PASS`、0 個 `FAIL`；先前背景 run 的 stderr 亦為 0 bytes。

## 主動自首

1. 內建影像檢視器無法直接處理 SVG。第一次改用 Chrome 預覽時，我錯把 PowerShell `PathInfo` 直接轉成 `Uri`，只產生 166-byte 空白暫存圖；修正為使用 `.Path` 後才取得有效渲染。
2. 第一次暗底預覽把 Chrome 背景色 byte order 寫反，實際得到紅底，不能算暗底證據；已改成 `202020ff` 重跑並目視確認真正的 `#202020` 暗底。
3. 第一次 106 項矩陣以背景 `Start-Process` 執行，跨 PowerShell session 沒保留原 process 物件的 exit code。我沒有補寫不存在的 exit code；當次改以 runner 最終摘要、逐行計數與 stderr 交叉驗證。完成前另以前景 process fresh run，取得真實 exit 0、106 PASS、0 FAIL。
4. data URI 依 CSS 使用點重複 3 次與 2 次，這是保留每一處完整 `cursor: url(...) x y, fallback` 宣告的代價。日後若只改 assets 而忘記重編碼，`tests/cursor-data-uri.test.mjs` 會因逐字不一致而失敗。
5. 本輪沒有執行任何 Git 指令，也沒有在允許範圍外修改專案檔。

---

## 主 session 抽驗與雙簽字（2026-08-29）

抽驗：兩個 SVG 放大渲染於白/深藍/粉三種背景，描邊清晰目視通過；cursor-data-uri 測試 5/5；矩陣 106/106。自首 5 條全採認。
- ✍️ 主 session（Claude）：簽字通過
- ✍️ Codex（CURSOR）：驗證完成、保留事項已全數揭露
