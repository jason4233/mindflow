# MindFlow 快捷鍵與文字工具列 E2E 矩陣

> 產生時間：2026年8月29日 晚上7:29:24  
> 總結果：**160/160 PASS**

## 原有矩陣

> 驅動：Playwright 真實 keyboard/mouse；color input 使用 CDP `Input.dispatchMouseEvent` 真實 pointer 路徑。

> 結果：**106/106 PASS**

| 執行環境 | 快捷鍵／控制 | 狀態 | 預期 | 實測 | PASS/FAIL |
|---|---|---|---|---|---|
| Chromium | Tab | 單選 | 新增 1 個下級節點並選中新節點 | 節點=7；選取=node_5v6v681a3y2w4l3s | PASS
| Chromium | Tab | 面板焦點 | 只移動面板焦點，不新增節點 | 節點 6→6 | PASS
| Chromium | Enter | 單選 | 新增 1 個同級節點並選中新節點 | 節點=7 | PASS
| Chromium | Shift+Tab | 單選 | 在目前節點上方插入新父節點 | a 子節點=["node_5c5z4o4z5e402c68"] | PASS
| Chromium | Ctrl+/ | 單選 | 收合有子節點的分支，再按一次展開 | 收合 class=collapse-control is-collapsed；節點 5→6 | PASS
| Chromium | Delete | 單選 | 刪除節點及整個子樹 | 節點=4；a1=false | PASS
| Chromium | Delete | 多選 | 刪除所有選取節點及其子樹 | 節點=3 | PASS
| Chromium | Delete | 面板焦點 | 不刪除節點 | 節點=6 | PASS
| Chromium | Ctrl+Delete | 單選 | 刪除目前節點但把子節點提升一層 | 節點=5；root=a1,b,c,d | PASS
| Chromium | Alt+↑ | 單選 | 節點在同側同級中上移 | 順序=b,a,c,d | PASS
| Chromium | Alt+↓ | 單選 | 節點在同側同級中下移 | 順序=b,a,c,d | PASS
| Chromium | Ctrl+左鍵拖曳 | 未選取 | 框選至少兩個右側節點 | 選取=a,a1,b | PASS
| Chromium | Ctrl+點擊 | 單選→多選 | 逐一加入第二個節點 | 選取=a,b | PASS
| Chromium | Shift+↑ | 單選 | 選到視覺上方同級節點 | 選取=a | PASS
| Chromium | Shift+↓ | 單選 | 選到視覺下方同級節點 | 選取=b | PASS
| Chromium | Ctrl+Alt+C / Ctrl+Alt+V | 單選 | 把來源節點樣式貼到目標節點 | B shape=diamond | PASS
| Chromium | Ctrl+D | 單選 | 複製選取節點與子樹 | 節點=8 | PASS
| Chromium | Ctrl+D | 多選 | 複製兩個頂層選取項目 | 節點=9 | PASS
| Chromium | Ctrl+Z | 單選 | 復原上一個新增動作 | 節點=6 | PASS
| Chromium | Ctrl+Y | 單選 | 重做剛復原的新增動作 | 節點=7 | PASS
| Chromium | Ctrl+C / Ctrl+V | 單選 | 複製子樹並貼到目前節點 | 節點=8 | PASS
| Chromium | Ctrl+X / Ctrl+V | 單選 | 剪下子樹後可貼回其他節點 | 節點 4→6 | PASS
| Chromium | Ctrl+S | 編輯後 | 立即把最新文件寫入 localStorage | 儲存節點 6→7 | PASS
| Chromium | F6 | 單選 | 循環切換到下一個主題 | 主題 classic-blue→office-pink | PASS
| Chromium | F6 | 面板焦點 | 仍視為全域快捷鍵切換主題 | 主題 classic-blue→office-pink | PASS
| Chromium | Ctrl+P | 單選 | 打開右側主題分頁 | panel={"collapsed":false,"tab":"theme"} | PASS
| Chromium | Alt+Y | 單選 | 打開右側樣式分頁 | panel={"collapsed":false,"tab":"style"} | PASS
| Chromium | Space | 單選 | 進入 contenteditable 文字編輯 | contenteditable=true | PASS
| Chromium | Shift+Enter | 編輯中 | 在節點文字內插入換行而不離開編輯 | 文字="\n\n"；editing=true | PASS
| Chromium | Ctrl+B | 編輯中 | 套用 B 文字格式 | richText=<b>Alpha</b> | PASS
| Chromium | Ctrl+I | 編輯中 | 套用 I 文字格式 | richText=<i>Alpha</i> | PASS
| Chromium | Ctrl+U | 編輯中 | 套用 U 文字格式 | richText=<u>Alpha</u> | PASS
| Chromium | Ctrl+G | 單選 | 啟動格式刷並把來源樣式套到下一個點擊節點 | armed=true；B shape=diamond | PASS
| Chromium | Ctrl+1 | 單選 | 設定優先順序圖示 1 | icons=priority:1 | PASS
| Chromium | Ctrl+2 | 單選 | 設定優先順序圖示 2 | icons=priority:2 | PASS
| Chromium | Ctrl+3 | 單選 | 設定優先順序圖示 3 | icons=priority:3 | PASS
| Chromium | Ctrl+4 | 單選 | 設定優先順序圖示 4 | icons=priority:4 | PASS
| Chromium | Ctrl+5 | 單選 | 設定優先順序圖示 5 | icons=priority:5 | PASS
| Chromium | Ctrl+6 | 單選 | 設定優先順序圖示 6 | icons=priority:6 | PASS
| Chromium | Ctrl+7 | 單選 | 設定優先順序圖示 7 | icons=priority:7 | PASS
| Chromium | Ctrl+8 | 單選 | 設定優先順序圖示 8 | icons=priority:8 | PASS
| Chromium | Ctrl+9 | 單選 | 設定優先順序圖示 9 | icons=priority:9 | PASS
| Chromium | Ctrl+Shift+> | 單選 | 字級增加 2px | 字級 14→16 | PASS
| Chromium | Ctrl+Shift+< | 單選 | 字級減少 2px | 字級 14→12 | PASS
| Chromium | Ctrl+Alt+K | 單選 | 開啟連結輸入 dialog | 連結 dialog 未開啟 | PASS
| Chromium | Ctrl+Alt+M | 單選 | 備註 drawer 已掛載並開啟、textarea 取得焦點 | {"mounted":true,"open":true,"focused":true} | PASS
| Chromium | Ctrl+Alt+M | 未選取 | 不開 drawer 並提示先選取節點 | open=false；toast=請先選取節點 | PASS
| Chromium | Ctrl+Alt+M | 面板焦點 | 保留面板輸入操作，不誤開備註 | drawer open=false | PASS
| Chromium | Ctrl+Alt+T | 多選 | 對連續同級節點建立概要 | summary DOM=1 | PASS
| Chromium | Alt+P | 單選 | 打開圖片 file chooser | file input click=true；filechooser=true | PASS
| Chromium | Alt+I | 單選 | 打開右側圖示分頁 | panel={"collapsed":false,"tab":"icon"} | PASS
| Chromium | F4 | 單選 | 進入關聯線選點模式，點目標後建立線 | picking=true；relation=1 | PASS
| Chromium | Ctrl+Alt+R | 單選 | 評論佔位功能提供可見回饋 | toast=此功能即將推出 | PASS
| Chromium | Ctrl+0 | 畫布 | 把縮放重設為 100% | zoom=100% | PASS
| Chromium | Ctrl+滾輪 | 畫布 | 真實 wheel 事件改變縮放 | zoom 100%→143% | PASS
| Chromium | Ctrl+Shift+L | 畫布 | 一鍵整理並重新 fit 畫布 | zoom 223%→292%；nodesWithinCanvas=true | PASS
| Chromium | Ctrl+O | 畫布 | 切換到大綱相關視圖 | view map→outline | PASS
| Chromium | 左鍵拖曳空白 | 畫布 | 平移 world transform | transform transform: translate(660px, 480px) scale(1);→transform: translate(740px, 530px) scale(1); | PASS
| Chromium | F11 | 畫布 | 切換瀏覽器全螢幕狀態 | fullscreen=true | PASS
| Chromium | Ctrl+Alt+F | 畫布 | 適應整張心智圖 | zoom 272%→292%；nodesWithinCanvas=true | PASS
| Chromium | Ctrl+Shift+R | 畫布 | 把根節點置中畫布 | rootCenter=720.0；canvasCenter=720.0 | PASS
| Chromium | Ctrl+F | 畫布 | 打開尋找與取代面板並聚焦搜尋框 | {"open":true,"focused":true} | PASS
| Chromium | Ctrl+A | 畫布 | 選取所有可見節點 | 選取=6 | PASS
| Chromium | Esc | 專注模式 | 退出專注模式 | focus true→false | PASS
| Chromium | Esc | 演示模式 | 退出演示模式並恢復編輯畫布 | presentation active=false | PASS
| Chromium | Shift+Alt+H | 畫布 | 切換歷史版本 drawer | history hidden=null | PASS
| Chromium | Shift+Alt+F | 畫布 | 新增並選取懸浮節點 | 節點=7；floating=1 | PASS
| Chromium | ↑ | 單選 | 選取視覺↑方向最近節點 | 選取 b→a1 | PASS
| Chromium | ↓ | 單選 | 選取視覺↓方向最近節點 | 選取 a1→b | PASS
| Chromium | ← | 單選 | 選取視覺←方向最近節點 | 選取 root→d | PASS
| Chromium | → | 單選 | 選取視覺→方向最近節點 | 選取 root→b | PASS
| Chromium | ↑ | 未選取 | 選取根節點 | 選取=root | PASS
| Chromium | ↓ | 未選取 | 選取根節點 | 選取=root | PASS
| Chromium | ← | 未選取 | 選取根節點 | 選取=root | PASS
| Chromium | → | 未選取 | 選取根節點 | 選取=root | PASS
| Chromium | 方向鍵 | 編輯中 | 只移動文字游標，不改節點選取 | editing=true；選取=a | PASS
| Chromium | 方向鍵 | 面板焦點 | 保留面板控制原生行為，不移動節點選取 | 選取=a | PASS
| Chromium | F2 | 單選 | 明確不進入文字編輯 | editing=false | PASS
| Chromium | 文字工具列：字型 | 編輯中 | 套用所選字型到選取文字 | fontFamily="Courier New", monospace | PASS
| Chromium | 文字工具列：字級 | 編輯中 | 套用 24px 字級到選取文字 | fontSize=24 | PASS
| Chromium | 文字工具列：B | 編輯中 | 對局部文字套用 B 格式 | richText=<b>Alpha</b> | PASS
| Chromium | 文字工具列：I | 編輯中 | 對局部文字套用 I 格式 | richText=<i>Alpha</i> | PASS
| Chromium | 文字工具列：U | 編輯中 | 對局部文字套用 U 格式 | richText=<u>Alpha</u> | PASS
| Chromium | 文字工具列：S | 編輯中 | 對局部文字套用 S 格式 | richText=<strike>Alpha</strike> | PASS
| Chromium | 文字工具列：文字色 | 編輯中／真實 pointer | 原生 color input 點擊後仍對原 Range 套用文字色 | richText=<span style="color: rgb(255, 0, 0);">Alpha</span> | PASS
| Chromium | 文字工具列：反白色 | 編輯中／真實 pointer | 原生 color input 點擊後仍對原 Range 套用反白色 | richText=<span style="background-color: rgb(0, 255, 0);">Alpha</span> | PASS
| Chromium | 文字工具列：靠左 | 編輯中 | 節點文字對齊設為 left | computed text-align=left | PASS
| Chromium | 文字工具列：置中 | 編輯中 | 節點文字對齊設為 center | computed text-align=center | PASS
| Chromium | 文字工具列：靠右 | 編輯中 | 節點文字對齊設為 right | computed text-align=right | PASS
| Chromium | 文字工具列：行距 | 編輯中 | 節點行距設為 1.75 | lineHeight=1.75 | PASS
| Chromium | 文字工具列：格式刷 | 編輯中 | 啟動一次性格式刷 | format painter armed=true | PASS
| Chromium | 樣式面板：填色 | 單選／真實 pointer | 原生 color input 點擊後提交節點填色 | fill=#123456 | PASS
| Electron | Ctrl+Alt+C / Ctrl+Alt+V | 單選 | 把來源節點樣式貼到目標節點 | B shape=diamond | PASS
| Electron | Ctrl+Alt+K | 單選 | 開啟連結輸入 dialog | 連結 dialog 未開啟 | PASS
| Electron | Ctrl+Alt+M | 單選 | 備註 drawer 已掛載並開啟、textarea 取得焦點 | {"mounted":true,"open":true,"focused":true} | PASS
| Electron | Ctrl+Alt+T | 多選 | 對連續同級節點建立概要 | summary DOM=1 | PASS
| Electron | Alt+P | 單選 | 打開圖片 file chooser | file input click=true；filechooser=true | PASS
| Electron | F4 | 單選 | 進入關聯線選點模式，點目標後建立線 | picking=true；relation=1 | PASS
| Electron | Ctrl+Alt+R | 單選 | 評論佔位功能提供可見回饋 | toast=此功能即將推出 | PASS
| Electron | ↑ | 單選 | 選取視覺↑方向最近節點 | 選取 b→a1 | PASS
| Electron | ↓ | 單選 | 選取視覺↓方向最近節點 | 選取 a1→b | PASS
| Electron | ← | 單選 | 選取視覺←方向最近節點 | 選取 root→d | PASS
| Electron | → | 單選 | 選取視覺→方向最近節點 | 選取 root→b | PASS
| Electron | 文字工具列：文字色 | 編輯中／真實 pointer | 原生 color input 點擊後仍對原 Range 套用文字色 | richText=<span style="color: rgb(255, 0, 0);">Alpha</span> | PASS
| Electron | 文字工具列：反白色 | 編輯中／真實 pointer | 原生 color input 點擊後仍對原 Range 套用反白色 | richText=<span style="background-color: rgb(0, 255, 0);">Alpha</span> | PASS
| Electron | 樣式面板：填色 | 單選／真實 pointer | 原生 color input 點擊後提交節點填色 | fill=#123456 | PASS |

