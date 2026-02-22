const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MATCH_COLLECTION = 'matches'
const PLAYER_STATS_COLLECTION = 'match_player_stats'
const BINDING_COLLECTION = 'match_player_bindings'
const USER_COLLECTION = 'users'
const GLOBAL_COLLECTION = 'player_global_stats'
const RECENT_MATCH_SINCE_TS = Date.parse('2026-01-01T00:00:00+08:00')

const COUNT_KEYS = [
  'hands',
  'vpipHands',
  'pfrHands',
  'limpHands',
  'sawFlopHands',
  'bets',
  'raises',
  'calls',
  'checks',
  'folds',
  'showdowns',
  'showdownWins',
  'cbetOpp',
  'cbetCount',
  'bet3Opp',
  'bet3Count',
  'allInCnt',
  'allInWins',
  'foldTo3BetOpp',
  'foldTo3BetCount',
  'bet4Opp',
  'bet4Count',
  'isolateOpp',
  'isolateCount',
  'foldToFlopCbetOpp',
  'foldToFlopCbetCount',
  'raiseVsFlopCbetOpp',
  'raiseVsFlopCbetCount',
  'sprFlopSum',
  'sprFlopCnt',
  'sprTurnSum',
  'sprTurnCnt',
  'sprRiverSum',
  'sprRiverCnt',
  'luckHands',
  'luckExpectedWins',
  'luckActualWins',
  'luckGoodHits',
  'luckBadBeats',
  'luckAllInDogWins',
  'luckAllInFavLoses',
  'charityAttempts',
  'charityFails'
]

const FALLBACK_RATE_KEYS = [
  'af',
  'wtsd',
  'wsd',
  'cbet',
  'bet3',
  'allIn',
  'foldTo3Bet',
  'bet4',
  'isolate',
  'foldToFlopCbet',
  'raiseVsFlopCbet'
]

function safeNumber(value) {
  const n = Number(value)
  return isNaN(n) ? 0 : n
}

function ratio(numerator, denominator) {
  if (!denominator) return 0
  return numerator / denominator
}

function pct(numerator, denominator) {
  return Number((ratio(numerator, denominator) * 100).toFixed(1))
}

function toTs(value) {
  if (!value) return 0
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const ts = new Date(raw).getTime()
  return isNaN(ts) ? 0 : ts
}

function buildBindingKey(gameId, playerId) {
  return String(gameId || '').trim() + '::' + String(playerId || '').trim()
}

function buildGameUserKey(gameId, userId) {
  return String(gameId || '').trim() + '::' + String(userId || '').trim()
}

function pushUnique(arr, value) {
  const v = String(value || '').trim()
  if (!v) return
  if (arr.indexOf(v) === -1) arr.push(v)
}

function toDocId(globalPlayerKey) {
  return 'pgs_' + encodeURIComponent(globalPlayerKey).replace(/%/g, '_')
}

function extractStyleTags(row) {
  if (Array.isArray(row.styleTags)) {
    return row.styleTags.map(v => String(v || '').trim()).filter(Boolean)
  }
  return String(row.style || '')
    .split('/')
    .map(v => String(v || '').trim())
    .filter(Boolean)
}

function recoverCount(percentValue, denominator) {
  const den = safeNumber(denominator)
  if (den <= 0) return 0
  return Math.max(0, Math.round((safeNumber(percentValue) / 100) * den))
}

function hasRawCounts(raw) {
  if (!raw || typeof raw !== 'object') return false
  return COUNT_KEYS.some(key => safeNumber(raw[key]) > 0)
}

function makeEmptyCounts() {
  const out = {}
  COUNT_KEYS.forEach(key => {
    out[key] = 0
  })
  return out
}

function resolveRawCounts(row) {
  const out = makeEmptyCounts()
  const raw = row && row.rawCounts ? row.rawCounts : null
  const hands = safeNumber(row.hands)

  if (hasRawCounts(raw)) {
    COUNT_KEYS.forEach(key => {
      out[key] = safeNumber(raw[key])
    })
    if (out.hands <= 0 && hands > 0) out.hands = hands
    return { counts: out, hasRaw: true }
  }

  out.hands = hands
  out.vpipHands = recoverCount(row.vpip, hands)
  out.pfrHands = recoverCount(row.pfr, hands)
  out.limpHands = recoverCount(row.limp, hands)
  return { counts: out, hasRaw: false }
}

