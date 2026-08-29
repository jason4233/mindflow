# Codex 對 Claude 鍵盤診斷修改的對抗性審查

> 審查日期：2026-08-30（Asia/Taipei）  
> 審查對象：使用者指定的最新 commit `Add live keyboard diagnostic panel...` 所對應之最終穩定工作樹  
> 限制：依指示未執行任何 git 指令；commit 身分與差異範圍採使用者敘述，逐行審查的是磁碟最終內容。

## 結論先行

- `js/editor/shortcuthelp.js` 最終 source 版沒有 XSS、沒有無界 listener／DOM 成長，也不會直接攔截既有快捷鍵。keydown capture 與 keyup listener 都能在 ×／Escape 時精確移除。
- 已安裝版仍比 source 少一行 `diagnostic.hide()`。因此使用者現在從安裝版按 Escape，面板的兩個 listener 不會停止；必須點 × 或重裝包含最終 source 的 build。這是目前唯一可重現的面板生命週期落差。
- `desktop/scripts/diagnose-installed.mjs` 已在審查途中修正：FAIL 會 non-zero、`try/finally` 嘗試清 process/temp profile、synthetic IME 強制 229、派發到 activeElement、加入 pageerror、URL encode。先前的「假成功 exit 0／happy-path-only cleanup」問題已修，但 temp cleanup 實跑仍會因檔案鎖靜默失敗。
- Claude 的窄結論成立：目前 source 與已安裝版的 `keyboard.js` 完全相同，且應用層 shortcut routing 對 Playwright/CDP 與 targeted synthetic IME 測試全過。
- 擴張成「實體使用者輸入鏈完全正常」仍不成立。CDP 不經 Windows 實體鍵盤、真實 IME、keyboard hook、AltGr／鍵盤配置或 native foreground dispatch。
- 最終 fresh 功能驗證全綠：root Node tests exit 0、desktop 23/23、穩定版本 Chromium + Electron 矩陣 160/160（synthetic IME 54/54）、乾淨 profile 已安裝版診斷 3/3 且 exit 0。資源清理另有一個實證缺口，見 MEDIUM-4。

## 發現事項（依嚴重度）

### MEDIUM-1：CDP 證據只能證明 renderer 應用層，不能證明 OS 實體輸入鏈

位置：`desktop/scripts/diagnose-installed.mjs:1-6, 67-94`

- `page.keyboard.press()` 是 Playwright 經 CDP 注入 renderer，不是使用者實體按鍵。
- synthetic IME 雖已精確補上 `keyCode/which=229`，仍只有 untrusted keydown；沒有真實 compositionstart/update/end、beforeinput、keyup timing 與 Windows IME 狀態。
- CDP 可對不是 native foreground 的 renderer 送 event，也繞過 AutoHotkey、PowerToys、鍵盤驅動、overlay、遠端控制與 accessibility hook。

裁決：可以說「app event routing 正常」，不能用它排除 OS／IME／focus／第三方軟體問題。腳本最終註解已誠實承認此限制。

### MEDIUM-2：診斷 runner 仍可能誤接 stale CDP，且 readiness／錯誤範圍不足

位置：`desktop/scripts/diagnose-installed.mjs:20-45`

- remote-debugging port 固定 9345；未先取得隨機可用 port，也未把 endpoint 與本輪 spawn PID／資產 hash 綁定。
- 若 9345 已有殘留的 MindFlow debug instance，`connectOverCDP` 可能接到舊 process。
- 啟動依賴固定 4 秒與後續固定 sleep，不依 DOM/readiness condition；慢機、大文件或 concurrent build 時會 flaky。
- console/pageerror listener 是 app 啟動至少 4 秒後才掛，會漏掉首次 load 的早期 renderer error。
- spawn 使用 `stdio: 'ignore'`，Electron main-process stderr 不在 `errors`；spawn early `error` event也未顯式監聽。

本輪執行前後 9345 都是 free，所以本次 PASS 沒有 port collision；一般性風險仍存在。

### MEDIUM-3：`MF_REAL_PROFILE=1` 仍會修改真實文件，Ctrl+Z 後沒有驗證完整還原

位置：`desktop/scripts/diagnose-installed.mjs:47-74`

- runner 會打開最近文件，Tab 真正新增節點。
- 成功後雖送 Ctrl+Z，但沒有核對最終 node count、serialized document、updatedAt、undo history、autosave 或 backup 是否完全回到前態。
- 600 ms 中間狀態可能被 autosave／backup 觀察。

