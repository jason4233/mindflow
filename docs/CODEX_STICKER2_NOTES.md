# STICKER2 貼紙庫擴充交付紀錄

## 研究基線

- `docs/research/FEATURES.md` 確認貼紙位於「圖示」內的貼紙子分類，既有主題包含商務、教育、科技、表情、旅行、天氣；節點可移除貼紙。
- `docs/research/UI_VISUAL_NOTES.md` 主要記錄圖示面板的優先級、進度、旗幟、箭頭、月份、星期與符號網格，沒有足以臨摹貼紙造型的完整畫面。
- 圖片研究紀錄確認節點圖片可拖曳調整大小，因此貼紙改成走同一個 `node.image` 附件資料流。

## 實作

- 貼紙庫由 6 類 × 6 張擴充為 10 類 × 12 張，共 120 張：商務、教育、科技、表情、旅行、天氣、動物、食物、節慶、符號箭頭。
- 新增 84 張獨立 SVG；全部採 `128 × 128` viewBox、2px 深色主描邊、圓角線帽／接點與現有馬卡龍色盤，未嵌入點陣圖、data URI 或外部素材。
- `manifest.json` 固定列出 10 個分類，每類 12 個唯一 id、名稱與檔案路徑。
- 貼紙分頁新增搜尋框、可水平捲動分類籤、垂直捲動三欄網格、結果數與空結果狀態；搜尋支援中文名稱、英文 id 與分類名稱。
- 點貼紙會以可 undo 的 command 寫入節點 `image`，同節點再點其他貼紙會原位取代並保留使用者已調整的尺寸。
- 選中含圖片的節點時顯示四角等比例縮放把手與刪除鈕；一般圖片與貼紙共用相同行為。
- 因既有 schema 重載時只保留 `image.src/w/h`，貼紙辨識同時支援 `assets/stickers/.../*.svg` 路徑；重載後換貼紙仍保留尺寸，面板也能依 `src` 還原 active 狀態。
- 舊文件的 `sticker:*` icon token 保留唯讀顯示相容；新插入會清掉該節點的舊 sticker token，避免圖片與 icon strip 重複顯示。

## 測試與瀏覽器自測

- `tests/stickers.test.mjs` 驗證：10 × 12 數量、id／路徑唯一、manifest 與磁碟一一對應、SVG 標籤閉合／namespace／viewBox／2px 描邊／無外部素材、搜尋、附件替換與 undo、重載後尺寸保留、四角縮放邊界。
- `node --test tests/*.test.mjs`：exit 0；核心、DELTA、I/O、layout、spatial navigation、store/search、cursor SVG 與貼紙測試全數通過。
- 獨占固定測試埠後重跑完整快捷鍵矩陣：160/160 PASS；IME targeted synthetic：54/54 PASS。
- Playwright CLI 真實 Chromium：面板顯示 10 類與 120/120；搜尋「貓咪」為 1/120，動物分類為 12/120；中心節點插入貓咪 96×96，拖曳東南角到 146×146，reload 後仍為 146×146，換成披薩後維持 146×146 且四把手存在，點「刪除貼紙」後 image count 為 0；console 0 error / 0 warning。

## 自首

- 既有 36 張原創 SVG 保留原檔，本次實際新增 84 張；「120 張全部原創」代表整庫沒有取用第三方圖標，不代表本次重畫既有 36 張。
- 新 SVG 以基本幾何與手寫 path 獨立完成，沒有開啟、下載、描圖或臨摹 GitMind 或其他產品的貼紙素材。研究文件也沒有提供可供逐圖仿製的貼紙圖庫截圖。
- SVG 合法性測試使用針對本庫無 namespace 子樹、無 script、無外部引用之 SVG 子集合的 stack parser，不冒充完整 XML Schema 驗證器；同一輪真實 Chromium 面板曾建立並載入全部 120 個 `<img>`，console 無載入錯誤。
- 瀏覽器互動對插入、換圖、單一角落拖曳與刪除做代表性實測；四個角與尺寸上下限由純函式測試全覆蓋，沒有逐張人工點擊 120 次。
- 第一次完整快捷鍵矩陣啟動時復用了另一個流程持有的固定 4187 port；外部 owner 中途結束後，後續 Chromium 案例成批 `ERR_CONNECTION_REFUSED`。這次失敗屬並行測試基礎設施競態，不列為產品通過證據；確認埠釋放後先做 1/1 最小重跑，再以獨占埠完整重跑並取得 160/160、IME 54/54 PASS。
- 沒有執行 git 指令、commit 或 push。

## 主 session 簽字（2026-08-30）：120 張目視抽驗（4 新分類全看）風格統一原創、manifest 測試 6/6、全套測試綠。✍️ 雙簽通過。