function initFallbackRates() {
  const out = {}
  FALLBACK_RATE_KEYS.forEach(key => {
    out[key] = { sum: 0, weight: 0 }
  })
  return out
}

function addFallbackRate(fallback, key, value, weight) {
  if (!fallback[key]) return
  const w = safeNumber(weight)
  const v = safeNumber(value)
  if (w <= 0) return
  fallback[key].sum += v * w
  fallback[key].weight += w
}

function getFallbackRate(fallback, key, digits) {
  if (!fallback[key] || !fallback[key].weight) return null
  const val = fallback[key].sum / fallback[key].weight
  const d = typeof digits === 'number' ? digits : 1
  return Number(val.toFixed(d))
}

function pushTag(styles, tag) {
  if (!tag) return
  if (styles.indexOf(tag) === -1) styles.push(tag)
}

function generateStyles(stats, net) {
  const styles = []

  const vpip = ratio(stats.vpipHands, stats.hands)
  const pfr = ratio(stats.pfrHands, stats.hands)
  const limpRate = ratio(stats.limpHands, stats.hands)
  const afBase = stats.calls || 0
  const afTop = (stats.bets || 0) + (stats.raises || 0)
  const af = afBase > 0 ? (afTop / afBase) : (afTop > 0 ? 10 : 0)

  const cbetFreq = ratio(stats.cbetCount, stats.cbetOpp)
  const bet3Freq = ratio(stats.bet3Count, stats.bet3Opp)
  const foldTo3Bet = ratio(stats.foldTo3BetCount, stats.foldTo3BetOpp)
  const bet4Freq = ratio(stats.bet4Count, stats.bet4Opp)
  const isolateFreq = ratio(stats.isolateCount, stats.isolateOpp)
  const foldToFlopCbet = ratio(stats.foldToFlopCbetCount, stats.foldToFlopCbetOpp)
  const raiseVsFlopCbet = ratio(stats.raiseVsFlopCbetCount, stats.raiseVsFlopCbetOpp)
  const pfrByVpip = vpip > 0 ? (pfr / vpip) : 0
  const luckDiff = safeNumber(stats.luckActualWins) - safeNumber(stats.luckExpectedWins)
  const charityRate = ratio(stats.charityFails, stats.charityAttempts)

  if (stats.hands >= 10) {
    const isLoose = vpip >= 0.33
    const isTight = vpip <= 0.22
    const isAggressivePreflop = pfr >= 0.16 && pfrByVpip >= 0.45
    if (isLoose) pushTag(styles, isAggressivePreflop ? '松凶' : '松弱')
    else if (isTight) pushTag(styles, isAggressivePreflop ? '紧凶' : '紧弱')
  }

  if (stats.hands >= 12 && vpip >= 0.28 && limpRate >= 0.10 && limpRate >= pfr * 0.8 && stats.limpHands >= 3) {
    pushTag(styles, 'limper')
  }
  if (stats.bet3Opp >= 5 && bet3Freq >= 0.14) pushTag(styles, '3bet压制')
  if (stats.bet4Opp >= 3 && bet4Freq >= 0.16) pushTag(styles, '4bet战士')
  if (stats.isolateOpp >= 4 && isolateFreq >= 0.30) pushTag(styles, '剥削')
  if (stats.foldTo3BetOpp >= 4 && foldTo3Bet >= 0.62) pushTag(styles, '怕3bet')

  if (stats.cbetOpp >= 5 && cbetFreq >= 0.62) pushTag(styles, '持续施压')
  if (stats.foldToFlopCbetOpp >= 4 && foldToFlopCbet >= 0.62) pushTag(styles, '翻后保守')
  if (stats.raiseVsFlopCbetOpp >= 4 && raiseVsFlopCbet >= 0.22) pushTag(styles, '翻后反击')
  if (af >= 2.8) pushTag(styles, '激进')
  else if (af > 0 && af < 0.9) pushTag(styles, '跟注')

  if (stats.luckHands >= 4) {
    if (luckDiff >= 0.9 || stats.luckAllInDogWins >= 2) pushTag(styles, '天选')
    else if (luckDiff >= 0.45 || stats.luckGoodHits >= 2) pushTag(styles, '欧皇')

    if (luckDiff <= -0.9 || stats.luckAllInFavLoses >= 2) pushTag(styles, '倒霉')
    else if (luckDiff <= -0.45 || stats.luckBadBeats >= 2) pushTag(styles, '非酋')
  }

  if (stats.luckAllInDogWins >= 2) pushTag(styles, '跑马王')
  if (stats.charityAttempts >= 2 && stats.charityFails >= 2 && charityRate >= 0.7) pushTag(styles, '慈善家')
  if (vpip > 0.40 && net > 5000) pushTag(styles, '天选')
  if (vpip < 0.30 && net < -5000) pushTag(styles, '倒霉')

  if (styles.length === 0) pushTag(styles, '平衡')
  return styles
}

