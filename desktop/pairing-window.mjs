/**
 * 「在手機上配對」：在獨立、不載入 preload、停用 JavaScript 的視窗裡顯示含 PAT 的 QR。
 * PAT 只在 main process 解密後直接畫成 QR，從不經過主視窗 renderer（同步秘密不得進 renderer 的紅線）。
 */
import { encodePairingPayload } from './pairing.mjs'
import { encodeQR, qrToSvg } from './qr-encode.mjs'

export const PAIRING_IPC_CHANNEL = 'mindflow-sync:show-pairing-qr'
export const PAIRING_WINDOW_MS = 2 * 60_000

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

export function pairingWindowHtml({ payload, repo, minutes = PAIRING_WINDOW_MS / 60_000 }) {
  const svg = qrToSvg(encodeQR(payload, { ecc: 'M' }), { margin: 4, scale: 6 })
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>MindFlow 手機配對</title>
<style>
  body { margin: 0; padding: 22px; font: 14px/1.6 "Segoe UI", "Noto Sans TC", sans-serif; color: #253044; background: #fff; text-align: center; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .qr svg { width: 300px; height: 300px; image-rendering: pixelated; }
  .repo { margin: 0 0 12px; color: #526074; font-size: 13px; word-break: break-all; }
  .warn { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; color: #7c3f14; background: #fff8f1; font-size: 12px; text-align: left; }
  ol { margin: 10px 0 0; padding-left: 20px; text-align: left; font-size: 13px; }
</style>
</head>
<body>
  <h1>用手機掃描這個 QR</h1>
  <p class="repo">同步 repo：${escapeHtml(repo)}</p>
  <div class="qr">${svg}</div>
  <ol>
    <li>手機開啟 MindFlow →「同步設定」→「掃描電腦上的配對 QR」。</li>
    <li>掃描成功後手機會自動開始同步。</li>
  </ol>
  <p class="warn">這個 QR 含有你的 GitHub PAT，等同密碼：請在私下掃描，不要拍照或分享。視窗會在 ${minutes} 分鐘後自動關閉。</p>
</body>
</html>`
}

/**
 * @param {object} options
 * @param {() => { repo: string, branch: string, token: string }} options.getPairing  在 main process 讀出已解密的設定
 */
export function registerPairingIpc({
  ipcMain,
  BrowserWindow,
  getParent = () => null,
  getPairing,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  windowMs = PAIRING_WINDOW_MS
}) {
  if (!ipcMain || !BrowserWindow || typeof getPairing !== 'function') throw new TypeError('ipcMain, BrowserWindow and getPairing are required')
  let current = null

  const handler = async () => {
    let pairing
    try {
      pairing = getPairing()
    } catch {
      return { ok: false, error: '無法讀取這台電腦的同步設定（加密金鑰不可用）。' }
    }
    if (!pairing?.repo || !pairing?.token) return { ok: false, error: '請先在這台電腦設定好 GitHub repo 與 PAT，再顯示配對 QR。' }
    let payload
    try {
      payload = encodePairingPayload(pairing)
    } catch (error) {
      return { ok: false, error: error?.message || '同步設定格式不正確。' }
    }
    if (current && !current.isDestroyed()) {
      current.focus()
      return { ok: true }
    }

    const parent = getParent()
    const window = new BrowserWindow({
      width: 420,
      height: 620,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'MindFlow 手機配對',
      ...(parent && !parent.isDestroyed?.() ? { parent, modal: true } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false,
        devTools: false,
        spellcheck: false
      }
    })
    current = window
    window.setMenuBarVisibility?.(false)
    // Windows／macOS 上讓截圖與螢幕錄影拍不到這個視窗。
    window.setContentProtection?.(true)
    window.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
    window.webContents.on?.('will-navigate', event => event.preventDefault())
    const timer = setTimeoutFn(() => { if (!window.isDestroyed()) window.close() }, windowMs)
    window.once?.('closed', () => {
      clearTimeoutFn(timer)
      if (current === window) current = null
    })
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pairingWindowHtml({ payload, repo: pairing.repo }))}`)
    return { ok: true }
  }

  ipcMain.removeHandler?.(PAIRING_IPC_CHANNEL)
  ipcMain.handle(PAIRING_IPC_CHANNEL, handler)
  return Object.freeze({
    dispose() {
      ipcMain.removeHandler?.(PAIRING_IPC_CHANNEL)
      if (current && !current.isDestroyed()) current.close()
      current = null
    }
  })
}
