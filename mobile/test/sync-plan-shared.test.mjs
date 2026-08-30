import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../..', import.meta.url))
const sharedUrl = pathToFileURL(`${root}/js/sync-plan.mjs`).href
const desktopUrl = pathToFileURL(`${root}/desktop/sync-plan.mjs`).href

test('web and desktop import one shared sync-plan implementation', () => {
  // 若 desktop 留下第二份實作，函數 identity 不同，兩端同步規則可能再次漂移。
  const program = `
    import assert from 'node:assert/strict'
    import * as shared from ${JSON.stringify(sharedUrl)}
    import * as desktop from ${JSON.stringify(desktopUrl)}
    assert.equal(desktop.computeSyncPlan, shared.computeSyncPlan)
    assert.deepEqual(shared.emptyManifest(), {
      schemaVersion: 1,
      docs: {},
      favorites: [],
      tombstones: {},
      lastWriter: null
    })
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
})
