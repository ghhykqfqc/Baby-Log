// app.js - 秒记宝宝 全局逻辑
App({
  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    openid: '',
    babyId: '',           // 当前选中的宝宝档案ID
    babyInfo: null,       // 宝宝基础信息
    familyRole: 'parent', // parent | grandparent
    isOnline: true,       // 网络状态
    pendingSync: []       // 待同步到云端的本地记录队列
  },

  /**
   * 小程序初始化
   */
  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    wx.cloud.init({
      env: 'baby-log-prod',  // 替换为实际云环境ID
      traceUser: true
    })

    // 恢复本地缓存
    this.restoreFromStorage()

    // 监听网络状态
    wx.onNetworkStatusChange((res) => {
      this.globalData.isOnline = res.isConnected
      if (res.isConnected && this.globalData.pendingSync.length > 0) {
        this.syncPendingRecords()
      }
    })

    // 获取用户openid
    this.getOpenId()
  },

  /**
   * 从本地缓存恢复数据（性能优化：首屏秒开）
   */
  restoreFromStorage() {
    const babyId = wx.getStorageSync('babyId')
    const babyInfo = wx.getStorageSync('babyInfo')
    const familyRole = wx.getStorageSync('familyRole')

    if (babyId) this.globalData.babyId = babyId
    if (babyInfo) this.globalData.babyInfo = babyInfo
    if (familyRole) this.globalData.familyRole = familyRole
  },

  /**
   * 获取用户唯一标识
   */
  async getOpenId() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getOpenId'
      })
      this.globalData.openid = res.result.openid
      wx.setStorageSync('openid', res.result.openid)
      return res.result.openid
    } catch (err) {
      console.error('获取openid失败:', err)
      return ''
    }
  },

  /**
   * 离线记录入队，网络恢复后自动同步
   * @param {Object} record - 记录数据
   */
  enqueuePendingSync(record) {
    this.globalData.pendingSync.push(record)
    wx.setStorageSync('pendingSync', this.globalData.pendingSync)
  },

  /**
   * 同步所有待处理记录到云端
   */
  async syncPendingRecords() {
    const queue = [...this.globalData.pendingSync]
    this.globalData.pendingSync = []
    wx.setStorageSync('pendingSync', this.globalData.pendingSync)

    for (const record of queue) {
      try {
        await wx.cloud.callFunction({
          name: 'addRecord',
          data: record
        })
      } catch (err) {
        // 同步失败，重新入队
        this.globalData.pendingSync.push(record)
      }
    }

    if (this.globalData.pendingSync.length > 0) {
      wx.setStorageSync('pendingSync', this.globalData.pendingSync)
    }
  },

  /**
   * 全局事件总线（轻量级发布订阅）
   */
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
