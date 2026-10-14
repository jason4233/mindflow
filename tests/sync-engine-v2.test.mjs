/**
 * M2a 同步引擎 v2 整合測試：電腦與手機用同一份引擎，透過假 GitHub 伺服器互通。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { startFakeGitHubServer } from '../desktop/test/fake-github-server.mjs'
import { createSyncEngine } from '../js/sync/engine.mjs'
import { createMemoryKv } from '../js/sync/kv.mjs'
import { createDesktopPlatform } from '../js/sync/platform-desktop.mjs'
import { MOBILE_SYNC_STATE_KEY, MOBILE_SYNC_TOKEN_KEY, createMobilePlatform } from '../js/sync/platform-mobile.mjs'
import { createFetchRequester } from '../js/sync/transport-github.mjs'

const TOKEN = 'TEST-ONLY-NOT-A-REAL-TOKEN-engine-v2-0123456789'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export class MemoryStorage {
  constructor() {
    this.values = new Map([['mindflow.docs.index', JSON.stringify({ version: 2, docs: [], trash: [], favorites: [] })]])
  }
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(String(key)) ?? null }
  setItem(key, value) { this.values.set(String(key), String(value)) }
  removeItem(key) { this.values.delete(String(key)) }
  clear() { this.values.clear() }
  snapshot() { return Object.fromEntries(this.values) }
  putDoc(document) {
    const index = JSON.parse(this.getItem('mindflow.docs.index'))
    index.docs = index.docs.filter(item => item.id !== document.id)
    index.docs.push({ id: document.id, title: document.title, createdAt: document.createdAt, updatedAt: document.updatedAt, thumbnail: '' })
    this.setItem(`mindflow.doc.${document.id}`, JSON.stringify(document))
    this.setItem('mindflow.docs.index', JSON.stringify(index))
  }
  doc(id) {
    const raw = this.getItem(`mindflow.doc.${id}`)
    return raw === null ? null : JSON.parse(raw)
  }
  titles() {
    return JSON.parse(this.getItem('mindflow.docs.index')).docs.map(item => item.title).sort()
  }
}

class MemoryPreferences {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)) }
  async get({ key }) { return { value: this.values.get(key) ?? null } }
  async set({ key, value }) { this.values.set(key, String(value)) }
  async remove({ key }) { this.values.delete(key) }
}

class MemorySecureStorage {
  constructor() { this.values = new Map() }
  async isAvailable() { return { available: true } }
  async get({ key }) { return { value: this.values.get(key) ?? null } }
  async set({ key, value }) { this.values.set(key, value) }
  async remove({ key }) { this.values.delete(key) }
}

export function makeDoc(id, title, at, extra = {}) {
  return {
    id,
    title,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: at,
    root: { id: `${id}-root`, text: title, children: [], ...extra.root },
    layout: 'mindmap-both'
  }
}

/** 模擬 main process 的權杖代理：renderer 端的平台只看得到 githubRequest。 */
function fakeDesktopBridge(server, { repo = 'chenrui/mindflow-data' } = {}) {
  let config = { enabled: false, repo: '', branch: 'main', hasToken: false }
  const proxy = createFetchRequester({ fetchFn: fetch, apiBase: server.apiBase, token: TOKEN })
  return {
    calls: [],
    async getConfig() { return { ...config } },
    async setConfig(patch) {
      config = { ...config, ...('enabled' in patch ? { enabled: patch.enabled } : {}), ...('repo' in patch ? { repo: patch.repo } : {}), ...('token' in patch ? { hasToken: Boolean(patch.token) } : {}) }
      return { ok: true }
    },
    async githubRequest(spec) {
      this.calls.push(`${spec.method || 'GET'} ${spec.path}`)
      return proxy(spec)
    },
    async getLegacyState() { return null },
    repo
  }
}

