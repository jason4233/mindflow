/**
 * GitHub 傳輸（js/sync/transport-github.mjs）：由舊 desktop/sync-github.mjs 的測試移植。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { startFakeGitHubServer } from '../desktop/test/fake-github-server.mjs'
import {
  TransportConflictError,
  TransportError,
  createFetchRequester,
  createGitHubTransport,
  decodeBase64Utf8
} from '../js/sync/transport-github.mjs'

const TOKEN = 'TEST-ONLY-NOT-A-REAL-TOKEN-transport-0123456789'

function scripted(responses) {
  const calls = []
  const request = async spec => {
    calls.push(spec)
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request ${spec.method || 'GET'} ${spec.path}`)
    return typeof next === 'function' ? next(spec) : next
  }
  return { request, calls }
}

test('fetch requester sends the token, bypasses the HTTP cache and redacts network errors', async () => {
  const seen = []
  const ok = createFetchRequester({
    apiBase: 'https://api.example/',
    token: TOKEN,
    fetchFn: async (url, init) => {
      seen.push({ url, init })
      return new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { etag: 'W/"1"', 'x-ratelimit-remaining': '42' } })
    }
  })
  assert.deepEqual(await ok({ method: 'POST', path: '/x', body: { b: 2 } }), { status: 200, etag: 'W/"1"', data: { a: 1 }, rateRemaining: 42 })
  assert.equal(seen[0].url, 'https://api.example/x')
  assert.equal(seen[0].init.cache, 'no-store')
  assert.equal(seen[0].init.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(seen[0].init.body, '{"b":2}')

  const failing = createFetchRequester({ token: TOKEN, fetchFn: async () => { throw new Error(`socket closed ${TOKEN}`) } })
  await assert.rejects(failing({ path: '/x' }), error => error instanceof TransportError && error.status === 0 && error.retryable && !error.message.includes(TOKEN))
})

test('getHead returns sha and etag, treats 304 as unchanged, and explains an empty repository', async () => {
  const { request, calls } = scripted([
    { status: 200, etag: 'W/"a"', data: { object: { sha: 'c1' } } },
    { status: 304, etag: null, data: null },
    { status: 409, etag: null, data: { message: 'Git Repository is empty.' } }
  ])
  const transport = createGitHubTransport({ request, repo: 'owner/repo', branch: 'feature/sync' })
  assert.deepEqual(await transport.getHead(), { sha: 'c1', etag: 'W/"a"', notModified: false })
  assert.equal(calls[0].path, '/repos/owner/repo/git/ref/heads/feature/sync')
  assert.deepEqual(await transport.getHead({ etag: 'W/"a"' }), { sha: null, etag: 'W/"a"', notModified: true })
  assert.deepEqual(calls[1].headers, { 'if-none-match': 'W/"a"' })
  await assert.rejects(transport.getHead(), /是空的/)
})

test('getTree indexes blobs only and refuses a truncated tree', async () => {
  const commit = { status: 200, data: { tree: { sha: 't1' } } }
  const { request } = scripted([
    commit,
    { status: 200, data: { tree: [{ type: 'blob', path: 'manifest.json', sha: 'b1', size: 10 }, { type: 'tree', path: 'docs', sha: 't2' }] } },
    commit,
    { status: 200, data: { truncated: true, tree: [] } }
  ])
  const transport = createGitHubTransport({ request, repo: 'owner/repo' })
  assert.deepEqual(await transport.getTree('c1'), { treeSha: 't1', byPath: { 'manifest.json': { sha: 'b1', size: 10 } } })
  await assert.rejects(transport.getTree('c1'), /truncated/)
})

test('readBlob decodes UTF-8 larger than 1 MiB', async () => {
  const text = `心智圖${'x'.repeat(1_200_000)}`
  const { request } = scripted([{ status: 200, data: { encoding: 'base64', content: Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\n') } }])
  const transport = createGitHubTransport({ request, repo: 'owner/repo' })
  assert.equal(await transport.readBlob('b1'), text)
  assert.equal(decodeBase64Utf8(Buffer.from('ok').toString('base64')), 'ok')
})

test('writeCommit uploads blobs, keeps null deletions, uses one parent and a non-force ref update; 422 is a conflict', async () => {
  const { request, calls } = scripted([
    { status: 201, data: { sha: 'blob1' } },
    { status: 201, data: { sha: 'tree2' } },
    { status: 201, data: { sha: 'commit2' } },
    { status: 200, data: {} },
    { status: 201, data: { sha: 'blob1' } },
    { status: 201, data: { sha: 'tree3' } },
    { status: 201, data: { sha: 'commit3' } },
    { status: 422, data: { message: 'Update is not a fast forward' } }
  ])
  const transport = createGitHubTransport({ request, repo: 'owner/repo' })
  const files = [{ path: 'manifest.json', content: '{}' }, { path: 'docs/old.json', content: null }]
  assert.equal(await transport.writeCommit({ parentSha: 'c1', baseTreeSha: 't1', files, message: 'm' }), 'commit2')
  assert.deepEqual(calls[0].body, { content: '{}', encoding: 'utf-8' })
  assert.deepEqual(calls[1].body.tree, [
    { path: 'manifest.json', mode: '100644', type: 'blob', sha: 'blob1' },
    { path: 'docs/old.json', mode: '100644', type: 'blob', sha: null }
  ])
  assert.deepEqual(calls[2].body.parents, ['c1'])
  assert.deepEqual(calls[3], { method: 'PATCH', path: '/repos/owner/repo/git/refs/heads/main', body: { sha: 'commit2', force: false } })
  await assert.rejects(transport.writeCommit({ parentSha: 'c1', baseTreeSha: 't1', files: files.slice(0, 1) }), TransportConflictError)
})

test('ensureRepo: writable private repo passes, read-only repo is refused with PAT guidance', async () => {
  const ok = createGitHubTransport({ request: scripted([{ status: 200, data: { private: true, permissions: { push: true } } }]).request, repo: 'owner/repo' })
  assert.deepEqual(await ok.ensureRepo(), { private: true, created: false })
  const readOnly = createGitHubTransport({ request: scripted([{ status: 200, data: { private: true, permissions: { push: false } } }]).request, repo: 'owner/repo' })
  await assert.rejects(readOnly.ensureRepo(), /Contents: Read and write/)
  const forbidden = createGitHubTransport({ request: scripted([{ status: 403, data: { message: 'Resource not accessible' } }]).request, repo: 'owner/repo' })
  await assert.rejects(forbidden.ensureRepo(), /Contents: Read and write/)
})

test('ensureRepo creates a missing private repo with the branch, and rejects wrong owners or hidden repos', async () => {
  const create = scripted([
    { status: 404, data: { message: 'Not Found' } },
    { status: 201, data: { full_name: 'Owner/MindMaps', private: true } }
  ])
  const transport = createGitHubTransport({ request: create.request, repo: 'owner/mindmaps', branch: 'sync-main' })
  assert.deepEqual(await transport.ensureRepo(), { private: true, created: true })
  assert.deepEqual(create.calls[1], { method: 'POST', path: '/user/repos', body: { name: 'mindmaps', private: true, auto_init: true, default_branch: 'sync-main' } })

  const wrongOwner = createGitHubTransport({ request: scripted([{ status: 404, data: {} }, { status: 201, data: { full_name: 'me/mindmaps' } }]).request, repo: 'some-org/mindmaps' })
  await assert.rejects(wrongOwner.ensureRepo(), /不一致/)
  const hidden = createGitHubTransport({ request: scripted([{ status: 404, data: {} }, { status: 422, data: { message: 'name already exists' } }]).request, repo: 'owner/mindmaps' })
  await assert.rejects(hidden.ensureRepo(), /Repository access/)
})

test('the transport works end to end against the fake GitHub server (including 304 polling and CAS)', async () => {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'feature/sync' })
  try {
    const request = createFetchRequester({ fetchFn: fetch, apiBase: server.apiBase, token: TOKEN })
    const transport = createGitHubTransport({ request, repo: 'chenrui/mindflow-data', branch: 'feature/sync' })
    assert.equal((await transport.ensureRepo()).created, false)
    const head = await transport.getHead()
    const tree = await transport.getTree(head.sha)
    assert.deepEqual(tree.byPath, {})
    const next = await transport.writeCommit({ parentSha: head.sha, baseTreeSha: tree.treeSha, files: [{ path: 'manifest.json', content: '{"schemaVersion":2}' }] })
    const after = await transport.getHead({ etag: head.etag })
    assert.equal(after.sha, next)
    assert.deepEqual(await transport.getHead({ etag: after.etag }), { sha: null, etag: after.etag, notModified: true })
    const newTree = await transport.getTree(next)
    assert.equal(await transport.readBlob(newTree.byPath['manifest.json'].sha), '{"schemaVersion":2}')
    // 用舊的 parent 再推一次：不是 fast-forward → 衝突
    await assert.rejects(transport.writeCommit({ parentSha: head.sha, baseTreeSha: tree.treeSha, files: [{ path: 'x', content: '1' }] }), TransportConflictError)
    assert.equal(JSON.stringify(server.snapshot()).includes(TOKEN), false, '權杖不會進伺服器紀錄')
  } finally {
    await server.close()
  }
})
