/**
 * 專注模式：只保留畫布與明確退出入口，不修改文件或 viewport 狀態。
 */
import { registerAction } from './actions.js'

export function initFocus(ctx) {
  const controller = new FocusController(ctx)
  registerAction('focus', () => controller.toggle())
  // 更多選單沿用舊 action 名稱，這裡覆寫 stub 讓兩個入口語意一致。
  registerAction('focusMode', () => controller.toggle())
  return controller
}

class FocusController {
  constructor(ctx) {
    this.ctx = ctx
    this.active = false
    this.previousFocus = null
    this.exitButton = document.createElement('button')
    this.exitButton.type = 'button'
    this.exitButton.className = 'focus-exit-button'
    this.exitButton.textContent = '退出專注'
    this.exitButton.title = '退出專注模式（Esc）'
    this.exitButton.hidden = true
    this.exitButton.addEventListener('click', () => this.exit())
    document.body.append(this.exitButton)
    this.handleKeydown = event => {
      if (!this.active || event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.exit()
    }
  }

  toggle() {
    return this.active ? this.exit() : this.enter()
  }

  enter() {
    if (this.active || document.body.classList.contains('is-presentation-mode')) return false
    this.active = true
    this.previousFocus = document.activeElement
    document.body.classList.remove('is-focus-mode')
    document.body.classList.add('is-c1-focus-mode')
    this.exitButton.hidden = false
    document.addEventListener('keydown', this.handleKeydown, true)
    this.ctx.elements.canvas.focus({ preventScroll: true })
    return true
  }

  exit() {
    if (!this.active) return false
    this.active = false
    document.body.classList.remove('is-c1-focus-mode', 'is-focus-mode')
    this.exitButton.hidden = true
    document.removeEventListener('keydown', this.handleKeydown, true)
    this.previousFocus?.focus?.({ preventScroll: true })
    this.previousFocus = null
    return true
  }
}
