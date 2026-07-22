/**
 * TODO(Phase B)：加入 PNG/SVG/PDF/TXT/Markdown 匯出。
 * Phase A 先提供零依賴 JSON 序列化基礎。
 */
import { serializeDoc } from '../editor/model.js'

export function exportDocumentJson(doc) {
  return serializeDoc(doc)
}
