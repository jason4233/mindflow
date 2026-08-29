import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = join(scriptDir, '..')
const windowStateScript = join(scriptDir, 'window-state.ps1')
const rounds = 2

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

function findElectronExecutable() {
  const direct = join(desktopDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (existsSync(direct)) return direct

  const cacheRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  if (!cacheRoot || !existsSync(cacheRoot)) {
    throw new Error('Electron runtime not found in desktop/node_modules or the npx cache')
  }

  const cached = readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(cacheRoot, entry.name, 'node_modules', 'electron', 'dist', 'electron.exe'))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)

  if (!cached[0]) throw new Error('Electron runtime not found in the npx cache')
  return cached[0]
}

async function getJson(url, timeoutMs = 1000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`DevTools HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}

function sendCdp(webSocketDebuggerUrl, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const requestId = 1
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      finish(new Error(`CDP ${method} timed out after ${timeoutMs} ms`))
    }, timeoutMs)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== requestId) return
      if (message.error) {
        finish(new Error(`CDP ${method} failed: ${message.error.message}`))
        return
      }
      finish(null, message.result)
    })
    socket.addEventListener('error', event => {
      finish(event.error || new Error(`CDP ${method} WebSocket failed`))
    })
  })
}

async function waitForValue(label, inspect, accept, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  let lastError

  while (Date.now() < deadline) {
    try {
      lastValue = await inspect()
      if (accept(lastValue)) return lastValue
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }

  const detail = lastError?.message || JSON.stringify(lastValue)
  throw new Error(`${label} timed out: ${detail}`)
}

async function waitForDevTools(debugPort) {
  const baseUrl = `http://127.0.0.1:${debugPort}`
  const version = await waitForValue(
    'Electron DevTools endpoint',
    () => getJson(`${baseUrl}/json/version`),
    value => Boolean(value?.webSocketDebuggerUrl),
    60000
  )
  const page = await waitForValue(
    'MindFlow main page',
    async () => {
      const targets = await getJson(`${baseUrl}/json/list`)
      return targets.find(target => (
        target.type === 'page' && target.url === 'mindflow://app/index.html'
      ))
    },
    Boolean,
    60000
  )

  await waitForValue(
    'MindFlow renderer readiness',
    async () => {
      const result = await sendCdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      })
      return result?.result?.value
    },
    readyState => readyState === 'interactive' || readyState === 'complete',
    60000
  )

  return {
    browserWebSocketUrl: version.webSocketDebuggerUrl,
    page
  }
}

async function evaluate(page, expression) {
  const response = await sendCdp(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  })
  if (response?.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  }
  return response?.result?.value
}

function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`PID ${child.pid} did not exit after ${timeoutMs} ms`))
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

function inspectNativeWindow(pid, action = 'inspect') {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', windowStateScript,
    '-Action', action,
    '-TargetProcessId', String(pid)
  ], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(`Native window inspection failed: ${result.stderr || result.stdout}`)
  }
  return JSON.parse(result.stdout.trim())
}

function spawnElectron(executable, args, userDataPath) {
  return spawn(executable, args, {
    cwd: desktopDir,
    detached: false,
    windowsHide: false,
    stdio: 'ignore',
    env: {
      ...process.env,
      MINDFLOW_USER_DATA_DIR: userDataPath
    }
  })
}

async function runRound({ executable, args, primary, devTools, round }) {
  const initial = inspectNativeWindow(primary.pid)
  assert.equal(initial.visible, true, `primary PID ${primary.pid} is not visible before round ${round}`)
  inspectNativeWindow(primary.pid, 'minimize')

  const minimized = await waitForValue(
    `round ${round} minimized state`,
    () => inspectNativeWindow(primary.pid),
    current => current.minimized === true
  )

  const secondary = spawnElectron(executable, args, process.env.MINDFLOW_FOCUS_E2E_USER_DATA)
  const secondaryExit = await waitForExit(secondary)

  assert.equal(secondaryExit.code, 0, `secondary PID ${secondary.pid} exited abnormally`)
  assert.equal(secondaryExit.signal, null, `secondary PID ${secondary.pid} was killed by a signal`)
  assert.equal(primary.exitCode, null, `primary PID ${primary.pid} exited during round ${round}`)
  assert.equal(isProcessAlive(primary.pid), true, `primary PID ${primary.pid} is not alive`)

  const restored = await waitForValue(
    `round ${round} restored and focused state`,
    async () => {
      const current = inspectNativeWindow(primary.pid)
      const focused = await evaluate(devTools.page, 'document.hasFocus()')
      const visibility = await evaluate(devTools.page, 'document.visibilityState')
      return {
        ...current,
        focused,
        visibility
      }
    },
    current => (
      current.minimized === false
      && current.visible === true
      && current.foreground === true
      && current.focused === true
      && current.visibility === 'visible'
    )
  )

  console.log(JSON.stringify({
    round,
    result: 'PASS',
    primaryPid: primary.pid,
    secondaryPid: secondary.pid,
    secondaryExitCode: secondaryExit.code,
    windowHandle: restored.handle,
    before: minimized.minimized ? 'minimized' : 'normal',
    after: restored.minimized ? 'minimized' : 'normal',
    foreground: restored.foreground,
    focused: restored.focused,
    visibility: restored.visibility
  }))
}

const executable = findElectronExecutable()
const debugPort = await getAvailablePort()
const userDataPath = await mkdtemp(join(tmpdir(), 'mindflow-focus-e2e-'))
const args = [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataPath}`,
  '.'
]
process.env.MINDFLOW_FOCUS_E2E_USER_DATA = userDataPath

let primary
let devTools

try {
  primary = spawnElectron(executable, args, userDataPath)
  const earlyExit = new Promise((_, reject) => {
    primary.once('exit', (code, signal) => {
      reject(new Error(`Primary Electron exited early (code=${code}, signal=${signal})`))
    })
  })
  devTools = await Promise.race([waitForDevTools(debugPort), earlyExit])

  for (let round = 1; round <= rounds; round += 1) {
    await runRound({ executable, args, primary, devTools, round })
  }
} finally {
  if (primary && isProcessAlive(primary.pid)) {
    if (devTools) {
      try {
        await sendCdp(devTools.browserWebSocketUrl, 'Browser.close')
      } catch {
        // Browser.close 會主動斷線；是否成功以下方 process exit 為準。
      }
    }
    try {
      await waitForExit(primary, 20000)
    } catch {
      killProcessTree(primary.pid)
    }
  }
  await rm(userDataPath, { recursive: true, force: true })
  delete process.env.MINDFLOW_FOCUS_E2E_USER_DATA
}
