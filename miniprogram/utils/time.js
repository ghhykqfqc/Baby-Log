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

module.exports = {
  toMs,
  formatElapsed,
  formatTime,
  getTodayStart,
  getDaysAgo,
  diffInMinutes,
  minutesToText
}
