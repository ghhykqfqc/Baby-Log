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
