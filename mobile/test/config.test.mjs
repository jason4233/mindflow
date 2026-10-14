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

const CAPACITOR_VERSION = '8.5.3'
const PLUGINS = {
  '@capacitor/app': '8.1.2',
  '@capacitor/filesystem': '8.1.4',
  '@capacitor/preferences': '8.0.1',
  '@capacitor/share': '8.0.3',
  '@capacitor-mlkit/barcode-scanning': '8.2.1'
}

test('mobile is an isolated Capacitor 8 project with the frozen app identity and origin', async () => {
  // 這個契約防止 mobile 依賴污染根目錄，也避免 Android applicationId 因重建平台而漂移。
  const config = await readJson('capacitor.config.json')
  const packageJson = await readJson('package.json')

  // No server.hostname / server.androidScheme override: the WebView origin must stay
  // https://localhost, otherwise every user's localStorage (all mind maps) would be orphaned.
  assert.deepEqual(config, {
    appId: 'com.mindflow.app',
    appName: 'MindFlow',
    webDir: 'www',
    // The web UI relies on CSS dvh units (Chrome 108+).
    android: { minWebViewVersion: 108 },
    // targetSdk 36 forces edge-to-edge; "native" (Capacitor's recommendation, the Capacitor 9
    // default) pads the WebView inside the system bars and keyboard unless a page opts in with
    // viewport-fit=cover (then, on WebView 140+, env(safe-area-inset-*) carries the insets).
    plugins: { SystemBars: { insetsHandling: 'native' } }
  })
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.dependencies['@capacitor/android'], CAPACITOR_VERSION)
  assert.equal(packageJson.dependencies['@capacitor/core'], CAPACITOR_VERSION)
  assert.equal(packageJson.devDependencies['@capacitor/cli'], CAPACITOR_VERSION)
  for (const [name, version] of Object.entries(PLUGINS)) {
    assert.equal(packageJson.dependencies[name], version, `${name} must be pinned to ${version}`)
  }
  assert.deepEqual(
    Object.keys(packageJson.dependencies).sort(),
    ['@capacitor/android', '@capacitor/core', ...Object.keys(PLUGINS)].sort(),
    'every native plugin must be reviewed (permissions, backup, size) before it is added'
  )
  assert.equal(packageJson.scripts['copy-web'], 'node scripts/copy-web.mjs')
  // Capacitor CLI 8 uses tar 7 natively; the Capacitor 6 postinstall patch must not come back.
  assert.equal(packageJson.scripts.postinstall, undefined)
  assert.match(packageJson.engines.node, />=\s*22/)
})

test('package-lock resolves exactly the pinned Capacitor packages', async () => {
  const lock = await readJson('package-lock.json')
  const expected = {
    '@capacitor/android': CAPACITOR_VERSION,
    '@capacitor/core': CAPACITOR_VERSION,
    '@capacitor/cli': CAPACITOR_VERSION,
    ...PLUGINS
  }
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} in package-lock.json`)
  }
})
