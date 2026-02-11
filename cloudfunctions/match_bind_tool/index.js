// cloudfunctions/match_bind_tool/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action, gameId, playerId, playerName, avatarUrl, userIds } = event
  const wxContext = cloud.getWXContext()
  const myOpenId = wxContext.OPENID

  // 1. 获取我的 OpenID
  if (action === 'getOpenId') {
    return { code: 1, openid: myOpenId }
  }

  // 2. 【新增】批量获取用户格局ID (管理员权限查询)
  if (action === 'getGejuIds') {
    try {
      if (!userIds || userIds.length === 0) return { code: 1, map: {} }
      
      // 查询 users 集合 (只取 gejuId 字段，减少流量)
      const usersRes = await db.collection('users')
        .where({
          _openid: _.in(userIds)
        })
        .field({
          _openid: true,
          gejuId: true
        })
        .get()
      
      // 组装成 map: { 'openid1': '韩二狗', 'openid2': '李铁柱' }
      let map = {}
      usersRes.data.forEach(u => {
        map[u._openid] = u.gejuId || '未设置ID'
      })
      
      return { code: 1, map }
    } catch (e) {
      return { code: -1, msg: e.message, map: {} }
    }
  }

  // 3. 绑定选手
  if (action === 'bind') {
    // 检查冲突
    const check = await db.collection('match_player_bindings').where({
      gameId: gameId,
      playerId: playerId
    }).get()

    if (check.data.length > 0) {
      if (check.data[0].userId === myOpenId) {
        return { code: 0, msg: '你已经绑定该选手了' }
      }
      return { code: -1, msg: '该选手已被其他用户绑定' }
    }

    // 执行绑定
    try {
      await db.collection('match_player_bindings').add({
        data: {
          gameId,
          playerId,
          playerName,
          userId: myOpenId,
          avatarUrl: avatarUrl || '',
          createTime: new Date()
        }
      })
      return { code: 1, msg: '绑定成功' }
    } catch (e) {
      return { code: -1, msg: '绑定失败: ' + e.message }
    }
  }

  // 4. 解绑选手
  if (action === 'unbind') {
    try {
      await db.collection('match_player_bindings').where({
        gameId: gameId,
        playerId: playerId,
        userId: myOpenId
      }).remove()
      return { code: 1, msg: '解绑成功' }
    } catch (e) {
      return { code: -1, msg: '解绑失败' }
    }
  }
}