function resolveIdentity(row) {
  const gameId = String(row.gameId || '').trim()
  const playerId = String(row.playerId || '').trim()
  const userId = String(row.userId || '').trim()
  // 兼容历史数据：部分旧行可能 isUser 标记异常，但 userId 已经存在。
  // 对聚合身份来说，只要 userId 非空就应视为已绑定。
  const isBound = !!userId

  if (isBound) {
    const globalPlayerKey = 'user:' + userId
    return {
      globalPlayerKey: globalPlayerKey,
      docId: toDocId(globalPlayerKey),
      isBound: true,
      entityType: 'bound',
      userId: userId,
      gameId: gameId,
      playerId: playerId
    }
  }

  const globalPlayerKey = 'solo:' + gameId + ':' + playerId
  return {
    globalPlayerKey: globalPlayerKey,
    docId: toDocId(globalPlayerKey),
    isBound: false,
    entityType: 'solo',
    userId: '',
    gameId: gameId,
    playerId: playerId
  }
}

function initAggregate(identity, row) {
  return {
    _id: identity.docId,
    globalPlayerKey: identity.globalPlayerKey,
    entityType: identity.entityType,
    isBound: identity.isBound,
    userId: identity.userId,
    soloGameId: identity.isBound ? '' : identity.gameId,
    soloPlayerId: identity.isBound ? '' : identity.playerId,
    displayName: String(row.playerName || row.userId || row.playerId || '未知选手'),
    avatarUrl: String(row.avatarUrl || ''),
    boundNames: [],
    gameSet: {},
    recentMatchMap: {},
    styleVoteMap: {},
    counts: makeEmptyCounts(),
    fallbackRates: initFallbackRates(),
    totalNet: 0,
    rowCount: 0,
    rawReadyRows: 0
  }
}

function addStyleVotes(agg, row) {
  extractStyleTags(row).forEach(tag => {
    const t = String(tag || '').trim()
    if (!t) return
    agg.styleVoteMap[t] = (agg.styleVoteMap[t] || 0) + 1
  })
}

function collectBoundNamesFromRow(row) {
  const names = []
  ;(row.boundNames || []).forEach(name => pushUnique(names, name))
  // 兼容旧数据：历史行可能没有 boundNames，只能退回 playerName
  if (names.length === 0) pushUnique(names, row.playerName)
  return names
}

function addNames(agg, row) {
  if (!agg.isBound) return
  collectBoundNamesFromRow(row).forEach(name => pushUnique(agg.boundNames, name))
}

function collectRowAliases(row, isBound) {
  if (!isBound) return []
  return collectBoundNamesFromRow(row)
}

