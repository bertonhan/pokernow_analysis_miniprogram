function normalizeScoreText(raw) {
  return String(raw || '')
    .trim()
    .replace(/，/g, ',')
    .replace(/,/g, '')
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/\s+/g, '')
}

function parseScore(raw) {
  const text = normalizeScoreText(raw)
  if (!text) return { empty: true, ok: false, value: 0 }
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return { empty: false, ok: false, value: 0 }
  const value = Number(text)
  if (!isFinite(value)) return { empty: false, ok: false, value: 0 }
  return { empty: false, ok: true, value: value }
}

function getDefaultMatchName() {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return `${month}.${day}德扑线下格局`
}

Page({
  data: {
    matchName: '',
    players: [],
    loadingPlayers: false,
    submitting: false,
    loadError: '',
    filledCount: 0,
    invalidCount: 0,
    totalPlayers: 0,
    sumNet: 0
  },

  onLoad() {
    this.setData({ matchName: getDefaultMatchName() })
    this.loadManualPlayers()
  },

  onPullDownRefresh() {
    this.loadManualPlayers({ pullDown: true })
  },

  loadManualPlayers(options) {
    const opts = options || {}
    const pullDown = !!opts.pullDown
    this.setData({
      loadingPlayers: true,
      loadError: ''
    })

    wx.cloud.callFunction({
      name: 'user_manager',
      data: { action: 'list_manual_players' },
      success: res => {
        const result = (res && res.result) || {}
        if (result.status !== 'ok') {
          const msg = result.msg || '加载 gejuId 失败'
          this.setData({ loadError: msg, players: [], totalPlayers: 0 })
          wx.showToast({ title: msg, icon: 'none' })
          return
        }

        const list = Array.isArray(result.data) ? result.data : []
        const players = list.map((item, idx) => ({
          index: idx + 1,
          gejuId: String((item && item.gejuId) || '').trim(),
          netInput: '',
          invalid: false
        }))

        this.setData({
          players: players,
          totalPlayers: players.length,
          loadError: players.length > 0 ? '' : 'users 里还没有可用 gejuId，请先在“我的”页完善档案'
        })
        this.recalculateSummary(players)
      },
      fail: err => {
        const msg = '加载 gejuId 失败，请检查云函数'
        console.error('[manual] load players failed:', err)
        this.setData({ loadError: msg, players: [], totalPlayers: 0 })
        wx.showToast({ title: msg, icon: 'none' })
      },
      complete: () => {
        this.setData({ loadingPlayers: false })
        if (pullDown) wx.stopPullDownRefresh()
      }
    })
  },

  onRefreshPlayers() {
    this.loadManualPlayers()
  },

  onInputMatchName(e) {
    this.setData({ matchName: e.detail.value })
  },

  onInputNet(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (Number.isNaN(index)) return

    const value = e.detail.value
    this.setData({
      [`players[${index}].netInput`]: value,
      [`players[${index}].invalid`]: false
    }, () => this.recalculateSummary())
  },

  recalculateSummary(sourcePlayers) {
    const players = sourcePlayers || this.data.players || []
    let filledCount = 0
    let invalidCount = 0
    let sumNet = 0

    players.forEach(one => {
      const parsed = parseScore(one.netInput)
      if (parsed.empty) return
      if (!parsed.ok) {
        invalidCount += 1
        return
      }
      filledCount += 1
      sumNet += parsed.value
    })

    this.setData({
      filledCount: filledCount,
      invalidCount: invalidCount,
      sumNet: Number(sumNet.toFixed(2)),
      totalPlayers: players.length
    })
  },

  collectSubmitRows() {
    const invalidIndexes = []
    const payload = []
    const players = this.data.players || []

    players.forEach((row, idx) => {
      const gejuId = String((row && row.gejuId) || '').trim()
      if (!gejuId) return

      const parsed = parseScore(row.netInput)
      if (parsed.empty) return
      if (!parsed.ok) {
        invalidIndexes.push(idx)
        return
      }

      payload.push({
        gejuId: gejuId,
        net: parsed.value
      })
    })

    return { invalidIndexes, payload }
  },

  markInvalidRows(invalidIndexes) {
    const invalidMap = {}
    const invalidSet = {}
    ;(invalidIndexes || []).forEach(index => {
      invalidSet[index] = true
    })
    ;(this.data.players || []).forEach((_, idx) => {
      invalidMap[`players[${idx}].invalid`] = !!invalidSet[idx]
    })
    this.setData(invalidMap)
  },

  onCreateManualMatch() {
    if (this.data.submitting) return

    const matchName = String(this.data.matchName || '').trim()
    if (!matchName) {
      wx.showToast({ title: '请输入本次格局名称', icon: 'none' })
      return
    }

    const { invalidIndexes, payload } = this.collectSubmitRows()
    if (invalidIndexes.length > 0) {
      this.markInvalidRows(invalidIndexes)
      wx.showToast({ title: `第${invalidIndexes[0] + 1}行成绩格式错误`, icon: 'none' })
      return
    }

    if (payload.length === 0) {
      wx.showToast({ title: '请至少填写1名选手成绩', icon: 'none' })
      return
    }

    this.markInvalidRows([])
    this.setData({ submitting: true })
    wx.showLoading({ title: '创建中...' })

    wx.cloud.callFunction({
      name: 'match_manager',
      data: {
        action: 'create_manual_match',
        matchName: matchName,
        players: payload
      },
      success: res => {
        const result = (res && res.result) || {}
        if (result.code !== 1) {
          wx.showToast({ title: result.msg || '创建失败', icon: 'none' })
          return
        }

        wx.showToast({ title: '创建成功' })
        const newGameId = String(result.gameId || '')
        if (!newGameId) return

        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/match/detail/index?id=${newGameId}`
          })
        }, 220)
      },
      fail: err => {
        console.error('[manual] create manual match failed:', err)
        wx.showToast({ title: '创建失败，请稍后重试', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
      }
    })
  }
})
