const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function uniqueGameIds(gameIds) {
  const ids = []
  const seen = {}
  ;(gameIds || []).forEach(item => {
    const id = String(item || '').trim()
    if (!id || seen[id]) return
    seen[id] = true
    ids.push(id)
  })
  return ids
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

exports.main = async (event, context) => {
  const inputIds = Array.isArray(event.gameIds) ? event.gameIds : []
  const gameIds = uniqueGameIds(inputIds)
  const startIndex = Math.max(0, toInt(event.startIndex, 0))
  const maxPerRun = Math.max(1, toInt(event.maxPerRun, 1))
  const enableRelay = event.enableRelay !== false
  const maxRuntimeMs = Math.max(600, toInt(event.maxRuntimeMs, 1200))
  const awaitEtl = event.awaitEtl === true

  if (gameIds.length === 0) {
    return {
      code: -1,
      msg: 'gameIds 不能为空',
      data: {
        total: 0,
        startIndex: startIndex,
        nextIndex: startIndex,
        done: true
      }
    }
  }

  const etlOptions = Object.assign({
    maxRuntimeMs: toInt(event.etlMaxRuntimeMs, 2200),
    maxHandsPerRun: Math.max(1, toInt(event.maxHandsPerRun, 12)),
    enableRelay: true
  }, event.etlOptions || {})

  const startTime = Date.now()
  let index = Math.min(startIndex, gameIds.length)
  const processed = []
  let timeUp = false

  while (index < gameIds.length && processed.length < maxPerRun) {
    if (Date.now() - startTime >= maxRuntimeMs) {
      timeUp = true
      break
    }

    const gameId = gameIds[index]
    const payload = Object.assign({}, etlOptions, { gameId: gameId })

    try {
      if (awaitEtl) {
        const res = await cloud.callFunction({
          name: 'match_hand_etl',
          data: payload
        })

        const result = res && res.result ? res.result : null
        processed.push({
          gameId: gameId,
          ok: !!(result && result.code === 1),
          code: result ? result.code : -1,
          msg: result ? (result.msg || '') : 'match_hand_etl 返回为空',
          data: result ? result.data : null
        })
      } else {
        cloud.callFunction({
          name: 'match_hand_etl',
          data: payload
        }).catch(err => {
          console.error('[match_hand_etl_batch] 子任务失败:', gameId, err.message)
        })

        processed.push({
          gameId: gameId,
          ok: true,
          code: 202,
          msg: '已派发',
          data: null
        })
      }
    } catch (e) {
      processed.push({
        gameId: gameId,
        ok: false,
        code: -1,
        msg: e && e.message ? e.message : '调用异常',
        data: null
      })
    }

    index += 1
  }

  const done = index >= gameIds.length
  if (!done && enableRelay) {
    cloud.callFunction({
      name: 'match_hand_etl_batch',
      data: {
        gameIds: gameIds,
        startIndex: index,
        maxPerRun: maxPerRun,
        maxRuntimeMs: maxRuntimeMs,
        awaitEtl: awaitEtl,
        etlMaxRuntimeMs: etlOptions.maxRuntimeMs,
        maxHandsPerRun: etlOptions.maxHandsPerRun,
        enableRelay: true
      }
    }).catch(err => {
      console.error('[match_hand_etl_batch] relay 调用失败:', err.message)
    })
  }

  const successCount = processed.filter(item => item.ok).length
  const failCount = processed.length - successCount

  return {
    code: 1,
    msg: done ? '批量 ETL 完成' : '批量 ETL 进行中，已触发接力',
    data: {
      total: gameIds.length,
      startIndex: startIndex,
      nextIndex: index,
      done: done,
      timeUp: timeUp,
      awaitEtl: awaitEtl,
      maxPerRun: maxPerRun,
      maxRuntimeMs: maxRuntimeMs,
      processedCount: processed.length,
      successCount: successCount,
      failCount: failCount,
      etlOptions: etlOptions,
      results: processed
    }
  }
}
