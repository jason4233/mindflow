/**
 * 編輯器組裝入口：載入文件、串接 command、佈局、渲染與全部互動控制器。
 */
import { DOC_KEY_PREFIX, createDocument, loadDocument, recoverDocument, saveDocument } from '../store.js'
import { strings } from '../strings.js'
import { protectSyncAppliedReload } from '../settings.js'
import { createMeasureFn, render } from './render.js'
import { layout } from './layout.js'
import { CommandManager, moveNode, toggleCollapse, updateDocumentTitle, updateText } from './commands.js'
import { findNode } from './model.js'
import { ViewportController } from './viewport.js'
import { SelectionManager } from './selection.js'
import { EditController } from './edit.js'
import { KeyboardController } from './keyboard.js'
import { DragDropController } from './dnd.js'
import { initializeToolbar } from './toolbar.js'
import { initializeSidepanel } from './sidepanel.js'
import { initializeContextMenu } from './contextmenu.js'
import { initializeOutline } from './outline.js'

// === PHASE-B INIT (DELTA import) ===
import { initializeDelta } from './attachments.js'
import { initializeGamma } from './viewmode.js'

// === PHASE-FINAL C1/C2 INIT imports ===
import {
  applyDefaultThemeToDocument,
  applyScopedSpacing,
  getTheme,
  measureNodeWithWidth
} from './themes.js'
import { initPresentation } from './presentation.js'
import { initFocus } from './focus.js'
import { initHistory } from './history.js'
import { initFormula } from './formula.js'
import { initSplitscreen } from './splitscreen.js'
import { initMobileChrome } from './mobilechrome.js'
// === C1 MOBILE TOUCH INIT import ===
import { initTouchGestures } from './touch.js'

const elements = {
  canvas: document.querySelector('#canvas'),
  world: document.querySelector('#world'),
  svgLayer: document.querySelector('#connections-layer'),
  nodesLayer: document.querySelector('#nodes-layer'),
  measureLayer: document.querySelector('#measure-layer'),
  selectionRectangle: document.querySelector('#selection-rectangle'),
  indicator: document.querySelector('#drop-indicator'),
  zoomDisplay: document.querySelector('#zoom-display')
}

const requestedId = new URLSearchParams(window.location.search).get('id')
let doc = requestedId ? loadDocument(requestedId) : null
if (!doc && requestedId && localStorage.getItem(`${DOC_KEY_PREFIX}${requestedId}`) !== null) {
  // 主檔存在但解析失敗＝損毀。絕不能靜默換成空白新文件（舊行為會換掉網址，讓 30 份好快照永遠搆不到）
  doc = recoverDocument(requestedId)
  if (doc) {
    window.alert('這份文件的主檔資料損壞，已自動從最近的版本快照還原。')
  } else {
    window.alert('這份文件的資料損壞且沒有可用的版本快照。原始資料已保留未動，請回首頁或聯絡開發者處理。')
    window.location.href = 'index.html'
    throw new Error(`MindFlow：文件 ${requestedId} 損毀且無快照可還原`)
  }
}
if (!doc) {
  doc = createDocument()
  history.replaceState(null, '', `editor.html?id=${encodeURIComponent(doc.id)}`)
}
// 多分頁 CAS：追蹤本分頁所知的最後寫入版本，寫入前比對，舊分頁不得蓋掉新內容
let lastSavedUpdatedAt = doc.updatedAt || null
// === PHASE-FINAL C1 default theme hook ===
if (applyDefaultThemeToDocument(doc)) {
  const stamp = saveDocument(doc)
  if (stamp) lastSavedUpdatedAt = stamp
}
document.title = `${doc.title} — ${strings.productName}`

let positions = new Map()
let saveTimer = null
let toolbar = null
let selection = null
// 本分頁是否有尚未寫入 localStorage 的變更（多分頁防蓋寫的關鍵旗標）
let dirty = false
// 版本衝突後鎖住自動存檔，等使用者決定（重新載入或強制覆蓋）
let saveBlocked = false
// 預覽保護窗：此時間之前 saveNow 不寫入，避免滑桿/色票拖曳中的暫態被 Ctrl+S 或殘留計時器落盤
let previewUntil = 0
let syncReloadTimer = null

