// cloudfunctions/updateSchedule/index.js - 更新日程事项
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
  const { scheduleId, updates } = event

  if (!scheduleId || !updates || typeof updates !== 'object') {
    return { code: -1, message: '参数缺失：scheduleId/updates' }
  }

  // 白名单字段
  const allowed = ['title', 'category', 'date', 'startTime', 'endTime', 'location', 'note', 'important']
  const cleanUpdates = {}
  for (const k of allowed) {
    if (k in updates) cleanUpdates[k] = updates[k]
  }
  cleanUpdates.updatedAt = new Date()

  if (cleanUpdates.category) {
    const validCategories = ['vaccine', 'birthday', 'appointment', 'class', 'shopping', 'gift', 'redpacket', 'other']
    const isCustom = typeof cleanUpdates.category === 'string' && cleanUpdates.category.startsWith('custom_')
    if (!validCategories.includes(cleanUpdates.category) && !isCustom) {
      return { code: -1, message: '无效的 category' }
    }
  }

  // ========== 文本安检：编辑标题/备注同样过 msgSecCheck（scene=4 内容）==========
  // 与 addSchedule 保持一致的纵深防线；接口异常降级放行并记录日志
  if ('title' in cleanUpdates || 'note' in cleanUpdates) {
    const titleText = String(cleanUpdates.title !== undefined ? cleanUpdates.title : '').trim().slice(0, 60)
    const noteText = String(cleanUpdates.note !== undefined ? cleanUpdates.note : '').trim().slice(0, 200)
    const combined = [titleText, noteText].filter(Boolean).join(' ')
    if (combined) {
      try {
        const secRes = await cloud.openapi.security.msgSecCheck({
          version: 2,
          scene: 4,
          openid: OPENID,
          content: combined.slice(0, 500)
        })
        const suggest = ((secRes && secRes.result) || {}).suggest || 'pass'
        if (suggest !== 'pass') {
          return { code: -1, message: '换个说法吧～' }
        }
      } catch (err) {
        console.error('updateSchedule msgSecCheck 失败（降级放行）:', (err && (err.errMsg || err.message)) || err)
      }
    }
  }

  // 清理后的字段也做规范化，保持与 addSchedule 一致
  if ('title' in cleanUpdates) cleanUpdates.title = String(cleanUpdates.title).trim().slice(0, 60)
  if ('note' in cleanUpdates) cleanUpdates.note = String(cleanUpdates.note).trim().slice(0, 200)

  const FALLBACK = { code: -1, message: '云端暂不可用，更新失败' }

  return safeDb(async () => {
    const target = await db.collection('schedules').doc(scheduleId).get()
    if (!target.data) return { code: -1, message: '日程不存在' }
    const babyId = target.data.babyId
    const memberRes = await db.collection('baby_members').where({ babyId, openid: OPENID }).count()
    let isMember = memberRes.total > 0
    if (!isMember && babyId !== 'default') {
      const legacyRes = await db.collection('family_members').where({ babyId, openid: OPENID }).count()
      isMember = legacyRes.total > 0
    }
    if (!isMember && babyId !== 'default') return { code: -1, message: '无权限' }

    await db.collection('schedules').doc(scheduleId).update({ data: cleanUpdates })
    return { code: 0, data: { scheduleId, updates: cleanUpdates } }
  }, FALLBACK, ['schedules'])
}
