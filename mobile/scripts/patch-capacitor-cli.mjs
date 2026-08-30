import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const templatePath = fileURLToPath(new URL('../node_modules/@capacitor/cli/dist/util/template.js', import.meta.url))
const legacyCall = 'await tar_1.default.extract({ file: src, cwd: dir });'
const compatibleCall = 'await (tar_1.default ?? tar_1).extract({ file: src, cwd: dir });'
const source = await readFile(templatePath, 'utf8')

if (source.includes(compatibleCall)) {
  console.log('Capacitor CLI tar interop patch is already applied')
} else {
  if (!source.includes(legacyCall)) {
    throw new Error('Unsupported Capacitor CLI template.js; tar interop callsite not found')
  }
  // Capacitor 6 預期 tar 6 的 default interop；tar 7 修補安全漏洞後改為具名 export，需同時相容兩種 shape。
  await writeFile(templatePath, source.replace(legacyCall, compatibleCall), 'utf8')
  console.log('Applied Capacitor CLI tar interop patch')
}
