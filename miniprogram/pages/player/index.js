const app = getApp()

Page({
  data: {
    isLoggedIn: false,
    list: [],
    loading: false,
    building: false,
    page: 1,
    pageSize: 20,
    hasMore: true,
    total: 0,
    mode: 'bound'
  },

  onShow() {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.checkAccess()
  },

  onPullDownRefresh() {
    this.reloadList(() => wx.stopPullDownRefresh())
  },

  checkAccess() {
    if (app.globalData.isLoggedIn) {
      this.setData({ isLoggedIn: true })
      this.reloadList()
      return
    }

    if (!app.globalData.hasCheckedLogin) {
      app.checkLoginStatus(isLoggedIn => {
        this.setData({ isLoggedIn: isLoggedIn })
        if (isLoggedIn) this.reloadList()
      })
      return
    }

    this.setData({ isLoggedIn: false })
  },

  reloadList(done) {
    this.setData({
      list: [],
      page: 1,
      hasMore: true,
      total: 0
    })
    this.loadNextPage(done)
  },

  loadNextPage(done) {
    if (this.data.loading || !this.data.hasMore || !this.data.isLoggedIn) {
      if (typeof done === 'function') done()
      return
    }

    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: 'player_global_query',
      data: {
        action: 'list',
        page: this.data.page,
        pageSize: this.data.pageSize,
        mode: this.data.mode
      },
      success: res => {
        const result = (res && res.result) || {}
        if (result.code !== 1) {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          return
        }

        const meta = result.meta || {}
        const rows = Array.isArray(result.data) ? result.data : []
        this.setData({
          list: this.data.list.concat(rows),
          page: safeInt(this.data.page) + 1,
          hasMore: !!meta.hasMore,
          total: safeInt(meta.total)
        })
      },
      fail: err => {
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
        console.error('[player/index] load list failed:', err)
      },
      complete: () => {
        this.setData({ loading: false })
        if (typeof done === 'function') done()
      }
    })
  },

  onScrollToLower() {
    this.loadNextPage()
  },

  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.mode) return
    this.setData({ mode: mode })
    this.reloadList()
  },

  rebuildGlobalStats() {
    if (this.data.building) return
    wx.showModal({
      title: '刷新玩家数据',
      content: '将重新聚合玩家总榜数据，可能需要几十秒，是否继续？',
      success: res => {
        if (!res.confirm) return

        this.setData({ building: true })
        wx.showLoading({ title: '刷新中...' })
        wx.cloud.callFunction({
          name: 'player_global_query',
          data: {
            action: 'rebuild',
            awaitBuild: true
          },
          success: r => {
            const result = (r && r.result) || {}
            if (result.code !== 1) {
              wx.showToast({ title: result.msg || '刷新失败', icon: 'none' })
              return
            }
            wx.showToast({ title: '数据已刷新', icon: 'success' })
            this.reloadList()
          },
          fail: err => {
            console.error('[player/index] rebuild failed:', err)
            wx.showToast({ title: '刷新失败，请重试', icon: 'none' })
          },
          complete: () => {
            wx.hideLoading()
            this.setData({ building: false })
          }
        })
      }
    })
  },

  goDetail(e) {
    const key = encodeURIComponent(e.currentTarget.dataset.key || '')
    if (!key) return
    wx.navigateTo({
      url: '/pages/player/detail/index?key=' + key
    })
  },

  goToProfile() {
    wx.switchTab({
      url: '/pages/profile/index'
    })
  }
})

function safeInt(value) {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}
