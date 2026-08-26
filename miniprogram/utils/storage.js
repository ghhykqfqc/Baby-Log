// utils/storage.js - 本地存储封装（性能优化核心）

const CACHE_KEYS = {
  LAST_RECORDS: 'lastRecords',       // 最近一次各类型记录的时间 { feed, diaper, sleep }
  TODAY_RECORDS: 'todayRecords',     // 今日所有记录缓存
  PREDICTION: 'prediction',          // 预测数据
  GROWTH_DATA: 'growthData',         // 成长数据
  BABY_INFO: 'babyInfo',
  PENDING_SYNC: 'pendingSync',
  ALBUM_PHOTOS: 'albumPhotos',       // 宝宝封面相册 [{ id, src }]
  WEATHER_INFO: 'weatherInfo'        // 天气缓存 { category, temp, ts }
}

/**
 * 读取缓存
 */
const get = (key) => {
  try {
    return wx.getStorageSync(key)
  } catch (e) {
    console.warn('Storage get failed:', key, e)
    return null
  }
}

/**
 * 写入缓存
 */
const set = (key, value) => {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.warn('Storage set failed:', key, e)
  }
}

/**
 * 删除缓存
 */
const remove = (key) => {
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    console.warn('Storage remove failed:', key, e)
  }
}

/**
 * 更新最近记录时间戳（用于首屏秒开展示）
 */
const updateLastRecord = (recordType, timestamp) => {
  const last = get(CACHE_KEYS.LAST_RECORDS) || { feed: 0, diaper: 0, sleep: 0 }
  last[recordType] = timestamp
  set(CACHE_KEYS.LAST_RECORDS, last)
}

/**
 * 获取最近记录时间戳
 */
const getLastRecords = () => {
  return get(CACHE_KEYS.LAST_RECORDS) || { feed: 0, diaper: 0, sleep: 0 }
}

/**
 * 追加一条今日记录到缓存列表
 */
const appendTodayRecord = (record) => {
  const list = get(CACHE_KEYS.TODAY_RECORDS) || []
  list.unshift(record)
  set(CACHE_KEYS.TODAY_RECORDS, list)
}

/**
 * 从缓存列表中删除一条记录
 */
const removeTodayRecord = (recordId) => {
  const list = get(CACHE_KEYS.TODAY_RECORDS) || []
  const filtered = list.filter(r => r._id !== recordId)
  set(CACHE_KEYS.TODAY_RECORDS, filtered)
}

/**
 * 获取某宝宝的相册存储键（按 babyId 隔离，避免多宝宝相册串数据）
 * 兼容旧版本的无后缀全局键：读取时自动迁移
 */
function albumKey(babyId) {
  const id = babyId || 'default'
  return `albumPhotos_${id}`
}

module.exports = {
  CACHE_KEYS,
  get,
  set,
  remove,
  updateLastRecord,
  getLastRecords,
  appendTodayRecord,
  removeTodayRecord,
  albumKey
}
