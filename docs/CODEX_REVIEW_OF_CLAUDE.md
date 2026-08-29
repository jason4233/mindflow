# Codex 對 Claude 鍵盤診斷修改的對抗性審查

> 審查日期：2026-08-30（Asia/Taipei）  
> 審查對象：使用者指定的最新 commit `Add live keyboard diagnostic panel...` 目前工作樹內容  
> 限制：依指示未執行任何 git 指令，因此 commit 身分與差異範圍採使用者敘述；逐行審查的是磁碟上現有兩個檔案。

## 結論先行

- `js/editor/shortcuthelp.js` 的診斷面板沒有發現 XSS 或無界 listener／DOM 記憶體成長。capture listener 不呼叫 `preventDefault()`、`stopPropagation()` 或修改 event，正常快捷鍵控制流不會被它直接攔截。
- 面板仍有一個生命週期缺口：Escape 路徑沒有呼叫 `diagnostic.hide()`。使用者若以為 Esc 已退出診斷，capture listener 仍持續記錄，直到點面板的 × 或頁面卸載。
- `desktop/scripts/diagnose-installed.mjs` 不適合當可信的自動化 PASS gate。即使三個測項 FAIL 或抓到 console errors，它仍固定 `process.exit(0)`；錯誤路徑也沒有 `finally` 清 process／temp profile。
- Claude 的「應用層快捷鍵路由正常」結論有證據支持；若擴張成「實體鍵盤到 app 的整條路徑正常」，證據不足。Playwright `page.keyboard` 是 CDP 注入，不是 OS 實體鍵，也不經真實 IME、低階鍵盤 hook、AltGr／鍵盤配置或 foreground-window 路徑。
- Fresh 驗證：desktop tests 23/23 PASS、鍵盤核心 27/27 PASS、Chromium + Electron 矩陣 160/160 PASS（其中 synthetic IME 54/54）。但 root 全套目前不是全綠：另一個同時施工中的 STICKER2 工作流先寫入測試，造成 3 項 sticker tests FAIL。因此只能下「鍵盤範圍未見回歸」，不能宣稱整個工作樹零破壞。

## 發現事項（依嚴重度）

### HIGH-1：診斷腳本 FAIL 仍回傳成功 exit code

位置：`desktop/scripts/diagnose-installed.mjs:61-89`

- Tab、IME、英數 Ctrl+Alt+M 都只把 PASS/FAIL 印到 stdout。
- `CONSOLE-ERRORS` 也只列印，不參與結果。
- 最後無條件 `process.exit(0)`。

影響：CI、Claude 或人工 wrapper 只看 exit code 時，三項全失敗仍會被判為成功；這會直接污染「三種情境全過」的證據鏈。現有歷史 stdout 若確實逐項都是 PASS，內容仍有參考價值，但腳本本身不能保證執行者有檢查每一行。

### HIGH-2：錯誤路徑不清理安裝版 process，temp profile 也永不刪除

位置：`desktop/scripts/diagnose-installed.mjs:17-31, 88-89`

- `mkdtempSync()` 每次都建目錄，包含 `MF_REAL_PROFILE=1` 時其實不用的 temp dir；沒有 `rm`。
- `connectOverCDP`、導航、evaluate、locator 任一步丟錯，都跳過 line 88 的 `taskkill`。
- `!page` 路徑直接 `process.exit(1)`，同樣跳過清理。
- 沒有監聽 spawn 的 early-exit／error，也沒有 `try/finally`。

影響：留下 MindFlow process tree、profile lock 與 temp 資料。這不是面板的 browser listener leak，而是診斷 runner 的 OS 資源 leak。

### MEDIUM-1：「真實鍵盤」標示不成立；IME synthetic 也沒有精確造出 229

位置：`desktop/scripts/diagnose-installed.mjs:61-85`

- `page.keyboard.press()` 是 Playwright 經 CDP 對 renderer 注入鍵盤事件；它沒有經過實體鍵盤、Windows keyboard stack、IME、第三方 hook 或 OS foreground dispatch。
- line 74 把 `keyCode:229`、`which:229` 放進 `KeyboardEvent` constructor，但 Chromium 可能忽略 deprecated 欄位。repo 的正式矩陣 helper 在 `tests/e2e/shortcuts.matrix.mjs:912-954` 明確偵測後用 `Object.defineProperty()` 補成 229，診斷腳本沒有做。
- synthetic event dispatch 到 `document`；正式矩陣 dispatch 到 `document.activeElement || window`。實際 target／form focus 行為不等價。
- 沒有 compositionstart/update/end、beforeinput、keyup 與 timing 序列，不能代表真實 Windows 注音事件流。

