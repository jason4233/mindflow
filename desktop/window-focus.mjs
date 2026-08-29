export function bringWindowToFront(window, platform = process.platform) {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()

  if (platform === 'win32') {
    // Windows 會阻止背景程序直接搶前景；短暫升成 topmost 才能可靠拉回使用者眼前。
    window.setAlwaysOnTop(true)
    window.setAlwaysOnTop(false)
  }
}
