import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculatePinchView,
  classifyTouchRelease,
  isDoubleTap,
  screenPointToWorld
} from '../js/editor/touch.js'

test('screenPointToWorld 會扣除 canvas 位移與 viewport pan，再依 zoom 換算', () => {
  assert.deepEqual(
    screenPointToWorld(
      { clientX: 250, clientY: 180 },
      { left: 50, top: 30 },
      { panX: 20, panY: 10, zoom: 2 }
    ),
    { x: 90, y: 70 }
  )
})

test('calculatePinchView 以起始雙指中點的世界座標為錨點並跟隨中點移動', () => {
  const view = calculatePinchView({
    startPoints: [
      { clientX: 110, clientY: 120 },
      { clientX: 210, clientY: 120 }
    ],
    currentPoints: [
      { clientX: 90, clientY: 140 },
      { clientX: 250, clientY: 140 }
    ],
    startView: { panX: 50, panY: 20, zoom: 1 },
    canvasRect: { left: 10, top: 20 }
  })

  assert.deepEqual(view, { panX: 0, panY: -8, zoom: 1.6 })
})

test('calculatePinchView 夾住 zoom 上限時仍維持同一個世界錨點', () => {
  const view = calculatePinchView({
    startPoints: [
      { clientX: 50, clientY: 50 },
      { clientX: 100, clientY: 50 }
    ],
    currentPoints: [
      { clientX: -75, clientY: 80 },
      { clientX: 225, clientY: 80 }
    ],
    startView: { panX: 25, panY: 10, zoom: 1 },
    canvasRect: { left: 0, top: 0 },
    maxZoom: 4
  })

  assert.deepEqual(view, { panX: -125, panY: -80, zoom: 4 })
})

test('classifyTouchRelease 只把短距離短按視為 tap，長按與拖曳互斥', () => {
  assert.equal(classifyTouchRelease({ distance: 5, duration: 180 }), 'tap')
  assert.equal(classifyTouchRelease({ distance: 14, duration: 180 }), 'drag')
  assert.equal(classifyTouchRelease({ distance: 1, duration: 620 }), 'long-press')
  assert.equal(classifyTouchRelease({ distance: 1, duration: 120, longPressFired: true }), 'long-press')
})

test('isDoubleTap 同時限制目標、時間與座標距離', () => {
  const previous = { targetKey: 'node:a', time: 1000, clientX: 120, clientY: 180 }
  assert.equal(isDoubleTap(previous, { targetKey: 'node:a', time: 1320, clientX: 132, clientY: 188 }), true)
  assert.equal(isDoubleTap(previous, { targetKey: 'node:b', time: 1200, clientX: 120, clientY: 180 }), false)
  assert.equal(isDoubleTap(previous, { targetKey: 'node:a', time: 1400, clientX: 120, clientY: 180 }), false)
  assert.equal(isDoubleTap(previous, { targetKey: 'node:a', time: 1200, clientX: 160, clientY: 180 }), false)
})
