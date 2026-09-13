// cloudfunctions/addSchedule/index.js - 新增日程事项
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
    try {
      await db.createCollection(name)
    } catch (e) {}
    _ensured[name] = true
  }
}

async function safeDb(fn, fallback, collectionNames) {
  try {
    return await fn()
  } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(collectionNames)
      try {
        return await fn()
      } catch (err2) {
        console.error('集合自愈重试后仍失败:', err2)
        return typeof fallback === 'function' ? fallback(err2) : fallback
      }
    }
    console.error('数据库操作失败:', err)
    return typeof fallback === 'function' ? fallback(err) : fallback
  }
}
// =================================

/**
 * event 参数：
 *  - babyId: string       宝宝ID（必填）
 *  - title: string        事项标题（必填）
 *  - category: string     事项类型枚举：vaccine/birthday/appointment/class/shopping/gift/redpacket/other
 *  - date: string         日期 YYYY-MM-DD（必填）
 *  - startTime: string    开始时间 HH:mm（可选，全天事项为空）
 *  - endTime: string      结束时间 HH:mm（可选）
 *  - location: string     地点（可选）
 *  - note: string         备注（可选）
 *  - important: boolean   是否重要（影响日历标记颜色）
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    babyId,
    title,
    category = 'other',
    date,
    startTime = '',
    endTime = '',
    location = '',
    note = '',
    important = false
  } = event

  if (!babyId || !title || !date) {
    return { code: -1, message: '参数缺失：babyId/title/date 必填' }
  }

  const validCategories = ['vaccine', 'birthday', 'appointment', 'class', 'shopping', 'gift', 'redpacket', 'other']
  // 自定义类别：允许 custom_ 前缀（前端本地维护类别元数据），其余非法值回退 other
  const isCustom = typeof category === 'string' && category.startsWith('custom_')
  const finalCategory = validCategories.includes(category) || isCustom ? category : 'other'

  // ========== 文本安检：标题/备注必须过 msgSecCheck（scene=4 内容）==========
  // title/note 为用户输入的自由文本，防脏词/广告/违规内容。接口异常降级放行并记录日志。
  const titleText = String(title).trim().slice(0, 60)
  const noteText = String(note || '').trim().slice(0, 200)
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
      console.error('addSchedule msgSecCheck 失败（降级放行）:', (err && (err.errMsg || err.message)) || err)
    }
  }

  const schedule = {
    babyId,
    title: titleText,
    category: finalCategory,
    date,
    startTime,
    endTime,
    location: String(location || ''),
    note: noteText,
    important: !!important,
    userId: OPENID,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，日程已保存到本地待同步' }

  return safeDb(async () => {
    // 权限校验：当前用户必须是该宝宝的成员
    const memberRes = await db.collection('baby_members').where({
      babyId,
      openid: OPENID
    }).count()

    let isMember = memberRes.total > 0
    // 兼容历史 family_members
    if (!isMember && babyId !== 'default') {
      const legacyRes = await db.collection('family_members').where({
        babyId,
        openid: OPENID
      }).count()
      isMember = legacyRes.total > 0
    }
    if (!isMember && babyId !== 'default') {
      return { code: -1, message: '无权限：不是该宝宝的成员' }
    }

    const addRes = await db.collection('schedules').add({ data: schedule })
    return {
      code: 0,
      data: { _id: addRes._id, ...schedule }
    }
  }, FALLBACK, ['schedules'])
}
