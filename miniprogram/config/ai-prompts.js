// miniprogram/config/ai-prompts.js
// 所有页面点击触发的 user prompt 都在这里集中维护

const { AI_PROMPT_SCENES } = require('./ai-agent')
const {
  buildMatchDetailQuickReviewPromptText,
  formatMatchDetailQuickReviewPlayerLine
} = require('./ai-prompt-texts')

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

  const compactUserMatchData = userMatchData
    ? {
        gameId: userMatchData.gameId || '',
        matchStatus: userMatchData.matchStatus || '',
        isEnded: !!userMatchData.isEnded,
        currentUser: userMatchData.currentUser || {},
        totals: userMatchData.totals || {},
        qualityHint: userMatchData.qualityHint || {},
        handFacts: userMatchData.handFacts || {},
        playerStats: Array.isArray(userMatchData.playerStats)
          ? userMatchData.playerStats.slice(0, 12)
          : []
      }
    : {}

  let userMatchDataText = safeJsonStringify(compactUserMatchData, '{}')
  if (userMatchDataText.length > 24000) {
    userMatchDataText = userMatchDataText.slice(0, 24000) + '\n...<truncated>'
  }

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
