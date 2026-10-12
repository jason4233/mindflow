import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearContextMenuSuppression,
  consumeContextMenuSuppression,
  getSelectionFrameRect,
  isRectInSelectionFrame,
  hasFrameDragExceeded,
  isBlankCanvasClick,
  shouldStartSelectionFrame,
  suppressNextContextMenu
} from '../js/editor/selection.js'

// ── 2026-09-15 紅隊審查 #3/#4：小地圖、縮放列、文字工具列（含裡面的 select）上按右鍵不得起框 ──
test('小地圖／縮放列／文字工具列上的右鍵不起框', () => {
  assert.equal(shouldStartSelectionFrame({ button: 2, onControl: true }), false)
  assert.equal(shouldStartSelectionFrame({ button: 0, ctrlKey: true, onControl: true }), false)
  assert.equal(shouldStartSelectionFrame({ button: 2, onControl: false }), true)
})

// ── 紅隊審查 #8/#9/#10：右鍵選單抑制改為「門檻一超過就設、消費一次即清、下一次按下時清除」的布林，
//    不用 250ms 時間窗（按住 3 秒、拖曳中先放右鍵、pointercancel 都不該再靠時間碰運氣）──
test('右鍵選單抑制：設了就吃掉下一個 contextmenu，只吃一次', () => {
  clearContextMenuSuppression()
  assert.equal(consumeContextMenuSuppression(), false, '沒設時不抑制')
  suppressNextContextMenu()
  assert.equal(consumeContextMenuSuppression(), true, '第一個 contextmenu 被吃掉')
  assert.equal(consumeContextMenuSuppression(), false, '第二個照常')
})

test('右鍵選單抑制：新的一次按下會清掉殘留旗標', () => {
  suppressNextContextMenu()
  clearContextMenuSuppression()
  assert.equal(consumeContextMenuSuppression(), false)
})

test('右鍵空白處可起框', () => {
  assert.equal(shouldStartSelectionFrame({
    button: 2,
    isPanMode: false,
    onNode: false,
    onButton: false
  }), true)
})

test('右鍵點到節點不能起框', () => {
  assert.equal(shouldStartSelectionFrame({
    button: 2,
    isPanMode: false,
    onNode: true,
    onButton: false
  }), false)
})

test('Ctrl+左鍵可起框', () => {
  assert.equal(shouldStartSelectionFrame({
    button: 0,
    ctrlKey: true,
    isPanMode: false,
    onNode: false,
    onButton: false
  }), true)
})

test('純左鍵不能起框', () => {
  assert.equal(shouldStartSelectionFrame({
    button: 0,
    isPanMode: false,
    onNode: false,
    onButton: false
  }), false)
})

test('右鍵拖曳低於門檻不視為起框套用', () => {
  const start = { x: 100, y: 100 }
  assert.equal(hasFrameDragExceeded(start, { x: 102, y: 102 }), false, '未超過 4px')
  assert.equal(hasFrameDragExceeded(start, { x: 104, y: 104 }), true, '超過 4px')
})

test('框選命中節點', () => {
  const frame = getSelectionFrameRect({ x: 10, y: 10 }, { x: 40, y: 40 })
  const inside = isRectInSelectionFrame({ x: 20, y: 20, w: 10, h: 10 }, frame)
  const outside = isRectInSelectionFrame({ x: 100, y: 100, w: 10, h: 10 }, frame)
  assert.equal(inside, true)
  assert.equal(outside, false)
})

// ── 2026-10-12：節點打完字後點旁邊空白處＝完成編輯並取消選取；拖曳空白（平移）不算 ──
const blankPress = { x: 100, y: 100, pointerType: 'mouse', onBlank: true }

test('空白處左鍵單擊算取消選取', () => {
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: blankPress, x: 102, y: 101 }), true)
})

test('拖曳空白平移畫布不算單擊', () => {
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: blankPress, x: 160, y: 140 }), false)
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: blankPress, x: 104, y: 104 }), false, '滑鼠超過 4px 就是拖曳')
})

test('觸控點按容忍手指抖動，但滑動仍不算', () => {
  const touchPress = { ...blankPress, pointerType: 'touch' }
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: touchPress, x: 106, y: 105 }), true, '8px 內仍是點按')
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: touchPress, x: 110, y: 108 }), false)
})

test('按下或放開不在空白處都不算', () => {
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: false, press: blankPress, x: 100, y: 100 }), false, '放開在節點／控制項上')
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: { ...blankPress, onBlank: false }, x: 100, y: 100 }), false, '從節點按下（拖曳節點）')
  assert.equal(isBlankCanvasClick({ button: 0, onBlank: true, press: null, x: 100, y: 100 }), false, '沒有記到按下點')
})

test('Ctrl/Meta+點擊（框選）、手形工具、非左鍵、已被攔下的 click 都不取消選取', () => {
  const base = { button: 0, onBlank: true, press: blankPress, x: 100, y: 100 }
  assert.equal(isBlankCanvasClick({ ...base, ctrlKey: true }), false)
  assert.equal(isBlankCanvasClick({ ...base, metaKey: true }), false)
  assert.equal(isBlankCanvasClick({ ...base, isPanMode: true }), false)
  assert.equal(isBlankCanvasClick({ ...base, button: 1 }), false)
  assert.equal(isBlankCanvasClick({ ...base, defaultPrevented: true }), false)
})
