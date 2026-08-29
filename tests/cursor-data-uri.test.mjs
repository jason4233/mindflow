#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CSS_FILES = ['css/editor.css', 'css/node.css']
const ASSET_BY_FALLBACK = new Map([
  ['grab', 'assets/cursors/hand-open.svg'],
  ['grabbing', 'assets/cursors/hand-closed.svg'],
])
const EXPECTED_COUNTS = new Map([
  ['grab', 3],
  ['grabbing', 2],
])
const EXPECTED_HOTSPOTS = new Map([
  ['grab', [16, 14]],
  ['grabbing', [16, 14]],
])
const DATA_URI_PREFIX = 'data:image/svg+xml,'
const CURSOR_DECLARATION = /cursor:\s*url\((['"]?)(data:image\/svg\+xml,[^'"\s)]+)\1\)\s+(\d+)\s+(\d+)\s*,\s*(grab|grabbing)(\s*!important)?\s*;/g

function validateAttributes(source, tagName) {
  let rest = source.trim()

  while (rest) {
    const attribute = rest.match(/^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/)
    assert.ok(attribute, `SVG <${tagName}> 含有無法解析的屬性：${rest}`)
    rest = rest.slice(attribute[0].length).trimStart()
  }
}

function validateSvg(svg, label) {
  const source = svg.trim()
  assert.match(source, /^<svg\b/, `${label} 的根元素不是 <svg>`)
  assert.equal(source.includes('\u0000'), false, `${label} 含有 NUL 字元`)

  const tokens = source.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/[A-Za-z][^<>]*>|<[A-Za-z][^<>]*\/?>|[^<]+/g) ?? []
  assert.equal(tokens.join(''), source, `${label} 含有不合法的 XML 片段`)

  const stack = []
  let rootCount = 0

  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue

    if (!token.startsWith('<')) {
      assert.ok(stack.length > 0 || token.trim() === '', `${label} 在根元素外含有文字`)
      continue
    }

    if (token.startsWith('</')) {
      const closing = token.match(/^<\/([A-Za-z][\w:.-]*)\s*>$/)
      assert.ok(closing, `${label} 含有不合法的結束標籤：${token}`)
      assert.equal(stack.pop(), closing[1], `${label} 的標籤巢狀結構不合法`)
      continue
    }

    const opening = token.match(/^<([A-Za-z][\w:.-]*)([\s\S]*?)(\/?)>$/)
    assert.ok(opening, `${label} 含有不合法的開始標籤：${token}`)
    validateAttributes(opening[2], opening[1])

    if (stack.length === 0) {
      rootCount += 1
      assert.equal(opening[1], 'svg', `${label} 的根元素必須是 <svg>`)
    }

    if (opening[3] !== '/') stack.push(opening[1])
  }

  assert.deepEqual(stack, [], `${label} 含有未關閉的標籤`)
  assert.equal(rootCount, 1, `${label} 必須只有一個根元素`)
  assert.match(source, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${label} 缺少 SVG namespace`)
  assert.match(source, /width="32"/, `${label} 寬度必須是 32`)
  assert.match(source, /height="32"/, `${label} 高度必須是 32`)
  assert.match(source, /viewBox="0 0 32 32"/, `${label} viewBox 必須是 0 0 32 32`)
  assert.match(source, /fill="#fff"/, `${label} 必須使用白色填充`)
  assert.match(source, /stroke="#000"/, `${label} 必須使用黑色描邊`)
  assert.match(source, /stroke-width="1\.5"/, `${label} 描邊必須是 1.5px`)
  assert.match(source, /stroke-linecap="round"/, `${label} 線端必須圓潤`)
  assert.match(source, /stroke-linejoin="round"/, `${label} 轉角必須圓潤`)
}

const declarations = []

for (const relativePath of CSS_FILES) {
  const css = await readFile(resolve(ROOT, relativePath), 'utf8')

  for (const match of css.matchAll(CURSOR_DECLARATION)) {
    declarations.push({
      file: relativePath,
      dataUri: match[2],
      hotspot: [Number(match[3]), Number(match[4])],
      fallback: match[5],
    })
  }
}

assert.equal(declarations.length, 5, `應找到 5 個 SVG cursor 宣告，實際找到 ${declarations.length}`)

for (const [fallback, expectedCount] of EXPECTED_COUNTS) {
  const group = declarations.filter(declaration => declaration.fallback === fallback)
  assert.equal(group.length, expectedCount, `${fallback} 應有 ${expectedCount} 個宣告`)
  assert.equal(new Set(group.map(declaration => declaration.dataUri)).size, 1, `${fallback} 必須共用同一組 data URI`)
  assert.equal(new Set(group.map(declaration => declaration.hotspot.join(','))).size, 1, `${fallback} 必須共用同一個 hotspot`)

  assert.deepEqual(
    group[0].hotspot,
    EXPECTED_HOTSPOTS.get(fallback),
    `${fallback} hotspot 必須對齊縮小後 glyph 的視覺中心`,
  )

  const encoded = group[0].dataUri.slice(DATA_URI_PREFIX.length)
  const decoded = decodeURIComponent(encoded)
  validateSvg(decoded, fallback)

  const assetPath = ASSET_BY_FALLBACK.get(fallback)
  const asset = (await readFile(resolve(ROOT, assetPath), 'utf8')).trim()
  validateSvg(asset, assetPath)
  assert.equal(decoded, asset, `${fallback} 的 CSS data URI 必須與 ${assetPath} 完全一致`)
}

assert.notEqual(
  declarations.find(declaration => declaration.fallback === 'grab').dataUri,
  declarations.find(declaration => declaration.fallback === 'grabbing').dataUri,
  'grab 與 grabbing 必須使用不同的 SVG',
)

console.log('cursor-data-uri: 5/5 宣告可解碼，SVG 合法、統一且與原始檔一致')
