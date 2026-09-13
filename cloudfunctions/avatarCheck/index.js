// cloudfunctions/avatarCheck/index.js
// 宝宝头像异步审核（兜底方案，配合官方 chooseAvatar 组件双保险）
//
// 场景：chooseAvatar 组件自带微信内容安全（未通过不触发回调），
//       但为应对「组件回调不够用 / 需要强制审核中态」情况，
//       本函数提供 mediaCheckAsync 异步审核：
//   1. 前端选图后先把图片上传到云存储（avatars/pending/xxx.jpg）
//   2. 前端调本函数传 fileID → 云函数调 mediaCheckAsync（version:2, mediaType:2, scene:1）
//   3. 返回 traceId，前端轮询本函数 status 或依赖官方回调（avatarCallback）
//   4. 审核 pass 后前端才把 baby.avatar 更新为 fileID
//
// 前端调用：
//   wx.cloud.callFunction({ name: 'avatarCheck', data: { type: 'submit', fileID: 'cloud://...' } })
//     → { code: 0, data: { traceId, status: 'pending' } }
//   wx.cloud.callFunction({ name: 'avatarCheck', data: { type: 'query', traceId: 'xxx' } })
//     → { code: 0, data: { traceId, status: 'pass'|'block'|'pending'|'unknown' } }
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// ====== 集合自愈 + 容错工具 ======
const _ensured = {}

function isCollectionMissing(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  return msg.includes('-502005') || msg.includes('DATABASE_COLLECTION_NOT_EXIST') || msg.includes('collection not exists')
}

async function ensureCollections(names) {
  if (typeof db.createCollection !== 'function') return
  for (const name of names) {
    if (_ensured[name]) continue
    try { await db.createCollection(name) } catch (e) {}
    _ensured[name] = true
  }
}

async function safeDb(fn, fallback, collectionNames) {
  try {
    return await fn()
  } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(collectionNames)
      try { return await fn() }
      catch (err2) {
        console.error('集合自愈重试后仍失败:', err2)
        return typeof fallback === 'function' ? fallback(err2) : fallback
      }
    }
    console.error('数据库操作失败:', err)
    return typeof fallback === 'function' ? fallback(err) : fallback
  }
}
// =====================================

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const type = (event && event.type) || 'submit'

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  // ===== 提交异步审核 =====
  if (type === 'submit') {
    const fileID = String((event && event.fileID) || '').trim()
    if (!fileID || fileID.indexOf('cloud://') !== 0) {
      return { code: -1, message: '头像文件无效' }
    }
    try {
      // mediaCheckAsync 参数：mediaType 2=图片, scene 1=资料 2=评论 3=论坛 4=社交日志
      const res = await cloud.openapi.security.mediaCheckAsync({
        mediaUrl: fileID,
        mediaType: 2,
        version: 2,
        scene: 1,               // 头像属于资料场景
        openid: OPENID
      })
      const traceId = (res && res.traceId) || ''
      // 记录审核状态到 avatar_reviews 集合（供 avatarCallback / 前端轮询）
      if (traceId) {
        await safeDb(async () => {
          await db.collection('avatar_reviews').add({
            data: {
              traceId,
              fileID,
              openid: OPENID,
              status: 'pending',     // pending | pass | fail
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
        }, null, ['avatar_reviews'])
      }
      return { code: 0, data: { traceId, status: 'pending' } }
    } catch (err) {
      console.error('mediaCheckAsync 提交失败:', (err && (err.errMsg || err.message)) || err)
      return { code: -1, message: '审核提交失败，请稍后重试' }
    }
  }

  // ========= 查询审核状态（前端轮询） =========
  if (type === 'query') {
    const traceId = String((event && event.traceId) || '').trim()
    if (!traceId) return { code: -1, message: '缺少 traceId' }
    let status = 'unknown'
    await safeDb(async () => {
      const res = await db.collection('avatar_reviews')
        .where({ traceId, openid: OPENID })
        .limit(1)
        .get()
      if (res.data && res.data.length > 0) {
        status = res.data[0].status || 'pending'
      }
    }, null, ['avatar_reviews'])
    return { code: 0, data: { traceId, status } }
  }

  return { code: -1, message: '未知操作类型' }
}