/**
 * 節點級三方合併（M2b，計畫 3.7）：base（上次同步版）、本機、遠端三份文件逐節點、逐欄位合併。
 * - 只有一邊改 → 採用那一邊；兩邊改不同節點／不同欄位 → 全部保留。
 * - 同節點同欄位兩邊都改且值不同 → 勝方（HLC 較新的那一邊）的值，輸方的值寫進衝突紀錄。
 * - 互相綁定的欄位整組判勝負：text＋richText、image、懸浮座標。
 * - collapsed（展開／收合）是檢視狀態：直接採勝方，不記衝突。
 * - 子節點順序：一邊沒動就採另一邊；兩邊都動就以勝方順序為主，另一邊新增的接在後面。
 * - 移動到不同父節點：勝方為準；造成循環時撤銷輸方的移動。
 * - 一邊刪除、另一邊修改：被修改的節點不刪，掛回最近的、仍存在的祖先。
 * - 關聯線、概要依 id 合併；指向已不存在節點的整筆移除並記錄。
 * 純函數：輸入三份已解析的文件（本機格式），輸出合併後的文件與衝突紀錄；出錯時丟出例外，
 * 由呼叫端退回「整份衝突副本」（安全網）。
 */
const FLOATING_PREFIX = '__floating__:'
export const MAX_CONFLICT_LOG = 50

const DOC_SCALAR_KEYS = ['title', 'layout', 'themeId']
const CANVAS_KEYS = ['background', 'watermark', 'spacingH', 'spacingV']

export class MergeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MergeError'
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

function same(left, right) {
  return JSON.stringify(canonical(left ?? null)) === JSON.stringify(canonical(right ?? null))
}

function splitIcons(icons) {
  const list = Array.isArray(icons) ? icons.filter(icon => typeof icon === 'string') : []
  const floating = list.find(icon => icon.startsWith(FLOATING_PREFIX)) ?? null
  return { icons: list.filter(icon => !icon.startsWith(FLOATING_PREFIX)), floating }
}

/** 一個節點拆成可合併的欄位組（不含 children）。 */
function nodeFields(node) {
  const { icons, floating } = splitIcons(node.icons)
  const fields = {
    text: { text: node.text ?? '', richText: node.richText ?? null },
    image: node.image ?? null,
    floating,
    collapsed: Boolean(node.collapsed),
    side: node.side ?? null,
    notes: node.notes ?? null,
    link: node.link ?? null,
    icons
  }
  const style = isObject(node.style) ? node.style : {}
  for (const key of Object.keys(style)) fields[`style.${key}`] = style[key]
  return fields
}

/** 攤平：id → { fields, parentId, childIds }；同時檢查 id 不重複。 */
function flatten(doc) {
  const nodes = new Map()
  if (!isObject(doc?.root) || typeof doc.root.id !== 'string') throw new MergeError('Document has no root')
  const visit = (node, parentId) => {
    if (!isObject(node) || typeof node.id !== 'string' || !node.id) throw new MergeError('Node without id')
    if (nodes.has(node.id)) throw new MergeError(`Duplicate node id ${node.id}`)
    const children = Array.isArray(node.children) ? node.children : []
    nodes.set(node.id, { fields: nodeFields(node), parentId, childIds: children.map(child => child?.id) })
    children.forEach(child => visit(child, node.id))
  }
  visit(doc.root, null)
  return { rootId: doc.root.id, nodes }
}

function fieldKeys(...records) {
  const keys = new Set()
  for (const record of records) if (record) Object.keys(record).forEach(key => keys.add(key))
  return [...keys].sort()
}

function mergeIconSets(base, local, remote) {
  const baseSet = new Set(base)
  const localSet = new Set(local)
  const remoteSet = new Set(remote)
  const keep = icon => (baseSet.has(icon) ? localSet.has(icon) && remoteSet.has(icon) : localSet.has(icon) || remoteSet.has(icon))
  const ordered = [...local, ...remote.filter(icon => !localSet.has(icon))]
  return [...new Set(ordered)].filter(keep)
}

/**
 * @param {object} input
 * @param {object|null} input.base   上次同步成功的版本（沒有就當成兩邊都是新增）
 * @param {object} input.local
 * @param {object} input.remote
 * @param {'local'|'remote'} input.winner  兩邊同時改同一欄位時採用哪一邊（由 HLC 決定）
 * @param {string} [input.now]       衝突紀錄的時間
 * @param {string} [input.localLabel]
 * @param {string} [input.remoteLabel]
 */
