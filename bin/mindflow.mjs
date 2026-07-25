#!/usr/bin/env node
// MindFlow 一鍵啟動器：起本地伺服器 + 開瀏覽器（Windows/macOS/Linux 通用）
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.argv[2] || 8931)
const url = `http://127.0.0.1:${port}/`

// 啟動靜態伺服器（no-store，避免瀏覽器快取舊模組）
const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(port)], {
  stdio: 'inherit',
})

// 稍等伺服器起來後開瀏覽器
setTimeout(() => {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref()
  console.log(`MindFlow 已啟動：${url}（關閉此視窗即停止）`)
}, 600)

server.on('exit', code => process.exit(code ?? 0))
