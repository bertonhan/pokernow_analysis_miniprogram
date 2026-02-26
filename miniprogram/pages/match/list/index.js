// miniprogram/pages/match/list/index.js
const app = getApp()
const ADMIN_LIST = [ 'oVJBv3Z6GzqygarChiUpuMfpPUxw','oVJBv3ZQeK89wBj07zNfqYs9mdN0' ]
const DELETE_REVEAL_RPX = 160

Page({
  data: {
    authChecking: true,
    isLoggedIn: false, 
    inputLink: '',
    matchList: [],
    isAdmin: false, 
    openid: ''
  },

  // === 1. 滑动交互 (修复：只保留这一个定义) ===
  onSwipeChange(e) {
    const index = e.currentTarget.dataset.index
    const x = Number(e && e.detail ? e.detail.x : NaN)
    if (index === undefined || Number.isNaN(x)) return
    if (!this._swipeXCache) this._swipeXCache = {}
    this._swipeXCache[index] = x
  },

  onSwipeEnd(e) {
    const index = e.currentTarget.dataset.index
    const cachedX = this._swipeXCache ? Number(this._swipeXCache[index]) : NaN
    const currentX = !Number.isNaN(cachedX)
      ? cachedX
      : Number(((this.data.matchList || [])[index] || {}).x || 0)
    const revealPx = this.deleteRevealPx || 80
    const shouldOpen = currentX <= -revealPx / 2
    const nextX = shouldOpen ? -revealPx : 0

    const nextState = { [`matchList[${index}].x`]: nextX }
    // 保持交互干净：只允许一张卡片处于展开状态
    ;(this.data.matchList || []).forEach((item, i) => {
      if (i !== index && Number(item.x || 0) !== 0) {
        nextState[`matchList[${i}].x`] = 0
      }
    })

    this.setData(nextState)
    if (this._swipeXCache) this._swipeXCache[index] = nextX
  },

  onLoad() {
    this.initSwipeConfig()
    this.checkAdmin()
  },

  onShow() {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.checkAccess(); 
  },

  // === 2. 权限与加载 ===
  checkAccess() {
    this.setData({ authChecking: true })
    app.checkLoginStatus((isLoggedIn) => {
      this.setData({ authChecking: false })
      if (isLoggedIn) {
        this.setData({ isLoggedIn: true });
        this.checkAdmin();
        this.loadList();
        if(!this.timer) this.timer = setInterval(() => { this.loadList() }, 5000);
      } else {
        this.setData({ isLoggedIn: false, matchList: [] });
        if(this.timer) clearInterval(this.timer); this.timer = null;
      }
    });
  },
  
  onHide() { if(this.timer) clearInterval(this.timer); this.timer = null; },
  onUnload() { if(this.timer) clearInterval(this.timer); this.timer = null; },

  checkAdmin() {
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        if (res && res.result) {
          const openid = res.result.openid
          const isAdmin = ADMIN_LIST.includes(openid)
          this.setData({ openid, isAdmin })
        }
      }
    })
  },

  loadList() {
    const prevXMap = {}
    ;(this.data.matchList || []).forEach(item => {
      const gameId = item && item.gameId
      if (!gameId) return
      prevXMap[gameId] = Number(item.x || 0)
    })

    wx.cloud.callFunction({
      name: 'match_manager',
      data: { action: 'list' },
      success: res => {
        // 安全检查，防止 map 报错
        if (res.result && res.result.data) {
          const newList = res.result.data.map(item => {
            const gameId = item && item.gameId
            const prevX = gameId ? Number(prevXMap[gameId] || 0) : 0
            return Object.assign({}, item, { x: prevX })
          })
          this.setData({ matchList: newList })
        }
      }
    })
  },

  initSwipeConfig() {
    try {
      const win = getWindowMetrics()
      const windowWidth = Number(win.windowWidth || 375)
      this.deleteRevealPx = Math.round((DELETE_REVEAL_RPX / 750) * windowWidth)
    } catch (e) {
      this.deleteRevealPx = 80
    }
  },

  // === 3. 业务操作 ===
  onInputLink(e) { this.setData({ inputLink: e.detail.value }) },
  
  createMatch() {
    if (!this.data.inputLink) return
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({
      name: 'match_manager',
      data: { action: 'create', matchLink: this.data.inputLink },
      success: res => {
        wx.hideLoading()
        if (res.result.code === 1) {
          wx.showToast({ title: '开始爬取' })
          this.setData({ inputLink: '' })
          this.loadList()
        } else {
          wx.showToast({ title: res.result.msg, icon: 'none' })
        }
      }
    })
  },

  deleteMatch(e) {
    const { id, index } = e.currentTarget.dataset
    wx.showModal({
      title: '确认删除', content: '删除后将不可恢复，确定吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中' })
          wx.cloud.callFunction({
            name: 'match_manager', data: { action: 'delete', gameId: id },
            success: res => {
              wx.hideLoading()
              if (res.result.code === 1) {
                wx.showToast({ title: '已删除' })
                const list = this.data.matchList
                list.splice(index, 1)
                this.setData({ matchList: list })
              } else { wx.showToast({ title: res.result.msg, icon: 'none' }) }
            }
          })
        }
      }
    })
  },