const baseMeasureFn = createMeasureFn(elements.measureLayer, doc)
// === PHASE-FINAL C1 node width hook ===
const measureFn = (node, depth) => measureNodeWithWidth(node, baseMeasureFn(node, depth), depth, getTheme(doc.themeId))
const viewport = new ViewportController({
  canvas: elements.canvas,
  world: elements.world,
  zoomDisplay: elements.zoomDisplay
})

const manager = new CommandManager({
  limit: 100,
  onChange: event => {
    renderAll()
    // 預覽（滑桿／色票拖曳中的暫時值）只重繪不入庫，等 commit 成正式 command 才存檔
    if (event?.type === 'preview') {
      previewUntil = Date.now() + 10000
    } else {
      previewUntil = 0
      scheduleSave()
    }
  }
})

selection = new SelectionManager({
  canvas: elements.canvas,
  nodesLayer: elements.nodesLayer,
  selectionRectangle: elements.selectionRectangle,
  getDoc: () => doc,
  getPositions: () => positions,
  viewport,
  isPanMode: () => viewport.spacePressed
})

const edit = new EditController({
  nodesLayer: elements.nodesLayer,
  onCommit: (id, text) => manager.execute(updateText(doc, id, text)),
  // 編輯中每次輸入都排一次快照存檔（有 max-wait，連續輸入不會被無限延後）
  onLiveChange: () => scheduleLiveSave(),
  // 編輯結束（含 Esc 取消、沒改字的 Enter）後重新預備：這兩條路徑沒有 render，不會經過 selectionchange
  onSessionEnd: () => syncArmedInput()
})
edit.bindEvents()

// 預備輸入（armed）接線：節點被選取且沒有在編輯時，讓它的文字元素先取得焦點，
// 中文輸入法才能從第一個鍵就組字。規則：
// - 指標按下時先解除（dnd 以 isContentEditable 判斷是否可拖，且 mousedown 預設動作會搶焦點），
//   指標放開（click 已派發）後再重新預備。
// - 焦點若在面板／對話框等其他控制項上，不搶焦點（否則使用者點色票時游標會跳回節點）。
// - 觸控裝置不預備：聚焦 contenteditable 會彈出軟鍵盤。
const COARSE_POINTER = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
let pointerHeldInCanvas = false
function focusIsFree() {
  const active = document.activeElement
  // 工具列按鈕（加下級、加同級…）按完焦點會留在按鈕上，但使用者下一步就是打字：視為可搶
  return !active || active === document.body || active === elements.canvas || elements.nodesLayer.contains(active)
    || Boolean(active.closest?.('.toolbar-capsule'))
}
function syncArmedInput() {
  if (COARSE_POINTER || pointerHeldInCanvas || edit.isEditing) return
  const id = selection?.primaryId
  if (!id || selection.ids.size !== 1 || !focusIsFree()) { edit.disarm(); return }
  edit.arm(id)
}
window.addEventListener('mindflow:selectionchange', syncArmedInput)
elements.canvas.addEventListener('pointerdown', () => { pointerHeldInCanvas = true; edit.disarm() }, true)
window.addEventListener('pointerup', () => {
  if (!pointerHeldInCanvas) return
  pointerHeldInCanvas = false
  // click 在 pointerup 之後同步派發；延到下一個 task 再預備，避免 mousedown/click 預設動作搶走焦點
  window.setTimeout(syncArmedInput, 0)
})
window.addEventListener('pointercancel', () => { pointerHeldInCanvas = false })
// 對話框／面板關閉後焦點回到畫布時，把單選節點重新預備（否則下一個字走回舊的 keydown 種字路徑）
elements.canvas.addEventListener('focus', () => window.setTimeout(syncArmedInput, 0))

const keyboard = new KeyboardController({
  doc,
  manager,
  selection,
  viewport,
  edit,
  save: saveNow,
  getPositions: () => positions
})
keyboard.bind()

