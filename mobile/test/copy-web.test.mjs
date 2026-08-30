import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptPath = fileURLToPath(new URL('../scripts/copy-web.mjs', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
const defaultWebDir = fileURLToPath(new URL('../www', import.meta.url))
const strictCsp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; connect-src 'self'; base-uri 'none'\">"

async function writeFixture(root, path, contents = path) {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents, 'utf8')
}

async function listFiles(root, current = root) {
  const files = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else files.push(relative(root, path).replaceAll('\\', '/'))
  }
  return files.sort()
}

test('copy-web publishes only the complete browser runtime and removes stale output', async () => {
  // 若 allowlist 漏檔或把 desktop/tests/docs 帶進 WebView，這個測試會直接失敗。
  const fixture = await mkdtemp(join(tmpdir(), 'mindflow-mobile-copy-'))
  const fixtureSourceRoot = join(fixture, 'source')
  const webDir = join(fixture, 'www')

  try {
    for (const path of [
      'index.html',
      'editor.html',
      'css/app.css',
      'js/app.mjs',
      'assets/favicon.svg',
      'tests/secret.test.mjs',
      'docs/internal.md',
      'desktop/main.mjs'
    ]) {
      await writeFixture(
        fixtureSourceRoot,
        path,
        path.endsWith('.html') ? strictCsp : path
      )
    }
    await writeFixture(webDir, 'stale.txt')

    const result = spawnSync(process.execPath, [
      scriptPath,
      '--source-root', fixtureSourceRoot,
      '--web-dir', webDir
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.deepEqual(await listFiles(webDir), [
      'assets/favicon.svg',
      'css/app.css',
      'editor.html',
      'index.html',
      'js/app.mjs'
    ])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('copy-web allows GitHub API only in both generated mobile HTML files', async () => {
  // 直接執行正式 copy pipeline，避免只測 fixture 卻漏掉實際 APK 輸出。
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  for (const file of ['index.html', 'editor.html']) {
    const mobileHtml = await readFile(join(defaultWebDir, file), 'utf8')
    assert.match(mobileHtml, /connect-src 'self' https:\/\/api\.github\.com(?:\s*;)/)
  }

  const rootHtml = await readFile(join(sourceRoot, 'index.html'), 'utf8')
  assert.match(rootHtml, /connect-src 'self';/)
  assert.doesNotMatch(rootHtml, /connect-src[^;]*https:\/\/api\.github\.com/)
})

test('copy-web fails when any source HTML no longer has the strict connect-src directive', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mindflow-mobile-csp-'))
  const fixtureSourceRoot = join(fixture, 'source')
  const webDir = join(fixture, 'www')

  try {
    await writeFixture(fixtureSourceRoot, 'index.html', strictCsp)
    await writeFixture(fixtureSourceRoot, 'editor.html', '<html><head></head></html>')
    for (const directory of ['css', 'js', 'assets']) {
      await writeFixture(fixtureSourceRoot, `${directory}/placeholder.txt`)
    }

    const result = spawnSync(process.execPath, [
      scriptPath,
      '--source-root', fixtureSourceRoot,
      '--web-dir', webDir
    ], { encoding: 'utf8' })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /editor\.html.*connect-src 'self'/)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
