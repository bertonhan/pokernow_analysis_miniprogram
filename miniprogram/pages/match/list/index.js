// miniprogram/pages/match/list/index.js
const app = getApp()
const ADMIN_LIST = [ 'oVJBv3Z6GzqygarChiUpuMfpPUxw' ]

Page({
  data: {
    isLoggedIn: false, 
    inputLink: '',
    matchList: [],
    isAdmin: false, 
    openid: ''
  },

  // === 1. 滑动交互 (修复：只保留这一个定义) ===
  onSwipeEnd(e) {
    const { x } = e.detail
    const index = e.currentTarget.dataset.index
    const btnWidth = 80 
    
    if (x < -btnWidth / 2) {
      this.setData({ [`matchList[${index}].x`]: -btnWidth * 2 })
    } else {
      this.setData({ [`matchList[${index}].x`]: 0 })
    }
  },

  onLoad() { this.checkAdmin() },

  onShow() {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.checkAccess(); 
  },

  // === 2. 权限与加载 ===
  checkAccess() {
    if (app.globalData.isLoggedIn) {
      this.setData({ isLoggedIn: true });
      this.checkAdmin();
      this.loadList();
      if(!this.timer) this.timer = setInterval(() => { this.loadList() }, 5000);
    } else if (!app.globalData.hasCheckedLogin) {
      app.checkLoginStatus((isLoggedIn) => {
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
    } else {
      this.setData({ isLoggedIn: false, matchList: [] });
      if(this.timer) clearInterval(this.timer); this.timer = null;
    }
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
    wx.cloud.callFunction({
      name: 'match_manager',
      data: { action: 'list' },
      success: res => {
        // 安全检查，防止 map 报错
        if (res.result && res.result.data) {
          const newList = res.result.data.map(item => Object.assign({}, item, { x: 0 }))
          this.setData({ matchList: newList })
        }
      }
    })
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
  goToProfile() { wx.switchTab({ url: '/pages/profile/index' }) }
})