function addRecentMatch(agg, row, matchMeta, gameUserAliasMap) {
  const gameId = String(row.gameId || '')
  if (!gameId) return
  const createTs = matchMeta ? matchMeta.createTs : toTs(row.createTime || row.updateTime)
  const createTime = matchMeta ? matchMeta.createTime : (row.createTime || row.updateTime || '')
  const endTs = matchMeta ? matchMeta.endTs : toTs(row.updateTime)
  const endTime = matchMeta ? matchMeta.endTime : (row.updateTime || '')
  const key = gameId
  if (!agg.recentMatchMap[key]) {
    agg.recentMatchMap[key] = {
      gameId: gameId,
      matchName: matchMeta ? matchMeta.name : '',
      net: 0,
      hands: 0,
      createTime: createTime || '',
      createTs: createTs || 0,
      endTime: endTime || '',
      endTs: endTs || 0,
      aliases: []
    }
  }

  const one = agg.recentMatchMap[key]
  one.net += safeNumber(row.net)
  one.hands += safeNumber(row.hands)
  if (safeNumber(createTs) > safeNumber(one.createTs)) {
    one.createTs = safeNumber(createTs)
    one.createTime = createTime || one.createTime
  }
  if (safeNumber(endTs) > safeNumber(one.endTs)) {
    one.endTs = safeNumber(endTs)
    one.endTime = endTime || one.endTime
  }
  if (matchMeta && matchMeta.name) one.matchName = matchMeta.name
  collectRowAliases(row, agg.isBound).forEach(alias => pushUnique(one.aliases, alias))
  if (agg.isBound && agg.userId && gameUserAliasMap) {
    const gameUserKey = buildGameUserKey(gameId, agg.userId)
    ;(gameUserAliasMap[gameUserKey] || []).forEach(alias => pushUnique(one.aliases, alias))
  }
}

function addFallbackRatesByRow(agg, row, hasRaw) {
  const weight = Math.max(1, safeNumber(row.hands))
  const metrics = [
    ['af', row.af],
    ['wtsd', row.wtsd],
    ['wsd', row.wsd],
    ['cbet', row.cbet],
    ['bet3', row.bet3],
    ['allIn', row.allIn],
    ['foldTo3Bet', row.foldTo3Bet],
    ['bet4', row.bet4],
    ['isolate', row.isolate],
    ['foldToFlopCbet', row.foldToFlopCbet],
    ['raiseVsFlopCbet', row.raiseVsFlopCbet]
  ]

  if (!hasRaw) {
    metrics.forEach(one => addFallbackRate(agg.fallbackRates, one[0], one[1], weight))
    return
  }

  if (safeNumber(agg.counts.calls) <= 0) addFallbackRate(agg.fallbackRates, 'af', row.af, weight)
  if (safeNumber(agg.counts.sawFlopHands) <= 0) addFallbackRate(agg.fallbackRates, 'wtsd', row.wtsd, weight)
  if (safeNumber(agg.counts.showdowns) <= 0) addFallbackRate(agg.fallbackRates, 'wsd', row.wsd, weight)
  if (safeNumber(agg.counts.cbetOpp) <= 0) addFallbackRate(agg.fallbackRates, 'cbet', row.cbet, weight)
  if (safeNumber(agg.counts.bet3Opp) <= 0) addFallbackRate(agg.fallbackRates, 'bet3', row.bet3, weight)
  if (safeNumber(agg.counts.allInCnt) <= 0) addFallbackRate(agg.fallbackRates, 'allIn', row.allIn, weight)
  if (safeNumber(agg.counts.foldTo3BetOpp) <= 0) addFallbackRate(agg.fallbackRates, 'foldTo3Bet', row.foldTo3Bet, weight)
  if (safeNumber(agg.counts.bet4Opp) <= 0) addFallbackRate(agg.fallbackRates, 'bet4', row.bet4, weight)
  if (safeNumber(agg.counts.isolateOpp) <= 0) addFallbackRate(agg.fallbackRates, 'isolate', row.isolate, weight)
  if (safeNumber(agg.counts.foldToFlopCbetOpp) <= 0) addFallbackRate(agg.fallbackRates, 'foldToFlopCbet', row.foldToFlopCbet, weight)
  if (safeNumber(agg.counts.raiseVsFlopCbetOpp) <= 0) addFallbackRate(agg.fallbackRates, 'raiseVsFlopCbet', row.raiseVsFlopCbet, weight)
}

function fallbackOrPct(agg, metric, numerator, denominator, preferFallback) {
  if (preferFallback) {
    const fbFirst = getFallbackRate(agg.fallbackRates, metric, 1)
    if (fbFirst !== null) return fbFirst
  }
  if (safeNumber(denominator) > 0) return pct(numerator, denominator)
  const fb = getFallbackRate(agg.fallbackRates, metric, 1)
  return fb === null ? 0 : fb
}