裁決：乾淨 temp profile 可安全自動跑；real profile 模式仍不是 read-only diagnostic，不能拿來無風險反覆重跑。

### MEDIUM-4：temp profile cleanup 實跑失敗且被空 catch 吞掉

位置：`desktop/scripts/diagnose-installed.mjs:97-105`

- finally 先 `taskkill`，隨即 `rmSync(userData, { recursive: true, force: true })`；沒有關閉／斷開 Playwright CDP connection，也沒有 retry／retryDelay。
- `rmSync` 的任何失敗被空 catch 吞掉，exit code 仍只看功能 results/errors。
- 本輪 clean-profile diagnostic 3/3 PASS、exit 0 後，實際留下 `C:\Users\ASUS\AppData\Local\Temp\mf-diag-tfKP37`：45 個 entry、約 3,342,745 bytes；MindFlow process 與 9345 listener 都已消失，目錄仍存在。

影響：每次診斷可能累積數 MB Chromium profile。這是已重現的磁碟資源 leak，不是推測。

### LOW-1：診斷 PASS oracle 仍偏寬

位置：`desktop/scripts/diagnose-installed.mjs:67-94`

- Tab 只驗 node count 增加，不驗新增 node 的 parent、selection、action 與 undo 後狀態。
- 備註 action 用 `.feature-drawer textarea, textarea` 的第一個 textarea 是否可見判 PASS，沒有精確鎖 `[data-note-editor]` 與 drawer／node。
- query selector group 依 document order 回傳，未來若更早插入另一個可見 textarea，可能假陽性。
- `errors` 最多輸出 5 筆、每筆截 160 字，長 stack 會失真。

### LOW-2：source 與已安裝版面板相差一行，實際 lifecycle 尚未同步

最終 hash：

- source `shortcuthelp.js`：`E4040D3CE10347E33BC9A6090F9E641944BF64E8941DBDDF4BC9B073670A1E6F`
- installed `shortcuthelp.js`：`970711D96D8CB8773240F330224949C77801C3FBE847F7BB03239160D870C9AC`
- `Compare-Object` 唯一差異：source 多 `diagnostic.hide()`。
- source／installed `keyboard.js` 均為 `409974A9A039D2A414085624DADD3ED9ADE8D83FD636A90F47A589DB4DB371A5`。

影響：已安裝版快捷鍵 routing 測試仍代表同一份 keyboard code；但「Escape 會結束診斷 listener」只在 source 成立，需再 build/install 才落地。

### LOW-3：「已派發」是 `defaultPrevented` proxy，不是 action success audit

位置：`js/editor/shortcuthelp.js:148-164`

- keydown 在 window capture 階段先寫 row；KeyboardController 之後於 bubble 執行 action，既有 row 不會回填。因此一般成功快捷鍵的 keydown row通常沒有「已派發」。
- IME keyup fallback 由 KeyboardController 先註冊，成功時會 `preventDefault()`；診斷 keyup listener 後註冊，能看到「已派發」。這條順序目前正確。
- 但 `defaultPrevented` 也可能由其他 handler 設定；action 在 prevent 後丟錯也仍顯示「已派發」。

裁決：面板可分辨事件是否送達、靜態 binding 是否命中，並能輔助看 IME keyup fallback；不能單獨證明 action 最後成功或資料已改變。

## `js/editor/shortcuthelp.js` 逐段逐行審查

| 行 | 審查結果 |
|---|---|
| 1-17 | import 與 label 是靜態資料；`findShortcutBinding`／`isFormTarget` 均為純讀。 |
| 18-42 | diagnostic 在 editor init 建一次；source Escape handler 已呼叫 `diagnostic.hide()`。現有 boot 只初始化一次。 |
| 45-102 | more-menu 舊邏輯；與診斷 listener 沒有共享可變 listener reference。 |
| 104-120 | dialog HTML 只來自固定 binding／label，沒有使用者輸入注入面。 |
| 122-139 | inline style 建一次並活到 page unload；是有界的一個 style node，不是 leak。 |
| 141-146 | hidden panel／list 建一次；是 editor-lifetime allocation。 |
| 148-160 | 每個 keydown/keyup 做一次固定 binding 表線性掃描、建立一個 row，最多保留 12 row；無 layout read，成本有界。 |
| 152-158 | `event.key`、`event.code`、`binding.action` 全以 `textContent` 寫入。`innerHTML` 只含固定 marker、數值 keyCode、固定 modifier 字串與固定 markup；未發現 XSS。 |
| 162-169 | `show()` 綁 keydown capture + keyup bubble；`hide()` 使用同 callback 與相同 capture 值精確移除。重複 add 同一 listener 組合不會疊加。 |
| 172-180 | shortcut 顯示文字只處理靜態 binding。 |

