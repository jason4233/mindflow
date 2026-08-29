import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

const updater = await import('../updater.mjs').catch(() => ({}))
const {
  compareVersions,
  createUpdateChecker,
  initUpdater,
  isInstallerSizeValid,
  launchInstaller
} = updater

function latestRelease(version = '1.0.42') {
  return {
    tag_name: 'latest',
    name: 'MindFlow Latest Build',
    body: `Version: v${version}\n\nAutomated Windows setup and portable builds.`,
    assets: [{
      name: 'MindFlow-Setup.exe',
      size: 83_000_000,
      browser_download_url: 'https://example.test/MindFlow-Setup.exe'
    }]
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body
    }
  }
}

test('compares numeric version segments instead of sorting version strings', () => {
  assert.equal(typeof compareVersions, 'function')
  assert.equal(compareVersions('v1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.0.42', 'v1.0.42'), 0)
  assert.equal(compareVersions('1.0.41', '1.0.42'), -1)
})

test('checks the latest release and starts installation when a newer build is accepted', async () => {
  assert.equal(typeof createUpdateChecker, 'function')
  const prompts = []
  const installs = []
  const fetchCalls = []
  const checker = createUpdateChecker({
    currentVersion: '1.0.41',
    fetchImpl: async (...args) => {
      fetchCalls.push(args)
      return jsonResponse(latestRelease())
    },
    promptForUpdate: async update => {
      prompts.push(update)
      return 'install'
    },
    installUpdate: async update => {
      installs.push(update)
    }
  })

  const result = await checker.check()

  assert.equal(result.status, 'installing')
  assert.equal(fetchCalls.length, 1)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].version, '1.0.42')
  assert.equal(installs.length, 1)
  assert.equal(installs[0].asset.browser_download_url, 'https://example.test/MindFlow-Setup.exe')
})

test('does not fetch or prompt again during the session after Later is chosen', async () => {
  assert.equal(typeof createUpdateChecker, 'function')
  let fetchCount = 0
  let promptCount = 0
  const checker = createUpdateChecker({
    currentVersion: '1.0.41',
    fetchImpl: async () => {
      fetchCount += 1
      return jsonResponse(latestRelease())
    },
    promptForUpdate: async () => {
      promptCount += 1
      return 'later'
    },
    installUpdate: async () => assert.fail('Later must not install the update')
  })

  assert.deepEqual(await checker.check(), { status: 'deferred', version: '1.0.42' })
  assert.deepEqual(await checker.check(), { status: 'deferred' })
  assert.equal(fetchCount, 1)
  assert.equal(promptCount, 1)
})

test('silently skips the check when the GitHub API is offline', async () => {
  assert.equal(typeof createUpdateChecker, 'function')
  const checker = createUpdateChecker({
    currentVersion: '1.0.41',
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
    promptForUpdate: async () => assert.fail('Offline checks must not prompt'),
    installUpdate: async () => assert.fail('Offline checks must not install')
  })

  assert.deepEqual(await checker.check(), { status: 'skipped' })
})

test('accepts installers only when the actual file is larger than 50 MiB', () => {
  assert.equal(typeof isInstallerSizeValid, 'function')
  const fiftyMiB = 50 * 1024 * 1024
  assert.equal(isInstallerSizeValid(fiftyMiB), false)
  assert.equal(isInstallerSizeValid(fiftyMiB + 1), true)
})

test('launches the assisted NSIS installer silently and forces the app to restart', async () => {
  assert.equal(typeof launchInstaller, 'function')
  const calls = []
  let unrefCalled = false
  const spawnImpl = (...args) => {
    calls.push(args)
    const child = new EventEmitter()
    child.unref = () => { unrefCalled = true }
    queueMicrotask(() => child.emit('spawn'))
    return child
  }

  await launchInstaller('C:\\Temp\\MindFlow-Setup.exe', { spawnImpl })

  assert.deepEqual(calls, [[
    'C:\\Temp\\MindFlow-Setup.exe',
    ['/S', '--force-run'],
    { detached: true, stdio: 'ignore', windowsHide: true }
  ]])
  assert.equal(unrefCalled, true)
})

test('checks immediately and schedules subsequent checks every six hours', async () => {
  assert.equal(typeof initUpdater, 'function')
  let fetchCount = 0
  let scheduledDelay = null
  let beforeQuit = null
  const electron = {
    app: {
      isPackaged: true,
      getVersion: () => '1.0.42',
      once: (event, callback) => {
        assert.equal(event, 'before-quit')
        beforeQuit = callback
      },
      quit: () => assert.fail('An up-to-date app must not quit')
    },
    dialog: {
      showMessageBox: async () => assert.fail('An up-to-date app must not prompt')
    }
  }
  const handle = await initUpdater(null, {
    electron,
    fetchImpl: async () => {
      fetchCount += 1
      return jsonResponse(latestRelease('1.0.42'))
    },
    setIntervalImpl: (_callback, delay) => {
      scheduledDelay = delay
      return 123
    },
    clearIntervalImpl: timer => assert.equal(timer, 123)
  })

  await handle.initialCheck
  assert.equal(fetchCount, 1)
  assert.equal(scheduledDelay, 6 * 60 * 60 * 1000)
  beforeQuit()
})
