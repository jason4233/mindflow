/**
 * GAMMA 本機佈局記錄測試：本機記錄不能蓋掉別台同步過來的文件佈局。
 */
import assert from 'node:assert/strict'
import { gammaLayoutOverride, gammaLayoutRecord, persistedLayout } from '../js/editor/gamma-state.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('存不進文件的佈局退回 mindmap-both', () => {
  assert.equal(persistedLayout('org'), 'org')
  assert.equal(persistedLayout('timeline-v'), 'mindmap-both')
  assert.equal(persistedLayout('bogus'), 'mindmap-both')
})

test('記錄同時寫入實際佈局與文件會存成的值', () => {
  assert.deepEqual(gammaLayoutRecord('org'), { layout: 'org', docLayout: 'org' })
  assert.deepEqual(gammaLayoutRecord('timeline-v'), { layout: 'timeline-v', docLayout: 'mindmap-both' })
  assert.deepEqual(gammaLayoutRecord('mindmap'), { layout: 'mindmap-both', docLayout: 'mindmap-both' })
})

test('新格式：文件佈局沒變時套用本機佈局（垂直時間軸能回來）', () => {
  const state = gammaLayoutRecord('timeline-v')
  assert.equal(gammaLayoutOverride(state, 'mindmap-both'), 'timeline-v')
})

test('新格式：別台同步改了文件佈局，以文件為準', () => {
  const state = gammaLayoutRecord('timeline-v')
  assert.equal(gammaLayoutOverride(state, 'org'), null)
  const orgState = gammaLayoutRecord('org')
  assert.equal(gammaLayoutOverride(orgState, 'fishbone'), null)
  assert.equal(gammaLayoutOverride(orgState, 'org'), 'org')
})

test('舊格式：可存進文件的佈局不覆蓋文件', () => {
  assert.equal(gammaLayoutOverride({ layout: 'mindmap-right', structures: {} }, 'org'), null)
  assert.equal(gammaLayoutOverride({ layout: 'mindmap-right' }, 'mindmap-right'), null)
})

test('舊格式：垂直時間軸只在文件仍是預設值時補回', () => {
  assert.equal(gammaLayoutOverride({ layout: 'timeline-v' }, 'mindmap-both'), 'timeline-v')
  assert.equal(gammaLayoutOverride({ layout: 'timeline-v' }, 'org'), null)
})

test('壞掉或空的記錄不覆蓋', () => {
  assert.equal(gammaLayoutOverride({}, 'org'), null)
  assert.equal(gammaLayoutOverride(null, 'org'), null)
  assert.equal(gammaLayoutOverride({ layout: 'nope', docLayout: 'org' }, 'org'), null)
  assert.equal(gammaLayoutOverride('timeline-v', 'mindmap-both'), null)
})

let passed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

console.log(`\n${passed}/${tests.length} GAMMA state tests passed`)
