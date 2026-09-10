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

/**
 * 数据访问控制：只有该 babyId 的成员（或创建者）才能读取。
 * 游客/非成员一律返回空统计（不暴露任何宝宝信息）。
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId = 'default', date } = event

  // 服务端访问控制：非成员/游客不返回任何云端统计
  if (!(await isPermitted(OPENID, babyId))) {
    return {
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
  }

  // 计算当日时间范围（北京时间 0 点 = 前一天 UTC 16 点）
  // 注意：云函数运行在 UTC 时区，直接 new Date('YYYY-MM-DD') 会解析成 UTC 零点（=北京 8 点），
  // 导致北京 0~8 点之间的记录被排除、跨凌晨时段统计全部为 0。
  // 修正：先把 date 按「北京时间」显式拆成年月日，再 -8h 换算成 UTC 毫秒时间戳。
  let year, month, day
  const match = date ? String(date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) : null
  if (match) {
    year = parseInt(match[1], 10)
    month = parseInt(match[2], 10)
    day = parseInt(match[3], 10)
  } else {
    const now = new Date(Date.now() + 8 * 3600 * 1000) // 当前北京时间
    year = now.getUTCFullYear()
    month = now.getUTCMonth() + 1
    day = now.getUTCDate()
  }
  const startTs = Date.UTC(year, month - 1, day) - 8 * 3600 * 1000 // 北京 0:00
  const endTs = startTs + 24 * 3600 * 1000 - 1                      // 北京 23:59:59.999

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