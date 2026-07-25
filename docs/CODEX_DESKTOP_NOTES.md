# MindFlow Windows Desktop Notes

## 交付內容

- `desktop/` 是獨立 Electron 專案，使用自己的 `package.json` 與 `package-lock.json`。
- main process 以 `127.0.0.1` 的 OS 隨機可用 port 啟動 no-store 靜態服務，再用 `BrowserWindow.loadURL()` 載入首頁；未使用 `file://`。
- 開發模式服務 repo 根目錄；portable 模式服務 `process.resourcesPath\app` 內的打包資源。
- 視窗外框 1280×800、標題固定為 `MindFlow`、隱藏 native menu；關閉視窗會先關靜態 server 再結束 app。
- `desktop/scripts/build-icon.mjs` 將 `assets/favicon.svg` 轉為含 16/24/32/48/64/128/256 七種尺寸的 `desktop/assets/icon.ico`。
- electron-builder 產出 Windows x64 portable 單檔 EXE：`desktop/dist/MindFlow-1.0.0-portable.exe`。

## 指令

```powershell
cd desktop
npm install
npm test
npm run build
npm run smoke
```

`npm run smoke` 會啟動實際 portable EXE，確認頁面由隨機 loopback HTTP port 載入、sticker manifest 可 fetch，最後關閉測試程序。

## 驗證結果

- Desktop tests：5/5 passed。
- 既有 MindFlow tests：73/73 passed。
- Portable smoke：頁面與 `assets/stickers/manifest.json` 載入成功，manifest 共 6 類。
- Windows `user32` probe：視窗 1280×800、標題 `MindFlow`、menu handle 為 0。
- ICO：7 個 image entries，372,526 bytes。
- Portable EXE：90,070,489 bytes。
- SHA-256：`856DB95134FA8DBD151A710578360F64ADF3C1D8DBC26F8165B8BAE6EE0C901E`。

## Release

- Tag：`v1.0.0`
- Title：`MindFlow v1.0.0`
- Asset：`MindFlow-1.0.0-portable.exe`
- URL：https://github.com/jason4233/mindflow/releases/download/v1.0.0/MindFlow-1.0.0-portable.exe

目前 EXE 未使用正式 Authenticode 憑證簽章；Windows SmartScreen 可能在首次執行時顯示未知發行者警告。