const sidepanel = initializeSidepanel()
toolbar = initializeToolbar({
  doc,
  manager,
  onTitleChange: title => {
    if (!manager.execute(updateDocumentTitle(doc, title))) toolbar.update()
    document.title = `${doc.title} — ${strings.productName}`
  },
  actions: {
    undo: keyboard.actions.undo,
    redo: keyboard.actions.redo,
    insertChild: keyboard.actions.insertChild,
    insertAfter: keyboard.actions.insertAfter,
    toggleSidepanel: sidepanel.toggle
  }
})

new DragDropController({
  canvas: elements.canvas,
  nodesLayer: elements.nodesLayer,
  indicator: elements.indicator,
  doc,
  viewport,
  selection,
  manager,
  onMove: (id, parentId, index, side) => {
    if (manager.execute(moveNode(doc, id, parentId, index, side))) selection.set([id])
  }
})

initializeContextMenu()
initializeOutline()

// === PHASE-B INIT (每流一行) ===
const featureContext = {
  doc,
  manager,
  selection,
  viewport,
  edit,
  sidepanel,
  elements,
  getPositions: () => positions,
  renderAll
}
initializeDelta(featureContext)
initializeGamma(featureContext)

// === PHASE-FINAL INIT (C1 owns marker; C2 modules pre-mounted) ===
initPresentation(featureContext)
initFocus(featureContext)
initHistory(featureContext)
initFormula(featureContext)
initSplitscreen(featureContext)
initMobileChrome(featureContext) // === C2 MOBILE CHROME INIT ===
initTouchGestures(featureContext) // === C1 MOBILE TOUCH INIT ===

bindZoomControls()
renderAll()
selection.set([doc.root.id])
requestAnimationFrame(() => viewport.fit(positions))

function renderAll() {
  // 重繪會整層替換節點 DOM；進行中的文字編輯先 commit，避免 session 抓著 detached 元素且輸入遺失
  if (edit?.session && !edit.session.finishing) edit.commit()
  positions = layout(doc, measureFn)
  // === PHASE-FINAL C1 scoped spacing hook ===
  applyScopedSpacing(doc.root, positions)
  render(doc, positions, {
    svgLayer: elements.svgLayer,
    nodesLayer: elements.nodesLayer,
    onToggleCollapse: id => manager.execute(toggleCollapse(doc, id))
  })
  selection?.prune()
  toolbar?.update()
}

function scheduleSave() {
  dirty = true
  toolbar?.setSaveStatus('pending')
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveNow, 500)
}

// 編輯進行中的存檔節流：trailing debounce 800ms，但最多等 4 秒一定落盤。
// 純 debounce 會被連續輸入無限延後，等於長段落完全沒有崩潰保護。
let liveSaveTimer = null
let liveSaveDeadline = 0
// storage 目前是否留著與 canonical 不同的 live 快照（見 saveNow 的說明）
let liveSnapshotPersisted = false

function scheduleLiveSave() {
  const now = Date.now()
  if (!liveSaveDeadline) liveSaveDeadline = now + 4000
  const delay = Math.max(0, Math.min(800, liveSaveDeadline - now))
  window.clearTimeout(liveSaveTimer)
  liveSaveTimer = window.setTimeout(() => {
    liveSaveTimer = null
    liveSaveDeadline = 0
    saveNow()
  }, delay)
}

function cancelLiveSave() {
  window.clearTimeout(liveSaveTimer)
  liveSaveTimer = null
  liveSaveDeadline = 0
}

// 把進行中編輯的即時文字暫時寫進 doc 供存檔快照使用，回傳還原函式。
// 只在同步的存檔區間內生效：不進 undo 堆疊、不觸發重繪，因此不會打斷編輯。
function applyLiveEditToDoc() {
  const live = edit?.getLiveEdit?.()
  if (!live?.changed) return null
  const node = findNode(doc.root, live.id)
  if (!node) return null
  const previousText = node.text
  const previousRich = node.richText
  node.text = live.text
  // richText 一起寫：render 只要 richText 非空就優先畫它，只寫 text 會在重載後被舊 HTML 蓋掉
  node.richText = live.richText
  return () => {
    node.text = previousText
    node.richText = previousRich
  }
}

