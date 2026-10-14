import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

const servers = new Set()
const instances = new Set()

async function startServer(options) {
  const { startFakeGitHubServer } = await import('./fake-github-server.mjs')
  const server = await startFakeGitHubServer(options)
  servers.add(server)
  return server
}

afterEach(async () => {
  await Promise.all([...instances].map((instance) => instance.close()))
  instances.clear()
  await Promise.all([...servers].map((server) => server.close()))
  servers.clear()
})

async function getRef(server, headers) {
  return fetch(`${server.apiBase}/repos/${server.owner}/${server.repo}/git/ref/heads/${server.branch}`, { headers })
}

async function createCommitOn(server, { parentSha, files, message = 'sync' }) {
  const gitApi = `${server.apiBase}/repos/${server.owner}/${server.repo}/git`
  const parent = await fetch(`${gitApi}/commits/${parentSha}`).then((response) => response.json())
  const entries = []
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      entries.push({ path, sha: null })
      continue
    }
    const blobResponse = await fetch(`${gitApi}/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'utf-8' })
    })
    assert.equal(blobResponse.status, 201)
    const blob = await blobResponse.json()
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const treeResponse = await fetch(`${gitApi}/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries })
  })
  assert.equal(treeResponse.status, 201)
  const tree = await treeResponse.json()
  const commitResponse = await fetch(`${gitApi}/commits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] })
  })
  assert.equal(commitResponse.status, 201)
  return commitResponse.json()
}

test('fake GitHub 的 8 個 Git Data 端點可完成 commit/ref round-trip', async () => {
  const server = await startServer({ owner: 'acme', repo: 'mindflow', branch: 'main' })
  const api = `${server.apiBase}/repos/acme/mindflow/git`

  const initialRef = await fetch(`${api}/ref/heads/main`).then((response) => response.json())
  const initialCommit = await fetch(`${api}/commits/${initialRef.object.sha}`).then((response) => response.json())
  const initialTree = await fetch(`${api}/trees/${initialCommit.tree.sha}?recursive=1`).then((response) => response.json())
  assert.deepEqual(initialTree.tree, [])

  const blobResponse = await fetch(`${api}/blobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '{"schemaVersion":1}', encoding: 'utf-8' })
  })
  assert.equal(blobResponse.status, 201)
  const blob = await blobResponse.json()

  const treeResponse = await fetch(`${api}/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      base_tree: initialCommit.tree.sha,
      tree: [{ path: 'manifest.json', mode: '100644', type: 'blob', sha: blob.sha }]
    })
  })
  assert.equal(treeResponse.status, 201)
  const tree = await treeResponse.json()

  const commitResponse = await fetch(`${api}/commits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'sync', tree: tree.sha, parents: [initialRef.object.sha] })
  })
  assert.equal(commitResponse.status, 201)
  const commit = await commitResponse.json()

  const updateResponse = await fetch(`${api}/refs/heads/main`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false })
  })
  assert.equal(updateResponse.status, 200)

  const updatedRef = await fetch(`${api}/ref/heads/main`).then((response) => response.json())
  assert.equal(updatedRef.object.sha, commit.sha)
  const updatedTree = await fetch(`${api}/trees/${tree.sha}?recursive=1`).then((response) => response.json())
  assert.deepEqual(updatedTree.tree.map(({ path, sha }) => ({ path, sha })), [
    { path: 'manifest.json', sha: blob.sha }
  ])
  const storedBlob = await fetch(`${api}/blobs/${blob.sha}`).then((response) => response.json())
  assert.equal(Buffer.from(storedBlob.content, 'base64').toString('utf8'), '{"schemaVersion":1}')
})

test('If-None-Match 命中時回 304 且不消耗 rate limit', async () => {
  const server = await startServer({ rateRemaining: 9 })
  const first = await getRef(server)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('x-ratelimit-remaining'), '8')
  const etag = first.headers.get('etag')
  assert.ok(etag)

  const cached = await getRef(server, { 'if-none-match': etag })
  assert.equal(cached.status, 304)
  assert.equal(cached.headers.get('etag'), etag)
  assert.equal(cached.headers.get('x-ratelimit-remaining'), '8')
})

test('updateRef 422 可精確注入並在額度用完後恢復', async () => {
  const server = await startServer()
  const currentRef = await getRef(server).then((response) => response.json())
  const commit = await createCommitOn(server, {
    parentSha: currentRef.object.sha,
    files: { 'manifest.json': '{"schemaVersion":1}' }
  })
  server.injectUpdateRef422(2)
  const url = `${server.apiBase}/repos/owner/repo/git/refs/heads/main`
  const request = () => fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false })
  })

  assert.equal((await request()).status, 422)
  assert.equal((await request()).status, 422)
  assert.equal((await request()).status, 200)
  const updated = await getRef(server).then((response) => response.json())
  assert.equal(updated.object.sha, commit.sha)
})

test('offline 開關造成真實 fetch 網路錯誤，關閉後可恢復', async () => {
  const server = await startServer()
  server.setOffline(true)
  await assert.rejects(getRef(server), TypeError)

  server.setOffline(false)
  assert.equal((await getRef(server)).status, 200)
})

test('createTree 的 sha:null 會從 base tree 永久移除路徑', async () => {
  const server = await startServer()
  const firstRef = await getRef(server).then((response) => response.json())
  const firstCommit = await createCommitOn(server, {
    parentSha: firstRef.object.sha,
    files: { 'docs/a.json': '{"id":"a"}', 'manifest.json': '{}' }
  })
  const secondCommit = await createCommitOn(server, {
    parentSha: firstCommit.sha,
    files: { 'docs/a.json': null }
  })
  const tree = await fetch(
    `${server.apiBase}/repos/owner/repo/git/trees/${secondCommit.tree.sha}?recursive=1`
  ).then((response) => response.json())

  assert.deepEqual(tree.tree.map((entry) => entry.path), ['manifest.json'])
})

test('Authorization token 不會進入 request log 或 repo snapshot', async () => {
  const server = await startServer()
  const token = 'github_pat_NEVER_PERSIST_THIS'
  const response = await getRef(server, { authorization: `Bearer ${token}` })
  assert.equal(response.status, 200)

  const serialized = JSON.stringify(server.snapshot())
  assert.equal(serialized.includes(token), false)
  assert.deepEqual(server.requests.at(-1), {
    method: 'GET',
    path: '/repos/owner/repo/git/ref/heads/main',
    status: 200
  })
})

test('大於 1MB 的文件仍由 git/blobs 端點完整往返', async () => {
  const server = await startServer()
  const content = JSON.stringify({ id: 'large', text: '外'.repeat(400_000) })
  assert.ok(Buffer.byteLength(content) > 1024 * 1024)
  const ref = await getRef(server).then((response) => response.json())
  const commit = await createCommitOn(server, {
    parentSha: ref.object.sha,
    files: { 'docs/large.json': content }
  })
  const tree = await fetch(
    `${server.apiBase}/repos/owner/repo/git/trees/${commit.tree.sha}?recursive=1`
  ).then((response) => response.json())
  const blobSha = tree.tree.find((entry) => entry.path === 'docs/large.json').sha
  const blob = await fetch(`${server.apiBase}/repos/owner/repo/git/blobs/${blobSha}`).then((response) => response.json())

  assert.equal(Buffer.from(blob.content, 'base64').toString('utf8'), content)
  assert.equal(server.requests.some((request) => request.path.includes('/contents/')), false)
})
