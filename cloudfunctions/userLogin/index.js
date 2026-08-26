// cloudfunctions/userLogin/index.js
// 用户登录：以 openid 为主键，持久化微信头像与昵称
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
      try { return await fn() }
      catch (err2) {
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
  const { nickName, avatarUrl } = event

  if (!OPENID) {
    return { code: -1, message: '无法获取用户身份' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 查找已有用户
    const existRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()

    const now = new Date()
    let user

    if (existRes.data && existRes.data.length > 0) {
      // 已有用户：仅在显式传入新值时更新（避免每次登录覆盖空值）
      const update = { lastLoginAt: now }
      if (nickName) update.nickName = String(nickName).slice(0, 30)
      if (avatarUrl) update.avatarUrl = avatarUrl

      await db.collection('users').doc(existRes.data[0]._id).update({ data: update })
      user = { ...existRes.data[0], ...update }
    } else {
      // 新用户
      const newUser = {
        openid: OPENID,
        nickName: (nickName || '微信用户').slice(0, 30),
        avatarUrl: avatarUrl || '',
        createdAt: now,
        lastLoginAt: now
      }
      const addRes = await db.collection('users').add({ data: newUser })
      user = { _id: addRes._id, ...newUser }
    }

    return {
      code: 0,
      data: {
        openid: user.openid,
        nickName: user.nickName,
        avatarUrl: user.avatarUrl
      }
    }
  }, FALLBACK, ['users'])
}
