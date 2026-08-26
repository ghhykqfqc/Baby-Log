// app.js - 秒记宝宝 全局逻辑

// ============================================================
// 云环境自动切换配置（无需发版改代码）
// ------------------------------------------------------------
// 规则（基于 wx.getAccountInfoSync().miniProgram.envVersion）：
//   - develop（开发者工具 / 真机调试开发版）  → DEV_ENV
//   - trial（体验版）                          → DEV_ENV
//   - release（正式版，提交审核发布后）        → PROD_ENV
// 使用方式：
//   1. 在云开发控制台创建两个环境（如 baby-log-dev / baby-log-prod）
//   2. 把对应环境 ID 填入下方 DEV_ENV / PROD_ENV
//   3. 同一份代码上传：开发者工具调试连 dev 库，发布正式版自动连 prod 库
// 注意：
//   - PROD_ENV 留空时，正式版会回退到 DEV_ENV（保证单环境也能正常跑）
//   - 云函数代码全部使用 cloud.DYNAMIC_CURRENT_ENV，
//     部署到哪个环境就操作哪个环境的数据库（见 cloudfunctions/ 下各函数）
// ============================================================
const DEV_ENV = 'cloud1-d9gi06a3f00988852'
const PROD_ENV = ''   // TODO: 填入你的生产环境 ID（云开发控制台 → 环境 → 环境 ID）

/**
 * 根据小程序运行版本自动选择云环境 ID
 * 获取失败或未知版本时按正式版处理（最稳妥：不会误操作 dev 数据）
 */
function resolveCloudEnv() {
  let envVersion = 'release'
  try {
    const info = wx.getAccountInfoSync()
    if (info && info.miniProgram && info.miniProgram.envVersion) {
      envVersion = info.miniProgram.envVersion // 'develop' | 'trial' | 'release'
    }
  } catch (e) {
    // 基础库过低等场景：按 release 处理
  }
  if (envVersion === 'develop' || envVersion === 'trial') {
    return { envId: DEV_ENV, envVersion }
  }
  return { envId: PROD_ENV || DEV_ENV, envVersion }
}

App({
  globalData: {
    userInfo: null,       // 当前微信用户 { nickName, avatarUrl, openid }
    openid: '',
    babyId: '',           // 当前选中宝宝 ID
    babyInfo: null,       // 当前选中宝宝详情 { babyId, name, avatar, birthDate, gender }
    babies: [],           // 当前用户可访问的所有宝宝列表
    familyRole: 'parent',
    isOnline: true,
    pendingSync: [],
    // 当前云环境信息（用于调试确认连接的是 dev 还是 prod 库）
    envVersion: 'release',
    cloudEnvId: '',
    // 云开发是否可用（环境未创建时为 false）
    cloudReady: false,
    // 开发模式：跳过云函数调用（云环境未开通时不报错）
    devMode: false
  },

  onLaunch() {
    // 自动解析当前应连接的云环境（develop/trial → dev，release → prod）
    const cloudEnv = resolveCloudEnv()
    this.globalData.envVersion = cloudEnv.envVersion
    this.globalData.cloudEnvId = cloudEnv.envId
    console.log(`[云环境] 运行版本: ${cloudEnv.envVersion} → 连接环境: ${cloudEnv.envId}`)

    // 初始化云开发（容错：环境不存在时不崩溃）
    if (!wx.cloud) {
      console.warn('当前基础库版本过低，不支持云能力')
      this.globalData.devMode = true
    } else {
      try {
        wx.cloud.init({
          env: cloudEnv.envId,
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

    // 仅在云开发就绪时获取 openid（登录态会在首页 onShow 时二次校验）
    if (this.globalData.cloudReady) {
      this.getOpenId()
    }
  },

  restoreFromStorage() {
    try {
      const openid = wx.getStorageSync('openid')
      const userInfo = wx.getStorageSync('userInfo')
      const babyId = wx.getStorageSync('babyId')
      const babyInfo = wx.getStorageSync('babyInfo')
      const babies = wx.getStorageSync('babies')
      const familyRole = wx.getStorageSync('familyRole')
      if (openid) this.globalData.openid = openid
      if (userInfo) this.globalData.userInfo = userInfo
      if (babyId) this.globalData.babyId = babyId
      if (babyInfo) this.globalData.babyInfo = babyInfo
      if (babies) this.globalData.babies = babies
      if (familyRole) this.globalData.familyRole = familyRole
    } catch (e) {
      console.warn('恢复本地缓存失败:', e)
    }
  },

  /**
   * 是否已登录（本地缓存中有 userInfo 即视为登录态）
   */
  isLoggedIn() {
    return !!(this.globalData.userInfo && this.globalData.userInfo.openid)
  },

  /**
   * 登录态校验：未登录则跳转登录页，调用方页面在 onShow 中调用
   * 返回 true 表示已登录，false 表示正在跳转
   */
  requireLogin(redirectOnFail = true) {
    if (this.isLoggedIn()) return true
    if (redirectOnFail) {
      // 避免登录页自身重复跳转
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      if (!current || current.route !== 'pages/login/login') {
        wx.reLaunch({ url: '/pages/login/login' })
      }
    }
    return false
  },

  /**
   * 保存登录用户信息到本地与 globalData
   */
  saveUserInfo(userInfo) {
    this.globalData.userInfo = userInfo
    this.globalData.openid = userInfo.openid || ''
    try {
      wx.setStorageSync('userInfo', userInfo)
      wx.setStorageSync('openid', userInfo.openid || '')
    } catch (e) {}
  },

  /**
   * 登出：清空用户与宝宝状态，跳回登录页
   */
  logout() {
    this.globalData.userInfo = null
    this.globalData.openid = ''
    this.globalData.babyId = ''
    this.globalData.babyInfo = null
    this.globalData.babies = []
    try {
      wx.removeStorageSync('userInfo')
      wx.removeStorageSync('openid')
      wx.removeStorageSync('babyId')
      wx.removeStorageSync('babyInfo')
      wx.removeStorageSync('babies')
      wx.removeStorageSync('familyRole')
    } catch (e) {}
    // 通知所有页面用户已切换
    this.eventBus.emit('babySwitched', { babyId: '', babyInfo: null })
    wx.reLaunch({ url: '/pages/login/login' })
  },

  /**
   * 设置当前宝宝，并持久化 + 广播事件
   */
  setCurrentBaby(baby) {
    if (!baby || !baby.babyId) return
    this.globalData.babyId = baby.babyId
    this.globalData.babyInfo = baby
    try {
      wx.setStorageSync('babyId', baby.babyId)
      wx.setStorageSync('babyInfo', baby)
    } catch (e) {}
    // 通知所有页面重新拉取数据
    this.eventBus.emit('babySwitched', { babyId: baby.babyId, babyInfo: baby })
  },

  /**
   * 刷新当前用户可访问的宝宝列表（从云端）
   */
  async refreshBabies() {
    if (!this.globalData.cloudReady) return []
    try {
      const res = await wx.cloud.callFunction({ name: 'listBabies', data: {} })
      if (res.result && res.result.code === 0) {
        const babies = res.result.data.babies || []
        this.globalData.babies = babies
        try { wx.setStorageSync('babies', babies) } catch (e) {}
        return babies
      }
    } catch (err) {
      console.warn('刷新宝宝列表失败:', err)
    }
    return []
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
      // getOpenId 云函数返回 { code: 0, data: { openid, appid, unionid } }
      const result = res.result || {}
      const openid = (result.data && result.data.openid) || result.openid || ''
      if (openid) {
        this.globalData.openid = openid
        wx.setStorageSync('openid', openid)
        return openid
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
