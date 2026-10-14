/**
 * 同步設定對話框裡「只有手機 App 才有」的區塊：手機備份（匯出、從自動備份還原、從檔案還原）。
 */
import { backupDocuments, consumeRestoredNotice, formatBackupStamp, parseBackupPayload } from './mobile-backup.mjs'

/** 剛從手機備份自動還原並重新載入時，提示一次。 */
export function showRestoredNoticeIfNeeded({ windowRef = globalThis.window, documentRef = globalThis.document } = {}) {
  if (!consumeRestoredNotice(windowRef)) return false
  const message = '本機資料不見了，已自動從手機備份還原。'
  const toast = documentRef.querySelector('#dashboard-toast')
  if (toast) {
    toast.textContent = message
    toast.hidden = false
    windowRef.setTimeout(() => { toast.hidden = true }, 6000)
  } else {
    windowRef.alert?.(message)
  }
  return true
}

export function mountMobileBackupSection(container, {
  store,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  confirm = message => windowRef.confirm(message)
} = {}) {
  if (!container || !store) return null
  const existing = container.querySelector('[data-mobile-backup]')
  if (existing) return existing
  const section = documentRef.createElement('section')
  section.className = 'mobile-backup-section'
  section.dataset.mobileBackup = 'true'
  section.innerHTML = `
    <h3>手機備份</h3>
    <p class="sync-field-hint">每 2 分鐘自動備份到 App 內（保留 10 份）。重新安裝或換手機前，請先「匯出備份」存到雲端硬碟或傳給自己。還原時一律以副本加入，不會覆蓋或刪除現有文件。</p>
    <div class="mobile-backup-actions">
      <button type="button" data-backup-export>匯出備份</button>
      <button type="button" data-backup-list>從自動備份還原…</button>
      <button type="button" data-backup-file>從檔案還原…</button>
      <input type="file" accept="application/json,.json" hidden data-backup-file-input>
    </div>
    <ol class="mobile-backup-list" data-backup-items hidden></ol>
    <p class="sync-feedback" data-backup-feedback role="status" aria-live="polite"></p>`
  container.append(section)

  const feedback = section.querySelector('[data-backup-feedback]')
  const list = section.querySelector('[data-backup-items]')
  const fileInput = section.querySelector('[data-backup-file-input]')
  const buttons = [...section.querySelectorAll('button')]
  let busy = false

  const say = (message, kind = 'success') => {
    feedback.textContent = message
    feedback.dataset.kind = kind
  }
  const run = async task => {
    if (busy) return
    busy = true
    buttons.forEach(button => { button.disabled = true })
    try {
      await task()
    } catch (error) {
      console.error('MindFlow 手機備份操作失敗', error)
      say('操作失敗，請稍後再試。', 'error')
    } finally {
      busy = false
      buttons.forEach(button => { button.disabled = false })
    }
  }

  const announceRestore = (result, changedDocIds) => {
    const parts = [`已還原 ${result.restored} 份文件（以副本加入）`]
    if (result.unchanged) parts.push(`${result.unchanged} 份與現有內容相同，略過`)
    if (result.skipped) parts.push(`${result.skipped} 份是較新版本的 MindFlow 寫的，請先更新 App 再還原`)
    say(`${parts.join('；')}。`, result.skipped ? 'warning' : 'success')
    if (changedDocIds.length) {
      windowRef.dispatchEvent(new windowRef.CustomEvent('mindflow:sync-applied', { detail: { changedDocIds, source: 'backup-restore' } }))
    }
  }

  const restore = backup => {
    const count = backupDocuments(backup.entries).length
    const label = formatBackupStamp(backup.createdAt)
    if (!confirm(`要把 ${label} 的備份（${count} 份文件）以副本加入嗎？現有文件不會被覆蓋。`)) return
    const changedDocIds = []
    const result = store.restoreAsCopies(backup, { onCopy: doc => changedDocIds.push(doc.id) })
    announceRestore(result, changedDocIds)
  }

  section.querySelector('[data-backup-export]').addEventListener('click', () => run(async () => {
    say('正在準備備份檔…', 'progress')
    const result = await store.exportBackup()
    if (!result.ok) say(result.error, 'error')
    else if (result.cancelled) say('已取消匯出。', 'muted')
    else say(`已匯出 ${result.docCount} 份文件，請選擇要存放或傳送的位置。`)
  }))

  section.querySelector('[data-backup-list]').addEventListener('click', () => run(async () => {
    const backups = await store.listBackups()
    list.replaceChildren()
    if (!backups.length) {
      list.hidden = true
      say('還沒有自動備份。App 開著時每 2 分鐘會備份一次。', 'muted')
      return
    }
    for (const item of backups) {
      const row = documentRef.createElement('li')
      const button = documentRef.createElement('button')
      button.type = 'button'
      button.textContent = `${formatBackupStamp(item.createdAt)}・${item.docCount} 份文件`
      button.addEventListener('click', () => run(async () => {
        const backup = await store.readBackup(item.path)
        if (!backup) {
          say('這份備份讀不出來，請選另一份。', 'error')
          return
        }
        restore(backup)
      }))
      row.append(button)
      list.append(row)
    }
    list.hidden = false
    say('選一份要還原的備份。', 'muted')
  }))

  section.querySelector('[data-backup-file]').addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => run(async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    const backup = parseBackupPayload(await file.text())
    if (!backup) {
      say('這不是 MindFlow 的備份檔，或檔案已損壞。', 'error')
      return
    }
    restore(backup)
  }))

  return section
}

