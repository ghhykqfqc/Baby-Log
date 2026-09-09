// app.js - 贝贝log 全局逻辑

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
const DEV_ENV = 'cloud1-d7gydxtyp19bc9ff0'
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

    // 游客启动：清掉「上一个登录账号」遗留的业务缓存，保证游客只见自己的本地数据
    if (!this.isLoggedIn()) {
      this.clearGuestVisibleCache()
    }

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
      // 仅「已授权登录」状态下才还原宝宝上下文；
      // 游客（无 userInfo）一律不还原 babyId/babyInfo/babies，
      // 避免「游客模式」看到上一个登录账号遗留的宝宝信息（数据隔离）
      const userInfo = wx.getStorageSync('userInfo')
      const openid = wx.getStorageSync('openid')
      if (!userInfo || !userInfo.openid || !openid) {
        this.globalData.userInfo = null
        this.globalData.openid = ''
        this.globalData.babyId = ''
        this.globalData.babyInfo = null
        this.globalData.babies = []
        return
      }
      this.globalData.userInfo = userInfo
      this.globalData.openid = openid
      const babyId = wx.getStorageSync('babyId')
      const babyInfo = wx.getStorageSync('babyInfo')
      const babies = wx.getStorageSync('babies')
      const familyRole = wx.getStorageSync('familyRole')
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
   * 登录态校验：未登录时不再强制跳登录页（「先体验、后授权」游客模式）。
   * @param {boolean} [redirectOnFail=true] 未登录时是否弹出引导 toast
   *   页面级静默判断（如游客不拉云端）请传 false，避免打扰。
   * 返回 true=已登录；false=游客（页面应保持可浏览，关键操作另行引导登录）
   */
  requireLogin(redirectOnFail = true) {
    if (this.isLoggedIn()) return true
    if (redirectOnFail) {
      // 仅做引导提示，绝不强制跳转（审核合规：先体验后授权）
      wx.showToast({ title: '登录后可永久保存数据', icon: 'none' })
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
   * 登出：清空用户与宝宝状态，回到游客模式（不再强制跳登录页）
   * 注：退出登录不删除云端数据，仅清除本地登录态与「游客可见」的业务缓存。
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
    // 游客态不可见任何已登录账号的业务数据（宝宝记录/成长/相册/预测）
    // 这些缓存在登录后会由各页面从云端重新拉取，无需保留
    this.clearGuestVisibleCache()
    // 通知所有页面用户已切换（游客模式：留在当前页，不强制跳转）
    this.eventBus.emit('babySwitched', { babyId: '', babyInfo: null })
    wx.showToast({ title: '已退出登录（本地数据保留）', icon: 'none' })
  },

  /**
   * 清除游客模式下不应可见的「账号历史」业务缓存。
   * 原则：游客自己产生的本地记录（_id 以 local_/_local 开头）予以保留
   * （它们在登录后会合并上云，属于游客本人数据）；云端拉取缓存的
   * 历史记录 / 成长 / 预测 / 相册一律清除，保证游客看到不到已登录账号的
   * 任何宝宝数据。
   */
  clearGuestVisibleCache() {
    // 1) 今日记录：仅保留本地临时记录，清掉云端缓存的历史
    try {
      const today = wx.getStorageSync('todayRecords')
      if (Array.isArray(today) && today.length > 0) {
        const own = today.filter(r => r && r._id && (String(r._id).indexOf('local_') === 0 || String(r._id).indexOf('_local') === 0))
        if (own.length > 0) {
          wx.setStorageSync('todayRecords', own)
        } else {
          wx.removeStorageSync('todayRecords')
        }
      } else {
        wx.removeStorageSync('todayRecords')
      }
    } catch (e) {}

    // 2) 成长数据：同样只保留本地临时记录
    try {
      const growth = wx.getStorageSync('growthData')
      if (Array.isArray(growth) && growth.length > 0) {
        const own = growth.filter(r => r && r._id && String(r._id).indexOf('local_') === 0)
        if (own.length > 0) {
          wx.setStorageSync('growthData', own)
        } else {
          wx.removeStorageSync('growthData')
        }
      } else {
        wx.removeStorageSync('growthData')
      }
    } catch (e) {}

    // 3) 最近记录时间戳：仅当本地仍有游客记录时保留，否则清除
    try {
      const ownToday = wx.getStorageSync('todayRecords')
      const hasOwn = Array.isArray(ownToday) && ownToday.some(r => r && r._id && String(r._id).indexOf('local_') === 0)
      if (!hasOwn) {
        wx.removeStorageSync('lastRecords')
      }
    } catch (e) {}

    // 4) 预测缓存：基于云端历史计算，直接清除（首页会用本地记录重算）
    try { wx.removeStorageSync('prediction') } catch (e) {}

    // 5) 相册按宝宝维度存储：游客不可见任何历史相册
    try {
      const info = wx.getStorageInfoSync()
      ;(info.keys || []).forEach(k => {
        if (k.indexOf('albumPhotos_') === 0) wx.removeStorageSync(k)
      })
    } catch (e) {}
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

  /**
   * 游客数据合并（登录成功后调用，幂等）：
   * openid 从游客到登录不变，游客期间写入云端的记录天然归属同一用户。
   * 这里把「本地暂存但未成功入库」的数据补写入云端：
   * 1. pendingSync 队列（云端写入失败的记录）
   * 2. 本地 todayRecords / growthData 缓存中标记 _local 的记录
   * 3. 未上传的本地相册照片（临时路径 → 云存储）
   * 返回 true 表示完成（失败不阻断登录）
   */
  async mergeGuestDataAfterLogin() {
    // 1. 同步 pendingSync 队列
    await this.syncPendingRecords()

    // 2. 本地缓存中的本地临时记录（_id 以 local_ 开头且非 pendingSync 成员）
    const { call } = require('./utils/request')
    const babyId = this.globalData.babyId || 'default'

    // 2.1 今日记录缓存（含本地生成的记录）
    try {
      const todayRecords = wx.getStorageSync('todayRecords') || []
      const pendingKeys = new Set((this.globalData.pendingSync || []).map(r => `${r.recordType}_${r.timestamp}`))
      for (const record of todayRecords) {
        const isLocal = record._id && (String(record._id).startsWith('_local') || String(record._id).startsWith('local_'))
        if (!isLocal) continue
        const key = `${record.recordType}_${record.timestamp}`
        if (pendingKeys.has(key)) continue
        try {
          await call('addRecord', {
            babyId: record.babyId || babyId,
            recordType: record.recordType,
            timestamp: record.timestamp,
            duration: record.duration || 0,
            amount: record.amount || 0,
            subType: record.subType || ''
          })
        } catch (err) {
          this.enqueuePendingSync({
            babyId: record.babyId || babyId,
            recordType: record.recordType,
            timestamp: record.timestamp,
            duration: record.duration || 0,
            amount: record.amount || 0,
            subType: record.subType || ''
          })
        }
      }
    } catch (err) {
      console.warn('游客记录合并异常:', err)
    }

    // 2.2 成长数据缓存（本地生成的)
    try {
      const growthCache = wx.getStorageSync('growthData') || []
      if (Array.isArray(growthCache) && growthCache.length > 0) {
        const cloudIds = new Set()
        try {
          const cloudData = await call('getGrowthData', { babyId })
          ;((cloudData && cloudData.records) || []).forEach(r => cloudIds.add(r._id))
        } catch (e) { /* 忽略 */ }
        for (const record of growthCache) {
          // 非本地临时 ID 且云端已有 → 跳过（避免重复）
          if (record._id && !String(record._id).startsWith('local_') && cloudIds.has(record._id)) continue
          try {
            await call('addGrowthData', {
              babyId,
              height: record.height,
              weight: record.weight,
              measureDate: record.measureDate,
              headCircumference: record.headCircumference || null
            })
          } catch (e) {
            console.warn('成长数据合并失败（保留本地）:', e && e.message)
          }
        }
      }
    } catch (err) {
      console.warn('游客成长数据合并异常:', err)
    }

    // 2.3 相册：游客期本地上传的照片（临时路径）→ 上传云存储并更新 babies.albumPhotos
    try {
      const helper = require('./utils/storage')
      const babyIdForAlbum = this.globalData.babyId || 'default'
      const albumKey = helper.albumKey(babyIdForAlbum)
      const album = wx.getStorageSync(albumKey) || []
      let changed = false
      for (let i = 0; i < album.length; i++) {
        const p = album[i]
        // 已是 cloud:// 或 http(s) 的不处理
        if (!p.src || p.src.indexOf('cloud://') === 0 || /^https?:\/\//.test(p.src)) continue
        try {
          const up = await wx.cloud.uploadFile({
            cloudPath: `album/${babyIdForAlbum}/${Date.now()}_${i}.jpg`,
            filePath: p.src
          })
          if (up && up.fileID) {
            album[i] = { ...p, src: up.fileID, id: up.fileID }
            changed = true
          }
        } catch (e) {
          console.warn('相册照片上传失败（保留本地路径）:', e)
        }
      }
      if (changed) {
        try { wx.setStorageSync(albumKey, album) } catch (e) {}
        // 同步到云端 babies 列表
        try {
          const albumSrcs = album.map(p => p.src)
          await call('saveBabyInfo', {
            babyId: babyIdForAlbum,
            name: (this.globalData.babyInfo && this.globalData.babyInfo.name) || '',
            albumPhotos: albumSrcs
          })
        } catch (e) {
          console.warn('相册云端同步失败:', e)
        }
      }
    } catch (err) {
      console.warn('游客相册合并异常:', err)
    }

    // 2.4 游客日程缓存（schedules_guest_*）→ 合并到当前宝宝的云端日程
    // 游客在「游客模式」下新增的日程只存本机，登录后一并上云，保证数据不丢
    try {
      const { call } = require('./utils/request')
      const schedulePrefix = 'schedules_guest_'
      const guestKeys = []
      try {
        const info = wx.getStorageInfoSync()
        ;(info.keys || []).forEach(k => {
          if (k.indexOf(schedulePrefix) === 0) guestKeys.push(k)
        })
      } catch (e) {}

      for (const key of guestKeys) {
        let cached = []
        try { cached = wx.getStorageSync(key) || [] } catch (e) {}
        const remain = []
        for (const s of cached) {
          if (!s || !s._id || String(s._id).indexOf('local_') !== 0) {
            remain.push(s) // 非本地临时记录（可能是云端返回的），保留
            continue
          }
          // 游客日程 → 云端 addSchedule（若已是成员自动放行；默认宝宝也放行）
          try {
            await call('addSchedule', {
              babyId: s.babyId || babyId,
              title: s.title,
              category: s.category || 'other',
              date: s.date,
              startTime: s.startTime || '',
              endTime: s.endTime || '',
              location: s.location || '',
              note: s.note || '',
              important: !!s.important
            })
            // 同步成功：标记待删除（合并完成后统一清理游客缓存）
            s._merged = true
          } catch (e) {
            // 失败保留，等下次登录再试
            console.warn('游客日程合并失败（保留本地）:', e && e.message)
            remain.push(s)
          }
        }
        if (remain.length > 0) {
          try { wx.setStorageSync(key, remain) } catch (e) {}
        } else {
          try { wx.removeStorageSync(key) } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('游客日程合并异常:', err)
    }

    return true
  },

  /** 入队待同步（兼容 pendingSync 别名） */
  enqueuePendingQueue(record) {
    this.enqueuePendingSync(record)
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
