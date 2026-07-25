# MindFlow — 心智圖工具（GitMind 功能複刻）

純前端心智圖應用：零依賴、零建置、資料全存本機（localStorage）。功能與操作對齊 GitMind：完整快捷鍵、12 內建主題、6 種佈局、關聯線/概要/備註/圖示/貼紙、大綱模式、演示模式、歷史版本、公式、匯出六格式。

## 安裝與啟動

**[下載桌面版（Windows portable EXE，永遠是最新版）](https://github.com/jason4233/mindflow/releases/latest/download/MindFlow-portable.exe)**

**任何電腦一行指令**（只需 Node.js ≥18）：

```bash
npx github:jason4233/mindflow
```

會自動下載、啟動本地伺服器並開啟瀏覽器。

其他方式：

```bash
git clone https://github.com/jason4233/mindflow.git && cd mindflow && npm start
```

本機已 clone 的話：雙擊 `start.bat`（Windows）或 `npm start`，或手動 `node tools/serve.mjs 8931` 再開 http://127.0.0.1:8931/

> 不要用 `python -m http.server`（無 no-store 標頭，改代碼後瀏覽器會吃到舊快取）。

## 常用快捷鍵（完整表見編輯器 ··· → 快速鍵）

| 鍵 | 功能 |
|---|---|
| Tab / Enter / Shift+Tab | 插入下級 / 同級 / 上級節點 |
| Space 或直接打字 | 編輯節點文字 |
| Delete / Ctrl+Delete | 刪除子樹 / 刪除但保留子節點 |
| Ctrl+Z / Ctrl+Y | 復原 / 重做 |
| F4 / Ctrl+Alt+T / Ctrl+Alt+M | 關聯線 / 概要 / 備註 |
| F6 / Ctrl+P / Alt+Y | 換主題 / 主題面板 / 樣式面板 |
| Ctrl+O / Ctrl+F / Ctrl+Alt+F | 大綱視圖 / 尋找取代 / 適應畫布 |
| Shift+Alt+H / Shift+Alt+F | 歷史版本 / 懸浮節點 |

## 專案結構

- `index.html` 首頁儀表板（文件庫/範本/回收筒/全文檢索/匯入）
- `editor.html` 編輯器
- `js/editor/` 編輯器模組（模型/命令/佈局/渲染/互動/功能）
- `js/io/` 匯出匯入引擎
- `assets/stickers/` 36 張原創貼紙
- `docs/` 規格（SPEC.md）、架構、研究資料、各輪驗收紀錄
- `tests/` 單元測試：`node tests/core.test.mjs`（共 5 套 73 斷言）

## 說明

本專案為個人使用之功能複刻練習：功能、佈局、快捷鍵對齊 GitMind，但所有代碼與素材均為原創，未使用 GitMind 之原始碼、圖像素材或商標。