export function mergeDocuments({ base, local, remote, winner, now = new Date().toISOString(), localLabel = '本機', remoteLabel = '另一台裝置' }) {
  if (winner !== 'local' && winner !== 'remote') throw new MergeError('winner must be local or remote')
  if (!isObject(local) || !isObject(remote)) throw new MergeError('Both sides are required')
  if (local.id !== remote.id || (base && base.id !== local.id)) throw new MergeError('Document ids differ')
  const B = base ? flatten(base) : { rootId: local.root?.id, nodes: new Map() }
  const L = flatten(local)
  const R = flatten(remote)
  if (L.rootId !== R.rootId || (base && B.rootId !== L.rootId)) throw new MergeError('Root ids differ')
  const rootId = L.rootId
  const conflicts = []
  const winnerLabel = winner === 'local' ? localLabel : remoteLabel
  const loserLabel = winner === 'local' ? remoteLabel : localLabel
  const record = (entry, loserValue) => {
    conflicts.push({
      id: `c-${now}-${conflicts.length}`,
      at: now,
      ...entry,
      kept: winnerLabel,
      lost: clone(loserValue),
      lostFrom: loserLabel
    })
  }

  // 三方合併一個值：回傳 { value, conflict }
  const merge3 = (baseValue, localValue, remoteValue, { log = true, onConflict } = {}) => {
    if (same(localValue, remoteValue)) return localValue
    if (same(localValue, baseValue)) return remoteValue
    if (same(remoteValue, baseValue)) return localValue
    const kept = winner === 'local' ? localValue : remoteValue
    const lost = winner === 'local' ? remoteValue : localValue
    if (log) onConflict?.(lost, kept)
    return kept
  }

  // ── 1. 節點存在與否 ──
  const allIds = new Set([...B.nodes.keys(), ...L.nodes.keys(), ...R.nodes.keys()])
  const modifiedSince = (side, id) => {
    const baseNode = B.nodes.get(id)
    const node = side.nodes.get(id)
    if (!node) return false
    if (!baseNode) return true
    return !same(node.fields, baseNode.fields) || node.parentId !== baseNode.parentId || !same(node.childIds, baseNode.childIds)
  }
  // 一邊刪掉、另一邊在它（或它的子孫）身上有修改 → 保留。先算出每邊「有修改的節點」。
  const touched = side => {
    const result = new Set()
    for (const id of side.nodes.keys()) if (modifiedSince(side, id)) result.add(id)
    return result
  }
  const localTouched = touched(L)
  const remoteTouched = touched(R)

  const survives = new Map()
  for (const id of allIds) {
    if (id === rootId) { survives.set(id, true); continue }
    const inB = B.nodes.has(id)
    const inL = L.nodes.has(id)
    const inR = R.nodes.has(id)
    if (inL && inR) survives.set(id, true)
    else if (!inB) survives.set(id, inL || inR) // 一邊新增
    else if (!inL && !inR) survives.set(id, false) // 兩邊都刪
    else if (!inL) survives.set(id, remoteTouched.has(id) ? 'kept-remote-edit' : false)
    else survives.set(id, localTouched.has(id) ? 'kept-local-edit' : false)
  }
  // 被保留的節點，其祖先鏈上被刪的節點不必復活：之後會掛到最近仍存在的祖先。
  const exists = id => Boolean(survives.get(id))
  for (const [id, state] of survives) {
    if (typeof state === 'string') {
      const deletedBy = state === 'kept-remote-edit' ? localLabel : remoteLabel
      record({ type: 'kept-deleted-node', nodeId: id, field: 'node', note: `${deletedBy}刪除了這個節點，但另一邊修改過，所以保留` }, null)
    }
  }

  // ── 2. 欄位 ──
  const mergedFields = new Map()
  for (const id of allIds) {
    if (!exists(id)) continue
    const b = B.nodes.get(id)?.fields
    const l = L.nodes.get(id)?.fields
    const r = R.nodes.get(id)?.fields
    if (!l || !r) {
      // 只有一邊有（新增、或刪除對上修改時保留的那一邊）
      mergedFields.set(id, clone(l || r))
      continue
    }
    const out = {}
    for (const key of fieldKeys(b, l, r)) {
      const bv = b?.[key]
      const lv = l[key]
      const rv = r[key]
      if (key === 'icons') {
        out.icons = mergeIconSets(bv || [], lv || [], rv || [])
        continue
      }
      if (key === 'collapsed') {
        out.collapsed = merge3(bv, lv, rv, { log: false })
        continue
      }
      out[key] = merge3(bv, lv, rv, {
        onConflict: lost => record({ type: 'field', nodeId: id, field: key }, lost)
      })
    }
    mergedFields.set(id, out)
  }

  // ── 3. 父節點 ──
  const parentOf = new Map()
  const moveSource = new Map()
  for (const id of allIds) {
    if (!exists(id) || id === rootId) continue
    const bp = B.nodes.get(id)?.parentId
    const lp = L.nodes.get(id)?.parentId
    const rp = R.nodes.get(id)?.parentId
    let parent
    if (lp === undefined) parent = rp
    else if (rp === undefined) parent = lp
    else {
      parent = merge3(bp, lp, rp, {
        onConflict: lost => record({ type: 'move', nodeId: id, field: 'parent' }, lost)
      })
    }
    moveSource.set(id, parent === lp && lp !== bp ? 'local' : parent === rp && rp !== bp ? 'remote' : 'base')
    parentOf.set(id, parent)
  }
  // 父節點已不存在 → 往上找最近仍存在的祖先（依提供這個節點的那一邊的樹）
  const ancestorsIn = (side, id) => {
    const chain = []
    let current = side.nodes.get(id)?.parentId
    while (current) {
      chain.push(current)
      current = side.nodes.get(current)?.parentId
    }
    return chain
  }
  for (const [id, parent] of parentOf) {
    if (exists(parent)) continue
    const candidates = [...ancestorsIn(L, id), ...ancestorsIn(R, id), ...ancestorsIn(B, id)]
    const fallback = candidates.find(candidate => exists(candidate)) ?? rootId
    parentOf.set(id, fallback)
    record({ type: 'reparented', nodeId: id, field: 'parent', note: '原本的父節點已被刪除，改掛到最近的上層節點' }, parent)
  }
  // 循環：撤銷輸方的移動（改回 base 的父節點，不行就掛到 root）
  const loser = winner === 'local' ? 'remote' : 'local'
  for (let guard = 0; guard < allIds.size + 1; guard += 1) {
    const cycleNode = findCycleNode(parentOf, rootId)
    if (!cycleNode) break
    const cycle = cycleMembers(parentOf, cycleNode)
    const victim = cycle.find(id => moveSource.get(id) === loser) ?? cycle[0]
    const baseParent = B.nodes.get(victim)?.parentId
    parentOf.set(victim, baseParent && exists(baseParent) && !wouldCycle(parentOf, victim, baseParent, rootId) ? baseParent : rootId)
    moveSource.set(victim, 'base')
    record({ type: 'move-cycle', nodeId: victim, field: 'parent', note: '兩邊的移動會形成循環，撤銷了其中一個' }, null)
  }

  // ── 4. 子節點順序 ──
  const childrenOf = new Map([[rootId, []]])
  for (const [id, parent] of parentOf) {
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(id)
  }
  const orderedChildren = parentId => {
    const members = new Set(childrenOf.get(parentId) || [])
    if (!members.size) return []
    const bo = B.nodes.get(parentId)?.childIds || []
    const lo = L.nodes.get(parentId)?.childIds || []
    const ro = R.nodes.get(parentId)?.childIds || []
    let primary
    let secondary
    if (same(lo, bo)) { primary = ro; secondary = lo }
    else if (same(ro, bo)) { primary = lo; secondary = ro }
    else if (winner === 'local') { primary = lo; secondary = ro }
    else { primary = ro; secondary = lo }
    const result = []
    const seen = new Set()
    const push = id => {
      if (members.has(id) && !seen.has(id)) { seen.add(id); result.push(id) }
    }
    primary.forEach(push)
    // 另一邊有、勝方沒有的（例如另一邊新增的）：插在它在另一邊的前一個兄弟之後
    secondary.forEach((id, index) => {
      if (seen.has(id) || !members.has(id)) return
      const previous = secondary.slice(0, index).reverse().find(candidate => seen.has(candidate))
      const at = previous ? result.indexOf(previous) + 1 : 0
      result.splice(at, 0, id)
      seen.add(id)
    })
    // 從別的父節點移進來的
    ;[...members].filter(id => !seen.has(id)).sort().forEach(push)
    return result
  }

  // ── 5. 組回樹 ──
  const build = id => {
    const fields = mergedFields.get(id)
    if (!fields) throw new MergeError(`Missing fields for ${id}`)
    const style = {}
    for (const key of Object.keys(fields)) {
      if (key.startsWith('style.') && fields[key] !== undefined) style[key.slice(6)] = fields[key]
    }
    const icons = [...(fields.icons || [])]
    if (fields.floating) icons.push(fields.floating)
    return {
      id,
      text: fields.text?.text ?? '',
      children: orderedChildren(id).map(build),
      collapsed: Boolean(fields.collapsed),
      side: fields.side ?? null,
      style,
      richText: fields.text?.richText ?? null,
      notes: fields.notes ?? null,
      link: fields.link ?? null,
      icons,
      image: fields.image ?? null
    }
  }
  const root = build(rootId)
  const builtCount = countNodes(root)
  const expected = [...allIds].filter(exists).length
  if (builtCount !== expected) throw new MergeError(`Merged tree lost nodes (${builtCount}/${expected})`)

  // ── 6. 文件層級欄位 ──
  const doc = {}
  for (const key of Object.keys(winner === 'local' ? local : remote)) {
    if (!['root', 'relations', 'summaries', 'canvas', 'conflicts', ...DOC_SCALAR_KEYS].includes(key)) {
      doc[key] = clone((winner === 'local' ? local : remote)[key])
    }
  }
  for (const key of DOC_SCALAR_KEYS) {
    const value = merge3(base?.[key], local[key], remote[key], {
      onConflict: lost => record({ type: 'doc', field: key }, lost)
    })
    if (value !== undefined) doc[key] = clone(value)
  }
  const canvas = {}
  for (const key of CANVAS_KEYS) {
    const value = merge3(base?.canvas?.[key], local.canvas?.[key], remote.canvas?.[key], {
      onConflict: lost => record({ type: 'doc', field: `canvas.${key}` }, lost)
    })
    if (value !== undefined) canvas[key] = clone(value)
  }
  if (Object.keys(canvas).length || local.canvas || remote.canvas) doc.canvas = canvas
  doc.root = root

  // ── 7. 關聯線與概要（依 id） ──
  const finalIds = new Set([...allIds].filter(exists))
  doc.relations = mergeById('relation', base?.relations, local.relations, remote.relations, merge3, record)
    .filter(item => {
      const ok = finalIds.has(item.fromId) && finalIds.has(item.toId)
      if (!ok) record({ type: 'dangling', field: 'relation', note: '關聯線的端點已被刪除' }, item)
      return ok
    })
  doc.summaries = mergeById('summary', base?.summaries, local.summaries, remote.summaries, merge3, record)
    .filter(item => {
      const refs = [item.parentId, item.startNodeId, item.endNodeId].filter(value => value !== undefined)
      const ok = refs.every(ref => finalIds.has(ref))
      if (!ok) record({ type: 'dangling', field: 'summary', note: '概要引用的節點已被刪除' }, item)
      return ok
    })

  // ── 8. 衝突紀錄（兩邊既有的聯集＋這次新增的，保留最新的 MAX_CONFLICT_LOG 筆） ──
  const previous = new Map()
  for (const entry of [...(Array.isArray(local.conflicts) ? local.conflicts : []), ...(Array.isArray(remote.conflicts) ? remote.conflicts : [])]) {
    if (isObject(entry) && typeof entry.id === 'string') previous.set(entry.id, entry)
  }
  const log = [...previous.values(), ...conflicts].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)))
  const trimmed = log.slice(-MAX_CONFLICT_LOG)
  if (trimmed.length) doc.conflicts = trimmed
  return { doc, conflicts }
}

