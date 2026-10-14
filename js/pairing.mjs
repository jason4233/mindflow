/**
 * 電腦→手機的同步配對碼：`mindflow-pair:` 加上一段 JSON（repo、branch、PAT）。
 * 電腦版只在使用者按下按鈕時，於獨立視窗顯示成 QR；手機掃描（或貼上）後直接存進安全儲存。
 * 配對碼含 PAT，等同密碼：只在私下掃描，不寫進 log、不放進主視窗 renderer。
 */
export const PAIRING_PREFIX = 'mindflow-pair:'
export const PAIRING_VERSION = 1
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/u
const TOKEN_PATTERN = /^[\x21-\x7e]{20,255}$/u

export class PairingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PairingError'
  }
}

export function encodePairingPayload({ repo, branch = 'main', token } = {}) {
  const value = validate({ repo, branch, token })
  return `${PAIRING_PREFIX}${JSON.stringify({ v: PAIRING_VERSION, repo: value.repo, branch: value.branch, token: value.token })}`
}

export function isPairingPayload(text) {
  return typeof text === 'string' && text.trim().startsWith(PAIRING_PREFIX)
}

/** 解析掃到或貼上的配對碼；格式不對時丟出可直接顯示給使用者的 PairingError（訊息絕不含 PAT）。 */
export function decodePairingPayload(text) {
  if (!isPairingPayload(text)) throw new PairingError('這不是 MindFlow 的配對 QR。請在電腦版「同步設定」按「在手機上配對」顯示的 QR。')
  let parsed
  try {
    parsed = JSON.parse(text.trim().slice(PAIRING_PREFIX.length))
  } catch {
    throw new PairingError('配對 QR 內容不完整，請在電腦上重新顯示後再掃一次。')
  }
  if (!parsed || typeof parsed !== 'object') throw new PairingError('配對 QR 內容不完整，請在電腦上重新顯示後再掃一次。')
  if (parsed.v !== PAIRING_VERSION) throw new PairingError('這個配對 QR 來自不同版本的 MindFlow，請把電腦與手機都更新到最新版。')
  return validate(parsed)
}

function validate({ repo, branch, token }) {
  const cleanRepo = typeof repo === 'string' ? repo.trim() : ''
  const cleanBranch = typeof branch === 'string' && branch.trim() ? branch.trim() : 'main'
  const cleanToken = typeof token === 'string' ? token.trim() : ''
  if (!REPO_PATTERN.test(cleanRepo)) throw new PairingError('配對資料裡的 GitHub repo 格式不正確。')
  if (!BRANCH_PATTERN.test(cleanBranch) || cleanBranch.includes('..')) throw new PairingError('配對資料裡的分支名稱不正確。')
  if (!TOKEN_PATTERN.test(cleanToken)) throw new PairingError('配對資料裡的 PAT 不完整，請在電腦上重新設定 PAT 後再試。')
  return { repo: cleanRepo, branch: cleanBranch, token: cleanToken }
}
