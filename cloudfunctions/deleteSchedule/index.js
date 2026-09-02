// cloudfunctions/deleteSchedule/index.js - 删除日程事项
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// ====== 集合自愈工具 ======
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
  try { return await fn() } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(collectionNames)
      try { return await fn() } catch (e) {
        return typeof fallback === 'function' ? fallback(e) : fallback
      }
    }
    return typeof fallback === 'function' ? fallback(err) : fallback
  }
}
// =========================

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { scheduleId } = event

  if (!scheduleId) {
    return { code: -1, message: '参数缺失：scheduleId' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请在网络恢复后重试' }

  return safeDb(async () => {
    // 先查日程，校验所属宝宝权限
    const target = await db.collection('schedules').doc(scheduleId).get()
    if (!target.data) {
      return { code: -1, message: '日程不存在或已被删除' }
    }
    const babyId = target.data.babyId
    const memberRes = await db.collection('baby_members').where({ babyId, openid: OPENID }).count()
    let isMember = memberRes.total > 0
    if (!isMember && babyId !== 'default') {
      const legacyRes = await db.collection('family_members').where({ babyId, openid: OPENID }).count()
      isMember = legacyRes.total > 0
    }
    if (!isMember && babyId !== 'default') {
      return { code: -1, message: '无权限' }
    }
    await db.collection('schedules').doc(scheduleId).remove()
    return { code: 0, data: { scheduleId } }
  }, FALLBACK, ['schedules'])
}
