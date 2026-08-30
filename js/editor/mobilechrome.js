/**
 * C2 行動版 chrome：只重組既有操作入口，不複製 editor command 邏輯。
 */
const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px), (pointer: coarse)`

export function shouldUseMobileChrome({ width, coarsePointer = false } = {}) {
  const viewportWidth = Number.isFinite(Number(width)) ? Number(width) : Infinity
  return viewportWidth < MOBILE_BREAKPOINT || Boolean(coarsePointer)
}

export function getKeyboardInset({ layoutHeight, viewportHeight, viewportOffsetTop = 0 } = {}) {
  const layout = Math.max(0, Number(layoutHeight) || 0)
  const viewport = Math.max(0, Number(viewportHeight) || 0)
  const offset = Math.max(0, Number(viewportOffsetTop) || 0)
  return Math.max(0, Math.round(layout - viewport - offset))
}

export function initMobileChrome(ctx = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  ensureMobileStyles()
  const media = window.matchMedia(MOBILE_QUERY)
  const editorChrome = mountEditorChrome(ctx)
  const dashboardChrome = mountDashboardChrome()
  const visualViewport = window.visualViewport

  const updateKeyboardInset = () => {
    const root = document.documentElement
    if (!visualViewport) {
      root.style.setProperty('--mobile-keyboard-inset', '0px')
      return
    }
    const layoutHeight = root.clientHeight || window.innerHeight
    const inset = getKeyboardInset({
      layoutHeight,
      viewportHeight: visualViewport.height,
      viewportOffsetTop: visualViewport.offsetTop
    })
    root.style.setProperty('--mobile-keyboard-inset', `${inset}px`)
  }

  const applyMode = () => {
    const enabled = media.matches || shouldUseMobileChrome({
      width: window.innerWidth,
      coarsePointer: window.matchMedia('(pointer: coarse)').matches
    })
    document.documentElement.classList.toggle('is-mobile-chrome', enabled)
    document.body?.classList.toggle('is-mobile-chrome', enabled)
    editorChrome?.setEnabled(enabled)
    dashboardChrome?.setEnabled(enabled)
    updateKeyboardInset()
  }

  media.addEventListener?.('change', applyMode)
  window.addEventListener('resize', applyMode)
  visualViewport?.addEventListener('resize', updateKeyboardInset)
  visualViewport?.addEventListener('scroll', updateKeyboardInset)
  applyMode()

  return () => {
    media.removeEventListener?.('change', applyMode)
    window.removeEventListener('resize', applyMode)
    visualViewport?.removeEventListener('resize', updateKeyboardInset)
    visualViewport?.removeEventListener('scroll', updateKeyboardInset)
    editorChrome?.destroy()
    dashboardChrome?.destroy()
    document.documentElement.classList.remove('is-mobile-chrome')
    document.body?.classList.remove('is-mobile-chrome')
    document.documentElement.style.removeProperty('--mobile-keyboard-inset')
  }
}

function ensureMobileStyles() {
  if (document.querySelector('link[data-mobile-styles]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'css/mobile.css'
  link.dataset.mobileStyles = 'true'
  document.head.append(link)
}

function mountEditorChrome(ctx) {
  if (!document.querySelector('.editor-page')) return null
  let wasEnabled = false
  let toolbar = document.querySelector('.mobile-bottom-toolbar')
  const created = !toolbar
  if (!toolbar) {
    toolbar = document.createElement('nav')
    toolbar.className = 'mobile-bottom-toolbar'
    toolbar.setAttribute('aria-label', '行動版編輯工具列')
    toolbar.append(
      createProxyButton({ key: 'add', icon: '＋', label: '節點', target: '#add-child-button' }),
      createProxyButton({ key: 'undo', icon: '↶', label: '復原', target: '#undo-button', mirrorDisabled: true }),
      createProxyButton({ key: 'redo', icon: '↷', label: '重做', target: '#redo-button', mirrorDisabled: true }),
      createProxyButton({ key: 'insert', icon: '⊕', label: '插入', target: '#insert-button' }),
      createProxyButton({ key: 'layout', icon: '▦', label: '佈局', invoke: () => ctx.sidepanel?.showTab?.('layout') }),
      createProxyButton({ key: 'theme', icon: '✦', label: '主題', invoke: () => ctx.sidepanel?.showTab?.('theme') })
    )
    document.body.append(toolbar)
  }

  const syncDisabled = () => {
    toolbar.querySelectorAll('[data-mobile-target]').forEach(button => {
      const source = document.querySelector(button.dataset.mobileTarget)
      button.disabled = Boolean(source?.disabled)
    })
  }
  const observer = new MutationObserver(syncDisabled)
  document.querySelectorAll('#undo-button, #redo-button').forEach(source => {
    observer.observe(source, { attributes: true, attributeFilter: ['disabled'] })
  })
  syncDisabled()

  return {
    setEnabled(enabled) {
      // 行動 drawer 若沿用桌面初始開啟狀態會整頁遮住畫布；只在進入行動模式時收合一次。
      if (enabled && !wasEnabled) ctx.sidepanel?.setOpen?.(false)
      wasEnabled = enabled
      toolbar.setAttribute('aria-hidden', String(!enabled))
      if ('inert' in toolbar) toolbar.inert = !enabled
    },
    destroy() {
      observer.disconnect()
      if (created) toolbar.remove()
    }
  }
}

function createProxyButton({ key, icon, label, target, invoke, mirrorDisabled = false }) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mobile-bottom-toolbar__button'
  button.dataset.mobileAction = key
  if (mirrorDisabled && target) button.dataset.mobileTarget = target
  button.setAttribute('aria-label', label)

  const glyph = document.createElement('span')
  glyph.className = 'mobile-bottom-toolbar__icon'
  glyph.textContent = icon
  const text = document.createElement('span')
  text.className = 'mobile-bottom-toolbar__label'
  text.textContent = label
  button.append(glyph, text)

  button.addEventListener('click', () => {
    if (invoke) invoke()
    else document.querySelector(target)?.click()
  })
  return button
}

function mountDashboardChrome() {
  const topbar = document.querySelector('.dashboard-topbar')
  const sidebar = document.querySelector('.dashboard-sidebar')
  if (!topbar || !sidebar) return null

  if (!sidebar.id) sidebar.id = 'dashboard-mobile-drawer'
  let toggle = topbar.querySelector('.dashboard-hamburger')
  let backdrop = document.querySelector('.dashboard-drawer-backdrop')
  const createdToggle = !toggle
  const createdBackdrop = !backdrop

  if (!toggle) {
    toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'dashboard-hamburger'
    toggle.setAttribute('aria-label', '開啟導覽選單')
    toggle.setAttribute('aria-controls', sidebar.id)
    toggle.innerHTML = '<span></span><span></span><span></span>'
    topbar.prepend(toggle)
  }
  if (!backdrop) {
    backdrop = document.createElement('button')
    backdrop.type = 'button'
    backdrop.className = 'dashboard-drawer-backdrop'
    backdrop.setAttribute('aria-label', '關閉導覽選單')
    document.body.append(backdrop)
  }

  const setOpen = open => {
    document.body.classList.toggle('is-dashboard-drawer-open', open)
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', open ? '關閉導覽選單' : '開啟導覽選單')
  }
  const onToggle = () => setOpen(toggle.getAttribute('aria-expanded') !== 'true')
  const onSidebarClick = event => {
    if (event.target.closest('button, a')) setOpen(false)
  }
  toggle.addEventListener('click', onToggle)
  backdrop.addEventListener('click', () => setOpen(false))
  sidebar.addEventListener('click', onSidebarClick)
  setOpen(false)

  return {
    setEnabled(enabled) {
      toggle.setAttribute('aria-hidden', String(!enabled))
      if (!enabled) setOpen(false)
    },
    destroy() {
      setOpen(false)
      toggle.removeEventListener('click', onToggle)
      sidebar.removeEventListener('click', onSidebarClick)
      if (createdToggle) toggle.remove()
      if (createdBackdrop) backdrop.remove()
    }
  }
}
