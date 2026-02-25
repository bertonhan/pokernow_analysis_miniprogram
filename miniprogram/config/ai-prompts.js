// miniprogram/config/ai-prompts.js
// 所有页面点击触发的 user prompt 都在这里集中维护

const { AI_PROMPT_SCENES } = require('./ai-agent')
const {
  buildMatchDetailQuickReviewPromptText,
  formatMatchDetailQuickReviewPlayerLine
} = require('./ai-prompt-texts')

const PROMPT_USER_HAND_LIMIT = 24
const PROMPT_SHOWDOWN_HAND_LIMIT = 20
const PROMPT_PLAYER_STAT_LIMIT = 10
const PROMPT_JSON_SOFT_LIMIT = 12000

function toSafeNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function safeJsonStringify(value, fallback) {
  try {
    const text = JSON.stringify(value, null, 2)
    return typeof text === 'string' ? text : fallback
  } catch (err) {
    return fallback
  }
}

function simplifyHandPlayerForPrompt(player) {
  const one = player && typeof player === 'object' ? player : {}
  return {
    playerId: one.playerId || '',
    playerName: one.playerName || '',
    position: one.position || '',
    vpipHands: toSafeNumber(one.vpipHands, 0),
    pfrHands: toSafeNumber(one.pfrHands, 0),
    limpHands: toSafeNumber(one.limpHands, 0),
    bets: toSafeNumber(one.bets, 0),
    raises: toSafeNumber(one.raises, 0),
    calls: toSafeNumber(one.calls, 0),
    folds: toSafeNumber(one.folds, 0)
  }
}

function simplifyShowdownForPrompt(item) {
  const one = item && typeof item === 'object' ? item : {}
  return {
    playerId: one.playerId || '',
    playerName: one.playerName || '',
    holeCards: Array.isArray(one.holeCards) ? one.holeCards : [],
    rangeTier: one.rangeTier || '',
    rangeEquity: one.rangeEquity === null || one.rangeEquity === undefined ? null : toSafeNumber(one.rangeEquity, 0),
    allInHand: !!one.allInHand,
    allInStreet: one.allInStreet || '',
    flopHandType: one.flopHandType || '',
    turnHandType: one.turnHandType || '',
    riverHandType: one.riverHandType || ''
  }
}

function simplifyUserHandForPrompt(hand) {
  const one = hand && typeof hand === 'object' ? hand : {}
  const myPlayers = Array.isArray(one.myPlayers) ? one.myPlayers : []
  const myShowdown = Array.isArray(one.myShowdown) ? one.myShowdown : []
  const showdownPlayers = Array.isArray(one.showdownPlayers) ? one.showdownPlayers : []

  return {
    handNumber: toSafeNumber(one.handNumber, 0),
    hasShowdown: !!one.hasShowdown,
    myPlayers: myPlayers.slice(0, 4).map(simplifyHandPlayerForPrompt),
    myShowdown: myShowdown.slice(0, 4).map(simplifyShowdownForPrompt),
    showdownPlayers: showdownPlayers.slice(0, 6).map(simplifyShowdownForPrompt)
  }
}

function simplifyShowdownHandForPrompt(hand) {
  const one = hand && typeof hand === 'object' ? hand : {}
  const showdownPlayers = Array.isArray(one.showdownPlayers) ? one.showdownPlayers : []
  return {
    handNumber: toSafeNumber(one.handNumber, 0),
    showdownPlayers: showdownPlayers.slice(0, 6).map(simplifyShowdownForPrompt)
  }
}

function simplifyPlayerStatForPrompt(item) {
  const one = item && typeof item === 'object' ? item : {}
  return {
    playerId: one.playerId || '',
    playerName: one.playerName || '',
    isUser: !!one.isUser,
    net: toSafeNumber(one.net, 0),
    hands: toSafeNumber(one.hands, 0),
    vpip: toSafeNumber(one.vpip, 0),
    pfr: toSafeNumber(one.pfr, 0),
    af: toSafeNumber(one.af, 0),
    bet3: toSafeNumber(one.bet3, 0),
    cbet: toSafeNumber(one.cbet, 0),
    style: one.style || '',
    styleTags: Array.isArray(one.styleTags) ? one.styleTags.slice(0, 6) : []
  }
}

function buildCompactUserMatchData(userMatchData) {
  const data = userMatchData && typeof userMatchData === 'object' ? userMatchData : {}
  const handFacts = data.handFacts && typeof data.handFacts === 'object' ? data.handFacts : {}
  const userHands = Array.isArray(handFacts.userHands) ? handFacts.userHands : []
  const showdownHands = Array.isArray(handFacts.showdownHands) ? handFacts.showdownHands : []
  const playerStats = Array.isArray(data.playerStats) ? data.playerStats : []

  return {
    gameId: data.gameId || '',
    matchStatus: data.matchStatus || '',
    isEnded: !!data.isEnded,
    currentUser: data.currentUser || {},
    totals: data.totals || {},
    qualityHint: data.qualityHint || {},
    handFacts: {
      totals: handFacts.totals || {},
      truncated: handFacts.truncated || {},
      userHands: userHands.slice(0, PROMPT_USER_HAND_LIMIT).map(simplifyUserHandForPrompt),
      showdownHands: showdownHands.slice(0, PROMPT_SHOWDOWN_HAND_LIMIT).map(simplifyShowdownHandForPrompt)
    },
    playerStats: playerStats.slice(0, PROMPT_PLAYER_STAT_LIMIT).map(simplifyPlayerStatForPrompt)
  }
}

