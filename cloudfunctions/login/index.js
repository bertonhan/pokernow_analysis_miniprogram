// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk')

// 初始化云能力
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 云函数入口函数
exports.main = async (event, context) => {
  // 获取执行云函数时的上下文信息（包含用户信息）
  const wxContext = cloud.getWXContext()

  return {
    openid: wxContext.OPENID,     // 用户的唯一身份ID
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    message: "登录成功，身份验证通过" // 我们自己加的提示
  }
}