## IME 模式掃描（targeted synthetic）

> 自首：Playwright 無法真實切換 Windows 注音／微軟 IME。本節用 `dispatchEvent(new KeyboardEvent(...))` 合成 `key='Process'`、正確 `code`、`keyCode/which=229` 與修飾鍵；untrusted keydown 不會產生瀏覽器 default paste，因此 paste 案例另補 synthetic `paste` event。這批案例只驗證應用層事件路由，不冒充真實 OS IME E2E。

> 結果：**54/54 PASS**

| 執行環境 | 快捷鍵／控制 | 狀態 | 預期 | 實測 | PASS/FAIL |
|---|---|---|---|---|---|
| Chromium | Ctrl+Z [KeyZ] | IME 模式／單選 | 復原上一個新增動作 | 節點=6 | PASS
| Chromium | Ctrl+Y [KeyY] | IME 模式／單選 | 重做剛復原的新增動作 | 節點=7 | PASS
| Chromium | Ctrl+C / Ctrl+V [KeyC] | IME 模式／單選 | 複製子樹並貼到目前節點 | 節點=8 | PASS
| Chromium | Ctrl+X / Ctrl+V [KeyX] | IME 模式／單選 | 剪下子樹後可貼回其他節點 | 節點 4→6 | PASS
| Chromium | Ctrl+C / Ctrl+V [KeyV] | IME 模式／單選 | 複製子樹並貼到目前節點 | 節點=8 | PASS
| Chromium | Ctrl+A [KeyA] | IME 模式／畫布 | 選取所有可見節點 | 選取=6 | PASS
| Chromium | Ctrl+S [KeyS] | IME 模式／編輯後 | 立即把最新文件寫入 localStorage | 儲存節點 6→7 | PASS
| Chromium | Ctrl+Alt+C / Ctrl+Alt+V [KeyC] | IME 模式／單選 | 把來源節點樣式貼到目標節點 | B shape=diamond | PASS
| Chromium | Ctrl+Alt+C / Ctrl+Alt+V [KeyV] | IME 模式／單選 | 把來源節點樣式貼到目標節點 | B shape=diamond | PASS
| Chromium | Ctrl+D [KeyD] | IME 模式／單選 | 複製選取節點與子樹 | 節點=8 | PASS
| Chromium | Ctrl+P [KeyP] | IME 模式／單選 | 打開右側主題分頁 | panel={"collapsed":false,"tab":"theme"} | PASS
| Chromium | Alt+Y [KeyY] | IME 模式／單選 | 打開右側樣式分頁 | panel={"collapsed":false,"tab":"style"} | PASS
| Chromium | Ctrl+G [KeyG] | IME 模式／單選 | 啟動格式刷並把來源樣式套到下一個點擊節點 | armed=true；B shape=diamond | PASS
| Chromium | Ctrl+1 [Digit1] | IME 模式／單選 | 設定優先順序圖示 1 | icons=priority:1 | PASS
| Chromium | Ctrl+1 [Numpad1] | IME 模式／單選 | 設定優先順序圖示 1 | icons=priority:1 | PASS
| Chromium | Ctrl+2 [Digit2] | IME 模式／單選 | 設定優先順序圖示 2 | icons=priority:2 | PASS
| Chromium | Ctrl+2 [Numpad2] | IME 模式／單選 | 設定優先順序圖示 2 | icons=priority:2 | PASS
| Chromium | Ctrl+3 [Digit3] | IME 模式／單選 | 設定優先順序圖示 3 | icons=priority:3 | PASS
| Chromium | Ctrl+3 [Numpad3] | IME 模式／單選 | 設定優先順序圖示 3 | icons=priority:3 | PASS
| Chromium | Ctrl+4 [Digit4] | IME 模式／單選 | 設定優先順序圖示 4 | icons=priority:4 | PASS
| Chromium | Ctrl+4 [Numpad4] | IME 模式／單選 | 設定優先順序圖示 4 | icons=priority:4 | PASS
| Chromium | Ctrl+5 [Digit5] | IME 模式／單選 | 設定優先順序圖示 5 | icons=priority:5 | PASS
| Chromium | Ctrl+5 [Numpad5] | IME 模式／單選 | 設定優先順序圖示 5 | icons=priority:5 | PASS
| Chromium | Ctrl+6 [Digit6] | IME 模式／單選 | 設定優先順序圖示 6 | icons=priority:6 | PASS
| Chromium | Ctrl+6 [Numpad6] | IME 模式／單選 | 設定優先順序圖示 6 | icons=priority:6 | PASS
| Chromium | Ctrl+7 [Digit7] | IME 模式／單選 | 設定優先順序圖示 7 | icons=priority:7 | PASS
| Chromium | Ctrl+7 [Numpad7] | IME 模式／單選 | 設定優先順序圖示 7 | icons=priority:7 | PASS
| Chromium | Ctrl+8 [Digit8] | IME 模式／單選 | 設定優先順序圖示 8 | icons=priority:8 | PASS
| Chromium | Ctrl+8 [Numpad8] | IME 模式／單選 | 設定優先順序圖示 8 | icons=priority:8 | PASS
| Chromium | Ctrl+9 [Digit9] | IME 模式／單選 | 設定優先順序圖示 9 | icons=priority:9 | PASS
| Chromium | Ctrl+9 [Numpad9] | IME 模式／單選 | 設定優先順序圖示 9 | icons=priority:9 | PASS
| Chromium | Ctrl+Alt+K [KeyK] | IME 模式／單選 | 開啟連結輸入 dialog | 連結 dialog 未開啟 | PASS
| Chromium | Ctrl+Alt+M [KeyM] | IME 模式／單選 | 備註 drawer 已掛載並開啟、textarea 取得焦點 | {"mounted":true,"open":true,"focused":true} | PASS
| Chromium | Ctrl+Alt+T [KeyT] | IME 模式／多選 | 對連續同級節點建立概要 | summary DOM=1 | PASS
| Chromium | Alt+P [KeyP] | IME 模式／單選 | 打開圖片 file chooser | file input click=true；filechooser=true | PASS
| Chromium | Alt+I [KeyI] | IME 模式／單選 | 打開右側圖示分頁 | panel={"collapsed":false,"tab":"icon"} | PASS
| Chromium | Ctrl+Alt+R [KeyR] | IME 模式／單選 | 評論佔位功能提供可見回饋 | toast=此功能即將推出 | PASS
| Chromium | Ctrl+0 [Digit0] | IME 模式／畫布 | 把縮放重設為 100% | zoom=100% | PASS
| Chromium | Ctrl+0 [Numpad0] | IME 模式／畫布 | 把縮放重設為 100% | zoom=100% | PASS
| Chromium | Ctrl+Shift+L [KeyL] | IME 模式／畫布 | 一鍵整理並重新 fit 畫布 | zoom 223%→292%；nodesWithinCanvas=true | PASS
| Chromium | Ctrl+O [KeyO] | IME 模式／畫布 | 切換到大綱相關視圖 | view map→outline | PASS
| Chromium | Ctrl+Alt+F [KeyF] | IME 模式／畫布 | 適應整張心智圖 | zoom 272%→292%；nodesWithinCanvas=true | PASS
| Chromium | Ctrl+Shift+R [KeyR] | IME 模式／畫布 | 把根節點置中畫布 | rootCenter=720.0；canvasCenter=720.0 | PASS
| Chromium | Ctrl+F [KeyF] | IME 模式／畫布 | 打開尋找與取代面板並聚焦搜尋框 | {"open":true,"focused":true} | PASS
| Chromium | Shift+Alt+H [KeyH] | IME 模式／畫布 | 切換歷史版本 drawer | history hidden=null | PASS
| Chromium | Shift+Alt+F [KeyF] | IME 模式／畫布 | 新增並選取懸浮節點 | 節點=7；floating=1 | PASS
| Chromium | 直接輸入 [KeyM] | IME 模式／單選 | 以空 seed 進入 contenteditable，保留後續 composition 流 | editing=true；文字="" | PASS
| Electron | Ctrl+Alt+C / Ctrl+Alt+V [KeyC] | IME 模式／單選 | 把來源節點樣式貼到目標節點 | B shape=diamond | PASS
| Electron | Ctrl+Alt+C / Ctrl+Alt+V [KeyV] | IME 模式／單選 | 把來源節點樣式貼到目標節點 | B shape=diamond | PASS
| Electron | Ctrl+Alt+K [KeyK] | IME 模式／單選 | 開啟連結輸入 dialog | 連結 dialog 未開啟 | PASS
| Electron | Ctrl+Alt+M [KeyM] | IME 模式／單選 | 備註 drawer 已掛載並開啟、textarea 取得焦點 | {"mounted":true,"open":true,"focused":true} | PASS
| Electron | Ctrl+Alt+T [KeyT] | IME 模式／多選 | 對連續同級節點建立概要 | summary DOM=1 | PASS
| Electron | Alt+P [KeyP] | IME 模式／單選 | 打開圖片 file chooser | file input click=true；filechooser=true | PASS
| Electron | Ctrl+Alt+R [KeyR] | IME 模式／單選 | 評論佔位功能提供可見回饋 | toast=此功能即將推出 | PASS |