function fallbackOrAf(agg, stats, preferFallback) {
  if (preferFallback) {
    const fbFirst = getFallbackRate(agg.fallbackRates, 'af', 2)
    if (fbFirst !== null) return fbFirst
  }
  const calls = safeNumber(stats.calls)
  const attack = safeNumber(stats.bets) + safeNumber(stats.raises)
  if (calls > 0) return Number((attack / calls).toFixed(2))
  if (attack > 0) return 10
  const fb = getFallbackRate(agg.fallbackRates, 'af', 2)
  return fb === null ? 0 : fb
}

function getVotedStyles(styleVoteMap, limit) {
  const ranked = Object.keys(styleVoteMap || {})
    .map(tag => ({ tag: tag, count: safeNumber(styleVoteMap[tag]) }))
    .filter(item => item.count > 0 && item.tag !== '平衡')
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, limit || 3))
    .map(item => item.tag)
  return ranked
}

async function loadEndedMatchMap() {
  const map = {}
  const MAX_LIMIT = 100
  let offset = 0
  const countRes = await db.collection(MATCH_COLLECTION).where({ status: _.neq('已删除') }).count()
  const total = countRes.total || 0

  while (offset < total) {
    const batch = await db.collection(MATCH_COLLECTION)
      .where({ status: _.neq('已删除') })
      .field({
        gameId: true,
        status: true,
        name: true,
        createTime: true,
        realEndTime: true,
        updateTime: true,
        createTimeFull: true
      })
      .skip(offset)
      .limit(MAX_LIMIT)
      .get()

    const rows = batch.data || []
    rows.forEach(item => {
      const gameId = String(item.gameId || '').trim()
      if (!gameId) return
      const createTime = item.createTime || item.createTimeFull || item.updateTime || item.realEndTime || ''
      const endTime = item.realEndTime || item.updateTime || item.createTime || ''
      map[gameId] = {
        status: String(item.status || ''),
        name: String(item.name || ''),
        createTime: createTime,
        createTs: toTs(createTime),
        endTime: endTime,
        endTs: toTs(endTime)
      }
    })

    if (rows.length < MAX_LIMIT) break
    offset += rows.length
  }

  return map
}

async function loadBindingMap() {
  const pairMap = {}
  const gameUserAliasMap = {}
  const MAX_LIMIT = 100
  const countRes = await db.collection(BINDING_COLLECTION).count()
  const total = countRes.total || 0
  let offset = 0

  while (offset < total) {
    const batch = await db.collection(BINDING_COLLECTION)
      .field({
        gameId: true,
        playerId: true,
        playerName: true,
        userId: true,
        avatarUrl: true,
        createTime: true
      })
      .skip(offset)
      .limit(MAX_LIMIT)
      .get()

    const rows = batch.data || []
    rows.forEach(item => {
      const gameId = String(item.gameId || '').trim()
      const playerId = String(item.playerId || '').trim()
      const userId = String(item.userId || '').trim()
      if (!gameId || !playerId || !userId) return

      const key = buildBindingKey(gameId, playerId)
      const createTs = toTs(item.createTime)
      const prev = pairMap[key]
      if (!prev || createTs >= safeNumber(prev.createTs)) {
        pairMap[key] = {
          userId: userId,
          playerName: String(item.playerName || ''),
          avatarUrl: String(item.avatarUrl || ''),
          createTs: createTs
        }
      }

      const gameUserKey = buildGameUserKey(gameId, userId)
      if (!gameUserAliasMap[gameUserKey]) gameUserAliasMap[gameUserKey] = []
      pushUnique(gameUserAliasMap[gameUserKey], item.playerName)
    })

    if (rows.length < MAX_LIMIT) break
    offset += rows.length
  }

  return {
    pairMap: pairMap,
    gameUserAliasMap: gameUserAliasMap
  }
}

