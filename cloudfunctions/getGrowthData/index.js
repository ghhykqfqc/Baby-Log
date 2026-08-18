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

exports.main = async (event, context) => {
  const { babyId = 'default' } = event

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