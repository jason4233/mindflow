/** GitHub 私有 repo 同步設定 UI；Electron、Capacitor 與純 web 共用同一套畫面。 */

import {
  createMobileSyncApi,
  getCapacitorPreferences,
  isNativeCapacitor
} from './sync-mobile.mjs'

const STATUS_COPY = {
  disabled: { label: '同步未啟用', tone: 'muted' },
  idle: { label: '同步待命', tone: 'success' },
  syncing: { label: '同步中…', tone: 'progress' },
  offline: { label: '目前離線', tone: 'warning' },
  error: { label: '同步發生錯誤', tone: 'danger' }
}

const boundTriggers = new WeakSet()
let controller = null
let mobileSyncApi = null

export function describeSyncStatus(status = {}, environment = true) {
  const syncAvailable = environment === true || environment === 'electron' || environment === 'capacitor'
  if (!syncAvailable) {
    return {
      state: 'web',
      label: '同步僅桌面版與手機 App',
      detail: '請在 MindFlow 桌面版或手機 App 連接 GitHub 私有 repo。',
      tone: 'muted'
    }
  }
  const state = Object.hasOwn(STATUS_COPY, status.state) ? status.state : 'error'
  const copy = STATUS_COPY[state]
  const details = []
  const warning = typeof status.warning === 'string' && status.warning.trim() ? status.warning.trim() : null
  const docCount = Number(status.docCount)
  if (Number.isFinite(docCount) && docCount >= 0) details.push(`${Math.trunc(docCount)} 份文件`)
  if (status.lastSyncAt) details.push(`上次同步 ${formatDateTime(status.lastSyncAt)}`)
  if (state === 'error' && status.lastError) details.push(String(status.lastError))
  if (warning) details.push(warning)
  return {
    state,
    label: copy.label,
    detail: details.join('・') || defaultStatusDetail(state),
    tone: warning && state === 'idle' ? 'warning' : copy.tone
  }
}

export function protectSyncAppliedReload({ edit, isDirty, onConflict } = {}) {
  // contenteditable session 尚未 commit 時 dirty 仍是 false；先收進 command，才能交給既有 CAS 橫幅保護。
  if (edit?.session && !edit.session.finishing && typeof edit.commit === 'function') edit.commit()
  if (typeof isDirty !== 'function' || isDirty() !== true) return false
  if (typeof onConflict === 'function') onConflict()
  return true
}

export function initializeSyncSettings({ trigger = null, statusHost = null } = {}) {
  ensureFeatureStyles()
  if (!controller) controller = createSyncSettingsController()
  if (trigger && !boundTriggers.has(trigger)) {
    boundTriggers.add(trigger)
    trigger.setAttribute('aria-label', '同步設定')
    trigger.title = '同步設定'
    trigger.addEventListener('click', controller.open)
  }
  if (statusHost) controller.attachStatus(statusHost)
  void controller.refresh()
  return controller.publicApi
}

export function openSyncSettings() {
  return initializeSyncSettings().open()
}

