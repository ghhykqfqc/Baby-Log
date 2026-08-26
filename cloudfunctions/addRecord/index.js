// cloudfunctions/addRecord/index.js
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
  const { OPENID } = cloud.getWXContext()

  const {
    babyId,
    recordType,
    timestamp,
    duration,
    amount,
    subType,
    note
  } = event

  // 参数校验
  if (!babyId || !recordType || !timestamp) {
    return { code: -1, message: '参数缺失' }
  }

  const validTypes = ['feed', 'diaper', 'sleep']
  if (!validTypes.includes(recordType)) {
    return { code: -1, message: '无效的记录类型' }
  }

  // 云端暂不可用时返回明确错误，前端会将记录入队本地待同步
  const FALLBACK = { code: -1, message: '云端暂不可用，记录已保存到本地待同步' }

  const record = {
    babyId,
    recordType,
    timestamp: new Date(timestamp).getTime(),
    duration: duration || 0,
    amount: amount || 0,
    subType: subType || '',
    note: note || '',
    userId: OPENID,
    createdAt: new Date()
  }

  return safeDb(async () => {
    // 权限校验：当前用户是否为该宝宝的成员（baby_members 关系）
    // 注意：历史版本误用 family_members（旧集合名），导致非 default 宝宝校验永远失败无法入库。
    // 统一使用 baby_members（与 createBaby/joinBaby/listBabies/saveBabyInfo 一致）。
    const memberRes = await db.collection('baby_members').where({
      babyId,
      openid: OPENID
    }).count()

    // 兼容历史：非成员但 babyId 还挂在旧的 family_members 下（老数据），放行一次
    let isMember = memberRes.total > 0
    if (!isMember && babyId !== 'default') {
      const legacyRes = await db.collection('family_members').where({
        babyId,
        openid: OPENID
      }).count()
      isMember = legacyRes.total > 0
    }

    if (!isMember && babyId !== 'default') {
      return { code: 403, message: '无写入权限' }
    }

    const result = await db.collection('records').add({ data: record })

    return {
      code: 0,
      data: {
        _id: result._id,
        ...record
      }
    }
  }, FALLBACK, ['baby_members', 'family_members', 'records'])
}