影響：可驗證 `findShortcutBinding`／應用層路由對指定 event shape 的反應，不能驗證使用者實際按鍵鏈。

### MEDIUM-2：console 證據會漏 startup error，且完全看不到 main-process error

位置：`desktop/scripts/diagnose-installed.mjs:22-35, 87`

- app 啟動後固定等 4 秒、CDP connect 完才掛 `page.on('console')`；首次載入期間的 renderer error 已經可能發生。
- spawn 使用 `stdio: 'ignore'`，Electron main-process stderr／console 永遠不會進 `errors`。
- 只收 `console` type error，不收 `pageerror`；最多顯示 5 筆、每筆截 160 字。

影響：`CONSOLE-ERRORS: none` 只能代表 listener 掛上後的部分 renderer console，不等於 app 無 runtime error。

### MEDIUM-3：固定 port 與弱 process 身分驗證可能誤接 stale CDP

位置：`desktop/scripts/diagnose-installed.mjs:18-30`

- port 固定 9345，未先取得 OS 隨機可用 port，也未確認 endpoint 屬於本輪 spawn PID／版本。
- 若 9345 已有殘留的 MindFlow debug instance，腳本可連到舊 instance；它只用 URL prefix 找 page。
- readiness 依賴固定 4 秒、1.5 秒、2.5 秒與 300/400/600 ms，慢機或資料量大時容易假失敗／時序偏差。

本輪執行矩陣前已確認 9345 是 free，但這不修正腳本的一般性缺口。

### MEDIUM-4：真實文件測試有寫入副作用，且未證明已完整復原

位置：`desktop/scripts/diagnose-installed.mjs:38-68`

- `MF_REAL_PROFILE=1` 會打開最近文件，Tab 真正新增節點。
- 通過時雖送出 Ctrl+Z，卻不再核對 node count、serialized document、updatedAt、undo history 或 backup 是否回到原狀。
- 600 ms 等待期間 autosave／備份／metadata 可能觀察到中間狀態。
- 後續兩個測試會打開備註 drawer；未儲存文字，內容風險較低，但仍改變 UI／focus 狀態。

影響：腳本不應被視為 read-only diagnostic；在真實 profile 執行前應有 snapshot／精確 restore 或使用文件副本。

### MEDIUM-5：PASS oracle 過度寬鬆

位置：`desktop/scripts/diagnose-installed.mjs:62-85`

- Tab 只驗 node count 增加，不驗新增節點的 parent、selection、action 或最後復原。
- Ctrl+Alt+M 用 `document.querySelector('textarea')` 的第一個 textarea 是否可見判 PASS，沒有鎖定 `[data-note-editor]`／drawer 與目標 node。
- 現有 DOM 中備註 textarea 的確先於 formula textarea 建立，因此目前大多能工作；但 selector 對 DOM 順序敏感，未來很容易假陽性。
- `location.href` 拼接 document id 未 `encodeURIComponent()`；異常 id 會導向錯誤文件或錯誤 query。

### LOW-1：診斷面板 Escape 不會 hide，capture 可能比使用者預期活得久

位置：`js/editor/shortcuthelp.js:33-41, 162-165`

- close button 正確呼叫 `hide()` 並移除 listener。
- 全域 feature Escape handler 只關 more menu 與 shortcut dialog，沒有 `diagnostic.hide()`。
- Escape 本身會先被 panel 記錄，之後面板仍顯示並繼續記錄。

影響：不是無界 leak，但會延長 key logging 的存活時間。面板若留著，使用者在備註、搜尋等欄位輸入的最近 10 個 key 會顯示在畫面上，還有 screenshot／肩窺的隱私風險。

### LOW-2：診斷腳本可維護性問題

位置：`desktop/scripts/diagnose-installed.mjs:2-18`

