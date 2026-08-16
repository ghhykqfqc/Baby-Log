// cloudfunctions/getDailySummary/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { babyId = 'default', date } = event

  // 计算当日时间范围
  const targetDate = date ? new Date(date) : new Date()
  const dayStart = new Date(targetDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(targetDate)
  dayEnd.setHours(23, 59, 59, 999)

  const startTs = dayStart.getTime()
  const endTs = dayEnd.getTime()

  // 查询当日所有记录
  const res = await db.collection('records').where({
    babyId,
    timestamp: _.gte(startTs).and(_.lte(endTs))
  }).orderBy('timestamp', 'asc').get()

  const records = res.data

  // 统计
  const feedRecords = records.filter(r => r.recordType === 'feed')
  const diaperRecords = records.filter(r => r.recordType === 'diaper')
  const sleepRecords = records.filter(r => r.recordType === 'sleep')

  const sleepDuration = sleepRecords.reduce((sum, r) => sum + (r.duration || 0), 0)

  return {
    code: 0,
    data: {
      date,
      feedCount: feedRecords.length,
      diaperCount: diaperRecords.length,
      sleepDuration,
      sleepCount: sleepRecords.length,
      firstFeedTime: feedRecords[0]?.timestamp || null,
      lastFeedTime: feedRecords[feedRecords.length - 1]?.timestamp || null,
      records
    }
  }
}
