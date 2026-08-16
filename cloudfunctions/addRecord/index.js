// cloudfunctions/addRecord/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  const {
    babyId,
    recordType,
    timestamp,
    duration,
    amount,
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

  // 权限校验：当前用户是否对该宝宝有写入权限
  const memberRes = await db.collection('family_members').where({
    babyId,
    openid: OPENID,
    role: 'parent'
  }).count()

  if (memberRes.total === 0 && babyId !== 'default') {
    return { code: 403, message: '无写入权限' }
  }

  const record = {
    babyId,
    recordType,
    timestamp: new Date(timestamp).getTime(),
    duration: duration || 0,
    amount: amount || 0,
    note: note || '',
    userId: OPENID,
    createdAt: new Date()
  }

  const result = await db.collection('records').add({ data: record })

  return {
    code: 0,
    data: {
      _id: result._id,
      ...record
    }
  }
}
