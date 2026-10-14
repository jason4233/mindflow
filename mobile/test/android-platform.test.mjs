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

const JAVA_DIR = 'app/src/main/java/com/mindflow/app'

test('Android scaffold freezes the app identity and requests only INTERNET', async () => {
  const manifest = await readPlatformFile('app/src/main/AndroidManifest.xml')
  const buildGradle = await readPlatformFile('app/build.gradle')
  const strings = await readPlatformFile('app/src/main/res/values/strings.xml')

  assert.ok(manifest, 'AndroidManifest.xml must exist')
  // The app itself declares only INTERNET. App/Filesystem/Share/Preferences declare nothing and
  // BarcodeScanner.scan() uses the Google code scanner, which needs no CAMERA permission. The
  // merged manifest additionally gets ACCESS_NETWORK_STATE (Google datatransport under ML Kit)
  // and androidx.core's app-private DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION; android.yml fails
  // the build if the built APK requests anything else (see android-workflow.test.mjs).
  const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)]
    .map(match => match[1])
    .sort()
  assert.deepEqual(permissions, ['android.permission.INTERNET'])
  assert.match(buildGradle, /namespace\s*=?\s*["']com\.mindflow\.app["']/)
  assert.match(buildGradle, /applicationId\s+["']com\.mindflow\.app["']/)
  assert.match(strings, /<string name="app_name">MindFlow<\/string>/)
  assert.match(manifest, /android:configChanges="[^"]*\|navigation\|density"/,
    'Capacitor 8 needs density (and navigation) in configChanges so resizing does not reload the WebView')
})

test('Android toolchain matches Capacitor 8 (minSdk 24, API 36, AGP 8.13, Gradle 8.14.3)', async () => {
  const variables = await readPlatformFile('variables.gradle')
  const rootGradle = await readPlatformFile('build.gradle')
  const wrapper = await readPlatformFile('gradle/wrapper/gradle-wrapper.properties')

  assert.match(variables, /minSdkVersion = 24\b/)
  assert.match(variables, /compileSdkVersion = 36\b/)
  assert.match(variables, /targetSdkVersion = 36\b/)
  assert.match(rootGradle, /com\.android\.tools\.build:gradle:8\.13\.\d+/)
  assert.match(wrapper, /gradle-8\.14\.3-all\.zip/)
  // Keeps the bundled ML Kit model (~20 MB of native libraries) out of the APK; scan() uses the
  // Google code scanner in Play services, so the unbundled artifact is sufficient.
  assert.match(rootGradle,
    /substitute\(module\('com\.google\.mlkit:barcode-scanning'\)\)\s+\.using\(module\('com\.google\.android\.gms:play-services-mlkit-barcode-scanning:[\d.]+'\)\)/)
})

test('MindflowSecureStorage is a registered local plugin with the agreed contract', async () => {
  const activity = await readPlatformFile(`${JAVA_DIR}/MainActivity.java`)
  const plugin = await readPlatformFile(`${JAVA_DIR}/MindflowSecureStoragePlugin.java`)

  assert.ok(plugin, 'MindflowSecureStoragePlugin.java must exist')
  const register = activity.indexOf('registerPlugin(MindflowSecureStoragePlugin.class)')
  const superCreate = activity.indexOf('super.onCreate(savedInstanceState)')
  const edgeToEdge = activity.indexOf('EdgeToEdge.enable(this)')
  assert.ok(register > 0 && superCreate > register, 'local plugins must be registered before super.onCreate()')
  // After super.onCreate(): BridgeActivity switches from the splash theme there, and installing the
  // decor view earlier would pin the window to the launch theme.
  assert.ok(edgeToEdge > superCreate, 'EdgeToEdge.enable(this) must follow super.onCreate()')

  assert.match(plugin, /@CapacitorPlugin\(name = "MindflowSecureStorage"\)/)
  for (const method of ['isAvailable', 'get', 'set', 'remove']) {
    assert.match(plugin, new RegExp(`@PluginMethod\\s+public void ${method}\\(PluginCall call\\)`), method)
  }
  assert.match(plugin, /KEY_ALIAS = "mindflow_secure_storage_v1"/)
  assert.match(plugin, /PREFS_NAME = "mindflow_secure"/)
  assert.match(plugin, /"AES\/GCM\/NoPadding"/)
  assert.match(plugin, /setKeySize\(256\)/)
  assert.match(plugin, /setUserAuthenticationRequired\(false\)/)
  assert.match(plugin, /CODE_INVALID_ARGUMENT = "INVALID_ARGUMENT"/)
  assert.match(plugin, /CODE_UNAVAILABLE = "UNAVAILABLE"/)
  assert.match(plugin, /Pattern\.compile\("\[A-Za-z0-9\._-\]\{1,128\}"\)/)
})

test('Auto Backup keeps app data but excludes the undecryptable secure-storage file', async () => {
  const manifest = await readPlatformFile('app/src/main/AndroidManifest.xml')
  const extractionRules = await readPlatformFile('app/src/main/res/xml/data_extraction_rules.xml')
  const backupRules = await readPlatformFile('app/src/main/res/xml/backup_rules.xml')

  assert.match(manifest, /android:allowBackup="true"/)
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/)
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/)

  const secureExclude = /<exclude domain="sharedpref" path="mindflow_secure\.xml" \/>/
  for (const section of ['cloud-backup', 'device-transfer']) {
    const body = extractionRules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1]
    assert.ok(body, `${section} rules must exist`)
    assert.match(body, secureExclude, `${section} must exclude mindflow_secure.xml`)
  }
  assert.match(backupRules, secureExclude)
  // Exclude-only rules keep everything else (WebView localStorage, Preferences) in the backup.
  assert.doesNotMatch(extractionRules, /<include\b/)
  assert.doesNotMatch(backupRules, /<include\b/)
})

test('versioning and release signing come only from the environment', async () => {
  const buildGradle = await readPlatformFile('app/build.gradle')
  const gitignore = await readPlatformFile('.gitignore')

  assert.match(buildGradle, /envValue\('MINDFLOW_VERSION_CODE'\) \?: '1'/)
  assert.match(buildGradle, /envValue\('MINDFLOW_VERSION_NAME'\) \?: '1\.0-dev'/)
  assert.match(buildGradle, /versionCode mindflowVersionCode/)
  assert.match(buildGradle, /versionName mindflowVersionName/)
  assert.doesNotMatch(buildGradle, /versionCode\s+\d/, 'versionCode must not be hard-coded')
  for (const name of ['MINDFLOW_KEYSTORE_PATH', 'MINDFLOW_KEYSTORE_PASSWORD', 'MINDFLOW_KEY_ALIAS', 'MINDFLOW_KEY_PASSWORD']) {
    assert.match(buildGradle, new RegExp(`'${name}'`), name)
  }
  assert.match(buildGradle, /if \(hasReleaseSigning\) \{\s+signingConfig = signingConfigs\.release/)
  assert.doesNotMatch(buildGradle, /storePassword\s+["']/, 'no literal keystore password')

  const ignored = gitignore.split(/\r?\n/).map(line => line.trim())
  assert.ok(ignored.includes('*.jks'), '*.jks must be ignored')
  assert.ok(ignored.includes('*.keystore'), '*.keystore must be ignored')
})