export async function createEnv({ mobilePreferences = new MemoryPreferences(), fetchFn = fetch } = {}) {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const clocks = { pc: Date.parse('2026-10-14T10:00:00.000Z'), android: Date.parse('2026-10-14T10:00:00.000Z') }
  const timers = []
  const fakeTimers = {
    setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    clearTimeoutFn: id => { if (timers[id - 1]) timers[id - 1].cancelled = true },
    setIntervalFn: () => 0,
    clearIntervalFn: () => {}
  }
  const pcStorage = new MemoryStorage()
  const androidStorage = new MemoryStorage()
  const pcKv = createMemoryKv()
  const androidKv = createMemoryKv()
  const bridge = fakeDesktopBridge(server)
  const applied = { pc: [], android: [] }
  const pc = createSyncEngine({
    platform: createDesktopPlatform(bridge),
    storage: pcStorage,
    kv: pcKv,
    now: () => new Date(clocks.pc),
    monotonic: () => clocks.pc,
    documentRef: new EventTarget(),
    windowRef: new EventTarget(),
    observeLocalChanges: () => () => {},
    dispatchSyncApplied: detail => applied.pc.push(detail),
    autoStart: false,
    ...fakeTimers
  })
  const secure = new MemorySecureStorage()
  const android = createSyncEngine({
    platform: createMobilePlatform({ preferences: mobilePreferences, secureStorage: secure, fetchFn: (url, init) => fetchFn(url, init), apiBase: server.apiBase }),
    storage: androidStorage,
    kv: androidKv,
    now: () => new Date(clocks.android),
    monotonic: () => clocks.android,
    documentRef: new EventTarget(),
    windowRef: new EventTarget(),
    observeLocalChanges: () => () => {},
    dispatchSyncApplied: detail => applied.android.push(detail),
    autoStart: false,
    ...fakeTimers
  })
  assert.deepEqual(await pc.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token: TOKEN }), { ok: true })
  assert.deepEqual(await android.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token: TOKEN }), { ok: true })
  return {
    server, pc, android, pcStorage, androidStorage, pcKv, androidKv, bridge, secure, clocks, timers, applied, mobilePreferences,
    async remoteFile(path) {
      const snapshot = server.snapshot()
      const refSha = snapshot.refs['heads/main']
      const commit = snapshot.commits[refSha]
      const tree = snapshot.trees[commit.tree]
      const entry = tree.find(item => item.path === path)
      if (!entry) return null
      return snapshot.blobs[entry.sha]
    },
    async remotePaths() {
      const snapshot = server.snapshot()
      const commit = snapshot.commits[snapshot.refs['heads/main']]
      return snapshot.trees[commit.tree].map(item => item.path).sort()
    },
    async close() {
      await pc.dispose()
      await android.dispose()
      await server.close()
    }
  }
}

test('v2: desktop pushes schemaVersion 2 with HLC and extracted images; the phone pulls a byte-identical document', async () => {
  const env = await createEnv()
  try {
    const original = makeDoc('roadmap', '同步 v2 路線圖', '2026-10-14T09:00:00.000Z', {
      root: { children: [{ id: 'img-node', text: '圖', children: [], image: { src: PNG, w: 1, h: 1 } }] }
    })
    env.pcStorage.putDoc(original)
    assert.deepEqual(await env.pc.syncNow({ reason: 'test' }), { ok: true })

    const manifest = JSON.parse(await env.remoteFile('manifest.json'))
    assert.equal(manifest.schemaVersion, 2)
    assert.match(manifest.docs.roadmap.hlc, /^\d{13}-[0-9a-f]{4}-/)
    assert.equal(manifest.docs.roadmap.writer.startsWith('pc-'), true)
    const cloudDoc = JSON.parse(await env.remoteFile('docs/roadmap.json'))
    assert.equal(cloudDoc.schemaVersion, 2)
    assert.equal(JSON.stringify(cloudDoc).includes('data:image'), false, '雲端文件不含圖片本體')
    const assetPaths = (await env.remotePaths()).filter(path => path.startsWith('assets/'))
    assert.equal(assetPaths.length, 1)
    assert.equal(await env.remoteFile(assetPaths[0]), PNG)

    assert.deepEqual(await env.android.syncNow({ reason: 'test' }), { ok: true })
    assert.equal(env.androidStorage.getItem('mindflow.doc.roadmap'), env.pcStorage.getItem('mindflow.doc.roadmap'), '圖片往返後逐字相同')
    assert.deepEqual(env.applied.android, [{ changedDocIds: ['roadmap'] }])
    assert.ok(env.bridge.calls.every(call => !call.includes(TOKEN)))
    assert.equal(JSON.stringify(env.pcKv.snapshot()).includes(TOKEN), false, '電腦端 KV 不含權杖')
    assert.equal(JSON.stringify(env.androidKv.snapshot()).includes(TOKEN), false, '手機 KV 不含權杖')
    assert.equal(env.secure.values.get(MOBILE_SYNC_TOKEN_KEY), TOKEN)
    assert.equal(env.mobilePreferences.values.has(MOBILE_SYNC_TOKEN_KEY), false)
  } finally {
    await env.close()
  }
})

