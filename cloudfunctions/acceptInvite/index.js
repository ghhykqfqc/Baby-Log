// cloudfunctions/acceptInvite/index.js
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
  const { token } = event

  if (!token) {
    return { code: -1, message: '缺少邀请令牌' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 查询邀请
    const inviteRes = await db.collection('invitations').where({
      token,
      status: 'pending'
    }).get()

    if (inviteRes.data.length === 0) {
      return { code: 404, message: '邀请不存在或已被使用' }
    }

    const invite = inviteRes.data[0]

    // 校验是否过期
    if (new Date(invite.expireAt) < new Date()) {
      return { code: -1, message: '邀请已过期' }
    }

    // 校验是否已加入
    const existMember = await db.collection('family_members').where({
      babyId: invite.babyId,
      openid: OPENID
    }).count()

    if (existMember.total > 0) {
      return { code: -1, message: '您已加入该家庭' }
    }

    // 加入家庭
    await db.collection('family_members').add({
      data: {
        babyId: invite.babyId,
        openid: OPENID,
        role: invite.role,
        invitedBy: invite.inviterOpenid,
        joinedAt: new Date()
      }
    })

    // 更新邀请状态
    await db.collection('invitations').doc(invite._id).update({
      data: {
        status: 'accepted',
        acceptedBy: OPENID,
        acceptedAt: new Date()
      }
    })

    return {
      code: 0,
      data: {
        babyId: invite.babyId,
        role: invite.role
      }
    }
  }, FALLBACK, ['invitations', 'family_members'])
}