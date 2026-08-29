# CURSOR2 游標重繪紀錄

## 完成內容

- `hand-open.svg` 保留 32×32 canvas，原手掌輪廓等比縮到約 22px 視覺高度並置中偏上；描邊改為 1.5px。
- `hand-closed.svg` 完整重畫為抓握拳：頂部四指圓弧、三條分指線、拇指橫扣於前、底部短腕截面；視覺高度約 22px。
- 兩個 glyph 的視覺中心都約在 `(16, 14)`，因此 5 處 CSS cursor hotspot 統一更新為 `16 14`。
- `css/editor.css` 的 2 個 `grab`、2 個 `grabbing`，以及 `css/node.css` 的 1 個 `grab`，均重新 URL-encode；decode 後與 SVG 原檔逐字一致。

## 測試證據

TDD 的 RED 階段先修改測試契約。舊 CSS 仍是 hotspot `16 17` 時，測試如預期失敗：

```text
AssertionError [ERR_ASSERTION]: grab hotspot 必須對齊縮小後 glyph 的視覺中心
actual: [16, 17]
expected: [16, 15]
```

完成目標座標後，依實際 glyph 邊界把 provisional 的 `16 15` 校正為 `16 14`，再實作 SVG 與 CSS。最終結果：

```text
cursor-data-uri: 5/5 宣告可解碼，SVG 合法、統一且與原始檔一致
24/24 tests passed
```

執行命令：

```powershell
node tests\cursor-data-uri.test.mjs
node tests\core.test.mjs
```

## 1:1 視覺證據

- 檔案：`docs/cursor-preview-v2.png`
- 真實 Chromium、viewport 1280×900、PNG screenshot 使用 CSS pixel scale，檔案大小 50,906 bytes。
- 白、深藍、粉紅三種背景均並排顯示 open／closed；每種各有 32px 原尺寸與 128px 放大樣本。
- 32px 樣本的 canvas 在 PNG 中為 32×32 實際像素；glyph 本體約佔 22px 高。
- 乾淨重截時 browser console 為 0 errors、0 warnings。

## 主動自首

1. hotspot 最初以肉眼暫估 open `16 15`、closed `16 14`；完成座標邊界後重新計算，兩者都應為 `16 14`。測試預期已同步最終值，沒有保留錯誤估值。
2. 第一輪 open data URI 使用標準 `encodeURIComponent`，但它不編碼 transform 的括號，和既有 cursor parser 的右括號終止規則衝突，測試只抓到 2/5。之後把 `(`、`)` 額外編為 `%28`、`%29`，再測為 5/5。
3. 驗收工具流程有三次可恢復錯誤：PowerShell `PathInfo` 直接轉 `Uri` 失敗、Playwright 封鎖 `file:` protocol、背景 server 啟動後第一次未成功擷取 PID。最後改用 localhost；依 Listen owner 與完整 command line 鎖定 PID 1968，完成後已關閉兩個 browser session 並停止該 server。
4. 第一輪驗收頁缺 favicon，console 有 1 個無關的 404；加入 data favicon 後以全新 session 重截，console 為 0/0。正式 PNG 是乾淨重截版本。
5. PNG 證明 SVG 在 Chromium 以 32 CSS px 與 128 CSS px 的輪廓和比例；它不能證明 Windows 在每一種 DPI／瀏覽器下對「實際 cursor layer」採用完全相同的 rasterization，而且自動截圖不會捕捉 OS 游標本身。CSS data URI、hotspot 與 fallback 由自動測試補足結構驗證。
6. open glyph 使用 `vector-effect="non-scaling-stroke"`，目的在縮小輪廓時仍維持實際 1.5px 描邊；closed 已直接使用新座標，不依賴 transform。現代 Chromium 支援此 SVG 屬性，但舊式 cursor renderer 的細微 anti-aliasing 仍可能不同。
7. 為保住 32px 辨識度，握拳只畫三條必要分指線，沒有增加掌紋或陰影；放大看較簡化，但原尺寸不會糊成一團。
8. 本輪沒有執行任何 git 命令。臨時 HTML、server logs 與本輪 Playwright snapshot／console 暫存均已刪除，只保留要求的 PNG 證據與本筆記。

## 主 session 簽字（2026-08-29）：1:1 證據目視通過（尺寸回歸原生、握拳可辨、三背景清晰），cursor 測試 5/5。✍️ 雙簽通過。
