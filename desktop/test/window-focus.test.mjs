import assert from 'node:assert/strict'
import test from 'node:test'

import { bringWindowToFront } from '../window-focus.mjs'

test('restores a minimized Windows window and promotes it to the foreground', () => {
  const calls = []
  const window = {
    isMinimized() {
      calls.push('isMinimized')
      return true
    },
    restore() {
      calls.push('restore')
    },
    show() {
      calls.push('show')
    },
    focus() {
      calls.push('focus')
    },
    setAlwaysOnTop(value) {
      calls.push(`setAlwaysOnTop:${value}`)
    }
  }

  bringWindowToFront(window, 'win32')

  assert.deepEqual(calls, [
    'isMinimized',
    'restore',
    'show',
    'focus',
    'setAlwaysOnTop:true',
    'setAlwaysOnTop:false'
  ])
})
