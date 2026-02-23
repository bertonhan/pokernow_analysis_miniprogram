const app = getApp()

Page({
  data: {
    authChecking: true,
    isLoggedIn: false,
    list: [],
    loading: false,
    building: false,
    page: 1,
    pageSize: 20,
    hasMore: true,
    total: 0,
    mode: 'bound',
    listAreaHeight: 560
  },

  onReady() {
    this.calcListAreaHeight()
  },

  onShow() {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.checkAccess()
  },

  onResize() {
    this.calcListAreaHeight()
  },

  checkAccess() {
    this.setData({ authChecking: true })
    app.checkLoginStatus(isLoggedIn => {
      this.setData({
        authChecking: false,
        isLoggedIn: !!isLoggedIn
      })
      this.calcListAreaHeight()
      if (isLoggedIn) this.reloadList()
    })
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

  onPlayerAvatarError(e) {
    const index = Number(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.index
      : -1)
    if (index < 0) return
    const list = Array.isArray(this.data.list) ? this.data.list.slice() : []
    if (!list[index]) return
    if (!list[index].avatarUrl) return
    list[index].avatarUrl = ''
    this.setData({ list: list })
  },

  goToProfile() {
    wx.switchTab({
      url: '/pages/profile/index'
    })
  },

  calcListAreaHeight() {
    const win = getWindowMetrics()
    const windowHeight = Number(win.windowHeight || 0)
    if (!windowHeight) return

    if (this.data.authChecking || !this.data.isLoggedIn) {
      const fallback = Math.max(windowHeight - 20, 360)
      if (Math.abs(fallback - this.data.listAreaHeight) > 1) {
        this.setData({ listAreaHeight: fallback })
      }
      return
    }

    wx.nextTick(() => {
      const query = this.createSelectorQuery()
      query.select('.top-fixed-zone').boundingClientRect()
      query.exec(res => {
        const topRect = res && res[0]
        const topHeight = topRect && topRect.height ? Number(topRect.height) : 0
        const nextHeight = Math.max(windowHeight - topHeight - 24, 320)
        if (Math.abs(nextHeight - this.data.listAreaHeight) > 1) {
          this.setData({ listAreaHeight: Math.floor(nextHeight) })
        }
      })
    })
  }
})

function safeInt(value) {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

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
