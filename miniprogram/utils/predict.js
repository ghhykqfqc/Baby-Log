// utils/predict.js - 智能预测算法（本地版本，云端也会计算）
const MS_PER_MIN = 60 * 1000

/**
 * 基于历史记录计算平均间隔
 * @param {Array} records - 按时间正序的记录数组
 * @param {string} type - 记录类型
 * @returns {number|null} 平均间隔（分钟），不足2条数据返回 null
 */
const calculateAvgInterval = (records, type) => {
  const filtered = records.filter(r => r.recordType === type)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (filtered.length < 2) return null

  let totalDiff = 0
  let count = 0
  for (let i = 1; i < filtered.length; i++) {
    const diff = (filtered[i].timestamp - filtered[i - 1].timestamp) / MS_PER_MIN
    // 过滤异常间隔（超过 8 小时视为漏记）
    if (diff > 0 && diff < 480) {
      totalDiff += diff
      count++
    }
  }

  return count === 0 ? null : Math.round(totalDiff / count)
}

/**
 * 生成预测文案（用于首页胶囊）
 */
const generatePredictionText = (avgInterval, lastTimestamp) => {
  if (!avgInterval) return ''
  if (!lastTimestamp) return `通常间隔约 ${Math.round(avgInterval / 60)} 小时`

  const elapsed = (Date.now() - lastTimestamp) / MS_PER_MIN
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

/**
 * 为时光轴预测卡生成详细预测信息
 * 包含：预计下次时间点（今日/明日 时:分）、倒计时秒数
 * @param {Array} records 按时间正序的记录数组
 * @returns {Object} { feed, diaper, sleep } 各字段包含 { available, predictedAt, countdownMs, label, labelText }
 */
const predictDetail = (records) => {
  const types = ['feed', 'diaper', 'sleep']
  const labels = {
    feed: '下次喂奶',
    diaper: '下次换尿布',
    sleep: '下次睡觉'
  }
  const icons = { feed: '🍼', diaper: '🧷', sleep: '🌙' }

  const result = {}
  types.forEach(type => {
    const avg = calculateAvgInterval(records, type)
    const typeRecords = records.filter(r => r.recordType === type)
      .sort((a, b) => b.timestamp - a.timestamp)
    const lastTs = typeRecords[0]?.timestamp || 0

    if (!avg || !lastTs) {
      result[type] = {
        available: false,
        label: labels[type],
        icon: icons[type],
        predictedAt: 0,
        predictedText: '数据不足',
        countdownText: '--',
        overdue: false
      }
      return
    }

    const predictedAt = lastTs + avg * MS_PER_MIN
    const countdownMs = predictedAt - Date.now()
    const overdue = countdownMs <= 0

    result[type] = {
      available: true,
      label: labels[type],
      icon: icons[type],
      predictedAt,
      predictedText: formatPredictedTime(predictedAt),
      countdownText: formatCountdown(countdownMs),
      overdue
    }
  })
  return result
}

/**
 * 格式化预计时间点：今日/明日 时:分
 */
const formatPredictedTime = (ts) => {
  if (!ts) return '--'
  const d = new Date(ts)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const isSameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  if (isSameDay) return `今天 ${hh}:${mm}`
  if (isTomorrow) return `明天 ${hh}:${mm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

/**
 * 格式化倒计时：超时显示"已超时 Xh"，未到显示 "Xh Xm" 或 "Xm Xs"
 */
const formatCountdown = (ms) => {
  if (ms <= 0) {
    const overMin = Math.floor(Math.abs(ms) / MS_PER_MIN)
    if (overMin < 60) return `超时 ${overMin}分`
    return `超时 ${Math.floor(overMin / 60)}时${overMin % 60 ? (overMin % 60) + '分' : ''}`
  }
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

module.exports = {
  calculateAvgInterval,
  generatePredictionText,
  predictAll,
  predictDetail,
  formatPredictedTime,
  formatCountdown
}