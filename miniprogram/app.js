// app.js
App({
  globalData: {
    isLoggedIn: false, // 是否登录
    userInfo: null,    // 用户信息
    hasCheckedLogin: false, // 【新增】标记：是否已经执行过初始化检查
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
    wx.cloud.callFunction({
      name: 'user_manager',
      data: { action: 'get' },
      success: res => {
        // 无论成功还是失败，都标记为“已检查过”
        that.globalData.hasCheckedLogin = true; 

        if (res.result.data) {
          that.globalData.isLoggedIn = true;
          that.globalData.userInfo = res.result.data;
        } else {
          that.globalData.isLoggedIn = false;
          that.globalData.userInfo = null;
        }
        if (callback) callback(that.globalData.isLoggedIn);
      },
      fail: err => {
        console.error('登录检查失败', err);
        that.globalData.hasCheckedLogin = true; // 失败也算检查过
        if (callback) callback(false);
      }
    })
  }
});
