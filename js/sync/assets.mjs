/**
 * 同步層的圖片資產：上傳前把 node.image.src 的 data URI 換成 `mf-asset:<sha256>`，圖片另存一份；
 * 下載後再換回原 data URI。本機文件格式不變，每次同步只傳文字結構。
 */
export const ASSET_REF_PREFIX = 'mf-asset:'
const ASSET_REF_PATTERN = /^mf-asset:([0-9a-f]{64})$/u

export function isAssetRef(value) {
  return typeof value === 'string' && ASSET_REF_PATTERN.test(value)
}

export function assetRef(sha) {
  return `${ASSET_REF_PREFIX}${sha}`
}

export function assetShaFromRef(value) {
  return ASSET_REF_PATTERN.exec(String(value || ''))?.[1] || null
}

export async function sha256Hex(text, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!subtle || typeof subtle.digest !== 'function') throw new Error('SHA-256 is unavailable (crypto.subtle)')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(text)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  if (Array.isArray(node.children)) node.children.forEach(child => walk(child, visit))
}

/** 原地把 data URI 換成參照；回傳 { sha: dataUri }。doc 必須是呼叫端自己的副本。 */
export async function extractAssetsInPlace(doc, { hash = sha256Hex } = {}) {
  const assets = {}
  const nodes = []
  walk(doc?.root, node => {
    if (typeof node.image?.src === 'string' && node.image.src.startsWith('data:')) nodes.push(node)
  })
  for (const node of nodes) {
    const sha = await hash(node.image.src)
    assets[sha] = node.image.src
    node.image.src = assetRef(sha)
  }
  return assets
}

/** 原地把參照換回 data URI；找不到的資產保留參照並列在 missing（呼叫端必須先補抓再寫本機）。 */
export function restoreAssetsInPlace(doc, getAsset) {
  const missing = new Set()
  walk(doc?.root, node => {
    const sha = assetShaFromRef(node.image?.src)
    if (!sha) return
    const dataUri = getAsset(sha)
    if (typeof dataUri === 'string' && dataUri.startsWith('data:')) node.image.src = dataUri
    else missing.add(sha)
  })
  return [...missing].sort()
}

export function referencedAssets(doc) {
  const shas = new Set()
  walk(doc?.root, node => {
    const sha = assetShaFromRef(node.image?.src)
    if (sha) shas.add(sha)
  })
  return [...shas].sort()
}
