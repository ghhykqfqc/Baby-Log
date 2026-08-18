// utils/time.js - 时间处理工具

/**
 * 统一将各种格式的时间戳转换为毫秒数字
 * 兼容：数字毫秒、ISO 字符串、Date 对象
 */
const toMs = (input) => {
  if (!input) return 0
  if (typeof input === 'number') return input
  if (input instanceof Date) return input.getTime()
  // 字符串
  const d = new Date(input)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

/**
 * 格式化"距上次"文案
 */
const formatElapsed = (timestamp) => {
  const ts = toMs(timestamp)
  if (!ts) return '--'
  const diff = Date.now() - ts
  if (diff < 0) return '--'
  if (diff < 60 * 1000) return '刚刚'
  const minutes = Math.floor(diff / (60 * 1000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h ${remainMinutes}m`
}

/**
 * 格式化时间戳为友好显示（增强容错）
 */
const formatTime = (timestamp, format = 'HH:mm') => {
  const ts = toMs(timestamp)
  if (!ts || isNaN(ts)) return '--:--'

  const date = new Date(ts)
  if (isNaN(date.getTime())) return '--:--'

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

const getTodayStart = () => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.getTime()
}

const getDaysAgo = (days) => {
  return Date.now() - days * 24 * 60 * 60 * 1000
}

const diffInMinutes = (start, end) => {
  return Math.round((toMs(end) - toMs(start)) / (60 * 1000))
}

const minutesToText = (minutes) => {
  if (!minutes || minutes < 1) return ''
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return remain === 0 ? `${hours}小时` : `${hours}小时${remain}分`
}

/**
 * 智能时长格式化（中文友好版）
 * - < 1 分钟：刚刚
 * - < 1 小时：X 分钟
 * - < 1 天：X 小时 Y 分（Y=0 时省略）
 * - ≥ 1 天：X 天 Y 小时
 * @param {number} minutes 分钟数（浮点数会向下取整）
 * @returns {string}
 */
const formatDurationSmart = (minutes) => {
  const m = Math.max(0, Math.floor(minutes))
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟`
  const totalHours = Math.floor(m / 60)
  const remainMin = m % 60
  if (totalHours < 24) {
    return remainMin === 0 ? `${totalHours} 小时` : `${totalHours} 小时 ${remainMin} 分`
  }
  const days = Math.floor(totalHours / 24)
  const remainHours = totalHours % 24
  return remainHours === 0 ? `${days} 天` : `${days} 天 ${remainHours} 小时`
}

/**
 * 基于时间戳计算「距上次」的智能文案
 * @param {number} timestamp 上次时间戳
 * @returns {string} 如 "2 小时 15 分" / "32 分钟" / "刚刚"
 */
const formatElapsedSmart = (timestamp) => {
  const ts = toMs(timestamp)
  if (!ts) return '--'
  const diffMin = (Date.now() - ts) / 60000
  if (diffMin < 0) return '--'
  return formatDurationSmart(diffMin)
}

/**
 * 基于「平均间隔 + 上次时间戳」计算剩余时间文案
 * @param {number|null} avgIntervalMinutes 平均间隔（分钟），null 时返回空
 * @param {number} lastTimestamp 上次时间戳
 * @returns {string} 如 "35 分后" / "约 2 小时后" / "已超时" / ""
 */
const formatRemainingSmart = (avgIntervalMinutes, lastTimestamp) => {
  if (!avgIntervalMinutes) return ''
  const ts = toMs(lastTimestamp)
  if (!ts) return ''
  const elapsedMin = (Date.now() - ts) / 60000
  const remainMin = avgIntervalMinutes - elapsedMin
  if (remainMin <= 0) return '已超时'
  return `${formatDurationSmart(remainMin)}后`
}

module.exports = {
  toMs,
  formatElapsed,
  formatElapsedSmart,
  formatTime,
  getTodayStart,
  getDaysAgo,
  diffInMinutes,
  minutesToText,
  formatDurationSmart,
  formatRemainingSmart
}