### 記憶體／干擾／效能裁決

- **記憶體洩漏**：source 未發現。面板開啟時兩個 listener；×／Escape 成對移除；list 上限 12。panel/style 常駐各一個，屬頁面生命週期固定配置。
- **正常操作干擾**：面板未開時沒有 diagnostic key listener。面板開啟時不呼叫 `preventDefault()`／`stopPropagation()`，不直接改既有快捷鍵控制流。
- **診斷模式 UI 干擾**：z-index 9999 的 360 px 左下浮層會遮住並攔截該區 pointer；這是開啟診斷時的實際代價。
- **效能**：同時記 keydown + keyup，按鍵 repeat 時有同步 DOM mutation；但固定 binding scan、12-row cap、無 layout read，桌面診斷用途可接受。
- **隱私**：面板會顯示使用者在備註／搜尋等欄位的最近 12 個事件。若截圖回報，可能連同輸入內容的 key pattern 被分享。

## `desktop/scripts/diagnose-installed.mjs` 逐段逐行審查

| 行 | 審查結果 |
|---|---|
| 1-6 | 頂部註解現在誠實記載 CDP、console、固定 port、real-profile 副作用限制。 |
| 7-18 | Playwright 動態 import；未設定 `MF_PW_PATH` 時 exit 2。無未使用 import。 |
| 20-30 | clean mode 才建 temp profile；仍 hard-code exe 與 port。 |
| 32-45 | 主流程包進 try；仍以固定 sleep 啟動；console/pageerror 掛載偏晚。 |
| 47-65 | 最近文件導航已 encode id；fallback 建空白文件。仍未用嚴格 editor/document readiness。 |
| 67-74 | Tab 經 CDP 注入；結果進 `results`，成功後嘗試 undo，但不驗 restore。 |
| 76-88 | synthetic IME 已以 defineProperty 精確強制 229，派發到 activeElement。仍不是實體 IME sequence。 |
| 91-94 | 文案已改成 CDP 注入，不再冒充實體鍵。textarea oracle 仍偏寬。 |
| 95-106 | runner/page errors 會令結果 non-zero；finally taskkill 並嘗試刪 temp；不再固定 exit 0。但本輪實跑 temp 刪除失敗且被空 catch 吞掉，見 MEDIUM-4。 |

## 對 Claude 診斷結論鏈的反證與補充假說

### 可以簽字的窄結論

「目前已安裝版與 source 的 `keyboard.js` 相同；在 clean profile、指定文件狀態與 CDP／synthetic event shape 下，Tab、Ctrl+Alt+M 與 IME 路由正常。」

本輪額外觀察：

- 桌面與開始功能表的 MindFlow link 都指向 `C:\Users\ASUS\AppData\Local\Programs\MindFlow\MindFlow.exe`。
- 未找到 MindFlow taskbar pinned link；檢查時未見 MindFlow 相關 Edge app-mode process。
- clean temp profile 的安裝版診斷實跑 3/3 PASS、errors none、exit 0，結束後 MindFlow process 與 9345 都已釋放；temp profile 未刪除。

### 仍未排除的假說

1. **OS／第三方 keyboard hook**：AutoHotkey、PowerToys Keyboard Manager、IME hotkey、Logitech/Razer/ASUS utility、overlay、遠端控制或 accessibility software 先吃掉／改寫實體事件。
2. **native foreground/focus**：CDP 可注入背景 renderer；真實鍵可能進到另一個視窗、DevTools、overlay 或剛失焦的 app。
3. **single-instance stale renderer**：重新安裝後，若舊 primary process 未退出，點新捷徑只會由 `second-instance` 喚回舊記憶體內容。磁碟 hash 正確不等於現存 renderer 已 reload。
4. **另一入口／另一份安裝**：portable、舊 per-machine 安裝、瀏覽器 bookmark、Edge/Chrome app-mode、改名捷徑或舊 AppUserModelID。現在 canonical links 正確，只證明現在。
5. **origin/profile 分離**：安裝版 origin 是 `mindflow://app`；網頁版是 `http://127.0.0.1:<port>`。Electron temp/real profile、Chrome、Edge 的 localStorage 彼此分離；同名文件可能是不同副本。
6. **實際 form/mode/selection 狀態**：contenteditable、備註 textarea、dialog、outline、presentation、focus mode、失效 selection。runner 強制選第一個 node，沒有重現問題前狀態。
7. **文件特定狀態**：損壞／重複 node id、超大文件 render lag、摺疊／overlay、DOM 與 selection 不一致。「真實文件第一個 node」仍不等於出問題的 node。
8. **鍵盤配置／AltGr／Sticky/Filter Keys**：實體 Ctrl+Alt 在部分 layout 會走 AltGr；左右修飾鍵、Fn firmware 也可能改變 event shape。
9. **真實 IME ordering**：Process keydown 的 `code` 是否空、`isComposing`、keyup 補碼、composition/beforeinput 順序會隨 IME 與 Chromium 版本變動。
10. **diagnostic runner 假陽性／假陰性**：固定 port、late console、fixed sleep、generic textarea 與 real-doc 中間寫入仍會影響證據品質。

