// pages/timeline/timeline.js - 时光轴回顾（修复重复行 + NaN bug）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime, minutesToText, toMs } = require('../../utils/time')
const { RECORD_CONFIG } = require('../../utils/constants')

Page({
  data: {
    records: [],
    loading: true,
    todayLabel: '',
    summary: { feedCount: 0, diaperCount: 0, sleepDuration: 0 }
  },

  onLoad() {
    const today = new Date()
    const todayLabel = `${today.getMonth() + 1}月${today.getDate()}日`
    this.setData({ todayLabel })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/timeline/timeline')
    }
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 优先本地缓存，再拉取云端（含去重）
   */
  async loadData() {
    // 先展示本地缓存
    const cached = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this.renderRecords(cached)

    try {
      const result = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: 1
      })
      if (result && result.records) {
        // 云端数据为权威来源，直接替换本地缓存（避免重复）
        // 统一 timestamp 为数字毫秒
        const normalized = result.records.map(r => ({
          ...r,
          timestamp: toMs(r.timestamp)
        }))
        this.renderRecords(normalized)
        // 更新本地缓存为云端数据（覆盖式更新）
        storage.set(storage.CACHE_KEYS.TODAY_RECORDS, normalized)
      }
    } catch (err) {
      console.warn('拉取今日记录失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 渲染记录列表（去重 + 倒序）
   * 去重 key: timestamp + recordType（毫秒级+类型足够唯一）
   */
  renderRecords(rawRecords) {
    if (!rawRecords || rawRecords.length === 0) {
      this.setData({ records: [], summary: { feedCount: 0, diaperCount: 0, sleepDuration: 0 } })
      return
    }

    // 统一时间戳格式 + 去重
    const seen = new Set()
    const deduped = []

    rawRecords.forEach(r => {
      const ts = toMs(r.timestamp)
      if (!ts) return // 过滤无效时间戳

      const dedupKey = `${ts}_${r.recordType}`
      if (seen.has(dedupKey)) return
      seen.add(dedupKey)

      const config = RECORD_CONFIG[r.recordType] || {}
      let extra = ''
      if (r.recordType === 'sleep' && r.duration) {
        extra = minutesToText(r.duration)
      } else if (r.recordType === 'feed' && r.amount) {
        extra = `${r.amount}ml`
      }

      deduped.push({
        _id: r._id || `local_${ts}`,
        recordType: r.recordType,
        timestamp: ts,
        duration: r.duration || 0,
        amount: r.amount || 0,
        label: config.label || r.recordType,
        icon: config.icon || '📝',
        color: config.color || '#D4B896',
        timeText: formatTime(ts),
        extra
      })
    })

    // 倒序
    deduped.sort((a, b) => b.timestamp - a.timestamp)

    // 统计当日小结
    const feedCount = deduped.filter(r => r.recordType === 'feed').length
    const diaperCount = deduped.filter(r => r.recordType === 'diaper').length
    const sleepDuration = deduped
      .filter(r => r.recordType === 'sleep' && r.duration)
      .reduce((sum, r) => sum + r.duration, 0)

    this.setData({
      records: deduped,
      summary: { feedCount, diaperCount, sleepDuration }
    })
  },

  /**
   * 删除记录
   */
  async handleDelete(e) {
    const { id } = e.detail
    const target = this.data.records.find(r => r._id === id)
    if (!target) return

    wx.showLoading({ title: '删除中...' })

    try {
      // 仅当不是本地临时记录时调用云端
      if (!String(id).startsWith('local_')) {
        await call('deleteRecord', { id })
      }
      // 从本地列表移除
      const records = this.data.records.filter(r => r._id !== id)
      this.renderRecords(records)
      storage.removeTodayRecord(id)
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  goShareCard() {
    wx.navigateTo({ url: '/pages/share/share' })
  }
})
