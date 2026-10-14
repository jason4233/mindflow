/**
 * 混合邏輯時鐘（HLC）：手機與電腦的系統時間可能差幾秒到幾分鐘，HLC 保證先後順序一致。
 * 序列化成 `<13 位毫秒>-<4 位十六進位計數>-<裝置 id>`，可直接用字串比較大小。
 */
const WALL_DIGITS = 13
const COUNTER_DIGITS = 4
const MAX_COUNTER = 0xffff
const NODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u
const HLC_PATTERN = /^(\d{13})-([0-9a-f]{4})-([A-Za-z0-9._-]{1,64})$/u
// 對方時鐘比我們快太多（例如時間設錯成明年）時不跟著跳過去，否則之後所有本機修改都會輸。
export const MAX_DRIFT_MS = 24 * 60 * 60_000

export function parseHlc(value) {
  const match = HLC_PATTERN.exec(String(value || ''))
  if (!match) return null
  return { wall: Number(match[1]), counter: parseInt(match[2], 16), node: match[3] }
}

export function formatHlc({ wall, counter, node }) {
  return `${String(Math.max(0, Math.trunc(wall))).padStart(WALL_DIGITS, '0')}-${counter.toString(16).padStart(COUNTER_DIGITS, '0')}-${node}`
}

export function isHlc(value) {
  return parseHlc(value) !== null
}

/** 字串比較就是時間先後；無效值排最前面。 */
export function compareHlc(left, right) {
  const a = isHlc(left) ? left : ''
  const b = isHlc(right) ? right : ''
  return a < b ? -1 : a > b ? 1 : 0
}

export function maxHlc(...values) {
  return values.filter(isHlc).sort(compareHlc).at(-1) || null
}

/**
 * @param {object} options
 * @param {string} options.node   裝置 id（machineId）
 * @param {string|null} [options.last]  上次保存的時鐘值
 * @param {() => number} [options.wallClock]
 */
export function createHlcClock({ node, last = null, wallClock = () => Date.now() } = {}) {
  if (!NODE_PATTERN.test(String(node || ''))) throw new TypeError('HLC node id must match [A-Za-z0-9._-]{1,64}')
  let state = parseHlc(last) || { wall: 0, counter: 0, node }
  state = { ...state, node }

  function advance(wall, counter) {
    if (counter > MAX_COUNTER) {
      // 同一毫秒內超過 65535 次：借用下一毫秒，維持嚴格遞增。
      wall += 1
      counter = 0
    }
    state = { wall, counter, node }
    return formatHlc(state)
  }

  return Object.freeze({
    /** 本機事件：取得一個比之前所有值都大的時間戳。 */
    now() {
      const physical = wallClock()
      if (physical > state.wall) return advance(physical, 0)
      return advance(state.wall, state.counter + 1)
    },
    /**
     * 替「過去某個時間點發生的本機事件」蓋章（例如文件的 updatedAt）：
     * 時間取事件當下，但一定大於這台裝置之前發出或看過的所有時間戳（保持因果順序）。
     */
    stamp(eventWall) {
      const physical = wallClock()
      const wall = Number.isFinite(eventWall) ? Math.min(Math.trunc(eventWall), physical + MAX_DRIFT_MS) : physical
      if (wall > state.wall) return advance(wall, 0)
      return advance(state.wall, state.counter + 1)
    },
    /** 收到遠端時間戳：讓本機時鐘不落後於它（忽略離譜的未來值）。 */
    receive(remote) {
      const parsed = parseHlc(remote)
      if (!parsed) return formatHlc(state)
      const physical = wallClock()
      if (parsed.wall > physical + MAX_DRIFT_MS) return formatHlc(state)
      const wall = Math.max(state.wall, parsed.wall, physical)
      let counter
      if (wall === state.wall && wall === parsed.wall) counter = Math.max(state.counter, parsed.counter) + 1
      else if (wall === state.wall) counter = state.counter + 1
      else if (wall === parsed.wall) counter = parsed.counter + 1
      else counter = 0
      return advance(wall, counter)
    },
    current() {
      return formatHlc(state)
    }
  })
}
