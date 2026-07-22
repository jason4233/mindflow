/**
 * 編輯器 action registry：快捷鍵只認 action 名稱，各功能模組自行註冊實作。
 */

const registry = new Map()

export function registerAction(name, fn) {
  const key = String(name || '').trim()
  if (!key) throw new TypeError('Action 名稱不可為空')
  if (typeof fn !== 'function') throw new TypeError(`Action「${key}」必須是函式`)
  registry.set(key, fn)

  // 回傳精確對應本次註冊的清理函式，避免舊模組卸載時誤刪後來覆寫的 action。
  return () => {
    if (registry.get(key) === fn) registry.delete(key)
  }
}

export function runAction(name, ...args) {
  const action = registry.get(String(name || '').trim())
  return action ? action(...args) : false
}

export function hasAction(name) {
  return registry.has(String(name || '').trim())
}

export function getRegisteredActionNames() {
  return Array.from(registry.keys())
}