function saveNow(force = false) {
  // 關窗／強制存檔才 commit（結束編輯無妨）；週期性存檔改用快照，
  // 否則 commit 會 cleanup contenteditable，把正在輸入的使用者踢出編輯狀態。
  if (force && edit?.session && !edit.session.finishing) edit.commit()
  window.clearTimeout(saveTimer)
  saveTimer = null
  cancelLiveSave()
  if (saveBlocked) {
    // 使用者把橫幅按掉但衝突還沒解決：下一次存檔嘗試時把橫幅帶回來，不准無聲吞掉變更
    if (dirty && !document.querySelector('[data-mindflow-banner="save-error"]')) showConflictBanner()
    return
  }
  // 進行中的編輯尚未 commit 成 command，doc 仍是「乾淨」的；但這一頁確實有較新內容，
  // 仍要落盤（CAS 會擋掉舊版覆寫），否則週期存檔不再 commit 後會失去崩潰保護。
  const restoreLiveEdit = applyLiveEditToDoc()
  // 本分頁沒有未儲存變更就不寫入：避免多分頁時「乾淨的舊分頁」在關閉時把新內容蓋回舊版。
  // 但若 storage 還留著先前的 live 快照（使用者改回原狀或按 Esc 取消），必須再寫一次
  // 把 canonical 蓋回去，否則被刪掉的文字會在重載後復活。
  if (!dirty && !restoreLiveEdit && !liveSnapshotPersisted) return
  // 預覽進行中不落盤（關閉頁面例外：寧可存下預覽值也不丟失已確認的變更）
  if (!force && previewUntil && Date.now() < previewUntil) {
    restoreLiveEdit?.()
    saveTimer = window.setTimeout(saveNow, 600)
    return
  }
  try {
    // 先記下「storage 可能已含 live 快照」再寫：部分寫入（文件本體已寫、index 才失敗）
    // 時仍要成立，否則之後的取消／改回原狀不會觸發寫回，幽靈內容會留在 storage。
    if (restoreLiveEdit) liveSnapshotPersisted = true
    const stamp = saveDocument(doc, { expectedUpdatedAt: lastSavedUpdatedAt })
    if (stamp !== false) {
      // 這次寫進 storage 的是不是「與 canonical 不同的 live 快照」
      liveSnapshotPersisted = Boolean(restoreLiveEdit)
      dirty = false
      lastSavedUpdatedAt = stamp
      toolbar?.setSaveStatus('saved')
      hideSaveBanner('save-error')
    }
  } catch (error) {
    toolbar?.setSaveStatus('failed')
    // 部分寫入：文件本體已落盤，先把版本戳校正到已生效的值，
    // 否則下一次存檔會與自己剛寫入的版本衝突、把使用者鎖在衝突橫幅裡
    if (error?.appliedUpdatedAt) lastSavedUpdatedAt = error.appliedUpdatedAt
    if (error?.name === 'MindflowSaveConflictError') {
      // 另一個視窗已寫入較新版本：停止自動存檔，讓使用者決定，不做任何靜默覆蓋
      saveBlocked = true
      showConflictBanner()
      return
    }
    console.error('MindFlow 儲存失敗', error)
    showSaveBanner('save-error', '⚠ 無法儲存（儲存空間可能已滿）。變更尚未寫入，請匯出備份或清理文件後重試。', '#dc2626', [
      { label: '重試儲存', onClick: () => { dirty = true; saveNow() } }
    ])
  } finally {
    // 衝突分支會提前 return，還原必須放 finally，否則 doc 會留著未 commit 的即時文字
    restoreLiveEdit?.()
  }
}

function showConflictBanner() {
  showSaveBanner('save-error', '⚠ 這份文件已被另一個視窗改過，為避免互相覆蓋已暫停儲存。', '#dc2626', [
    { label: '載入對方版本', onClick: () => window.location.reload() },
    { label: '以我為準覆蓋', onClick: () => { saveBlocked = false; lastSavedUpdatedAt = null; dirty = true; saveNow() } }
  ])
}

