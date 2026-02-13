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

exports.main = async (event, context) => {
  const inputIds = Array.isArray(event.gameIds) ? event.gameIds : []
  const gameIds = uniqueGameIds(inputIds)
  const startIndex = Math.max(0, parseInt(event.startIndex, 10) || 0)
  const maxPerRun = Math.max(1, parseInt(event.maxPerRun, 10) || 1)
  const enableRelay = event.enableRelay !== false
  const maxRuntimeMs = Math.max(600, parseInt(event.maxRuntimeMs, 10) || 1200)
  const awaitAnalysis = event.awaitAnalysis === true

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
    try {
      if (awaitAnalysis) {
        const res = await cloud.callFunction({
          name: 'match_analysis',
          data: { gameId: gameId }
        })

        const result = res && res.result ? res.result : null
        processed.push({
          gameId: gameId,
          ok: !!(result && result.code === 1),
          code: result ? result.code : -1,
          msg: result ? (result.msg || '') : 'match_analysis 返回为空',
          persisted: result && result.meta && result.meta.persisted ? result.meta.persisted : null
        })
      } else {
        cloud.callFunction({
          name: 'match_analysis',
          data: { gameId: gameId }
        }).catch(err => {
          console.error('[match_analysis_batch] 子任务失败:', gameId, err.message)
        })

        processed.push({
          gameId: gameId,
          ok: true,
          code: 202,
          msg: '已派发',
          persisted: null
        })
      }
    } catch (e) {
      processed.push({
        gameId: gameId,
        ok: false,
        code: -1,
        msg: e && e.message ? e.message : '调用异常',
        persisted: null
      })
    }
    index += 1
  }

  const done = index >= gameIds.length
  if (!done && enableRelay) {
    cloud.callFunction({
      name: 'match_analysis_batch',
      data: {
        gameIds: gameIds,
        startIndex: index,
        maxPerRun: maxPerRun,
        maxRuntimeMs: maxRuntimeMs,
        enableRelay: true
      }
    }).catch(err => {
      console.error('[match_analysis_batch] relay 调用失败:', err.message)
    })
  }

  const successCount = processed.filter(item => item.ok).length
  const failCount = processed.length - successCount

  return {
    code: 1,
    msg: done ? '批量分析完成' : '批量分析进行中，已触发接力',
    data: {
      total: gameIds.length,
      startIndex: startIndex,
      nextIndex: index,
      done: done,
      timeUp: timeUp,
      awaitAnalysis: awaitAnalysis,
      maxPerRun: maxPerRun,
      maxRuntimeMs: maxRuntimeMs,
      processedCount: processed.length,
      successCount: successCount,
      failCount: failCount,
      results: processed
    }
  }
}