function createSyncSettingsController() {
  const environment = resolveSyncEnvironment()
  const api = environment.api
  const syncAvailable = Boolean(api)
  const clientLabel = environment.kind === 'capacitor' ? '手機 App' : '桌面版'
  const dialog = createDialog()
  const form = dialog.querySelector('[data-sync-form]')
  const desktopPanel = dialog.querySelector('[data-sync-desktop]')
  const webPanel = dialog.querySelector('[data-sync-web]')
  const guide = dialog.querySelector('[data-sync-first-run]')
  const enabledInput = dialog.querySelector('[data-sync-enabled]')
  const repoInput = dialog.querySelector('[data-sync-repo]')
  const tokenInput = dialog.querySelector('[data-sync-token]')
  const tokenHint = dialog.querySelector('[data-sync-token-hint]')
  const statusLabel = dialog.querySelector('[data-sync-status-label]')
  const statusDetail = dialog.querySelector('[data-sync-status-detail]')
  const statusDot = dialog.querySelector('[data-sync-status-dot]')
  const feedback = dialog.querySelector('[data-sync-feedback]')
  const syncNowButton = dialog.querySelector('[data-sync-now]')
  const saveButton = dialog.querySelector('[data-sync-save]')
  const sidebarViews = new Set()
  let config = { enabled: false, repo: '', hasToken: false }
  let status = { state: syncAvailable ? 'disabled' : 'error', lastSyncAt: null, lastError: null, docCount: 0 }
  let unsubscribe = null
  let busy = false

  desktopPanel.hidden = !syncAvailable
  webPanel.hidden = syncAvailable

  dialog.querySelector('[data-sync-close]').addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => {
    // PAT 不應在 dialog 關閉後留在 renderer 記憶體或 DOM value 中。
    tokenInput.value = ''
    clearFeedback()
  })
  form.addEventListener('submit', event => {
    event.preventDefault()
    void saveConfig()
  })
  syncNowButton.addEventListener('click', () => { void syncNow() })

  if (api) {
    try {
      unsubscribe = api.onStatus(nextStatus => {
        status = normalizeStatus(nextStatus)
        renderState()
      })
    } catch {
      status = { ...status, state: 'error', lastError: '無法接收同步狀態' }
    }
  }

  async function open() {
    clearFeedback()
    renderState()
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    await refresh()
    window.requestAnimationFrame(() => {
      const target = syncAvailable ? (config.repo ? enabledInput : repoInput) : dialog.querySelector('[data-sync-close]')
      target?.focus({ preventScroll: true })
    })
  }

  async function refresh() {
    if (!api) {
      renderState()
      return { config, status }
    }
    try {
      const [nextConfig, nextStatus] = await Promise.all([api.getConfig(), api.getStatus()])
      config = normalizeConfig(nextConfig)
      status = normalizeStatus(nextStatus)
      if (config.warning) showFeedback(config.warning, 'warning')
    } catch {
      status = { ...status, state: 'error', lastError: `無法讀取同步設定，請重新開啟${clientLabel}後再試。` }
    }
    renderState()
    return { config, status }
  }

  function attachStatus(host) {
    const existing = host.querySelector('[data-sync-sidebar-status]')
    if (existing) {
      sidebarViews.add(existing)
      renderSidebarView(existing)
      return existing
    }
    const view = document.createElement('button')
    view.type = 'button'
    view.className = 'sync-sidebar-status'
    view.dataset.syncSidebarStatus = 'true'
    view.innerHTML = `
      <span class="sync-status-dot" data-sync-sidebar-dot aria-hidden="true"></span>
      <span><strong data-sync-sidebar-label></strong><small data-sync-sidebar-detail></small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`
    view.addEventListener('click', open)
    host.append(view)
    sidebarViews.add(view)
    renderSidebarView(view)
    return view
  }

  async function saveConfig() {
    if (!api || busy) return
    clearFeedback()
    const enabled = enabledInput.checked
    const repo = repoInput.value.trim()
    const token = tokenInput.value.trim()
    if (repo && !isValidRepo(repo)) {
      showFeedback('Repo 請使用 owner/name 格式，例如 chenrui/mindflow-sync。', 'error')
      repoInput.focus()
      return
    }
    if (enabled && !repo) {
      showFeedback('啟用同步前請填寫 GitHub repo。', 'error')
      repoInput.focus()
      return
    }
    if (enabled && !config.hasToken && !token) {
      showFeedback('首次啟用同步需要 GitHub Personal Access Token。', 'error')
      tokenInput.focus()
      return
    }

    setBusy(true, '儲存中…')
    try {
      const patch = { enabled, repo }
      if (token) patch.token = token
      const result = await api.setConfig(patch)
      if (!result?.ok) {
        showFeedback(redactToken(result?.error, token) || '設定儲存失敗，請檢查 PAT 與 repo 權限。', 'error')
        return
      }
      // setConfig 回傳後立即清掉輸入值；之後只依 hasToken 布林值呈現。
      tokenInput.value = ''
      const nextConfig = await api.getConfig()
      config = normalizeConfig(nextConfig)
      status = normalizeStatus(await api.getStatus())
      showFeedback(environment.kind === 'capacitor' ? '同步設定已存於手機 Preferences。' : '同步設定已安全儲存。', 'success')
    } catch {
      showFeedback(`設定儲存失敗，請確認${clientLabel}仍在執行。`, 'error')
    } finally {
      tokenInput.value = ''
      setBusy(false)
      renderState()
    }
  }

  async function syncNow() {
    if (!api || busy) return
    clearFeedback()
    setBusy(true, '同步中…')
    status = { ...status, state: 'syncing', lastError: null }
    renderState()
    try {
      const result = await api.syncNow()
      if (!result?.ok) {
        showFeedback(redactToken(result?.error, tokenInput.value) || '同步失敗，請稍後重試。', 'error')
      } else if (result.warning) {
        showFeedback(redactToken(result.warning, tokenInput.value), 'warning')
      } else {
        showFeedback('同步已完成。', 'success')
      }
      status = normalizeStatus(await api.getStatus())
    } catch {
      status = { ...status, state: 'error', lastError: '無法啟動同步' }
      showFeedback(`無法啟動同步，請確認網路與${clientLabel}狀態。`, 'error')
    } finally {
      setBusy(false)
      renderState()
    }
  }

  function setBusy(nextBusy, label = '') {
    busy = nextBusy
    enabledInput.disabled = nextBusy
    repoInput.disabled = nextBusy
    tokenInput.disabled = nextBusy
    saveButton.disabled = nextBusy
    saveButton.textContent = nextBusy && label ? label : '儲存設定'
  }

  function renderState() {
    const presentation = describeSyncStatus(status, syncAvailable ? environment.kind : 'web')
    statusLabel.textContent = presentation.label
    statusDetail.textContent = presentation.detail
    statusDot.dataset.state = presentation.state
    if (syncAvailable) {
      enabledInput.checked = config.enabled
      if (document.activeElement !== repoInput) repoInput.value = config.repo
      tokenInput.placeholder = config.hasToken
        ? (environment.kind === 'capacitor' ? '已存於手機；留空則不變更' : '已安全儲存；留空則不變更')
        : 'github_pat_…'
      if (environment.kind === 'capacitor') {
        tokenHint.textContent = config.hasToken
          ? 'PAT 已存於手機的 Capacitor Preferences；若要更換，輸入新 token 後儲存。'
          : '需要 repo Contents 讀寫權限；token 只存於手機的 Capacitor Preferences。'
      } else {
        tokenHint.textContent = config.hasToken
          ? '已有加密 PAT。若要更換，輸入新 token 後儲存。'
          : '需要 repo Contents 讀寫權限；token 只會交給桌面主程序加密保存。'
      }
      guide.hidden = Boolean(config.hasToken && config.repo)
    }
    syncNowButton.disabled = !syncAvailable || busy || !config.enabled || !config.repo || !config.hasToken || status.state === 'syncing'
    sidebarViews.forEach(renderSidebarView)
  }

  function renderSidebarView(view) {
    const presentation = describeSyncStatus(status, syncAvailable ? environment.kind : 'web')
    view.querySelector('[data-sync-sidebar-label]').textContent = presentation.label
    view.querySelector('[data-sync-sidebar-detail]').textContent = presentation.detail
    view.querySelector('[data-sync-sidebar-dot]').dataset.state = presentation.state
    view.setAttribute('aria-label', `${presentation.label}。${presentation.detail.replace(/[。．.]+$/u, '')}。開啟同步設定`)
  }

  function showFeedback(message, kind) {
    feedback.textContent = message
    feedback.dataset.kind = kind
    feedback.style.color = kind === 'warning' ? '#b45309' : ''
  }

  function clearFeedback() {
    feedback.textContent = ''
    delete feedback.dataset.kind
    feedback.style.color = ''
  }

  return {
    open,
    refresh,
    attachStatus,
    publicApi: { open, refresh, attachStatus },
    unsubscribe
  }
}

