// cloudfunctions/getRecords/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId = 'default', days = 1, recordType } = event

  // 计算时间范围
  const now = Date.now()
  const startTime = now - days * 24 * 60 * 60 * 1000

  // 构建查询条件
  let query = {
    babyId,
    timestamp: _.gte(startTime).and(_.lte(now))
  }
  if (recordType) {
    query.recordType = recordType
  }

  // 查询记录（最多500条）
  const MAX_LIMIT = 500
  const countRes = await db.collection('records').where(query).count()
  const total = Math.min(countRes.total, MAX_LIMIT)

  const batchTimes = Math.ceil(total / 100)
  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    const promise = db.collection('records')
      .where(query)
      .orderBy('timestamp', 'desc')
      .skip(i * 100)
      .limit(100)
      .get()
    tasks.push(promise)
  }

  const results = await Promise.all(tasks)
  const records = results.reduce((acc, cur) => acc.concat(cur.data), [])

  return {
    code: 0,
    data: {
      records,
      total: countRes.total
    }
  }
}
