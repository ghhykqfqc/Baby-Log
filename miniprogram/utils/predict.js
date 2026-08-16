// utils/predict.js - 智能预测算法（本地版本，云端也会计算）

/**
 * 基于历史记录计算平均间隔
 * @param {Array} records - 按时间正序的记录数组
 * @param {string} type - 记录类型
 * @returns {number|null} 平均间隔（分钟），不足2条数据返回null
 */
const calculateAvgInterval = (records, type) => {
  const filtered = records.filter(r => r.recordType === type)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (filtered.length < 2) return null

  let totalDiff = 0
  let count = 0
  for (let i = 1; i < filtered.length; i++) {
    const diff = (filtered[i].timestamp - filtered[i - 1].timestamp) / (60 * 1000)
    // 过滤异常间隔（超过 8 小时视为漏记）
    if (diff > 0 && diff < 480) {
      totalDiff += diff
      count++
    }
  }

  return count === 0 ? null : Math.round(totalDiff / count)
}

/**
 * 生成预测文案
 * @param {number|null} avgInterval - 平均间隔（分钟）
 * @param {number} lastTimestamp - 上次记录时间戳
 * @returns {string} 预测文案
 */
const generatePredictionText = (avgInterval, lastTimestamp) => {
  if (!avgInterval) return ''
  if (!lastTimestamp) return `通常间隔约 ${Math.round(avgInterval / 60)} 小时`

  const elapsed = (Date.now() - lastTimestamp) / (60 * 1000)
  const remaining = avgInterval - elapsed

  if (remaining <= 0) {
    return `已超过通常间隔，请留意宝宝状态`
  } else if (remaining < 30) {
    return `预计 ${Math.round(remaining)} 分钟内需要关注`
  } else if (remaining < 60) {
    return `预计约 1 小时内`
  } else {
    const hours = Math.round(remaining / 60)
    return `预计约 ${hours} 小时后`
  }
}

/**
 * 为三种类型生成完整预测
 */
const predictAll = (records) => {
  const types = ['feed', 'diaper', 'sleep']
  const labels = {
    feed: '下次喂奶',
    diaper: '下次换尿布',
    sleep: '下次睡觉'
  }

  const result = {}
  types.forEach(type => {
    const avg = calculateAvgInterval(records, type)
    const typeRecords = records.filter(r => r.recordType === type)
      .sort((a, b) => b.timestamp - a.timestamp)
    const lastTs = typeRecords[0]?.timestamp || 0
    result[type] = {
      avgInterval: avg,
      lastTimestamp: lastTs,
      text: generatePredictionText(avg, lastTs)
    }
  })

  return result
}

module.exports = {
  calculateAvgInterval,
  generatePredictionText,
  predictAll
}
