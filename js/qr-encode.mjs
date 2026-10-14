// QR Code 編碼器（ISO/IEC 18004:2015 Model 2），零依賴、純 ES module。
// 瀏覽器、Electron renderer／main（Node ESM）與 node:test 都直接 import；載入時不碰 DOM。
//
// 範圍：版本 1–40、糾錯等級 L/M/Q/H、只用 byte 模式（文字一律轉 UTF-8，不加 ECI；
// 主流解碼器（ZXing、ML Kit）會自動辨識 UTF-8）。不做 Micro QR、結構化附加、自動提升糾錯等級。
//
// 遮罩評分的解讀（各家實作在邊界細節上並不一致，這裡逐條對齊 segno 1.6，見 tests/qr-encode.test.mjs）：
// - 評分在填入格式資訊／版本資訊之前進行：那些保留區（含 dark module）一律視為淺色（ISO/IEC 18004:2015 §7.8）。
// - N1：同色連續 5+i 個 → 3+i 分；N2：每個同色 2×2 區塊 3 分；
// - N3：1:1:3:1:1（深淺深深深淺深）且任一側有 4 個淺色（超出符號邊界視為淺色）→ 40 分；
//   命中後從圖樣尾端之後繼續掃描（重疊的第二個圖樣不重複計分）。
// - N4：k = floor(|深色比例 − 50%| / 5%)，10k 分。
// - 分數相同時取編號最小的遮罩。
// python-qrcode、node qrcode 對上述細節的解讀不同，自動選出的遮罩可能不一樣；但任何遮罩都能正確解碼，
// 強制指定遮罩時三者輸出逐位元相同。

export const QR_ECC_LEVELS = Object.freeze(['L', 'M', 'Q', 'H'])

// ── 規格表（ISO/IEC 18004:2015 Table 9），索引 = 版本，0 不使用 ──
// 每個區塊的糾錯碼字數
const ECC_CODEWORDS_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
}

// 糾錯區塊數
const NUM_ECC_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
}

// 格式資訊裡的糾錯等級位元（注意不是依 L/M/Q/H 順序）
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 }

// 8 種資料遮罩：r = 列（row），c = 行（column），回傳 true 表示要反轉
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
]

// ── GF(256)，本原多項式 x^8+x^4+x^3+x^2+1（0x11D） ──
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x
  GF_LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

// 生成多項式 ∏(x − α^i), i = 0..degree−1；回傳不含最高次項（係數恆為 1）的係數，由高次到低次
const generatorCache = new Map()
function rsGenerator(degree) {
  let gen = generatorCache.get(degree)
  if (gen) return gen
  gen = new Uint8Array(degree)
  gen[degree - 1] = 1 // 從多項式 1 開始
  let root = 1
  for (let i = 0; i < degree; i++) {
    // 乘上 (x − root)：GF(2^8) 中減法即加法（XOR）
    for (let j = 0; j < degree; j++) {
      gen[j] = gfMul(gen[j], root) ^ (j + 1 < degree ? gen[j + 1] : 0)
    }
    root = gfMul(root, 2)
  }
  generatorCache.set(degree, gen)
  return gen
}

// 資料碼字除以生成多項式的餘式 = 糾錯碼字
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree)
  const rem = new Uint8Array(degree)
  for (const byte of data) {
    const factor = byte ^ rem[0]
    rem.copyWithin(0, 1)
    rem[degree - 1] = 0
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i], factor)
  }
  return rem
}

// ── 版本幾何 ──
function symbolSize(version) {
  return version * 4 + 17
}

// 對齊圖樣中心座標（同一組值同時用於列與行）
function alignmentPositions(version) {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = symbolSize(version) - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

// 扣掉所有功能圖樣、格式與版本資訊後可放資料（含糾錯與餘位）的模組數
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2
    result -= (25 * count - 10) * count - 55
    if (version >= 7) result -= 36
  }
  return result
}

function dataCodewords(version, ecc) {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][version] * NUM_ECC_BLOCKS[ecc][version]
}

