/**
 * Phase A 右側樣式面板的開合骨架。
 */
import { strings } from '../strings.js'

export function initializeSidepanel() {
  const panel = document.querySelector('#sidepanel')
  const title = document.querySelector('#sidepanel-title')
  const close = document.querySelector('#close-sidepanel-button')
  const placeholder = document.querySelector('#sidepanel-placeholder')
  title.textContent = strings.editor.style
  close.textContent = strings.editor.close
  close.setAttribute('aria-label', strings.editor.closePanel)
  placeholder.textContent = strings.editor.stylePlaceholder

  const setOpen = open => panel.classList.toggle('is-collapsed', !open)
  const toggle = () => setOpen(panel.classList.contains('is-collapsed'))
  close.addEventListener('click', () => setOpen(false))
  return { panel, setOpen, toggle }
}
