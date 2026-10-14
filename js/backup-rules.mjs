/**
 * 備份規則（電腦版與手機版共用）：什麼算「有心智圖」、什麼算「使用者刻意的狀態」、哪些 key 要備份。
 * 純函數，不碰檔案系統；電腦版經 desktop/backup-rules.mjs 轉出口。
 */
export const DOCUMENT_INDEX_KEY = 'mindflow.docs.index'
export const DOCUMENT_KEY_PREFIX = 'mindflow.doc.'

// 判斷「這份 localStorage 有沒有真正的心智圖」。偏好設定 key 會讓「有沒有任何 mindflow.* key」
// 這種判斷永遠為真，於是文件全掉光時反而不會觸發救援——所以一律以文件索引為準。
export function hasMindflowDocuments(entries) {
  if (!entries || typeof entries !== 'object') return false

  const raw = entries[DOCUMENT_INDEX_KEY]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        // 索引讀得動就以索引為準。
        const docs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.docs) ? parsed.docs : []
        const trash = Array.isArray(parsed.trash) ? parsed.trash : []
        return docs.length + trash.length > 0
      }
    } catch {
      // 索引壞掉不代表文件不見，往下改看文件本體。
    }
  }

  // 索引壞掉或不存在，但文件本體還在時必須算「有資料」：
  // 否則救援會拿舊備份蓋掉現存文件，那比不還原更糟。
  return Object.keys(entries).some(key => key.startsWith(DOCUMENT_KEY_PREFIX))
}

/**
 * 「儲存區處於使用者刻意維護的狀態」：索引解析得動（包含刻意清空後的空索引）或仍有文件本體。
 * 救援與舊版遷移只該在索引消失／損毀且文件掉光時發動——把使用者剛清空的庫自動復活回來不是救援。
 */
export function hasIntentionalMindflowState(entries) {
  if (!entries || typeof entries !== 'object') return false
  const raw = entries[DOCUMENT_INDEX_KEY]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return true
    } catch { /* 壞索引不算刻意狀態 */ }
  }
  return Object.keys(entries).some(key => key.startsWith(DOCUMENT_KEY_PREFIX))
}

export function normalizeMindflowEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {}

  return Object.fromEntries(
    Object.entries(entries)
      .filter(([key, value]) => key.startsWith('mindflow.') && typeof value === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
  )
}
