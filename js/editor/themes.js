/**
 * 資料驅動的主題定義；渲染器只讀主題，不硬編碼節點層級外觀。
 */
import { strings } from '../strings.js'

export const themes = Object.freeze({
  'classic-blue': Object.freeze({
    id: 'classic-blue',
    name: strings.themes.classicBlue,
    branchPalette: ['#3f89de', '#5ba8a0', '#e69b45', '#8c74c9', '#dc6d7a', '#6e9f4f'],
    root: Object.freeze({
      fill: '#3f89de',
      textColor: '#ffffff',
      borderColor: '#3f89de',
      borderWidth: 0,
      borderStyle: 'solid',
      fontSize: 16,
      fontFamily: 'Inter, "Segoe UI", "Noto Sans TC", sans-serif',
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      shape: 'rounded',
      paddingX: 20,
      paddingY: 12,
      lineColor: '#7aa9dc',
      lineWidth: 2,
      lineStyle: 'solid'
    }),
    branch: Object.freeze({
      fill: '#ffffff',
      textColor: '#364152',
      borderColor: '#cbd4df',
      borderWidth: 1,
      borderStyle: 'solid',
      fontSize: 14,
      fontFamily: 'Inter, "Segoe UI", "Noto Sans TC", sans-serif',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      shape: 'rounded',
      paddingX: 14,
      paddingY: 8,
      lineColor: '#3f89de',
      lineWidth: 2,
      lineStyle: 'solid'
    }),
    leaf: Object.freeze({
      fill: 'transparent',
      textColor: '#364152',
      borderColor: 'transparent',
      borderWidth: 0,
      borderStyle: 'solid',
      fontSize: 13,
      fontFamily: 'Inter, "Segoe UI", "Noto Sans TC", sans-serif',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      shape: 'underline',
      paddingX: 4,
      paddingY: 5,
      lineColor: '#3f89de',
      lineWidth: 2,
      lineStyle: 'solid'
    })
  })
})

export function getTheme(themeId) {
  return themes[themeId] || themes['classic-blue']
}

export function getNodeAppearance(node, depth, theme) {
  const base = depth === 0 ? theme.root : depth === 1 ? theme.branch : theme.leaf
  return { ...base, ...node.style }
}