function mergeById(kind, baseList, localList, remoteList, merge3, record) {
  const index = list => new Map((Array.isArray(list) ? list : []).filter(item => isObject(item) && typeof item.id === 'string').map(item => [item.id, item]))
  const B = index(baseList)
  const L = index(localList)
  const R = index(remoteList)
  const order = [...L.keys(), ...[...R.keys()].filter(id => !L.has(id))]
  const result = []
  for (const id of order) {
    const b = B.get(id)
    const l = L.get(id)
    const r = R.get(id)
    if (l && r) {
      result.push(clone(merge3(b, l, r, { onConflict: lost => record({ type: kind, itemId: id, field: kind }, lost) })))
    } else if (!b) {
      result.push(clone(l || r)) // 一邊新增
    } else {
      // 一邊刪除：另一邊沒改就刪，改過就保留
      const kept = l || r
      if (!same(kept, b)) {
        result.push(clone(kept))
        record({ type: `${kind}-kept`, itemId: id, field: kind, note: '一邊刪除、另一邊修改，保留修改後的版本' }, null)
      }
    }
  }
  return result
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((sum, child) => sum + countNodes(child), 0)
}

function findCycleNode(parentOf, rootId) {
  for (const start of parentOf.keys()) {
    const seen = new Set()
    let current = start
    while (current && current !== rootId) {
      if (seen.has(current)) return current
      seen.add(current)
      current = parentOf.get(current)
    }
  }
  return null
}

function cycleMembers(parentOf, start) {
  const members = [start]
  let current = parentOf.get(start)
  while (current && current !== start) {
    members.push(current)
    current = parentOf.get(current)
  }
  return members
}

function wouldCycle(parentOf, id, newParent, rootId) {
  let current = newParent
  const seen = new Set()
  while (current && current !== rootId) {
    if (current === id || seen.has(current)) return true
    seen.add(current)
    current = parentOf.get(current)
  }
  return false
}
