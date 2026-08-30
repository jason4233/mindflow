import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readOrNull(url) {
  try {
    return await readFile(url)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function pngDimensions(contents) {
  assert.deepEqual([...contents.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  return [contents.readUInt32BE(16), contents.readUInt32BE(20)]
}

test('Android launcher resources are generated from the canonical favicon', async () => {
  const canonical = await readFile(new URL('../../assets/favicon.svg', import.meta.url))
  const iconSource = await readOrNull(new URL('../assets/icon.svg', import.meta.url))
  const launcher = await readFile(new URL('../android/app/src/main/res/mipmap-mdpi/ic_launcher.png', import.meta.url))
  const launcherBackground = await readFile(
    new URL('../android/app/src/main/res/mipmap-mdpi/ic_launcher_background.png', import.meta.url)
  )
  const adaptiveIcon = await readFile(
    new URL('../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', import.meta.url),
    'utf8'
  )

  assert.deepEqual(iconSource, canonical, 'mobile icon source must mirror assets/favicon.svg')
  assert.notEqual(
    sha256(launcher),
    '27ed3603010ebc278f64f8645741ab132ff517abb5308eb9df6c8e42a48956b2',
    'Capacitor default launcher icon must be replaced'
  )
  assert.deepEqual(pngDimensions(launcher), [48, 48])
  assert.deepEqual(pngDimensions(launcherBackground), [108, 108])
  assert.match(adaptiveIcon, /@mipmap\/ic_launcher_background/)
  assert.match(adaptiveIcon, /@mipmap\/ic_launcher_foreground/)
})
