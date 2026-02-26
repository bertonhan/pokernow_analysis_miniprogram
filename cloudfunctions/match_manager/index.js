// cloudfunctions/match_manager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MATCH_COLLECTION = 'matches'
const USER_COLLECTION = 'users'
const BIND_COLLECTION = 'match_player_bindings'
const PLAYER_STATS_COLLECTION = 'match_player_stats'
const QUERY_CHUNK_SIZE = 20
const WRITE_CHUNK_SIZE = 20

const ADMIN_LIST = [
  'oVJBv3Z6GzqygarChiUpuMfpPUxw',
  'oVJBv3ZQeK89wBj07zNfqYs9mdN0' 
  // '你的OpenID'
]

// 格式化时间
function formatDate(inputDate) {
  if (!inputDate) return null
  const date = new Date(inputDate);
  if (isNaN(date.getTime())) return null
  const timestamp = date.getTime();
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingDate = new Date(timestamp + beijingOffset);
  return `${beijingDate.getUTCFullYear()}-${(beijingDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${beijingDate.getUTCDate().toString().padStart(2, '0')} ${beijingDate.getUTCHours().toString().padStart(2, '0')}:${beijingDate.getUTCMinutes().toString().padStart(2, '0')}`;
}

// === 核心修复：超强力时间提取器 ===
function extractTime(handDoc) {
  if (!handDoc) return null
  
  // 1. 优先取顶层时间 (兼容各种写法)
  if (handDoc.created_at) return handDoc.created_at
  if (handDoc.createdAt) return handDoc.createdAt
  if (handDoc.updateTime) return handDoc.updateTime
  
  // 2. 从 raw_logs 里找
  if (handDoc.raw_logs && Array.isArray(handDoc.raw_logs) && handDoc.raw_logs.length > 0) {
    // 打印第一条日志结构，方便调试
    // console.log('>>> [Debug] Log Structure:', handDoc.raw_logs[0])
    
    // 过滤出有时间的日志
    const validLogs = handDoc.raw_logs.filter(l => l.createdAt || l.created_at || l.time)
    
    if (validLogs.length > 0) {
      // 按时间排序
      validLogs.sort((a, b) => {
        const ta = a.createdAt || a.created_at || a.time || ''
        const tb = b.createdAt || b.created_at || b.time || ''
        return ta.localeCompare(tb)
      })
      // 取最后一条
      const last = validLogs[validLogs.length - 1]
      return last.createdAt || last.created_at || last.time
    }
  }
  return null
}

function normalizeText(raw) {
  return String(raw || '').trim()
}

function parseManualNet(raw) {
  if (typeof raw === 'number' && isFinite(raw)) {
    return { ok: true, value: raw }
  }

  const text = normalizeText(raw)
  if (!text) return { ok: false, msg: '成绩不能为空' }

  const normalized = text
    .replace(/，/g, ',')
    .replace(/,/g, '')
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/\s+/g, '')

  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, msg: '成绩格式错误' }
  }

  const value = Number(normalized)
  if (!isFinite(value)) return { ok: false, msg: '成绩格式错误' }
  return { ok: true, value: value }
}

function buildManualGameId(now) {
  return 'manual_' + now.getTime() + '_' + Math.floor(Math.random() * 1000).toString().padStart(3, '0')
}

function toSafeDocSegment(raw) {
  return encodeURIComponent(String(raw || '').trim()).replace(/%/g, '_')
}

function buildEmptyStatDoc() {
  return {
    hands: 0,
    vpip: 0,
    pfr: 0,
    limp: 0,
    bet3: 0,
    allIn: 0,
    af: 0,
    wtsd: 0,
    wsd: 0,
    cbet: 0,
    foldTo3Bet: 0,
    bet4: 0,
    isolate: 0,
    foldToFlopCbet: 0,
    raiseVsFlopCbet: 0
  }
}

