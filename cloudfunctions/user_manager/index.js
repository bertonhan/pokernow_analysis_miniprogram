// cloudfunctions/user_manager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const USER_COLLECTION = 'users'
const PAGE_SIZE = 100

async function loadAllUsers() {
  const countRes = await db.collection(USER_COLLECTION).count()
  const total = Number((countRes && countRes.total) || 0)
  const users = []

  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const batch = await db.collection(USER_COLLECTION)
      .field({
        _openid: true,
        gejuId: true,
        nickName: true,
        avatarUrl: true,
        createTime: true,
        updateTime: true
      })
      .skip(offset)
      .limit(PAGE_SIZE)
      .get()
    users.push(...(batch.data || []))
  }

  return users
}

function normalizeGejuId(raw) {
  return String(raw || '').trim()
}

function buildManualPlayers(users, limit) {
  const map = {}
  users.forEach(user => {
    const gejuId = normalizeGejuId(user && user.gejuId)
    if (!gejuId) return
    if (!map[gejuId]) {
      map[gejuId] = {
        gejuId: gejuId,
        _openid: user._openid || '',
        nickName: user.nickName || '',
        avatarUrl: user.avatarUrl || ''
      }
    }
  })

  const list = Object.keys(map)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(key => map[key])

  const n = Number(limit)
  if (n > 0) return list.slice(0, n)
  return list
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // event 是前端传过来的数据
  // 我们主要处理 'update' 类型的请求
  if (event.action === 'update') {
    const { avatarUrl, nickName, gejuId } = event.userData

    try {
      // 1. 先查询这个用户是否存在
      const checkUser = await db.collection(USER_COLLECTION).where({
        _openid: openid
      }).get()

      if (checkUser.data.length > 0) {
        // 2. 如果存在，就更新 (update)
        await db.collection(USER_COLLECTION).where({
          _openid: openid
        }).update({
          data: {
            avatarUrl: avatarUrl,
            nickName: nickName,
            gejuId: gejuId,
            updateTime: new Date()
          }
        })
        return { status: 'updated', msg: '用户信息更新成功' }
      } else {
        // 3. 如果不存在，就新增 (add)
        await db.collection(USER_COLLECTION).add({
          data: {
            _openid: openid, // 这一行其实系统会自动加，显式写出来更清晰
            avatarUrl: avatarUrl,
            nickName: nickName,
            gejuId: gejuId,
            createTime: new Date()
          }
        })
        return { status: 'created', msg: '新用户注册成功' }
      }
    } catch (e) {
      console.error(e)
      return { status: 'error', msg: e }
    }
  }
  
  // 如果是获取用户信息
  if (event.action === 'get') {
      const user = await db.collection(USER_COLLECTION).where({ _openid: openid }).get()
      return { data: user.data[0] || null }
  }

  if (event.action === 'list_manual_players') {
    try {
      const users = await loadAllUsers()
      const list = buildManualPlayers(users, event.limit)
      return {
        status: 'ok',
        total: list.length,
        data: list
      }
    } catch (e) {
      console.error('[user_manager] list_manual_players failed:', e)
      return {
        status: 'error',
        msg: e.message || '加载用户失败',
        total: 0,
        data: []
      }
    }
  }

  return { msg: '无操作' }
}
