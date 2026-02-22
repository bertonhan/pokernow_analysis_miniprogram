const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const GLOBAL_COLLECTION = 'player_global_stats'
const BINDING_COLLECTION = 'match_player_bindings'
const RECENT_MATCH_SINCE_TS = Date.parse('2026-01-01T00:00:00+08:00')

function toInt(value, fallback) {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function safeNumber(value) {
  const num = Number(value)
  return isNaN(num) ? 0 : num
}

function toTs(value) {
  if (!value) return 0
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const ts = new Date(raw).getTime()
  return isNaN(ts) ? 0 : ts
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

function normalizeRecentMatches(matches) {
  return (Array.isArray(matches) ? matches : [])
    .map(item => {
      const one = item || {}
      const createTime = String(one.createTime || one.endTime || '')
      return {
        gameId: String(one.gameId || ''),
        matchName: String(one.matchName || ''),
        net: safeNumber(one.net),
        hands: safeNumber(one.hands),
        createTime: createTime,
        createTs: toTs(createTime),
        endTime: String(one.endTime || ''),
        endTs: toTs(one.endTime),
        aliases: normalizeAliasList(one.aliases)
      }
    })
    .filter(item => safeNumber(item.createTs || item.endTs) >= RECENT_MATCH_SINCE_TS)
    .sort((a, b) => safeNumber(b.createTs || b.endTs) - safeNumber(a.createTs || a.endTs))
    .map(item => ({
      gameId: item.gameId,
      matchName: item.matchName,
      net: item.net,
      hands: item.hands,
      createTime: item.createTime,
      endTime: item.endTime,
      aliases: item.aliases
    }))
}

async function loadAliasMapByUserAndGames(userId, gameIds) {
  const uid = String(userId || '').trim()
  const gids = (Array.isArray(gameIds) ? gameIds : [])
    .map(v => String(v || '').trim())
    .filter(Boolean)
  if (!uid || gids.length === 0) return {}

  const uniqueGameIds = []
  gids.forEach(gid => {
    if (uniqueGameIds.indexOf(gid) === -1) uniqueGameIds.push(gid)
  })

  const aliasMap = {}
  const GAME_BATCH = 20
  const PAGE_LIMIT = 100

  for (let i = 0; i < uniqueGameIds.length; i += GAME_BATCH) {
    const oneBatch = uniqueGameIds.slice(i, i + GAME_BATCH)
    let offset = 0

    while (true) {
      const res = await db.collection(BINDING_COLLECTION)
        .where({
          userId: uid,
          gameId: _.in(oneBatch)
        })
        .field({
          gameId: true,
          playerName: true
        })
        .skip(offset)
        .limit(PAGE_LIMIT)
        .get()

      const rows = res.data || []
      rows.forEach(row => {
        const gameId = String(row.gameId || '').trim()
        if (!gameId) return
        if (!aliasMap[gameId]) aliasMap[gameId] = []
        aliasMap[gameId] = normalizeAliasList(aliasMap[gameId].concat([row.playerName]))
      })

      if (rows.length < PAGE_LIMIT) break
      offset += rows.length
    }
  }

  return aliasMap
}

async function enrichRecentMatchesAliases(doc, recentMatches) {
  const list = Array.isArray(recentMatches) ? recentMatches : []
  if (!doc || !doc.isBound || !doc.userId || list.length === 0) return list

  const missingGameIds = []
  list.forEach(item => {
    const aliases = normalizeAliasList(item && item.aliases)
    if (aliases.length === 0) {
      const gid = String(item && item.gameId || '').trim()
      if (gid && missingGameIds.indexOf(gid) === -1) missingGameIds.push(gid)
    }
  })
  if (missingGameIds.length === 0) return list

  let aliasMap = {}
  try {
    aliasMap = await loadAliasMapByUserAndGames(doc.userId, missingGameIds)
  } catch (e) {
    console.error('[player_global_query] 回填马甲失败:', e.message)
    return list
  }

  return list.map(item => {
    const gameId = String(item && item.gameId || '').trim()
    const merged = normalizeAliasList([]
      .concat(item && item.aliases || [])
      .concat(aliasMap[gameId] || []))
    return Object.assign({}, item, { aliases: merged })
  })
}

function buildWhere(mode) {
  const where = {}
  if (mode === 'bound') where.isBound = true
  else if (mode === 'solo') where.isBound = false
  return where
}

function buildListItem(doc, rank) {
  const item = doc || {}
  return {
    globalPlayerKey: item.globalPlayerKey,
    entityType: item.entityType,
    isBound: !!item.isBound,
    userId: item.userId || '',
    soloGameId: item.soloGameId || '',
    soloPlayerId: item.soloPlayerId || '',
    displayName: item.displayName || '未知选手',
    avatarUrl: item.avatarUrl || '',
    totalNet: safeNumber(item.totalNet),
    gameCount: safeNumber(item.gameCount),
    hands: safeNumber(item.hands),
    vpip: safeNumber(item.vpip),
    pfr: safeNumber(item.pfr),
    af: safeNumber(item.af),
    styleTags: item.styleTags || [],
    updateTime: item.updateTime || null,
    rank: rank
  }
}

async function queryList(event) {
  const page = Math.max(1, toInt(event.page, 1))
  const pageSize = Math.max(1, Math.min(50, toInt(event.pageSize, 20)))
  const mode = String(event.mode || 'all')
  const skip = (page - 1) * pageSize

  const fieldMap = {
    globalPlayerKey: true,
    entityType: true,
    isBound: true,
    userId: true,
    soloGameId: true,
    soloPlayerId: true,
    displayName: true,
    avatarUrl: true,
    totalNet: true,
    gameCount: true,
    hands: true,
    vpip: true,
    pfr: true,
    af: true,
    styleTags: true,
    updateTime: true
  }

  const whereBase = buildWhere(mode)
  const countRes = await db.collection(GLOBAL_COLLECTION).where(whereBase).count()
  const total = countRes.total || 0
  const listRes = await db.collection(GLOBAL_COLLECTION)
    .where(whereBase)
    .orderBy('totalNet', 'desc')
    .skip(skip)
    .limit(pageSize)
    .field(fieldMap)
    .get()
  const rows = listRes.data || []

  const data = rows.map((item, idx) => buildListItem(item, skip + idx + 1))

  return {
    code: 1,
    msg: '查询成功',
    data: data,
    meta: {
      page: page,
      pageSize: pageSize,
      total: total,
      hasMore: skip + rows.length < total,
      mode: mode
    }
  }
}

async function queryDetail(event) {
  const globalPlayerKey = String(event.globalPlayerKey || '').trim()
  if (!globalPlayerKey) return { code: -1, msg: '缺少 globalPlayerKey' }

  const res = await db.collection(GLOBAL_COLLECTION)
    .where({ globalPlayerKey: globalPlayerKey })
    .field({
      globalPlayerKey: true,
      entityType: true,
      isBound: true,
      userId: true,
      soloGameId: true,
      soloPlayerId: true,
      displayName: true,
      avatarUrl: true,
      boundNames: true,
      totalNet: true,
      gameCount: true,
      gameIds: true,
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
      styleTags: true,
      recentMatches: true,
      rawCounts: true,
      dataQuality: true,
      updateTime: true
    })
    .limit(1)
    .get()

  if (!res.data || res.data.length === 0) {
    return { code: 0, msg: '玩家不存在', data: null }
  }

  const doc = Object.assign({}, res.data[0])
  doc.recentMatches = normalizeRecentMatches(doc.recentMatches)
  doc.recentMatches = await enrichRecentMatchesAliases(doc, doc.recentMatches)

  return {
    code: 1,
    msg: '查询成功',
    data: doc
  }
}

async function triggerRebuild(event) {
  const awaitBuild = event.awaitBuild === true
  if (awaitBuild) {
    const res = await cloud.callFunction({
      name: 'player_global_build',
      data: event.buildOptions || {}
    })
    const nested = res && res.result ? res.result : null
    if (!nested || nested.code !== 1) {
      return {
        code: -1,
        msg: nested && nested.msg ? nested.msg : '构建失败',
        data: nested
      }
    }
    return {
      code: 1,
      msg: '已完成构建',
      data: nested
    }
  }

  cloud.callFunction({
    name: 'player_global_build',
    data: event.buildOptions || {}
  }).catch(err => {
    console.error('[player_global_query] 触发构建失败:', err.message)
  })

  return {
    code: 1,
    msg: '已触发构建，请稍后刷新',
    data: { dispatched: true }
  }
}

exports.main = async (event, context) => {
  const action = String(event.action || 'list')
  try {
    if (action === 'list') return await queryList(event)
    if (action === 'detail') return await queryDetail(event)
    if (action === 'rebuild') return await triggerRebuild(event)
    return { code: -1, msg: '未知 action: ' + action }
  } catch (e) {
    console.error('[player_global_query] 失败:', e)
    return {
      code: -1,
      msg: '查询失败: ' + e.message
    }
  }
}
