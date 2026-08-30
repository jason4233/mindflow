import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_WEB_DIR = fileURLToPath(new URL('../www', import.meta.url))
const WEB_FILES = ['index.html', 'editor.html']
const WEB_DIRECTORIES = ['css', 'js', 'assets']

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
  await copyFile(join(sourceRoot, file), join(webDir, file))
}
for (const directory of WEB_DIRECTORIES) {
  const source = join(sourceRoot, directory)
  await assertDirectory(source, directory)
  await cp(source, join(webDir, directory), { recursive: true })
}

console.log(`Copied MindFlow web assets to ${webDir}`)