// byte 模式字元數欄位長度
function byteCountBits(version) {
  return version <= 9 ? 8 : 16
}

// ── 位元串流 → 資料碼字（含終止符與補位） ──
function buildDataCodewords(bytes, version, ecc) {
  const capacityBits = dataCodewords(version, ecc) * 8
  const bits = []
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4) // byte 模式指示符
  push(bytes.length, byteCountBits(version))
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, capacityBits - bits.length)) // 終止符：最多 4 個 0
  push(0, (8 - (bits.length % 8)) % 8) // 補齊到位元組邊界
  const codewords = new Uint8Array(capacityBits / 8)
  for (let i = 0; i < bits.length; i++) codewords[i >>> 3] |= bits[i] << (7 - (i & 7))
  for (let i = bits.length / 8, pad = 0xec; i < codewords.length; i++, pad ^= 0xec ^ 0x11) codewords[i] = pad
  return codewords
}

// 切區塊、算糾錯碼、交錯排列成最終碼字序列
function interleaveWithEcc(data, version, ecc) {
  const numBlocks = NUM_ECC_BLOCKS[ecc][version]
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version]
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortDataLen = Math.floor(rawCodewords / numBlocks) - eccLen

  const dataBlocks = []
  const eccBlocks = []
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const len = shortDataLen + (i < numShortBlocks ? 0 : 1) // 長區塊排在後面
    const block = data.subarray(offset, offset + len)
    offset += len
    dataBlocks.push(block)
    eccBlocks.push(rsRemainder(block, eccLen))
  }

  const result = new Uint8Array(rawCodewords)
  let k = 0
  for (let i = 0; i <= shortDataLen; i++) {
    for (const block of dataBlocks) if (i < block.length) result[k++] = block[i]
  }
  for (let i = 0; i < eccLen; i++) {
    for (const block of eccBlocks) result[k++] = block[i]
  }
  return result
}

// ── 矩陣 ──
function createGrid(size) {
  return Array.from({ length: size }, () => new Uint8Array(size))
}

// 畫功能圖樣，並把格式／版本資訊與 dark module 的位置先保留（值為 0，標成功能區）
function buildFunctionPatterns(version) {
  const size = symbolSize(version)
  const modules = createGrid(size)
  const isFunction = createGrid(size)
  const set = (r, c, dark) => {
    modules[r][c] = dark ? 1 : 0
    isFunction[r][c] = 1
  }

  // 定時圖樣
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  // 尋像圖樣 + 分隔線（三個角）
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr
        const c = cc + dc
        if (r < 0 || r >= size || c < 0 || c >= size) continue
        const dist = Math.max(Math.abs(dr), Math.abs(dc))
        set(r, c, dist !== 2 && dist !== 4)
      }
    }
  }

  // 對齊圖樣（避開與尋像圖樣重疊的三個角）
  const align = alignmentPositions(version)
  const last = align.length - 1
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(align[i] + dr, align[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
        }
      }
    }
  }

  // 保留格式資訊區（跳過定時圖樣）與 dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(8, i, false)
      set(i, 8, false)
    }
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false)
    set(size - 1 - i, 8, false)
  }

  // 保留版本資訊區（版本 7 以上）
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(b, a, false)
      set(a, b, false)
    }
  }

  return { size, modules, isFunction }
}

// 由右下角開始，兩行一組蛇行放入碼字位元；剩下的餘位保持 0
function placeCodewords(modules, isFunction, codewords) {
  const size = modules.length
  const totalBits = codewords.length * 8
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // 跳過垂直定時圖樣那一行
    const upward = ((right + 1) & 2) === 0
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j++) {
        const c = right - j
        if (isFunction[r][c] || i >= totalBits) continue
        modules[r][c] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1
        i++
      }
    }
  }
}

function applyMask(modules, isFunction, mask) {
  const fn = MASKS[mask]
  const size = modules.length
  for (let r = 0; r < size; r++) {
    const row = modules[r]
    const fnRow = isFunction[r]
    for (let c = 0; c < size; c++) if (!fnRow[c] && fn(r, c)) row[c] ^= 1
  }
}

