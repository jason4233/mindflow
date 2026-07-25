import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { connect, createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = join(scriptDir, '..')
const executable = resolve(process.argv[2] || join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'MindFlow',
  'MindFlow.exe'
))
const userDataPath = resolve(process.argv[3] || join(desktopDir, 'dist', 'desktop2-e2e-user-data'))
const skipInterval = process.argv.includes('--skip-interval')
const intervalWaitMs = 125000
const expectedTitle = `DESKTOP2 persistence ${Date.now()}`

await mkdir(userDataPath, { recursive: true })

async function getAvailablePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

function getText(url) {
  return new Promise((resolveText, rejectText) => {
    const request = httpGet(url, { agent: false }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          rejectText(new Error(`DevTools HTTP ${response.statusCode}: ${body}`))
          return
        }
        resolveText(body)
      })
    })
    request.once('error', rejectText)
  })
}

async function getJson(url) {
  return JSON.parse(await getText(url))
}

async function waitForTarget(debugPort, predicate, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`)
      const page = targets.find(target => target.type === 'page' && predicate(target))
      if (page) return page
    } catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`MindFlow page was not ready: ${lastError?.message || 'timed out'}`)
}

async function evaluate(page, expression) {
  return new Promise((resolveEvaluate, rejectEvaluate) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    const requestId = 1
    const timer = setTimeout(() => {
      socket.close()
      rejectEvaluate(new Error('Timed out while evaluating in MindFlow'))
    }, 15000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: requestId,
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
      if (message.id !== requestId) return
      clearTimeout(timer)
      socket.close()
      if (message.error || message.result?.exceptionDetails) {
        rejectEvaluate(new Error(
          message.error?.message
          || message.result?.exceptionDetails?.exception?.description
          || message.result?.exceptionDetails?.text
        ))
        return
      }
      resolveEvaluate(message.result?.result?.value)
    })
    socket.addEventListener('error', event => {
      clearTimeout(timer)
      rejectEvaluate(event.error || new Error('DevTools WebSocket failed'))
    })
  })
}

async function waitForUsablePage(debugPort, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const page = await waitForTarget(
        debugPort,
        target => target.url === 'mindflow://app/index.html',
        2000
      )
      const ready = await evaluate(page, `(() => {
        // DevTools 會在 custom protocol 導覽提交前先曝光 target；此時讀 localStorage 會丟 SecurityError。
        const storageLength = localStorage.length;
        return document.readyState !== 'loading' && storageLength >= 0;
      })()`)
      if (ready) return page
    } catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }

  throw new Error(`MindFlow page did not become usable: ${lastError?.message || 'timed out'}`)
}

function createMaskedTextFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  assert.ok(payload.length < 126, 'Browser.close frame unexpectedly exceeded 125 bytes')
  const mask = randomBytes(4)
  const frame = Buffer.alloc(2 + mask.length + payload.length)
  frame[0] = 0x81
  frame[1] = 0x80 | payload.length
  mask.copy(frame, 2)
  for (let index = 0; index < payload.length; index += 1) {
    frame[6 + index] = payload[index] ^ mask[index % 4]
  }
  return frame
}

async function closeBrowser(debugPort) {
  const { webSocketDebuggerUrl } = await getJson(`http://127.0.0.1:${debugPort}/json/version`)
  const url = new URL(webSocketDebuggerUrl)

  await new Promise((resolveClose, rejectClose) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) })
    const key = randomBytes(16).toString('base64')
    let handshake = ''
    let commandSent = false
    const timer = setTimeout(() => {
      socket.destroy()
      rejectClose(new Error('Timed out while sending raw Browser.close'))
    }, 10000)

    const finish = () => {
      clearTimeout(timer)
      socket.destroy()
      resolveClose()
    }
    socket.once('connect', () => {
      socket.write([
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n'
      ].join('\r\n'))
    })
    socket.on('data', chunk => {
      if (commandSent) return
      handshake += chunk.toString('latin1')
      if (!handshake.includes('\r\n\r\n')) return
      if (!/^HTTP\/1\.1 101\b/.test(handshake)) {
        rejectClose(new Error(`DevTools WebSocket handshake failed: ${handshake.split('\r\n')[0]}`))
        socket.destroy()
        return
      }
      commandSent = true
      const frame = createMaskedTextFrame(JSON.stringify({ id: 1, method: 'Browser.close' }))
      socket.write(frame, () => setTimeout(finish, 50))
    })
    socket.once('error', error => {
      if (commandSent && error?.code === 'ECONNRESET') {
        finish()
        return
      }
      clearTimeout(timer)
      rejectClose(error)
    })
  })
}