async function loadUserMapByGejuId(gejuIds) {
  const result = {}
  const ids = (gejuIds || [])
    .map(one => normalizeText(one))
    .filter(Boolean)

  if (ids.length === 0) return result

  for (let i = 0; i < ids.length; i += QUERY_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + QUERY_CHUNK_SIZE)
    const res = await db.collection(USER_COLLECTION)
      .where({ gejuId: _.in(chunk) })
      .field({
        _openid: true,
        gejuId: true,
        avatarUrl: true
      })
      .get()

    ;(res.data || []).forEach(user => {
      const gejuId = normalizeText(user && user.gejuId)
      if (!gejuId) return
      if (!result[gejuId]) result[gejuId] = user
    })
  }

  return result
}

async function batchSetDocs(collectionName, docList) {
  if (!Array.isArray(docList) || docList.length === 0) return
  for (let i = 0; i < docList.length; i += WRITE_CHUNK_SIZE) {
    const chunk = docList.slice(i, i + WRITE_CHUNK_SIZE)
    const tasks = chunk.map(item => db.collection(collectionName).doc(item.docId).set({ data: item.data }))
    if (tasks.length > 0) await Promise.all(tasks)
  }
}

async function calculateRealTime(gameId) {
  console.log(`>>> [Timer] 开始计算 GameId: ${gameId}`)
  let result = {}
  
  try {
    // ----------------------------------------
    // 1. 找【第一手牌】 (Hand #Min)
    // ----------------------------------------
    const firstHandRes = await db.collection('match_hands')
      .where({ gameId: gameId })
      .orderBy('handNumber', 'asc')
      .limit(1)
      .get()

    if (firstHandRes.data.length > 0) {
      const doc = firstHandRes.data[0]
      // 【关键调试日志】打印一下找到的数据长什么样，看看有没有时间字段
      console.log(`>>> [Timer] 找到第一手牌 (Hand #${doc.handNumber})`)
      console.log('>>> [Debug] First Hand Keys:', Object.keys(doc)) 
      if(doc.raw_logs && doc.raw_logs.length > 0) console.log('>>> [Debug] First Log Sample:', doc.raw_logs[0])

      const t = extractTime(doc)
      if (t) {
        result.realStartTime = formatDate(t)
        console.log(`>>> [Timer] 提取到开始时间: ${t} -> ${result.realStartTime}`)
      } else {
        console.warn('>>> [Timer] 第一手牌找到了，但提取不到时间！')
      }
    } else {
      console.warn('>>> [Timer] 警告：数据库里找不到该对局的任何手牌 (match_hands 为空)')
    }

    // ----------------------------------------
    // 2. 找【最后一手牌】 (Hand #Max)
    // ----------------------------------------
    const lastHandRes = await db.collection('match_hands')
      .where({ gameId: gameId })
      .orderBy('handNumber', 'desc')
      .limit(1)
      .get()

    if (lastHandRes.data.length > 0) {
      const doc = lastHandRes.data[0]
      console.log(`>>> [Timer] 找到最后一手牌 (Hand #${doc.handNumber})`)
      
      const t = extractTime(doc)
      if (t) {
        result.realEndTime = formatDate(t)
        console.log(`>>> [Timer] 提取到结束时间: ${t} -> ${result.realEndTime}`)
      } else {
        console.warn('>>> [Timer] 最后一手牌提取不到时间！')
      }
    }

  } catch (e) {
    console.error('>>> [Timer] 计算过程报错:', e)
  }

  return result
}