// 格式資訊：5 位元資料 + BCH(15,5) 餘式，再 XOR 0x5412
function formatBits(ecc, mask) {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

// 版本資訊：6 位元版本 + BCH(18,6) 餘式
function versionBits(version) {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

function drawFormatAndVersion(modules, version, ecc, mask) {
  const size = modules.length
  const bits = formatBits(ecc, mask)
  const bit = i => (bits >>> i) & 1

  // 左上角：位元 0–7 沿第 8 行往下，位元 8–14 沿第 8 列往左
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i)
  modules[7][8] = bit(6)
  modules[8][8] = bit(7)
  modules[8][7] = bit(8)
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i)
  // 右上角與左下角的副本
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i)
  modules[size - 8][8] = 1 // dark module

  if (version >= 7) {
    const vbits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const v = (vbits >>> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      modules[b][a] = v // 右上
      modules[a][b] = v // 左下
    }
  }
}

// ── 遮罩評分（N1–N4） ──
function linePenalty(line, size) {
  let score = 0
  // N1：連續同色 ≥ 5
  let run = 1
  for (let i = 1; i < size; i++) {
    if (line[i] === line[i - 1]) {
      run++
    } else {
      if (run >= 5) score += run - 2
      run = 1
    }
  }
  if (run >= 5) score += run - 2

  // N3：1011101，前或後 4 格淺色（界外算淺色）
  const lightRange = (from, to) => {
    for (let i = Math.max(from, 0); i < Math.min(to, size); i++) if (line[i]) return false
    return true
  }
  for (let i = 0; i + 7 <= size; ) {
    if (
      line[i] === 1 && line[i + 1] === 0 && line[i + 2] === 1 && line[i + 3] === 1 &&
      line[i + 4] === 1 && line[i + 5] === 0 && line[i + 6] === 1 &&
      (lightRange(i - 4, i) || lightRange(i + 7, i + 11))
    ) {
      score += 40
      i += 7
    } else {
      i++
    }
  }
  return score
}

function penaltyScore(modules) {
  const size = modules.length
  let score = 0
  let dark = 0
  const column = new Uint8Array(size)

  for (let i = 0; i < size; i++) {
    const row = modules[i]
    for (let j = 0; j < size; j++) {
      column[j] = modules[j][i]
      dark += row[j]
    }
    score += linePenalty(row, size) + linePenalty(column, size)
  }

  // N2：同色 2×2 區塊
  for (let r = 1; r < size; r++) {
    const row = modules[r]
    const prev = modules[r - 1]
    for (let c = 1; c < size; c++) {
      const v = row[c]
      if (v === row[c - 1] && v === prev[c] && v === prev[c - 1]) score += 3
    }
  }

  // N4：深色比例偏離 50% 的程度（整數運算，避免浮點誤差）
  const total = size * size
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return score
}

// ── 公開 API ──
function checkVersion(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 40) throw new RangeError(`QR: ${name} must be an integer 1..40`)
}

