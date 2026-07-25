#!/usr/bin/env node
// MindFlow 一鍵啟動器：起本地伺服器 + 以「應用程式視窗」開啟（無瀏覽器介面）
// Windows/macOS 用 Edge/Chrome 的 --app 模式；找不到才退回預設瀏覽器
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.argv[2] || 8931)
const url = `http://127.0.0.1:${port}/`

const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(port)], {
  stdio: 'inherit',
})

// 依平台尋找可用的 app-mode 瀏覽器內核
function appModeCommand() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ]
    const exe = candidates.find(p => existsSync(p))
    if (exe) return [exe, [`--app=${url}`, '--window-size=1280,800']]
    return ['cmd', ['/c', 'start', '', url]]
  }
  if (process.platform === 'darwin') {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    if (existsSync(chrome)) return [chrome, [`--app=${url}`, '--window-size=1280,800']]
    return ['open', [url]]
  }
  for (const exe of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(exe)) return [exe, [`--app=${url}`]]
  }
  return ['xdg-open', [url]]
}

setTimeout(() => {
  const [cmd, args] = appModeCommand()
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  console.log(`MindFlow 已啟動（應用程式視窗）：${url}`)
  console.log('關閉此終端視窗即停止伺服器。')
}, 600)

server.on('exit', code => process.exit(code ?? 0))
