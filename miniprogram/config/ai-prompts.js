// miniprogram/config/ai-prompts.js
// 所有页面点击触发的 user prompt 都在这里集中维护

const { AI_PROMPT_SCENES } = require('./ai-agent')

function toSafeNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function buildMatchDetailQuickReviewPrompt(payload) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const matchInfo = data.matchInfo && typeof data.matchInfo === 'object' ? data.matchInfo : null
  const statsList = Array.isArray(data.statsList) ? data.statsList : []
  const maxPlayers = Math.max(1, Math.min(10, toSafeNumber(data.maxPlayers, 6)))

  if (!matchInfo || statsList.length === 0) {
    return ''
  }

  const statusLine = matchInfo.status === '已结束'
    ? '该对局已结束，可按复盘口径输出建议。'
    : '该对局进行中，禁止输出针对单个对手的实时剥削策略，仅输出通用建议。'

  const playerLines = statsList.slice(0, maxPlayers).map((item, index) => {
    const player = item && typeof item === 'object' ? item : {}
    const styleText = Array.isArray(player.tags) && player.tags.length > 0 ? player.tags.join('/') : '暂无标签'

    return [
      `${index + 1}. ${player.playerName || `玩家${index + 1}`}`,
      `净胜:${player.netDisplay || player.net || 0}`,
      `VPIP:${toSafeNumber(player.vpip, 0)}%`,
      `PFR:${toSafeNumber(player.pfr, 0)}%`,
      `AF:${toSafeNumber(player.af, 0)}`,
      `3Bet:${toSafeNumber(player.bet3, 0)}%`,
      `CBet:${toSafeNumber(player.cbet, 0)}%`,
      `风格:${styleText}`
    ].join(' | ')
  }).join('\n')

  return [
    '你是德州扑克复盘助手。请基于以下统计给出简短分析。',
    '输出格式固定为：',
    '1) 牌局总体节奏（1-2句）',
    '2) 每位玩家一句风格判断',
    '3) 给我方 3 条可执行建议（翻前/翻后/资金管理各1条）',
    '4) 最后补一句风险提示',
    statusLine,
    '',
    `对局名称: ${matchInfo.name || '-'}`,
    `对局状态: ${matchInfo.status || '-'}`,
    `当前手牌: ${matchInfo.currentHandNumber || '-'}`,
    '',
    '玩家统计:',
    playerLines
  ].join('\n')
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
