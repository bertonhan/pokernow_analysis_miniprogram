// cloudfunctions/match_analysis/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 工具：解析 ID 和 昵称
function parsePlayerInfo(rawString) {
  var clean = rawString.replace(/"/g, '').trim()
  var parts = clean.split('@')
  if (parts.length > 1) {
    return { name: parts[0].trim(), id: parts[1].trim() }
  }
  return { name: clean, id: clean }
}

// 工具：生成风格和运气标签
function generateStyles(stats, net) {
  var styles = []
  
  // 1. 计算率
  var vpip = stats.hands > 0 ? (stats.vpipHands / stats.hands) : 0
  var pfr = stats.hands > 0 ? (stats.pfrHands / stats.hands) : 0
  
  var afBase = (stats.calls || 0)
  var afTop = (stats.bets || 0) + (stats.raises || 0)
  var af = afBase > 0 ? (afTop / afBase) : (afTop > 0 ? 10 : 0)
  
  var wsd = stats.showdowns > 0 ? (stats.showdownWins / stats.showdowns) : 0
  var allInWinRate = (stats.allInCnt || 0) > 0 ? (stats.allInWins / stats.allInCnt) : 0

  // 2. 风格标签
  if (vpip > 0.35) styles.push('松')
  else if (vpip < 0.20) styles.push('紧')
  if (pfr > 0.20) styles.push('凶')
  else if (pfr < 0.10) styles.push('弱')
  if (af > 2.0) styles.push('激进')
  else if (af < 1.0) styles.push('跟注')

  // 3. 运气标签
  if (wsd >= 0.60 && stats.showdowns >= 3) styles.push('欧皇') 
  else if (wsd <= 0.30 && stats.showdowns >= 3) styles.push('非酋')
  
  if (allInWinRate >= 0.75 && stats.allInCnt >= 2) styles.push('跑马王')
  else if (allInWinRate <= 0.25 && stats.allInCnt >= 2) styles.push('慈善家')

  if (vpip > 0.40 && net > 5000) styles.push('天选')
  if (vpip < 0.30 && net < -5000) styles.push('倒霉')

  if (styles.length === 0) styles.push('平衡')
  
  return styles
}

// 工具：构建返回对象
function buildRecord(gameId, id, name, net, stats, styles, isUser = false, avatar = '', boundNames = []) {
  var vpip = stats.hands > 0 ? (stats.vpipHands / stats.hands) : 0
  var pfr = stats.hands > 0 ? (stats.pfrHands / stats.hands) : 0
  var limp = stats.hands > 0 ? (stats.limpHands / stats.hands) : 0
  var wtsd = stats.sawFlopHands > 0 ? (stats.showdowns / stats.sawFlopHands) : 0
  var wsd = stats.showdowns > 0 ? (stats.showdownWins / stats.showdowns) : 0
  
  var afBase = (stats.calls || 0)
  var afTop = (stats.bets || 0) + (stats.raises || 0)
  var af = afBase > 0 ? (afTop / afBase) : (afTop > 0 ? 10 : 0)
  
  var cbet = (stats.cbetOpp || 0) > 0 ? (stats.cbetCount / stats.cbetOpp) : 0
  var bet3 = (stats.bet3Opp || 0) > 0 ? (stats.bet3Count / stats.bet3Opp) : 0
  var allInWinRate = (stats.allInCnt || 0) > 0 ? (stats.allInWins / stats.allInCnt) : 0

  return {
    gameId: gameId,
    playerId: id, 
    userId: isUser ? id : '',
    playerName: name,
    isUser: isUser, 
    avatarUrl: avatar,
    boundNames: boundNames, 
    net: net,
    hands: stats.hands,
    vpip: Number((vpip * 100).toFixed(1)),
    pfr: Number((pfr * 100).toFixed(1)),
    limp: Number((limp * 100).toFixed(1)),
    bet3: Number((bet3 * 100).toFixed(1)), 
    allIn: Number((allInWinRate * 100).toFixed(1)),
    af: Number(af.toFixed(2)),
    wtsd: Number((wtsd * 100).toFixed(1)),
    wsd: Number((wsd * 100).toFixed(1)),
    cbet: Number((cbet * 100).toFixed(1)),
    style: styles.join('/'),
    updateTime: new Date()
  }
}

exports.main = async (event, context) => {
  var gameId = event.gameId
  console.log('开始聚合分析对局:', gameId)

  try {
    // === 1. 数据准备 ===
    var matchRes = await db.collection('matches').where({ gameId: gameId }).get()
    if (matchRes.data.length === 0) return { code: -1, msg: '对局不存在' }
    
    var matchData = matchRes.data[0]
    var playersInfos = (matchData.ledger && matchData.ledger.playersInfos) || {}
    
    // 【核心修复】判断对局状态
    var isEnded = (matchData.status === '已结束')

    var bindRes = await db.collection('match_player_bindings').where({ gameId: gameId }).get()
    var bindings = bindRes.data || []
    
    // 【核心修复】如果对局未结束，强制清空绑定关系
    // 这样后续逻辑就会认为所有人都是“未绑定”的，直接使用原始昵称，不进行用户聚合
    if (!isEnded) {
      console.log('对局未结束，强制隐藏用户身份，忽略绑定关系')
      bindings = [] 
    }
    
    var bindMap = {}
    var relatedUserIds = []
    bindings.forEach(b => {
      bindMap[b.playerId] = { userId: b.userId, avatarUrl: b.avatarUrl }
      if(relatedUserIds.indexOf(b.userId) === -1) relatedUserIds.push(b.userId)
    })

    var userMap = {} 
    if (relatedUserIds.length > 0) {
      // 获取用户信息
      var userRes = await db.collection('users')
        .where({ _openid: _.in(relatedUserIds) })
        .field({ _openid:true, gejuId:true, avatarUrl:true })
        .get()
      
      userRes.data.forEach(u => { 
        userMap[u._openid] = {
          gejuId: u.gejuId || '未知用户',
          avatarUrl: u.avatarUrl || '' 
        }
      })
    }

    var ledgerMap = {}
    Object.keys(playersInfos).forEach(function(key) {
      var p = playersInfos[key]
      ledgerMap[p.id] = { name: (p.names && p.names[0]) || 'Unknown', net: p.net || 0 }
    })

    // === 2. 获取手牌日志 ===
    var MAX_LIMIT = 100
    var allHands = []
    var countResult = await db.collection('match_hands').where({ gameId: gameId }).count()
    var total = countResult.total
    
    for (var i = 0; i < total; i += MAX_LIMIT) {
      var batch = await db.collection('match_hands').where({ gameId: gameId }).orderBy('handNumber', 'asc').skip(i).limit(MAX_LIMIT).get()
      allHands = allHands.concat(batch.data)
    }

    // === 3. 基础统计 (这部分逻辑保持不变) ===
    var statsMap = {} 
    var getPData = function(pid, pname) {
      if (!statsMap[pid]) {
        statsMap[pid] = {
          id: pid, name: pname, hands: 0, 
          vpipHands: 0, pfrHands: 0, limpHands: 0, sawFlopHands: 0, 
          bets: 0, raises: 0, calls: 0, checks: 0, folds: 0, 
          showdowns: 0, showdownWins: 0,
          cbetOpp: 0, cbetCount: 0, bet3Opp: 0, bet3Count: 0, allInCnt: 0, allInWins: 0
        }
      }
      return statsMap[pid]
    }

    for (var k = 0; k < allHands.length; k++) {
      var handDoc = allHands[k]
      var logs = handDoc.raw_logs || []
      logs.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))

      var handPlayers = {}, foldedPlayers = {}, collectedPlayers = {}, allInPlayers = {}
      var vpipPlayers = {}, pfrPlayers = {}, limpPlayers = {}, sawFlopPlayers = {}
      var street = 'PREFLOP', preflopRaises = 0, lastAggressor = null, bet3OppPlayers = {}

      for (var j = 0; j < logs.length; j++) {
        var log = logs[j], msg = log.msg || ''
        var match = msg.match(/"(.*?)"/)
        if (match) {
          var info = parsePlayerInfo(match[1])
          var pid = info.id
          if (pid !== 'admin' && pid !== 'game' && msg.indexOf('The admin') === -1) {
             if (msg.match(/posts|calls|bets|raises|checks|folds/)) handPlayers[pid] = info.name
          }
        }
      }
      Object.keys(handPlayers).forEach(key => getPData(key, handPlayers[key]).hands += 1)

      for (var j = 0; j < logs.length; j++) {
        var log = logs[j], msg = log.msg || ''
        if (msg.startsWith('Flop:')) street = 'FLOP'
        if (msg.startsWith('Turn:')) street = 'TURN'
        if (msg.startsWith('River:')) street = 'RIVER'

        if (msg.match(/all-in|all in/)) {
           var aiMatch = msg.match(/"(.*?)"/)
           if (aiMatch) allInPlayers[parsePlayerInfo(aiMatch[1]).id] = true
        }

        var actionMatch = msg.match(/"(.*?)" (calls|bets|raises|checks|folds|shows|collected)/)
        if (actionMatch) {
          var info = parsePlayerInfo(actionMatch[1])
          var pid = info.id, action = actionMatch[2]
          var pData = getPData(pid, info.name)

          if (street !== 'PREFLOP') sawFlopPlayers[pid] = true
          if (street === 'FLOP' && action === 'bets' && lastAggressor === pid) pData.cbetCount += 1
          if (street === 'PREFLOP' && preflopRaises === 1 && lastAggressor !== pid) bet3OppPlayers[pid] = true

          if (action === 'calls') {
            pData.calls += 1
            if (street === 'PREFLOP') { vpipPlayers[pid] = true; if (preflopRaises === 0) limpPlayers[pid] = true }
          } else if (action === 'bets') {
            pData.bets += 1
            if (street === 'PREFLOP') { vpipPlayers[pid] = true; pfrPlayers[pid] = true; preflopRaises += 1; lastAggressor = pid }
          } else if (action === 'raises') {
            pData.raises += 1
            if (street === 'PREFLOP') { vpipPlayers[pid] = true; pfrPlayers[pid] = true; if(preflopRaises >=1) pData.bet3Count+=1; preflopRaises += 1; lastAggressor = pid }
          } else if (action === 'checks') pData.checks += 1
          else if (action === 'folds') { pData.folds += 1; foldedPlayers[pid] = true }
          else if (action === 'shows') sawFlopPlayers[pid] = true
          else if (action === 'collected') collectedPlayers[pid] = true
        }
      }

      var survivors = Object.keys(handPlayers).filter(pid => !foldedPlayers[pid])
      if (survivors.length >= 2) {
        survivors.forEach(sPid => {
          getPData(sPid, '').showdowns += 1
          sawFlopPlayers[sPid] = true; getPData(sPid, '').sawFlopHands += 1
          if (collectedPlayers[sPid]) getPData(sPid, '').showdownWins += 1
        })
      }
      Object.keys(allInPlayers).forEach(aiPid => {
        getPData(aiPid, '').allInCnt += 1
        if (collectedPlayers[aiPid]) getPData(aiPid, '').allInWins += 1
      })

      var hasFlop = logs.some(l => l.msg.startsWith('Flop:'))
      if (hasFlop && lastAggressor) getPData(lastAggressor, '').cbetOpp += 1
      Object.keys(bet3OppPlayers).forEach(pid => getPData(pid, '').bet3Opp += 1)
      Object.keys(vpipPlayers).forEach(pid => getPData(pid, '').vpipHands += 1)
      Object.keys(pfrPlayers).forEach(pid => getPData(pid, '').pfrHands += 1)
      Object.keys(limpPlayers).forEach(pid => getPData(pid, '').limpHands += 1)
      Object.keys(sawFlopPlayers).forEach(pid => getPData(pid, '').sawFlopHands += 1)
    }

    // === 4. 聚合逻辑 ===
    var finalResults = []
    var userStatsMap = {} 
    
    var allPlayerIds = Object.keys(ledgerMap)
    Object.keys(statsMap).forEach(key => { if(allPlayerIds.indexOf(key) === -1) allPlayerIds.push(key) })

    allPlayerIds.forEach(pid => {
      var stats = statsMap[pid] || { hands: 0 }
      var ledger = ledgerMap[pid] || { name: stats.name || 'Unknown', net: 0 }
      if (stats.hands === 0 && ledger.net === 0) return

      var binding = bindMap[pid]
      
      if (binding) {
        // === 已绑定：聚合到 User ===
        // 【注意】如果上方强制置空了 bindings，这里永远进不来，数据绝对安全
        var uid = binding.userId
        var userInfo = userMap[uid] || {}
        var finalAvatar = userInfo.avatarUrl || binding.avatarUrl || ''
        var finalGejuId = userInfo.gejuId || '未知用户'

        if (!userStatsMap[uid]) {
          userStatsMap[uid] = {
            userId: uid,
            gejuId: finalGejuId,
            avatarUrl: finalAvatar,
            net: 0,
            hands: 0, vpipHands: 0, pfrHands: 0, limpHands: 0, sawFlopHands: 0,
            bets: 0, raises: 0, calls: 0, checks: 0, folds: 0,
            showdowns: 0, showdownWins: 0,
            cbetOpp: 0, cbetCount: 0, bet3Opp: 0, bet3Count: 0,
            allInCnt: 0, allInWins: 0,
            relatedNames: [] 
          }
        }
        
        var uStats = userStatsMap[uid]
        if (uStats.relatedNames.indexOf(ledger.name) === -1) {
          uStats.relatedNames.push(ledger.name)
        }

        uStats.net += ledger.net
        uStats.hands += (stats.hands || 0)
        uStats.vpipHands += (stats.vpipHands || 0)
        uStats.pfrHands += (stats.pfrHands || 0)
        uStats.limpHands += (stats.limpHands || 0)
        uStats.sawFlopHands += (stats.sawFlopHands || 0)
        uStats.bets += (stats.bets || 0)
        uStats.raises += (stats.raises || 0)
        uStats.calls += (stats.calls || 0)
        uStats.showdowns += (stats.showdowns || 0)
        uStats.showdownWins += (stats.showdownWins || 0)
        uStats.cbetOpp += (stats.cbetOpp || 0)
        uStats.cbetCount += (stats.cbetCount || 0)
        uStats.bet3Opp += (stats.bet3Opp || 0)
        uStats.bet3Count += (stats.bet3Count || 0)
        uStats.allInCnt += (stats.allInCnt || 0)
        uStats.allInWins += (stats.allInWins || 0)

      } else {
        // === 未绑定（或强制隐私模式） ===
        var styles = generateStyles(stats, ledger.net)
        // 直接使用 ledger.name (原始昵称)
        var record = buildRecord(gameId, pid, ledger.name, ledger.net, stats, styles, false, '', [])
        
        // 只有已结束才写入数据库持久化，避免进行中产生垃圾数据
        if (isEnded) {
            try { db.collection('match_player_stats').doc(gameId + '_' + pid).set({ data: record }) } catch(e) {}
        }
        finalResults.push(record)
      }
    })

    // === 5. 批量换取链接 (仅处理 User 聚合数据) ===
    var userList = Object.values(userStatsMap)
    var fileList = []
    userList.forEach(u => {
      if (u.avatarUrl && u.avatarUrl.indexOf('cloud://') === 0) {
        fileList.push(u.avatarUrl)
      }
    })

    var tempUrlMap = {}
    if (fileList.length > 0) {
      try {
        const result = await cloud.getTempFileURL({ fileList: fileList })
        if (result.fileList) {
          result.fileList.forEach(item => { if (item.tempFileURL) tempUrlMap[item.fileID] = item.tempFileURL })
        }
      } catch (e) {}
    }

    userList.forEach(uData => {
      var styles = generateStyles(uData, uData.net)
      var safeAvatar = uData.avatarUrl
      if (tempUrlMap[safeAvatar]) safeAvatar = tempUrlMap[safeAvatar]
      
      // 聚合数据才显示 gejuId
      var record = buildRecord(gameId, uData.userId, uData.gejuId, uData.net, uData, styles, true, safeAvatar, uData.relatedNames)
      finalResults.push(record)
    })

    return { code: 1, msg: '分析完成', data: finalResults }

  } catch (e) {
    console.error('全局错误:', e)
    return { code: -1, msg: '分析失败: ' + e.message }
  }
}