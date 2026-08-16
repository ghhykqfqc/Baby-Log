// cloudfunctions/acceptInvite/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { token } = event

  if (!token) {
    return { code: -1, message: '缺少邀请令牌' }
  }

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
}
