import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { QR_ECC_LEVELS, encodeQR, qrToBitmap, qrToSvg } from '../js/qr-encode.mjs'
import * as desktopQr from '../desktop/qr-encode.mjs'

// 參考向量由 segno（Python）以 byte 模式、無 ECI、不自動提升糾錯等級產生，
// 產生方式記在 fixture 的 generator 欄位；矩陣不含留白，'1' = 深色。
const vectors = JSON.parse(readFileSync(new URL('./fixtures/qr-vectors.json', import.meta.url), 'utf8'))

const toRows = qr => qr.modules.map(row => Array.from(row, v => (v ? '1' : '0')).join(''))
const sha256 = qr => createHash('sha256').update(toRows(qr).join('\n')).digest('hex')
const gridText = (version, ecc, bytes) => {
  const seed = version * 7 + QR_ECC_LEVELS.indexOf(ecc)
  let text = ''
  for (let i = 0; i < bytes; i++) text += String.fromCharCode(33 + ((i * 31 + seed) % 94))
  return text
}

// ── 與參考實作逐位元比對 ──
test('fixture 涵蓋 L/M/Q/H、強制遮罩 0–7、版本 1/2/6/7/10/15/25/40', () => {
  const cases = vectors.cases
  assert.ok(cases.length >= 12)
  assert.deepEqual([...new Set(cases.map(c => c.ecc))].sort(), ['H', 'L', 'M', 'Q'])
  assert.deepEqual([...new Set(cases.map(c => c.mask))].sort(), [0, 1, 2, 3, 4, 5, 6, 7])
  const versions = new Set(cases.map(c => c.version))
  for (const v of [1, 2, 6, 7, 10, 15, 25, 40]) assert.ok(versions.has(v), `missing version ${v}`)
  assert.equal(vectors.grid.length, 160)
})

for (const c of vectors.cases) {
  const options = { ecc: c.ecc, ...(c.minVersion ? { minVersion: c.minVersion } : {}) }

  test(`強制遮罩逐位元一致：${c.name}（v${c.version}-${c.ecc}, mask ${c.mask}）`, () => {
    const qr = encodeQR(c.text, { ...options, mask: c.mask })
    assert.equal(qr.version, c.version)
    assert.equal(qr.size, c.version * 4 + 17)
    assert.equal(qr.ecc, c.ecc)
    assert.equal(qr.mask, c.mask)
    assert.deepEqual(toRows(qr), c.matrix)
  })

  test(`自動選遮罩與參考實作相同：${c.name}（參考選 ${c.autoMask}）`, () => {
    const qr = encodeQR(c.text, options)
    assert.equal(qr.version, c.version)
    assert.equal(qr.mask, c.autoMask)
    assert.equal(sha256(qr), c.autoSha256)
  })
}

test('40 個版本 × 4 個等級：剛好塞滿容量時版本、強制遮罩矩陣、自動遮罩都與參考一致', () => {
  for (const g of vectors.grid) {
    const text = gridText(g.version, g.ecc, g.bytes)
    const label = `v${g.version}-${g.ecc}`

    const forced = encodeQR(text, { ecc: g.ecc, mask: g.mask })
    assert.equal(forced.version, g.version, `${label} version`)
    assert.equal(sha256(forced), g.sha256, `${label} forced mask ${g.mask}`)

    const auto = encodeQR(text, { ecc: g.ecc })
    assert.equal(auto.mask, g.autoMask, `${label} auto mask`)
    assert.equal(sha256(auto), g.autoSha256, `${label} auto matrix`)

    // 多 1 byte 就放不進這個版本
    assert.throws(() => encodeQR(text + '!', { ecc: g.ecc, minVersion: g.version, maxVersion: g.version }), RangeError, label)
    if (g.version < 40) assert.equal(encodeQR(text + '!', { ecc: g.ecc, mask: 0 }).version, g.version + 1, label)
  }
})

// ── API 行為 ──
test('回傳結構：modules 為 size 個 Uint8Array(size)，只含 0/1', () => {
  const qr = encodeQR('MindFlow')
  assert.deepEqual(Object.keys(qr).sort(), ['ecc', 'mask', 'modules', 'size', 'version'])
  assert.equal(qr.ecc, 'M')
  assert.equal(qr.modules.length, qr.size)
  for (const row of qr.modules) {
    assert.ok(row instanceof Uint8Array)
    assert.equal(row.length, qr.size)
    assert.ok(row.every(v => v === 0 || v === 1))
  }
  assert.equal(qr.modules[qr.size - 8][8], 1, 'dark module')
})