/** 設定對話框裡的「App 版本／檢查更新」列。 */
export function mountMobileUpdateSection(container, {
  checker,
  documentRef = globalThis.document,
  openUrl = url => { globalThis.window.location.href = url }
} = {}) {
  if (!container || !checker) return null
  const existing = container.querySelector('[data-mobile-update]')
  if (existing) return existing
  const section = documentRef.createElement('section')
  section.className = 'mobile-backup-section'
  section.dataset.mobileUpdate = 'true'
  section.innerHTML = `
    <h3>App 版本</h3>
    <p class="sync-field-hint" data-update-current>讀取中…</p>
    <div class="mobile-backup-actions">
      <button type="button" data-update-check>檢查更新</button>
      <button type="button" data-update-download hidden>下載新版</button>
    </div>
    <p class="sync-feedback" data-update-feedback role="status" aria-live="polite"></p>`
  container.append(section)
  const current = section.querySelector('[data-update-current]')
  const feedback = section.querySelector('[data-update-feedback]')
  const checkButton = section.querySelector('[data-update-check]')
  const downloadButton = section.querySelector('[data-update-download]')
  let downloadUrl = null

  void checker.currentVersion().then(version => {
    current.textContent = version.versionCode === null
      ? '無法讀取目前版本。'
      : `目前版本 ${version.versionName || '?'}（版號 ${version.versionCode}）`
  }).catch(() => { current.textContent = '無法讀取目前版本。' })

  downloadButton.addEventListener('click', () => { if (downloadUrl) openUrl(downloadUrl) })
  checkButton.addEventListener('click', async () => {
    checkButton.disabled = true
    feedback.textContent = '檢查中…'
    feedback.dataset.kind = 'progress'
    try {
      const result = await checker.check({ force: true })
      downloadButton.hidden = result.status !== 'update'
      downloadUrl = result.status === 'update' ? result.latest.url : null
      if (result.status === 'update') {
        feedback.textContent = `有新版（版號 ${result.latest.versionCode}）。下載後點開 APK 覆蓋安裝，資料會保留。`
        feedback.dataset.kind = 'warning'
      } else if (result.status === 'error') {
        feedback.textContent = '無法連到 GitHub 檢查更新，請確認網路後再試。'
        feedback.dataset.kind = 'error'
      } else {
        feedback.textContent = '已經是最新版。'
        feedback.dataset.kind = 'success'
      }
    } finally {
      checkButton.disabled = false
    }
  })
  return section
}
