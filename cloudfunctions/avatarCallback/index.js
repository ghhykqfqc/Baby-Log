// cloudfunctions/avatarCallback/index.js
// 头像异步审核回调（配合 avatarCheck 使用）
//
// 微信内容安全 mediaCheckAsync 是异步接口：官方会在审核完成后回调，
// 回调地址在「小程序后台 → 开发 → 开发设置 → 消息推送」配置（云开发的回调需在云开发控制台配置）。
//
// 本函数职责：
//  - 接收微信回调（含 traceId, result.suggest），把 avatar_reviews 集合的状态更新
//  - 前端通过 avatarCheck(query) 轮询或这里回调后状态变化感知审核结果
//
// 说明：由于媒体审核回调签名校验与推送配置较为繁琐，
// 实际建议主要依赖「前端轮询 query」方案（简单可靠），
// 本回调函数作为可选的增强（若不想配回调可忽略部署）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function isCollectionMissing(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  return msg.includes('-502005') || msg.includes('DATABASE_COLLECTION_NOT_EXIST') || msg.includes('collection not exists')
}

async function ensureCollections(names) {
  if (typeof db.createCollection !== 'function') return
  for (const name of names) {
    try { await db.createCollection(name) } catch (e) {}
  }
}

exports.main = async (event, context) => {
  // 微信媒体审核回调数据结构（mediaCheckAsync 的回调）：
  // { ToUserName, FromUserName, CreateTime, MsgType: 'event',
  //   Event: 'wxa_media_check', traceId, version, result:{suggest} }
  const traceId = String((event && event.traceId) || '')
  const suggest = (event && event.result && event.result.suggest) || ''
  let status = 'pending'
  if (suggest === 'pass') status = 'pass'
  else if (suggest === 'block' || suggest === 'risky') status = 'fail'

  if (!traceId) {
    return { code: 0, msg: 'ignore' }
  }

  try {
    await db.collection('avatar_reviews').where({ traceId }).update({ data: {
      status,
      updatedAt: new Date()
    } })
  } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(['avatar_reviews'])
    }
    console.error('更新审核状态失败:', (err && err.errMsg) || err)
  }

  return { code: 0 }
}