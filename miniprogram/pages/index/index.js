// pages/index/index.js - 首页极简打卡
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatElapsed } = require('../../utils/time')
const { predictAll } = require('../../utils/predict')
const { RECORD_TYPES, RECORD_CONFIG } = require('../../utils/constants')

Page({
  data: {
    babyInfo: {},
    lastRecords: { feed: 0, diaper: 0, sleep: 0 },
    elapsedTexts: { feed: '--', diaper: '--', sleep: '--' },
    predictions: { feed: '', diaper: '', sleep: '' },
    recordTypes: [
      { type: RECORD_TYPES.FEED, ...RECORD_CONFIG.feed },
      { type: RECORD_TYPES.DIAPER, ...RECORD_CONFIG.diaper },
      { type: RECORD_TYPES.SLEEP, ...RECORD_CONFIG.sleep }
    ],
    isOffline: false,
    syncingTip: ''
  },

  // 定时器，用于刷新"距上次"文案
  _timer: null,

  onLoad() {
    // 注册全局事件
    app.eventBus.on('recordsUpdated', this.refreshFromCache.bind(this))
  },

  onShow() {
    // 先从本地缓存秒开展示
    this.refreshFromCache()
    // 再异步拉取云端最新数据
    this.fetchCloudData()
    // 启动定时刷新
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

  /**
   * 从本地缓存刷新展示
   */
  refreshFromCache() {
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || { name: '宝宝', age: '新生儿' }
    const lastRecords = storage.getLastRecords()
    const predictionData = storage.get(storage.CACHE_KEYS.PREDICTION)
    const predictions = predictionData ? {
      feed: predictionData.feed?.text || '',
      diaper: predictionData.diaper?.text || '',
      sleep: predictionData.sleep?.text || ''
    } : { feed: '', diaper: '', sleep: '' }

    this.setData({ babyInfo, lastRecords, predictions })
    this.updateElapsedTexts()
  },

  /**
   * 更新"距上次"文案
   */
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
   * 从云端拉取最近记录和预测
   */
  async fetchCloudData() {
    if (!app.globalData.isOnline) {
      this.setData({ isOffline: true })
      return
    }

    try {
      const data = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: 7
      })

      if (data && data.records) {
        // 计算各类最新时间
        const lastRecords = { feed: 0, diaper: 0, sleep: 0 }
        data.records.forEach(r => {
          if (lastRecords[r.recordType] !== undefined) {
            if (!lastRecords[r.recordType] || r.timestamp > lastRecords[r.recordType]) {
              lastRecords[r.recordType] = r.timestamp
            }
          }
        })

        // 本地缓存
        storage.set(storage.CACHE_KEYS.LAST_RECORDS, lastRecords)

        // 计算预测
        const predictionResult = predictAll(data.records)
        storage.set(storage.CACHE_KEYS.PREDICTION, predictionResult)

        this.setData({
          lastRecords,
          predictions: {
            feed: predictionResult.feed.text,
            diaper: predictionResult.diaper.text,
            sleep: predictionResult.sleep.text
          }
        })

        this.updateElapsedTexts()
      }
    } catch (err) {
      console.warn('拉取云端数据失败，使用本地缓存:', err)
      this.setData({ isOffline: true })
    }
  },

  /**
   * 点击记录按钮
   */
  async handleRecord(e) {
    const { type, timestamp } = e.detail
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: type,
      timestamp,
      userId: app.globalData.openid,
      duration: type === RECORD_TYPES.SLEEP ? 0 : undefined,
      createdAt: new Date().toISOString()
    }

    // 1. 立即更新本地缓存（首屏秒开的核心）
    storage.updateLastRecord(type, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')

    // 2. 更新视图
    this.updateElapsedTexts()

    // 3. 推送到云端
    if (app.globalData.isOnline) {
      try {
        const result = await call('addRecord', record)
        if (result && result._id) {
          // 同步成功后可更新本地缓存的_id
          wx.showToast({ title: '已记录', icon: 'success', duration: 800 })
        }
      } catch (err) {
        // 网络失败，入队待同步
        app.enqueuePendingSync(record)
        wx.showToast({ title: '已离线保存', icon: 'none', duration: 1200 })
      }
    } else {
      app.enqueuePendingSync(record)
      wx.showToast({ title: '已离线保存，恢复网络后自动同步', icon: 'none', duration: 1500 })
    }
  },

  /**
   * 分享
   */
  onShareAppMessage() {
    return {
      title: '秒记宝宝 - 极简育儿记录',
      path: '/pages/index/index',
      imageUrl: ''
    }
  },

  onShareTimeline() {
    return {
      title: '我用秒记宝宝轻松记录宝宝作息'
    }
  }
})
