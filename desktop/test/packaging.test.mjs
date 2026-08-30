import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { resolveStaticRoot } from '../app-paths.mjs'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(desktopDir, 'package.json'), 'utf8'))
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g

// 從 main.mjs 出發把相對 import 的傳遞閉包全部走過一遍，得到「打包後真的會被 require 到」的檔案清單。
async function relativeImportClosure(entry) {
  const reached = new Set()
  const queue = [entry]

  while (queue.length) {
    const current = queue.pop()
    if (reached.has(current)) continue
    reached.add(current)

    const source = await readFile(join(desktopDir, current), 'utf8')
    for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
      queue.push(join(dirname(current), specifier).replaceAll('\\', '/'))
    }
  }

  return reached
}

test('builds fixed-name NSIS setup and portable targets', () => {
  const targets = packageJson.build.win.target.map(target => target.target)
  assert.deepEqual(targets, ['nsis', 'portable'])
  assert.equal(packageJson.build.nsis.artifactName, 'MindFlow-Setup.${ext}')
  assert.equal(packageJson.build.portable.artifactName, 'MindFlow-portable.${ext}')
})

test('NSIS is assisted, per-user by default and creates both shortcuts', () => {
  const nsis = packageJson.build.nsis
  assert.equal(nsis.oneClick, false)
  assert.equal(nsis.perMachine, false)
  assert.equal(nsis.selectPerMachineByDefault, false)
  assert.equal(nsis.allowElevation, false)
  assert.equal(nsis.allowToChangeInstallationDirectory, true)
  assert.equal(nsis.createDesktopShortcut, 'always')
  assert.equal(nsis.createStartMenuShortcut, true)
})

// 漏一個檔在 build.files 裡，開發時照跑、打包後才會在使用者機器上 module not found。
test('every module reachable from main.mjs is included in the packaged runtime', async () => {
  const reached = await relativeImportClosure('main.mjs')
  const packaged = new Set(packageJson.build.files)
  const externalResources = new Map(
    (packageJson.build.extraResources || [])
      .filter(resource => typeof resource === 'object' && resource.from && resource.to)
      .map(resource => [resource.from.replaceAll('\\', '/'), resource.to.replaceAll('\\', '/')])
  )

  assert.ok(reached.size > 1, 'main.mjs should import at least one local module')
  for (const file of reached) {
    if (file.startsWith('../')) {
      // app.asar 之外的模組必須落在 resources 下相同相對位置，re-export 才能在 packaged app 解析。
      assert.equal(
        externalResources.get(file),
        file.slice(3),
        `${file} is reachable from app.asar but missing its exact extraResources mapping`
      )
    } else {
      assert.ok(packaged.has(file), `${file} is reachable from main.mjs but missing from build.files`)
    }
  }
})

test('packages the complete sync runtime including the sandbox preload bridge', () => {
  const packaged = new Set(packageJson.build.files)
  for (const file of [
    'sync-engine.mjs',
    'sync-github.mjs',
    'sync-plan.mjs',
    'sync-settings.mjs',
    'preload.cjs'
  ]) {
    assert.ok(packaged.has(file), `${file} is required by desktop sync but missing from build.files`)
  }
})

test('uses the repository root as the static root during development', () => {
  const desktopDir = join('C:', 'work', 'mindflow', 'desktop')

  assert.equal(
    resolveStaticRoot({ isPackaged: false, desktopDir, resourcesPath: join('C:', 'unused') }),
    join('C:', 'work', 'mindflow')
  )
})

test('uses the bundled app resource as the static root after packaging', () => {
  const resourcesPath = join('C:', 'portable', 'resources')

  assert.equal(
    resolveStaticRoot({ isPackaged: true, desktopDir: join('C:', 'unused'), resourcesPath }),
    join(resourcesPath, 'app')
  )
})
