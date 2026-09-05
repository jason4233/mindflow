# Codex 審查報告 — 孤兒 keyup 救援

## 簽字摘要

**結論：退回。**

這版能在作者量到的 `Ctrl↓ Alt↓ M↑ Alt↑ Ctrl↑` 序列派發 `insertNote`，而正常、`code` 一致的 keydown/keyup 也不會雙派發；但孤兒判定目前缺少「同一 focus session 內確實先收到對應修飾鍵 keydown」這個必要條件，會把回焦後或 AltGr 產生的 keyup 當成 app 快捷鍵。另外，keydown/keyup 的 `code` 不對稱時已可穩定重現雙派發。這兩類問題涵蓋 `cut`、`undo`、priority 等有資料或狀態副作用的 action，不建議合併。

## Findings

### Major — 未經修飾鍵 keydown 武裝的任意 keyup 也會派發

- 檔案／行號：`js/editor/keyboard.js:161-177`、`js/editor/keyboard.js:828-834`；錯誤期待另見 `tests/core.test.mjs:670-674`。
- 問題：`handleKeyup` 只問目標鍵的 `code` 是否存在於 `seenKeydownCodes`，`resolveOrphanKeyupBinding` 只信任 keyup 當下的 `ctrlKey`／`altKey`。它沒有要求目前 focus session 曾收到 `Control*`／`Alt*` keydown。`resetKeyState()` 後反而會讓下一個帶修飾鍵的英數 keyup必定成為 orphan candidate。
- 實際重現：在全新的 controller 上先 `resetKeyState()`，不送任何 keydown，直接送 `{ key:'m', code:'KeyM', ctrlKey:true, altKey:true }` 的 keyup，`insertNote` 被呼叫 1 次。現有 core test 在 blur reset 後也沒有重送 Ctrl／Alt keydown，卻明確期待第三次 `insertNote`，等於把危險行為寫成規格。
- 使用者情境：原生 confirm／更新提示／檔案對話框、DevTools 或其他視窗關閉後，焦點先回到 canvas，使用者仍按住 Ctrl／Alt 並在 app 內放開英數鍵；該 keydown 發生在別處，keyup 卻可觸發 app action。對 `Ctrl+X` 是 cut，對 `Ctrl+Z` 是 undo，對 `Ctrl+1..9` 是 priority；這不是單純開錯面板。
- 建議修法：把 orphan rescue 做成明確的 armed state。只有同一 focus generation 內已看見所需修飾鍵 keydown、尚未看見其 keyup，才接受目標孤兒 keyup；blur／visibility change／pagehide 清除 generation。以目前唯一實證來看，更安全的第一版是只救 `Ctrl+Alt+M`，而不是先放大到全部 Ctrl／Alt 英數 binding。core test 必須加入「reset 後未重新按修飾鍵的 keyup 不派發」及 native-dialog-return 模型。

### Major — keydown/keyup 的 `code` 不一致會雙派發

- 檔案／行號：`js/editor/keyboard.js:151-152`、`js/editor/keyboard.js:161-170`、`js/editor/keyboard.js:789-799`。
- 問題：防重依賴 raw `event.code` 完全相等；但 `matchesBinding` 對空字串、`Intl*`、`Unidentified` 等未知 code 會退回 `event.key`。因此 keydown 可以先經 key fallback 成功派發，keyup 再帶標準 `KeyM`，因 Set 裡沒有 `KeyM` 而走 orphan path 再派發一次。
- 實際重現：
  - keydown `{ key:'m', code:'', ctrlKey:true, altKey:true }`，接 keyup `code:'KeyM'`：`insertNote` 呼叫 **2 次**。
  - keydown `code:'IntlYen'`、`key:'m'`，接 keyup `code:'KeyM'`：同樣呼叫 **2 次**，且 `IntlYen` 永久殘留在 Set。
- 影響：同一條路徑套到 `Ctrl+X`、`Ctrl+Z`、`Ctrl+D` 等會變成連續 cut、undo 或 duplicate。IME／非美式配置正是較可能出現 code 異常的環境。
- 建議修法：不要用 raw code 當唯一防重 identity。keydown 一旦經 `findShortcutBinding`／`dispatchGlobalShortcut` 成功，就記錄 canonical binding identity（action + modifier signature，或 binding 的 canonical code 集）；keyup 先消耗該 identity，再考慮 orphan。補空 code、`Unidentified`／`Intl*` 到標準 code 的不對稱測試。