因此，「app 端正常」應限定在已驗的應用層；下一步用診斷面板取實體事件是合理的，但要一起看 foreground、activeElement/target、↓/↑、defaultPrevented proxy 與 action 最終 UI／資料結果。

## 實際驗證紀錄

| 指令／檢查 | 最終結果 |
|---|---|
| `node --check js\editor\shortcuthelp.js` | PASS（最終交付前另做 final audit） |
| `node --check desktop\scripts\diagnose-installed.mjs` | PASS（最終交付前另做 final audit） |
| `node --test tests/*.test.mjs` | exit 0；13/13 Node runner entries PASS，內含 core 27/27、delta 21/21、IO 19/19、layout 7/7、spatial 13/13、stickers 6/6、store/search 9/9 等 |
| `npm test`（`desktop\`） | 23/23 PASS，exit 0 |
| `node tests\e2e\shortcuts.matrix.mjs` | 最終穩定 run 160/160 PASS；targeted synthetic IME 54/54；exit 0 |
| installed clean-profile `diagnose-installed.mjs` | Tab PASS、IME-SYNTH PASS、CDP Ctrl+Alt+M PASS、errors none、exit 0；但留下 3.34 MB temp profile |
| port cleanup | 本輪 matrix 結束時 4187/9337 free，diagnostic 結束時 9345 free；final audit 時另一外部 workflow 已重開 4187 |

### 共享工作樹干擾紀錄

審查期間有其他 session 同時修改 source、tests、build 與安裝版：

- 第一輪矩陣在較早 hash 上 160/160 PASS。
- 第二輪執行中，`shortcuthelp.js` 與 `diagnose-installed.mjs` 被改寫，該 moving-target run 為 158/160；兩個 failure 都發生於 reset/readiness（catch 時已是 6/6 nodes、另一格瞬間找不到 `#canvas`），不是快捷鍵 assertion。
- 兩個失敗案例在穩定版本最小重跑 2/2 PASS。
- 目標 hash 穩定 30 秒後再跑完整矩陣，最終 160/160 PASS。
- 完整 run 後，另一外部 workflow 執行 1-case `Shift+↑` filter，將共用的 `docs/SHORTCUT_MATRIX.md` 覆寫成 1/1，並留下 `node tools/serve.mjs 4187`。本報告的 160/160 依據是完整 command stdout 與 exit 0；目前該 generated artifact 不是完整 run 報告。

這份報告採最後穩定 hash 與最後完整 run，不把 moving-target failure 冒充 production regression，也不把早期 PASS 冒充最終版本證據。

## 最終裁決

- **鍵盤診斷面板 source：通過，附低風險限制。** 無 XSS、無無界 listener leak、不直接干擾 event；「已派發」不是 action success，診斷面板也會遮畫布／顯示按鍵。
- **已安裝版面板：條件通過。** 快捷鍵 routing 同版，但少 Escape hide；需重新 build/install 才與 source 完全一致。
- **安裝版診斷腳本：可作人工 diagnostic，不建議當嚴格 CI gate。** exit code／IME fidelity 已修；固定 port、late console、real-doc side effect、fixed waits、弱 oracle，以及已重現的 temp cleanup failure 仍在。
- **Claude 根因結論：部分同意。** 應用層正常的信心高；實體 Windows 輸入鏈尚未閉環，不能排除上述環境、focus、入口、profile 與文件狀態假說。
- **零破壞：最終穩定工作樹可簽。** root、desktop、完整 Chromium/Electron matrix 與 clean installed diagnostic 都是 fresh PASS。

---

簽字：**Codex（對抗性審查者）**  
日期：**2026-08-30**
