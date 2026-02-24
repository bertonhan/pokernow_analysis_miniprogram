// miniprogram/utils/ai-scene-runner.js
// 场景级 AI 调用器：页面只传 sceneId + payload，统一走同一套流式逻辑

const { AI_AGENT_CONFIG } = require('../config/ai-agent')
const { buildPromptByScene } = require('../config/ai-prompts')
const { isAiBotSupported, runAgentPrompt } = require('./ai-bot-client')

const AI_SCENE_RUN_CODES = Object.freeze({
  OK: 'OK',
  EMPTY_PROMPT: 'EMPTY_PROMPT',
  AI_NOT_SUPPORTED: 'AI_NOT_SUPPORTED',
  RUN_ERROR: 'RUN_ERROR'
})

const AI_SCENE_RUN_MESSAGES = Object.freeze({
  EMPTY_PROMPT: '暂无可分析数据',
  AI_NOT_SUPPORTED: '当前基础库不支持云开发 AI，请升级到 3.7.1 或以上后再试。',
  NO_TEXT_STREAM: 'AI 请求已发出，但没有收到文本流。请到云开发控制台查看 GejuAI 日志。'
})

async function runAiScene(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const sceneId = opts.sceneId || ''
  const payload = opts.payload || {}
  const prompt = buildPromptByScene(sceneId, payload)

  if (!prompt) {
    return {
      ok: false,
      code: AI_SCENE_RUN_CODES.EMPTY_PROMPT,
      prompt: '',
      text: '',
      error: AI_SCENE_RUN_MESSAGES.EMPTY_PROMPT,
      response: null
    }
  }

  if (!isAiBotSupported()) {
    return {
      ok: false,
      code: AI_SCENE_RUN_CODES.AI_NOT_SUPPORTED,
      prompt,
      text: '',
      error: AI_SCENE_RUN_MESSAGES.AI_NOT_SUPPORTED,
      response: null
    }
  }

  const nowTs = Date.now()
  const aiRunResult = await runAgentPrompt({
    botId: opts.botId || AI_AGENT_CONFIG.botId,
    prompt,
    threadId: opts.threadId || `geju-${nowTs}`,
    runId: opts.runId || `run-${nowTs}`,
    onPartialText: opts.onPartialText,
    onDebug: opts.onDebug
  })

  if (aiRunResult.error) {
    return {
      ok: false,
      code: AI_SCENE_RUN_CODES.RUN_ERROR,
      prompt,
      text: aiRunResult.text || '',
      error: aiRunResult.error,
      response: aiRunResult.response
    }
  }

  const finalText = aiRunResult.text || (opts.disableNoTextFallback
    ? ''
    : AI_SCENE_RUN_MESSAGES.NO_TEXT_STREAM)

  return {
    ok: true,
    code: AI_SCENE_RUN_CODES.OK,
    prompt,
    text: finalText,
    error: '',
    response: aiRunResult.response
  }
}

module.exports = {
  runAiScene,
  AI_SCENE_RUN_CODES,
  AI_SCENE_RUN_MESSAGES
}
