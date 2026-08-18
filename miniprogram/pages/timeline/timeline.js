// pages/timeline/timeline.js - 时光轴（预测卡 + 删除重构）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime, minutesToText, toMs } = require('../../utils/time')
const { RECORD_CONFIG } = require('../../utils/constants')
const { predictDetail } = require('../../utils/predict')

Page({
  data: {
    records: [],
    loading: true,
    todayLabel: '',
    hasRecords: false,
    predictList: [],          // 三栏预测卡数据
    hasPrediction: false,     // 是否有可用预测
    summary: { feedCount: 0, diaperCount: 0, sleepDurationText: '0小时' }
  },

  _countdownTimer: null,
  _allRecords: [],   // 完整数据用于重新计算预测

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

  onHide() {
    this.stopCountdown()
  },

  onUnload() {
    this.stopCountdown()
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  /**
   * 优先本地缓存，再拉云端
   */
  async loadData() {
    const cached = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this._allRecords = cached
    this.renderRecords(cached)
    this.updatePredictions()

    try {
      const result = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: 1
      })
      if (result && result.records) {
        const normalized = result.records.map(r => ({
          ...r,
          timestamp: toMs(r.timestamp)
        }))
        this._allRecords = normalized
        this.renderRecords(normalized)
        storage.set(storage.CACHE_KEYS.TODAY_RECORDS, normalized)
        this.updatePredictions()
      }
    } catch (err) {
      console.warn('拉取今日记录失败，使用本地缓存:', (err && err.message) || (err && err.errMsg) || err)
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 渲染记录列表（去重 + 倒序）
   */
  renderRecords(rawRecords) {
    if (!rawRecords || rawRecords.length === 0) {
      this.setData({
        records: [],
        hasRecords: false,
        summary: { feedCount: 0, diaperCount: 0, sleepDurationText: '0小时' }
      })
      return
    }

    const seen = new Set()
    const deduped = []

    rawRecords.forEach(r => {
      const ts = toMs(r.timestamp)
      if (!ts) return
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

    deduped.sort((a, b) => b.timestamp - a.timestamp)

    const feedCount = deduped.filter(r => r.recordType === 'feed').length
    const diaperCount = deduped.filter(r => r.recordType === 'diaper').length
    const sleepDurationTotal = deduped
      .filter(r => r.recordType === 'sleep' && r.duration)
      .reduce((sum, r) => sum + r.duration, 0)

    this.setData({
      records: deduped,
      hasRecords: deduped.length > 0,
      summary: {
        feedCount,
        diaperCount,
        sleepDurationText: sleepDurationTotal ? minutesToText(sleepDurationTotal) : '0小时'
      }
    })
  },

  /**
   * 计算并刷新三栏预测卡（含倒计时）
   */
  updatePredictions() {
    const detail = predictDetail(this._allRecords)
    const predictList = [
      { key: 'feed', ...detail.feed },
      { key: 'diaper', ...detail.diaper },
      { key: 'sleep', ...detail.sleep }
    ]
    this.setData({ predictList, hasPrediction: predictList.some(p => p.available) })

    // 启动倒计时刷新（每 30 秒更新一次）
    this.stopCountdown()
    const hasAnyAvailable = predictList.some(p => p.available)
    if (hasAnyAvailable) {
      this._countdownTimer = setInterval(() => {
        const refreshed = predictList.map(p => {
          if (!p.available) return p
          const detail = predictDetail(this._allRecords)[p.key]
          return { ...p, countdownText: detail.countdownText }
        })
        this.setData({ predictList: refreshed })
      }, 30000)
    }
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
      if (!String(id).startsWith('local_')) {
        await call('deleteRecord', { id })
      }
      const records = this.data.records.filter(r => r._id !== id)
      this._allRecords = this._allRecords.filter(r => (r._id || `local_${toMs(r.timestamp)}`) !== id)
      this.renderRecords(records)
      this.updatePredictions()
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
  },

  onShareAppMessage() {
    return {
      title: '秒记宝宝 - 看看宝宝今天的表现',
      path: '/pages/timeline/timeline'
    }
  }
})