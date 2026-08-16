// app.js - 秒记宝宝 全局逻辑
// 云环境 ID 配置（按需修改为你自己的环境 ID）
const CLOUD_ENV = 'baby-log-prod'

App({
  globalData: {
    userInfo: null,
    openid: '',
    babyId: '',
    babyInfo: null,
    familyRole: 'parent',
    isOnline: true,
    pendingSync: [],
    // 云开发是否可用（环境未创建时为 false）
    cloudReady: false,
    // 开发模式：跳过云函数调用（云环境未开通时不报错）
    devMode: false
  },

  onLaunch() {
    // 初始化云开发（容错：环境不存在时不崩溃）
    if (!wx.cloud) {
      console.warn('当前基础库版本过低，不支持云能力')
      this.globalData.devMode = true
    } else {
      try {
        wx.cloud.init({
          env: CLOUD_ENV,
          traceUser: true
        })
        this.globalData.cloudReady = true
      } catch (err) {
        console.warn('云开发初始化失败，进入离线模式:', err.message || err)
        this.globalData.cloudReady = false
      }
    }

    // 恢复本地缓存
    this.restoreFromStorage()

    // 监听网络状态
    wx.onNetworkStatusChange((res) => {
      this.globalData.isOnline = res.isConnected
      if (res.isConnected && this.globalData.pendingSync.length > 0 && this.globalData.cloudReady) {
        this.syncPendingRecords()
      }
    })

    // 仅在云开发就绪时获取 openid
    if (this.globalData.cloudReady) {
      this.getOpenId()
    }
  },

  restoreFromStorage() {
    try {
      const babyId = wx.getStorageSync('babyId')
      const babyInfo = wx.getStorageSync('babyInfo')
      const familyRole = wx.getStorageSync('familyRole')
      if (babyId) this.globalData.babyId = babyId
      if (babyInfo) this.globalData.babyInfo = babyInfo
      if (familyRole) this.globalData.familyRole = familyRole
    } catch (e) {
      console.warn('恢复本地缓存失败:', e)
    }
  },

  /**
   * 安全的云函数调用封装（云不可用时返回空结果，不报错）
   */
  async safeCall(name, data = {}) {
    if (!this.globalData.cloudReady) {
      return null
    }
    try {
      const res = await wx.cloud.callFunction({ name, data })
      return res.result
    } catch (err) {
      // 静默处理 Env Not Exists 等错误
      if (String(err.errCode || '').includes('-501000') || String(err.errMsg || '').includes('Env Not Exists')) {
        this.globalData.cloudReady = false
        console.warn('云环境不可用，已切换到离线模式')
      }
      return null
    }
  },

  async getOpenId() {
    if (!this.globalData.cloudReady) return ''
    try {
      const res = await wx.cloud.callFunction({ name: 'getOpenId' })
      if (res.result && res.result.openid) {
        this.globalData.openid = res.result.openid
        wx.setStorageSync('openid', res.result.openid)
        return res.result.openid
      }
    } catch (err) {
      console.warn('获取 openid 失败（云环境未就绪）:', err.errMsg || err.message || '')
      this.globalData.cloudReady = false
    }
    return ''
  },

  enqueuePendingSync(record) {
    this.globalData.pendingSync.push(record)
    try {
      wx.setStorageSync('pendingSync', this.globalData.pendingSync)
    } catch (e) {}
  },

  async syncPendingRecords() {
    if (!this.globalData.cloudReady) return
    const queue = [...this.globalData.pendingSync]
    this.globalData.pendingSync = []
    try { wx.setStorageSync('pendingSync', this.globalData.pendingSync) } catch (e) {}

    for (const record of queue) {
      try {
        await wx.cloud.callFunction({ name: 'addRecord', data: record })
      } catch (err) {
        this.globalData.pendingSync.push(record)
      }
    }

    if (this.globalData.pendingSync.length > 0) {
      try { wx.setStorageSync('pendingSync', this.globalData.pendingSync) } catch (e) {}
    }
  },

  eventBus: {
    events: {},
    on(event, callback) {
      if (!this.events[event]) this.events[event] = []
      this.events[event].push(callback)
    },
    off(event, callback) {
      if (!this.events[event]) return
      this.events[event] = this.events[event].filter(cb => cb !== callback)
    },
    emit(event, data) {
      if (!this.events[event]) return
      this.events[event].forEach(cb => cb(data))
    }
  }
})
