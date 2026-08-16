// cloudfunctions/inviteFamily/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId, role = 'grandparent', inviteeName = '' } = event

  if (!babyId) {
    return { code: -1, message: '缺少babyId' }
  }

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
}
