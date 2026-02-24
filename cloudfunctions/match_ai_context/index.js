const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const FACT_COLLECTION = 'match_hand_facts'
const PLAYER_STATS_COLLECTION = 'match_player_stats'
const BINDING_COLLECTION = 'match_player_bindings'

const PAGE_LIMIT = 100
const DEFAULT_DETAIL_LIMIT = 80
const HARD_DETAIL_LIMIT = 160

function safeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function safeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function clampDetailLimit(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_DETAIL_LIMIT
  if (parsed < 20) return 20
  if (parsed > HARD_DETAIL_LIMIT) return HARD_DETAIL_LIMIT
  return parsed
}

async function loadMatchByGameId(gameId) {
  const gid = safeString(gameId)
  if (!gid) return null

  const exact = await db.collection('matches').where({ gameId: gid }).limit(1).get()
  if (exact.data && exact.data.length > 0) return exact.data[0]

  try {
    const byDocId = await db.collection('matches').doc(gid).get()
    if (byDocId && byDocId.data) return byDocId.data
  } catch (err) {}

  return null
}

async function loadCurrentUserAliases(gameId, openid) {
  const gid = safeString(gameId)
  const uid = safeString(openid)
  if (!gid || !uid) return []

  const res = await db.collection(BINDING_COLLECTION)
    .where({ gameId: gid, userId: uid })
    .field({ playerId: true, playerName: true })
    .get()

  const rows = Array.isArray(res.data) ? res.data : []
  const map = {}
  rows.forEach(row => {
    const playerId = safeString(row.playerId)
    if (!playerId) return
    if (!map[playerId]) {
      map[playerId] = {
        playerId,
        playerName: safeString(row.playerName)
      }
    }
  })
  return Object.values(map)
}

function simplifyPlayerFact(player) {
  const p = player && typeof player === 'object' ? player : {}
  return {
    playerId: safeString(p.playerId),
    playerName: safeString(p.playerName),
    position: safeString(p.position),
    vpipHands: safeNumber(p.vpipHands),
    pfrHands: safeNumber(p.pfrHands),
    limpHands: safeNumber(p.limpHands),
    sawFlopHands: safeNumber(p.sawFlopHands),
    showdowns: safeNumber(p.showdowns),
    showdownWins: safeNumber(p.showdownWins),
    bets: safeNumber(p.bets),
    raises: safeNumber(p.raises),
    calls: safeNumber(p.calls),
    checks: safeNumber(p.checks),
    folds: safeNumber(p.folds),
    sprFlop: p.sprFlop === null || p.sprFlop === undefined ? null : safeNumber(p.sprFlop),
    sprTurn: p.sprTurn === null || p.sprTurn === undefined ? null : safeNumber(p.sprTurn),
    sprRiver: p.sprRiver === null || p.sprRiver === undefined ? null : safeNumber(p.sprRiver)
  }
}

function simplifyShowdownFact(item) {
  const sd = item && typeof item === 'object' ? item : {}
  return {
    playerId: safeString(sd.playerId),
    playerName: safeString(sd.playerName),
    holeCards: Array.isArray(sd.holeCards) ? sd.holeCards : [],
    rangeKey: safeString(sd.rangeKey),
    rangeTier: safeString(sd.rangeTier),
    rangeLabel: safeString(sd.rangeLabel),
    rangePercent: sd.rangePercent === null || sd.rangePercent === undefined ? null : safeNumber(sd.rangePercent),
    rangeEquity: sd.rangeEquity === null || sd.rangeEquity === undefined ? null : safeNumber(sd.rangeEquity),
    comboCount: sd.comboCount === null || sd.comboCount === undefined ? null : safeNumber(sd.comboCount),
    allInHand: !!sd.allInHand,
    isAllInPlayer: !!sd.isAllInPlayer,
    allInStreet: safeString(sd.allInStreet),
    flopHandType: safeString(sd.flopHandType),
    flopSpr: sd.flopSpr === null || sd.flopSpr === undefined ? null : safeNumber(sd.flopSpr),
    flopAction: safeString(sd.flopAction),
    turnHandType: safeString(sd.turnHandType),
    turnSpr: sd.turnSpr === null || sd.turnSpr === undefined ? null : safeNumber(sd.turnSpr),
    turnAction: safeString(sd.turnAction),
    riverHandType: safeString(sd.riverHandType),
    riverSpr: sd.riverSpr === null || sd.riverSpr === undefined ? null : safeNumber(sd.riverSpr),
    riverAction: safeString(sd.riverAction)
  }
}

