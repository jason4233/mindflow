/**
 * 本機文件 ↔ 雲端文件（schemaVersion 2）。
 * 雲端文件 = 本機文件 JSON，圖片換成 mf-asset 參照，外加 schemaVersion 與 hlc；
 * 解碼後與原本機 JSON 逐字相同（鍵的順序不變、只替換 image.src 的值）。
 */
import { extractAssetsInPlace, referencedAssets, restoreAssetsInPlace, sha256Hex } from './assets.mjs'
import { isHlc } from './hlc.mjs'

export const CLOUD_DOC_SCHEMA_VERSION = 2
export const MAX_SUPPORTED_SCHEMA_VERSION = 2

export class CloudSchemaError extends Error {
  constructor(id, version) {
    super('雲端的同步資料是較新版本的 MindFlow 寫入的，這個版本無法安全同步，所以已暫停同步。請先更新 MindFlow。本機的心智圖不受影響。')
    this.name = 'SyncSchemaError'
    this.code = 'SCHEMA_TOO_NEW'
    this.id = id
    this.version = version
  }
}

export class CloudDocError extends Error {
  constructor(id, message) {
    super(message)
    this.name = 'CloudDocError'
    this.id = id
  }
}

function parseObject(raw, id) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CloudDocError(id, `Cloud document is not valid JSON: ${id}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CloudDocError(id, `Cloud document is not an object: ${id}`)
  return parsed
}

/** v1（沒有 schemaVersion）或 v2 可以讀；更新的版本一律拒絕，避免把新格式欄位刪掉。 */
export function cloudSchemaVersion(value, id = null) {
  if (value === undefined || value === null) return 1
  if (!Number.isInteger(value) || value < 1) throw new CloudDocError(id, `Invalid schemaVersion for ${id}`)
  if (value > MAX_SUPPORTED_SCHEMA_VERSION) throw new CloudSchemaError(id, value)
  return value
}

/**
 * @param {string} localRaw  localStorage 裡的文件 JSON
 * @returns {Promise<{ raw: string, assets: Record<string, string>, hlc: string }>}
 */
export async function encodeCloudDoc(localRaw, { id, hlc, hash = sha256Hex } = {}) {
  if (!isHlc(hlc)) throw new TypeError('encodeCloudDoc requires a valid HLC')
  const doc = parseObject(localRaw, id)
  if (id && doc.id !== id) throw new CloudDocError(id, `Document id mismatch: ${id}`)
  delete doc.schemaVersion
  delete doc.hlc
  const assets = await extractAssetsInPlace(doc, { hash })
  doc.schemaVersion = CLOUD_DOC_SCHEMA_VERSION
  doc.hlc = hlc
  return { raw: JSON.stringify(doc), assets, hlc }
}

/** 雲端文件需要哪些資產（下載前先補抓）。 */
export function cloudDocAssets(cloudRaw, id) {
  return referencedAssets(parseObject(cloudRaw, id))
}

/**
 * @param {string} cloudRaw
 * @param {(sha: string) => string|undefined} getAsset  已在記憶體或快取裡的資產
 * @returns {{ raw: string, hlc: string|null, schemaVersion: number, missingAssets: string[] }}
 */
export function decodeCloudDoc(cloudRaw, { id, getAsset = () => undefined } = {}) {
  const doc = parseObject(cloudRaw, id)
  if (id && doc.id !== id) throw new CloudDocError(id, `Document id mismatch: ${id}`)
  const schemaVersion = cloudSchemaVersion(doc.schemaVersion, id)
  const hlc = isHlc(doc.hlc) ? doc.hlc : null
  delete doc.schemaVersion
  delete doc.hlc
  const missingAssets = restoreAssetsInPlace(doc, getAsset)
  return { raw: JSON.stringify(doc), hlc, schemaVersion, missingAssets }
}