function createDialog() {
  const existing = document.querySelector('[data-sync-settings-dialog]')
  if (existing) return existing
  const dialog = document.createElement('dialog')
  dialog.className = 'feature-dialog sync-settings-dialog'
  dialog.dataset.syncSettingsDialog = 'true'
  dialog.setAttribute('aria-labelledby', 'sync-settings-title')
  dialog.innerHTML = `
    <form method="dialog" data-sync-form novalidate>
      <header>
        <div><small>MindFlow Cloud Sync</small><h2 id="sync-settings-title">同步設定</h2></div>
        <button type="button" data-sync-close aria-label="關閉同步設定">×</button>
      </header>
      <section class="sync-web-notice" data-sync-web hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17h10M9 21h6M5 3h14v14H5z"/></svg>
        <div><h3>同步僅桌面版與手機 App</h3><p>Web 版仍會保留所有本機功能。請開啟 MindFlow 桌面版或手機 App，再連接 GitHub 私有 repo。</p></div>
      </section>
      <div data-sync-desktop>
        <section class="sync-first-run" data-sync-first-run>
          <strong>首次設定</strong>
          <ol>
            <li>建立 GitHub fine-grained PAT，開啟 repo Contents 讀寫權限。</li>
            <li>填入 <code>owner/repo</code>；repo 不存在時，MindFlow 會自動建立 private repo。</li>
            <li>開啟同步並儲存，再按「立即同步」。</li>
          </ol>
        </section>
        <label class="sync-enable-row">
          <span><strong>啟用跨電腦同步</strong><small>所有裝置只透過 GitHub 私有 repo 交換狀態。</small></span>
          <input type="checkbox" data-sync-enabled><i aria-hidden="true"></i>
        </label>
        <label for="sync-repo">GitHub repo
          <input id="sync-repo" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="owner/mindflow-sync" data-sync-repo>
          <small class="sync-field-hint">格式為 owner/name；不存在時會自動建立為 private repo。</small>
        </label>
        <label for="sync-token">Personal Access Token
          <input id="sync-token" type="password" autocomplete="off" spellcheck="false" data-sync-token>
          <small class="sync-field-hint" data-sync-token-hint></small>
        </label>
        <section class="sync-status-card" role="status" aria-live="polite">
          <span class="sync-status-dot" data-sync-status-dot aria-hidden="true"></span>
          <span><strong data-sync-status-label>同步未啟用</strong><small data-sync-status-detail>尚未執行同步</small></span>
        </section>
        <p class="sync-feedback" data-sync-feedback role="alert" aria-live="polite"></p>
        <footer class="sync-settings-actions">
          <button type="button" data-sync-now>立即同步</button>
          <span aria-hidden="true"></span>
          <button type="button" data-sync-close>取消</button>
          <button type="submit" class="is-primary" data-sync-save>儲存設定</button>
        </footer>
      </div>
    </form>`
  dialog.querySelectorAll('[data-sync-close]').forEach(button => {
    button.addEventListener('click', () => dialog.close())
  })
  document.body.append(dialog)
  return dialog
}

