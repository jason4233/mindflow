import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_WEB_DIR = fileURLToPath(new URL('../www', import.meta.url))
const WEB_FILES = ['index.html', 'editor.html']
const WEB_DIRECTORIES = ['css', 'js', 'assets']
const STRICT_CONNECT_SRC = "connect-src 'self';"
const MOBILE_CONNECT_SRC = "connect-src 'self' https://api.github.com;"

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new TypeError(`${name} requires a path`)
  return resolve(value)
}

async function assertDirectory(path, label) {
  const info = await stat(path)
  if (!info.isDirectory()) throw new TypeError(`${label} is not a directory: ${path}`)
}

const sourceRoot = optionValue('--source-root', DEFAULT_SOURCE_ROOT)
const webDir = optionValue('--web-dir', DEFAULT_WEB_DIR)

await assertDirectory(sourceRoot, 'source root')
// 先清空輸出，避免已刪除的 Web 資產繼續殘留在 APK 內。
await rm(webDir, { recursive: true, force: true })
await mkdir(webDir, { recursive: true })

for (const file of WEB_FILES) {
  const source = join(sourceRoot, file)
  const html = await readFile(source, 'utf8')
  if (!html.includes(STRICT_CONNECT_SRC)) {
    throw new Error(`${file}: expected CSP directive ${STRICT_CONNECT_SRC}`)
  }
  // Web 版維持嚴格 CSP，只在 APK 的 WebView 副本開放同步所需的 GitHub API。
  await writeFile(join(webDir, file), html.replace(STRICT_CONNECT_SRC, MOBILE_CONNECT_SRC), 'utf8')
}
for (const directory of WEB_DIRECTORIES) {
  const source = join(sourceRoot, directory)
  await assertDirectory(source, directory)
  await cp(source, join(webDir, directory), { recursive: true })
}

console.log(`Copied MindFlow web assets to ${webDir}`)
