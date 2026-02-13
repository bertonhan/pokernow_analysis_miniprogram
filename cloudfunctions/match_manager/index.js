// cloudfunctions/match_manager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ADMIN_LIST = [
  'oVJBv3Z6GzqygarChiUpuMfpPUxw', 
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
    return await db.collection('matches')
      .where({ status: _.neq('已删除') })
      .orderBy('createTimeFull', 'desc')
      .get()
  }

  // === 3. 新建 ===
  if (action === 'create') {
    const parts = matchLink.split('/games/')
    if (parts.length < 2) return { code: -1, msg: '链接格式错误' }
    const targetGameId = parts[1].split('?')[0] 
    const exist = await db.collection('matches').where({ gameId: targetGameId, status: _.neq('已删除') }).get()
    if (exist.data.length > 0) return { code: 0, msg: '对局已存在' }
    const now = new Date()
    await db.collection('matches').add({
      data: {
        _openid: myOpenId, gameId: targetGameId, matchLink: matchLink,
        name: `格局 ${formatDate(now)}`, createTime: formatDate(now), createTimeFull: now,
        status: '记录中', currentHandNumber: 1
      }
    })
    cloud.callFunction({ name: 'match_crawler', data: { gameId: targetGameId, handNumber: 1 } })
    return { code: 1, msg: '创建成功' }
  }

  // === 4. 切换状态 ===
  if (action === 'toggle_status') {
    const match = await db.collection('matches').where({ gameId: gameId }).get()
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
    await db.collection('matches').where({ gameId: gameId }).update({ data: updatePayload })
    return { code: 1, newStatus: newStatus }
  }

  // === 5. 删除 ===
  if (action === 'delete') {
    if (!ADMIN_LIST.includes(myOpenId)) return { code: -1, msg: '无权操作' }
    await db.collection('matches').where({ gameId: gameId }).update({
      data: { status: '已删除', deleteTime: new Date(), deleteBy: myOpenId }
    })
    return { code: 1, msg: '删除成功' }
  }
  // === 6. 重命名对局 (新增) ===
  if (action === 'rename_match') {
    const { newName } = event
    
    // 1. 检查对局是否存在
    const matchRes = await db.collection('matches').where({ gameId: gameId }).get()
    if (matchRes.data.length === 0) return { code: -1, msg: '对局不存在' }
    
    // 2. 检查是否已经重命名过 (防止重复修改)
    if (matchRes.data[0].isRenamed) {
      return { code: -1, msg: '该对局名称已被修改过，无法再次修改' }
    }

    // 3. 更新名称并标记
    await db.collection('matches').where({ gameId: gameId }).update({
      data: {
        name: newName,
        isRenamed: true // 标记已被修改
      }
    })
    return { code: 1, msg: '修改成功' }
  }
}