function validSyncApi(api) {
  const methods = ['getConfig', 'setConfig', 'syncNow', 'getStatus', 'onStatus']
  return api && methods.every(name => typeof api[name] === 'function') ? api : null
}

export function detectSyncEnvironment(windowRef = globalThis.window) {
  if (windowRef?.mindflowSync) return 'electron'
  if (isNativeCapacitor(windowRef)) return 'capacitor'
  return 'web'
}

function resolveSyncEnvironment(windowRef = globalThis.window) {
  const kind = detectSyncEnvironment(windowRef)
  if (kind === 'electron') return { kind, api: validSyncApi(windowRef.mindflowSync) }
  if (kind === 'capacitor') {
    if (!mobileSyncApi) {
      const preferences = getCapacitorPreferences(windowRef)
      if (preferences && windowRef?.localStorage) {
        mobileSyncApi = createMobileSyncApi({
          preferences,
          storage: windowRef.localStorage,
          fetchFn: windowRef.fetch?.bind(windowRef) || globalThis.fetch,
          documentRef: windowRef.document,
          windowRef
        })
      }
    }
    return { kind, api: validSyncApi(mobileSyncApi) }
  }
  return { kind: 'web', api: null }
}

// settings.js 也由 editor 入口匯入；在 UI 尚未開啟前先啟動，才能保證 app 開啟即 pull。
if (typeof globalThis.window !== 'undefined' && detectSyncEnvironment(globalThis.window) === 'capacitor') {
  resolveSyncEnvironment(globalThis.window)
}

function normalizeConfig(value) {
  return {
    enabled: Boolean(value?.enabled),
    repo: typeof value?.repo === 'string' ? value.repo : '',
    hasToken: Boolean(value?.hasToken),
    warning: typeof value?.warning === 'string' ? value.warning : null
  }
}

function normalizeStatus(value) {
  return {
    state: Object.hasOwn(STATUS_COPY, value?.state) ? value.state : 'error',
    lastSyncAt: typeof value?.lastSyncAt === 'string' ? value.lastSyncAt : null,
    lastError: typeof value?.lastError === 'string' ? value.lastError : null,
    warning: typeof value?.warning === 'string' ? value.warning : null,
    docCount: Number.isFinite(Number(value?.docCount)) ? Math.max(0, Number(value.docCount)) : 0
  }
}

function defaultStatusDetail(state) {
  if (state === 'disabled') return '尚未執行同步'
  if (state === 'syncing') return '正在與 GitHub 私有 repo 對齊'
  if (state === 'offline') return '恢復網路後會自動重試'
  if (state === 'error') return '開啟設定查看復原方式'
  return '等待下一次同步'
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知時間'
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function isValidRepo(value) {
  return /^[^/\s]+\/[^/\s]+$/u.test(value)
}

function redactToken(message, token) {
  if (typeof message !== 'string') return ''
  const safe = token ? message.split(token).join('[已隱藏]') : message
  return safe.slice(0, 300)
}

function ensureFeatureStyles() {
  const loaded = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .some(link => /(?:^|\/)features\.css(?:$|[?#])/u.test(link.getAttribute('href') || ''))
  if (loaded) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/features.css'
  link.dataset.syncFeatures = 'true'
  document.head.append(link)
}
