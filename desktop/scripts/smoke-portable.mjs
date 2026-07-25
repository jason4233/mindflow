import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(desktopDir, 'package.json'), 'utf8'))
const executable = join(desktopDir, 'dist', `MindFlow-${packageJson.version}-portable.exe`)

async function getAvailablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitForTarget(debugPort, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json()
      const page = targets.find(target => (
        target.type === 'page'
        && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(target.url)
        && /^MindFlow(?:\s|—|-)/.test(target.title)
      ))
      if (page) return page
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(`Portable app did not expose the MindFlow page: ${lastError?.message || 'timed out'}`)
}

async function closeBrowser(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
  const { webSocketDebuggerUrl } = await response.json()

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out while closing the portable app'))
    }, 5000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    })
    socket.addEventListener('message', () => {
      clearTimeout(timer)
      socket.close()
      resolve()
    })
    socket.addEventListener('close', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.addEventListener('error', event => {
      clearTimeout(timer)
      reject(event.error || new Error('DevTools WebSocket failed'))
    })
  })
}

function killProcessTree(pid) {
  spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

const debugPort = await getAvailablePort()
const child = spawn(executable, [`--remote-debugging-port=${debugPort}`], {
  detached: false,
  stdio: 'ignore',
  windowsHide: true
})
const startedAt = Date.now()
const earlyExit = new Promise((_, reject) => {
  child.once('exit', (code, signal) => {
    reject(new Error(`Portable process exited after ${Date.now() - startedAt} ms (code=${code}, signal=${signal})`))
  })
})

try {
  const page = await Promise.race([waitForTarget(debugPort), earlyExit])
  const origin = new URL(page.url).origin
  const manifestResponse = await fetch(`${origin}/assets/stickers/manifest.json`)

  assert.match(page.title, /^MindFlow(?:\s|—|-)/)
  assert.equal(manifestResponse.status, 200)
  assert.match(manifestResponse.headers.get('content-type') || '', /^application\/json/)
  const manifest = await manifestResponse.json()
  assert.ok(Object.keys(manifest).length > 0)

  console.log(`Portable smoke test passed: ${page.title} at ${page.url}`)
  console.log(`Sticker manifest categories: ${Object.keys(manifest).length}`)
} finally {
  try {
    await closeBrowser(debugPort)
  } catch {
    // NSIS wrapper 與 Electron child 是兩層 process；只殺 wrapper 會留下鎖住解壓目錄的孤兒。
    killProcessTree(child.pid)
  }
}
