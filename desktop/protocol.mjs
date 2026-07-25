import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const APP_SCHEME = 'mindflow'
export const APP_HOST = 'app'
export const APP_START_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

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

export function resolveProtocolPath(root, requestUrl) {
  const url = new URL(requestUrl)
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST) {
    return { candidate: null, isOutside: true }
  }

  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  // 保留 ../ 再 resolve，避免 URL 編碼繞過靜態目錄邊界。
  const staticRoot = resolve(root)
  const candidate = resolve(staticRoot, `.${pathname.replaceAll('\\', '/')}`)
  const relativePath = relative(staticRoot, candidate)
  const isOutside = (
    relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  )

  return { candidate, isOutside }
}

export function createProtocolHandler({ root }) {
  if (!root) throw new TypeError('A static root directory is required')

  return async request => {
    try {
      const { candidate, isOutside } = resolveProtocolPath(root, request.url)
      if (isOutside || !candidate) {
        return new Response('forbidden', {
          status: 403,
          headers: { 'Cache-Control': 'no-store' }
        })
      }

      const data = await readFile(candidate)
      return new Response(request.method === 'HEAD' ? null : data, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': MIME[extname(candidate).toLowerCase()] || 'application/octet-stream'
        }
      })
    } catch {
      return new Response('not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' }
      })
    }
  }
}
