import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readPlatformFile(path) {
  try {
    return await readFile(new URL(`../android/${path}`, import.meta.url), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

test('Android scaffold freezes the app identity and requests only INTERNET', async () => {
  const manifest = await readPlatformFile('app/src/main/AndroidManifest.xml')
  const buildGradle = await readPlatformFile('app/build.gradle')
  const strings = await readPlatformFile('app/src/main/res/values/strings.xml')

  assert.ok(manifest, 'AndroidManifest.xml must exist')
  const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)]
    .map(match => match[1])
    .sort()
  assert.deepEqual(permissions, ['android.permission.INTERNET'])
  assert.match(buildGradle, /namespace\s+["']com\.mindflow\.app["']/)
  assert.match(buildGradle, /applicationId\s+["']com\.mindflow\.app["']/)
  assert.match(strings, /<string name="app_name">MindFlow<\/string>/)
})