test('v2: edits flow both ways and an unchanged image is not uploaded again', async () => {
  const env = await createEnv()
  try {
    env.pcStorage.putDoc(makeDoc('shared', '共同', '2026-10-14T09:00:00.000Z', {
      root: { children: [{ id: 'img', text: '圖', children: [], image: { src: PNG, w: 1, h: 1 } }] }
    }))
    await env.pc.syncNow()
    await env.android.syncNow()
    const phoneDoc = env.androidStorage.doc('shared')
    phoneDoc.title = '手機改過'
    phoneDoc.updatedAt = '2026-10-14T10:05:00.000Z'
    env.androidStorage.putDoc(phoneDoc)
    const blobPostsBefore = env.server.requests.filter(request => request.method === 'POST' && request.path.endsWith('/git/blobs')).length
    assert.deepEqual(await env.android.syncNow(), { ok: true })
    const blobPosts = env.server.requests.filter(request => request.method === 'POST' && request.path.endsWith('/git/blobs')).length - blobPostsBefore
    assert.equal(blobPosts, 2, '只上傳文件與 manifest，圖片已在雲端')
    await env.pc.syncNow()
    assert.equal(env.pcStorage.doc('shared').title, '手機改過')
    assert.equal(env.pcStorage.getItem('mindflow.doc.shared'), env.androidStorage.getItem('mindflow.doc.shared'))
  } finally {
    await env.close()
  }
})

/** 直接用 Git Data API 在假伺服器上做一個 commit（模擬 M1 寫的 v1 資料，或注入其他狀態）。 */
async function commitFiles(server, files, { message = 'seed' } = {}) {
  const request = createFetchRequester({ fetchFn: fetch, apiBase: server.apiBase, token: TOKEN })
  const base = '/repos/chenrui/mindflow-data'
  const ref = await request({ path: `${base}/git/ref/heads/main` })
  const commit = await request({ path: `${base}/git/commits/${ref.data.object.sha}` })
  const tree = []
  for (const [path, content] of Object.entries(files)) {
    if (content === null) { tree.push({ path, mode: '100644', type: 'blob', sha: null }); continue }
    const blob = await request({ method: 'POST', path: `${base}/git/blobs`, body: { content, encoding: 'utf-8' } })
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha })
  }
  const newTree = await request({ method: 'POST', path: `${base}/git/trees`, body: { base_tree: commit.data.tree.sha, tree } })
  const newCommit = await request({ method: 'POST', path: `${base}/git/commits`, body: { message, tree: newTree.data.sha, parents: [ref.data.object.sha] } })
  const patched = await request({ method: 'PATCH', path: `${base}/git/refs/heads/main`, body: { sha: newCommit.data.sha, force: false } })
  assert.equal(patched.status, 200)
  return newCommit.data.sha
}

function v1Manifest(docs) {
  return JSON.stringify({
    schemaVersion: 1,
    docs: Object.fromEntries(docs.map(doc => [doc.id, { title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, state: 'active' }])),
    favorites: [],
    tombstones: {},
    lastWriter: 'old-desktop'
  })
}

