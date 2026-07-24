@echo off
rem MindFlow 一鍵啟動：本地伺服器 + 開啟瀏覽器
cd /d "%~dp0"
start "" http://127.0.0.1:8931/
node tools\serve.mjs 8931