// 结束对局
endMatch(e) {
  const { id } = e.currentTarget.dataset
  
  // 【新增调试日志】确保 ID 拿到了
  console.log('>>> 前端准备结束对局, GameID:', id)

  wx.showModal({
    title: '结束对局',
    content: '结束后的对局将标记为归档状态，无法再继续更新，确定吗？',
    confirmColor: '#ff4d4f',
    success: (res) => {
      if (res.confirm) {
        wx.showLoading({ title: '处理中' })
        
        wx.cloud.callFunction({
          name: 'match_manager',
          data: { 
            action: 'end_match', 
            gameId: id 
          },
          success: res => {
            wx.hideLoading()
            // 【新增调试日志】看云函数返回了什么
            console.log('>>> 云函数返回:', res.result)
            
            if (res.result.code === 1) {
              wx.showToast({ title: '对局已结束' })
              this.loadList()
            } else {
              wx.showToast({ title: '操作失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('>>> 云函数调用失败:', err)
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    }
  })
},

  toggleUpdate(e) {
    const index = e.currentTarget.dataset.index
    const match = this.data.matchList[index]
    wx.showLoading({ title: '处理中' })
    wx.cloud.callFunction({
      name: 'match_manager', data: { action: 'toggle_status', gameId: match.gameId },
      success: res => {
        wx.hideLoading()
        this.loadList()
        if (res.result.newStatus === '记录中') wx.showToast({ title: '后台已启动' })
        else wx.showToast({ title: '后台已暂停' })
      }
    })
  },
  
  viewMatch(e) {
    wx.navigateTo({ url: `/pages/match/detail/index?id=${e.currentTarget.dataset.id}` })
  },
  goToBind(e) {
    if (!this.data.isLoggedIn) return wx.showToast({ title: '请先登录', icon: 'none' })
    wx.navigateTo({ url: `/pages/match/bind/index?id=${e.currentTarget.dataset.id}` })
  },
  goToManualEntry() {
    if (!this.data.isLoggedIn) return wx.showToast({ title: '请先登录', icon: 'none' })
    wx.navigateTo({ url: '/pages/match/manual/index' })
  },
  goToProfile() { wx.switchTab({ url: '/pages/profile/index' }) }
})

function getWindowMetrics() {
  let windowWidth = 0
  let windowHeight = 0
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo() || {}
      windowWidth = Number(info.windowWidth || 0)
      windowHeight = Number(info.windowHeight || 0)
    }
  } catch (e) {}
  return { windowWidth, windowHeight }
}
