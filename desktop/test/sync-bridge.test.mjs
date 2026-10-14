import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { SYNC_BRIDGE_CHANNELS, registerSyncBridgeIpc, validateGitHubRequest } from '../sync-bridge.mjs'

const TOKEN = 'TEST-ONLY-NOT-A-REAL-TOKEN-bridge-0123456789'

function setup({ settings = { enabled: true, repo: 'Owner/Repo', branch: 'main', tokenCipher: 'cipher' }, fetchFn, startupReady, userDataPath = 'X:\\user-data' } = {}) {
  const handlers = new Map()
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) }
  const saved = []
  const requests = []
  const registration = registerSyncBridgeIpc({
    ipcMain,
    userDataPath,
    startupReady,
    loadSettings: () => settings,
    saveSettings: (_path, patch) => { saved.push(patch); return { ...settings, ...patch } },
    getToken: () => TOKEN,
    fetchFn: fetchFn || (async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify({ object: { sha: 'abc' }, message: `echo ${TOKEN}` }), { status: 200, headers: { etag: 'W/"e1"', 'x-ratelimit-remaining': '4999' } })
    })
  })
  const invoke = (channel, payload) => handlers.get(channel)({}, payload)
  return { handlers, registration, saved, requests, invoke }
}

test('the request whitelist only allows the configured repository and repo creation', () => {
  const repo = 'Owner/Repo'
  assert.equal(validateGitHubRequest({ path: '/repos/Owner/Repo' }, repo), null)
  assert.equal(validateGitHubRequest({ path: '/repos/owner/repo/git/ref/heads/main' }, repo), null, '大小寫不同仍是同一個 repo')
  assert.equal(validateGitHubRequest({ method: 'POST', path: '/repos/Owner/Repo/git/blobs', body: { content: 'x' } }, repo), null)
  assert.equal(validateGitHubRequest({ method: 'PATCH', path: '/repos/Owner/Repo/git/refs/heads/main', body: { sha: 'a', force: false } }, repo), null)
  assert.equal(validateGitHubRequest({ method: 'POST', path: '/user/repos', body: { name: 'Repo' } }, repo), null)
  for (const bad of [
    { path: '/repos/Owner/Other/git/blobs' },
    { path: '/repos/Owner/Repo-evil/git/blobs' },
    { path: '/user' },
    { path: '/repos/Owner/Repo/contents/x' },
    { method: 'DELETE', path: '/repos/Owner/Repo/git/refs/heads/main' },
    { method: 'PATCH', path: '/repos/Owner/Repo' },
    { path: '/repos/Owner/Repo/git/../../../user' },
    { path: '/repos/Owner/Repo/git/%2e%2e/%2E%2E/user' },
    { path: 'https://evil.example/repos/Owner/Repo/git/blobs' },
    { path: '/repos/Owner/Repo/git/blobs', headers: { authorization: 'Bearer x' } },
    { path: '/repos/Owner/Repo/git/blobs', body: 'raw' }
  ]) {
    assert.notEqual(validateGitHubRequest(bad, repo), null, JSON.stringify(bad))
  }
  assert.notEqual(validateGitHubRequest({ path: '/repos/Owner/Repo' }, ''), null, '沒設定 repo 不代理任何請求')
})

test('the proxy adds the token in main, and nothing it returns contains the token', async () => {
  const env = setup()
  const response = await env.invoke(SYNC_BRIDGE_CHANNELS.githubRequest, { method: 'GET', path: '/repos/Owner/Repo/git/ref/heads/main', headers: { 'if-none-match': 'W/"e0"' } })
  assert.equal(response.status, 200)
  assert.equal(response.etag, 'W/"e1"')
  assert.equal(response.rateRemaining, 4999)
  assert.equal(JSON.stringify(response).includes(TOKEN), false, 'GitHub 回應裡的權杖字串也遮掉')
  assert.equal(env.requests[0].init.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(env.requests[0].init.headers['if-none-match'], 'W/"e0"')
  assert.equal(env.requests[0].url, 'https://api.github.com/repos/Owner/Repo/git/ref/heads/main')

  const rejected = await env.invoke(SYNC_BRIDGE_CHANNELS.githubRequest, { path: '/user' })
  assert.equal(rejected.status, 403)
  assert.equal(env.requests.length, 1, '被拒絕的請求不會送出')

  const config = await env.invoke(SYNC_BRIDGE_CHANNELS.getConfig)
  assert.deepEqual(config, { enabled: true, repo: 'Owner/Repo', branch: 'main', hasToken: true })
  assert.deepEqual(await env.invoke(SYNC_BRIDGE_CHANNELS.setConfig, { enabled: true, repo: 'a/b', token: 't', branch: 'x', other: 1 }), { ok: true })
  assert.deepEqual(env.saved, [{ enabled: true, repo: 'a/b', token: 't' }], 'renderer 只能改 enabled／repo／token')
})

test('network errors are redacted and reported as status 0', async () => {
  const env = setup({ fetchFn: async () => { throw new Error(`connect failed with ${TOKEN}`) } })
  const response = await env.invoke(SYNC_BRIDGE_CHANNELS.githubRequest, { path: '/repos/Owner/Repo/git/ref/heads/main' })
  assert.equal(response.status, 0)
  assert.equal(JSON.stringify(response).includes(TOKEN), false)
})

test('startup gate waits for recovery, and the M1 base is handed over without anything else', async () => {
  let release
  const startupReady = new Promise(resolve => { release = resolve })
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-bridge-'))
  try {
    await writeFile(join(userDataPath, 'sync-state.json'), JSON.stringify({ lastSyncedCommitSha: 'c1', baseManifest: { schemaVersion: 1, docs: {} }, perDoc: { a: 't' }, machineId: 'DESKTOP-1-ab12', etag: 'x' }))
    const env = setup({ startupReady, userDataPath })
    let resolved = false
    const gate = env.invoke(SYNC_BRIDGE_CHANNELS.startupReady).then(value => { resolved = value })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(resolved, false, '救援完成前不放行')
    release()
    await gate
    assert.equal(resolved, true)
    assert.deepEqual(await env.invoke(SYNC_BRIDGE_CHANNELS.getLegacyState), {
      lastSyncedCommitSha: 'c1', baseManifest: { schemaVersion: 1, docs: {} }, perDoc: { a: 't' }, machineId: 'DESKTOP-1-ab12'
    })
    env.registration.dispose()
    assert.equal(env.handlers.size, 0)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})
