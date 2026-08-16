// pages/timeline/timeline.js - 时光轴回顾
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime, minutesToText } = require('../../utils/time')
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
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 优先本地缓存，再拉取云端
   */
  async loadData() {
    // 先展示本地缓存
    const cached = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this.renderRecords(cached)

    // 再拉取云端最新
    try {
      const result = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: 1
      })
      if (result && result.records) {
        this.renderRecords(result.records)
        storage.set(storage.CACHE_KEYS.TODAY_RECORDS, result.records)
      }
    } catch (err) {
      console.warn('拉取今日记录失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 渲染记录列表（倒序）
   */
  renderRecords(rawRecords) {
    const formatted = rawRecords.map(r => {
      const config = RECORD_CONFIG[r.recordType] || {}
      let extra = ''
      if (r.recordType === 'sleep' && r.duration) {
        extra = minutesToText(r.duration)
      } else if (r.recordType === 'feed' && r.amount) {
        extra = `${r.amount}ml`
      }
      return {
        ...r,
        label: config.label || r.recordType,
        icon: config.icon || '📝',
        color: config.color || '#D4B896',
        timeText: formatTime(r.timestamp),
        extra
      }
    }).sort((a, b) => b.timestamp - a.timestamp)

    // 统计当日小结
    const feedCount = rawRecords.filter(r => r.recordType === 'feed').length
    const diaperCount = rawRecords.filter(r => r.recordType === 'diaper').length
    const sleepDuration = rawRecords
      .filter(r => r.recordType === 'sleep' && r.duration)
      .reduce((sum, r) => sum + r.duration, 0)

    this.setData({
      records: formatted,
      summary: { feedCount, diaperCount, sleepDuration }
    })
  },

  /**
   * 删除记录
   */
  async handleDelete(e) {
    const { id } = e.detail
    wx.showLoading({ title: '删除中...' })

    try {
      await call('deleteRecord', { id })
      // 从本地列表移除
      const records = this.data.records.filter(r => r._id !== id)
      this.setData({ records })
      storage.removeTodayRecord(id)
      // 更新小结统计
      this.renderRecords(records)
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  /**
   * 去生成分享卡片
   */
  goShareCard() {
    wx.navigateTo({ url: '/pages/share/share' })
  }
})
