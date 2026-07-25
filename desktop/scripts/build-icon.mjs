import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = join(scriptDir, '..')
const source = join(desktopDir, '..', 'assets', 'favicon.svg')
const targetDir = join(desktopDir, 'assets')
const target = join(targetDir, 'icon.ico')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const temporaryDir = await mkdtemp(join(tmpdir(), 'mindflow-icon-'))

try {
  await mkdir(targetDir, { recursive: true })
  const pngFiles = await Promise.all(sizes.map(async size => {
    const pngFile = join(temporaryDir, `icon-${size}.png`)
    await sharp(source, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(pngFile)
    return pngFile
  }))

  // 多尺寸 ICO 可避免 Windows 在工作列與檔案總管縮放時出現模糊鋸齒。
  await writeFile(target, await pngToIco(pngFiles))
  console.log(`Created ${target}`)
} finally {
  await rm(temporaryDir, { recursive: true, force: true })
}