function simplifyPlayerStat(item) {
  const row = item && typeof item === 'object' ? item : {}
  const style = safeString(row.style)
  const styleTags = Array.isArray(row.styleTags)
    ? row.styleTags.filter(tag => typeof tag === 'string' && tag.trim())
    : (style ? style.split('/').filter(Boolean) : [])

  return {
    playerId: safeString(row.playerId),
    userId: safeString(row.userId),
    playerName: safeString(row.playerName),
    isUser: !!row.isUser,
    boundNames: Array.isArray(row.boundNames) ? row.boundNames : [],
    net: safeNumber(row.net),
    hands: safeNumber(row.hands),
    vpip: safeNumber(row.vpip),
    pfr: safeNumber(row.pfr),
    limp: safeNumber(row.limp),
    bet3: safeNumber(row.bet3),
    allIn: safeNumber(row.allIn),
    af: safeNumber(row.af),
    wtsd: safeNumber(row.wtsd),
    wsd: safeNumber(row.wsd),
    cbet: safeNumber(row.cbet),
    foldTo3Bet: safeNumber(row.foldTo3Bet),
    bet4: safeNumber(row.bet4),
    isolate: safeNumber(row.isolate),
    foldToFlopCbet: safeNumber(row.foldToFlopCbet),
    raiseVsFlopCbet: safeNumber(row.raiseVsFlopCbet),
    avgSprFlop: safeNumber(row.avgSprFlop),
    avgSprTurn: safeNumber(row.avgSprTurn),
    avgSprRiver: safeNumber(row.avgSprRiver),
    style,
    styleTags,
    positionCount: row.positionCount || {},
    rawCounts: row.rawCounts || {},
    showdownSamples: Array.isArray(row.showdownSamples) ? row.showdownSamples.slice(0, 8) : []
  }
}

async function loadHandFactsContext(gameId, aliasMap, detailLimit) {
  let lastHandNumber = 0
  let totalHands = 0
  let totalShowdownHands = 0
  let totalUserHands = 0
  let totalUserShowdownHands = 0
  const userHands = []
  const showdownHands = []
  const hasAlias = !!(aliasMap && Object.keys(aliasMap).length > 0)

  while (true) {
    const batch = await db.collection(FACT_COLLECTION)
      .where({
        gameId,
        handNumber: _.gt(lastHandNumber)
      })
      .field({
        handNumber: true,
        players: true,
        showdownPlayers: true
      })
      .orderBy('handNumber', 'asc')
      .limit(PAGE_LIMIT)
      .get()

    const rows = Array.isArray(batch.data) ? batch.data : []
    if (rows.length === 0) break

    rows.forEach(handDoc => {
      totalHands += 1
      const handNumber = safeNumber(handDoc.handNumber)
      const players = Array.isArray(handDoc.players) ? handDoc.players : []
      const showdownPlayers = Array.isArray(handDoc.showdownPlayers) ? handDoc.showdownPlayers : []

      if (showdownPlayers.length > 0) {
        totalShowdownHands += 1
        if (showdownHands.length < detailLimit) {
          showdownHands.push({
            handNumber,
            showdownPlayers: showdownPlayers.map(simplifyShowdownFact)
          })
        }
      }

      if (hasAlias) {
        const myPlayers = players.filter(one => aliasMap[safeString(one.playerId)]).map(simplifyPlayerFact)
        if (myPlayers.length > 0) {
          totalUserHands += 1
          const myShowdown = showdownPlayers.filter(one => aliasMap[safeString(one.playerId)]).map(simplifyShowdownFact)
          if (showdownPlayers.length > 0) totalUserShowdownHands += 1

          if (userHands.length < detailLimit) {
            userHands.push({
              handNumber,
              myPlayers,
              hasShowdown: showdownPlayers.length > 0,
              myShowdown,
              showdownPlayers: showdownPlayers.map(simplifyShowdownFact)
            })
          }
        }
      }
    })

    lastHandNumber = safeNumber(rows[rows.length - 1].handNumber)
    if (rows.length < PAGE_LIMIT) break
  }

  return {
    totals: {
      hands: totalHands,
      showdownHands: totalShowdownHands,
      userHands: totalUserHands,
      userShowdownHands: totalUserShowdownHands
    },
    userHands,
    showdownHands,
    truncated: {
      userHands: totalUserHands > userHands.length,
      showdownHands: totalShowdownHands > showdownHands.length
    }
  }
}

