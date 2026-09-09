// cloudfunctions/getSchedules/index.js - 查询日程事项（按月份范围）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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
  try {
    return await fn()
  } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(collectionNames)
      try { return await fn() } catch (err2) {
        return typeof fallback === 'function' ? fallback(err2) : fallback
      }
    }
    return typeof fallback === 'function' ? fallback(err) : fallback
  }
}
// =========================

/**
 * 数据访问控制：只有该 babyId 的成员（或创建者）才能读取日程。
 * 游客/非成员一律返回空数据（不暴露任何宝宝的日程安排）。
 */
async function isPermitted(OPENID, babyId) {
  if (!OPENID || !babyId) return false
  if (babyId === 'default') return true
  try {
    const member = await db.collection('baby_members').where({ babyId, openid: OPENID }).count()
    if (member.total > 0) return true
    const owner = await db.collection('babies').where({ babyId }).get()
    if (owner.data && owner.data[0]) {
      const b = owner.data[0]
      return b.userId === OPENID || b.createdBy === OPENID
    }
    return false
  } catch (err) {
    return true
  }
}

/**
 * event:
 *  - babyId: string
 *  - startDate: string YYYY-MM-DD 月份查询起始
 *  - endDate: string YYYY-MM-DD    月份查询结束
 *
 * 返回该日期范围内的所有日程（按 date 升序、startTime 升序）
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId = 'default', startDate, endDate } = event

  if (!startDate || !endDate) {
    return { code: -1, message: '参数缺失：startDate/endDate 必填' }
  }

  // 服务端访问控制：非成员/游客不返回任何日程
  if (!(await isPermitted(OPENID, babyId))) {
    return { code: 0, data: { schedules: [] } }
  }

  const FALLBACK = { code: 0, data: { schedules: [] } }

  return safeDb(async () => {
    const query = {
      babyId,
      date: _.gte(startDate).and(_.lte(endDate))
    }

    const countRes = await db.collection('schedules').where(query).count()
    const total = Math.min(countRes.total, 200)

    const batchTimes = Math.ceil(total / 100)
    const tasks = []
    for (let i = 0; i < batchTimes; i++) {
      const promise = db.collection('schedules')
        .where(query)
        .orderBy('date', 'asc')
        .orderBy('startTime', 'asc')
        .skip(i * 100)
        .limit(100)
        .get()
      tasks.push(promise)
    }

    const results = await Promise.all(tasks)
    const schedules = results.reduce((acc, cur) => acc.concat(cur.data), [])

    return {
      code: 0,
      data: { schedules, total: countRes.total }
    }
  }, FALLBACK, ['schedules'])
}
