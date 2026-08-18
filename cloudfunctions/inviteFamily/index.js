// cloudfunctions/inviteFamily/index.js
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
  const { babyId, role = 'grandparent', inviteeName = '' } = event

  if (!babyId) {
    return { code: -1, message: '缺少babyId' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 校验邀请人是否为父母角色
    const inviterMember = await db.collection('family_members').where({
      babyId,
      openid: OPENID,
      role: 'parent'
    }).count()

    if (inviterMember.total === 0) {
      return { code: 403, message: '仅父母角色可发起邀请' }
    }

    // 生成邀请令牌（6位随机码，24小时有效）
    const token = Math.random().toString(36).slice(2, 8).toUpperCase()
    const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await db.collection('invitations').add({
      data: {
        token,
        babyId,
        inviterOpenid: OPENID,
        inviteeName,
        role,
        status: 'pending',
        expireAt,
        createdAt: new Date()
      }
    })

    // 构建邀请链接
    const path = `/pages/index/index?invite=${token}`

    return {
      code: 0,
      data: {
        token,
        path,
        expireAt
      }
    }
  }, FALLBACK, ['family_members', 'invitations'])
}