// ── 頂部持續性警示橫幅（儲存失敗／多分頁衝突用，不自動消失）──
function showSaveBanner(id, message, background, buttons = []) {
  hideSaveBanner(id)
  const banner = document.createElement('div')
  banner.dataset.mindflowBanner = id
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '10000',
    background, color: '#fff', padding: '10px 16px', fontSize: '14px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px'
  })
  const text = document.createElement('span')
  text.textContent = message
  banner.append(text)
  for (const spec of buttons) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = spec.label
    Object.assign(button.style, {
      background: 'rgba(255,255,255,.2)', color: '#fff', border: '1px solid rgba(255,255,255,.6)',
      borderRadius: '6px', padding: '4px 10px', cursor: 'pointer'
    })
    button.addEventListener('click', spec.onClick)
    banner.append(button)
  }
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = '×'
  dismiss.setAttribute('aria-label', '關閉警示')
  Object.assign(dismiss.style, { background: 'none', color: '#fff', border: 'none', fontSize: '18px', cursor: 'pointer' })
  dismiss.addEventListener('click', () => hideSaveBanner(id))
  banner.append(dismiss)
  document.body.append(banner)
}

function hideSaveBanner(id) {
  document.querySelector(`[data-mindflow-banner="${id}"]`)?.remove()
}

function bindZoomControls() {
  const zoomOut = document.querySelector('#zoom-out-button')
  const zoomIn = document.querySelector('#zoom-in-button')
  const fit = document.querySelector('#fit-button')
  zoomOut.textContent = strings.editor.zoomOut
  zoomOut.setAttribute('aria-label', strings.editor.zoomOut)
  zoomIn.textContent = strings.editor.zoomIn
  zoomIn.setAttribute('aria-label', strings.editor.zoomIn)
  fit.textContent = strings.editor.fit
  fit.setAttribute('aria-label', strings.editor.fitLabel)
  elements.zoomDisplay.setAttribute('aria-label', strings.editor.zoomReset)
  zoomOut.addEventListener('click', keyboard.actions.zoomOut)
  zoomIn.addEventListener('click', keyboard.actions.zoomIn)
  elements.zoomDisplay.addEventListener('click', keyboard.actions.zoomReset)
  fit.addEventListener('click', keyboard.actions.fit)
}

window.addEventListener('beforeunload', () => saveNow(true))
window.addEventListener('mindflow:sync-applied', event => {
  if (!syncEventAffectsDocument(event, doc.id)) return
  window.clearTimeout(syncReloadTimer)
  if (blockSyncReloadForLocalEdits()) return
  showSyncAppliedToast()
  syncReloadTimer = window.setTimeout(() => {
    syncReloadTimer = null
    // 排定 reload 後仍可能開始打字；真正導頁前必須再次檢查 session/dirty。
    if (blockSyncReloadForLocalEdits()) return
    window.location.reload()
  }, 850)
})
// 另一個分頁寫入同一份文件時警告（storage 事件只在其他分頁觸發）
window.addEventListener('storage', event => {
  if (event.key === `mindflow.doc.${doc.id}` && event.newValue !== null) {
    showSaveBanner('tab-conflict', '這份文件正被另一個視窗編輯，兩邊同時改會互相覆蓋，建議關閉其中一個。', '#b45309')
  }
})

function syncEventAffectsDocument(event, documentId) {
  const detail = event?.detail
  if (!detail || typeof detail !== 'object') return true
  const ids = detail.changedDocIds || detail.documentIds || detail.docIds || detail.ids
  return Array.isArray(ids) ? ids.includes(documentId) : true
}

function blockSyncReloadForLocalEdits() {
  return protectSyncAppliedReload({
    edit,
    isDirty: () => dirty,
    onConflict: () => {
      // 同步已權威更新 localStorage；本分頁內容留在記憶體，交給既有 CAS 決策橫幅，禁止自動覆蓋。
      window.clearTimeout(saveTimer)
      saveTimer = null
      saveBlocked = true
      showConflictBanner()
    }
  })
}

function showSyncAppliedToast() {
  let toast = document.querySelector('[data-sync-applied-toast]')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'feature-toast sync-applied-toast'
    toast.dataset.syncAppliedToast = 'true'
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    document.body.append(toast)
  }
  toast.textContent = '已套用雲端更新，正在重新載入文件…'
  toast.hidden = false
}