test('QR_ECC_LEVELS 凍結且順序為 L/M/Q/H', () => {
  assert.deepEqual([...QR_ECC_LEVELS], ['L', 'M', 'Q', 'H'])
  assert.ok(Object.isFrozen(QR_ECC_LEVELS))
})

test('desktop/qr-encode.mjs 原樣轉出同一份實作', () => {
  assert.equal(desktopQr.encodeQR, encodeQR)
  assert.equal(desktopQr.qrToSvg, qrToSvg)
  assert.equal(desktopQr.qrToBitmap, qrToBitmap)
  assert.equal(desktopQr.QR_ECC_LEVELS, QR_ECC_LEVELS)
})

test('空字串與非 BMP 字元（emoji）都能編碼', () => {
  assert.equal(encodeQR('').version, 1)
  const emoji = encodeQR('🧠 MindFlow', { ecc: 'L' })
  assert.equal(emoji.version, 1) // 4 + 9 bytes ≤ v1-L 的 17 bytes
})

test('minVersion／maxVersion 限定版本範圍', () => {
  assert.equal(encodeQR('MindFlow', { minVersion: 5 }).version, 5)
  assert.equal(encodeQR('x'.repeat(100), { ecc: 'L', maxVersion: 5 }).version, 5)
  assert.throws(() => encodeQR('x'.repeat(200), { ecc: 'L', maxVersion: 5 }), { name: 'RangeError', message: 'QR: data too long' })
})

test('超過版本 40 容量時拋出 RangeError(QR: data too long)', () => {
  assert.equal(encodeQR('a'.repeat(2953), { ecc: 'L' }).version, 40)
  assert.throws(() => encodeQR('a'.repeat(2954), { ecc: 'L' }), { name: 'RangeError', message: 'QR: data too long' })
  // UTF-8 計算的是位元組：每個中文字 3 bytes
  assert.throws(() => encodeQR('心'.repeat(985), { ecc: 'L' }), { name: 'RangeError', message: 'QR: data too long' })
  assert.equal(encodeQR('心'.repeat(984), { ecc: 'L', mask: 0 }).version, 40)
})

test('不合法參數直接拋錯', () => {
  assert.throws(() => encodeQR(123), TypeError)
  assert.throws(() => encodeQR('a', { ecc: 'X' }), RangeError)
  assert.throws(() => encodeQR('a', { mask: 8 }), RangeError)
  assert.throws(() => encodeQR('a', { mask: 1.5 }), RangeError)
  assert.throws(() => encodeQR('a', { minVersion: 0 }), RangeError)
  assert.throws(() => encodeQR('a', { maxVersion: 41 }), RangeError)
  assert.throws(() => encodeQR('a', { minVersion: 10, maxVersion: 9 }), RangeError)
  assert.equal(encodeQR('a', { mask: undefined }).mask, encodeQR('a').mask)
})

