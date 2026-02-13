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
    showdownSamples: []
  }
}

function generateStyles(stats, net) {
  const styles = []

  const vpip = ratio(stats.vpipHands, stats.hands)
  const pfr = ratio(stats.pfrHands, stats.hands)
  const afBase = stats.calls || 0
  const afTop = (stats.bets || 0) + (stats.raises || 0)
  const af = afBase > 0 ? (afTop / afBase) : (afTop > 0 ? 10 : 0)

  const wsd = ratio(stats.showdownWins, stats.showdowns)
  const allInWinRate = ratio(stats.allInWins, stats.allInCnt)

  const foldTo3Bet = ratio(stats.foldTo3BetCount, stats.foldTo3BetOpp)
  const bet4Freq = ratio(stats.bet4Count, stats.bet4Opp)
  const isolateFreq = ratio(stats.isolateCount, stats.isolateOpp)
  const foldToFlopCbet = ratio(stats.foldToFlopCbetCount, stats.foldToFlopCbetOpp)
  const raiseVsFlopCbet = ratio(stats.raiseVsFlopCbetCount, stats.raiseVsFlopCbetOpp)

  if (vpip > 0.35) styles.push('松')
  else if (vpip < 0.20) styles.push('紧')

  if (pfr > 0.22) styles.push('凶')
  else if (pfr < 0.10) styles.push('弱')

  if (af > 2.2) styles.push('激进')
  else if (af < 1.0) styles.push('跟注')

  if (stats.foldTo3BetOpp >= 3 && foldTo3Bet >= 0.65) styles.push('怕3bet')
  if (stats.bet4Opp >= 2 && bet4Freq >= 0.12) styles.push('反击')
  if (stats.isolateOpp >= 3 && isolateFreq >= 0.30) styles.push('剥削')

  if (stats.foldToFlopCbetOpp >= 3 && foldToFlopCbet >= 0.65) styles.push('翻后保守')
  if (stats.raiseVsFlopCbetOpp >= 3 && raiseVsFlopCbet >= 0.20) styles.push('翻后反击')

  if (wsd >= 0.60 && stats.showdowns >= 3) styles.push('欧皇')
  else if (wsd <= 0.30 && stats.showdowns >= 3) styles.push('非酋')

  if (allInWinRate >= 0.75 && stats.allInCnt >= 2) styles.push('跑马王')
  else if (allInWinRate <= 0.25 && stats.allInCnt >= 2) styles.push('慈善家')

  if (vpip > 0.40 && net > 5000) styles.push('天选')
  if (vpip < 0.30 && net < -5000) styles.push('倒霉')

  if (styles.length === 0) styles.push('平衡')
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
    style: styles.join('/'),
    updateTime: new Date()
  }

  return record
}

