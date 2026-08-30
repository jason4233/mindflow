import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptPath = fileURLToPath(new URL('../scripts/copy-web.mjs', import.meta.url))

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
  const sourceRoot = join(fixture, 'source')
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
      await writeFixture(sourceRoot, path)
    }
    await writeFixture(webDir, 'stale.txt')

    const result = spawnSync(process.execPath, [
      scriptPath,
      '--source-root', sourceRoot,
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