export function encodeQR(text, { ecc = 'M', minVersion = 1, maxVersion = 40, mask = null } = {}) {
  if (typeof text !== 'string') throw new TypeError('QR: text must be a string')
  if (!QR_ECC_LEVELS.includes(ecc)) throw new RangeError('QR: ecc must be one of L, M, Q, H')
  checkVersion('minVersion', minVersion)
  checkVersion('maxVersion', maxVersion)
  if (minVersion > maxVersion) throw new RangeError('QR: minVersion must not exceed maxVersion')
  if (mask !== null && mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new RangeError('QR: mask must be null or an integer 0..7')
  }

  const bytes = new TextEncoder().encode(text) // 孤立代理對會變成 U+FFFD
  let version = 0
  for (let v = minVersion; v <= maxVersion; v++) {
    // 模式指示符 4 位元 + 字元數欄位 + 資料（容量上限都小於字元數欄位能表示的最大值）
    if (4 + byteCountBits(v) + bytes.length * 8 <= dataCodewords(v, ecc) * 8) {
      version = v
      break
    }
  }
  if (!version) throw new RangeError('QR: data too long')

  const codewords = interleaveWithEcc(buildDataCodewords(bytes, version, ecc), version, ecc)
  const { size, modules, isFunction } = buildFunctionPatterns(version)
  placeCodewords(modules, isFunction, codewords)

  let chosen = mask ?? -1
  if (chosen < 0) {
    // 每個遮罩各試一次；此時格式／版本區仍為 0（淺色）
    let best = Infinity
    for (let m = 0; m < 8; m++) {
      applyMask(modules, isFunction, m)
      const score = penaltyScore(modules)
      applyMask(modules, isFunction, m) // XOR 再套一次即還原
      if (score < best) {
        best = score
        chosen = m
      }
    }
  }
  applyMask(modules, isFunction, chosen)
  drawFormatAndVersion(modules, version, ecc, chosen)

  return { version, size, ecc, mask: chosen, modules }
}

function checkRender(margin, scale) {
  if (!Number.isInteger(margin) || margin < 0) throw new RangeError('QR: margin must be a non-negative integer')
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError('QR: scale must be a positive integer')
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

// SVG：viewBox 以「模組」為單位（含留白），width/height = 模組數 × scale。
// 深色模組合成單一 <path>（每列相鄰深色合併成一段水平矩形）；light 傳空值則不畫背景。
export function qrToSvg(qr, { margin = 4, scale = 8, dark = '#000', light = '#fff' } = {}) {
  checkRender(margin, scale)
  const { size, modules } = qr
  const dim = size + margin * 2
  const px = dim * scale
  let d = ''
  for (let r = 0; r < size; r++) {
    const row = modules[r]
    for (let c = 0; c < size; ) {
      if (!row[c]) {
        c++
        continue
      }
      let end = c + 1
      while (end < size && row[end]) end++
      d += `M${c + margin} ${r + margin}h${end - c}v1h-${end - c}z`
      c = end
    }
  }
  const background = light ? `<rect width="${dim}" height="${dim}" fill="${escapeAttr(light)}"/>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `${background}<path fill="${escapeAttr(dark)}" d="${d}"/></svg>`
  )
}

function checkColor(name, color) {
  if (!Array.isArray(color) || color.length !== 4 || !color.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new RangeError(`QR: ${name} must be [r, g, b, a] with integers 0..255`)
  }
}

// 點陣圖：每像素 4 bytes。order 'BGRA' 是 Electron nativeImage.createFromBitmap 要的順序。
// dark／light 為 [r, g, b, a]（預設黑／白、不透明），依 order 寫入。
export function qrToBitmap(qr, { margin = 4, scale = 8, order = 'RGBA', dark = [0, 0, 0, 255], light = [255, 255, 255, 255] } = {}) {
  checkRender(margin, scale)
  if (order !== 'RGBA' && order !== 'BGRA') throw new RangeError("QR: order must be 'RGBA' or 'BGRA'")
  checkColor('dark', dark)
  checkColor('light', light)
  const pixel = ([r, g, b, a]) => (order === 'RGBA' ? [r, g, b, a] : [b, g, r, a])
  const darkPx = pixel(dark)
  const lightPx = pixel(light)

  const { size, modules } = qr
  const dim = size + margin * 2
  const width = dim * scale
  const height = width
  const stride = width * 4
  const data = new Uint8Array(stride * height)
  // 每個模組列先組出一條像素列，再複製 scale 次
  for (let r = -margin; r < size + margin; r++) {
    const row = r >= 0 && r < size ? modules[r] : null
    const top = (r + margin) * scale * stride
    for (let x = 0; x < width; x++) {
      const c = Math.floor(x / scale) - margin
      data.set(row && c >= 0 && c < size && row[c] ? darkPx : lightPx, top + x * 4)
    }
    for (let k = 1; k < scale; k++) data.copyWithin(top + k * stride, top, top + stride)
  }
  return { width, height, data }
}
