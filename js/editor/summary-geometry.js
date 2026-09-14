/**
 * 概要（summary）幾何純函數：無 DOM 依賴，編輯器 overlay（summary.js）與 SVG 匯出（io/export.js）共用同一份，
 * 畫面與匯出永遠一致。
 *
 * 方向規則（2026-09-15，晨睿：概括要「根據主題變換方向」）：
 *   1. 括號沿「同級節點的排列軸」延伸。排列軸取自 layout 實際套用在 position 上的 connector——子樹可用
 *      style.structure 覆寫結構，所以不能只看 doc.layout（它只是後備）。
 *      org / timeline-h / fishbone 的同級是沿 x 排列 → 橫向括號；其餘（心智圖、邏輯圖、目錄樹、垂直時間軸）→ 直立。
 *   2. 括號放在覆蓋節點「遠離父節點」的外側。以 position.side（layout 寫的展開方向）為準：全在 left → 左、
 *      全在 right → 右、全在 up → 上、全在 down → 下；左右（或上下）交錯的同級（垂直時間軸、水平時間軸、魚骨）
 *      固定右／下，不隨文字寬度翻面；沒有 side 資訊時才退回「父節點中心在哪一邊」的比較。
 *   3. 括號涵蓋的是覆蓋節點的「整棵子樹」外緣（GitMind／XMind 同），收合看不見的後代與獨立心智圖不計。
 *
 * 同級順序一律以畫面位置為準（有 positions 時）：魚骨圖的 children 陣列與畫面左右相反、父節點覆寫結構後
 * model 上的 side 已無意義，陣列順序都不可信。沒有 positions（純資料層）時退回陣列順序。
 */
import { getFloatingMeta } from './model.js'

const HORIZONTAL_SIBLING_LAYOUTS = new Set(['org', 'timeline-h', 'fishbone'])
const PAD = 5            // 括號兩端超出子樹的餘量
const BRACKET_GAP = 24   // 括號基線（尖端）與子樹外緣的距離
const CONTROL_GAP = 20   // 邊界控制點與基線的距離
const LABEL_GAP = 32     // 概要標籤錨點與基線的距離

export function isHorizontalSiblingLayout(layoutName) {
  return HORIZONTAL_SIBLING_LAYOUTS.has(layoutName)
}

export function getSummaryOrientation(covered, parentPosition, layoutName = 'mindmap-both', box = unionBox(covered)) {
  const effectiveLayout = covered.find(position => position?.connector)?.connector || layoutName
  const orientation = isHorizontalSiblingLayout(effectiveLayout) ? 'horizontal' : 'vertical'
  return { orientation, side: resolveSide(orientation, covered, parentPosition, box), box }
}

function resolveSide(orientation, covered, parentPosition, box) {
  const vertical = orientation === 'vertical'
  const relevant = vertical ? ['left', 'right'] : ['up', 'down']
  const sides = new Set(covered.map(position => position?.side).filter(side => relevant.includes(side)))
  if (sides.size === 1) {
    const [side] = sides
    return { left: 'left', right: 'right', up: 'top', down: 'bottom' }[side]
  }
  if (sides.size > 1) return vertical ? 'right' : 'bottom'
  if (vertical) return parentPosition && centerX(parentPosition) > (box.left + box.right) / 2 ? 'left' : 'right'
  return parentPosition && centerY(parentPosition) > (box.top + box.bottom) / 2 ? 'top' : 'bottom'
}

export function summaryGeometry(summary, parent, positions, layoutName = 'mindmap-both') {
  const nodes = getSummaryNodes(summary, parent, layoutName, positions)
  const covered = nodes.map(node => positions.get(node.id)).filter(Boolean)
  if (covered.length === 0) return null
  const extent = nodes.flatMap(node => collectSubtreePositions(node, positions))
  const { orientation, side, box } = getSummaryOrientation(covered, positions.get(parent.id), layoutName, unionBox(extent))
  const vertical = orientation === 'vertical'
  // along＝括號延伸的主軸座標；cross＝括號基線所在的交叉軸座標；dir＝朝外側為正
  const start = (vertical ? box.top : box.left) - PAD
  const end = (vertical ? box.bottom : box.right) + PAD
  const middle = (start + end) / 2
  const dir = side === 'right' || side === 'bottom' ? 1 : -1
  const edge = { right: box.right, left: box.left, bottom: box.bottom, top: box.top }[side]
  const axis = edge + dir * BRACKET_GAP
  const depth = Math.max(12, Math.min(24, (end - start) * 0.16))
  const point = (along, cross) => vertical ? `${cross} ${along}` : `${along} ${cross}`
  const path = `M ${point(start, axis + dir * depth)} C ${point(start, axis + dir * 5)}, ${point(middle - depth, axis + dir * 8)}, ${point(middle, axis)} C ${point(middle + depth, axis + dir * 8)}, ${point(end, axis + dir * 5)}, ${point(end, axis + dir * depth)}`
  const controlCross = axis + dir * CONTROL_GAP
  const labelCross = axis + dir * LABEL_GAP
  const crossRange = [axis, axis + dir * depth].sort((a, b) => a - b)
  return {
    orientation,
    side,
    start,
    end,
    middle,
    axis,
    top: box.top - PAD,
    bottom: box.bottom + PAD,
    left: box.left - PAD,
    right: box.right + PAD,
    // 標籤錨點：直立時在基線外側、主軸置中；橫向時在基線下／上方、主軸置中（對齊方式由呈現端依 side 決定）
    labelX: vertical ? labelCross : middle,
    labelY: vertical ? middle : labelCross,
    // 兩個邊界控制點沿主軸落在括號兩端；start 永遠是畫面上的第一個（上／左）覆蓋節點那一端
    boundaries: [
      { edge: 'startNodeId', cx: vertical ? controlCross : start, cy: vertical ? start : controlCross },
      { edge: 'endNodeId', cx: vertical ? controlCross : end, cy: vertical ? end : controlCross }
    ],
    // 括號 path 本身的包圍盒（匯出算畫布範圍用）
    bounds: vertical
      ? { minX: crossRange[0], minY: start, maxX: crossRange[1], maxY: end }
      : { minX: start, minY: crossRange[0], maxX: end, maxY: crossRange[1] },
    path
  }
}

