/**
 * TODO(Phase B)：加入 TXT/Markdown 匯入與檔案選擇 UI。
 * Phase A 先提供 JSON schema 正規化入口。
 */
import { deserializeDoc } from '../editor/model.js'

export function importDocumentJson(json) {
  return deserializeDoc(json)
}