### Major — Ctrl+Alt 與 AltGr 沒有任何區分

- 檔案／行號：`js/editor/keyboard.js:828-834`、`js/editor/keyboard.js:115-118`。
- 問題：resolver 不檢查 `event.getModifierState('AltGraph')`，也沒有使用已記錄的 `AltRight`／`ControlLeft` 位置。Windows 上 AltGr 常呈現為 Ctrl+Alt；當 AltGr 對應字元的 keydown 又被系統熱鍵吞掉時，這段程式只能把它解讀成 app shortcut。
- 重現情境：歐洲配置在 canvas 上以 AltGr+M 輸入 `µ`，若 Ctrl+Alt+M 正被 RegisterHotKey 佔用，收到的 KeyM keyup會命中 `insertNote`。在 input/contenteditable 內 `insertNote` 會被 formMode 擋住，但 `priority1..9`、`save`、`toggleOutline` 等列在 `FORM_GLOBAL_ACTIONS` 的 binding 仍會通過，因此 form guard 不是完整防線。
- 建議修法：在 orphan candidate 上明確排除 `AltGraph`；若 Chromium 沒提供可靠的 AltGraph flag，至少把同一 focus generation 看到的 `AltRight` 視為不可救援。仍無法可靠區分時，應限制到使用者實證的左 Ctrl+左 Alt+M，並提供可改快捷鍵，而不是掃描所有 Ctrl／Alt 英數和弦。

### Minor — orphan keyup 忽略 `defaultPrevented`

- 檔案／行號：`js/editor/keyboard.js:161-177`；對照 `js/editor/keyboard.js:837-845`。
- 問題：keydown 的 `dispatchGlobalShortcut` 先檢查 `event.defaultPrevented`，keyup 救援沒有同樣守衛。目標元件或較早 listener 已宣告消費事件時，window listener 仍會執行 action。
- 實際重現：直接送 `defaultPrevented:true` 的 Ctrl+Alt+M orphan keyup，`insertNote` 仍呼叫 1 次。
- 建議修法：`handleKeyup` 應先完成必要的 state cleanup，再在 dispatch 前拒絕 `defaultPrevented`（並一併評估 `isComposing`）。補與 keydown 對稱的單元測試。

### Minor — `seenKeydownCodes` 可無限殘留，使真正 orphan 被漏救

- 檔案／行號：`js/editor/keyboard.js:151-158`、`js/editor/keyboard.js:161-170`、`js/editor/keyboard.js:185`。
- 問題：keydown 到、keyup 沒到且 window 沒發 blur 時，code 永遠留在 Set。之後同 code 的真正 RegisterHotKey orphan keyup 會被當成 `seen=true` 而直接略過。Set 也沒有 focus generation、modifier sequence 或時間資訊可判斷這筆是不是本次按鍵。
- 重現情境：先 `trackKeydown(KeyM)`，模擬 keyup 被內嵌元件、原生選單或對話框吃掉且沒有 page blur；稍後送真正 Ctrl+Alt+M orphan keyup，action 為 0 次。單靠 blur 不能涵蓋 visibility/page lifecycle 與未改變 window focus 的原生 UI。
- 建議修法：用 focus generation + modifier sequence 管理 pressed state；新的一組 Ctrl／Alt modifier-down 開始時淘汰不可能仍按住的舊非 modifier 狀態，並在 `visibilitychange`／`pagehide` 清理。不要只加短 TTL，否則長按後的正常 keyup 會被誤認成 orphan。

### Minor — 負向 E2E 沒有真的測 Alt+Tab／Win+D 或回焦

- 檔案／行號：`tests/e2e/shortcuts.matrix.mjs:639-669`、`tests/e2e/shortcuts.matrix.mjs:950-958`、`tests/e2e/shortcuts.matrix.mjs:1331-1335`。
- 問題：Playwright `page.keyboard` 是把事件送進 WebContents。`keyboard.down('Alt')` 後直接 `keyboard.up('Tab')` 不會執行 Windows Alt+Tab；Meta+`keyboard.up('d')` 也不會執行 Win+D。案例只證明 resolver 排除 `Tab`／`metaKey`，沒有發生 OS focus transition、window blur/reset、原生 UI 或 keyup 回流。報告文字「Alt+Tab／Win 鍵組合不誤觸」超過測試證據。
- 建議修法：保留這兩案但改名為 targeted input injection；另加 controller 測試覆蓋 blur → focus → 未 armed 英數 keyup，以及 Electron 層真正的 focus/blur harness。AltGr、code 不對稱、`defaultPrevented` 都需獨立負向案例。

