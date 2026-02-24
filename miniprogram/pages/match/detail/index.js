// miniprogram/pages/match/detail/index.js
const app = getApp()
const db = wx.cloud.database()
const { AI_AGENT_CONFIG, AI_PROMPT_SCENES } = require('../../../config/ai-agent')
const { runAiScene, AI_SCENE_RUN_CODES } = require('../../../utils/ai-scene-runner')

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
    aiError: '',
    aiUserMatchData: null
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
  buildAiQuickReviewPayload(userMatchData) {
    return {
      matchInfo: this.data.matchInfo,
      statsList: this.data.statsList,
      maxPlayers: AI_AGENT_CONFIG.maxPlayers,
      userMatchData: userMatchData || this.data.aiUserMatchData || null
    }
  },

  async loadAiMatchContext() {
    const gameId = this.data.gameId
    if (!gameId) return { ok: false, msg: '缺少对局ID' }

    try {
      const res = await wx.cloud.callFunction({
        name: 'match_ai_context',
        data: {
          gameId,
          detailLimit: 80
        }
      })
      const result = (res && res.result) || {}
      if (result.code === 1 && result.data) {
        return { ok: true, data: result.data }
      }
      return { ok: false, msg: result.msg || '构建对局分析上下文失败' }
    } catch (err) {
      const errMsg = (err && (err.errMsg || err.message))
        ? (err.errMsg || err.message)
        : '构建对局分析上下文失败'
      return { ok: false, msg: errMsg }
    }
  },

  async onRunAiQuickTest() {
    if (this.data.aiAnalyzing) return

    this.setData({
      aiAnalyzing: true,
      aiResult: '',
      aiError: '',
      aiUserMatchData: null
    })

    try {
      const contextRes = await this.loadAiMatchContext()
      if (!contextRes.ok) {
        this.setData({ aiError: contextRes.msg || '构建对局分析上下文失败' })
        wx.showToast({ title: '上下文获取失败', icon: 'none' })
        return
      }

      this.setData({ aiUserMatchData: contextRes.data })

      const nowTs = Date.now()
      const aiRunResult = await runAiScene({
        sceneId: AI_PROMPT_SCENES.MATCH_DETAIL_QUICK_REVIEW,
        payload: this.buildAiQuickReviewPayload(contextRes.data),
        threadId: this.data.gameId || `geju-${nowTs}`,
        runId: `run-${nowTs}`,
        onPartialText: (fullText) => {
          this.setData({ aiResult: fullText })
        },
        onDebug: (info) => {
          if (!info || typeof info !== 'object') return
          if (info.type === 'response_keys') {
            console.log('[match_detail] ai sendMessage response keys', info.keys)
            return
          }
          if (info.type === 'event_type') {
            console.log('[match_detail] ai event type', info.eventType)
          }
        }
      })

      if (aiRunResult.code === AI_SCENE_RUN_CODES.EMPTY_PROMPT) {
        wx.showToast({ title: '暂无可分析数据', icon: 'none' })
        return
      }

      if (aiRunResult.code === AI_SCENE_RUN_CODES.AI_NOT_SUPPORTED) {
        this.setData({ aiError: aiRunResult.error, aiResult: '' })
        wx.showToast({ title: 'AI能力不可用', icon: 'none' })
        return
      }

      if (aiRunResult.code === AI_SCENE_RUN_CODES.RUN_ERROR) {
        this.setData({ aiError: aiRunResult.error })
        return
      }

      this.setData({ aiResult: aiRunResult.text || '' })
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