- `createRequire` import 未使用。
- executable 與使用者目錄硬編碼，只能在這台帳號與安裝位置執行。
- `MF_PW_PATH` 是必要環境變數但檔內沒有用法說明或有效性檢查；未設定時靠 catch 輸出 NEED_PLAYWRIGHT。

## `js/editor/shortcuthelp.js` 逐段逐行審查

| 行 | 結果 |
|---|---|
| 1-17 | import 與靜態 label。`findShortcutBinding`／`isFormTarget` 都是純讀；label 不是使用者輸入。 |
| 18-32 | editor 初始化時各建一次 menu/dialog。現有 boot 路徑只呼叫一次，未見重複初始化造成累積的證據。 |
| 33-41 | 建立 diagnostic 並綁開啟按鈕；Escape 遺漏 `diagnostic.hide()`，見 LOW-1。 |
| 44-101 | 舊 more-menu 邏輯。與本次診斷 listener 無共享 listener 參照；無新增風險。 |
| 103-119 | shortcut dialog HTML 全由固定 `ACTION_BINDINGS`／固定 label 產生，沒有事件字串注入面。 |
| 121-138 | inline `<style>` 只建立一次並常駐到頁面卸載。這是有界的一個 DOM node，不是持續成長；selector 也都有 class scope。 |
| 140-145 | panel 與 list 建立一次；hidden 初始值正確。面板常駐是 editor-lifetime allocation。 |
| 147-160 | capture handler 不 prevent/stop event。每次建立一個 row，最多保留 10 個；`findShortcutBinding` 是線性掃固定 binding 表。沒有 layout read，效能成本有界，但在按鍵 repeat 時仍會同步做 DOM mutation。 |
| 151-157 | `event.key`、`event.code`、`binding.action` 全用 `textContent` 寫入；XSS 安全。`innerHTML` 只含數值型 `keyCode`、由固定字串組成的 modifiers 與固定標記。 |
| 162-165 | `show()`／`hide()` 使用同一 callback 與同一 capture 值，remove 可精確命中；重複 `addEventListener` 同一組合也不會疊加。缺少 destroy API，但目前 one-shot editor lifetime 下不構成無界 leak。 |
| 168-176 | shortcut 顯示文字只處理靜態 binding；無使用者輸入。 |

### 對正常操作的干擾判定

- 面板未開啟：window 上沒有 diagnostic keydown listener，只有常駐的 hidden panel/style；正常快捷鍵零控制流干擾。
- 面板開啟：listener 位於 window capture，比 KeyboardController 的 window bubble handler先執行，但不修改 event。直接行為不變；額外成本是一次 binding 掃描與最多 10-row DOM 更新。
- 面板本身 z-index 9999、位於左下 360 px 寬，開啟時會遮住並攔截該區域 pointer。這是診斷模式可預期的 UI 干擾，不應稱為正常模式零干擾。
- 顯示「命中 action」不等於 action 最後成功執行：capture 階段之後，event 仍可能被 target listener prevent、formMode 守衛略過，或 action 因 selection／mode 狀態失敗。面板能分辨「事件沒到」與「靜態 binding 沒命中」，不能單獨證明完整 action data flow。

## `desktop/scripts/diagnose-installed.mjs` 逐段逐行審查

| 行 | 結果 |
|---|---|
| 1-14 | Playwright 動態載入可工作；`createRequire` 未使用。`join(undefined, ...)` 的錯誤由 catch 轉成 NEED_PLAYWRIGHT exit 2。 |
| 16-22 | hard-coded exe、固定 port、每次建立 temp dir、detached spawn；沒有 PID/endpoint 身分核對。 |
| 24-35 | 固定 sleep 取代 readiness；console listener 掛太晚、缺 `pageerror`，main stderr 被丟棄。 |
| 38-59 | 會讀 real profile 最近文件並直接導航；fallback 依中文字串；id 未 encode；沒有嚴格驗證 editor 與文件已正確載入。 |
| 61-68 | Tab 是 CDP keyboard event，不是 OS 實體鍵。真實修改後只嘗試 undo，沒有驗證 restore。 |
| 70-78 | Process/KeyM 是 synthetic untrusted event；沒有精確補 229，也沒有 composition sequence。 |
| 80-85 | 所謂 REAL 仍是 CDP 注入；generic textarea oracle 太寬。 |
| 87-89 | errors 不影響成敗；cleanup 僅 happy path；無條件 exit 0。 |