async function loadMatchHandFacts(gameId) {
  const MAX_LIMIT = 100
  let facts = []

  const countRes = await db.collection(FACT_COLLECTION).where({ gameId: gameId }).count()
  const total = countRes.total || 0

  for (let i = 0; i < total; i += MAX_LIMIT) {
    const batch = await db.collection(FACT_COLLECTION)
      .where({ gameId: gameId })
      .orderBy('handNumber', 'asc')
      .skip(i)
      .limit(MAX_LIMIT)
      .get()
    facts = facts.concat(batch.data || [])
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

async function loadPersistedMatchPlayerStats(gameId) {
  const MAX_LIMIT = 100
  let docs = []
  const countRes = await db.collection(PLAYER_STATS_COLLECTION).where({ gameId: gameId }).count()
  const total = countRes.total || 0

  for (let i = 0; i < total; i += MAX_LIMIT) {
    const batch = await db.collection(PLAYER_STATS_COLLECTION)
      .where({ gameId: gameId })
      .skip(i)
      .limit(MAX_LIMIT)
      .get()
    docs = docs.concat(batch.data || [])
  }

  return docs
}

async function loadMatchByGameId(gameId) {
  const normalized = String(gameId || '').trim()
  if (!normalized) return null

  const exactRes = await db.collection('matches').where({ gameId: normalized }).limit(1).get()
  if (exactRes.data && exactRes.data.length > 0) return exactRes.data[0]

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

function buildLedgerFallbackResults(gameId, ledgerMap, bindMap, userMap) {
  const finalResults = []
  const userStatsMap = {}
  const allPlayerIds = Object.keys(ledgerMap || {})

  allPlayerIds.forEach(pid => {
    const ledger = ledgerMap[pid] || { name: pid, net: 0 }
    const playerName = ledger.name || pid
    const net = safeNumber(ledger.net)
    const binding = bindMap[pid]
    const emptyStats = buildDefaultStats(pid, playerName)

    if (!binding || !binding.userId) {
      finalResults.push(buildRecord(gameId, pid, playerName, net, emptyStats, [], false, '', []))
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
    us.net += net
    if (us.relatedNames.indexOf(playerName) === -1) us.relatedNames.push(playerName)
  })

  Object.keys(userStatsMap).forEach(uid => {
    const us = userStatsMap[uid]
    finalResults.push(buildRecord(gameId, uid, us.gejuId, us.net, us, [], true, us.avatarUrl, us.relatedNames || []))
  })

  finalResults.sort((a, b) => safeNumber(b.net) - safeNumber(a.net))
  return finalResults
}

function triggerEtlBackfill(gameId) {
  cloud.callFunction({
    name: 'match_hand_etl',
    data: {
      gameId: gameId,
      maxRuntimeMs: 2200,
      maxHandsPerRun: 12,
      enableRelay: true
    }
  }).catch(err => {
    console.error('[match_analysis] ETL 补算触发失败:', err.message)
  })
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
    const matchData = await loadMatchByGameId(normalizedGameId)
    if (!matchData) return { code: -1, msg: '对局不存在: ' + normalizedGameId }

    const gameId = String(matchData.gameId || normalizedGameId)
    const isEnded = matchData.status === '已结束'
    const playersInfos = (matchData.ledger && matchData.ledger.playersInfos) || {}

    const ledgerMap = {}
    Object.keys(playersInfos).forEach(key => {
      const p = playersInfos[key] || {}
      ledgerMap[p.id] = {
        name: (p.names && p.names[0]) || 'Unknown',
        net: safeNumber(p.net)
      }
    })

    // 2. 绑定数据（进行中强制隐藏）
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

    // 3. 读取 ETL 基础表并聚合
    const handFacts = await loadMatchHandFacts(gameId)
    const rawHandCountRes = await db.collection('match_hands').where({ gameId: gameId }).count()
    const rawHandCount = rawHandCountRes.total || 0

    if (handFacts.length === 0 && rawHandCount > 0) {
      triggerEtlBackfill(gameId)

      const cachedStats = await loadPersistedMatchPlayerStats(gameId)
      const cachedResults = (cachedStats || []).slice().sort((a, b) => safeNumber(b.net) - safeNumber(a.net))
      const cachedHasDisplayValue = cachedResults.some(item => safeNumber(item.hands) > 0 || safeNumber(item.net) !== 0)

      if (cachedHasDisplayValue) {
        return {
          code: 1,
          msg: '基础统计补算中，已返回缓存结果',
          data: cachedResults,
          meta: {
            source: PLAYER_STATS_COLLECTION,
            handCount: 0,
            rawHandCount: rawHandCount,
            cached: true,
            etlTriggered: true,
            matchStatus: matchData.status || ''
          }
        }
      }

      const ledgerFallback = buildLedgerFallbackResults(gameId, ledgerMap, bindMap, userMap)
      if (ledgerFallback.length > 0) {
        const persistFallback = await persistMatchPlayerStats(gameId, ledgerFallback, matchData.status || '', 'ledger_fallback')
        return {
          code: 1,
          msg: '基础统计补算中，已返回账单快照',
          data: ledgerFallback,
          meta: {
            source: 'ledger_fallback',
            handCount: 0,
            rawHandCount: rawHandCount,
            cached: false,
            etlTriggered: true,
            persisted: persistFallback,
            matchStatus: matchData.status || ''
          }
        }
      }

      return {
        code: 0,
        msg: '基础统计未生成，且暂无可展示的账单数据',
        data: [],
        meta: {
          source: FACT_COLLECTION,
          handCount: 0,
          rawHandCount: rawHandCount,
          cached: false,
          etlTriggered: true,
          matchStatus: matchData.status || ''
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
          matchStatus: matchData.status || ''
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
        persisted: persistResult
      }
    }
  } catch (e) {
    console.error('[match_analysis] 失败:', e)
    return { code: -1, msg: '分析失败: ' + e.message }
  }
}
