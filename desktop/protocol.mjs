import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const APP_SCHEME = 'mindflow'
export const APP_HOST = 'app'
export const APP_START_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

// 與 index.html / editor.html 的 <meta http-equiv="Content-Security-Policy"> 必須逐字一致。
// style-src 'unsafe-inline' 給 richText 的 style 屬性；img-src data: blob: 給內嵌圖片與匯出；
// frame-src blob: 給本機 PDF 分屏，https: 給外部網頁分屏。
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  'frame-src blob: https:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

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
      const extension = extname(candidate).toLowerCase()
      const headers = {
        'Cache-Control': 'no-store',
        'Content-Type': MIME[extension] || 'application/octet-stream'
      }
      // CSP 只對文件生效，掛在 .html 回應即可涵蓋整個 app。
      if (extension === '.html') headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY

      return new Response(request.method === 'HEAD' ? null : data, {
        status: 200,
        headers
      })
    } catch {
      return new Response('not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' }
      })
    }
  }
}
