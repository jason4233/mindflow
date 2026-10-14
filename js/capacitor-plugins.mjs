/**
 * 取用 Capacitor 原生外掛的共用入口（零打包：只透過 window.Capacitor 的 proxy，不 import npm 套件）。
 * 外掛沒裝在這一版 APK 裡時回傳 null，呼叫端照常運作、只是少了該功能。
 */
import { isNativeCapacitor } from './sync-mobile.mjs'

export function getCapacitorPlugin(name, methods = [], windowRef = globalThis.window) {
  if (!isNativeCapacitor(windowRef)) return null
  const capacitor = windowRef.Capacitor
  try {
    // registerPlugin 的 proxy 對任何方法名都會回傳函式；先問原生端是否真的有這個外掛。
    if (typeof capacitor.isPluginAvailable === 'function' && !capacitor.isPluginAvailable(name)) return null
    const existing = capacitor.Plugins?.[name]
    if (hasMethods(existing, methods)) return existing
    if (typeof capacitor.registerPlugin !== 'function') return null
    const plugin = capacitor.registerPlugin(name)
    return hasMethods(plugin, methods) ? plugin : null
  } catch {
    return null
  }
}

function hasMethods(value, methods) {
  return Boolean(value) && methods.every(method => typeof value[method] === 'function')
}