function buildCompressedUserMatchDataText(userMatchData) {
  const compact = buildCompactUserMatchData(userMatchData)
  let text = safeJsonStringify(compact, '{}')
  if (text.length <= PROMPT_JSON_SOFT_LIMIT) {
    return text
  }

  const reduced = {
    ...compact,
    handFacts: {
      totals: compact.handFacts.totals || {},
      truncated: compact.handFacts.truncated || {},
      userHands: Array.isArray(compact.handFacts.userHands)
        ? compact.handFacts.userHands.slice(0, 10)
        : [],
      showdownHands: Array.isArray(compact.handFacts.showdownHands)
        ? compact.handFacts.showdownHands.slice(0, 8)
        : []
    },
    playerStats: Array.isArray(compact.playerStats)
      ? compact.playerStats.slice(0, 6)
      : [],
    _promptHint: '上下文已压缩，保留关键样本用于快速分析。'
  }

  text = safeJsonStringify(reduced, '{}')
  if (text.length <= PROMPT_JSON_SOFT_LIMIT) {
    return text
  }

  const summaryOnly = {
    gameId: reduced.gameId,
    matchStatus: reduced.matchStatus,
    isEnded: reduced.isEnded,
    currentUser: reduced.currentUser,
    totals: reduced.totals,
    qualityHint: reduced.qualityHint,
    handFacts: {
      totals: reduced.handFacts.totals || {},
      truncated: reduced.handFacts.truncated || {},
      userHandsSample: Array.isArray(reduced.handFacts.userHands)
        ? reduced.handFacts.userHands.slice(0, 4)
        : [],
      showdownHandsSample: Array.isArray(reduced.handFacts.showdownHands)
        ? reduced.handFacts.showdownHands.slice(0, 4)
        : []
    },
    playerStats: Array.isArray(reduced.playerStats)
      ? reduced.playerStats.slice(0, 4)
      : [],
    _promptHint: '上下文较大，已降级为摘要模式。'
  }
  return safeJsonStringify(summaryOnly, '{}')
}

function buildMatchDetailQuickReviewPrompt(payload) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const matchInfo = data.matchInfo && typeof data.matchInfo === 'object' ? data.matchInfo : null
  const statsList = Array.isArray(data.statsList) ? data.statsList : []
  const maxPlayers = Math.max(1, Math.min(10, toSafeNumber(data.maxPlayers, 6)))
  const userMatchData = data.userMatchData && typeof data.userMatchData === 'object'
    ? data.userMatchData
    : null

  if (!matchInfo || statsList.length === 0) {
    return ''
  }

  const playerLines = statsList.slice(0, maxPlayers).map((item, index) => {
    const player = item && typeof item === 'object' ? item : {}
    const styleText = Array.isArray(player.tags) && player.tags.length > 0
      ? player.tags.join('/')
      : ''

    return formatMatchDetailQuickReviewPlayerLine({
      playerName: player.playerName || '',
      netDisplay: player.netDisplay || player.net || 0,
      vpip: toSafeNumber(player.vpip, 0),
      pfr: toSafeNumber(player.pfr, 0),
      af: toSafeNumber(player.af, 0),
      bet3: toSafeNumber(player.bet3, 0),
      cbet: toSafeNumber(player.cbet, 0),
      styleText: styleText
    }, index)
  })

  const userMatchDataText = buildCompressedUserMatchDataText(userMatchData)

  return buildMatchDetailQuickReviewPromptText({
    matchName: matchInfo.name || '',
    matchStatus: matchInfo.status || '',
    currentHandNumber: matchInfo.currentHandNumber || '',
    playerLines: playerLines,
    userMatchDataText: userMatchDataText
  })
}

const PROMPT_BUILDERS = {
  [AI_PROMPT_SCENES.MATCH_DETAIL_QUICK_REVIEW]: buildMatchDetailQuickReviewPrompt
}

function buildPromptByScene(sceneId, payload) {
  const builder = PROMPT_BUILDERS[sceneId]
  if (typeof builder !== 'function') {
    return ''
  }
  return builder(payload)
}

function listPromptScenes() {
  return Object.keys(PROMPT_BUILDERS)
}

module.exports = {
  buildPromptByScene,
  listPromptScenes,
  AI_PROMPT_SCENES
}
