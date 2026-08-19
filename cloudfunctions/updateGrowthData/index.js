// cloudfunctions/updateGrowthData/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id, height, weight, measureDate } = event

  if (!id) {
    return { code: -1, message: '缺少记录 ID' }
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
