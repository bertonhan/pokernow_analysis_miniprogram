// miniprogram/config/ai-prompt-texts.js
// 统一维护所有 Prompt 文案模板（纯文本层，不做业务数据计算）

const MATCH_DETAIL_QUICK_REVIEW_TEMPLATE = Object.freeze({
  role: '你是德州扑克职业选手与复盘教练，精通 GTO 和剥削策略。请使用中文输出，语言要专业、简洁、可执行。',
  rulesTitle: '执行规则（必须遵守）：',
  rules: [
    '先依据 userMatchData.currentUser.inMatch 判断当前登录用户是否在该对局中。',
    '再依据 userMatchData.isEnded 判断对局是否已结束。',
    '优先使用 userMatchData.handFacts.userHands 与 userMatchData.handFacts.showdownHands 做分析。',
    '若当前用户不在局中，跳过“当前用户个人手牌”分析，只做对局层面的判断与建议。',
    '若样本不足 20 手，必须明确提示“样本偏小，结论置信度有限”。',
    '未结束对局给实时执行建议；已结束对局给复盘提升建议。'
  ],
  outputTitle: '输出格式固定为（严格按编号）：',
  outputItems: [
    '1) 牌局整体节奏与风格（1-2句）',
    '2) 每位玩家一句风格判断（逐行：玩家名：判断）',
    '3) 当前登录用户是否在局中 + 判断依据（1-2句）',
    '4) 三条可执行建议（翻前/翻后/资金管理各1条）',
    '5) 若对局未结束：补充每位玩家的实时剥削策略',
    '6) 若对局已结束：输出对局历程总结（含筹码变化）+ 5手关键手牌复盘点',
    '7) 最后一行补一句风险提示'
  ],
  endedStatusLine: '当前对局状态：已结束（复盘口径）。',
  runningStatusLine: '当前对局状态：未结束（实时口径）。',
  labels: {
    matchName: '对局名称',
    matchStatus: '对局状态',
    currentHand: '当前手牌',
    playerStats: '玩家统计速览',
    userContext: 'userMatchData（JSON）',
    net: '净胜',
    vpip: 'VPIP',
    pfr: 'PFR',
    af: 'AF',
    bet3: '3Bet',
    cbet: 'CBet',
    style: '风格'
  },
  fallback: {
    matchName: '-',
    matchStatus: '-',
    currentHand: '-',
    playerNamePrefix: '玩家',
    style: '暂无标签'
  }
})

function formatMatchDetailQuickReviewPlayerLine(player, index) {
  const one = player && typeof player === 'object' ? player : {}
  const labels = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.labels
  const fallback = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.fallback
  const playerName = one.playerName || `${fallback.playerNamePrefix}${index + 1}`
  const styleText = one.styleText || fallback.style

  return [
    `${index + 1}. ${playerName}`,
    `${labels.net}:${one.netDisplay}`,
    `${labels.vpip}:${one.vpip}%`,
    `${labels.pfr}:${one.pfr}%`,
    `${labels.af}:${one.af}`,
    `${labels.bet3}:${one.bet3}%`,
    `${labels.cbet}:${one.cbet}%`,
    `${labels.style}:${styleText}`
  ].join(' | ')
}

function buildMatchDetailQuickReviewPromptText(input) {
  const data = input && typeof input === 'object' ? input : {}
  const labels = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.labels
  const fallback = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.fallback
  const rules = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.rules
  const outputItems = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.outputItems
  const playerLines = Array.isArray(data.playerLines) ? data.playerLines : []
  const userMatchDataText = typeof data.userMatchDataText === 'string' ? data.userMatchDataText : ''
  const statusLine = data.matchStatus === '已结束'
    ? MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.endedStatusLine
    : MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.runningStatusLine

  const lines = [
    MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.role,
    '',
    MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.rulesTitle
  ]

  rules.forEach((rule, index) => {
    lines.push(`${index + 1}. ${rule}`)
  })

  lines.push('')
  lines.push(MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.outputTitle)
  outputItems.forEach(item => lines.push(item))
  lines.push('')
  lines.push(statusLine)
  lines.push('')
  lines.push(`${labels.matchName}: ${data.matchName || fallback.matchName}`)
  lines.push(`${labels.matchStatus}: ${data.matchStatus || fallback.matchStatus}`)
  lines.push(`${labels.currentHand}: ${data.currentHandNumber || fallback.currentHand}`)
  lines.push('')
  lines.push(`${labels.playerStats}:`)
  lines.push(playerLines.join('\n'))
  lines.push('')
  lines.push(`${labels.userContext}:`)
  lines.push(userMatchDataText)

  return lines.join('\n')
}

module.exports = {
  MATCH_DETAIL_QUICK_REVIEW_TEMPLATE,
  formatMatchDetailQuickReviewPlayerLine,
  buildMatchDetailQuickReviewPromptText
}
