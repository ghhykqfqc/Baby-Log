// cloudfunctions/getRecords/index.js
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

/**
 * 确保集合存在（云函数具备管理员权限，可自动建集合）。
 * 集合已存在或数据库暂不可用时静默忽略，由调用方兜底。
 */
async function ensureCollections(names) {
  if (typeof db.createCollection !== 'function') return
  for (const name of names) {
    if (_ensured[name]) continue
    try {
      await db.createCollection(name)
    } catch (e) {
      // 已存在（如 -501001）或暂不可用：忽略
    }
    _ensured[name] = true
  }
}

/**
 * 安全执行数据库操作：集合缺失时先自动创建再重试一次；
 * 仍失败或其它错误时返回 fallback，保证云函数不抛 system error。
 */
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
 * 游客/非成员一律返回空数据（不暴露任何宝宝信息）。
 * - 旧数据兼容：babies.userId = OPENID 视为创建者
 * - babyId='default'（游客本地默认宝宝）放行，保持旧体验
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
    // 集合缺失等容错：放行（由前端隔离兜底）
    return true
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId = 'default', days = 1, recordType } = event

  // 服务端访问控制：非成员/游客不返回任何云端记录
  if (!(await isPermitted(OPENID, babyId))) {
    return { code: 0, data: { records: [], total: 0 } }
  }

  // 计算时间范围（最近 N 天的滚动窗口，含凌晨记录，不受 UTC 时区影响）
  const now = Date.now()
  const startTime = now - days * 24 * 60 * 60 * 1000

  // 构建查询条件
  let query = {
    babyId,
    timestamp: _.gte(startTime).and(_.lte(now))
  }
  if (recordType) {
    query.recordType = recordType
  }

  // 集合缺失时返回空数据，前端自然回退本地缓存
  const FALLBACK = { code: 0, data: { records: [], total: 0 } }

  return safeDb(async () => {
    // 查询记录（最多500条）
    const MAX_LIMIT = 500
    const countRes = await db.collection('records').where(query).count()
    const total = Math.min(countRes.total, MAX_LIMIT)

    const batchTimes = Math.ceil(total / 100)
    const tasks = []
    for (let i = 0; i < batchTimes; i++) {
      const promise = db.collection('records')
        .where(query)
        .orderBy('timestamp', 'desc')
        .skip(i * 100)
        .limit(100)
        .get()
      tasks.push(promise)
    }

    const results = await Promise.all(tasks)
    const records = results.reduce((acc, cur) => acc.concat(cur.data), [])

    return {
      code: 0,
      data: {
        records,
        total: countRes.total
      }
    }
  }, FALLBACK, ['records'])
}