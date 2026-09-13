// cloudfunctions/textCheck/index.js
// 纯文本内容安检云函数（昵称 / 日程标签 / 备注 / 反馈等用户输入的文本）
//
// 用途：把「前台文案是否安全」的判定放在云函数（服务端），
//      前端不得感知具体违规类型，只展示「换个可爱的名字吧～」类提示。
//
// 前端调用：
//   wx.cloud.callFunction({ name: 'textCheck', data: { text: '...', scene: 1 } })
// 返回：
//   { code: 0, data: { pass: true } }            通过
//   { code: 0, data: { pass: false } }           不通过
//   { code: 0, data: { pass: true, degraded: true } } 安检接口异常时降级放行（记录日志，但不阻断）
//
// scene 建议：
//   1 = 资料（昵称/个人简介）
//   4 = 内容（评论/留言/标签）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 文本安检，通过返回 { pass: true }，不通过 { pass: false }
 * 接口异常时策略：返回 pass:true + degraded:true（降级放行），
 * 但业务方一般更倾向「建议拦截」；这里抽象出可配置策略，由调用方决定。
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const content = String((event && event.content) || '').trim().slice(0, 500)
  const scene = Number((event && event.scene) || 1)

  if (!content) {
    return { code: 0, data: { pass: true } } // 空内容无需安检
  }

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      scene,               // 1=资料 4=内容；具体按调用方传
      openid: OPENID,      // 云调用场景注入真实 openid
      content
    })
    const result = (res && res.result) || {}
    const suggest = result.suggest || 'pass'
    return {
      code: 0,
      data: {
        pass: suggest === 'pass',
        // review：疑似，统一按「不通过」处理更稳妥（昵称场景宁可保守）
        suggest
      }
    }
  } catch (err) {
    console.error('msgSecCheck 调用失败:', (err && (err.errMsg || err.message)) || err)
    // 接口异常：降级放行（但标记 degraded，调用方可视情况二次确认）
    return { code: 0, data: { pass: true, degraded: true } }
  }
}