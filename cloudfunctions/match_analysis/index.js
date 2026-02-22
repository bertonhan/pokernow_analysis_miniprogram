// cloudfunctions/match_analysis/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const FACT_COLLECTION = 'match_hand_facts'
const PLAYER_STATS_COLLECTION = 'match_player_stats'

function safeNumber(value) {
  const num = Number(value)
  return isNaN(num) ? 0 : num
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ratio(numerator, denominator) {
  if (!denominator) return 0
  return numerator / denominator
}

function pct(numerator, denominator) {
  return Number((ratio(numerator, denominator) * 100).toFixed(1))
}

function avg(sum, count) {
  if (!count) return 0
  return Number((sum / count).toFixed(2))
}

function mergePositionCount(target, source) {
  const result = target || {}
  const input = source || {}
  Object.keys(input).forEach(pos => {
    result[pos] = (result[pos] || 0) + safeNumber(input[pos])
  })
  return result
}

function addShowdownSample(targetList, sample, max) {
  if (!Array.isArray(targetList)) return
  if (!sample) return
  if (targetList.length >= max) return
  targetList.push(sample)
}

function hasAggressiveAction(actionText) {
  const text = String(actionText || '')
  return /\b(raises|bets)\b/i.test(text)
}

function pushTag(styles, tag) {
  if (!tag) return
  if (styles.indexOf(tag) === -1) styles.push(tag)
}

function buildDefaultStats(pid, name) {
  return {
    id: pid,
    name: name || pid,
    hands: 0,
    vpipHands: 0,
    pfrHands: 0,
    limpHands: 0,
    sawFlopHands: 0,
    bets: 0,
    raises: 0,
    calls: 0,
    checks: 0,
    folds: 0,
    showdowns: 0,
    showdownWins: 0,
    cbetOpp: 0,
    cbetCount: 0,
    bet3Opp: 0,
    bet3Count: 0,
    allInCnt: 0,
    allInWins: 0,
    foldTo3BetOpp: 0,
    foldTo3BetCount: 0,
    bet4Opp: 0,
    bet4Count: 0,
    isolateOpp: 0,
    isolateCount: 0,
    foldToFlopCbetOpp: 0,
    foldToFlopCbetCount: 0,
    raiseVsFlopCbetOpp: 0,
    raiseVsFlopCbetCount: 0,
    sprFlopSum: 0,
    sprFlopCnt: 0,
    sprTurnSum: 0,
    sprTurnCnt: 0,
    sprRiverSum: 0,
    sprRiverCnt: 0,
    positionCount: {},
    showdownSamples: [],
    luckHands: 0,
    luckExpectedWins: 0,
    luckActualWins: 0,
    luckGoodHits: 0,
    luckBadBeats: 0,
    luckAllInDogWins: 0,
    luckAllInFavLoses: 0,
    charityAttempts: 0,
    charityFails: 0
  }
}

function accumulateLuckStats(statsMap, handDoc) {
  const showdownPlayers = Array.isArray(handDoc.showdownPlayers) ? handDoc.showdownPlayers : []
  if (showdownPlayers.length < 2) return

  const showdownWinMap = {}
  ;(handDoc.players || []).forEach(player => {
    if (!player || !player.playerId) return
    showdownWinMap[player.playerId] = safeNumber(player.showdownWins) > 0
  })

  const entries = showdownPlayers.map(sd => {
    if (!sd || !sd.playerId || !statsMap[sd.playerId]) return null
    const eq = safeNumber(sd.rangeEquity)
    if (eq <= 0) return null
    return {
      playerId: sd.playerId,
      equity: Math.max(0, Math.min(eq, 100)),
      won: !!showdownWinMap[sd.playerId],
      allInHand: !!sd.allInHand,
      isAllInPlayer: !!sd.isAllInPlayer,
      flopAction: sd.flopAction || '',
      turnAction: sd.turnAction || '',
      riverAction: sd.riverAction || ''
    }
  }).filter(Boolean)

  if (entries.length < 2) return

  const sumEquity = entries.reduce((sum, one) => sum + one.equity, 0)
  if (sumEquity <= 0) return

  const maxEquity = entries.reduce((max, one) => Math.max(max, one.equity), 0)

  entries.forEach(one => {
    const stats = statsMap[one.playerId]
    if (!stats) return

    const expectedWin = one.equity / sumEquity
    const actualWin = one.won ? 1 : 0
    const equityGap = maxEquity - one.equity
    const isBehind = one.equity <= 40 || equityGap >= 8
    const isFavorite = one.equity >= 60 && equityGap <= 2
    const isAggressiveMove = one.isAllInPlayer ||
      hasAggressiveAction(one.flopAction) ||
      hasAggressiveAction(one.turnAction) ||
      hasAggressiveAction(one.riverAction)

    stats.luckHands += 1
    stats.luckExpectedWins += expectedWin
    stats.luckActualWins += actualWin

    if (one.won && isBehind) stats.luckGoodHits += 1
    if (!one.won && isFavorite) stats.luckBadBeats += 1
    if (one.allInHand && one.isAllInPlayer && one.won && isBehind) stats.luckAllInDogWins += 1
    if (one.allInHand && one.isAllInPlayer && !one.won && isFavorite) stats.luckAllInFavLoses += 1

    if (isBehind && isAggressiveMove) {
      stats.charityAttempts += 1
      if (!one.won) stats.charityFails += 1
    }
  })
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

  // 主风格标签：重点保留“松弱/紧弱”的命名。
  if (stats.hands >= 10) {
    const isLoose = vpip >= 0.33
    const isTight = vpip <= 0.22
    const isAggressivePreflop = pfr >= 0.16 && pfrByVpip >= 0.45
    if (isLoose) pushTag(styles, isAggressivePreflop ? '松凶' : '松弱')
    else if (isTight) pushTag(styles, isAggressivePreflop ? '紧凶' : '紧弱')
  }

  // 翻前策略
  if (stats.hands >= 12 && vpip >= 0.28 && limpRate >= 0.10 && limpRate >= pfr * 0.8 && stats.limpHands >= 3) {
    pushTag(styles, 'limper')
  }
  if (stats.bet3Opp >= 5 && bet3Freq >= 0.14) pushTag(styles, '3bet压制')
  if (stats.bet4Opp >= 3 && bet4Freq >= 0.16) pushTag(styles, '4bet战士')
  if (stats.isolateOpp >= 4 && isolateFreq >= 0.30) pushTag(styles, '剥削')
  if (stats.foldTo3BetOpp >= 4 && foldTo3Bet >= 0.62) pushTag(styles, '怕3bet')

  // 翻后策略
  if (stats.cbetOpp >= 5 && cbetFreq >= 0.62) pushTag(styles, '持续施压')
  if (stats.foldToFlopCbetOpp >= 4 && foldToFlopCbet >= 0.62) pushTag(styles, '翻后保守')
  if (stats.raiseVsFlopCbetOpp >= 4 && raiseVsFlopCbet >= 0.22) pushTag(styles, '翻后反击')
  if (af >= 2.8) pushTag(styles, '激进')
  else if (af > 0 && af < 0.9) pushTag(styles, '跟注')

  // 运气标签（方案2）：基于“翻前权益 vs 结果差值”。
  if (stats.luckHands >= 4) {
    if (luckDiff >= 0.9 || stats.luckAllInDogWins >= 2) pushTag(styles, '天选')
    else if (luckDiff >= 0.45 || stats.luckGoodHits >= 2) pushTag(styles, '欧皇')

    if (luckDiff <= -0.9 || stats.luckAllInFavLoses >= 2) pushTag(styles, '倒霉')
    else if (luckDiff <= -0.45 || stats.luckBadBeats >= 2) pushTag(styles, '非酋')
  }

  if (stats.luckAllInDogWins >= 2) pushTag(styles, '跑马王')

  // 慈善家：牌力落后时主动进攻（加注/下注/all-in）且最终输掉。
  if (stats.charityAttempts >= 2 && stats.charityFails >= 2 && charityRate >= 0.7) {
    pushTag(styles, '慈善家')
  }

  if (vpip > 0.40 && net > 5000) pushTag(styles, '天选')
  if (vpip < 0.30 && net < -5000) pushTag(styles, '倒霉')

  if (styles.length === 0) pushTag(styles, '平衡')
  return styles
}

function buildRecord(gameId, id, name, net, stats, styles, isUser, avatar, boundNames) {
  const afBase = stats.calls || 0
  const afTop = (stats.bets || 0) + (stats.raises || 0)
  const af = afBase > 0 ? (afTop / afBase) : (afTop > 0 ? 10 : 0)

  const record = {
    gameId: gameId,
    playerId: id,
    userId: isUser ? id : '',
    playerName: name,
    isUser: !!isUser,
    avatarUrl: avatar || '',
    boundNames: boundNames || [],
    net: safeNumber(net),
    hands: stats.hands,
    vpip: pct(stats.vpipHands, stats.hands),
    pfr: pct(stats.pfrHands, stats.hands),
    limp: pct(stats.limpHands, stats.hands),
    bet3: pct(stats.bet3Count, stats.bet3Opp),
    allIn: pct(stats.allInWins, stats.allInCnt),
    af: Number(af.toFixed(2)),
    wtsd: pct(stats.showdowns, stats.sawFlopHands),
    wsd: pct(stats.showdownWins, stats.showdowns),
    cbet: pct(stats.cbetCount, stats.cbetOpp),
    foldTo3Bet: pct(stats.foldTo3BetCount, stats.foldTo3BetOpp),
    bet4: pct(stats.bet4Count, stats.bet4Opp),
    isolate: pct(stats.isolateCount, stats.isolateOpp),
    foldToFlopCbet: pct(stats.foldToFlopCbetCount, stats.foldToFlopCbetOpp),
    raiseVsFlopCbet: pct(stats.raiseVsFlopCbetCount, stats.raiseVsFlopCbetOpp),
    avgSprFlop: avg(stats.sprFlopSum, stats.sprFlopCnt),
    avgSprTurn: avg(stats.sprTurnSum, stats.sprTurnCnt),
    avgSprRiver: avg(stats.sprRiverSum, stats.sprRiverCnt),
    positionCount: stats.positionCount || {},
    showdownSamples: stats.showdownSamples || [],
    styleTags: styles.slice(),
    style: styles.join('/'),
    rawCounts: {
      hands: safeNumber(stats.hands),
      vpipHands: safeNumber(stats.vpipHands),
      pfrHands: safeNumber(stats.pfrHands),
      limpHands: safeNumber(stats.limpHands),
      sawFlopHands: safeNumber(stats.sawFlopHands),
      bets: safeNumber(stats.bets),
      raises: safeNumber(stats.raises),
      calls: safeNumber(stats.calls),
      checks: safeNumber(stats.checks),
      folds: safeNumber(stats.folds),
      showdowns: safeNumber(stats.showdowns),
      showdownWins: safeNumber(stats.showdownWins),
      cbetOpp: safeNumber(stats.cbetOpp),
      cbetCount: safeNumber(stats.cbetCount),
      bet3Opp: safeNumber(stats.bet3Opp),
      bet3Count: safeNumber(stats.bet3Count),
      allInCnt: safeNumber(stats.allInCnt),
      allInWins: safeNumber(stats.allInWins),
      foldTo3BetOpp: safeNumber(stats.foldTo3BetOpp),
      foldTo3BetCount: safeNumber(stats.foldTo3BetCount),
      bet4Opp: safeNumber(stats.bet4Opp),
      bet4Count: safeNumber(stats.bet4Count),
      isolateOpp: safeNumber(stats.isolateOpp),
      isolateCount: safeNumber(stats.isolateCount),
      foldToFlopCbetOpp: safeNumber(stats.foldToFlopCbetOpp),
      foldToFlopCbetCount: safeNumber(stats.foldToFlopCbetCount),
      raiseVsFlopCbetOpp: safeNumber(stats.raiseVsFlopCbetOpp),
      raiseVsFlopCbetCount: safeNumber(stats.raiseVsFlopCbetCount),
      sprFlopSum: safeNumber(stats.sprFlopSum),
      sprFlopCnt: safeNumber(stats.sprFlopCnt),
      sprTurnSum: safeNumber(stats.sprTurnSum),
      sprTurnCnt: safeNumber(stats.sprTurnCnt),
      sprRiverSum: safeNumber(stats.sprRiverSum),
      sprRiverCnt: safeNumber(stats.sprRiverCnt),
      luckHands: safeNumber(stats.luckHands),
      luckExpectedWins: safeNumber(stats.luckExpectedWins),
      luckActualWins: safeNumber(stats.luckActualWins),
      luckGoodHits: safeNumber(stats.luckGoodHits),
      luckBadBeats: safeNumber(stats.luckBadBeats),
      luckAllInDogWins: safeNumber(stats.luckAllInDogWins),
      luckAllInFavLoses: safeNumber(stats.luckAllInFavLoses),
      charityAttempts: safeNumber(stats.charityAttempts),
      charityFails: safeNumber(stats.charityFails)
    },
    updateTime: new Date()
  }

  return record
}

async function loadMatchHandFacts(gameId) {
  const MAX_LIMIT = 100
  let facts = []
  let lastHandNumber = 0

  while (true) {
    const batch = await db.collection(FACT_COLLECTION)
      .where({
        gameId: gameId,
        handNumber: _.gt(lastHandNumber)
      })
      .field({
        handNumber: true,
        players: true,
        showdownPlayers: true
      })
      .orderBy('handNumber', 'asc')
      .limit(MAX_LIMIT)
      .get()

    const rows = batch.data || []
    if (rows.length === 0) break

    facts = facts.concat(rows)
    lastHandNumber = safeNumber(rows[rows.length - 1].handNumber)
    if (rows.length < MAX_LIMIT) break
  }

  return facts
}

async function loadMatchPlayerStatDocIds(gameId) {
  const MAX_LIMIT = 100
  let ids = []
  const countRes = await db.collection(PLAYER_STATS_COLLECTION).where({ gameId: gameId }).count()
  const total = countRes.total || 0

  for (let i = 0; i < total; i += MAX_LIMIT) {
    const batch = await db.collection(PLAYER_STATS_COLLECTION)
      .where({ gameId: gameId })
      .field({ _id: true })
      .skip(i)
      .limit(MAX_LIMIT)
      .get()
    ;(batch.data || []).forEach(item => {
      if (item && item._id) ids.push(item._id)
    })
  }

  return ids
}

async function getLatestHandNumber(collectionName, gameId) {
  const res = await db.collection(collectionName)
    .where({ gameId: gameId })
    .field({ handNumber: true })
    .orderBy('handNumber', 'desc')
    .limit(1)
    .get()

  if (!res.data || res.data.length === 0) return 0
  return safeNumber(res.data[0].handNumber)
}

async function loadMatchByGameId(gameId, options) {
  const opts = options || {}
  const allowFuzzy = opts.allowFuzzy === true
  const normalized = String(gameId || '').trim()
  if (!normalized) return null

  const exactRes = await db.collection('matches').where({ gameId: normalized }).limit(1).get()
  if (exactRes.data && exactRes.data.length > 0) return exactRes.data[0]

  // 输入可能是 matches 的文档 _id，优先走主键读取避免全表扫描。
  try {
    const docRes = await db.collection('matches').doc(normalized).get()
    if (docRes && docRes.data) return docRes.data
  } catch (e) {}

  if (!allowFuzzy) return null

  const escaped = escapeRegExp(normalized)
  const fuzzyRes = await db.collection('matches').where({
    gameId: db.RegExp({
      regexp: '^\\s*' + escaped + '\\s*$',
      options: 'i'
    })
  }).limit(1).get()

  if (fuzzyRes.data && fuzzyRes.data.length > 0) return fuzzyRes.data[0]
  return null
}

async function syncFactsToLatestHand(gameId) {
  const rawLatest = await getLatestHandNumber('match_hands', gameId)
  const factLatest = await getLatestHandNumber(FACT_COLLECTION, gameId)
  let syncedCount = 0

  if (rawLatest <= 0) {
    return {
      rawLatest: 0,
      factLatestBefore: factLatest,
      factLatestAfter: factLatest,
      syncedCount: 0
    }
  }

  for (let handNo = Math.max(1, factLatest + 1); handNo <= rawLatest; handNo += 1) {
    const etlRes = await cloud.callFunction({
      name: 'match_hand_etl',
      data: {
        gameId: gameId,
        handNumber: handNo
      }
    })

    const etlResult = etlRes && etlRes.result ? etlRes.result : null
    if (!etlResult || (etlResult.code !== 1 && etlResult.code !== 0)) {
      const reason = etlResult && etlResult.msg ? etlResult.msg : '未知错误'
      throw new Error('同步手牌失败 hand#' + handNo + ': ' + reason)
    }

    syncedCount += 1
  }

  // 再兜底刷新一次当前最新手，避免与爬虫写入并发时出现刚好错过一手。
  await cloud.callFunction({
    name: 'match_hand_etl',
    data: {
      gameId: gameId,
      handNumber: rawLatest
    }
  }).catch(err => {
    console.error('[match_analysis] 最新手补算失败 hand#' + rawLatest + ':', err.message)
  })

  const factLatestAfter = await getLatestHandNumber(FACT_COLLECTION, gameId)
  return {
    rawLatest: rawLatest,
    factLatestBefore: factLatest,
    factLatestAfter: factLatestAfter,
    syncedCount: syncedCount
  }
}

async function persistMatchPlayerStats(gameId, finalResults, matchStatus, analysisSource) {
  const now = new Date()
  const BATCH_LIMIT = 20
  const keepIdMap = {}

  for (let i = 0; i < finalResults.length; i += BATCH_LIMIT) {
    const chunk = finalResults.slice(i, i + BATCH_LIMIT)
    const writeTasks = chunk.map(record => {
      const docId = gameId + '_' + record.playerId
      keepIdMap[docId] = true

      const writeData = Object.assign({}, record, {
        gameId: gameId,
        matchStatus: matchStatus || '',
        analysisSource: analysisSource || FACT_COLLECTION,
        analysisUpdateTime: now
      })
      delete writeData._id

      return db.collection(PLAYER_STATS_COLLECTION).doc(docId).set({ data: writeData })
    })

    if (writeTasks.length > 0) await Promise.all(writeTasks)
  }

  const existingIds = await loadMatchPlayerStatDocIds(gameId)
  const staleIds = existingIds.filter(id => !keepIdMap[id])

  for (let i = 0; i < staleIds.length; i += BATCH_LIMIT) {
    const chunk = staleIds.slice(i, i + BATCH_LIMIT)
    const deleteTasks = chunk.map(id => db.collection(PLAYER_STATS_COLLECTION).doc(id).remove())
    if (deleteTasks.length > 0) await Promise.all(deleteTasks)
  }

  return {
    written: finalResults.length,
    staleRemoved: staleIds.length
  }
}

exports.main = async (event, context) => {
  const inputGameId = event.gameId
  const normalizedGameId = String(inputGameId || '').trim()
  console.log('[match_analysis] 开始聚合:', normalizedGameId, 'raw:', inputGameId)

  if (!normalizedGameId) return { code: -1, msg: '缺少 gameId' }

  try {
    // 1. 对局元数据 + ledger
    const matchData = await loadMatchByGameId(normalizedGameId, {
      allowFuzzy: true
    })
    if (!matchData) return { code: -1, msg: '对局不存在: ' + normalizedGameId }

    const gameId = String(matchData.gameId || normalizedGameId)
    const isEnded = matchData.status === '已结束'
    const playersInfos = (matchData.ledger && matchData.ledger.playersInfos) || {}

    // 2. 强制追平到最新手牌，保证本次返回不是缓存结果。
    const syncResult = await syncFactsToLatestHand(gameId)
    console.log('[match_analysis] 最新手牌同步:', syncResult)

    const ledgerMap = {}
    Object.keys(playersInfos).forEach(key => {
      const p = playersInfos[key] || {}
      ledgerMap[p.id] = {
        name: (p.names && p.names[0]) || 'Unknown',
        net: safeNumber(p.net)
      }
    })

    // 3. 绑定数据（进行中强制隐藏）
    const bindRes = await db.collection('match_player_bindings').where({ gameId: gameId }).get()
    let bindings = bindRes.data || []
    if (!isEnded) bindings = []

    const bindMap = {}
    const relatedUserIds = []
    bindings.forEach(b => {
      bindMap[b.playerId] = {
        userId: b.userId,
        avatarUrl: b.avatarUrl || ''
      }
      if (relatedUserIds.indexOf(b.userId) === -1) relatedUserIds.push(b.userId)
    })

    const userMap = {}
    if (relatedUserIds.length > 0) {
      const userRes = await db.collection('users')
        .where({ _openid: _.in(relatedUserIds) })
        .field({ _openid: true, gejuId: true, avatarUrl: true })
        .get()

      ;(userRes.data || []).forEach(u => {
        userMap[u._openid] = {
          gejuId: u.gejuId || '未知用户',
          avatarUrl: u.avatarUrl || ''
        }
      })
    }

    // 4. 读取 ETL 基础表并聚合
    const handFacts = await loadMatchHandFacts(gameId)
    const rawHandCount = safeNumber(syncResult.rawLatest)

    if (handFacts.length === 0 && rawHandCount > 0) {
      return {
        code: 0,
        msg: '手牌基础统计尚未就绪，请稍后重试',
        data: [],
        meta: {
          source: FACT_COLLECTION,
          handCount: 0,
          rawHandCount: rawHandCount,
          cached: false,
          matchStatus: matchData.status || '',
          latestSync: syncResult
        }
      }
    }

    const statsMap = {}

    handFacts.forEach(handDoc => {
      const handPlayers = handDoc.players || []
      handPlayers.forEach(player => {
        const pid = player.playerId
        if (!pid) return

        if (!statsMap[pid]) {
          statsMap[pid] = buildDefaultStats(pid, player.playerName)
        }

        const s = statsMap[pid]
        s.name = player.playerName || s.name
        s.hands += safeNumber(player.hands)
        s.vpipHands += safeNumber(player.vpipHands)
        s.pfrHands += safeNumber(player.pfrHands)
        s.limpHands += safeNumber(player.limpHands)
        s.sawFlopHands += safeNumber(player.sawFlopHands)
        s.bets += safeNumber(player.bets)
        s.raises += safeNumber(player.raises)
        s.calls += safeNumber(player.calls)
        s.checks += safeNumber(player.checks)
        s.folds += safeNumber(player.folds)
        s.showdowns += safeNumber(player.showdowns)
        s.showdownWins += safeNumber(player.showdownWins)
        s.cbetOpp += safeNumber(player.cbetOpp)
        s.cbetCount += safeNumber(player.cbetCount)
        s.bet3Opp += safeNumber(player.bet3Opp)
        s.bet3Count += safeNumber(player.bet3Count)
        s.allInCnt += safeNumber(player.allInCnt)
        s.allInWins += safeNumber(player.allInWins)
        s.foldTo3BetOpp += safeNumber(player.foldTo3BetOpp)
        s.foldTo3BetCount += safeNumber(player.foldTo3BetCount)
        s.bet4Opp += safeNumber(player.bet4Opp)
        s.bet4Count += safeNumber(player.bet4Count)
        s.isolateOpp += safeNumber(player.isolateOpp)
        s.isolateCount += safeNumber(player.isolateCount)
        s.foldToFlopCbetOpp += safeNumber(player.foldToFlopCbetOpp)
        s.foldToFlopCbetCount += safeNumber(player.foldToFlopCbetCount)
        s.raiseVsFlopCbetOpp += safeNumber(player.raiseVsFlopCbetOpp)
        s.raiseVsFlopCbetCount += safeNumber(player.raiseVsFlopCbetCount)

        if (typeof player.sprFlop === 'number') {
          s.sprFlopSum += player.sprFlop
          s.sprFlopCnt += 1
        }
        if (typeof player.sprTurn === 'number') {
          s.sprTurnSum += player.sprTurn
          s.sprTurnCnt += 1
        }
        if (typeof player.sprRiver === 'number') {
          s.sprRiverSum += player.sprRiver
          s.sprRiverCnt += 1
        }

        if (player.position) {
          s.positionCount[player.position] = (s.positionCount[player.position] || 0) + 1
        }
      })

      const showdownPlayers = handDoc.showdownPlayers || []
      showdownPlayers.forEach(sd => {
        if (!sd || !sd.playerId) return
        if (!statsMap[sd.playerId]) {
          statsMap[sd.playerId] = buildDefaultStats(sd.playerId, sd.playerName)
        }

        addShowdownSample(statsMap[sd.playerId].showdownSamples, {
          handNumber: handDoc.handNumber,
          holeCards: sd.holeCards || [],
          rangeKey: sd.rangeKey || '',
          rangeTier: sd.rangeTier || '',
          rangeLabel: sd.rangeLabel || '',
          rangePercent: typeof sd.rangePercent === 'number' ? sd.rangePercent : null,
          rangeEquity: typeof sd.rangeEquity === 'number' ? sd.rangeEquity : null,
          comboCount: typeof sd.comboCount === 'number' ? sd.comboCount : null,
          allInHand: !!sd.allInHand,
          isAllInPlayer: !!sd.isAllInPlayer,
          allInStreet: sd.allInStreet || '',
          flopHandType: sd.flopHandType || '',
          flopSpr: sd.flopSpr,
          flopAction: sd.flopAction || '',
          turnHandType: sd.turnHandType || '',
          turnSpr: sd.turnSpr,
          turnAction: sd.turnAction || '',
          riverHandType: sd.riverHandType || '',
          riverSpr: sd.riverSpr,
          riverAction: sd.riverAction || ''
        }, 8)
      })

      accumulateLuckStats(statsMap, handDoc)
    })

    let parsedHands = 0
    Object.keys(statsMap).forEach(pid => {
      parsedHands += safeNumber(statsMap[pid].hands)
    })

    if (handFacts.length > 0 && parsedHands === 0) {
      return {
        code: -1,
        msg: '基础统计异常：match_hand_facts 已存在，但未解析到玩家手数',
        data: [],
        meta: {
          source: FACT_COLLECTION,
          handCount: handFacts.length,
          rawHandCount: rawHandCount,
          parsedHands: parsedHands,
          matchStatus: matchData.status || '',
          latestSync: syncResult
        }
      }
    }

    // 4. 组装“选手维度”与“用户聚合维度”
    const finalResults = []
    const userStatsMap = {}

    const allPlayerIds = Object.keys(ledgerMap)
    Object.keys(statsMap).forEach(pid => {
      if (allPlayerIds.indexOf(pid) === -1) allPlayerIds.push(pid)
    })

    allPlayerIds.forEach(pid => {
      const stats = statsMap[pid] || buildDefaultStats(pid, (ledgerMap[pid] && ledgerMap[pid].name) || pid)
      const ledger = ledgerMap[pid] || { name: stats.name || pid, net: 0 }
      if (stats.hands === 0 && safeNumber(ledger.net) === 0) return

      const binding = bindMap[pid]
      if (!binding) {
        const styles = generateStyles(stats, safeNumber(ledger.net))
        const record = buildRecord(gameId, pid, ledger.name, safeNumber(ledger.net), stats, styles, false, '', [])
        finalResults.push(record)
        return
      }

      const uid = binding.userId
      const userInfo = userMap[uid] || {}
      const finalAvatar = userInfo.avatarUrl || binding.avatarUrl || ''
      const finalGejuId = userInfo.gejuId || '未知用户'

      if (!userStatsMap[uid]) {
        userStatsMap[uid] = buildDefaultStats(uid, finalGejuId)
        userStatsMap[uid].userId = uid
        userStatsMap[uid].gejuId = finalGejuId
        userStatsMap[uid].avatarUrl = finalAvatar
        userStatsMap[uid].net = 0
        userStatsMap[uid].relatedNames = []
      }

      const us = userStatsMap[uid]
      us.net += safeNumber(ledger.net)
      us.hands += stats.hands
      us.vpipHands += stats.vpipHands
      us.pfrHands += stats.pfrHands
      us.limpHands += stats.limpHands
      us.sawFlopHands += stats.sawFlopHands
      us.bets += stats.bets
      us.raises += stats.raises
      us.calls += stats.calls
      us.checks += stats.checks
      us.folds += stats.folds
      us.showdowns += stats.showdowns
      us.showdownWins += stats.showdownWins
      us.cbetOpp += stats.cbetOpp
      us.cbetCount += stats.cbetCount
      us.bet3Opp += stats.bet3Opp
      us.bet3Count += stats.bet3Count
      us.allInCnt += stats.allInCnt
      us.allInWins += stats.allInWins
      us.foldTo3BetOpp += stats.foldTo3BetOpp
      us.foldTo3BetCount += stats.foldTo3BetCount
      us.bet4Opp += stats.bet4Opp
      us.bet4Count += stats.bet4Count
      us.isolateOpp += stats.isolateOpp
      us.isolateCount += stats.isolateCount
      us.foldToFlopCbetOpp += stats.foldToFlopCbetOpp
      us.foldToFlopCbetCount += stats.foldToFlopCbetCount
      us.raiseVsFlopCbetOpp += stats.raiseVsFlopCbetOpp
      us.raiseVsFlopCbetCount += stats.raiseVsFlopCbetCount
      us.sprFlopSum += stats.sprFlopSum
      us.sprFlopCnt += stats.sprFlopCnt
      us.sprTurnSum += stats.sprTurnSum
      us.sprTurnCnt += stats.sprTurnCnt
      us.sprRiverSum += stats.sprRiverSum
      us.sprRiverCnt += stats.sprRiverCnt
      us.positionCount = mergePositionCount(us.positionCount, stats.positionCount)
      us.luckHands += stats.luckHands
      us.luckExpectedWins += stats.luckExpectedWins
      us.luckActualWins += stats.luckActualWins
      us.luckGoodHits += stats.luckGoodHits
      us.luckBadBeats += stats.luckBadBeats
      us.luckAllInDogWins += stats.luckAllInDogWins
      us.luckAllInFavLoses += stats.luckAllInFavLoses
      us.charityAttempts += stats.charityAttempts
      us.charityFails += stats.charityFails

      if (us.relatedNames.indexOf(ledger.name) === -1) us.relatedNames.push(ledger.name)

      ;(stats.showdownSamples || []).forEach(sample => {
        addShowdownSample(us.showdownSamples, sample, 8)
      })
    })

    // 5. 用户头像临时链接转换
    const userList = Object.values(userStatsMap)
    const fileList = []
    userList.forEach(u => {
      if (u.avatarUrl && u.avatarUrl.indexOf('cloud://') === 0) fileList.push(u.avatarUrl)
    })

    const tempUrlMap = {}
    if (fileList.length > 0) {
      try {
        const result = await cloud.getTempFileURL({ fileList: fileList })
        ;(result.fileList || []).forEach(item => {
          if (item.tempFileURL) tempUrlMap[item.fileID] = item.tempFileURL
        })
      } catch (e) {
        console.error('[match_analysis] 获取头像临时链接失败:', e.message)
      }
    }

    userList.forEach(u => {
      const safeAvatar = tempUrlMap[u.avatarUrl] || u.avatarUrl
      const styles = generateStyles(u, u.net)
      const record = buildRecord(gameId, u.userId, u.gejuId, u.net, u, styles, true, safeAvatar, u.relatedNames || [])
      finalResults.push(record)
    })

    // 6. 返回
    finalResults.sort((a, b) => safeNumber(b.net) - safeNumber(a.net))
    const persistResult = await persistMatchPlayerStats(gameId, finalResults, matchData.status || '', FACT_COLLECTION)
    console.log('[match_analysis] 分析完成:', gameId, 'handFacts:', handFacts.length, 'players:', finalResults.length)

    return {
      code: 1,
      msg: '分析完成',
      data: finalResults,
      meta: {
        source: FACT_COLLECTION,
        handCount: handFacts.length,
        rawHandCount: rawHandCount,
        parsedHands: parsedHands,
        matchStatus: matchData.status || '',
        latestSync: syncResult,
        persisted: persistResult
      }
    }
  } catch (e) {
    console.error('[match_analysis] 失败:', normalizedGameId, e)
    return { code: -1, msg: '分析失败: ' + e.message }
  }
}