async function loadUserProfileMap() {
  const map = {}
  const MAX_LIMIT = 100
  const countRes = await db.collection(USER_COLLECTION).count()
  const total = countRes.total || 0
  let offset = 0

  while (offset < total) {
    const batch = await db.collection(USER_COLLECTION)
      .field({
        _openid: true,
        gejuId: true,
        nickName: true,
        avatarUrl: true
      })
      .skip(offset)
      .limit(MAX_LIMIT)
      .get()

    const rows = batch.data || []
    rows.forEach(item => {
      const openid = String(item._openid || '').trim()
      if (!openid) return
      map[openid] = {
        gejuId: String(item.gejuId || '').trim(),
        nickName: String(item.nickName || '').trim(),
        avatarUrl: String(item.avatarUrl || '').trim()
      }
    })

    if (rows.length < MAX_LIMIT) break
    offset += rows.length
  }

  return map
}

function applyBindingOverride(row, bindingPairMap) {
  const gameId = String(row.gameId || '').trim()
  const playerId = String(row.playerId || '').trim()
  if (!gameId || !playerId) return row

  const key = buildBindingKey(gameId, playerId)
  const binding = bindingPairMap[key]
  if (!binding || !binding.userId) return row

  return Object.assign({}, row, {
    userId: binding.userId,
    isUser: true,
    playerName: String(row.playerName || binding.playerName || ''),
    avatarUrl: String(row.avatarUrl || binding.avatarUrl || '')
  })
}

async function loadGlobalDocIds() {
  const ids = []
  const MAX_LIMIT = 100
  const countRes = await db.collection(GLOBAL_COLLECTION).count()
  const total = countRes.total || 0
  let offset = 0

  while (offset < total) {
    const batch = await db.collection(GLOBAL_COLLECTION)
      .field({ _id: true })
      .skip(offset)
      .limit(MAX_LIMIT)
      .get()
    ;(batch.data || []).forEach(item => {
      if (item && item._id) ids.push(item._id)
    })
    if (!batch.data || batch.data.length < MAX_LIMIT) break
    offset += batch.data.length
  }

  return ids
}

