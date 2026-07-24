// 開發用靜態伺服器：一律送 no-store，避免瀏覽器快取舊模組（開發期專用）
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.argv[2] || 8931)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let path = decodeURIComponent(url.pathname)
    if (path === '/') path = '/index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return }
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(data)
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' })
    res.end('not found')
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving on http://127.0.0.1:${PORT}`))
