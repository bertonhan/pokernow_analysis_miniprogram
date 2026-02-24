// miniprogram/utils/ai-bot-client.js
// 统一封装小程序端 AI 调用（发送消息 + 流式解析 + 错误提取）

function isAiBotSupported() {
  return !!(wx.cloud && wx.cloud.extend && wx.cloud.extend.AI && wx.cloud.extend.AI.bot)
}

function createTextDecoder() {
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('utf-8')
  }
  return null
}

function decodeBinaryToText(value, textDecoder) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (!textDecoder) return ''

  try {
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      return textDecoder.decode(new Uint8Array(value))
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      return textDecoder.decode(value)
    }
  } catch (err) {
    return ''
  }

  return ''
}

function parseJsonObject(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch (err) {
    return null
  }
}

function pickTextDelta(payload, depth = 0) {
  if (depth > 4 || payload === null || payload === undefined) return ''

  if (typeof payload === 'string') return payload
  if (typeof payload !== 'object') return ''

  if (Array.isArray(payload)) {
    let joined = ''
    for (const item of payload) {
      const part = pickTextDelta(item, depth + 1)
      if (part) joined += part
    }
    return joined
  }

  if (typeof payload.delta === 'string') return payload.delta
  if (payload.delta && typeof payload.delta.text === 'string') return payload.delta.text
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.content === 'string') return payload.content
  if (payload.content && typeof payload.content.text === 'string') return payload.content.text

  const nestedKeys = ['content', 'message', 'messages', 'data', 'output', 'result', 'value']
  for (const key of nestedKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    const nested = pickTextDelta(payload[key], depth + 1)
    if (nested) return nested
  }

  return ''
}

function extractTextFromRawText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return ''
  let combined = ''
  const lines = rawText.split(/\r?\n/)

  for (const rawLine of lines) {
    let line = (rawLine || '').trim()
    if (!line || line.startsWith(':') || line.startsWith('id:') || line.startsWith('event:')) continue
    if (line.startsWith('data:')) line = line.slice(5).trim()
    if (!line || line === '[DONE]') continue

    const obj = parseJsonObject(line)
    if (obj) {
      const textPart = pickTextDelta(obj)
      if (textPart) combined += textPart
      continue
    }

    if (line.includes('"type"') || line.startsWith('{') || line.startsWith('[')) continue
    combined += line
  }

  return combined
}

function extractTextFromUnknownPayload(value, textDecoder) {
  return pickTextDelta(value) || extractTextFromRawText(decodeBinaryToText(value, textDecoder))
}

function formatRunError(code, message) {
  if (!code && !message) return ''
  if (!code) return String(message)
  if (!message) return String(code)
  return `${code}: ${message}`
}

/**
 * 发送一条 user prompt 到 Agent，并返回完整文本
 *
 * @param {Object} options
 * @param {string} options.botId
 * @param {string} options.prompt
 * @param {string} options.threadId
 * @param {string} options.runId
 * @param {Object} [options.state]
 * @param {(fullText: string, chunkText: string) => void} [options.onPartialText]
 * @param {(info: any) => void} [options.onDebug]
 * @returns {Promise<{ text: string, error: string, response: any }>}
 */