function finalizeAggregate(agg, userProfileMap) {
  const stats = agg.counts
  const gameIds = Object.keys(agg.gameSet || {})
  const mixedMode = agg.rawReadyRows < agg.rowCount
  const recentMatches = Object.values(agg.recentMatchMap || {})
    .filter(item => safeNumber(item.createTs || item.endTs) >= RECENT_MATCH_SINCE_TS)
    .sort((a, b) => safeNumber(b.createTs || b.endTs) - safeNumber(a.createTs || a.endTs))

  const userProfile = userProfileMap && agg.userId ? (userProfileMap[agg.userId] || {}) : {}
  const latestGejuId = String(userProfile.gejuId || userProfile.nickName || '').trim()
  const latestAvatar = String(userProfile.avatarUrl || '').trim()
  const displayName = agg.isBound
    ? (latestGejuId || agg.userId || '未知用户')
    : (agg.displayName || '未知选手')
  const avatarUrl = agg.isBound && latestAvatar ? latestAvatar : (agg.avatarUrl || '')

  const styleTagsComputed = generateStyles(stats, agg.totalNet)
  let styleTags = styleTagsComputed.slice()
  if (styleTags.length === 1 && styleTags[0] === '平衡') {
    const voted = getVotedStyles(agg.styleVoteMap, 3)
    if (voted.length > 0) styleTags = voted
  }

  const af = fallbackOrAf(agg, stats, mixedMode)
  const vpip = fallbackOrPct(agg, 'vpip', stats.vpipHands, stats.hands, false)
  const pfr = fallbackOrPct(agg, 'pfr', stats.pfrHands, stats.hands, false)
  const limp = fallbackOrPct(agg, 'limp', stats.limpHands, stats.hands, false)
  const bet3 = fallbackOrPct(agg, 'bet3', stats.bet3Count, stats.bet3Opp, mixedMode)
  const allIn = fallbackOrPct(agg, 'allIn', stats.allInWins, stats.allInCnt, mixedMode)
  const wtsd = fallbackOrPct(agg, 'wtsd', stats.showdowns, stats.sawFlopHands, mixedMode)
  const wsd = fallbackOrPct(agg, 'wsd', stats.showdownWins, stats.showdowns, mixedMode)
  const cbet = fallbackOrPct(agg, 'cbet', stats.cbetCount, stats.cbetOpp, mixedMode)
  const foldTo3Bet = fallbackOrPct(agg, 'foldTo3Bet', stats.foldTo3BetCount, stats.foldTo3BetOpp, mixedMode)
  const bet4 = fallbackOrPct(agg, 'bet4', stats.bet4Count, stats.bet4Opp, mixedMode)
  const isolate = fallbackOrPct(agg, 'isolate', stats.isolateCount, stats.isolateOpp, mixedMode)
  const foldToFlopCbet = fallbackOrPct(agg, 'foldToFlopCbet', stats.foldToFlopCbetCount, stats.foldToFlopCbetOpp, mixedMode)
  const raiseVsFlopCbet = fallbackOrPct(agg, 'raiseVsFlopCbet', stats.raiseVsFlopCbetCount, stats.raiseVsFlopCbetOpp, mixedMode)

  const record = {
    _id: agg._id,
    globalPlayerKey: agg.globalPlayerKey,
    entityType: agg.entityType,
    isBound: agg.isBound,
    userId: agg.userId || '',
    soloGameId: agg.soloGameId || '',
    soloPlayerId: agg.soloPlayerId || '',
    displayName: displayName,
    avatarUrl: avatarUrl,
    boundNames: agg.boundNames || [],
    totalNet: safeNumber(agg.totalNet),
    gameCount: gameIds.length,
    gameIds: gameIds,
    hands: safeNumber(stats.hands),
    vpip: vpip,
    pfr: pfr,
    limp: limp,
    bet3: bet3,
    allIn: allIn,
    af: af,
    wtsd: wtsd,
    wsd: wsd,
    cbet: cbet,
    foldTo3Bet: foldTo3Bet,
    bet4: bet4,
    isolate: isolate,
    foldToFlopCbet: foldToFlopCbet,
    raiseVsFlopCbet: raiseVsFlopCbet,
    styleTags: styleTags,
    recentMatches: recentMatches.map(item => ({
      gameId: item.gameId,
      matchName: item.matchName,
      net: item.net,
      hands: item.hands,
      createTime: item.createTime || '',
      createTs: safeNumber(item.createTs),
      endTime: item.endTime,
      aliases: item.aliases || []
    })),
    rawCounts: stats,
    dataQuality: {
      sourceRows: agg.rowCount,
      rawReadyRows: agg.rawReadyRows,
      rawReadyRate: agg.rowCount > 0 ? Number((agg.rawReadyRows / agg.rowCount).toFixed(2)) : 0
    },
    updateTime: new Date()
  }
  return record
}

async function persistGlobalRecords(records) {
  const BATCH_LIMIT = 20
  const keepIdMap = {}

  for (let i = 0; i < records.length; i += BATCH_LIMIT) {
    const chunk = records.slice(i, i + BATCH_LIMIT)
    const tasks = chunk.map(record => {
      keepIdMap[record._id] = true
      const writeData = Object.assign({}, record)
      delete writeData._id
      return db.collection(GLOBAL_COLLECTION).doc(record._id).set({ data: writeData })
    })
    if (tasks.length > 0) await Promise.all(tasks)
  }

  const existingIds = await loadGlobalDocIds()
  const staleIds = existingIds.filter(id => !keepIdMap[id])

  for (let i = 0; i < staleIds.length; i += BATCH_LIMIT) {
    const chunk = staleIds.slice(i, i + BATCH_LIMIT)
    const tasks = chunk.map(id => db.collection(GLOBAL_COLLECTION).doc(id).remove())
    if (tasks.length > 0) await Promise.all(tasks)
  }

  return {
    written: records.length,
    staleRemoved: staleIds.length
  }
}

