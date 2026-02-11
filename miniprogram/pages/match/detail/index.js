// miniprogram/pages/match/detail/index.js
const app = getApp()
const db = wx.cloud.database()

Page({
  data: {
    gameId: '',
    matchInfo: null,
    loading: true,
    analyzing: false,
    statsList: [],
    canRename: false // 【新增】控制编辑按钮显隐
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
        if (res.result.code === 1) {
          const sortedList = this.processStats(res.result.data);
          this.setData({ statsList: sortedList })
          
          // 【新增】数据回来后，检查改名权限
          this.checkRenamePermission(sortedList)
        }
      },
      fail: err => {
        this.setData({ analyzing: false })
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
    console.log('[rename]', {
      status: this.data.matchInfo?.status,
      isRenamed: this.data.matchInfo?.isRenamed,
      myOpenId: app.globalData.openid,
      winnerUserId: sortedList?.[0]?.userId,
      winnerName: sortedList?.[0]?.playerName,
    })    
  },

  // === 【新增】点击重命名 ===
  onRenameMatch() {
    wx.showModal({
      title: '重命名对局',
      placeholderText: '输入新名称（自动添加日期前缀）',
      editable: true,
      maxlength: 15, // 名字别太长
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
          const finalName = prefix ? `${prefix}${inputName}` : inputName

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
})