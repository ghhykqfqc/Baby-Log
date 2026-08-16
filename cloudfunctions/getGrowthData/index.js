// cloudfunctions/getGrowthData/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { babyId = 'default' } = event

  const res = await db.collection('growth_data')
    .where({ babyId })
    .orderBy('measureDate', 'asc')
    .limit(100)
    .get()

  return {
    code: 0,
    data: {
      records: res.data
    }
  }
}
