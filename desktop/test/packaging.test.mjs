import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(desktopDir, 'package.json'), 'utf8'))

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
