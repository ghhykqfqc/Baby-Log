// pages/timeline/timeline.js - 时光轴（固定头部 + 列表区滚动分页加载）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime, minutesToText, toMs } = require('../../utils/time')
const { RECORD_CONFIG } = require('../../utils/constants')
const { predictDetail } = require('../../utils/predict')

// 分页配置：每次上拉多加载 7 天，最多展示 60 天
const PAGE_STEP = 7
const MAX_DAYS = 60

Page({
  data: {
    records: [],
    groups: [],              // 按日期分组的记录（列表渲染用）
    loading: true,
    isLoadingMore: false,    // 分页加载中
    noMore: false,           // 是否已到最大范围
    refresherTriggered: false,
    maxDays: MAX_DAYS,
    todayLabel: '',
    hasRecords: false,       // 今日是否有记录（控制预测卡/小结）
    predictList: [],         // 三栏预测卡数据
    hasPrediction: false,    // 是否有可用预测
    summary: { feedCount: 0, diaperCount: 0, sleepDurationText: '0小时' }
  },

  _countdownTimer: null,
  _allRecords: [],   // 完整数据用于重新计算预测
  _loadedDays: 1,    // 当前已加载的天数范围
  _autoLoaded: false, // 是否已自动尝试加载过历史（防止空库时递归翻页）

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

  stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  /**
   * 优先本地缓存，再拉云端（按当前已加载范围）
   */
  async loadData() {
    const cached = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this._allRecords = cached
    this.renderRecords(cached)
    this.updatePredictions()

    await this.fetchRecords(true)
  },

  /**
   * 拉取云端记录（days = 当前分页范围）
   * @param {Boolean} isRefresh 是否为刷新（今天无记录时自动加载历史）
   */
  async fetchRecords(isRefresh) {
    try {
      const result = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: this._loadedDays
      })
      if (result && result.records) {
        const normalized = result.records.map(r => ({
          ...r,
          timestamp: toMs(r.timestamp)
        }))
        this._allRecords = normalized
        this.renderRecords(normalized)
        // 缓存仍只存今日记录（分享页/首页依赖 todayRecords 的语义）
        const todayRecords = normalized.filter(r => this.isSameDay(r.timestamp, Date.now()))
        storage.set(storage.CACHE_KEYS.TODAY_RECORDS, todayRecords)
        this.updatePredictions()

        // 今天无记录时，自动加载一次历史，避免列表空白
        if (isRefresh && normalized.length === 0 && !this._autoLoaded && !this.data.noMore) {
          this._autoLoaded = true
          this.setData({ loading: false })
          this.onLoadMore()
          return
        }
      }
    } catch (err) {
      console.warn('拉取记录失败，使用本地缓存:', (err && err.message) || (err && err.errMsg) || err)
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 判断两个时间戳是否同一天
   */
  isSameDay(ts1, ts2) {
    const d1 = new Date(ts1)
    const d2 = new Date(ts2)
    return d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
  },

  /**
   * 日期分组标签：今天 / 昨天 / M月D日（跨年带年份）
   */
  formatGroupLabel(timestamp) {
    const d = new Date(timestamp)
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (this.isSameDay(timestamp, now.getTime())) return '今天'
    if (this.isSameDay(timestamp, yesterday.getTime())) return '昨天'
    const label = `${d.getMonth() + 1}月${d.getDate()}日`
    return d.getFullYear() === now.getFullYear() ? label : `${d.getFullYear()}年${label}`
  },

  /**
   * 上拉加载更早的记录（scroll-view 触底触发）
   */
  async onLoadMore() {
    if (this.data.loading || this.data.isLoadingMore || this.data.noMore) return

    this._loadedDays = Math.min(this._loadedDays + PAGE_STEP, MAX_DAYS)
    this.setData({
      isLoadingMore: true,
      noMore: this._loadedDays >= MAX_DAYS
    })

    await this.fetchRecords(false)
    this.setData({ isLoadingMore: false })
  },

  /**
   * 下拉刷新（scroll-view refresher）
   */
  async onRefresherRefresh() {
    this.setData({ refresherTriggered: true })
    try {
      // 保留已加载范围，刷新数据
      await this.fetchRecords(true)
    } finally {
      this.setData({ refresherTriggered: false })
    }
  },

  /**
   * 渲染记录列表（去重 + 倒序 + 按日期分组）
   */
  renderRecords(rawRecords) {
    if (!rawRecords || rawRecords.length === 0) {
      this.setData({
        records: [],
        groups: [],
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

    // 按日期分组（倒序）
    const groups = []
    let lastDayKey = ''
    deduped.forEach(r => {
      const d = new Date(r.timestamp)
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
      if (key !== lastDayKey) {
        groups.push({ key, label: this.formatGroupLabel(r.timestamp), records: [] })
        lastDayKey = key
      }
      groups[groups.length - 1].records.push(r)
    })

    // 当日小结只统计今天的记录
    const now = Date.now()
    const todayRecords = deduped.filter(r => this.isSameDay(r.timestamp, now))
    const feedCount = todayRecords.filter(r => r.recordType === 'feed').length
    const diaperCount = todayRecords.filter(r => r.recordType === 'diaper').length
    const sleepDurationTotal = todayRecords
      .filter(r => r.recordType === 'sleep' && r.duration)
      .reduce((sum, r) => sum + r.duration, 0)

    this.setData({
      records: deduped,
      groups,
      hasRecords: todayRecords.length > 0,
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