test('v1 → v2: the first push upgrades every document (HLC, extracted images) without conflict copies', async () => {
  const env = await createEnv()
  try {
    const withImage = makeDoc('legacy-img', '舊版有圖', '2026-10-10T00:00:00.000Z', {
      root: { children: [{ id: 'img', text: '圖', children: [], image: { src: PNG, w: 1, h: 1 } }] }
    })
    const plain = makeDoc('legacy-plain', '舊版純文字', '2026-10-11T00:00:00.000Z')
    const legacyCommit = await commitFiles(env.server, {
      'manifest.json': v1Manifest([withImage, plain]),
      'docs/legacy-img.json': JSON.stringify(withImage),
      'docs/legacy-plain.json': JSON.stringify(plain)
    })
    // 電腦已經是 M1 同步過的狀態（本機與雲端相同、base 是 v1）
    env.pcStorage.putDoc(withImage)
    env.pcStorage.putDoc(plain)
    await env.pcKv.set('state', {
      lastSyncedCommitSha: legacyCommit,
      baseManifest: JSON.parse(v1Manifest([withImage, plain])),
      perDoc: { 'legacy-img': withImage.updatedAt, 'legacy-plain': plain.updatedAt }
    })
    // 重新建立引擎讀取上面的 base（模擬升級後第一次啟動）
    const { createSyncEngine: create } = await import('../js/sync/engine.mjs')
    const upgraded = create({
      platform: createDesktopPlatform(env.bridge),
      storage: env.pcStorage,
      kv: env.pcKv,
      now: () => new Date(env.clocks.pc),
      monotonic: () => env.clocks.pc,
      documentRef: new EventTarget(),
      windowRef: new EventTarget(),
      observeLocalChanges: () => () => {},
      autoStart: false,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => {}
    })
    assert.deepEqual(await upgraded.syncNow(), { ok: true })
    await upgraded.dispose()

    const manifest = JSON.parse(await env.remoteFile('manifest.json'))
    assert.equal(manifest.schemaVersion, 2)
    assert.deepEqual(Object.keys(manifest.docs).sort(), ['legacy-img', 'legacy-plain'], '沒有多出衝突副本')
    for (const meta of Object.values(manifest.docs)) assert.match(meta.hlc, /^\d{13}-/)
    const cloudImg = JSON.parse(await env.remoteFile('docs/legacy-img.json'))
    assert.equal(cloudImg.schemaVersion, 2)
    assert.equal(JSON.stringify(cloudImg).includes('data:image'), false)
    assert.equal(env.pcStorage.getItem('mindflow.doc.legacy-img'), JSON.stringify(withImage), '本機文件不變')

    await env.android.syncNow()
    assert.equal(env.androidStorage.getItem('mindflow.doc.legacy-img'), JSON.stringify(withImage))
    assert.deepEqual(env.androidStorage.titles(), ['舊版有圖', '舊版純文字'])
  } finally {
    await env.close()
  }
})

test('M1 phone state in Preferences is migrated once, so the first v2 sync does not invent conflicts', async () => {
  const shared = makeDoc('shared', '兩邊一樣', '2026-10-12T00:00:00.000Z')
  const preferences = new MemoryPreferences()
  const env = await createEnv({ mobilePreferences: preferences })
  try {
    const legacyCommit = await commitFiles(env.server, { 'manifest.json': v1Manifest([shared]), 'docs/shared.json': JSON.stringify(shared) })
    preferences.values.set(MOBILE_SYNC_STATE_KEY, JSON.stringify({
      lastSyncedCommitSha: legacyCommit,
      baseManifest: JSON.parse(v1Manifest([shared])),
      perDoc: { shared: shared.updatedAt },
      machineId: 'mobile-legacy-1234'
    }))
    const androidStorage = new MemoryStorage()
    androidStorage.putDoc(shared)
    const kv = createMemoryKv()
    const phone = createSyncEngine({
      platform: createMobilePlatform({ preferences, secureStorage: env.secure, fetchFn: fetch, apiBase: env.server.apiBase }),
      storage: androidStorage,
      kv,
      now: () => new Date(env.clocks.android),
      documentRef: new EventTarget(),
      windowRef: new EventTarget(),
      observeLocalChanges: () => () => {},
      autoStart: false,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => {}
    })
    assert.deepEqual(await phone.syncNow(), { ok: true })
    assert.equal(await kv.get('machineId'), 'mobile-legacy-1234', '沿用舊的裝置 id')
    assert.deepEqual(androidStorage.titles(), ['兩邊一樣'], '沒有衝突副本')
    const manifest = JSON.parse(await env.remoteFile('manifest.json'))
    assert.equal(manifest.schemaVersion, 2)
    assert.deepEqual(Object.keys(manifest.docs), ['shared'])
    await phone.dispose()
  } finally {
    await env.close()
  }
})

test('a newer cloud format (schemaVersion 3) stops sync without touching local data or pushing', async () => {
  const env = await createEnv()
  try {
    env.pcStorage.putDoc(makeDoc('mine', '我的', '2026-10-14T09:00:00.000Z'))
    await commitFiles(env.server, { 'manifest.json': JSON.stringify({ schemaVersion: 3, docs: {}, favorites: [], tombstones: {} }) })
    const before = JSON.stringify(env.pcStorage.snapshot())
    const posts = env.server.requests.filter(request => request.method !== 'GET').length
    const result = await env.pc.syncNow()
    assert.equal(result.ok, false)
    assert.match(result.error, /較新版本/)
    assert.equal(JSON.stringify(env.pcStorage.snapshot()), before)
    assert.equal(env.server.requests.filter(request => request.method !== 'GET').length, posts)
    assert.equal((await env.pc.getStatus()).state, 'error')
  } finally {
    await env.close()
  }
})