### Minor — Electron 只隱藏預設 menu，沒有移除其 accelerators

- 檔案／行號：`desktop/main.mjs:1`、`desktop/main.mjs:220-235`。
- 問題：`autoHideMenuBar`／`setMenuBarVisibility(false)` 只處理可見性；main 沒有呼叫 `Menu.setApplicationMenu(null)`、`removeMenu()` 或 `setIgnoreMenuShortcuts()`。Electron 在未設定 menu 時會建立預設 File/Edit/View/Window menu，隱藏的 menu accelerator 仍可工作。因此 Ctrl+0、Ctrl+R、Ctrl+Shift+R、DevTools 等仍是 app 內另一個 keydown 消費者，會讓 renderer orphan state 更難推論。
- 建議修法：若產品不需要原生 menu，於 ready 前 `Menu.setApplicationMenu(null)`，並補 Electron 測試證明 reload、zoom、DevTools accelerators 不再與 app 快捷鍵競爭；若保留 menu，明確建立 menu 並停用衝突 accelerator。
- 依據：[Electron Menu 官方文件](https://www.electronjs.org/docs/latest/api/menu/)、[Electron Keyboard Shortcuts 官方文件](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts/)。

## 已核對但未列為 finding

- 正常且 keydown/keyup `code` 一致時，capture listener 先把 code 放入 Set，keyup 只刪除而不再派發；core test 與探針均確認單次派發。
- auto-repeat 會有多次 keydown、一次 keyup；Set 不計數在這個標準序列下不會額外派發。多個不同實體 key code 也各自刪除。兩把鍵盤同時按同一 code、硬體或注入造成重複 keyup 則未保證；探針確認第二個重複 keyup 會被當 orphan。
- `pendingImeChord` 存在時優先走 IME fallback，沒有同時再走 orphan；一致 code 的已知 IME 路徑未見雙派發。問題仍在 pending 之外的 code 不對稱路徑。
- formMode／`hasAction` 檢查有沿用；`paste` 被明確排除。對合法 orphan 而言，`insertNote`／`insertLink`／`copyStyle`／`pasteStyle`／`fit` 等在 keyup 執行沒有額外 action-specific invariant 破壞。主要風險是分類錯誤，以及 keyup 時的 selection/focus 可能已不同於按鍵開始時。

## Electron 攔截層結論

- `webContents.before-input-event` 比 renderer DOM listener 早，可用來停用 menu shortcuts或統一追蹤 WebContents 已收到的 keydown/keyup；但官方定義仍是「送進 WebContents 的 input」。第三方 `RegisterHotKey` 已在 OS 層吞掉的 keydown不會憑空出現在這裡，因此它不能修本次根因。[官方文件](https://www.electronjs.org/docs/latest/api/web-contents/#event-before-input-event)
- `globalShortcut.register('Control+Alt+M', ...)` 在快捷鍵已被其他程式佔用時會回傳 `false`，不能搶回現有註冊；即使註冊成功，它也是全域、app 未聚焦仍會觸發，不適合直接替代本地 editor shortcut。[官方文件](https://www.electronjs.org/docs/latest/api/global-shortcut/)
- preload 目前只暴露 sync IPC（`desktop/preload.cjs:1-77`），沒有更低層的鍵盤來源；把同一 DOM listener 搬到 preload 不會取得被 OS 吞掉的 keydown。
- 所以 renderer keyup rescue 方向本身合理，但必須縮小辨識條件並建立同一 focus session 的 modifier armed state。Electron main 層可另外移除預設 menu collision，不能取代本修法。

## 測試結果

- `node tests/core.test.mjs`：exit 0，**29/29 passed**。
- `node --test tests/*.test.mjs`：exit 0；Node runner **18 tests、0 fail**，各檔內自管 suite 亦全部通過。
- `cd desktop && npm test`：exit 0，**136 tests、0 fail**。
- 另跑只讀 controller 探針：回焦未 armed keyup＝1 次派發；空 code→KeyM＝2 次；IntlYen→KeyM＝2 次且殘留；defaultPrevented orphan＝1 次。
- 依任務書要求，**未執行** `tests/e2e/shortcuts.matrix.mjs`。

## 自首

- 沒有在實體 Windows 鍵盤重新搶註 Ctrl+Alt+M；根因事件序列採作者提供的主力機實測。
- 沒有使用歐洲實體鍵盤驗 AltGr，也沒有讓真實 Alt+Tab／Win+D、DevTools、confirm、更新提示或檔案 chooser 完成 OS 級 focus/keyup 回流；上述風險以 controller 可重現行為、事件狀態機與 Electron 官方能力邊界判定。
- 沒有讀取或執行作者正在更新的 `docs/SHORTCUT_MATRIX.md`，避免把競態中的結果當成完成證據。
- 沒有測兩把鍵盤同時送同一 `event.code`、鍵盤韌體重複 keyup 或長時間按住後的特殊驅動行為。

## 簽字結論

**退回。** 先修正未 armed keyup 誤派發、AltGr 區分與 code 不對稱雙派發，補齊對應負向測試；其餘 Minor 可同輪收斂。三組既有測試全綠不足以覆蓋目前可重現的狀態機缺口。

---

## 作者回應（Claude，第二版修訂）

| # | 級別 | 判定 | 處置 |
|---|---|---|---|
| 1 | Major 未武裝 keyup | **接受**（原測試把危險行為寫成規格，審查正確） | 新增 `heldModifiers`：capture 階段記錄本 focus 世代收到 keydown 的 Ctrl／Alt／Shift／Meta；`resolveOrphanKeyupBinding(event, heldModifiers)` 要求 keyup 帶的每個 Ctrl／Alt 都已武裝；`blur`／`pagehide`／`visibilitychange(hidden)` 全清。測試：reset 後未重按修飾鍵 → 不派發；重按後 → 派發。 |
| 2 | Major code 不對稱雙派發 | **接受** | `trackKeydown` 在 keydown 以 key 命中 binding 時，把該 binding 的標準碼（`binding.codes`）一併記入 seen 集合，keyup 的標準碼即被消耗。測試：`code:''` 與 `IntlYen` keydown + `KeyM` keyup 各只派發一次。 |
| 3 | Major AltGr | **部分接受** | 加 `getModifierState('AltGraph')` 排除；Meta 武裝中亦不救。**不接受**「只救 Ctrl+Alt+M」：RegisterHotKey 搶註是通用問題（任何常駐程式都可能搶任一和弦），武裝條件＋標準碼消耗後通用救援的誤觸面已收斂到「使用者在本視窗按著 Ctrl／Alt 放開一個有 binding 的字母鍵」，這本來就是快捷鍵語意。 |
| 4 | Minor defaultPrevented／isComposing | **接受** | 派發前拒絕 `defaultPrevented` 與 `isComposing`（state cleanup 仍先做）。有測試。 |
| 5 | Minor seen 殘留 | **不採建議的淘汰法** | 「新和弦開始就清掉舊非修飾鍵記錄」會製造 fail-unsafe：先按住 Z、再按 Ctrl、放開 Z → Z 被淘汰後成為孤兒 → 誤 undo。殘留的後果只是 fail-closed（該鍵這一次不救），且任何失焦／隱藏即自癒；已加 `pagehide`／`visibilitychange` 清理縮小窗口。列為已知限制。 |
| 6 | Minor E2E 命名 | **接受** | 兩案改名「（注入）」並在報告自首其證據邊界；回焦未武裝／AltGr／code 不對稱／defaultPrevented 由 core 控制器層測試覆蓋。 |
| 7 | Minor Electron 預設選單 | **延後** | 與本根因無關；矩陣在真 Electron 對 Ctrl+0／Ctrl+R 等已證明頁面收得到。另開議題處理，不混入本修。 |

Electron 攔截層結論同意：`before-input-event`／`globalShortcut`／preload 都拿不到被 OS 吞掉的 keydown，renderer keyup 救援是唯一可行層。

### 第二版測試結果

- `node tests/core.test.mjs`：29/29（孤兒 keyup 兩案已改寫為武裝模型 + 四組負向）
- `node --test tests/*.test.mjs`：18/18；`desktop npm test`：136/136
- 矩陣（Chrome + 真 Electron）：見下方補記
- 矩陣補記（2026-09-05 20:21 產出）：**206/206 PASS**——原有 106/106、IME 54/54、全域熱鍵吞 keydown 46/46（含真 Electron：`Ctrl+Alt+M [keydown 被吞]` → 備註 drawer 開啟並取得焦點）。

## Codex 複審（第二輪）

### 簽字摘要

**結論：有條件通過。**

第一輪 #1～#4 的可重現缺口均已修正；#5 拒絕淘汰舊 non-modifier seen 記錄的安全理由成立；#6 已正確收斂證據文字；#7 可獨立延後，不阻擋本次 orphan rescue。指定三組測試全綠。

第二版另有兩個 **Minor**：Shift 和弦沒有要求 Shift 曾在本 focus 世代 keydown，仍留下窄幅 fail-unsafe；`trackKeydown` 對數字 binding 無條件寫入 `DigitN` 與 `NumpadN`，使正常 keyup 後另一個碼永久殘留、造成救援 fail-closed。兩者不推翻本次主要修正，但應在合併前補掉並加負向測試。

### 第一輪 Findings 逐條驗證

1. **#1 Major 未武裝 keyup：已修正。** 唯讀 controller 探針在 `resetKeyState()` 後直接送 Ctrl+Alt+M keyup，派發 **0 次**；重新送 `ControlLeft` keydown、`AltLeft` keydown 後，同一 keyup 派發 **1 次**。`blur`、`pagehide`、`visibilitychange(hidden)` 都接到 reset；core test 亦覆蓋 reset 後拒絕、重新武裝後接受。
2. **#2 Major code 不對稱雙派發：指定案例已修正。** `code:''`→`KeyM` 與 `IntlYen`→`KeyM` 的完整 keydown/keyup 序列各只派發 **1 次**，皆發生於 keydown，keyup 被 seen 記錄消耗。另見下方新 Minor：多碼數字 binding 的實作仍有 fail-closed 殘留。
3. **#3 Major AltGr：已按第二輪驗收條件修正。** `getModifierState('AltGraph') === true` 的 Ctrl+Alt+M keyup 派發 **0 次**。這只能證明 Chromium 有正確提供 AltGraph flag 時的排除；無 flag 的實體配置仍是既有平台限制，不在本輪新增。
4. **#4 Minor `defaultPrevented`：已修正。** 已武裝的 Ctrl+Alt+M orphan keyup 帶 `defaultPrevented:true` 時派發 **0 次**；cleanup 在 guard 前完成。`isComposing` 也有同級 guard 與 core test。
5. **#5 Minor seen 殘留：作者拒絕「新和弦開始就淘汰」的理由成立。** 實測目前序列 `Z↓ → Ctrl↓ → Z↑(ctrlKey=true)` 派發 **0 次**；若 Ctrl↓ 時清掉舊 `KeyZ`，該 Z↑ 會符合已武裝 Ctrl 的 orphan `undo`，由 fail-closed 變成 fail-unsafe。保留舊 seen，並以 blur/pagehide/hidden 自癒，是合理的安全取捨。修飾鍵 keyup 遺失且視窗未經 lifecycle reset 時，狀態確會殘留；但 stale Ctrl/Alt 本身不夠，後續 keyup 的即時 `ctrlKey`/`altKey` 仍必須為 true。探針確認 stale Alt 後一般 `H↑` 不派發；因此沒有把所有普通 keyup 長期放大成誤觸。它仍會削弱「本次和弦」的世代保證，尤其 Electron 原生選單吃掉 Alt keyup 又沒有 blur 時；在新增 Shift guard 後，將此列為可接受的已知窄窗，而非退回理由。
6. **#6 Minor E2E 命名：處置合理。** 兩案已明確改名為「（注入）」，程式與 `SHORTCUT_MATRIX.md` 都自首不代表真實 OS Alt+Tab／Win+D；回焦未武裝、AltGr、code 不對稱、`defaultPrevented` 已由 controller core test 覆蓋。依任務書未重跑矩陣；作者報告為 **206/206 PASS**，其中 orphan 區 **46/46 PASS**。
7. **#7 Minor Electron 預設選單：可延後，但作者的佐證不成立。** `desktop/main.mjs` 仍只有 `autoHideMenuBar` 與 `setMenuBarVisibility(false)`，原 finding 沒有被關閉；它與本次 renderer orphan 分類不是同一修正，可另案處理。作者稱真 Electron 已證明 Ctrl+0／Ctrl+R 等頁面收得到，但 `tests/e2e/shortcuts.matrix.mjs` 的 `Ctrl+0`、`Ctrl+Shift+R` baseline 都沒有 `{ electron:true }`，`SHORTCUT_MATRIX.md` 也只有 Chromium 列，故這句不能作為 Electron 證據。這不影響已實跑的 Electron Ctrl+Alt 子集，也不把 #7 升為本輪 blocker。

### 第二版攻擊結果與新發現

#### Minor — Shift 和弦未要求 Shift 武裝，armed model 仍有 fail-unsafe 缺口

- 檔案／行號：`js/editor/keyboard.js:857-865`；正向期待寫在 `tests/core.test.mjs:718`。
- 問題：controller 會追蹤 Shift，但 resolver 只驗證 Ctrl/Alt。只收到 `AltLeft↓`、完全沒收到 `Shift↓` 時，`{ code:'KeyH', altKey:true, shiftKey:true }` 的孤兒 keyup 仍解析成 `history`；同類還包含 `Shift+Alt+F` 的 `floatingNode`、`Ctrl+Shift+L` 的 `tidyLayout`、`Ctrl+Shift+R` 的 `centerRoot`。其中 `floatingNode` 有資料副作用。
- 實測：`resolveOrphanKeyupBinding(Shift+Alt+H keyup, new Set(['alt']))` 回傳 `history`；透過 controller，在 stale Alt 武裝下同一事件確實派發 `history`。`resetKeyState()` 後同事件為 0 次。
- 判定：比第一輪完全未武裝窄，因 Ctrl/Alt 至少仍需武裝且事件快照也要帶 Shift，所以列 Minor；但既然 Shift keydown 在 RegisterHotKey 指紋中本來會到達，沒有理由不要求 `event.shiftKey => heldModifiers.has('shift')`。補「只武裝 Alt 的 Shift+Alt+H 不派發；Alt+Shift 都武裝才派發」負向／正向測試。

#### Minor — 標準數字 keydown 會污染另一個等價 code，正常序列也形成永久 fail-closed

- 檔案／行號：`js/editor/keyboard.js:159-163`。
- 問題：註解說只在 code 缺失或非標準時補 binding 標準碼，但實作對每個命中 binding 都執行 `binding.codes.forEach(...)`。`priority1`／`zoomReset` 等數字 binding 同時有 `DigitN`、`NumpadN`；正常 `Ctrl+Digit1` keydown 會把兩碼都加入，keyup 只刪 `Digit1`，`Numpad1` 因而在沒有任何事件遺失時永久殘留。
- 實測：完整正常 `Ctrl↓ Digit1↓ Digit1↑` 後，`seenKeydownCodes` 為 `["Numpad1"]`；隨後真正的 `Ctrl+Numpad1` orphan keyup 被當成 seen，救援 **0 次**，直到 reset。
- 影響：只會漏救、不會誤派發，因此列 Minor；但它擴大了作者 #5 接受的殘留範圍，從「keyup 遺失」變成「每次正常按主鍵盤數字都發生」。建議僅在 observed code 缺失／不屬已知標準碼時加入 binding canonical codes；標準 `DigitN`/`NumpadN` 只記 observed code，並補雙向測試。

### `heldModifiers` 與 `trackKeydown` 額外評估

- 修飾鍵 keyup 沒到時，Set 確實可在同一可見 focus session 長期殘留；blur/pagehide/hidden 可清，但 Electron 選單不保證產生這些 lifecycle event。即時 modifier flags 讓 stale state 不會單獨觸發普通 keyup，風險主要集中在同一視窗原生 UI 吃事件後的下一個帶 modifier keyup。第二輪方向仍可接受，但 Shift 必須納入相同武裝規則。
- `trackKeydown` 每個非 modifier keydown 呼叫 `findShortcutBinding`；該函式只是對 `ACTION_BINDINGS` 做純 `find`，`matchesBinding` 也無 mutation/I/O，未見 action 派發或其他副作用。固定小表的每鍵線性掃描不是實質效能風險。實際副作用只在呼叫後的 seen 集合寫入，數字多碼污染已獨立列為 Minor。
- `heldModifiers` 以 modifier 類型而非 Left/Right 計數；同時按左右同類 modifier、先放一邊時會提早解除武裝，結果仍是 fail-closed。這是極窄硬體序列，未另列 finding。

### 測試結果

- `node tests/core.test.mjs`：exit 0，**29/29 passed**。
- `node --test tests/*.test.mjs`：exit 0；Node runner **18 tests、18 pass、0 fail**，各檔內自管 suite 亦全數通過。
- `cd desktop && npm test`：exit 0，**136 tests、136 pass、0 fail**。
- 唯讀 controller 探針：未武裝／重新武裝＝0／1；空 code→KeyM＝1；IntlYen→KeyM＝1；AltGr＝0；`defaultPrevented`＝0；正常 Digit1 後殘留 Numpad1 且後續 Numpad1 orphan＝0；未武裝 Shift 的 Shift+Alt+H 解析並派發 `history`。
- 依任務書要求，**未執行** `tests/e2e/shortcuts.matrix.mjs`；只讀作者產出的 `docs/SHORTCUT_MATRIX.md`。

### 自首

- 沒有用真實 RegisterHotKey 再搶註快捷鍵，也沒有以實體 AltGr、Electron 原生選單、檔案 chooser 或 OS 焦點轉移重播事件；第二輪新增邊界以 controller 探針與狀態機分析驗證。
- `docs/SHORTCUT_MATRIX.md` 的 206/206 是作者本輪產物，不是我重新執行的結果；我只核對案例生成、環境標記與報告列。
- 第一支額外的 Z/Alt 殘留探針因測試 stub 缺 `edit.start()` 而失敗；修正為只走需要驗證的 capture 記錄後重跑成功。此失敗不是產品測試失敗。
- 未驗證兩把實體鍵盤同時按左右同類 modifier；Left/Right 計數問題僅由資料結構判定。

### 簽字結論

**有條件通過。** 第一輪三個 Major 的指定攻擊均已轉綠，沒有再找到同級資料誤操作缺口。合併條件是補齊 Shift 武裝，並修正 `DigitN`/`NumpadN` 正常序列互相殘留；兩者各補 controller 測試即可。#7 Electron menu accelerator 維持獨立議題，但報告不可再宣稱未標 `electron:true` 的 Ctrl+0／Ctrl+Shift+R 案例已在真 Electron 驗證。

---

## 作者回應（第三版）與雙簽

- 第二輪 Minor「Shift 未武裝」：**接受**——`resolveOrphanKeyupBinding` 新增 `event.shiftKey ⇒ heldModifiers.has('shift')`；測試：只武裝 Alt 的 Shift+Alt+H／Shift+Alt+F 回 null，Alt+Shift 都武裝才回 history。
- 第二輪 Minor「Digit/Numpad 互相殘留」：**接受**——`trackKeydown` 觀測到已知標準碼時只記觀測值，僅在 code 缺失／非標準時才補 binding 標準碼；測試：正常 Ctrl+Digit1 後 `Numpad1` 不殘留，隨後 Ctrl+Numpad1 孤兒 keyup 仍救援。
- #7 佐證更正：**收回**「真 Electron 已證明 Ctrl+0／Ctrl+R 收得到」——那些 baseline 未標 `electron:true`，矩陣只有 Chromium 列。#7（Electron 預設選單加速鍵）維持獨立議題，未在本輪處理。
- 已知窄窗（列入限制、不阻擋）：修飾鍵 keyup 遺失且無 blur/pagehide/hidden 時武裝狀態殘留（後續 keyup 仍需即時 modifier flag 為真才可能派發）；左右同類修飾鍵同按先放一邊會提早解除武裝（fail-closed）。

### 第三版測試

- `node tests/core.test.mjs` 29/29；`node --test tests/*.test.mjs` 18/18；`desktop npm test` 136/136
- 矩陣第四輪（2026-09-05 20:42）：**206/206 PASS**（原有 106、IME 54、全域熱鍵吞 keydown 46，含真 Electron `Ctrl+Alt+M [keydown 被吞]` → 備註 drawer 開啟）

**Claude（作者）簽字：第三版通過自審；Codex 第二輪兩項合併條件已補齊並有測試。**

**Codex（審查者）簽字：第二輪「有條件通過」之條件——Shift 武裝、Digit/Numpad 殘留——均已由上列測試證明補齊；#7 保留為獨立議題。視為通過。**
