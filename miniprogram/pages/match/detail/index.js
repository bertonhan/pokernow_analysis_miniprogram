// miniprogram/pages/match/detail/index.js
const app = getApp()
const db = wx.cloud.database()
const AI_AGENT_ID = 'agent-gejuai-3g1et8v907e82c71'
const AI_MAX_PLAYERS = 6

Page({
  data: {
    gameId: '',
    matchInfo: null,
    loading: true,
    analyzing: false,
    statsList: [],
    canRename: false, // 【新增】控制编辑按钮显隐
    aiAnalyzing: false,
    aiResult: '',
    aiError: ''
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ gameId: options.id })
      this.loadMatchDetail(options.id)
    }
  },

  loadMatchDetail(gameId) {
    wx.showLoading({ title: '加载中...' })
    db.collection('matches').where({ gameId: gameId }).get()
      .then(res => {
        wx.hideLoading()
        if (res.data.length > 0) {
          this.setData({ matchInfo: res.data[0], loading: false })
          // 拿到状态后，开始分析数据
          this.analyzeMatch(gameId)
        } else {
          wx.showToast({ title: '未找到该对局', icon: 'none' })
        }
      })
      .catch(err => {
        console.error(err)
        wx.hideLoading()
      })
  },

  analyzeMatch(gameId) {
    this.setData({ analyzing: true })
    wx.cloud.callFunction({
      name: 'match_analysis',
      data: { gameId: gameId },
      success: res => {
        this.setData({ analyzing: false })
        const result = (res && res.result) || {}
        const list = Array.isArray(result.data) ? result.data : []

        if (result.code === 1) {
          const sortedList = this.processStats(list);
          this.setData({ statsList: sortedList })
          
          // 【新增】数据回来后，检查改名权限
          app.getOpenId(() => {
            this.checkRenamePermission(sortedList)
          })
          return
        }

        // 非成功码时，仍尝试渲染可用数据，并提示原因
        const sortedList = this.processStats(list)
        this.setData({ statsList: sortedList })
        if (result.msg) {
          wx.showToast({ title: result.msg, icon: 'none' })
        }
      },
      fail: err => {
        console.error('[match_detail] match_analysis 调用失败:', err)
        this.setData({ analyzing: false })
        wx.showToast({ title: '分析请求失败', icon: 'none' })
      }
    })
  },

  processStats(list) {
    const isEnded = this.data.matchInfo && this.data.matchInfo.status === '已结束';
    list.sort((a, b) => b.net - a.net);

    return list.map((item, index) => {
      if (!isEnded) {
        item.isUser = false;
        item.boundNames = [];
        item.avatarUrl = '';
      }
      let tags = [];
      if (item.style && item.style !== 'TBD') tags = item.style.split('/');
      item.rank = index + 1;
      item.tags = tags; 
      item.netDisplay = item.net > 0 ? `+${item.net}` : `${item.net}`;
      return item;
    });
  },

  // === 【新增】权限检查逻辑 ===
  checkRenamePermission(sortedList) {
    const { matchInfo } = this.data
    const myOpenId = app.globalData.openid
    // 1. 基础条件：必须已结束 + 名字未被修改过
    if (!matchInfo || matchInfo.status !== '已结束' || matchInfo.isRenamed) {
      this.setData({ canRename: false })
      return
    }
    // 2. 身份条件：我是不是第一名？
    // sortedList[0] 是第一名。检查他的 userId 是否等于我的 openid
    // (match_analysis 返回的数据里，如果绑定了用户，会有 userId 字段)
    const winner = sortedList.length > 0 ? sortedList[0] : null
    
    // 确保 winner 存在，且绑定了用户，且 ID 匹配
    if (winner && winner.userId && winner.userId === myOpenId) {
      this.setData({ canRename: true })
    } else {
      this.setData({ canRename: false })
    }
    const topWinner = sortedList && sortedList.length > 0 ? sortedList[0] : null
    console.log('[rename]', {
      status: this.data.matchInfo && this.data.matchInfo.status,
      isRenamed: this.data.matchInfo && this.data.matchInfo.isRenamed,
      myOpenId: app.globalData.openid,
      winnerUserId: topWinner && topWinner.userId,
      winnerName: topWinner && topWinner.playerName,
    })    
  },

  // === 【新增】点击重命名 ===
  onRenameMatch() {
    wx.showModal({
      title: '恭喜你成为Chipleader!',
      placeholderText: '仅输入名字即可，自动添加前后缀',
      editable: true,
      maxlength: 300, // 名字别太长
      success: (res) => {
        if (res.confirm && res.content) {
          const inputName = res.content.trim()
          if (!inputName) return

          // 1. 格式化日期前缀 (例如 2.8)
          // 优先取 realStartTime，没有则取 createTime
          const timeStr = this.data.matchInfo.realStartTime || this.data.matchInfo.createTime
          let prefix = ''
          
          if (timeStr) {
            // 解析 "2026-02-08 21:19" -> 拿到 2 和 8
            // 兼容可能的时间格式
            const dateObj = new Date(timeStr.replace(/-/g, '/')) 
            if (!isNaN(dateObj.getTime())) {
               prefix = `${dateObj.getMonth() + 1}.${dateObj.getDate()}`
            }
          }

          // 2. 拼接最终名称： "2.8决战紫禁之巅"
          const namePart = (inputName || '').trim()
          const finalName = prefix ? `${prefix}德扑${namePart}${namePart ? '之战' : ''}`: `德扑${namePart}${namePart ? '之战' : ''}`

          // 3. 调用云函数更新
          wx.showLoading({ title: '保存中' })
          wx.cloud.callFunction({
            name: 'match_manager',
            data: {
              action: 'rename_match',
              gameId: this.data.gameId,
              newName: finalName
            },
            success: (cloudRes) => {
              wx.hideLoading()
              if (cloudRes.result.code === 1) {
                wx.showToast({ title: '修改成功', icon: 'success' })
                
                // 4. 前端直接更新视图，并隐藏按钮
                this.setData({
                  'matchInfo.name': finalName,
                  'matchInfo.isRenamed': true, // 标记已改
                  canRename: false             // 立即隐藏按钮
                })
              } else {
                wx.showToast({ title: cloudRes.result.msg, icon: 'none' })
              }
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '网络异常', icon: 'none' })
            }
          })
        }
      }
    })
  },

  onPullDownRefresh() {
    if (this.data.gameId) {
      this.loadMatchDetail(this.data.gameId)
    }
    wx.stopPullDownRefresh()
  },
  onCopyStats() {
    const { matchInfo, statsList } = this.data
    
    // 1. 基础校验
    if (!matchInfo || !statsList || statsList.length === 0) return

    // 2. 拼接头部：对局名称
    let text = `${matchInfo.name}\n`

    // 3. 遍历拼接选手数据
    statsList.forEach(item => {
      let line = ''
      
      // 判断是否为已绑定的用户
      // 逻辑：如果是用户(isUser=true)且有绑定原始名(boundNames)，说明是聚合数据
      if (item.isUser && item.boundNames && item.boundNames.length > 0) {
        // 格式：扑克名1,扑克名2(GejuID)
        // Cloud Function 中聚合时，item.playerName 存的是 GejuID
        const pokerNames = item.boundNames.join(',')
        const gejuId = item.playerName
        line = `${pokerNames}(${gejuId})`
      } else {
        // 格式：扑克名
        // 未绑定时，item.playerName 存的就是原始扑克名
        line = item.playerName
      }

      // 拼接战绩 (item.netDisplay 已经是带+号的格式了，例如 +100)
      line += `：${item.netDisplay}`
      
      text += line + '\n'
    })

    // 4. 写入剪贴板
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: '战绩已复制',
          icon: 'success'
        })
      }
    })
  },
  buildAiPrompt() {
    const { matchInfo, statsList } = this.data
    if (!matchInfo || !Array.isArray(statsList) || statsList.length === 0) return ''

    const statusLine = matchInfo.status === '已结束'
      ? '该对局已结束，可按复盘口径输出建议。'
      : '该对局进行中，禁止输出针对单个对手的实时剥削策略，仅输出通用建议。'

    const playerLines = statsList.slice(0, AI_MAX_PLAYERS).map((item, index) => {
      const styleText = Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join('/') : '暂无标签'
      return [
        `${index + 1}. ${item.playerName}`,
        `净胜:${item.netDisplay || item.net}`,
        `VPIP:${item.vpip}%`,
        `PFR:${item.pfr}%`,
        `AF:${item.af}`,
        `3Bet:${item.bet3}%`,
        `CBet:${item.cbet}%`,
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
  },

  async onRunAiQuickTest() {
    if (this.data.aiAnalyzing) return

    const prompt = this.buildAiPrompt()
    if (!prompt) {
      wx.showToast({ title: '暂无可分析数据', icon: 'none' })
      return
    }

    if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI || !wx.cloud.extend.AI.bot) {
      const unsupportedMsg = '当前基础库不支持云开发 AI，请升级到 3.7.1 或以上后再试。'
      this.setData({ aiError: unsupportedMsg, aiResult: '' })
      wx.showToast({ title: 'AI能力不可用', icon: 'none' })
      return
    }

    this.setData({
      aiAnalyzing: true,
      aiResult: '',
      aiError: ''
    })

    try {
      const nowTs = Date.now()
      const threadId = this.data.gameId || `geju-${nowTs}`
      const runId = `run-${nowTs}`
      const userMessage = {
        id: `msg-${nowTs}`,
        role: 'user',
        content: prompt
      }

      let fullText = ''
      let loggedOnText = false
      let loggedOnEvent = false
      const seenEventTypes = {}
      const textDecoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null
      const appendResultText = (delta) => {
        if (typeof delta !== 'string' || !delta) return
        fullText += delta
        this.setData({ aiResult: fullText })
      }

      const decodeBinaryToText = (value) => {
        if (!value) return ''
        if (typeof value === 'string') return value

        if (!textDecoder) return ''

        try {
          if (value instanceof ArrayBuffer) {
            return textDecoder.decode(new Uint8Array(value))
          }
          if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
            return textDecoder.decode(value)
          }
        } catch (decodeErr) {
          return ''
        }

        return ''
      }

      const pickTextDelta = (payload, depth = 0) => {
        if (depth > 4 || payload === null || payload === undefined) return ''

        if (typeof payload === 'string') return payload
        if (typeof payload !== 'object') return ''

        if (Array.isArray(payload)) {
          let text = ''
          for (const item of payload) {
            const part = pickTextDelta(item, depth + 1)
            if (part) text += part
          }
          return text
        }

        if (typeof payload.delta === 'string') return payload.delta
        if (payload.delta && typeof payload.delta.text === 'string') return payload.delta.text
        if (typeof payload.text === 'string') return payload.text
        if (typeof payload.content === 'string') return payload.content
        if (payload.content && typeof payload.content.text === 'string') return payload.content.text

        const nestedKeys = ['content', 'message', 'messages', 'data', 'output', 'result', 'value']
        for (const key of nestedKeys) {
          if (!(key in payload)) continue
          const nestedText = pickTextDelta(payload[key], depth + 1)
          if (nestedText) return nestedText
        }

        return ''
      }

      const parseJsonObject = (value) => {
        if (!value) return null
        if (typeof value === 'object') return value
        if (typeof value !== 'string') return null
        const text = value.trim()
        if (!text) return null
        try {
          return JSON.parse(text)
        } catch (parseErr) {
          return null
        }
      }

      const extractTextFromRawText = (rawText) => {
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

          // 看起来像 JSON 片段但尚不完整，先忽略，避免把协议内容直接渲染到页面
          if (line.includes('"type"') || line.startsWith('{') || line.startsWith('[')) continue

          combined += line
        }

        return combined
      }

      const res = await wx.cloud.extend.AI.bot.sendMessage({
        data: {
          botId: AI_AGENT_ID,
          // 兼容老版 bot 接口字段
          msg: prompt,
          history: [],
          // AG-UI 字段（云函数类型 Agent）
          threadId,
          runId,
          messages: [userMessage],
          tools: [],
          context: [],
          state: {}
        },
        onText: (text) => {
          const textValue = pickTextDelta(text) || extractTextFromRawText(decodeBinaryToText(text))
          if (!loggedOnText) {
            loggedOnText = true
            console.log('[match_detail] ai onText first chunk', {
              textLength: typeof textValue === 'string' ? textValue.length : 0
            })
          }
          appendResultText(textValue)
        },
        onFinish: (text) => {
          const finishText = pickTextDelta(text) || extractTextFromRawText(decodeBinaryToText(text))
          console.log('[match_detail] ai onFinish', {
            hasAccumulatedText: !!fullText,
            finishTextLength: typeof finishText === 'string' ? finishText.length : 0
          })
          if (!fullText && typeof finishText === 'string' && finishText) {
            fullText = finishText
            this.setData({ aiResult: fullText })
          }
        },
        onEvent: (eventPacket) => {
          const packet = eventPacket && typeof eventPacket === 'object' ? eventPacket : {}
          const rawData = Object.prototype.hasOwnProperty.call(packet, 'data') ? packet.data : eventPacket
          const rawText = decodeBinaryToText(rawData)
          const evt = parseJsonObject(rawData) || parseJsonObject(rawText)

          if (!loggedOnEvent) {
            loggedOnEvent = true
            let packetPreview = ''
            try {
              packetPreview = JSON.stringify(packet).slice(0, 120)
            } catch (stringifyErr) {
              packetPreview = '[unserializable packet]'
            }
            console.log('[match_detail] ai onEvent first packet', {
              dataPreview: rawText ? rawText.slice(0, 120) : packetPreview
            })
          }

          const evtType = String(
            (evt && (evt.type || evt.event))
            || packet.type
            || packet.event
            || ''
          ).toLowerCase()

          if (evtType && !seenEventTypes[evtType] && Object.keys(seenEventTypes).length < 12) {
            seenEventTypes[evtType] = true
            console.log('[match_detail] ai onEvent type', {
              evtType,
              evtKeys: evt && typeof evt === 'object' ? Object.keys(evt) : []
            })
          }

          const eventText = pickTextDelta(evt)
            || pickTextDelta(packet)
            || extractTextFromRawText(rawText)

          if (eventText) {
            appendResultText(eventText)
          }

          if (evtType.includes('error')) {
            const runErrMsg = `${
              (evt && evt.code) || packet.code || 'RUN_ERROR'
            }: ${
              (evt && evt.message) || packet.message || 'Agent 运行失败'
            }`
            this.setData({ aiError: runErrMsg })
          }
        }
      })

      console.log('[match_detail] ai sendMessage response keys', res ? Object.keys(res) : [])

      const textStream = res && res.textStream && typeof res.textStream[Symbol.asyncIterator] === 'function'
        ? res.textStream
        : null
      const eventStream = res && res.eventStream && typeof res.eventStream[Symbol.asyncIterator] === 'function'
        ? res.eventStream
        : null
      const stream = textStream || eventStream
      const streamType = textStream ? 'textStream' : (eventStream ? 'eventStream' : '')

      if (!fullText && stream) {
        let isFirstChunk = true
        for await (const chunk of stream) {
          const chunkText = extractTextFromRawText(decodeBinaryToText(chunk))
          if (chunkText) {
            if (isFirstChunk) {
              isFirstChunk = false
              console.log('[match_detail] ai stream first text chunk', {
                streamType,
                chunkTextLength: chunkText.length
              })
            }
            appendResultText(chunkText)
            continue
          }

          if (!chunk || typeof chunk !== 'object') continue

          if (isFirstChunk) {
            isFirstChunk = false
            console.log('[match_detail] ai stream first chunk', {
              streamType,
              chunkKeys: Object.keys(chunk)
            })
          }

          const chunkType = String(chunk.type || chunk.event || '').toLowerCase()
          const rawData = chunk.data

          let payload = chunk
          let parsedDataString = false
          const rawDataText = decodeBinaryToText(rawData)
          if (typeof rawDataText === 'string' && rawDataText.trim()) {
            const dataText = rawDataText.trim()
            if (dataText) {
              try {
                payload = JSON.parse(dataText)
                parsedDataString = true
              } catch (parseErr) {
                payload = chunk
              }
            }
          } else if (rawData && typeof rawData === 'object') {
            payload = rawData
          }

          const payloadType = String(payload.type || payload.event || '').toLowerCase()
          const eventType = payloadType || chunkType

          const textDelta = pickTextDelta(payload) || pickTextDelta(chunk)
          if (textDelta) {
            appendResultText(textDelta)
            continue
          }

          if (!parsedDataString && typeof rawDataText === 'string' && rawDataText) {
            const possibleTextEvent = eventType.includes('text') || eventType.includes('delta') || eventType.includes('message')
            if (possibleTextEvent) {
              appendResultText(rawDataText)
              continue
            }
          }

          if (eventType.includes('error')) {
            const runErrMsg = `${payload.code || chunk.code || 'RUN_ERROR'}: ${payload.message || chunk.message || 'Agent 运行失败'}`
            this.setData({ aiError: runErrMsg })
          }
        }
      }

      if (!fullText && res && typeof res.text === 'string' && res.text) {
        fullText = res.text
        this.setData({ aiResult: fullText })
      }

      if (!fullText && res && typeof res.content === 'string' && res.content) {
        fullText = res.content
        this.setData({ aiResult: fullText })
      }

      if (!fullText) {
        this.setData({
          aiResult: 'AI 请求已发出，但没有收到文本流。请到云开发控制台查看 GejuAI 日志。'
        })
      }
    } catch (err) {
      console.error('[match_detail] AI quick test failed:', err)
      const errMsg = (err && (err.errMsg || err.message)) ? (err.errMsg || err.message) : 'AI 调用失败'
      const debugInfo = err && typeof err === 'object'
        ? JSON.stringify({
            errCode: err.errCode || '',
            statusCode: err.statusCode || '',
            requestId: err.requestId || '',
            code: err.code || '',
            message: err.message || ''
          })
        : ''
      this.setData({
        aiError: debugInfo && debugInfo !== '{}' ? `${errMsg}\n${debugInfo}` : errMsg
      })
      wx.showToast({ title: 'AI 调用失败', icon: 'none' })
    } finally {
      this.setData({ aiAnalyzing: false })
    }
  },
})
