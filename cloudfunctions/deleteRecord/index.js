// cloudfunctions/deleteRecord/index.js
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
  const { id } = event

  if (!id) {
    return { code: -1, message: '缺少记录ID' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 查询记录是否存在并校验权限
    const recordRes = await db.collection('records').doc(id).get()
    if (!recordRes.data) {
      return { code: 404, message: '记录不存在' }
    }

    const record = recordRes.data

    // 校验权限：仅记录创建者或父母角色可删除
    const memberRes = await db.collection('family_members').where({
      babyId: record.babyId,
      openid: OPENID,
      role: 'parent'
    }).count()

    if (record.userId !== OPENID && memberRes.total === 0) {
      return { code: 403, message: '无删除权限' }
    }

    await db.collection('records').doc(id).remove()

    return { code: 0, data: { id } }
  }, FALLBACK, ['records', 'family_members'])
}