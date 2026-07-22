/** 原創繁中範本；themeId 直接從 themes.js 可用清單輪替，避免跨工作流硬編碼。 */
import { createDefaultDoc, createNode } from './editor/model.js'
import { themes } from './editor/themes.js'

export const TEMPLATE_CATEGORIES = Object.freeze([
  { id: 'education', name: '教育學習' },
  { id: 'web-tools', name: '網站工具' },
  { id: 'life', name: '生活娛樂' },
  { id: 'industry', name: '行業分類' },
  { id: 'personal', name: '個人規劃' },
  { id: 'reading', name: '讀書筆記' },
  { id: 'business', name: '商務職場' },
  { id: 'genealogy', name: '家譜族譜' }
])

const availableThemeIds = Object.keys(themes)
const themeAt = index => availableThemeIds[index % Math.max(availableThemeIds.length, 1)] || 'classic-blue'

const definitions = [
  template('exam-review', '考試複習作戰圖', 'education', '把章節、題型與複習節奏收斂成一張圖', [
    branch('考試範圍', ['第一單元核心概念', '第二單元公式', '老師補充講義']),
    branch('題型拆解', ['選擇題易錯點', '申論題答題骨架', '計算題檢查步驟']),
    branch('三輪複習', ['第一輪建立理解', '第二輪限時練習', '第三輪錯題回看']),
    branch('考前確認', ['文具與證件', '睡眠安排', '進場時間'])
  ]),
  template('semester-learning', '學期學習導航', 'education', '安排課程目標、作業與每月里程碑', [
    branch('學習目標', ['能獨立解題', '完成主題報告', '建立長期筆記']),
    branch('每週節奏', ['課前預習 20 分鐘', '課後整理疑問', '週末統整']),
    branch('重要時程', ['期中報告', '小組發表', '期末考']),
    branch('支援資源', ['助教時間', '同儕讀書會', '線上題庫'])
  ]),
  template('website-blueprint', '內容網站藍圖', 'web-tools', '從受眾需求規劃網站資訊架構', [
    branch('首頁', ['核心價值主張', '主要行動按鈕', '信任證據']),
    branch('內容中心', ['入門指南', '案例解析', '常見問題']),
    branch('轉換路徑', ['訂閱電子報', '預約諮詢', '下載資源']),
    branch('量測', ['搜尋流量', '內容互動', '轉換率'])
  ]),
  template('tool-selection', '數位工具選型矩陣', 'web-tools', '用需求、成本與整合難度比較候選工具', [
    branch('必要需求', ['多人協作', '版本紀錄', '權限管理']),
    branch('評估面向', ['總持有成本', '學習曲線', '資料可攜性']),
    branch('試用任務', ['匯入真實資料', '模擬交接', '測試行動版']),
    branch('決策紀錄', ['選擇理由', '未選風險', '三個月回顧'])
  ]),
  template('travel-plan', '旅行計畫地圖', 'life', '把交通、景點、預算與備案放在同一張圖', [
    branch('行程節奏', ['抵達日慢遊', '主題探索日', '返程緩衝']),
    branch('交通', ['機場往返', '城市移動', '末班車時間']),
    branch('想去清單', ['在地市場', '特色建築', '夕陽景點']),
    branch('風險備案', ['雨天替代', '緊急聯絡', '旅平險資料'])
  ]),
  template('weekend-gathering', '週末聚會企劃', 'life', '快速協調人員、餐食、活動與收尾', [
    branch('參與者', ['確認人數', '飲食禁忌', '交通方式']),
    branch('餐食', ['主餐分工', '飲料冰塊', '甜點水果']),
    branch('活動', ['暖場話題', '桌遊備選', '合照時間']),
    branch('收尾', ['垃圾分類', '物品認領', '費用結算'])
  ]),
  template('service-launch', '服務上線檢核', 'industry', '跨部門確認服務正式上線前的依賴', [
    branch('產品', ['核心流程驗收', '例外情境', '操作說明']),
    branch('營運', ['客服話術', '排班與升級', '回報管道']),
    branch('行銷', ['受眾訊息', '素材版本', '發布節奏']),
    branch('風險', ['回滾條件', '監控指標', '決策窗口'])
  ]),
  template('customer-journey', '顧客旅程觀察圖', 'industry', '從認識到回購整理接觸點與改善機會', [
    branch('認識', ['搜尋需求', '朋友推薦', '社群內容']),
    branch('評估', ['比較方案', '閱讀評價', '諮詢問題']),
    branch('購買', ['付款阻力', '到貨期待', '首次使用']),
    branch('留存', ['成效追蹤', '主動關懷', '回購提醒'])
  ]),
  template('weekly-plan', '一週行動計畫', 'personal', '用成果、時段與精力安排可執行的一週', [
    branch('本週三成果', ['完成主要提案', '處理關鍵溝通', '保留恢復時間']),
    branch('深度工作', ['週一規劃', '週三製作', '週五收斂']),
    branch('例行任務', ['行政批次', '訊息時段', '資料備份']),
    branch('週末回顧', ['完成了什麼', '卡點是什麼', '下週先做什麼'])
  ]),
  template('annual-compass', '年度方向羅盤', 'personal', '讓年度主題連到季度成果與日常習慣', [
    branch('年度主題', ['希望成為的狀態', '停止投入的事情', '衡量原則']),
    branch('四季成果', ['第一季打底', '第二季擴張', '第三季優化', '第四季收成']),
    branch('支持習慣', ['每週回顧', '固定留白', '每月整理']),
    branch('關係與健康', ['重要的人', '身體指標', '休息安排'])
  ]),
  template('deep-reading', '深度讀書筆記', 'reading', '從作者問題意識一路整理到自己的行動', [
    branch('作者在回答什麼', ['核心問題', '時代背景', '預設讀者']),
    branch('關鍵論點', ['主張一', '主張二', '主張三']),
    branch('證據與例子', ['最有力證據', '可疑假設', '反例']),
    branch('我的轉化', ['一句話摘要', '可套用情境', '下一個實驗'])
  ]),
  template('book-club', '讀書會討論圖', 'reading', '準備開場、深問與會後延伸', [
    branch('快速開場', ['每人一句感受', '最意外段落', '閱讀困難']),
    branch('討論主軸', ['同意的觀點', '想挑戰的觀點', '與現況連結']),
    branch('深入追問', ['如果條件相反', '誰會不同意', '代價是什麼']),
    branch('會後延伸', ['共同行動', '推薦閱讀', '下次主持'])
  ]),
  template('project-plan', '專案規劃全景圖', 'business', '把目標、範圍、里程碑與風險對齊', [
    branch('成功定義', ['目標結果', '驗收指標', '不做清單']),
    branch('工作流', ['探索與確認', '製作與整合', '驗收與交付']),
    branch('角色', ['決策者', '負責人', '協作者']),
    branch('風險', ['需求漂移', '關鍵依賴', '時程緩衝'])
  ]),
  template('meeting-notes', '會議記錄決策圖', 'business', '讓討論、決策與待辦不再混在一起', [
    branch('會議目標', ['今天要決定', '只需同步', '暫不處理']),
    branch('討論摘要', ['已知事實', '主要分歧', '待驗證假設']),
    branch('決策', ['採用方案', '理由', '生效時間']),
    branch('行動項目', ['負責人', '截止日', '回報方式'])
  ]),
  template('swot-action', 'SWOT 行動分析', 'business', '不只列四象限，直接連到下一步策略', [
    branch('優勢 Strengths', ['獨特能力', '現有資源', '信任基礎']),
    branch('劣勢 Weaknesses', ['能力缺口', '流程瓶頸', '依賴風險']),
    branch('機會 Opportunities', ['需求變化', '新通路', '合作可能']),
    branch('威脅 Threats', ['競爭動向', '成本變化', '法規不確定']),
    branch('策略行動', ['用優勢搶機會', '補弱點避威脅', '設定觀察指標'])
  ]),
  template('family-tree', '三代家譜', 'genealogy', '以家庭核心向上追溯、向下延伸三代', [
    branch('祖父母家系', ['祖父', '祖母', '重要家族故事']),
    branch('外祖父母家系', ['外祖父', '外祖母', '重要家族故事']),
    branch('父母與手足', ['父親', '母親', '兄弟姊妹']),
    branch('下一代', ['子女', '重要日期', '共同記憶'])
  ]),
  template('family-stories', '家族故事採集', 'genealogy', '用人物、年代、地點與物件保存口述歷史', [
    branch('受訪人物', ['與我的關係', '成長地', '代表性格']),
    branch('人生節點', ['童年記憶', '重要選擇', '家庭轉折']),
    branch('時代背景', ['當時工作', '交通與生活', '地方變化']),
    branch('留存素材', ['老照片', '信件文件', '聲音錄音'])
  ])
]

export const MIND_FLOW_TEMPLATES = Object.freeze(definitions.map((item, index) => Object.freeze({
  ...item,
  themeId: themeAt(index)
})))

export function getTemplateById(id) {
  return MIND_FLOW_TEMPLATES.find(item => item.id === id) || null
}

export function createDocumentFromTemplate(id) {
  const selected = getTemplateById(id)
  if (!selected) return null
  const root = createNode(selected.title, {
    children: selected.branches.map((item, index) => nodeFromBranch(item, index, true))
  })
  return createDefaultDoc({ title: selected.title, root, themeId: selected.themeId })
}

function nodeFromBranch(item, index, topLevel = false) {
  return createNode(item.text, {
    side: topLevel ? (index % 2 ? 'left' : 'right') : null,
    children: item.children.map((child, childIndex) => nodeFromBranch(child, childIndex))
  })
}

function template(id, title, categoryId, description, branches) {
  return { id, title, categoryId, description, branches }
}

function branch(text, children = []) {
  return {
    text,
    children: children.map(child => typeof child === 'string' ? branch(child) : child)
  }
}