async function runAgentPrompt(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : ''

  if (!prompt) {
    return { text: '', error: 'EMPTY_PROMPT', response: null }
  }

  if (!isAiBotSupported()) {
    return { text: '', error: 'AI_NOT_SUPPORTED', response: null }
  }

  const textDecoder = createTextDecoder()
  let fullText = ''
  let runError = ''
  let firstTextLogged = false
  const seenEventTypes = {}

  const emitPartialText = (delta) => {
    if (typeof delta !== 'string' || !delta) return
    fullText += delta
    if (typeof opts.onPartialText === 'function') {
      opts.onPartialText(fullText, delta)
    }
    if (!firstTextLogged) {
      firstTextLogged = true
      if (typeof opts.onDebug === 'function') {
        opts.onDebug({ type: 'first_text_chunk', length: delta.length })
      }
    }
  }

  const captureRunError = (code, message) => {
    const msg = formatRunError(code || 'RUN_ERROR', message || 'Agent 运行失败')
    if (!msg) return
    runError = msg
    if (typeof opts.onDebug === 'function') {
      opts.onDebug({ type: 'run_error', message: msg })
    }
  }

  const handleEventPacket = (eventPacket) => {
    const packet = eventPacket && typeof eventPacket === 'object' ? eventPacket : {}
    const rawData = Object.prototype.hasOwnProperty.call(packet, 'data') ? packet.data : eventPacket
    const rawText = decodeBinaryToText(rawData, textDecoder)
    const evt = parseJsonObject(rawData) || parseJsonObject(rawText)
    const evtType = String(
      (evt && (evt.type || evt.event))
      || packet.type
      || packet.event
      || ''
    ).toLowerCase()

    if (
      typeof opts.onDebug === 'function'
      && evtType
      && !seenEventTypes[evtType]
      && Object.keys(seenEventTypes).length < 12
    ) {
      seenEventTypes[evtType] = true
      opts.onDebug({ type: 'event_type', eventType: evtType })
    }

    const eventText = pickTextDelta(evt)
      || pickTextDelta(packet)
      || extractTextFromRawText(rawText)

    if (eventText) {
      emitPartialText(eventText)
    }

    if (evtType.includes('error')) {
      captureRunError(
        (evt && evt.code) || packet.code,
        (evt && evt.message) || packet.message
      )
    }
  }

  const nowTs = Date.now()
  const runId = opts.runId || `run-${nowTs}`
  const threadId = opts.threadId || `thread-${nowTs}`
  const userMessageId = opts.userMessageId || `msg-${nowTs}`
  const clientState = opts.state && typeof opts.state === 'object' ? opts.state : {}

  const response = await wx.cloud.extend.AI.bot.sendMessage({
    data: {
      botId: opts.botId,
      // 兼容老版 bot 接口字段
      msg: prompt,
      history: [],
      // AG-UI 字段（云函数类型 Agent）
      threadId,
      runId,
      messages: [{ id: userMessageId, role: 'user', content: prompt }],
      tools: [],
      context: [],
      state: clientState
    },
    onText: (value) => {
      const textValue = extractTextFromUnknownPayload(value, textDecoder)
      emitPartialText(textValue)
    },
    onEvent: handleEventPacket,
    onFinish: (value) => {
      const finishText = extractTextFromUnknownPayload(value, textDecoder)
      if (!fullText && finishText) {
        fullText = finishText
        if (typeof opts.onPartialText === 'function') {
          opts.onPartialText(fullText, finishText)
        }
      }
    }
  })

  if (typeof opts.onDebug === 'function') {
    opts.onDebug({
      type: 'response_keys',
      keys: response && typeof response === 'object' ? Object.keys(response) : []
    })
  }

  const textStream = response && response.textStream && typeof response.textStream[Symbol.asyncIterator] === 'function'
    ? response.textStream
    : null
  const eventStream = response && response.eventStream && typeof response.eventStream[Symbol.asyncIterator] === 'function'
    ? response.eventStream
    : null
  const stream = textStream || eventStream

  if (!fullText && stream) {
    for await (const chunk of stream) {
      const chunkText = extractTextFromUnknownPayload(chunk, textDecoder)
      if (chunkText) {
        emitPartialText(chunkText)
        continue
      }

      if (!chunk || typeof chunk !== 'object') continue
      handleEventPacket(chunk)
    }
  }

  if (!fullText && response && typeof response.text === 'string' && response.text) {
    fullText = response.text
  }
  if (!fullText && response && typeof response.content === 'string' && response.content) {
    fullText = response.content
  }

  return {
    text: fullText,
    error: runError,
    response
  }
}

module.exports = {
  isAiBotSupported,
  runAgentPrompt
}
