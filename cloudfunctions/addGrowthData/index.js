// cloudfunctions/addGrowthData/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId, height, weight, measureDate, headCircumference } = event

  if (!babyId || (!height && !weight)) {
    return { code: -1, message: '参数缺失' }
  }

  const data = {
    babyId,
    height: height || null,
    weight: weight || null,
    headCircumference: headCircumference || null,
    measureDate,
    userId: OPENID,
    createdAt: new Date()
  }

  const result = await db.collection('growth_data').add({ data })

  return {
    code: 0,
    data: {
      _id: result._id,
      ...data
    }
  }
}
