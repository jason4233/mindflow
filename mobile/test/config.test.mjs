import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readJson(name) {
  try {
    return JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

test('mobile is an isolated Capacitor 6 project with the frozen app identity', async () => {
  // 這個契約防止 mobile 依賴污染根目錄，也避免 Android applicationId 因重建平台而漂移。
  const config = await readJson('capacitor.config.json')
  const packageJson = await readJson('package.json')

  assert.deepEqual(config, {
    appId: 'com.mindflow.app',
    appName: 'MindFlow',
    webDir: 'www'
  })
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.dependencies['@capacitor/android'], '6.2.1')
  assert.equal(packageJson.dependencies['@capacitor/core'], '6.2.1')
  assert.equal(packageJson.devDependencies['@capacitor/cli'], '6.2.1')
  assert.equal(packageJson.scripts['copy-web'], 'node scripts/copy-web.mjs')
})
