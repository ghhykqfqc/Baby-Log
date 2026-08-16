// cloudfunctions/deleteRecord/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id } = event

  if (!id) {
    return { code: -1, message: '缺少记录ID' }
  }

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
}