// ── SVG ──
function svgAttr(svg, name) {
  return svg.match(new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`))?.[1]
}

test('qrToSvg：根節點、尺寸、viewBox 以模組為單位、單一 crispEdges path', () => {
  const qr = encodeQR('MindFlow 心智圖', { ecc: 'Q' })
  const svg = qrToSvg(qr)
  const dim = qr.size + 8
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.ok(svg.endsWith('</svg>'))
  assert.equal(svgAttr(svg, 'width'), String(dim * 8))
  assert.equal(svgAttr(svg, 'height'), String(dim * 8))
  assert.equal(svgAttr(svg, 'viewBox'), `0 0 ${dim} ${dim}`)
  assert.equal(svgAttr(svg, 'shape-rendering'), 'crispEdges')
  assert.equal(svg.match(/<path /g).length, 1)
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/)
  assert.match(svg, /<path fill="#000" d="M/)
})

test('qrToSvg：path 涵蓋的格子恰好是所有深色模組（含留白位移）', () => {
  const qr = encodeQR('https://github.com/example-user/mindflow-notes', { ecc: 'M' })
  const margin = 2
  const d = qrToSvg(qr, { margin, scale: 3 }).match(/ d="([^"]*)"/)[1]
  const painted = Array.from({ length: qr.size }, () => new Uint8Array(qr.size))
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let c = +x; c < +x + +w; c++) painted[+y - margin][c - margin] += 1
  }
  assert.deepEqual(painted, qr.modules)
})

test('qrToSvg：自訂顏色會轉義，light 傳空值不畫背景', () => {
  const qr = encodeQR('a')
  const svg = qrToSvg(qr, { margin: 0, scale: 1, dark: '"><script>', light: '' })
  assert.ok(!svg.includes('<script>'))
  assert.ok(!svg.includes('<rect'))
  assert.equal(svgAttr(svg, 'viewBox'), `0 0 ${qr.size} ${qr.size}`)
  assert.throws(() => qrToSvg(qr, { scale: 0 }), RangeError)
  assert.throws(() => qrToSvg(qr, { margin: -1 }), RangeError)
})

// ── 點陣圖 ──
function pixel(bitmap, x, y) {
  const i = (y * bitmap.width + x) * 4
  return Array.from(bitmap.data.subarray(i, i + 4))
}

test('qrToBitmap：尺寸、留白、尋像圖樣角落顏色', () => {
  const qr = encodeQR('MindFlow', { ecc: 'H' })
  const margin = 4
  const scale = 8
  const bmp = qrToBitmap(qr)
  const side = (qr.size + margin * 2) * scale
  assert.equal(bmp.width, side)
  assert.equal(bmp.height, side)
  assert.ok(bmp.data instanceof Uint8Array)
  assert.equal(bmp.data.length, side * side * 4)

  const BLACK = [0, 0, 0, 255]
  const WHITE = [255, 255, 255, 255]
  const o = margin * scale
  assert.deepEqual(pixel(bmp, 0, 0), WHITE, '留白')
  assert.deepEqual(pixel(bmp, o - 1, o - 1), WHITE, '留白最後一格')
  assert.deepEqual(pixel(bmp, o, o), BLACK, '左上尋像圖樣外框角')
  assert.deepEqual(pixel(bmp, o + scale * 7 - 1, o), BLACK, '外框右上角')
  assert.deepEqual(pixel(bmp, o + scale, o + scale), WHITE, '外框內的淺色環')
  assert.deepEqual(pixel(bmp, o + scale * 3, o + scale * 3), BLACK, '中央 3×3')
  assert.deepEqual(pixel(bmp, o + scale * 7, o), WHITE, '分隔線')
  const right = o + (qr.size - 1) * scale
  assert.deepEqual(pixel(bmp, right + scale - 1, o), BLACK, '右上尋像圖樣角')
  assert.deepEqual(pixel(bmp, o, right + scale - 1), BLACK, '左下尋像圖樣角')
})

test('qrToBitmap：每個模組正好是 scale×scale 的色塊', () => {
  const qr = encodeQR('中文心智圖', { ecc: 'M' })
  const margin = 1
  const scale = 3
  const bmp = qrToBitmap(qr, { margin, scale })
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      const expected = qr.modules[r][c] ? [0, 0, 0, 255] : [255, 255, 255, 255]
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          assert.deepEqual(pixel(bmp, (c + margin) * scale + dx, (r + margin) * scale + dy), expected)
        }
      }
    }
  }
})

test('qrToBitmap：RGBA 與 BGRA 的位元組順序', () => {
  const qr = encodeQR('a')
  // 預設黑白兩種順序位元組相同
  assert.deepEqual(qrToBitmap(qr, { order: 'BGRA' }).data, qrToBitmap(qr).data)

  const dark = [200, 10, 30, 255]
  const light = [250, 240, 5, 128]
  const rgba = qrToBitmap(qr, { margin: 1, scale: 1, dark, light })
  const bgra = qrToBitmap(qr, { margin: 1, scale: 1, dark, light, order: 'BGRA' })
  assert.deepEqual(pixel(rgba, 1, 1), [200, 10, 30, 255])
  assert.deepEqual(pixel(bgra, 1, 1), [30, 10, 200, 255])
  assert.deepEqual(pixel(rgba, 0, 0), [250, 240, 5, 128])
  assert.deepEqual(pixel(bgra, 0, 0), [5, 240, 250, 128])

  assert.throws(() => qrToBitmap(qr, { order: 'ARGB' }), RangeError)
  assert.throws(() => qrToBitmap(qr, { scale: 2.5 }), RangeError)
  assert.throws(() => qrToBitmap(qr, { dark: [0, 0, 0] }), RangeError)
})
