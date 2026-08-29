import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASE_API_URL = 'https://api.github.com/repos/jason4233/mindflow/releases/latest'
const SETUP_ASSET_NAME = 'MindFlow-Setup.exe'
const MIN_INSTALLER_BYTES = 50 * 1024 * 1024
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

function parseExactVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/i)
  return match ? match.slice(1, 4).map(Number) : null
}

function findVersionInText(value) {
  const exact = parseExactVersion(value)
  if (exact) return exact.join('.')

  const match = String(value ?? '').match(/(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?!\d)/i)
  return match ? match.slice(1, 4).map(Number).join('.') : null
}

function releaseVersion(release) {
  for (const candidate of [release?.tag_name, release?.name, release?.body]) {
    const version = findVersionInText(candidate)
    if (version) return version
  }
  return null
}

export function compareVersions(left, right) {
  const leftParts = parseExactVersion(left)
  const rightParts = parseExactVersion(right)
  if (!leftParts || !rightParts) throw new TypeError(`Invalid version comparison: ${left} vs ${right}`)

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1
    if (leftParts[index] < rightParts[index]) return -1
  }
  return 0
}

function setupAsset(release) {
  return release?.assets?.find(asset => (
    asset?.name?.toLowerCase() === SETUP_ASSET_NAME.toLowerCase()
    && typeof asset.browser_download_url === 'string'
  )) ?? null
}