test('race: a save between reading the cloud and pushing is never overwritten', async () => {
  let inject = null
  let blobGets = 0
  const env = await createEnv({
    async fetchFn(url, init = {}) {
      const response = await fetch(url, init)
      if (inject && (init.method || 'GET') === 'GET' && String(url).includes('/git/blobs/')) {
        blobGets += 1
        if (blobGets === 2) { const run = inject; inject = null; run() }
      }
      return response
    }
  })
  try {
    env.pcStorage.putDoc(makeDoc('shared', '共同版本', '2026-10-14T09:00:00.000Z'))
    await env.pc.syncNow()
    await env.android.syncNow()
    const desktopDoc = env.pcStorage.doc('shared')
    desktopDoc.title = '電腦的修改'
    desktopDoc.updatedAt = '2026-10-14T11:00:00.000Z'
    env.pcStorage.putDoc(desktopDoc)
    await env.pc.syncNow()
    blobGets = 0
    inject = () => {
      const doc = env.androidStorage.doc('shared')
      doc.title = '手機在同步中存的字'
      doc.updatedAt = '2026-10-14T11:00:30.000Z'
      env.androidStorage.putDoc(doc)
    }
    assert.deepEqual(await env.android.syncNow(), { ok: true })
    const titles = env.androidStorage.titles()
    assert.ok(titles.includes('手機在同步中存的字'), JSON.stringify(titles))
    assert.ok(titles.some(title => title.startsWith('電腦的修改')), '電腦的版本也保留（另存成副本或採用）')
  } finally {
    await env.close()
  }
})

test('deleting a document on one device removes it everywhere (tombstone), trash moves are synced', async () => {
  const env = await createEnv()
  try {
    env.pcStorage.putDoc(makeDoc('a', '要刪的', '2026-10-14T09:00:00.000Z'))
    env.pcStorage.putDoc(makeDoc('b', '留著的', '2026-10-14T09:00:00.000Z'))
    await env.pc.syncNow()
    await env.android.syncNow()
    const index = JSON.parse(env.androidStorage.getItem('mindflow.docs.index'))
    index.docs = index.docs.filter(item => item.id !== 'a')
    env.androidStorage.setItem('mindflow.docs.index', JSON.stringify(index))
    env.androidStorage.removeItem('mindflow.doc.a')
    await env.android.syncNow()
    assert.equal((await env.remotePaths()).includes('docs/a.json'), false)
    await env.pc.syncNow()
    assert.equal(env.pcStorage.getItem('mindflow.doc.a'), null)
    assert.deepEqual(env.pcStorage.titles(), ['留著的'])
  } finally {
    await env.close()
  }
})

test('cadence: saves wait 5 s (max 30 s) and pushes are at least 60 s apart; hidden flushes immediately', async () => {
  const server = await startFakeGitHubServer({ owner: 'chenrui', repo: 'mindflow-data', branch: 'main' })
  const storage = new MemoryStorage()
  const timers = []
  let notify = null
  let clock = 1_000_000
  const documentRef = new EventTarget()
  documentRef.visibilityState = 'visible'
  const engine = createSyncEngine({
    platform: createDesktopPlatform(fakeDesktopBridge(server)),
    storage,
    kv: createMemoryKv(),
    monotonic: () => clock,
    documentRef,
    windowRef: new EventTarget(),
    observeLocalChanges: callback => { notify = callback; return () => { notify = null } },
    setTimeoutFn: (callback, delay) => { timers.push({ callback, delay, live: true }); return timers.length },
    clearTimeoutFn: id => { if (timers[id - 1]) timers[id - 1].live = false },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    autoStart: true
  })
  try {
    storage.putDoc(makeDoc('w', '啟動前就有', '2026-10-14T08:00:00.000Z'))
    assert.deepEqual(await engine.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token: TOKEN }), { ok: true })
    const live = () => timers.filter(timer => timer.live)
    // 啟動同步剛推過 → 60 秒內的存檔要等到滿 60 秒
    storage.putDoc(makeDoc('x', '第一次', '2026-10-14T09:00:00.000Z'))
    notify()
    assert.equal(live().length, 1)
    assert.ok(live()[0].delay >= 59_000, `最小間隔：${live()[0].delay}`)
    // 計時器到點：推送
    clock += 60_000
    const first = live()[0]
    first.live = false
    assert.deepEqual(await first.callback(), { ok: true })

    clock += 120_000
    notify()
    assert.equal(live().length, 1, '連續存檔只留一個計時器')
    assert.equal(live()[0].delay, 5_000)
    clock += 28_000
    notify()
    assert.equal(live()[0].delay, 2_000, '從第一次存檔起最多等 30 秒')

    documentRef.visibilityState = 'hidden'
    documentRef.dispatchEvent(new Event('visibilitychange'))
    await new Promise(resolve => setTimeout(resolve, 50))
    await engine.flush('test-wait')
    assert.equal(live().length, 0, '進背景立刻推送，取消計時器')
    const manifest = await (async () => {
      const request = createFetchRequester({ fetchFn: fetch, apiBase: server.apiBase, token: TOKEN })
      const ref = await request({ path: '/repos/chenrui/mindflow-data/git/ref/heads/main' })
      return ref.data.object.sha
    })()
    assert.ok(manifest)
    const diagnostics = await engine.getDiagnostics()
    assert.ok(diagnostics.some(entry => entry.reason === 'hidden' && entry.ok), JSON.stringify(diagnostics))
  } finally {
    await engine.dispose()
    await server.close()
  }
})

