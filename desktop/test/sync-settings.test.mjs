import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import Module, { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  getDecryptedToken,
  loadSyncSettings,
  saveSyncSettings
} from '../sync-settings.mjs'

const require = createRequire(import.meta.url)
const PRELOAD_PATH = fileURLToPath(new URL('../preload.cjs', import.meta.url))
const SETTINGS_FILENAME = 'sync-settings.json'

function createSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable() {
      return available
    },
    encryptString(value) {
      return Buffer.from(`encrypted:${value}`, 'utf8')
    },
    decryptString(value) {
      const decoded = value.toString('utf8')
      if (!decoded.startsWith('encrypted:')) throw new Error('Invalid encrypted value')
      return decoded.slice('encrypted:'.length)
    }
  }
}

async function withElectronMock(electronMock, run) {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronMock
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    return await run()
  } finally {
    Module._load = originalLoad
  }
}

async function withUserData(run) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-sync-settings-'))
  try {
    await run(userDataPath)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
}

async function withTokenLeakGuards(token, run) {
  const consoleMethods = ['debug', 'error', 'info', 'log', 'warn']
  const originalConsole = Object.fromEntries(consoleMethods.map(method => [method, console[method]]))
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  for (const method of consoleMethods) {
    console[method] = (...values) => {
      const serialized = values.map(value => String(value)).join(' ')
      assert.equal(serialized.includes(token), false, `token leaked through console.${method}`)
    }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem(_key, value) {
        assert.equal(String(value).includes(token), false, 'token leaked to localStorage')
      }
    }
  })

  try {
    return await run()
  } finally {
    for (const method of consoleMethods) console[method] = originalConsole[method]
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    } else {
      delete globalThis.localStorage
    }
  }
}

function loadPreload(electronMock) {
  let exposed
  const contextBridge = {
    exposeInMainWorld(name, api) {
      exposed = { name, api }
    }
  }

  return withElectronMock({ ...electronMock, contextBridge }, async () => {
    delete require.cache[PRELOAD_PATH]
    require(PRELOAD_PATH)
    return exposed
  })
}

test('missing settings load as disabled with the main branch and no token', async () => {
  await withUserData(async userDataPath => {
    assert.deepEqual(loadSyncSettings(userDataPath), {
      enabled: false,
      repo: '',
      branch: 'main',
      tokenCipher: null
    })
    assert.equal(getDecryptedToken(loadSyncSettings(userDataPath)), null)
  })
})

test('token round-trips through safeStorage and never appears in the settings file', async () => {
  await withUserData(async userDataPath => {
    const token = 'ghp_plaintext_must_not_leak'
    const safeStorage = createSafeStorage()

    await withTokenLeakGuards(token, async () => {
      await withElectronMock({ safeStorage }, async () => {
        saveSyncSettings(userDataPath, {
          enabled: true,
          repo: 'mindflow/private-sync',
          token
        })

        const settings = loadSyncSettings(userDataPath)
        assert.deepEqual(settings, {
          enabled: true,
          repo: 'mindflow/private-sync',
          branch: 'main',
          tokenCipher: Buffer.from(`encrypted:${token}`, 'utf8').toString('base64')
        })
        assert.equal(getDecryptedToken(settings), token)
      })
    })

    const raw = await readFile(join(userDataPath, SETTINGS_FILENAME), 'utf8')
    assert.equal(raw.includes(token), false)
    assert.equal(Object.hasOwn(JSON.parse(raw), 'token'), false)
  })
})

test('a patch without token preserves the existing encrypted token', async () => {
  await withUserData(async userDataPath => {
    const token = 'github_pat_keep_this_cipher'
    const safeStorage = createSafeStorage()

    await withElectronMock({ safeStorage }, async () => {
      saveSyncSettings(userDataPath, { token, repo: 'owner/old' })
      const originalCipher = loadSyncSettings(userDataPath).tokenCipher

      saveSyncSettings(userDataPath, { enabled: true, repo: 'owner/new' })
      const settings = loadSyncSettings(userDataPath)

      assert.equal(settings.tokenCipher, originalCipher)
      assert.equal(settings.repo, 'owner/new')
      assert.equal(settings.enabled, true)
      assert.equal(getDecryptedToken(settings), token)
    })
  })
})