export function createUpdateChecker({
  currentVersion,
  fetchImpl = globalThis.fetch,
  promptForUpdate,
  installUpdate,
  releaseUrl = RELEASE_API_URL
}) {
  let deferredForSession = false
  let inFlight = null

  async function checkOnce() {
    const response = await fetchImpl(releaseUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (!response?.ok) throw new Error(`GitHub release API returned ${response?.status ?? 'no status'}`)

    const release = await response.json()
    const version = releaseVersion(release)
    if (!version) return { status: 'skipped' }
    if (compareVersions(version, currentVersion) <= 0) return { status: 'up-to-date', version }

    const asset = setupAsset(release)
    if (!asset) return { status: 'skipped' }

    const update = { version, release, asset }
    const decision = await promptForUpdate(update)
    if (decision !== 'install') {
      deferredForSession = true
      return { status: 'deferred', version }
    }

    await installUpdate(update)
    return { status: 'installing', version }
  }

  function check() {
    // 「稍後」是 session 層級狀態；先擋在 fetch 前，六小時計時器也不會再打 API 或彈窗。
    if (deferredForSession) return Promise.resolve({ status: 'deferred' })
    if (inFlight) return inFlight

    // API、離線與格式錯誤都只跳過；updater 不能讓主程式啟動失敗。
    inFlight = checkOnce()
      .catch(() => ({ status: 'skipped' }))
      .finally(() => { inFlight = null })
    return inFlight
  }

  return { check }
}

export function isInstallerSizeValid(size) {
  return Number.isFinite(size) && size > MIN_INSTALLER_BYTES
}

async function downloadInstaller(asset, { fetchImpl, onProgress }) {
  const response = await fetchImpl(asset.browser_download_url, {
    headers: { Accept: 'application/octet-stream' },
    redirect: 'follow'
  })
  if (!response?.ok || !response.body) {
    throw new Error(`Installer download returned ${response?.status ?? 'no status'}`)
  }

  const updateDirectory = await mkdtemp(join(tmpdir(), 'mindflow-update-'))
  const installerPath = join(updateDirectory, SETUP_ASSET_NAME)
  try {
    const headerSize = Number(response.headers?.get?.('content-length'))
    const expectedSize = Number.isFinite(headerSize) && headerSize > 0
      ? headerSize
      : Number(asset.size) || 0
    let downloadedBytes = 0
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length
        onProgress(downloadedBytes, expectedSize)
        callback(null, chunk)
      }
    })
    const source = typeof response.body.getReader === 'function'
      ? Readable.fromWeb(response.body)
      : response.body

    onProgress(0, expectedSize)
    await pipeline(source, progress, createWriteStream(installerPath))

    // GitHub asset metadata只能輔助進度；安全門檻一定看落盤後的實際大小。
    const installerStat = await stat(installerPath)
    if (!isInstallerSizeValid(installerStat.size)) {
      throw new Error(`Downloaded installer is unexpectedly small: ${installerStat.size} bytes`)
    }
    return installerPath
  } catch (error) {
    await rm(updateDirectory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export function launchInstaller(installerPath, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    // assisted NSIS 在 /S 下只有 --force-run 才會於安裝完成後啟動新版 app。
    const child = spawnImpl(installerPath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function hasLiveWindow(window) {
  return Boolean(window && !window.isDestroyed?.())
}

function showMessageBox(dialog, parentWindow, options) {
  return hasLiveWindow(parentWindow)
    ? dialog.showMessageBox(parentWindow, options)
    : dialog.showMessageBox(options)
}

function createWindowProgress(window) {
  const originalTitle = hasLiveWindow(window) ? window.getTitle() : 'MindFlow'
  let lastPercent = -1

  return {
    update(downloadedBytes, totalBytes) {
      if (!hasLiveWindow(window)) return
      if (totalBytes <= 0) {
        if (lastPercent !== -2) {
          lastPercent = -2
          window.setProgressBar(2)
          window.setTitle('MindFlow — 更新下載中')
        }
        return
      }

      const fraction = Math.min(downloadedBytes / totalBytes, 1)
      const percent = Math.floor(fraction * 100)
      if (percent === lastPercent) return
      lastPercent = percent
      window.setProgressBar(fraction)
      window.setTitle(`MindFlow — 更新下載中 ${percent}%`)
    },
    installing() {
      if (!hasLiveWindow(window)) return
      window.setProgressBar(1)
      window.setTitle('MindFlow — 正在安裝更新')
    },
    reset() {
      if (!hasLiveWindow(window)) return
      window.setProgressBar(-1)
      window.setTitle(originalTitle)
    }
  }
}

export async function initUpdater(mainWindow, {
  electron,
  fetchImpl = globalThis.fetch,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  const { app, dialog } = electron ?? await import('electron')

  // 開發模式沒有可被覆蓋的正式安裝目錄，避免 npm start 意外把開發機改成 release 版。
  if (!app.isPackaged) {
    return {
      initialCheck: Promise.resolve({ status: 'skipped' }),
      check: () => Promise.resolve({ status: 'skipped' }),
      stop() {}
    }
  }

  const progress = createWindowProgress(mainWindow)
  const checker = createUpdateChecker({
    currentVersion: app.getVersion(),
    fetchImpl,
    promptForUpdate: async ({ version }) => {
      const { response } = await showMessageBox(dialog, mainWindow, {
        type: 'info',
        title: 'MindFlow 更新',
        message: `發現新版本 v${version}，要現在更新嗎？`,
        buttons: ['確定', '稍後'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      return response === 0 ? 'install' : 'later'
    },
    installUpdate: async ({ asset }) => {
      try {
        const installerPath = await downloadInstaller(asset, {
          fetchImpl,
          onProgress: (downloadedBytes, totalBytes) => progress.update(downloadedBytes, totalBytes)
        })
        progress.installing()
        await launchInstaller(installerPath)
        app.quit()
      } catch (error) {
        progress.reset()
        await showMessageBox(dialog, mainWindow, {
          type: 'error',
          title: 'MindFlow 更新',
          message: '更新下載或啟動失敗，請稍後再試。',
          buttons: ['確定'],
          defaultId: 0,
          noLink: true
        }).catch(() => {})
        throw error
      }
    }
  })

  const initialCheck = checker.check()
  const timer = setIntervalImpl(() => { void checker.check() }, UPDATE_CHECK_INTERVAL_MS)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    clearIntervalImpl(timer)
  }
  app.once('before-quit', stop)

  return { initialCheck, check: checker.check, stop }
}
