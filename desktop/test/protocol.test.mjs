import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  APP_START_URL,
  CONTENT_SECURITY_POLICY,
  createProtocolHandler,
  resolveProtocolPath
} from '../protocol.mjs'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'mindflow-protocol-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>MindFlow</title>', 'utf8')
  await writeFile(join(root, 'assets', 'manifest.json'), '{"ready":true}', 'utf8')
  await writeFile(join(root, 'module.js'), 'export const ready = true', 'utf8')

  try {
    await run({ root, handler: createProtocolHandler({ root }) })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('uses one fixed standard custom-protocol URL', () => {
  assert.equal(APP_START_URL, 'mindflow://app/index.html')
})

test('serves HTML, ES modules and fetchable JSON with correct MIME types', async () => {
  await withFixture(async ({ handler }) => {
    const html = await handler({ url: APP_START_URL, method: 'GET' })
    const module = await handler({ url: 'mindflow://app/module.js', method: 'GET' })
    const json = await handler({ url: 'mindflow://app/assets/manifest.json', method: 'GET' })

    assert.equal(html.status, 200)
    assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(await html.text(), '<!doctype html><title>MindFlow</title>')
    assert.equal(module.headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(await json.json(), { ready: true })
  })
})

test('blocks other hosts and encoded traversal outside the static root', async () => {
  await withFixture(async ({ root, handler }) => {
    const wrongHost = await handler({ url: 'mindflow://other/index.html', method: 'GET' })
    const traversal = await handler({
      url: 'mindflow://app/%2e%2e%2fsecret.txt',
      method: 'GET'
    })
    const resolved = resolveProtocolPath(root, 'mindflow://app/%2e%2e%2fsecret.txt')

    assert.equal(wrongHost.status, 403)
    assert.equal(traversal.status, 403)
    assert.equal(resolved.isOutside, true)
  })
})

test('sends the CSP with documents and keeps the HTML meta copies in sync', async () => {
  await withFixture(async ({ handler }) => {
    const html = await handler({ url: APP_START_URL, method: 'GET' })
    const json = await handler({ url: 'mindflow://app/assets/manifest.json', method: 'GET' })

    assert.equal(html.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY)
    assert.equal(json.headers.get('content-security-policy'), null)
  })

  // 同一條政策有 header 與兩份 <meta> 三處複本，任何一處漂掉都只有在真機上才會爆。
  for (const page of ['index.html', 'editor.html']) {
    const source = await readFile(join(repositoryRoot, page), 'utf8')
    const meta = source.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)

    assert.ok(meta, `${page} is missing its Content-Security-Policy meta tag`)
    assert.equal(meta[1], CONTENT_SECURITY_POLICY)
  }
})

test('returns 404 for missing files and omits the body for HEAD', async () => {
  await withFixture(async ({ handler }) => {
    const missing = await handler({ url: 'mindflow://app/missing.txt', method: 'GET' })
    const head = await handler({ url: APP_START_URL, method: 'HEAD' })

    assert.equal(missing.status, 404)
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  })
})
