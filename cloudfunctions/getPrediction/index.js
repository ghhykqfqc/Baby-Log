// cloudfunctions/getPrediction/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/**
 * 基于最近7天数据计算喂奶/睡眠/换尿布的平均间隔
 */
exports.main = async (event, context) => {
  const { babyId = 'default' } = event
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  // 拉取近7天记录
  const res = await db.collection('records').where({
    babyId,
    timestamp: _.gte(sevenDaysAgo)
  }).orderBy('timestamp', 'asc').limit(1000).get()

  const records = res.data
  const types = ['feed', 'diaper', 'sleep']
  const result = {}

  types.forEach(type => {
    const typeRecords = records.filter(r => r.recordType === type)
      .sort((a, b) => a.timestamp - b.timestamp)

    if (typeRecords.length < 2) {
      result[type] = { avgInterval: null, text: '数据不足，记录几天后即可预测' }
      return
    }

    let totalDiff = 0
    let count = 0
    for (let i = 1; i < typeRecords.length; i++) {
      const diff = (typeRecords[i].timestamp - typeRecords[i - 1].timestamp) / (60 * 1000)
      if (diff > 0 && diff < 480) { // 过滤超8小时的异常间隔
        totalDiff += diff
        count++
      }
    }

    const avgInterval = count === 0 ? null : Math.round(totalDiff / count)
    const lastTs = typeRecords[typeRecords.length - 1].timestamp

    let text = ''
    if (!avgInterval) {
      text = '数据不足'
    } else {
      const elapsed = (Date.now() - lastTs) / (60 * 1000)
      const remaining = avgInterval - elapsed
      if (remaining <= 0) {
        text = '已超过通常间隔，请留意宝宝状态'
      } else if (remaining < 30) {
        text = `预计 ${Math.round(remaining)} 分钟内`
      } else if (remaining < 60) {
        text = '预计约 1 小时内'
      } else {
        text = `预计约 ${Math.round(remaining / 60)} 小时后`
      }
    }

    result[type] = { avgInterval, lastTimestamp: lastTs, text }
  })

  return { code: 0, data: result }
}
