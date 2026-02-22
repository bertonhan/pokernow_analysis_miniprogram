const RECENT_MATCH_SINCE_TS = Date.parse('2026-01-01T00:00:00+08:00')

function toTs(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') {
    if (!isFinite(value)) return 0
    return value > 1e12 ? value : value * 1000
  }

  const raw = String(value).trim()
  if (!raw) return 0

  const localMatch = raw.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (localMatch) {
    const y = Number(localMatch[1])
    const m = Number(localMatch[2]) - 1
    const d = Number(localMatch[3])
    const hh = Number(localMatch[4] || 0)
    const mm = Number(localMatch[5] || 0)
    const ss = Number(localMatch[6] || 0)
    const tsLocal = new Date(y, m, d, hh, mm, ss).getTime()
    return isNaN(tsLocal) ? 0 : tsLocal
  }

  if (/^\d{10,13}$/.test(raw)) {
    const num = Number(raw)
    if (!isFinite(num)) return 0
    return raw.length === 10 ? num * 1000 : num
  }

  let normalized = raw
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    normalized = raw.replace(' ', 'T')
  }
  if (/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    normalized = raw
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) || /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(normalized)) {
    normalized += ':00'
  }

  let ts = Date.parse(normalized)
  if (!isNaN(ts)) return ts

  // 最后兜底：将短横线日期替换为斜杠再尝试一次
  ts = Date.parse(raw.replace(/-/g, '/'))
  return isNaN(ts) ? 0 : ts
}

function formatDateOnly(value) {
  const raw = String(value || '').trim()
  const pureDateMatch = raw.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/)
  if (pureDateMatch) {
    const y = pureDateMatch[1]
    const m = pureDateMatch[2]
    const d = pureDateMatch[3]
    return y + '-' + m + '-' + d
  }

  const ts = toTs(value)
  if (!ts) {
    return raw ? raw.slice(0, 10) : ''
  }
  const dt = new Date(ts)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

function normalizeAliasList(values) {
  const out = []
  ;(Array.isArray(values) ? values : []).forEach(v => {
    const one = String(v || '').trim()
    if (!one) return
    if (out.indexOf(one) !== -1) return
    out.push(one)
  })
  return out
}

function normalizeDetail(detail) {
  const next = Object.assign({}, detail || {})
  const recentMatches = Array.isArray(next.recentMatches) ? next.recentMatches : []
  next.recentMatches = recentMatches
    .map(item => {
      const one = item || {}
      const createTimeRaw = String(one.createTime || one.endTime || '')
      const createTs = toTs(createTimeRaw)
      return {
        gameId: one.gameId || '',
        matchName: one.matchName || '',
        net: Number(one.net || 0),
        hands: Number(one.hands || 0),
        createTime: formatDateOnly(createTimeRaw),
        createTs: createTs,
        aliases: normalizeAliasList(one.aliases)
      }
    })
    .filter(item => item.createTs >= RECENT_MATCH_SINCE_TS)
    .sort((a, b) => b.createTs - a.createTs)
    .map(item => ({
      gameId: item.gameId,
      matchName: item.matchName,
      net: item.net,
      hands: item.hands,
      createTime: item.createTime,
      aliases: item.aliases
    }))
  return next
}

Page({
  data: {
    globalPlayerKey: '',
    loading: true,
    detail: null
  },

  onLoad(options) {
    const key = decodeURIComponent((options && options.key) || '')
    if (!key) {
      wx.showToast({ title: '缺少玩家标识', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 800)
      return
    }
    this.setData({ globalPlayerKey: key })
    this.loadDetail()
  },

  onPullDownRefresh() {
    this.loadDetail(() => wx.stopPullDownRefresh())
  },

  loadDetail(done) {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'player_global_query',
      data: {
        action: 'detail',
        globalPlayerKey: this.data.globalPlayerKey
      },
      success: res => {
        const result = (res && res.result) || {}
        if (result.code !== 1 || !result.data) {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ detail: null })
          return
        }
        this.setData({ detail: normalizeDetail(result.data) })
      },
      fail: err => {
        console.error('[player/detail] load failed:', err)
        wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      },
      complete: () => {
        this.setData({ loading: false })
        if (typeof done === 'function') done()
      }
    })
  },

  openMatch(e) {
    const gameId = e.currentTarget.dataset.gameid
    if (!gameId) return
    wx.navigateTo({
      url: '/pages/match/detail/index?id=' + gameId
    })
  }
})
