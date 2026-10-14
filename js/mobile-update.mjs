/**
 * 手機 App 內檢查新版：讀 GitHub 上 MindFlow 的 latest release，找 `MindFlow-<versionCode>.apk`，
 * 比 App 自己的 versionCode 新就在首頁顯示提示，按下去用系統瀏覽器下載。
 * 不需要權杖（公開 API，每 IP 每小時 60 次），預設每 6 小時最多查一次。
 */
import { getCapacitorPlugin } from './capacitor-plugins.mjs'

export const UPDATE_RELEASE_API = 'https://api.github.com/repos/jason4233/mindflow/releases/latest'
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60_000
export const UPDATE_SNOOZE_MS = 3 * 24 * 60 * 60_000
export const UPDATE_STATE_KEY = 'mindflow.mobile.update'
const APK_PATTERN = /^MindFlow-(\d+)\.apk$/u

/** 從 release 的 assets 找版號最大的 MindFlow-<versionCode>.apk。 */
export function latestApkFromRelease(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  let best = null
  for (const asset of assets) {
    const match = APK_PATTERN.exec(String(asset?.name || ''))
    if (!match || typeof asset.browser_download_url !== 'string') continue
    if (!asset.browser_download_url.startsWith('https://github.com/')) continue
    const versionCode = Number(match[1])
    if (!Number.isSafeInteger(versionCode)) continue
    if (!best || versionCode > best.versionCode) {
      best = { versionCode, name: asset.name, url: asset.browser_download_url }
    }
  }
  if (best && typeof release?.html_url === 'string') best.pageUrl = release.html_url
  return best
}

function readState(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(UPDATE_STATE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeState(storage, state) {
  try { storage?.setItem(UPDATE_STATE_KEY, JSON.stringify(state)) } catch { /* 只影響節流 */ }
}

export function createUpdateChecker({
  app,
  fetchFn = globalThis.fetch,
  storage = globalThis.localStorage,
  now = () => Date.now(),
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  snoozeMs = UPDATE_SNOOZE_MS,
  releaseUrl = UPDATE_RELEASE_API
} = {}) {
  if (!app || typeof app.getInfo !== 'function') throw new TypeError('App plugin with getInfo is required')

  async function currentVersion() {
    const info = await app.getInfo()
    const versionCode = Number(info?.build)
    return {
      versionCode: Number.isSafeInteger(versionCode) ? versionCode : null,
      versionName: typeof info?.version === 'string' ? info.version : ''
    }
  }

  /**
   * @returns {Promise<{status: 'update'|'current'|'throttled'|'snoozed'|'unknown'|'error', current?, latest?, error?}>}
   */
  async function check({ force = false } = {}) {
    const state = readState(storage)
    const current = await currentVersion()
    if (!force && Number.isFinite(state.lastCheckAt) && now() - state.lastCheckAt < intervalMs) {
      // 節流期間仍沿用上次查到的結果，回到首頁時提示不會消失。
      const latest = state.latest && state.latest.versionCode > (current.versionCode ?? Infinity) ? state.latest : null
      if (!latest) return { status: 'throttled', current }
      return snoozed(state, latest) ? { status: 'snoozed', current, latest } : { status: 'update', current, latest }
    }
    let latest
    try {
      const response = await fetchFn(releaseUrl, {
        cache: 'no-store',
        headers: { accept: 'application/vnd.github+json' }
      })
      if (!response.ok) throw new Error(`GitHub ${response.status}`)
      latest = latestApkFromRelease(await response.json())
    } catch (error) {
      return { status: 'error', current, error: String(error?.message || error) }
    }
    writeState(storage, { ...state, lastCheckAt: now(), latest: latest || null })
    if (!latest || current.versionCode === null) return { status: latest ? 'unknown' : 'current', current, latest }
    if (latest.versionCode <= current.versionCode) return { status: 'current', current, latest }
    if (!force && snoozed(state, latest)) return { status: 'snoozed', current, latest }
    return { status: 'update', current, latest }
  }

  function snoozed(state, latest) {
    return state.snoozedVersion === latest.versionCode && Number.isFinite(state.snoozedAt) && now() - state.snoozedAt < snoozeMs
  }

  function snooze(latest) {
    writeState(storage, { ...readState(storage), snoozedVersion: latest.versionCode, snoozedAt: now() })
  }

  return Object.freeze({ check, snooze, currentVersion })
}

/** 首頁的新版提示；按「下載」交給系統瀏覽器（Capacitor 會把外部網址交給 Android 開啟）。 */
export function showUpdateBanner(result, {
  checker,
  documentRef = globalThis.document,
  host = documentRef.querySelector('#main-content'),
  openUrl = url => { globalThis.window.location.href = url }
} = {}) {
  if (result?.status !== 'update' || !host) return null
  documentRef.querySelector('[data-update-banner]')?.remove()
  const banner = documentRef.createElement('section')
  banner.className = 'update-banner'
  banner.dataset.updateBanner = 'true'
  banner.setAttribute('role', 'status')
  const text = documentRef.createElement('p')
  text.textContent = `有新版 MindFlow 可以安裝（版本 ${result.latest.versionCode}，目前 ${result.current.versionCode}）。下載後點開 APK 即可覆蓋安裝，資料會保留。`
  const download = documentRef.createElement('button')
  download.type = 'button'
  download.className = 'is-primary'
  download.textContent = '下載新版'
  download.addEventListener('click', () => openUrl(result.latest.url))
  const later = documentRef.createElement('button')
  later.type = 'button'
  later.textContent = '稍後'
  later.addEventListener('click', () => {
    checker?.snooze(result.latest)
    banner.remove()
  })
  banner.append(text, download, later)
  host.prepend(banner)
  return banner
}

/** 原生 App 裡啟動檢查（沒有 App 外掛或不在原生 App 裡時回傳 null）。 */
export function startUpdateCheck({ windowRef = globalThis.window, documentRef = globalThis.document } = {}) {
  const app = getCapacitorPlugin('App', ['getInfo'], windowRef)
  if (!app) return null
  const checker = createUpdateChecker({ app, fetchFn: windowRef.fetch?.bind(windowRef), storage: windowRef.localStorage })
  const ready = checker.check()
    .then(result => {
      showUpdateBanner(result, { checker, documentRef })
      return result
    })
    .catch(error => ({ status: 'error', error: String(error?.message || error) }))
  return { checker, ready }
}
