import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveStaticRoot } from './app-paths.mjs'
import { createStaticServer } from './server.mjs'

const DESKTOP_DIR = dirname(fileURLToPath(import.meta.url))
let appServer = null

async function launch() {
  const root = resolveStaticRoot({
    isPackaged: app.isPackaged,
    desktopDir: DESKTOP_DIR,
    resourcesPath: process.resourcesPath
  })
  appServer = await createStaticServer({ root })

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'MindFlow',
    icon: join(DESKTOP_DIR, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('page-title-updated', event => event.preventDefault())
  mainWindow.once('closed', () => {
    const serverToClose = appServer
    appServer = null
    void (serverToClose?.close() ?? Promise.resolve()).finally(() => app.quit())
  })

  await mainWindow.loadURL(`${appServer.origin}/`)
}

app.whenReady()
  .then(launch)
  .catch(async error => {
    console.error('MindFlow desktop failed to start:', error)
    await appServer?.close().catch(() => {})
    app.exit(1)
  })
