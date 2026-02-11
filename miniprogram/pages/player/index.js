// pages/player/index.js
const app = getApp()

Page({
  data: {
    isLoggedIn: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.checkAccess();
  },

  checkAccess() {
    // 1. 已登录
    if (app.globalData.isLoggedIn) {
      this.setData({ isLoggedIn: true })
    } 
    // 2. 未登录，且未初始化 -> 尝试自动登录
    else if (!app.globalData.hasCheckedLogin) {
      app.checkLoginStatus(isLoggedIn => {
        this.setData({ isLoggedIn: isLoggedIn })
      })
    } 
    // 3. 未登录，已初始化 -> 保持锁定 (用户手动退出)
    else {
      this.setData({ isLoggedIn: false })
    }
  },

  goToProfile() {
    wx.switchTab({
      url: '/pages/profile/index'
    })
  }
})