import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
await readFile(join(desktopDir, 'package.json'), 'utf8')
const executable = join(desktopDir, 'dist', 'MindFlow-portable.exe')

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
        && target.url === 'mindflow://app/index.html'
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

async function evaluate(page, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out while evaluating in the portable app'))
    }, 10000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }))
    })
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(message.error?.message || message.result.exceptionDetails.text))
        return
      }
      resolve(message.result?.result?.value)
    })
    socket.addEventListener('error', event => {
      clearTimeout(timer)
      reject(event.error || new Error('DevTools WebSocket failed'))
    })
  })
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
// 用完即丟的 userData：煙霧測試不得動到使用者真正的 localStorage 與十份備份輪替。
const userDataDir = await mkdtemp(join(tmpdir(), 'mindflow-smoke-'))
const child = spawn(executable, [`--remote-debugging-port=${debugPort}`], {
  detached: false,
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, MINDFLOW_USER_DATA_DIR: userDataDir }
})
const startedAt = Date.now()
const earlyExit = new Promise((_, reject) => {
  child.once('exit', (code, signal) => {
    reject(new Error(`Portable process exited after ${Date.now() - startedAt} ms (code=${code}, signal=${signal})`))
  })
})

try {
  const page = await Promise.race([waitForTarget(debugPort), earlyExit])
  const manifest = await evaluate(page, `(async () => {
    const response = await fetch('assets/stickers/manifest.json');
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.json()
    };
  })()`)

  assert.match(page.title, /^MindFlow(?:\s|—|-)/)
  assert.equal(page.url, 'mindflow://app/index.html')
  assert.equal(manifest.status, 200)
  assert.match(manifest.contentType || '', /^application\/json/)
  assert.ok(Object.keys(manifest.body).length > 0)

  console.log(`Portable smoke test passed: ${page.title} at ${page.url}`)
  console.log(`Sticker manifest categories: ${Object.keys(manifest.body).length}`)
} finally {
  try {
    await closeBrowser(debugPort)
  } catch {
    // NSIS wrapper 與 Electron child 是兩層 process；只殺 wrapper 會留下鎖住解壓目錄的孤兒。
    killProcessTree(child.pid)
  }

  try {
    // Chromium 收檔比 process 結束慢，鎖住的檔案要重試幾次才刪得掉。
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.warn(`Could not remove the smoke userData directory ${userDataDir}: ${error.message}`)
  }
}
