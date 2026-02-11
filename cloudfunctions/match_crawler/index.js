// cloudfunctions/match_crawler/index.js
const cloud = require('wx-server-sdk')
const axios = require('axios')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// === 新增：辅助函数，获取选手账单数据 ===
async function fetchLedger(gameId) {
  try {
    // 加上时间戳参数防止缓存
    const url = `https://www.pokernow.com/games/${gameId}/players_sessions?_=${Date.now()}`
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 3000 // 3秒超时，防止卡住
    })
    return res.data // 返回账单对象
  } catch (err) {
    console.error(`[Ledger] 获取账单失败: ${err.message}`)
    return null // 失败返回 null，不要报错中断主流程
  }
}


exports.main = async (event, context) => {
  let { gameId, handNumber } = event
  
  const startTime = Date.now()
  const MAX_RUN_TIME = 50 * 1000 

  // === 计数器定义 ===
  let emptyRetryCount = 0      // 空数据计数器
  const MAX_EMPTY_RETRIES = 3  // 3次空数据停止
  
  let errorRetryCount = 0      // 接口报错计数器
  const MAX_ERROR_RETRIES = 3  // 3次报错停止
  
  console.log(`[启动] 爬虫开始: ${gameId} 从 Hand #${handNumber} 开始`)

  while (true) {
    // 1. 超时交接检查
    if (Date.now() - startTime > MAX_RUN_TIME) {
      console.log(`[交接] 超时预警，激活下一棒: Hand #${handNumber}`)
      await cloud.callFunction({
        name: 'match_crawler',
        data: { gameId: gameId, handNumber: handNumber }
      })
      return { status: 'relay' }
    }

    // 2. 状态检查
    const matchRes = await db.collection('matches').where({ gameId: gameId }).get()
    if (matchRes.data.length === 0 || matchRes.data[0].status === '已暂停') {
      console.log('[停止] 暂停信号')
      return { status: 'stopped' }
    }

    // 3. 爬取逻辑
    try {
      const url = `https://www.pokernow.com/api/games/${gameId}/log_v3?hand_number=${handNumber}`
      
      // 添加 User-Agent 头，防止被服务器当成机器人拦截
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      })
      // === 成功获取响应，重置报错计数器 ===
      errorRetryCount = 0
      // 【关键修正】直接读取 res.data，不要 .logs
      const logs = res.data

      if (!Array.isArray(logs) || logs.length === 0) {
        // === 逻辑修正：累计空数据次数 ===
        emptyRetryCount++
        console.log(`Hand #${handNumber} 暂无数据 (${emptyRetryCount}/${MAX_EMPTY_RETRIES})...`)

        if (emptyRetryCount >= MAX_EMPTY_RETRIES) {
          console.log('[停止] 连续多次无数据，自动暂停对局')
          
          // 1. 更新数据库状态为 "已暂停"
          await db.collection('matches').where({ gameId: gameId }).update({
            data: { status: '已暂停' }
          })
          
          // 2. 结束爬虫
          return { status: 'empty_stopped', msg: '无数据自动停止' }
        }

      } else {
        // === 有数据，重置计数器 ===
        emptyRetryCount = 0 
        console.log(`Hand #${handNumber} 获取到 ${logs.length} 条数据`)
        
        const docId = `${gameId}_${handNumber}`
        const hasEnded = logs.some(item => item.msg && item.msg.includes('-- ending hand'))

        // 写入数据库
        const checkHand = await db.collection('match_hands').doc(docId).get().catch(() => null)
        if (checkHand) {
          await db.collection('match_hands').doc(docId).update({ data: { raw_logs: logs, updateTime: new Date() } })
        } else {
          await db.collection('match_hands').add({
            data: { _id: docId, gameId, handNumber, raw_logs: logs, createTime: new Date() }
          })
        }

        // === 关键修改：如果手牌结束，顺便获取账单 ===
        if (hasEnded) {
          console.log(`Hand #${handNumber} 结束 -> 正在同步账单...`)
          
          // 1. 尝试获取最新账单 (并行执行，不等待太久)
          const ledgerData = await fetchLedger(gameId)
          
          // 2. 准备更新数据对象
          const updateData = {
            currentHandNumber: handNumber + 1 // 手牌数 + 1
          }

          // 3. 如果拿到了账单，一起更新进去
          if (ledgerData) {
            console.log('账单同步成功，写入数据库')
            updateData.ledger = ledgerData
            updateData.lastLedgerUpdate = new Date() // 记录一下最后更新账单的时间
          }

          // 4. 执行原子更新
          await db.collection('matches').where({ gameId: gameId }).update({
            data: updateData
          })
          
          // 这里的 handNumber 也要手动加，以便下一轮循环使用
          handNumber += 1 
        }
      }

    } catch (err) {
      // === 接口报错处理逻辑 (新增) ===
      errorRetryCount++
      console.error(`爬取接口异常 (${errorRetryCount}/${MAX_ERROR_RETRIES}):`, err.message)

      if (errorRetryCount >= MAX_ERROR_RETRIES) {
        console.log('[停止] 接口连续报错，暂停对局')
        
        // 1. 更新数据库状态为 "已暂停"
        await db.collection('matches').where({ gameId: gameId }).update({
          data: { status: '已暂停' } 
        })
        
        // 2. 结束云函数
        return { status: 'error_stopped', msg: err.message }
      }
    }

    // 随机等待 1 - 2 秒 (稍微调慢一点，避免空转太快)
    const waitTime = Math.floor(Math.random() * 1000) + 1000
    await sleep(waitTime)
  }
}