test('poll: an unchanged branch costs one 304 request; a change triggers a pull', async () => {
  const env = await createEnv()
  const intervals = []
  const documentRef = new EventTarget()
  documentRef.visibilityState = 'visible'
  const phoneStorage = new MemoryStorage()
  const phone = createSyncEngine({
    platform: createMobilePlatform({ preferences: new MemoryPreferences(), secureStorage: new MemorySecureStorage(), fetchFn: fetch, apiBase: env.server.apiBase }),
    storage: phoneStorage,
    kv: createMemoryKv(),
    documentRef,
    windowRef: new EventTarget(),
    observeLocalChanges: () => () => {},
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
    setIntervalFn: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length },
    clearIntervalFn: () => {},
    autoStart: true
  })
  try {
    env.pcStorage.putDoc(makeDoc('p', '輪詢前', '2026-10-14T09:00:00.000Z'))
    await env.pc.syncNow()
    assert.deepEqual(await phone.setConfig({ enabled: true, repo: 'chenrui/mindflow-data', token: TOKEN }), { ok: true })
    assert.deepEqual(phoneStorage.titles(), ['輪詢前'])
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].delay, 20_000, '前景每 20 秒比一次 ETag')

    const before = env.server.requests.length
    await intervals[0].callback()
    assert.deepEqual(env.server.requests.slice(before).map(request => [request.method, request.status]), [['GET', 304]])

    env.pcStorage.putDoc(makeDoc('q', '電腦新增', '2026-10-14T10:00:00.000Z'))
    await env.pc.syncNow()
    await intervals[0].callback()
    assert.deepEqual(phoneStorage.titles(), ['輪詢前', '電腦新增'])

    documentRef.visibilityState = 'hidden'
    documentRef.dispatchEvent(new Event('visibilitychange'))
    documentRef.visibilityState = 'visible'
    documentRef.dispatchEvent(new Event('visibilitychange'))
    assert.equal(intervals.length, 2, '回前景重新開始輪詢')
  } finally {
    await phone.dispose()
    await env.close()
  }
})

