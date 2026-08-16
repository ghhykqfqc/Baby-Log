// utils/time.js - 时间处理工具

/**
 * 格式化"距上次"文案
 * @param {number} timestamp - 上次记录的时间戳（毫秒）
 * @returns {string} 如 "2h 15m" 或 "刚刚"
 */
const formatElapsed = (timestamp) => {
  if (!timestamp) return '--'
  const diff = Date.now() - timestamp
  if (diff < 0) return '--'
  if (diff < 60 * 1000) return '刚刚'
  const minutes = Math.floor(diff / (60 * 1000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h ${remainMinutes}m`
}

/**
 * 格式化时间戳为友好显示
 * @param {number} timestamp
 * @param {string} format - 'HH:mm' | 'MM-DD HH:mm' | 'full'
 */
const formatTime = (timestamp, format = 'HH:mm') => {
  const date = new Date(timestamp)
  const pad = (n) => String(n).padStart(2, '0')
  const YYYY = date.getFullYear()
  const MM = pad(date.getMonth() + 1)
  const DD = pad(date.getDate())
  const HH = pad(date.getHours())
  const mm = pad(date.getMinutes())

  switch (format) {
    case 'HH:mm': return `${HH}:${mm}`
    case 'MM-DD HH:mm': return `${MM}-${DD} ${HH}:${mm}`
    case 'full': return `${YYYY}-${MM}-${DD} ${HH}:${mm}`
    default: return `${HH}:${mm}`
  }
}

/**
 * 获取今天 0 点的时间戳
 */
const getTodayStart = () => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.getTime()
}

/**
 * 获取指定天数前的时间戳
 * @param {number} days
 */
const getDaysAgo = (days) => {
  return Date.now() - days * 24 * 60 * 60 * 1000
}

/**
 * 计算两个时间戳之间的分钟数
 */
const diffInMinutes = (start, end) => {
  return Math.round((end - start) / (60 * 1000))
}

/**
 * 分钟转 "Xh Ym" 文案
 */
const minutesToText = (minutes) => {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return remain === 0 ? `${hours}h` : `${hours}h ${remain}m`
}

module.exports = {
  formatElapsed,
  formatTime,
  getTodayStart,
  getDaysAgo,
  diffInMinutes,
  minutesToText
}