exports.main = async (event, context) => {
  const startedAt = Date.now()

  try {
    const endedMatchMap = await loadEndedMatchMap()
    const bindingSnapshot = await loadBindingMap()
    const bindingPairMap = bindingSnapshot.pairMap || {}
    const gameUserAliasMap = bindingSnapshot.gameUserAliasMap || {}
    const userProfileMap = await loadUserProfileMap()
    const endedMatchCount = Object.keys(endedMatchMap).filter(gameId => {
      const one = endedMatchMap[gameId] || {}
      return one.status === '已结束'
    }).length

    const aggMap = {}
    const MAX_LIMIT = 100
    const countRes = await db.collection(PLAYER_STATS_COLLECTION).count()
    const totalStatsRows = countRes.total || 0
    let offset = 0

    let scannedRows = 0
    let usedRows = 0

    while (offset < totalStatsRows) {
      const batch = await db.collection(PLAYER_STATS_COLLECTION)
        .field({
          gameId: true,
          playerId: true,
          userId: true,
          playerName: true,
          isUser: true,
          avatarUrl: true,
          boundNames: true,
          net: true,
          hands: true,
          vpip: true,
          pfr: true,
          limp: true,
          bet3: true,
          allIn: true,
          af: true,
          wtsd: true,
          wsd: true,
          cbet: true,
          foldTo3Bet: true,
          bet4: true,
          isolate: true,
          foldToFlopCbet: true,
          raiseVsFlopCbet: true,
          style: true,
          styleTags: true,
          rawCounts: true,
          matchStatus: true,
          updateTime: true
        })
        .skip(offset)
        .limit(MAX_LIMIT)
        .get()

      const rows = batch.data || []
      if (rows.length === 0) break
      scannedRows += rows.length

      rows.forEach(row => {
        const effectiveRow = applyBindingOverride(row, bindingPairMap)
        const gameId = String(row.gameId || '').trim()
        if (!gameId) return
        const matchMeta = endedMatchMap[gameId] || null
        const isEnded = (matchMeta && matchMeta.status === '已结束') || effectiveRow.matchStatus === '已结束'
        if (!isEnded) return

        const identity = resolveIdentity(effectiveRow)
        if (!identity.globalPlayerKey) return

        if (!aggMap[identity.globalPlayerKey]) {
          aggMap[identity.globalPlayerKey] = initAggregate(identity, effectiveRow)
        }
        const agg = aggMap[identity.globalPlayerKey]
        usedRows += 1
        agg.rowCount += 1

        const net = safeNumber(effectiveRow.net)
        const hands = safeNumber(effectiveRow.hands)
        agg.totalNet += net
        agg.gameSet[gameId] = true
        if (!agg.displayName || agg.displayName === '未知选手') {
          agg.displayName = String(effectiveRow.playerName || effectiveRow.userId || effectiveRow.playerId || '未知选手')
        }
        if (!agg.avatarUrl && effectiveRow.avatarUrl) agg.avatarUrl = String(effectiveRow.avatarUrl)

        addNames(agg, effectiveRow)
        addStyleVotes(agg, effectiveRow)
        addRecentMatch(agg, effectiveRow, matchMeta, gameUserAliasMap)

        const rawRes = resolveRawCounts(effectiveRow)
        if (rawRes.hasRaw) agg.rawReadyRows += 1
        COUNT_KEYS.forEach(key => {
          agg.counts[key] += safeNumber(rawRes.counts[key])
        })
        if (agg.counts.hands <= 0 && hands > 0) agg.counts.hands = hands
        addFallbackRatesByRow(agg, effectiveRow, rawRes.hasRaw)
      })

      if (rows.length < MAX_LIMIT) break
      offset += rows.length
    }

    const finalRecords = Object.keys(aggMap).map(key => finalizeAggregate(aggMap[key], userProfileMap))
    finalRecords.sort((a, b) => safeNumber(b.totalNet) - safeNumber(a.totalNet))

    const persistResult = await persistGlobalRecords(finalRecords)

    return {
      code: 1,
      msg: '玩家全局统计构建完成',
      data: {
        endedMatchCount: endedMatchCount,
        scannedRows: scannedRows,
        usedRows: usedRows,
        bindingRows: Object.keys(bindingPairMap).length,
        globalPlayers: finalRecords.length,
        written: persistResult.written,
        staleRemoved: persistResult.staleRemoved,
        durationMs: Date.now() - startedAt
      }
    }
  } catch (e) {
    console.error('[player_global_build] 失败:', e)
    return {
      code: -1,
      msg: '构建失败: ' + e.message
    }
  }
}
