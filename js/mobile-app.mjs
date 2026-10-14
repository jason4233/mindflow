/**
 * Android App 的生命週期：返回鍵、進背景時立即存檔＋推送同步。
 * 只在原生 Capacitor 裡啟用；網頁版與電腦版呼叫後直接回傳 null。
 */
import { getCapacitorPlugin, isNativeCapacitor } from './capacitor-plugins.mjs'

export const EXIT_CONFIRM_WINDOW_MS = 2_000

/**
 * @param {object} options
 * @param {'dashboard'|'editor'} options.page
 * @param {() => void} [options.saveNow]   立即把目前頁面的修改寫進 localStorage
 * @param {() => boolean} [options.onBack] 頁面自己處理返回鍵（例如結束文字編輯）時回傳 true
 * @param {() => ({ flush?: (reason: string) => void } | null)} [options.getSyncApi]
 */
export function initializeMobileApp({
  page,
  saveNow = () => {},
  // 存檔後是否真的可以離開（例如衝突橫幅擋住存檔、或儲存空間已滿時不能離開，否則記憶體裡的修改會遺失）
  canLeave = () => true,
  onBack = () => false,
  getSyncApi = () => null,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  app = getCapacitorPlugin('App', ['addListener'], windowRef),
  now = () => Date.now(),
  showToast = message => defaultToast(documentRef, message)
} = {}) {
  if (!isNativeCapacitor(windowRef) || !app) return null
  let lastBackAt = -Infinity
  let leaving = false
  const handles = []

  const flushSync = reason => {
    try { getSyncApi()?.flush?.(reason) } catch { /* 同步失敗會由同步引擎自己重試，不能擋住離開。 */ }
  }
  // 先存檔再推送：存檔會觸發本機修改通知，flush 才推得到最新內容。
  const persist = reason => {
    try { saveNow() } catch (error) { console.error('MindFlow 背景存檔失敗', error) }
    flushSync(reason)
  }

  const closeTopDialog = () => {
    const dialogs = [...(documentRef?.querySelectorAll?.('dialog[open]') || [])]
    const top = dialogs.at(-1)
    if (!top) return false
    // 與按 Esc 相同：先送 cancel（讓對話框做自己的取消處理），沒被攔下才關閉。
    const cancel = new (windowRef.Event || Event)('cancel', { cancelable: true })
    if (top.dispatchEvent(cancel)) top.close()
    return true
  }

  const handleBack = () => {
    if (leaving) return
    if (closeTopDialog()) return
    if (onBack()) return
    if (page === 'editor') {
      persist('back-button')
      if (!canLeave()) {
        showToast('還有修改沒有存好，請先處理上方的提示再離開。')
        return
      }
      leaving = true
      windowRef.location.href = 'index.html'
      return
    }
    const current = now()
    if (current - lastBackAt > EXIT_CONFIRM_WINDOW_MS) {
      lastBackAt = current
      showToast('再按一次返回鍵離開 MindFlow')
      return
    }
    lastBackAt = -Infinity
    flushSync('exit')
    // 縮到背景（與 Android 12 以後的系統預設相同）讓同步有時間完成；舊版外掛沒有 minimizeApp 才真的結束。
    const leave = typeof app.minimizeApp === 'function' ? app.minimizeApp() : app.exitApp?.()
    Promise.resolve(leave).catch(() => app.exitApp?.())
  }

  const onHidden = reason => persist(reason)
  const onVisibility = () => {
    if (documentRef?.visibilityState === 'hidden') onHidden('hidden')
  }
  const onPageHide = () => onHidden('pagehide')

  const register = async (eventName, listener) => {
    try {
      const handle = await app.addListener(eventName, listener)
      handles.push(handle)
    } catch (error) {
      console.warn(`MindFlow 無法註冊 ${eventName}`, error)
    }
  }
  const ready = Promise.all([
    register('backButton', handleBack),
    register('appStateChange', state => { if (state && state.isActive === false) onHidden('app-pause') })
  ])
  documentRef?.addEventListener?.('visibilitychange', onVisibility)
  windowRef?.addEventListener?.('pagehide', onPageHide)

  return Object.freeze({
    ready,
    handleBack,
    async dispose() {
      await ready
      documentRef?.removeEventListener?.('visibilitychange', onVisibility)
      windowRef?.removeEventListener?.('pagehide', onPageHide)
      await Promise.all(handles.splice(0).map(handle => Promise.resolve(handle?.remove?.()).catch(() => {})))
    }
  })
}

function defaultToast(documentRef, message) {
  if (!documentRef?.body) return
  let toast = documentRef.querySelector('[data-mobile-app-toast]')
  if (!toast) {
    toast = documentRef.createElement('div')
    toast.dataset.mobileAppToast = 'true'
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    Object.assign(toast.style, {
      position: 'fixed', left: '50%', bottom: 'calc(34px + env(safe-area-inset-bottom, 0px))',
      transform: 'translateX(-50%)', zIndex: '10001', maxWidth: 'calc(100vw - 32px)',
      padding: '10px 14px', borderRadius: '9px', background: '#253044', color: '#fff',
      fontSize: '13px', boxShadow: '0 10px 28px rgb(15 23 42 / 24%)'
    })
    documentRef.body.append(toast)
  }
  toast.textContent = message
  toast.hidden = false
  clearTimeout(defaultToast.timer)
  defaultToast.timer = setTimeout(() => { toast.hidden = true }, EXIT_CONFIRM_WINDOW_MS)
}