function waitForExit(child, timeoutMs = 20000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('MindFlow did not exit after Browser.close')), timeoutMs)
    child.once('exit', code => {
      clearTimeout(timer)
      resolveExit(code)
    })
  })
}

function killProcessTree(pid) {
  spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

async function launch() {
  const debugPort = await getAvailablePort()
  const child = spawn(executable, [
    `--user-data-dir=${userDataPath}`,
    `--remote-debugging-port=${debugPort}`
  ], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true
  })
  const earlyExit = new Promise((_, rejectExit) => {
    child.once('exit', (code, signal) => {
      rejectExit(new Error(`MindFlow exited early (code=${code}, signal=${signal})`))
    })
  })
  const page = await Promise.race([
    waitForUsablePage(debugPort),
    earlyExit
  ])
  return { child, debugPort, page }
}

async function closeLaunch(instance) {
  try {
    await closeBrowser(instance.debugPort)
    await waitForExit(instance.child)
  } catch (error) {
    killProcessTree(instance.child.pid)
    throw error
  }
}

async function readBackup(name = 'mindflow-backup.json') {
  const path = join(userDataPath, 'backups', name)
  return { path, payload: JSON.parse(await readFile(path, 'utf8')) }
}

async function waitForRecoveredDocument(instance, documentId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      instance.page = await waitForTarget(
        instance.debugPort,
        target => target.url === 'mindflow://app/index.html',
        2000
      )
      const recovered = await evaluate(instance.page, `(() => {
        const index = JSON.parse(localStorage.getItem('mindflow.docs.index') || 'null');
        const meta = index?.docs?.find(item => item.id === ${JSON.stringify(documentId)});
        return {
          id: meta?.id,
          title: meta?.title,
          toast: document.querySelector('#dashboard-toast')?.textContent || ''
        };
      })()`)
      // reload 完成後 main process 才寫入 toast；文件先出現不代表復原流程已完全結束。
      if (recovered?.id === documentId && recovered.toast === '已從備份還原') return recovered
    } catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`Backup recovery did not restore ${documentId}: ${lastError?.message || 'timed out'}`)
}

