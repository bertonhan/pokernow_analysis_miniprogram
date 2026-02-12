// pages/profile/index.js
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2SJPGic3TB3C3uhG7qY5QDkq96fAUq_0'; 

Page({
  data: {
    defaultAvatar: defaultAvatar,
    
    // 状态控制
    isLoggedIn: false,   // 是否已登录
    showLoginForm: false, // 是否显示表单
    isEditing: false,    // 是否是修改模式（区别于首次登录）

    // 表单数据
    tempAvatarUrl: '', 
    nickName: '',
    gejuId: '',
    
    // 最终用户信息
    userInfo: null 
  },
  onShow() {
    // 告诉 TabBar 我是第 2 个 (我的)
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    
    // 如果你有其他在 onShow 需要执行的逻辑放在这里
  },
  onLoad() {
    // 页面加载时，静默检查云端是否有数据
    // 如果有数据，自动帮用户切到登录态（提升体验）；如果没数据，就保持未登录态
    this.checkCloudUser()
  },

  // === 核心逻辑：检查用户状态 ===
  checkCloudUser() {
    const app = getApp(); // 获取全局实例
    wx.showLoading({ title: '加载中' })
    
    // 直接复用 app.js 里的检查方法，省得写两遍
    app.checkLoginStatus((isLoggedIn) => {
      wx.hideLoading();
      if (isLoggedIn) {
        this.setData({
          isLoggedIn: true,
          userInfo: app.globalData.userInfo, // 从全局拿
          // 同步表单数据
          tempAvatarUrl: app.globalData.userInfo.avatarUrl,
          nickName: app.globalData.userInfo.nickName,
          gejuId: app.globalData.userInfo.gejuId
        })
      } else {
        this.setData({ isLoggedIn: false })
      }
    });
  },

  // === 按钮动作区域 ===

  // 1. 点击“登录/注册”
  onTapLogin() {
    this.setData({
      showLoginForm: true,
      isEditing: false, // 这是新注册
      // 重置表单
      tempAvatarUrl: '',
      nickName: '',
      gejuId: ''
    })
  },

  // 2. 点击“修改档案”
  onTapEdit() {
    this.setData({
      showLoginForm: true,
      isEditing: true // 这是修改
      // 此时表单里已经是 checkCloudUser 加载好的旧数据了，无需重置
    })
  },

  // 3. 点击“退出登录”
  onTapLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          // 【新增】清空全局
          const app = getApp();
          app.globalData.isLoggedIn = false;
          app.globalData.userInfo = null;

          // 清空本地
          this.setData({
            isLoggedIn: false,
            userInfo: null,
            tempAvatarUrl: '',
            nickName: '',
            gejuId: ''
          })
          wx.showToast({ title: '已退出', icon: 'none' })
        }
      }
    })
  },

  // 4. 表单：取消
  cancelLogin() {
    this.setData({ showLoginForm: false })
  },

  // === 表单输入处理 ===
  
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail 
    this.setData({ tempAvatarUrl: avatarUrl })
  },

  // 1. 监听输入过程（用户手动打字时）
  onNicknameInput(e) {
    // 实时记录
    this.setData({ nickName: e.detail.value })
  },

  // 2. 监听失焦/确认（用户点击键盘上方的“微信昵称”选项时通常触发这个）
  onNicknameChange(e) {
    const value = e.detail.value
    // 只有当值不为空时才更新，防止误触清空
    if (value) {
      this.setData({ nickName: value })
    }
  },

  onGejuIdChange(e) {
    this.setData({ gejuId: e.detail.value })
  },

  // === 提交数据 (登录/保存) ===
  async confirmLogin() {
    const { tempAvatarUrl, nickName, gejuId } = this.data;
    const currentAvatar = this.data.userInfo && this.data.userInfo.avatarUrl;

    if (!tempAvatarUrl && !currentAvatar) {
       return wx.showToast({ title: '请选择头像', icon: 'none' });
    }
    if (!nickName || !gejuId) {
      return wx.showToast({ title: '请完善信息', icon: 'none' });
    }

    wx.showLoading({ title: '保存中...' });

    try {
      let finalAvatarUrl = tempAvatarUrl;
      
      // 只有当头像路径是临时路径时（新上传的），才需要上传到云存储
      // 如果是修改档案但没改头像，tempAvatarUrl 会是 cloud:// 开头的旧地址，不用重新传
      if (tempAvatarUrl && (tempAvatarUrl.includes('tmp') || tempAvatarUrl.includes('wxfile'))) {
        const cloudPath = `avatars/${Date.now()}-${Math.floor(Math.random()*1000)}.png`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempAvatarUrl,
        });
        finalAvatarUrl = uploadRes.fileID;
      }

      // 调用云函数保存
      await wx.cloud.callFunction({
        name: 'user_manager',
        data: {
          action: 'update',
          userData: {
            avatarUrl: finalAvatarUrl,
            nickName: nickName,
            gejuId: gejuId
          }
        }
      });

      wx.hideLoading();
      // ... 上面是上传代码 ...

      const newUserInfo = {
        avatarUrl: finalAvatarUrl,
        nickName: nickName,
        gejuId: gejuId
      };

      // 【新增】同步到全局
      const app = getApp();
      app.globalData.isLoggedIn = true;
      app.globalData.userInfo = newUserInfo;

      // 更新本地
      this.setData({
        isLoggedIn: true,
        showLoginForm: false,
        userInfo: newUserInfo
      });
      // ...

      wx.showToast({ title: this.data.isEditing ? '修改成功' : '登录成功' });

    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
})