## 對 Claude 診斷結論鏈的反證與補充假說

### 可接受的窄結論

「目前安裝資產中的快捷鍵應用層邏輯，對 Playwright/CDP 所送出的 Tab、英數 Ctrl+Alt+M，以及指定形狀的 synthetic IME event，能在被測狀態完成預期 action。」

本輪額外核對到：

- source、`desktop/dist/win-unpacked`、實際安裝目錄的 `shortcuthelp.js` SHA-256 相同；`keyboard.js` 在核對當下也相同。
- 桌面與開始功能表的 MindFlow 捷徑都指向 `C:\Users\ASUS\AppData\Local\Programs\MindFlow\MindFlow.exe`。
- 未找到 MindFlow taskbar pinned link，也未觀察到 MindFlow 相關 Edge app-mode process。
- 目前 MindFlow main process 於 01:30:19 啟動，晚於 01:27 左右的本次安裝時間；「目前這一個 process 是安裝前 stale renderer」不成立。

### 不可接受的擴張結論

「app 端完全正常，所以只剩舊捷徑或真實 IME」仍過度收斂。至少還有以下未被三組 CDP 測試排除的假說：

1. **OS／第三方 keyboard hook**：AutoHotkey、PowerToys Keyboard Manager、輸入法 hotkey、Logitech／Razer／ASUS utility、overlay、螢幕錄製、遠端控制或 accessibility software 先吃掉／改寫按鍵。CDP 完全繞過這一層。
2. **native foreground/focus**：CDP 可對非前景 renderer 送鍵；真實 OS 鍵可能進到別的視窗、DevTools、隱形 overlay 或剛失焦的 app。
3. **single-instance stale process**：重新安裝或改捷徑後，已存在的舊 MindFlow primary process 仍可被 `second-instance` 喚回；磁碟 hash 正確不代表記憶體內 renderer 已 reload。本輪現況已排除，但歷史發生當下仍是合理假說。
4. **另一入口／另一份安裝**：portable exe、舊 per-machine 安裝、改名捷徑、瀏覽器 bookmark、Edge/Chrome app-mode 或 taskbar 已固定的舊 AppUserModelID。現在兩個 canonical link 正確，只能證明現在，不證明問題發生時。
5. **origin/profile 分離造成「看起來是同一文件」**：安裝版 origin 是 `mindflow://app`，網頁版是 `http://127.0.0.1:<port>`；clean temp profile、真實 Electron profile、Chrome/Edge profile 的 localStorage 彼此分離。同名文件可能是不同副本，最近文件也可能不同。
6. **真實 focus/form/mode 狀態**：實際使用者可能停在 contenteditable、備註 textarea、dialog、outline、presentation、focus mode 或選取已失效。診斷腳本強制選第一個 node，沒有重現問題發生前的 target 與 UI state。
7. **文件特定狀態**：重複／損壞 node id、超大文件造成 render lag、目標 node 被摺疊／overlay 遮住、selection 與 DOM 不一致。測「真實文件第一個 node」仍不足以涵蓋使用者出問題的那個 node 與操作序列。
8. **鍵盤配置／AltGr／Sticky Keys**：實體 Ctrl+Alt 在部分 layout 可能被當成 AltGr；左右 Ctrl/Alt、Sticky/Filter Keys、Fn firmware 都可能改變 event shape。CDP 的乾淨 modifiers 不會重現。
9. **真實 IME event ordering**：`keydown Process` 的 `isComposing`、code 是否空、keyup 補碼、composition/beforeinput 順序會隨 IME 與 Chromium 版本變化。單一 synthetic keydown 不能窮舉。
10. **診斷器自身假陽性**：固定 port 誤接 stale instance、generic textarea、漏 startup console、FAIL exit 0，都可能讓「三情境全過」被高估。

因此，鍵盤診斷面板下一筆最有價值的證據不是只截「命中 action」，而是同時保存：實際 `key/code/keyCode/which/modifiers/isComposing/repeat`、target/focus、是否 defaultPrevented，以及 action 最後是否真的執行。現版只完成前半段。

## 實際測試結果