let instance = await launch()
try {
  await evaluate(instance.page, `(async () => {
    const deadline = Date.now() + 10000;
    while (!document.querySelector('#view-count')?.textContent.trim()) {
      if (Date.now() >= deadline) throw new Error('Dashboard did not finish rendering');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    document.querySelector('#create-document').click();
    return true;
  })()`)
  instance.page = await waitForTarget(
    instance.debugPort,
    target => target.url.startsWith('mindflow://app/editor.html?')
  )
  const created = await evaluate(instance.page, `(async () => {
    const title = document.querySelector('#document-title');
    title.value = ${JSON.stringify(expectedTitle)};
    title.dispatchEvent(new Event('change', { bubbles: true }));
    title.blur();
    localStorage.setItem('mindflow.desktop.e2e', JSON.stringify({ createdAt: new Date().toISOString() }));
    await new Promise(resolve => setTimeout(resolve, 650));
    window.dispatchEvent(new Event('beforeunload'));
    const index = JSON.parse(localStorage.getItem('mindflow.docs.index'));
    const id = new URLSearchParams(location.search).get('id');
    const meta = index.docs.find(item => item.id === id);
    return { id, title: meta?.title, saveStatus: document.querySelector('#save-status')?.textContent || '' };
  })()`)
  assert.equal(created.title, expectedTitle)
  assert.match(created.saveStatus, /^已保存 \d{2}:\d{2}$/)
  console.log(`CREATE PASS id=${created.id} title="${created.title}" status="${created.saveStatus}"`)

  if (!skipInterval) {
    const intervalStartedAt = Date.now()
    await new Promise(resolveWait => setTimeout(resolveWait, intervalWaitMs))
    const intervalBackup = await readBackup()
    assert.equal(intervalBackup.payload.reason, 'interval')
    assert.ok(intervalBackup.payload.entries[`mindflow.doc.${created.id}`])
    console.log(
      `INTERVAL BACKUP PASS elapsedMs=${Date.now() - intervalStartedAt} `
      + `createdAt=${intervalBackup.payload.createdAt}`
    )
  } else {
    console.log('INTERVAL WAIT SKIPPED (using prior 125-second run evidence)')
  }
  await closeLaunch(instance)
  instance = null

  const latestAfterClose = await readBackup()
  assert.equal(latestAfterClose.payload.reason, 'window-close')
  const historyReasons = []
  for (let index = 1; index < 10; index += 1) {
    try {
      historyReasons.push((await readBackup(`mindflow-backup-${index}.json`)).payload.reason)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  if (!skipInterval) assert.ok(historyReasons.includes('interval'))
  console.log(`CLOSE FLUSH PASS latest=${latestAfterClose.payload.reason} history=${historyReasons.join(',')}`)

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    instance = await launch()
    const persisted = await evaluate(instance.page, `(() => {
      const index = JSON.parse(localStorage.getItem('mindflow.docs.index') || 'null');
      const meta = index?.docs?.find(item => item.id === ${JSON.stringify(created.id)});
      const document = JSON.parse(localStorage.getItem(${JSON.stringify(`mindflow.doc.${created.id}`)}) || 'null');
      return {
        origin: location.origin,
        id: meta?.id,
        metaTitle: meta?.title,
        documentTitle: document?.title,
        marker: localStorage.getItem('mindflow.desktop.e2e')
      };
    })()`)
    assert.equal(persisted.origin, 'mindflow://app')
    assert.equal(persisted.id, created.id)
    assert.equal(persisted.metaTitle, expectedTitle)
    assert.equal(persisted.documentTitle, expectedTitle)
    assert.ok(persisted.marker)
    console.log(`REOPEN ${cycle} PASS id=${persisted.id} origin=${persisted.origin}`)
    await closeLaunch(instance)
    instance = null
  }

  const backupNames = [
    'mindflow-backup.json',
    'mindflow-backup-1.json',
    'mindflow-backup-2.json',
    'mindflow-backup-3.json',
    'mindflow-backup-4.json'
  ]
  const backupEvidence = []
  for (const name of backupNames) {
    const backup = await readBackup(name)
    backupEvidence.push({
      name,
      createdAt: backup.payload.createdAt,
      reason: backup.payload.reason,
      documentPresent: Boolean(backup.payload.entries[`mindflow.doc.${created.id}`])
    })
  }
  assert.ok(backupEvidence.every(item => item.documentPresent))
  console.log(`BACKUP ROTATION PASS ${JSON.stringify(backupEvidence)}`)

  instance = await launch()
  await evaluate(instance.page, `(() => {
    localStorage.clear();
    return Object.keys(localStorage).length;
  })()`)
  await closeLaunch(instance)
  instance = null

  instance = await launch()
  const recovered = await waitForRecoveredDocument(instance, created.id)
  assert.equal(recovered.title, expectedTitle)
  assert.equal(recovered.toast, '已從備份還原')
  console.log(`EMPTY ORIGIN RECOVERY PASS id=${recovered.id} toast="${recovered.toast}"`)
  await closeLaunch(instance)
  instance = null

  console.log(`EVIDENCE USERDATA ${userDataPath}`)
} finally {
  if (instance) killProcessTree(instance.child.pid)
}