test('refuses to persist a token when safeStorage encryption is unavailable', async () => {
  await withUserData(async userDataPath => {
    const token = 'ghp_never_write_without_encryption'

    await withElectronMock({ safeStorage: createSafeStorage({ available: false }) }, async () => {
      assert.throws(
        () => saveSyncSettings(userDataPath, { enabled: true, token }),
        /secure token storage is unavailable/i
      )
    })

    await assert.rejects(readFile(join(userDataPath, SETTINGS_FILENAME), 'utf8'), {
      code: 'ENOENT'
    })
  })
})

test('preload exposes only the sync bridge and never hands token material to the renderer', async () => {
  const ipcRenderer = new EventEmitter()
  const calls = []
  ipcRenderer.invoke = async (channel, payload) => {
    calls.push({ channel, payload })
    if (channel === 'mindflow-sync:get-config') {
      return {
        enabled: true,
        repo: 'owner/private',
        branch: 'main',
        hasToken: true,
        token: 'ghp_renderer_must_never_receive_this',
        tokenCipher: 'also-private'
      }
    }
    if (channel === 'mindflow-sync:set-config') return { ok: true, token: 'leak' }
    if (channel === 'mindflow-sync:github-request') return { status: 200, etag: 'W/"1"', data: { object: { sha: 'abc' } }, rateRemaining: 4999, token: 'leak' }
    if (channel === 'mindflow-sync:get-legacy-state') return { lastSyncedCommitSha: 'c1', baseManifest: { docs: {} }, perDoc: {}, machineId: 'pc-1', token: 'leak' }
    if (channel === 'mindflow-sync:startup-ready') return true
    if (channel === 'mindflow-sync:show-pairing-qr') return { ok: true, payload: 'mindflow-pair:{"token":"ghp_must_not_reach_renderer"}' }
    throw new Error(`Unexpected channel: ${channel}`)
  }

  const exposed = await loadPreload({ ipcRenderer })
  assert.equal(exposed.name, 'mindflowSync')
  assert.deepEqual(Object.keys(exposed.api).sort(), [
    'getConfig',
    'getLegacyState',
    'githubRequest',
    'setConfig',
    'showPairingQr',
    'waitForStartup'
  ])

  const config = await exposed.api.getConfig()
  assert.deepEqual(config, { enabled: true, repo: 'owner/private', branch: 'main', hasToken: true })
  assert.deepEqual(
    await exposed.api.setConfig({ token: 'ghp_new', repo: 'owner/new', enabled: false, branch: 'evil' }),
    { ok: true }
  )
  const response = await exposed.api.githubRequest({ method: 'GET', path: '/repos/owner/private/git/ref/heads/main', headers: { 'if-none-match': 'x' }, extra: 1 })
  assert.deepEqual(response, { status: 200, etag: 'W/"1"', data: { object: { sha: 'abc' } }, rateRemaining: 4999 })
  assert.deepEqual(await exposed.api.getLegacyState(), { lastSyncedCommitSha: 'c1', baseManifest: { docs: {} }, perDoc: {}, machineId: 'pc-1' })
  assert.equal(await exposed.api.waitForStartup(), true)
  assert.deepEqual(await exposed.api.showPairingQr(), { ok: true }, '配對 QR 的內容（含 PAT）不得回到 renderer')

  assert.deepEqual(calls, [
    { channel: 'mindflow-sync:get-config', payload: undefined },
    { channel: 'mindflow-sync:set-config', payload: { token: 'ghp_new', repo: 'owner/new', enabled: false } },
    { channel: 'mindflow-sync:github-request', payload: { method: 'GET', path: '/repos/owner/private/git/ref/heads/main', headers: { 'if-none-match': 'x' } } },
    { channel: 'mindflow-sync:get-legacy-state', payload: undefined },
    { channel: 'mindflow-sync:startup-ready', payload: undefined },
    { channel: 'mindflow-sync:show-pairing-qr', payload: undefined }
  ])
})
