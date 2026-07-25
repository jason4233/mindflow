import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

function resolveRequestPath(root, requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  // 先保留 ../ 再 resolve，才能可靠判斷請求是否真的逃出靜態根目錄。
  const candidate = resolve(root, `.${pathname.replaceAll('\\', '/')}`)
  const relativePath = relative(root, candidate)
  const isOutside = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)

  return { candidate, isOutside }
}

export async function createStaticServer({ root, host = '127.0.0.1', port = 0 } = {}) {
  if (!root) throw new TypeError('A static root directory is required')

  const staticRoot = resolve(root)
  const server = createServer(async (req, res) => {
    try {
      const { candidate, isOutside } = resolveRequestPath(staticRoot, req.url || '/')
      if (isOutside) {
        res.writeHead(403, { 'Cache-Control': 'no-store' })
        res.end('forbidden')
        return
      }

      const data = await readFile(candidate)
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME[extname(candidate).toLowerCase()] || 'application/octet-stream'
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch {
      res.writeHead(404, { 'Cache-Control': 'no-store' })
      res.end('not found')
    }
  })

  await new Promise((resolveListening, rejectListening) => {
    server.once('error', rejectListening)
    server.listen(port, host, resolveListening)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Static server did not bind to a TCP port')
  }

  return {
    server,
    port: address.port,
    origin: `http://${host}:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      if (!server.listening) {
        resolveClose()
        return
      }
      server.close(error => error ? rejectClose(error) : resolveClose())
    })
  }
}
