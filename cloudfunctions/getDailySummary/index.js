// cloudfunctions/getDailySummary/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// ====== 集合自愈 + 容错工具：集合不存在时自动创建，避免 -502005 报错 ======
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
    } catch (e) {
      // 已存在或暂不可用：忽略
    }
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
// ==================================================

exports.main = async (event, context) => {
  const { babyId = 'default', date } = event

  // 计算当日时间范围
  const targetDate = date ? new Date(date) : new Date()
  const dayStart = new Date(targetDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(targetDate)
  dayEnd.setHours(23, 59, 59, 999)

  const startTs = dayStart.getTime()
  const endTs = dayEnd.getTime()

  // 集合缺失时返回空统计，前端回退本地缓存
  const FALLBACK = {
    code: 0,
    data: {
      date,
      feedCount: 0,
      diaperCount: 0,
      sleepDuration: 0,
      sleepCount: 0,
      firstFeedTime: null,
      lastFeedTime: null,
      records: []
    }
  }

  return safeDb(async () => {
    // 查询当日所有记录
    const res = await db.collection('records').where({
      babyId,
      timestamp: _.gte(startTs).and(_.lte(endTs))
    }).orderBy('timestamp', 'asc').get()

    const records = res.data

    // 统计
    const feedRecords = records.filter(r => r.recordType === 'feed')
    const diaperRecords = records.filter(r => r.recordType === 'diaper')
    const sleepRecords = records.filter(r => r.recordType === 'sleep')

    const sleepDuration = sleepRecords.reduce((sum, r) => sum + (r.duration || 0), 0)

    return {
      code: 0,
      data: {
        date,
        feedCount: feedRecords.length,
        diaperCount: diaperRecords.length,
        sleepDuration,
        sleepCount: sleepRecords.length,
        firstFeedTime: feedRecords[0]?.timestamp || null,
        lastFeedTime: feedRecords[feedRecords.length - 1]?.timestamp || null,
        records
      }
    }
  }, FALLBACK, ['records'])
}