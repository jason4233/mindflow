/**
 * 全站繁體中文 UI 字串；其他模組不得散落可見文案。
 */
export const strings = Object.freeze({
  productName: 'MindFlow',
  themes: {
    classicBlue: '經典藍'
  },
  commands: {
    addChild: '新增子節點',
    addSiblingBefore: '新增上方同級節點',
    addSiblingAfter: '新增下方同級節點',
    pasteSubtrees: '貼上子樹',
    deleteNodes: '刪除節點',
    updateText: '編輯節點文字',
    moveNode: '移動節點',
    toggleCollapse: '切換摺疊',
    setStyle: '設定節點樣式',
    updateDocumentTitle: '重新命名文件'
  },
  dashboard: {
    newDocument: '新建心智圖',
    myDocuments: '我的導圖',
    empty: '尚無文件，建立第一張心智圖開始編輯。',
    open: '開啟',
    rename: '重新命名',
    remove: '刪除',
    updatedAt: '更新於 {time}',
    renamePrompt: '輸入新的文件名稱',
    deleteConfirm: '確定刪除「{title}」？此操作無法復原。',
    untitled: '未命名心智圖'
  },
  editor: {
    back: '←',
    backLabel: '返回首頁',
    undo: '↶',
    undoLabel: '復原',
    redo: '↷',
    redoLabel: '重做',
    addChild: '插入子節點',
    addSibling: '插入同級節點',
    style: '樣式',
    export: '匯出',
    close: '×',
    closePanel: '關閉面板',
    stylePlaceholder: '樣式控制將於後續階段加入',
    zoomIn: '+',
    zoomOut: '−',
    fit: '適應',
    fitLabel: '適應畫布',
    zoomReset: '重設縮放',
    collapse: '摺疊節點',
    expand: '展開節點',
    newTopic: '新主題',
    centerTopic: '中心主題',
    branchTopic: '分支主題',
    loadFailed: '找不到文件，已建立新文件。'
  }
})

export function formatString(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))
}
