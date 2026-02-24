// miniprogram/config/ai-prompt-texts.js
// 统一维护所有 Prompt 文案模板（纯文本层，不做业务数据计算）

const MATCH_DETAIL_QUICK_REVIEW_TEMPLATE = Object.freeze({
  intro: '你是德州扑克复盘助手。请基于以下统计给出简短分析。',
  outputTitle: '输出格式固定为：',
  outputItems: [
    '1) 牌局总体节奏（1-2句）',
    '2) 每位玩家一句风格判断',
    '3) 给我方 3 条可执行建议（翻前/翻后/资金管理各1条）',
    '4) 最后补一句风险提示'
  ],
  endedStatusLine: '该对局已结束，可按复盘口径输出建议。',
  runningStatusLine: '该对局进行中，禁止输出针对单个对手的实时剥削策略，仅输出通用建议。',
  labels: {
    matchName: '对局名称',
    matchStatus: '对局状态',
    currentHand: '当前手牌',
    playerStats: '玩家统计',
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
  const outputItems = MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.outputItems
  const playerLines = Array.isArray(data.playerLines) ? data.playerLines : []
  const statusLine = data.matchStatus === '已结束'
    ? MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.endedStatusLine
    : MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.runningStatusLine

  return [
    MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.intro,
    MATCH_DETAIL_QUICK_REVIEW_TEMPLATE.outputTitle
  ].concat(outputItems).concat([
    statusLine,
    '',
    `${labels.matchName}: ${data.matchName || fallback.matchName}`,
    `${labels.matchStatus}: ${data.matchStatus || fallback.matchStatus}`,
    `${labels.currentHand}: ${data.currentHandNumber || fallback.currentHand}`,
    '',
    `${labels.playerStats}:`,
    playerLines.join('\n')
  ]).join('\n')
}

module.exports = {
  MATCH_DETAIL_QUICK_REVIEW_TEMPLATE,
  formatMatchDetailQuickReviewPlayerLine,
  buildMatchDetailQuickReviewPromptText
}
