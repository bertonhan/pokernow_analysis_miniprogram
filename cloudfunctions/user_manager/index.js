// cloudfunctions/user_manager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // event 是前端传过来的数据
  // 我们主要处理 'update' 类型的请求
  if (event.action === 'update') {
    const { avatarUrl, nickName, gejuId } = event.userData

    try {
      // 1. 先查询这个用户是否存在
      const checkUser = await db.collection('users').where({
        _openid: openid
      }).get()

      if (checkUser.data.length > 0) {
        // 2. 如果存在，就更新 (update)
        await db.collection('users').where({
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
        await db.collection('users').add({
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
      const user = await db.collection('users').where({ _openid: openid }).get()
      return { data: user.data[0] || null }
  }

  return { msg: '无操作' }
}