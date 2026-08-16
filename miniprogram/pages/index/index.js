// pages/index/index.js - 首页极简打卡（差异化布局 + 云函数容错）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatElapsed } = require('../../utils/time')
const { predictAll } = require('../../utils/predict')
const { RECORD_TYPES } = require('../../utils/constants')

Page({
  data: {
    babyInfo: {},
    lastRecords: { feed: 0, diaper: 0, sleep: 0 },
    elapsedTexts: { feed: '--', diaper: '--', sleep: '--' },
    predictions: { feed: '', diaper: '', sleep: '' },
    hasPrediction: false,
    isOffline: false,
    cloudReady: true,  // 默认 true，避免闪烁
    todayText: '',
    feedPress: false,
    diaperPress: false,
    sleepPress: false,
    feedSuccess: false,
    diaperSuccess: false,
    sleepSuccess: false
  },

  _timer: null,

  onLoad() {
    app.eventBus.on('recordsUpdated', this.refreshFromCache.bind(this))
    this.updateTodayText()
  },

  onShow() {
    // 同步云开发就绪状态
    this.setData({ cloudReady: app.globalData.cloudReady })

    // 同步自定义 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/index/index')
    }

    this.refreshFromCache()
    // 仅在云就绪时拉取云端数据
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
    }
    this._timer = setInterval(() => {
      this.updateElapsedTexts()
    }, 30000)
  },

  onHide() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
    app.eventBus.off('recordsUpdated', this.refreshFromCache)
  },

  updateTodayText() {
    const d = new Date()
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    this.setData({
      todayText: `${d.getMonth() + 1}/${d.getDate()} 周${week}`
    })
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

    const hasPrediction = !!(predictions.feed || predictions.sleep)
    this.setData({ babyInfo, lastRecords, predictions, hasPrediction })
    this.updateElapsedTexts()
  },

  updateElapsedTexts() {
    const { lastRecords } = this.data
    this.setData({
      elapsedTexts: {
        feed: formatElapsed(lastRecords.feed),
        diaper: formatElapsed(lastRecords.diaper),
        sleep: formatElapsed(lastRecords.sleep)
      }
    })
  },

  /**
   * 拉取云端数据（仅在云就绪时调用）
   */
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
          hasPrediction: !!(predictions.feed || predictions.sleep)
        })

        this.updateElapsedTexts()
      }
    } catch (err) {
      console.warn('拉取云端数据失败，使用本地缓存:', err)
      // 云环境失效时同步状态
      if (String(err.errCode || '').includes('-501000')) {
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

  // ===== 三个记录按钮处理 =====

  async handleFeed() {
    await this.recordAction(RECORD_TYPES.FEED, 'feedPress', 'feedSuccess')
  },

  async handleDiaper() {
    await this.recordAction(RECORD_TYPES.DIAPER, 'diaperPress', 'diaperSuccess')
  },

  async handleSleep() {
    await this.recordAction(RECORD_TYPES.SLEEP, 'sleepPress', 'sleepSuccess')
  },

  /**
   * 统一的记录动作处理（支持云未就绪时的离线模式）
   */
  async recordAction(type, pressKey, successKey) {
    // 触感反馈
    wx.vibrateShort({ type: 'light' })

    // 按下动画
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

    // 1. 本地缓存立即更新
    storage.updateLastRecord(type, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')

    // 2. 更新视图
    this.updateElapsedTexts()

    // 3. 成功反馈
    this.setData({ [successKey]: true })
    setTimeout(() => this.setData({ [successKey]: false }), 1000)

    // 4. 推送到云端（仅当云就绪时）
    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try {
        await call('addRecord', record)
      } catch (err) {
        app.enqueuePendingSync(record)
      }
    } else {
      // 云不可用，入队等待同步
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
    return {
      title: '我用秒记宝宝轻松记录宝宝作息'
    }
  }
})