export function getSummaryNodes(summary, parent, layoutName = 'mindmap-both', positions = null) {
  if (!summary || !parent) return []
  const anchors = normalizeSummaryAnchors(summary, parent, layoutName, positions)
  if (!anchors) return []
  const startNode = parent.children.find(node => node.id === anchors.startNodeId)
  if (!startNode) return []
  const siblings = getVisualSiblings(parent, startNode, layoutName, positions)
  const start = siblings.findIndex(node => node.id === anchors.startNodeId)
  const end = siblings.findIndex(node => node.id === anchors.endNodeId)
  return start >= 0 && end >= start ? siblings.slice(start, end + 1) : []
}

/**
 * 回傳畫面順序上的 { startNodeId, endNodeId }（start 在前）。兩個錨點視為「無序的一對」：舊文件或魚骨圖
 * 可能存成陣列序，讀取時一律以視覺順序重排，概要不會因為順序相反而消失。
 */
export function normalizeSummaryAnchors(summary, parent, layoutName = 'mindmap-both', positions = null) {
  let startNodeId = summary.startNodeId
  let endNodeId = summary.endNodeId
  // 舊文件仍可讀取 index；一旦更新便遷移為穩定 nodeId 錨點。
  if (!startNodeId && Number.isFinite(Number(summary.startIndex))) {
    startNodeId = parent.children[Math.max(0, Math.min(parent.children.length - 1, Number(summary.startIndex)))]?.id
  }
  if (!endNodeId && Number.isFinite(Number(summary.endIndex))) {
    endNodeId = parent.children[Math.max(0, Math.min(parent.children.length - 1, Number(summary.endIndex)))]?.id
  }
  const startNode = parent.children.find(node => node.id === startNodeId)
  const endNode = parent.children.find(node => node.id === endNodeId)
  if (!startNode || !endNode) return null
  const siblings = getVisualSiblings(parent, startNode, layoutName, positions)
  const start = siblings.findIndex(node => node.id === startNode.id)
  const end = siblings.findIndex(node => node.id === endNode.id)
  if (start < 0 || end < 0) return null
  return start <= end
    ? { startNodeId: startNode.id, endNodeId: endNode.id }
    : { startNodeId: endNode.id, endNodeId: startNode.id }
}

/**
 * anchor 所在的「同一列同級」依畫面順序排列。有 positions 時：以 anchor 的 connector 判定主軸（x 或 y）並排序；
 * 雙向心智圖（connector = mindmap-both）左右兩側各自成列，以 position.side 分組。獨立心智圖不屬於任何一列。
 * 沒有 positions 時退回 model：只有雙向心智圖依 node.side 分側，其餘照 children 陣列。
 */
export function getVisualSiblings(parent, anchor, layoutName = 'mindmap-both', positions = null) {
  const anchorPosition = positions?.get(anchor?.id)
  if (anchorPosition) {
    const along = isHorizontalSiblingLayout(anchorPosition.connector) ? centerX : centerY
    return parent.children
      .filter(node => node === anchor || !getFloatingMeta(node))
      .filter(node => {
        const position = positions.get(node.id)
        if (!position) return false
        return anchorPosition.connector !== 'mindmap-both' || position.side === anchorPosition.side
      })
      .sort((left, right) => along(positions.get(left.id)) - along(positions.get(right.id)))
  }
  const siblings = parent.children.filter(node => node === anchor || !getFloatingMeta(node))
  if ((layoutName === 'mindmap-both' || layoutName === 'mindmap') && (anchor?.side === 'left' || anchor?.side === 'right')) {
    return siblings.filter(node => node.side === anchor.side)
  }
  return siblings
}

export function centerX(position) { return position.x + position.w / 2 }
export function centerY(position) { return position.y + position.h / 2 }

// 節點自身與所有可見後代的位置；獨立心智圖（懸浮圖）不是這棵子樹的一部分
function collectSubtreePositions(node, positions, out = []) {
  if (getFloatingMeta(node) && out.length > 0) return out
  const position = positions.get(node.id)
  if (position) out.push(position)
  for (const child of node.children || []) collectSubtreePositions(child, positions, out)
  return out
}

function unionBox(positions) {
  return {
    left: Math.min(...positions.map(position => position.x)),
    top: Math.min(...positions.map(position => position.y)),
    right: Math.max(...positions.map(position => position.x + position.w)),
    bottom: Math.max(...positions.map(position => position.y + position.h))
  }
}
