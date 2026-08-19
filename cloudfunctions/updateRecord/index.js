// cloudfunctions/updateRecord/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { id, timestamp, duration, amount, subType, note } = event

  if (!id) {
    return { code: -1, message: '缺少记录 ID' }
  }

  // 构建更新字段（只更新传入的字段）
  const updateData = {}
  if (timestamp !== undefined) updateData.timestamp = new Date(timestamp).getTime()
  if (duration !== undefined) updateData.duration = duration || 0
  if (amount !== undefined) updateData.amount = amount || 0
  if (subType !== undefined) updateData.subType = subType || ''
  if (note !== undefined) updateData.note = note || ''
  updateData.updatedAt = db.serverDate()

  try {
    // 直接执行 update（doc 不存在时 SDK 会抛 errCode -1 errMsg "document not exists"）
    // cloud 函数有 admin 权限，无需先 get 再 update
    const result = await db.collection('records').doc(id).update({ data: updateData })

    // update 返回 { stats: { updated: N } }，updated=0 表示文档不存在
    if (result && result.stats && result.stats.updated === 0) {
      return { code: -1, message: '记录不存在或已被删除' }
    }

    return { code: 0, data: { _id: id, ...updateData } }
  } catch (err) {
    console.error('更新记录失败:', err)
    const msg = String((err && (err.errMsg || err.message)) || err)

    // 集合不存在时自动创建再重试
    if (msg.includes('-502005') || msg.includes('DATABASE_COLLECTION_NOT_EXIST') || msg.includes('collection not exists')) {
      try {
        if (typeof db.createCollection === 'function') {
          await db.createCollection('records')
        }
      } catch (e) { /* 已存在忽略 */ }
      try {
        const result2 = await db.collection('records').doc(id).update({ data: updateData })
        return { code: 0, data: { _id: id, ...updateData } }
      } catch (e2) {
        return { code: -1, message: '记录不存在或集合未初始化', detail: String((e2 && (e2.errMsg || e2.message)) || e2) }
      }
    }

    // document not exists
    if (msg.includes('not exist') || msg.includes('DOCUMENT_NOT_FOUND')) {
      return { code: -1, message: '记录不存在或已被删除' }
    }

    return { code: -1, message: '更新失败', detail: msg }
  }
}
