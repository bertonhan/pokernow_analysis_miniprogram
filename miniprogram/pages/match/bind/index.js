// pages/match/bind/index.js
const app = getApp()
const db = wx.cloud.database()

Page({
  data: {
    gameId: '',
    playerList: [], 
    loading: true,
    matchStatus: '' // 新增：存储对局状态
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ gameId: options.id })
      this.loadData(options.id)
    }
  },

  async loadData(gameId) {
    this.setData({ loading: true })

    try {
      // 1. 获取 OpenID
      let myOpenId = app.globalData.openid
      if (!myOpenId) {
        const userRes = await wx.cloud.callFunction({ name: 'match_bind_tool', data: { action: 'getOpenId' } })
        myOpenId = userRes.result.openid
        app.globalData.openid = myOpenId
      }

      // 2. 获取对局信息
      const matchRes = await db.collection('matches').where({ gameId }).get()
      if (!matchRes.data.length) throw new Error('对局不存在')
      
      const matchDoc = matchRes.data[0]
      const ledger = matchDoc.ledger || {}
      const playersInfos = ledger.playersInfos || {}
      const matchStatus = matchDoc.status || '记录中' // 获取状态

      // 3. 获取绑定关系
      const bindRes = await db.collection('match_player_bindings').where({ gameId }).get()
      const bindings = bindRes.data || [] 

      // 4. 获取真实名字 (云函数)
      let userMap = {} 
      const userIds = [...new Set(bindings.map(b => b.userId))]
      if (userIds.length > 0) {
        const mapRes = await wx.cloud.callFunction({
          name: 'match_bind_tool',
          data: { action: 'getGejuIds', userIds: userIds }
        })
        if (mapRes.result.code === 1) userMap = mapRes.result.map
      }

      // 5. 数据合并 (核心修改：隐私逻辑)
      const list = []
      
      Object.keys(playersInfos).forEach(pid => {
        const pInfo = playersInfos[pid]
        const nameList = pInfo.names || []
        const latestLedgerName = nameList.length > 0 ? nameList[nameList.length - 1] : 'Unknown'
        
        const bindRecord = bindings.find(b => b.playerId === pid)
        
        let status = 'available' 
        let boundGejuId = '' 
        
        if (bindRecord) {
          const realName = userMap[bindRecord.userId] || '未知选手'

          if (bindRecord.userId === myOpenId) {
            // A. 我自己：永远显示
            status = 'mine' 
            boundGejuId = realName
          } else {
            // B. 别人：判断对局状态
            status = 'others' 
            if (matchStatus === '已结束') {
              // 已结束 -> 公开
              boundGejuId = realName
            } else {
              // 进行中 -> 保密
              boundGejuId = '已保密 (***)'
            }
          }
        }

        list.push({
          playerId: pid,
          playerName: latestLedgerName, 
          boundGejuId: boundGejuId,     
          net: pInfo.net,
          status
        })
      })

      // 6. 排序
      list.sort((a, b) => {
        const score = { 'mine': 3, 'available': 2, 'others': 1 }
        return score[b.status] - score[a.status]
      })

      this.setData({ 
        playerList: list, 
        loading: false,
        matchStatus: matchStatus // 更新状态到页面
      })

    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  handleBind(e) {
    const { pid, name } = e.currentTarget.dataset
    wx.showModal({
      title: '确认绑定',
      content: `确定要认领选手 "${name}" 吗？`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '绑定中...' })
          const userAvatar = (app.globalData.userInfo && app.globalData.userInfo.avatarUrl) || ''
          wx.cloud.callFunction({
            name: 'match_bind_tool',
            data: { action: 'bind', gameId: this.data.gameId, playerId: pid, playerName: name, avatarUrl: userAvatar },
            success: (cloudRes) => {
              wx.hideLoading()
              if (cloudRes.result.code === 1) {
                wx.showToast({ title: '绑定成功' })
                this.loadData(this.data.gameId) 
              } else {
                wx.showToast({ title: cloudRes.result.msg, icon: 'none' })
              }
            },
            fail: (err) => { wx.hideLoading(); wx.showToast({ title: '请求失败', icon: 'none' }) }
          })
        }
      }
    })
  },

  handleUnbind(e) {
    const { pid, name } = e.currentTarget.dataset
    wx.showModal({
      title: '确认解绑',
      content: `确定不再关联选手 "${name}" 吗？`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' })
          wx.cloud.callFunction({
            name: 'match_bind_tool',
            data: { action: 'unbind', gameId: this.data.gameId, playerId: pid },
            success: (cloudRes) => {
              wx.hideLoading()
              if (cloudRes.result.code === 1) {
                wx.showToast({ title: '已解绑' })
                this.loadData(this.data.gameId) 
              } else {
                wx.showToast({ title: '操作失败', icon: 'none' })
              }
            },
            fail: () => { wx.hideLoading(); wx.showToast({ title: '请求失败', icon: 'none' }) }
          })
        }
      }
    })
  }
})