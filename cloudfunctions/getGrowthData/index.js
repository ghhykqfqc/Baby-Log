// cloudfunctions/getGrowthData/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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
 * 游客/非成员一律返回空数据（不暴露任何宝宝信息）。
 * - old 兼容：babies.userId = OPENID 视为创建者
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
    return true
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId = 'default' } = event

  // 服务端访问控制：非成员/游客不返回任何云端成长数据
  if (!(await isPermitted(OPENID, babyId))) {
    return { code: 0, data: { records: [] } }
  }

  // 集合缺失时返回空数据，前端回退本地缓存
  const FALLBACK = { code: 0, data: { records: [] } }

  return safeDb(async () => {
    const res = await db.collection('growth_data')
      .where({ babyId })
      .orderBy('measureDate', 'asc')
      .limit(100)
      .get()

    return {
      code: 0,
      data: {
        records: res.data
      }
    }
  }, FALLBACK, ['growth_data'])
}