test('offline edits on both devices: the later version (HLC) wins, the other is kept as a conflict copy; a ref race is retried', async () => {
  const env = await createEnv()
  try {
    env.pcStorage.putDoc(makeDoc('campaign', '共同初稿', '2026-10-14T09:00:00.000Z'))
    await env.pc.syncNow()
    await env.android.syncNow()
    env.server.setOffline(true)
    env.clocks.pc = Date.parse('2026-10-14T11:00:00.000Z')
    env.clocks.android = Date.parse('2026-10-14T12:00:00.000Z')
    const pcDoc = env.pcStorage.doc('campaign')
    env.pcStorage.putDoc({ ...pcDoc, title: '電腦離線版本', updatedAt: '2026-10-14T11:00:00.000Z' })
    const phoneDoc = env.androidStorage.doc('campaign')
    env.androidStorage.putDoc({ ...phoneDoc, title: '手機離線版本', updatedAt: '2026-10-14T12:00:00.000Z' })
    const offline = await env.pc.syncNow()
    assert.equal(offline.ok, false)
    assert.equal((await env.pc.getStatus()).state, 'offline')
    assert.equal(JSON.stringify(await env.pc.getStatus()).includes(TOKEN), false)
    env.server.setOffline(false)

    await env.android.syncNow()
    env.server.injectUpdateRef422(1)
    const start = env.server.requests.length
    assert.deepEqual(await env.pc.syncNow(), { ok: true })
    const requests = env.server.requests.slice(start)
    const conflictAt = requests.findIndex(request => request.method === 'PATCH' && request.status === 422)
    assert.ok(conflictAt >= 0 && requests.slice(conflictAt + 1).some(request => request.method === 'PATCH' && request.status === 200), '422 後重拉重推')
    await env.android.syncNow()

    for (const storage of [env.pcStorage, env.androidStorage]) {
      assert.equal(storage.doc('campaign').title, '手機離線版本', '較晚的版本勝出')
      const titles = storage.titles()
      assert.equal(titles.length, 2)
      assert.ok(titles.some(title => title.startsWith('電腦離線版本（衝突副本・電腦')), JSON.stringify(titles))
    }
  } finally {
    await env.close()
  }
})

test('favorites sync through the hub', async () => {
  const env = await createEnv()
  try {
    env.pcStorage.putDoc(makeDoc('fav', '重要專案', '2026-10-14T09:00:00.000Z'))
    await env.pc.syncNow()
    await env.android.syncNow()
    const index = JSON.parse(env.androidStorage.getItem('mindflow.docs.index'))
    index.favorites = ['fav']
    env.androidStorage.setItem('mindflow.docs.index', JSON.stringify(index))
    await env.android.syncNow()
    await env.pc.syncNow()
    assert.deepEqual(JSON.parse(env.pcStorage.getItem('mindflow.docs.index')).favorites, ['fav'])
  } finally {
    await env.close()
  }
})

test('push succeeded but applying locally failed once: the next sync does not create identical conflict copies', async () => {
  const env = await createEnv()
  try {
    env.pcStorage.putDoc(makeDoc('alpha', 'alpha v1', '2026-10-14T09:00:00.000Z'))
    env.pcStorage.putDoc(makeDoc('beta', 'beta v1', '2026-10-14T09:00:00.000Z'))
    await env.pc.syncNow()
    await env.android.syncNow()
    env.pcStorage.putDoc({ ...env.pcStorage.doc('alpha'), title: 'alpha v2', updatedAt: '2026-10-14T10:00:00.000Z' })
    env.androidStorage.putDoc({ ...env.androidStorage.doc('beta'), title: 'beta v2', updatedAt: '2026-10-14T10:00:01.000Z' })
    await env.android.syncNow()

    // 電腦這輪要拉 beta、推 alpha：推送成功後寫本機時第一次寫入失敗（例如配額）
    const originalSet = env.pcStorage.setItem.bind(env.pcStorage)
    let fail = true
    env.pcStorage.setItem = (key, value) => {
      if (fail && key === 'mindflow.doc.beta') {
        fail = false
        throw new Error('QuotaExceededError (injected)')
      }
      return originalSet(key, value)
    }
    const failed = await env.pc.syncNow()
    assert.equal(failed.ok, false)
    assert.match(failed.error, /Quota/)
    env.pcStorage.setItem = originalSet
    assert.deepEqual(await env.pc.syncNow(), { ok: true })
    await env.android.syncNow()
    for (const storage of [env.pcStorage, env.androidStorage]) {
      assert.equal(storage.doc('alpha').title, 'alpha v2')
      assert.equal(storage.doc('beta').title, 'beta v2')
      assert.equal(storage.titles().filter(title => title.includes('衝突副本')).length, 0, JSON.stringify(storage.titles()))
    }
  } finally {
    await env.close()
  }
})

test('a public repository syncs but shows a warning', async () => {
  const env = await createEnv()
  try {
    env.server.isPrivate = false
    env.pcStorage.putDoc(makeDoc('pub', '公開警告', '2026-10-14T09:00:00.000Z'))
    const result = await env.pc.syncNow()
    assert.equal(result.ok, true)
    assert.match(result.warning, /public/)
    assert.match((await env.pc.getStatus()).warning, /private/)
  } finally {
    await env.close()
  }
})
