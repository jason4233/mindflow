/**
 * GAMMA 本機佈局記錄的純函數：決定 localStorage 的佈局能不能覆蓋文件本身的佈局。
 * 文件的 layout 會跟著同步走，本機記錄不會；所以本機記錄只在「文件佈局沒被別台改過」時才生效。
 */
import { LAYOUTS } from './model.js'
import { isLayoutName, normalizeLayoutName } from './layout.js'

/** normalizeDoc 讀回文件時會保留下來的 layout 值（不在 LAYOUTS 裡的佈局存檔後會退回 mindmap-both）。 */
export function persistedLayout(layout) {
  return LAYOUTS.includes(layout) ? layout : 'mindmap-both'
}

/** 寫進 mindflow.gamma.<id> 的佈局欄位：實際佈局，加上記錄當下文件會存成的值。 */
export function gammaLayoutRecord(docLayout) {
  return {
    layout: normalizeLayoutName(docLayout),
    docLayout: persistedLayout(docLayout)
  }
}

/**
 * 回傳應套用到文件的佈局；不該覆蓋時回傳 null。
 * - 新格式（有 docLayout）：文件 layout 仍等於記錄當下的值才套用；別台改過就以文件為準。
 * - 舊格式（沒有 docLayout）：只補回存不進文件的佈局（例如垂直時間軸），
 *   而且文件仍是存檔退回的預設值時才套用；其餘情況文件本身已記住佈局，不覆蓋。
 */
export function gammaLayoutOverride(state, docLayout) {
  if (!state || typeof state !== 'object' || !isLayoutName(state.layout)) return null
  const layout = normalizeLayoutName(state.layout)
  if (typeof state.docLayout === 'string') {
    return state.docLayout === docLayout ? layout : null
  }
  if (LAYOUTS.includes(layout)) return null
  return docLayout === persistedLayout(layout) ? layout : null
}