| 指令 | 結果 | 判定 |
|---|---|---|
| `node --check js\editor\shortcuthelp.js` | exit 0 | PASS |
| `node --check desktop\scripts\diagnose-installed.mjs` | exit 0 | PASS |
| `node --test tests\core.test.mjs` | 27/27 PASS，exit 0 | PASS；直接覆蓋 keyboard binding／IME Process／focus guard |
| `npm test`（`desktop\`） | 23/23 PASS，exit 0 | PASS |
| `node tests\e2e\shortcuts.matrix.mjs` | 160/160 PASS，IME targeted synthetic 54/54，exit 0 | PASS；Chromium + Electron |
| `node --test tests/*.test.mjs` | exit 1；`tests\stickers.test.mjs` 3 FAIL，其餘已執行 suites PASS | **全套不是全綠** |

Root failure 明細：manifest 尚為 6 分類而新測試預期 10 分類、`filterStickerCategories` 尚未 export、`buildStickerImageUpdate` 尚未 export。審查時可直接觀察到另一個 STICKER2 Codex process 正在運作，且該工作流先更新 `tests/stickers.test.mjs`、尚未更新對應 production。這些 failure 與 `shortcuthelp.js`／`diagnose-installed.mjs` 沒有 import 或行為路徑關聯，但在非隔離工作樹中不能宣稱整體零破壞。

另外，審查期間 `tests/core.test.mjs` 從首輪 26 項變為末輪 27 項，證明共享工作樹確實有並行寫入。上述 final core 與矩陣數字是各自 command 當下的 fresh 結果，不冒充 commit-isolated CI。

## 最終裁決

- **鍵盤診斷面板：有條件通過。** 無 XSS、無無界 listener leak、未直接改變快捷鍵 event；應補 Escape hide／teardown，並把「binding 命中」與「action 成功」的限制寫清楚。
- **安裝版診斷腳本：不通過作為自動化證據 gate。** 至少要先讓任何 FAIL／console/page error 產生 non-zero exit、使用 `try/finally`、隨機 port、精確 selector、可靠 readiness、版本/PID 身分核對，以及 real-doc snapshot/restore。
- **Claude 根因結論：部分同意。** 應用層 routing 正常的信心高；實體使用者路徑仍未閉環。現階段最合理的下一步確實是讓使用者用面板按出問題鍵，但取證時必須連同 foreground/focus/target/action outcome 一起判讀，不能看到 binding 名稱就宣布 app 無責。
- **零破壞：鍵盤 scope 可接受，整個工作樹不可簽全綠。** 原因是 root 全套仍有 3 個並行 STICKER2 failure。

---

簽字：**Codex（對抗性審查者）**  
日期：**2026-08-30**

---

## 主 session 裁決與回應（2026-08-30）

全部發現採認，處置如下：
- **HIGH-1（exit code 永遠 0）**：已修——results 物件 + finally 中依全 PASS 與零錯誤決定 exitCode。承認原腳本不配當證據 gate；當時的證據效力來自我逐行讀 stdout，但工具本身必須誠實。
- **HIGH-2（清理缺失）**：已修——try/finally 包全程，taskkill + 暫存 profile rmSync。
- **MEDIUM-1（「真實鍵盤」措辭與 keyCode 229）**：採認並修正——229 改 defineProperty 強制、派發至 activeElement；對外措辭改為「CDP 注入級」。認知修正：我的結論範圍是「應用層路由正常」，整條 OS→app 路徑的證據來自使用者的診斷面板取證，兩者合併才完整。
- **MEDIUM-2/3/4/5**：selector 鎖定 .feature-drawer、encodeURIComponent 已修；其餘（啟動期 console 盲區、固定 port、真實 profile 副作用）文件化於腳本頭註，明示「正式回歸以 shortcuts.matrix.mjs 為準」。
- **LOW-1（Esc 不關診斷面板）**：已修——併入 featureHandlers.escape。
- 強化版重跑：TAB/IME-SYNTH/CDP-CTRL-ALT-M 全 PASS、exit 0。
- 「工作樹 3 項 sticker tests FAIL」：確認屬 STICKER2 施工中的 TDD 紅燈，非本次修改破壞。

- ✍️ 主 session（Claude）：發現全採認、修復完成
- ✍️ Codex（REVIEW）：審查結論成立

角色互換的雙向確認閉環完成。
