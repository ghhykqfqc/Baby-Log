// pages/index/index.js - 首页极简打卡（睡眠交互优化 + 文案优化）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatElapsedSmart, formatRemainingSmart, formatDurationSmart } = require('../../utils/time')
const { predictAll } = require('../../utils/predict')
const { RECORD_TYPES } = require('../../utils/constants')

// 入睡后超过此时间（毫秒）仍未结束，视为漏记结束，自动复位
const SLEEP_RESET_MS = 12 * 60 * 60 * 1000

Page({
  data: {
    babyInfo: {},
    lastRecords: { feed: 0, diaper: 0, sleep: 0 },
    // 每张卡片的双行文案：elapsed（距上次）+ next（预计下次）
    cardTexts: {
      feed:   { elapsed: '--', next: '' },
      diaper: { elapsed: '--', next: '' },
      sleep:  { elapsed: '--', next: '' }
    },
    // 预测胶囊数据（顶部一行）
    predictions: { feed: '', diaper: '', sleep: '' },
    hasPrediction: false,
    isOffline: false,
    cloudReady: true,
    todayText: '',
    feedPress: false,
    diaperPress: false,
    sleepPress: false,
    feedSuccess: false,
    diaperSuccess: false,
    sleepSuccess: false,
    // 睡眠状态
    sleeping: false,
    sleepStartTime: 0,
    sleepDurationText: '',     // 已睡时长文案
    showSleepSheet: false,     // 睡眠操作面板
    showDurationPicker: false  // 时长选择器
  },

  _timer: null,
  _sleepTick: null,

  onLoad() {
    app.eventBus.on('recordsUpdated', this.refreshFromCache.bind(this))
    this.updateTodayText()
    this.restoreSleepState()
  },

  onShow() {
    this.setData({ cloudReady: app.globalData.cloudReady })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/index/index')
    }
    this.refreshFromCache()
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
    }
    this._timer = setInterval(() => this.updateCardTexts(), 30000)
    this.startSleepTick()
  },

  onHide() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.stopSleepTick()
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
    this.stopSleepTick()
    app.eventBus.off('recordsUpdated', this.refreshFromCache)
  },

  updateTodayText() {
    const d = new Date()
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    this.setData({ todayText: `${d.getMonth() + 1}/${d.getDate()} 周${week}` })
  },

  /**
   * 从本地存储恢复睡眠中的状态（应对小程序被关闭重开）
   */
  restoreSleepState() {
    try {
      const sleepStart = wx.getStorageSync('sleepStartTime') || 0
      if (sleepStart && (Date.now() - sleepStart) < SLEEP_RESET_MS) {
        this.setData({ sleeping: true, sleepStartTime: sleepStart })
      } else if (sleepStart) {
        // 超时复位
        wx.removeStorageSync('sleepStartTime')
      }
    } catch (e) {}
  },

  startSleepTick() {
    this.stopSleepTick()
    if (!this.data.sleeping) return
    this.updateSleepDurationText()
    this._sleepTick = setInterval(() => this.updateSleepDurationText(), 30000)
  },

  stopSleepTick() {
    if (this._sleepTick) {
      clearInterval(this._sleepTick)
      this._sleepTick = null
    }
  },

  updateSleepDurationText() {
    if (!this.data.sleeping || !this.data.sleepStartTime) {
      this.setData({ sleepDurationText: '' })
      return
    }
    // 超过 14 小时视为漏记结束，自动复位
    if (Date.now() - this.data.sleepStartTime > 14 * 60 * 60 * 1000) {
      this.autoResetSleep()
      return
    }
    const minutes = Math.max(0, Math.floor((Date.now() - this.data.sleepStartTime) / 60000))
    this.setData({ sleepDurationText: this.minutesToText(minutes) })
  },

  autoResetSleep() {
    this.stopSleepTick()
    try { wx.removeStorageSync('sleepStartTime') } catch (e) {}
    this.setData({ sleeping: false, sleepStartTime: 0, sleepDurationText: '' })
    this.updateCardTexts()
  },

  minutesToText(minutes) {
    if (minutes < 1) return '0分钟'
    if (minutes < 60) return `${minutes}分钟`
    const hours = Math.floor(minutes / 60)
    const remain = minutes % 60
    return remain ? `${hours}小时${remain}分` : `${hours}小时`
  },

  refreshFromCache() {
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || { name: '宝宝', age: '新生儿' }
    const lastRecords = storage.getLastRecords()
    const predictionData = storage.get(storage.CACHE_KEYS.PREDICTION)

    let predictions = { feed: '', diaper: '', sleep: '' }
    if (predictionData) {
      predictions = {
        feed: predictionData.feed?.text || '',
        diaper: predictionData.diaper?.text || '',
        sleep: predictionData.sleep?.text || ''
      }
    }

    const hasPrediction = !!(predictions.feed || predictions.diaper || predictions.sleep)
    this.setData({ babyInfo, lastRecords, predictions, hasPrediction })
    this.updateCardTexts()
  },

  /**
   * 统一生成三张卡片的「距上次 + 预计下次」双行文案
   * 睡眠入睡中时改用「已睡 + 预计醒来」
   */
  updateCardTexts() {
    const { lastRecords, sleeping, sleepStartTime } = this.data
    const predictionData = storage.get(storage.CACHE_KEYS.PREDICTION) || {}

    const build = (type) => {
      const last = lastRecords[type] || 0
      const pred = predictionData[type] || {}
      const avgInterval = pred.avgInterval || 0

      if (type === 'sleep' && sleeping && sleepStartTime) {
        // 入睡中：已睡 + 预计醒来
        const sleptMin = (Date.now() - sleepStartTime) / 60000
        return {
          elapsed: `已睡 ${formatDurationSmart(sleptMin)}`,
          next: avgInterval ? `${formatDurationSmart(avgInterval - sleptMin)}后醒` : ''
        }
      }

      const elapsed = last ? `距上次 ${formatElapsedSmart(last)}` : '--'
      const next = formatRemainingSmart(avgInterval, last)
      return { elapsed, next }
    }

    this.setData({
      cardTexts: {
        feed: build('feed'),
        diaper: build('diaper'),
        sleep: build('sleep')
      }
    })
  },

  async fetchCloudData() {
    if (!app.globalData.cloudReady) return
    try {
      const data = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: 7
      })
      if (data && data.records) {
        const lastRecords = { feed: 0, diaper: 0, sleep: 0 }
        data.records.forEach(r => {
          const ts = this.normalizeTimestamp(r.timestamp)
          if (lastRecords[r.recordType] !== undefined) {
            if (!lastRecords[r.recordType] || ts > lastRecords[r.recordType]) {
              lastRecords[r.recordType] = ts
            }
          }
        })
        storage.set(storage.CACHE_KEYS.LAST_RECORDS, lastRecords)

        const predictionResult = predictAll(data.records.map(r => ({
          ...r,
          timestamp: this.normalizeTimestamp(r.timestamp)
        })))
        storage.set(storage.CACHE_KEYS.PREDICTION, predictionResult)

        const predictions = {
          feed: predictionResult.feed.text,
          diaper: predictionResult.diaper.text,
          sleep: predictionResult.sleep.text
        }

        this.setData({
          lastRecords,
          predictions,
          hasPrediction: !!(predictions.feed || predictions.diaper || predictions.sleep)
        })
        this.updateCardTexts()
      }
    } catch (err) {
      console.warn('拉取云端数据失败，使用本地缓存:', (err && err.message) || (err && err.errMsg) || err)
      if (String(err.errCode || '').includes('-501000') || String(err.errMsg || '').includes('-501000')) {
        app.globalData.cloudReady = false
        this.setData({ cloudReady: false })
      }
    }
  },

  normalizeTimestamp(ts) {
    if (!ts) return 0
    if (typeof ts === 'number') return ts
    const d = new Date(ts)
    return isNaN(d.getTime()) ? 0 : d.getTime()
  },

  // ===== 喂奶 / 尿布 =====
  async handleFeed() {
    await this.recordAction(RECORD_TYPES.FEED, 'feedPress', 'feedSuccess', '已记录喂奶')
  },

  async handleDiaper() {
    await this.recordAction(RECORD_TYPES.DIAPER, 'diaperPress', 'diaperSuccess', '已记录换尿布')
  },

  /**
   * 点击睡觉卡片：弹出操作面板
   */
  handleSleep() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ showSleepSheet: true })
  },

  /**
   * 标记刚刚入睡
   */
  async startSleep() {
    const now = Date.now()
    wx.vibrateShort({ type: 'light' })
    this.setData({
      showSleepSheet: false,
      sleeping: true,
      sleepStartTime: now,
      sleepPress: true
    })
    setTimeout(() => this.setData({ sleepPress: false }), 300)
    try { wx.setStorageSync('sleepStartTime', now) } catch (e) {}

    storage.updateLastRecord(RECORD_TYPES.SLEEP, now)
    app.eventBus.emit('recordsUpdated')
    this.startSleepTick()
    this.updateCardTexts()

    // 写入云端一条 duration=0 的入睡记录（结束时再补 duration）
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.SLEEP,
      timestamp: now,
      duration: 0,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }
    storage.appendTodayRecord({ ...record, _id: `local_${now}` })

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    this.setData({ sleepSuccess: true })
    setTimeout(() => this.setData({ sleepSuccess: false }), 1000)
    wx.showToast({ title: '已记录入睡', icon: 'none' })
  },

  /**
   * 结束睡眠：计算时长并写入新记录（duration 为本次睡眠分钟数）
   */
  async endSleep() {
    const start = this.data.sleepStartTime
    if (!start) {
      this.setData({ sleeping: false, showSleepSheet: false })
      return
    }
    const end = Date.now()
    const minutes = Math.max(1, Math.round((end - start) / 60000))

    wx.vibrateShort({ type: 'light' })
    this.setData({
      sleeping: false,
      showSleepSheet: false,
      sleepStartTime: 0,
      sleepDurationText: ''
    })
    try { wx.removeStorageSync('sleepStartTime') } catch (e) {}
    this.stopSleepTick()

    // 写入结束记录（带 duration）
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.SLEEP,
      timestamp: start,        // 以入睡时间为准
      duration: minutes,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }
    storage.updateLastRecord(RECORD_TYPES.SLEEP, end)
    storage.appendTodayRecord({ ...record, _id: `local_${end}`, timestamp: end, duration: minutes })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    wx.showToast({ title: `本次睡眠 ${this.minutesToText(minutes)}`, icon: 'success' })
  },

  /**
   * 回忆记录：展示时长选择器
   */
  showDurationPicker() {
    this.setData({ showSleepSheet: false, showDurationPicker: true })
  },

  hideDurationPicker() {
    this.setData({ showDurationPicker: false })
  },

  /**
   * 选择一个时长，立即记录"刚刚结束"的一次睡眠
   */
  async selectDuration(e) {
    const minutes = Number(e.currentTarget.dataset.minutes) || 0
    if (minutes <= 0) return
    const end = Date.now()
    const start = end - minutes * 60000

    wx.vibrateShort({ type: 'light' })
    this.setData({ showDurationPicker: false, sleepPress: true })
    setTimeout(() => this.setData({ sleepPress: false }), 300)

    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.SLEEP,
      timestamp: start,
      duration: minutes,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }
    storage.updateLastRecord(RECORD_TYPES.SLEEP, end)
    storage.appendTodayRecord({ ...record, _id: `local_${end}`, timestamp: end, duration: minutes })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    this.setData({ sleepSuccess: true })
    setTimeout(() => this.setData({ sleepSuccess: false }), 1000)
    wx.showToast({ title: `已记录 ${this.minutesToText(minutes)}`, icon: 'success' })
  },

  hideSleepSheet() {
    this.setData({ showSleepSheet: false })
  },

  noop() {},

  /**
   * 跳转到宝宝资料页
   */
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  /**
   * 通用记录动作（喂奶 / 尿布）
   */
  async recordAction(type, pressKey, successKey) {
    wx.vibrateShort({ type: 'light' })
    this.setData({ [pressKey]: true })
    setTimeout(() => this.setData({ [pressKey]: false }), 300)

    const timestamp = Date.now()
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: type,
      timestamp,
      userId: app.globalData.openid || '',
      duration: 0,
      createdAt: new Date().toISOString()
    }

    storage.updateLastRecord(type, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    this.setData({ [successKey]: true })
    setTimeout(() => this.setData({ [successKey]: false }), 1000)

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }
  },

  onShareAppMessage() {
    return {
      title: '秒记宝宝 - 极简育儿记录',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return { title: '我用秒记宝宝轻松记录宝宝作息' }
  }
})