async function loadPlayerStats(gameId) {
  const countRes = await db.collection(PLAYER_STATS_COLLECTION).where({ gameId }).count()
  const total = safeNumber(countRes.total)
  if (total <= 0) return []

  const rows = []
  for (let i = 0; i < total; i += PAGE_LIMIT) {
    const batch = await db.collection(PLAYER_STATS_COLLECTION)
      .where({ gameId })
      .field({
        playerId: true,
        userId: true,
        playerName: true,
        isUser: true,
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
        avgSprFlop: true,
        avgSprTurn: true,
        avgSprRiver: true,
        style: true,
        styleTags: true,
        positionCount: true,
        rawCounts: true,
        showdownSamples: true
      })
      .skip(i)
      .limit(PAGE_LIMIT)
      .get()

    const list = Array.isArray(batch.data) ? batch.data : []
    list.forEach(one => rows.push(simplifyPlayerStat(one)))
  }

  rows.sort((a, b) => safeNumber(b.net) - safeNumber(a.net))
  return rows
}

exports.main = async (event, context) => {
  const gameIdInput = safeString(event.gameId)
  if (!gameIdInput) return { code: -1, msg: '缺少 gameId' }

  const detailLimit = clampDetailLimit(event.detailLimit)
  const wxContext = cloud.getWXContext()
  const myOpenId = safeString(wxContext.OPENID)

  try {
    const matchDoc = await loadMatchByGameId(gameIdInput)
    if (!matchDoc) return { code: -1, msg: '对局不存在: ' + gameIdInput }

    const gameId = safeString(matchDoc.gameId) || gameIdInput
    const matchStatus = safeString(matchDoc.status)
    const isEnded = matchStatus === '已结束'

    const aliasPlayers = await loadCurrentUserAliases(gameId, myOpenId)
    const aliasMap = {}
    aliasPlayers.forEach(one => {
      aliasMap[one.playerId] = true
    })
    const userInMatch = aliasPlayers.length > 0

    const handFacts = await loadHandFactsContext(gameId, aliasMap, detailLimit)
    const playerStats = await loadPlayerStats(gameId)

    const baseHands = userInMatch ? handFacts.totals.userHands : handFacts.totals.hands
    const sampleTooSmall = baseHands < 20

    return {
      code: 1,
      msg: 'ok',
      data: {
        gameId,
        matchStatus,
        isEnded,
        detailLimit,
        matchMeta: {
          name: safeString(matchDoc.name),
          currentHandNumber: safeNumber(matchDoc.currentHandNumber),
          status: matchStatus
        },
        currentUser: {
          openid: myOpenId,
          inMatch: userInMatch,
          aliasPlayers,
          aliasPlayerIds: aliasPlayers.map(one => one.playerId)
        },
        handFacts,
        playerStats,
        totals: {
          hands: handFacts.totals.hands,
          showdownHands: handFacts.totals.showdownHands,
          userHands: handFacts.totals.userHands,
          userShowdownHands: handFacts.totals.userShowdownHands,
          playerStats: playerStats.length
        },
        qualityHint: {
          minHandsForStableSuggestion: 20,
          baseHands,
          sampleTooSmall
        }
      }
    }
  } catch (err) {
    console.error('[match_ai_context] failed:', err)
    return { code: -1, msg: '构建对局分析上下文失败: ' + err.message }
  }
}
