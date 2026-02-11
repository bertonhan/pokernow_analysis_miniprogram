// app.js
App({
  globalData: {
    isLoggedIn: false, // 是否登录
    userInfo: null,    // 用户信息
    hasCheckedLogin: false // 【新增】标记：是否已经执行过初始化检查
  },

  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-2gpsa3y0fb62239f', // 请确保这里是你真实的环境ID
        traceUser: true,
      });
    }

    // 启动时自动检查
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