// cloudfunctions/updateGrowthData/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * 访问控制：记录归属的宝宝须为该用户（成员/创建者）所有；default 放行。
 */
async function canAccess(OPENID, babyId) {
  if (!OPENID || !babyId) return false
  if (babyId === 'default') return true
  try {
    const member = await db.collection('baby_members').where({ babyId, openid: OPENID }).count()
    if (member.total > 0) return true
    const owner = await db.collection('babies').where({ babyId }).get()
    if (owner.data && owner.data[0]) {
      const b = owner.data[0]
      return b.userId === OPENID || b.createdBy === OPENID
    }
    return false
  } catch (err) {
    return true
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id, height, weight, measureDate } = event

  if (!id) {
    return { code: -1, message: '缺少记录 ID' }
  }

  // 服务端访问控制：先取记录归属，非成员不得修改
  try {
    const doc = await db.collection('growth_data').doc(id).get()
    const ownerBabyId = (doc.data && doc.data.babyId) || ''
    if (!(await canAccess(OPENID, ownerBabyId))) {
      return { code: -403, message: '无权修改该记录' }
    }
  } catch (err) {
    const msg = String((err && (err.errMsg || err.message)) || '')
    // 记录本身不存在则继续走下方逻辑返回「不存在」
    if (msg.includes('not exist') || msg.includes('DOCUMENT_NOT_FOUND') || msg.includes('-502001')) {
      return { code: -1, message: '记录不存在或已被删除' }
    }
  }

  const updateData = {}
  if (height !== undefined) updateData.height = height ? parseFloat(height) : null
  if (weight !== undefined) updateData.weight = weight ? parseFloat(weight) : null
  if (measureDate !== undefined) updateData.measureDate = measureDate
  updateData.updatedAt = db.serverDate()

  try {
    const result = await db.collection('growth_data').doc(id).update({ data: updateData })
    if (result && result.stats && result.stats.updated === 0) {
      return { code: -1, message: '记录不存在或已被删除' }
    }
    return { code: 0, data: { _id: id, ...updateData } }
  } catch (err) {
    console.error('更新成长记录失败:', err)
    const msg = String((err && (err.errMsg || err.message)) || err)
    if (msg.includes('-502005') || msg.includes('DATABASE_COLLECTION_NOT_EXIST')) {
      try {
        if (typeof db.createCollection === 'function') await db.createCollection('growth_data')
      } catch (e) {}
      try {
        await db.collection('growth_data').doc(id).update({ data: updateData })
        return { code: 0, data: { _id: id, ...updateData } }
      } catch (e) {
        return { code: -1, message: '记录不存在或集合未初始化' }
      }
    }
    if (msg.includes('not exist') || msg.includes('DOCUMENT_NOT_FOUND')) {
      return { code: -1, message: '记录不存在或已被删除' }
    }
    return { code: -1, message: '更新失败', detail: msg }
  }
}
