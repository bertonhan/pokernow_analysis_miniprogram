// app.js
App({
  globalData: {
    isLoggedIn: false, // 是否登录
    userInfo: null,    // 用户信息
    hasCheckedLogin: false, // 【新增】标记：是否已经执行过初始化检查
    loginCheckInFlight: false,
    loginCheckCallbacks: [],
    openid: null,
    openidReady: false,
    openidCallbacks: []
  },
  initOpenId: function () {
    const that = this
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        that.globalData.openid = res.result.openid
        that.globalData.openidReady = true
  
        // 触发所有等待 openid 的回调
        const cbs = that.globalData.openidCallbacks || []
        cbs.forEach(fn => fn(that.globalData.openid))
        that.globalData.openidCallbacks = []
      },
      fail: err => {
        console.error('获取 openid 失败', err)
        that.globalData.openidReady = false
      }
    })
  },
  
  getOpenId: function (callback) {
    if (this.globalData.openidReady && this.globalData.openid) {
      callback(this.globalData.openid)
    } else {
      this.globalData.openidCallbacks.push(callback)
      // 防止 initOpenId 没跑：补一次
      if (!this.globalData.openidReady) this.initOpenId()
    }
  },  
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      const supportsRealtimeAction = typeof wx.reportRealtimeAction === 'function' ||
        (typeof wx.canIUse === 'function' && wx.canIUse('reportRealtimeAction'))
      wx.cloud.init({
        env: 'cloud1-2gpsa3y0fb62239f', // 请确保这里是你真实的环境ID
        // 低版本基础库 / Worker 环境不支持实时上报时，关闭 traceUser，避免进入详情页时出现兼容告警
        traceUser: !!supportsRealtimeAction,
      });
      if (!supportsRealtimeAction) {
        console.warn('[app] 当前环境不支持 reportRealtimeAction，已降级关闭 traceUser')
      }
    }
    // 启动时自动检查
    this.initOpenId()
    this.checkLoginStatus();
  },

  checkLoginStatus: function (callback) {
    const that = this;
    const cb = typeof callback === 'function' ? callback : null

    if (that.globalData.hasCheckedLogin) {
      if (cb) cb(that.globalData.isLoggedIn)
      return
    }

    if (cb) that.globalData.loginCheckCallbacks.push(cb)

    if (that.globalData.loginCheckInFlight) return

    that.globalData.loginCheckInFlight = true

    wx.cloud.callFunction({
      name: 'user_manager',
      data: { action: 'get' },
      success: res => {
        const userData = res && res.result ? res.result.data : null
        that.finishLoginCheck(!!userData, userData || null)
      },
      fail: err => {
        console.error('登录检查失败', err)
        that.finishLoginCheck(false, null)
      }
    })
  },

  finishLoginCheck: function (isLoggedIn, userInfo) {
    this.globalData.hasCheckedLogin = true
    this.globalData.loginCheckInFlight = false
    this.globalData.isLoggedIn = !!isLoggedIn
    this.globalData.userInfo = isLoggedIn ? (userInfo || null) : null

    const callbacks = this.globalData.loginCheckCallbacks || []
    this.globalData.loginCheckCallbacks = []
    callbacks.forEach(fn => {
      try {
        fn(this.globalData.isLoggedIn)
      } catch (e) {
        console.error('[app] login callback error', e)
      }
    })
  }
});
