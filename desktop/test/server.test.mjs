import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveStaticRoot } from '../app-paths.mjs'
import { createStaticServer } from '../server.mjs'

async function withFixture(run) {
  const workspace = await mkdtemp(join(tmpdir(), 'mindflow-desktop-'))
  const root = join(workspace, 'app')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>MindFlow</title>', 'utf8')
  await writeFile(join(root, 'assets', 'manifest.json'), '{"ready":true}', 'utf8')
  await writeFile(join(workspace, 'secret.txt'), 'must not leak', 'utf8')

  const appServer = await createStaticServer({ root })
  try {
    await run(appServer)
  } finally {
    await appServer.close()
    await rm(workspace, { recursive: true, force: true })
  }
}

test('binds an available loopback port and serves index.html for the root URL', async () => {
  await withFixture(async ({ origin, port }) => {
    assert.ok(port > 0)
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)

    const response = await fetch(`${origin}/`)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(await response.text(), '<!doctype html><title>MindFlow</title>')
  })
})

test('serves JSON assets with the correct MIME type so the app can fetch its manifest', async () => {
  await withFixture(async ({ origin }) => {
    const response = await fetch(`${origin}/assets/manifest.json`)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(await response.json(), { ready: true })
  })
})

test('returns 404 for missing files and 403 for paths outside the static root', async () => {
  await withFixture(async ({ origin }) => {
    const missing = await fetch(`${origin}/missing.txt`)
    const traversal = await fetch(`${origin}/%2e%2e%2fsecret.txt`)

    assert.equal(missing.status, 404)
    assert.equal(missing.headers.get('cache-control'), 'no-store')
    assert.equal(traversal.status, 403)
    assert.equal(await traversal.text(), 'forbidden')
  })
})

test('uses the repository root as the static root during development', () => {
  const desktopDir = join('C:', 'work', 'mindflow', 'desktop')

  assert.equal(
    resolveStaticRoot({ isPackaged: false, desktopDir, resourcesPath: join('C:', 'unused') }),
    join('C:', 'work', 'mindflow')
  )
})

test('uses the bundled app resource as the static root after packaging', () => {
  const resourcesPath = join('C:', 'portable', 'resources')

  assert.equal(
    resolveStaticRoot({ isPackaged: true, desktopDir: join('C:', 'unused'), resourcesPath }),
    join(resourcesPath, 'app')
  )
})