exports.main = async (event, context) => {
  const { action, matchLink, gameId } = event
  const wxContext = cloud.getWXContext()
  const myOpenId = wxContext.OPENID

  // === 1. 结束对局 ===
  if (action === 'end_match') {
    try {
      console.log('>>> 正在结束对局:', gameId)
      
      // 计算时间
      const timeData = await calculateRealTime(gameId)
      
      let updateData = {
        status: '已结束',
        updateTime: new Date()
      }
      
      if (timeData.realStartTime) updateData.realStartTime = timeData.realStartTime
      if (timeData.realEndTime) updateData.realEndTime = timeData.realEndTime
      
      console.log('>>> 准备写入数据库:', updateData)
      
      // 执行更新
      const res = await db.collection('matches').where({ gameId: gameId }).update({ data: updateData })
      console.log('>>> 更新结果:', res)

      // 兜底补算一次全部手牌 ETL，确保详情页读取的是基础表
      cloud.callFunction({
        name: 'match_hand_etl',
        data: { gameId: gameId }
      }).catch(err => {
        console.error('>>> [ETL Backfill] 触发失败:', err.message)
      })
      
      return { code: 1, msg: '操作成功' }
    } catch (e) {
      console.error('>>> 结束失败:', e)
      return { code: -1, msg: '操作失败: ' + e.message }
    }
  }

  // === 2. 列表 ===
  if (action === 'list') {
    return await db.collection(MATCH_COLLECTION)
      .where({ status: _.neq('已删除') })
      .orderBy('createTimeFull', 'desc')
      .get()
  }

  // === 3. 新建 ===
  if (action === 'create') {
    const parts = matchLink.split('/games/')
    if (parts.length < 2) return { code: -1, msg: '链接格式错误' }
    const targetGameId = parts[1].split('?')[0] 
    const exist = await db.collection(MATCH_COLLECTION).where({ gameId: targetGameId, status: _.neq('已删除') }).get()
    if (exist.data.length > 0) return { code: 0, msg: '对局已存在' }
    const now = new Date()
    await db.collection(MATCH_COLLECTION).add({
      data: {
        _openid: myOpenId, gameId: targetGameId, matchLink: matchLink,
        name: `格局 ${formatDate(now)}`, createTime: formatDate(now), createTimeFull: now,
        status: '记录中', currentHandNumber: 1
      }
    })
    cloud.callFunction({ name: 'match_crawler', data: { gameId: targetGameId, handNumber: 1 } })
    return { code: 1, msg: '创建成功' }
  }

  // === 4. 线下手工录入 ===
  if (action === 'create_manual_match') {
    const matchName = normalizeText(event.matchName)
    const rawPlayers = Array.isArray(event.players) ? event.players : []

    if (!matchName) return { code: -1, msg: '请输入本次格局名称' }
    if (rawPlayers.length === 0) return { code: -1, msg: '请先录入选手成绩' }

    const mergedMap = {}
    for (let i = 0; i < rawPlayers.length; i += 1) {
      const row = rawPlayers[i] || {}
      const gejuId = normalizeText(row.gejuId)
      if (!gejuId) continue

      const parsed = parseManualNet(row.net)
      if (!parsed.ok) {
        return { code: -1, msg: `第${i + 1}行成绩格式错误` }
      }

      if (!mergedMap[gejuId]) mergedMap[gejuId] = 0
      mergedMap[gejuId] += parsed.value
    }

    const players = Object.keys(mergedMap).map(gejuId => ({
      gejuId: gejuId,
      net: Number(mergedMap[gejuId])
    }))

    if (players.length === 0) return { code: -1, msg: '请至少填写1名选手成绩' }

    const now = new Date()
    const gameId = buildManualGameId(now)
    const userMap = await loadUserMapByGejuId(players.map(one => one.gejuId))
    const playersInfos = {}
    let totalNet = 0

    players.forEach((player, index) => {
      playersInfos[String(index + 1)] = {
        id: player.gejuId,
        names: [player.gejuId],
        net: player.net
      }
      totalNet += player.net
    })

    await db.collection(MATCH_COLLECTION).add({
      data: {
        _openid: myOpenId,
        gameId: gameId,
        matchLink: `manual://${gameId}`,
        name: matchName,
        createTime: formatDate(now),
        createTimeFull: now,
        realStartTime: formatDate(now),
        realEndTime: formatDate(now),
        status: '已结束',
        currentHandNumber: 0,
        isManual: true,
        manualSource: 'offline_manual',
        manualPlayerCount: players.length,
        ledger: {
          playersInfos: playersInfos
        },
        updateTime: now
      }
    })

    const bindingDocs = []
    const statDocs = []
    players.forEach(player => {
      const gejuId = player.gejuId
      const user = userMap[gejuId] || null
      const userId = normalizeText(user && user._openid)
      const avatarUrl = normalizeText(user && user.avatarUrl)
      const playerId = gejuId
      const docSuffix = toSafeDocSegment(playerId)

      if (userId) {
        bindingDocs.push({
          docId: `${gameId}_${docSuffix}`,
          data: {
            gameId: gameId,
            playerId: playerId,
            playerName: gejuId,
            userId: userId,
            avatarUrl: avatarUrl,
            createTime: now,
            source: 'manual_entry'
          }
        })
      }

      statDocs.push({
        docId: `${gameId}_${docSuffix}`,
        data: Object.assign({
          gameId: gameId,
          playerId: playerId,
          userId: userId,
          playerName: gejuId,
          isUser: !!userId,
          avatarUrl: avatarUrl,
          boundNames: [gejuId],
          net: player.net,
          styleTags: ['线下录入'],
          style: '线下录入',
          matchStatus: '已结束',
          analysisSource: 'manual_entry',
          analysisUpdateTime: now,
          updateTime: now
        }, buildEmptyStatDoc())
      })
    })

    await batchSetDocs(BIND_COLLECTION, bindingDocs)
    await batchSetDocs(PLAYER_STATS_COLLECTION, statDocs)

    cloud.callFunction({
      name: 'player_global_build',
      data: {
        trigger: 'manual_entry',
        gameId: gameId
      }
    }).catch(err => {
      console.error('[match_manager] trigger player_global_build failed:', err.message)
    })

    return {
      code: 1,
      msg: '创建成功（全局统计后台刷新中）',
      gameId: gameId,
      playerCount: players.length,
      totalNet: totalNet
    }
  }

  // === 5. 切换状态 ===
  if (action === 'toggle_status') {
    const match = await db.collection(MATCH_COLLECTION).where({ gameId: gameId }).get()
    if (match.data.length === 0) return { code: -1 }
    const currentStatus = match.data[0].status
    let newStatus = '记录中'
    let updatePayload = {}
    
    // 切换状态顺便更新时间
    const timeData = await calculateRealTime(gameId)
    if (timeData.realStartTime) updatePayload.realStartTime = timeData.realStartTime
    if (timeData.realEndTime) updatePayload.realEndTime = timeData.realEndTime

    if (currentStatus === '记录中') {
      newStatus = '已暂停'
    } else {
      newStatus = '记录中'
      const currentHand = match.data[0].currentHandNumber || 1
      cloud.callFunction({ name: 'match_crawler', data: { gameId: gameId, handNumber: currentHand } })
    }
    updatePayload.status = newStatus
    await db.collection(MATCH_COLLECTION).where({ gameId: gameId }).update({ data: updatePayload })
    return { code: 1, newStatus: newStatus }
  }

  // === 6. 删除 ===
  if (action === 'delete') {
    if (!ADMIN_LIST.includes(myOpenId)) return { code: -1, msg: '无权操作' }
    await db.collection(MATCH_COLLECTION).where({ gameId: gameId }).update({
      data: { status: '已删除', deleteTime: new Date(), deleteBy: myOpenId }
    })
    return { code: 1, msg: '删除成功' }
  }
  // === 7. 重命名对局 (新增) ===
  if (action === 'rename_match') {
    const { newName } = event
    
    // 1. 检查对局是否存在
    const matchRes = await db.collection(MATCH_COLLECTION).where({ gameId: gameId }).get()
    if (matchRes.data.length === 0) return { code: -1, msg: '对局不存在' }
    
    // 2. 检查是否已经重命名过 (防止重复修改)
    if (matchRes.data[0].isRenamed) {
      return { code: -1, msg: '该对局名称已被修改过，无法再次修改' }
    }

    // 3. 更新名称并标记
    await db.collection(MATCH_COLLECTION).where({ gameId: gameId }).update({
      data: {
        name: newName,
        isRenamed: true // 标记已被修改
      }
    })
    return { code: 1, msg: '修改成功' }
  }
}
