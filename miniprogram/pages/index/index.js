// pages/index/index.js - 首页（天气皮肤 + 预测卡 + 相册轮播 + 单行记录）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatElapsedSmart, formatRemainingSmart, formatDurationSmart } = require('../../utils/time')
const { predictAll } = require('../../utils/predict')
const { RECORD_TYPES } = require('../../utils/constants')

// 入睡后超过此时间（毫秒）仍未结束，视为漏记结束，自动复位
const SLEEP_RESET_MS = 12 * 60 * 60 * 1000

// 天气缓存有效期（30 分钟）
const WEATHER_CACHE_MS = 30 * 60 * 1000

// 相册最多张数
const ALBUM_MAX = 9

// ===== 每日育娃小贴士库（按日期取模轮换，温柔有用的育儿知识点） =====
const DAILY_TIPS = [
  { short: '辅食从单一食材开始，观察3天', full: '初次添加辅食建议从单一食材（如高铁米粉）开始，每次只添加一种新食物，观察 2-3 天，确认无过敏反应后再尝试下一种。' },
  { short: '宝宝清醒信号：揉眼、打哈欠',  full: '当宝宝开始揉眼睛、打哈欠、目光发直时，就是困了。此时应尽快安排入睡，错过窗口期反而更难睡着。' },
  { short: '喂奶后记得拍嗝',  full: '每次喂奶后竖抱宝宝 10-15 分钟，轻拍后背帮助排出胃里的空气，能有效减少吐奶和胀气，拍出嗝后再放下。' },
  { short: '爬行期清空地面低矮物',  full: '宝宝学爬后活动范围迅速变大，地面上的小物件、电线、桌角都要处理好，给宝宝一个安全探索的空间。' },
  { short: '多和宝宝说话，语言黄金期',  full: '从出生起就要多与宝宝说话，哪怕他听不懂。词汇刺激是语言发展的基础，每天读绘本、唱歌、交流都很重要。' },
  { short: '发热时优先观察精神状态',  full: '宝宝发热时，先看精神状态：吃奶、玩耍正常则先物理降温观察；若精神差、嗜睡、高热不退或小于 3 个月发热，请及时就医。' },
  { short: '洗澡水温 37℃ 左右',  full: '宝宝洗澡水温略高于体温（37-38℃），不能用手背判断，先用手肘试温，全程托稳头颈。' },
  { short: '按时体检，别错过疫苗',  full: '按儿保时间表定期体检，监测身高体重与发育里程碑；疫苗按本接种，接种后观察半小时再离开。' },
  { short: '出生 6 个月内纯母乳喂养',  full: '世卫组织建议 0-6 个月纯母乳喂养，6 个月后继续母乳并适时添加辅食。母乳是宝宝最好的口粮。' },
  { short: '宝宝哭闹先排除基本需求',  full: '新手妈妈别慌：哭闹先依次排查「饿、困、尿布、热、胀气」。常见原因逐个排除，多数时候宝宝很快就安静了。' },
  { short: '多趴是前庭与手臂锻炼',  full: '清醒时多让宝宝趴着（tummy time），有助于颈背肌、手眼协调和前庭发育，也是后续爬行的基础，从每天 1-2 分钟开始。' },
  { short: '哭闹≠一定是饿了',  full: '哭闹有多种原因：饥饿、困倦、尿布、过热、受惊等。先观察喂养情况与便尿，别一哭就喂，避免过度喂养。' }
]

// 天气分类 → 展示文案
const WEATHER_LABELS = {
  sunny: '☀️ 晴',
  cloudy: '⛅ 多云',
  rain: '🌧 雨',
  snow: '❄️ 雪',
  wind: '🌬 有风'
}

// 天气分类 → 页面背景色（同步导航栏/窗口背景）
const WEATHER_BG = {
  sunny: '#D8EDF8',
  cloudy: '#E4E7E6',
  rain: '#DCE5EB',
  snow: '#E4EBF1',
  wind: '#EFEAD9'
}

Page({
  data: {
    babyInfo: {},
    userInfo: {},       // 当前微信用户 { nickName, avatarUrl, openid }
    babies: [],         // 当前用户可访问的所有宝宝
    currentBabyId: '',  // 用于面板高亮当前宝宝
    lastRecords: { feed: 0, diaper: 0, sleep: 0 },
    // 每张卡片的双行文案：elapsed（距上次）+ next（预计下次）
    cardTexts: {
      feed:   { elapsed: '--', next: '' },
      diaper: { elapsed: '--', next: '' },
      sleep:  { elapsed: '--', next: '' }
    },
    // 三栏记录卡片的预测信息仍保留在 cardTexts（距上次 + 预计下次）
    // 原预测卡区位置改为展示每日育娃小贴士（简短 + 点击展开完整 + 复制）
    showTipFull: false,    // 是否展开完整贴士
    dailyTipShort: '',     // 贴士卡里的短文案
    dailyTipFull: '',      // 完整的贴士内容
    // 天气皮肤
    weatherClass: 'sunny',
    weatherText: '',
    // 宝宝相册
    albumPhotos: [],
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
    showSleepSheet: false,     // 睡眠回忆记录面板（长按触发）
    // 喂奶量弹层（长按触发）
    showFeedSheet: false,
    feedAmountInput: '',
    // 喂奶量弹层：是否显示自定义输入框（点击「自定义」标签后显示）
    feedCustomMode: false,
    // 当前选中的快捷喂奶量（ml），未选为 0
    feedQuickAmount: 0,
    // 喂奶量快捷选项（两排，单位 ml）
    feedQuickOptions: [30, 60, 90, 120, 150, 180, 210, 240],
    // 尿布类型弹层（长按触发）
    showDiaperSheet: false,
    diaperTypeInput: '',
    // 宝宝管理面板
    showBabySheet: false,
    formMode: '',         // '' | 'create' | 'join' | 'success'
    formAvatar: '',
    formName: '',
    formBirthDate: '',
    formGender: '',
    joinBabyId: '',
    joinBabyCode: '',
    newBabyId: '',
    newBabyCode: '',
    // 照片编辑面板
    showPhotoEditSheet: false,
    currentAlbumIndex: 0,        // 当前 swiper 索引
    photoEditCurrent: {          // 当前编辑的照片 { src, tag, id }
      src: '',
      tag: '',
      id: ''
    },
    // 上传裁剪（固定 4:3 裁剪框）
    showUploadCropper: false,
    uploadRawPath: '',          // 待裁剪原图
    cropStageSize: 300,         // 裁剪舞台边长（px，onLoad 计算）
    cropImgW: 0, cropImgH: 0,   // 图片显示尺寸
    cropImgX: 0, cropImgY: 0,   // 图片在舞台位置
    cropBoxW: 300,              // 裁剪框宽（4:3 → 宽 = 舞台宽）
    cropBoxH: 225,              // 裁剪框高（舞台 * 0.75）
    touchStartX: 0, touchStartY: 0,
    touchStartImgX: 0, touchStartImgY: 0,
    // 上传标签选择（默认当前宝宝昵称）
    uploadTag: ''                // 标签 = 宝宝昵称
  },

  _timer: null,
  _sleepTick: null,
  _allRecords: [],   // 用于预测计算的完整记录

  onLoad() {
    app.eventBus.on('recordsUpdated', this.refreshFromCache.bind(this))
    app.eventBus.on('babySwitched', this.onBabySwitched.bind(this))
    this.updateTodayText()
    this.restoreSleepState()
    this.initDailyTip()
    // 初始化上传裁剪舞台尺寸（4:3 裁剪框）
    try {
      const sys = wx.getSystemInfoSync()
      const stage = Math.min(320, Math.floor(sys.windowWidth * 0.9))
      this.setData({
        cropStageSize: stage,
        cropBoxW: stage,
        cropBoxH: Math.floor(stage * 0.75)
      })
    } catch (e) {}
  },

  onShow() {
    // 登录态校验：未登录直接跳登录页
    if (!app.requireLogin()) return

    this.setData({ cloudReady: app.globalData.cloudReady })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/index/index')
    }
    // 同步当前用户与宝宝信息到视图
    this.syncGlobalToView()
    this.loadAlbum()
    this.refreshFromCache()
    this.loadWeather()
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
      // 异步刷新宝宝列表（不阻塞渲染）
      app.refreshBabies().then(babies => {
        // 自愈：补齐当前宝宝的空昵称（见 syncGlobalToView）
        const healed = (babies || []).map(b => {
          if (!b.name && b.babyId === app.globalData.babyId && app.globalData.babyInfo && app.globalData.babyInfo.name) {
            return { ...b, name: app.globalData.babyInfo.name }
          }
          return b
        })
        this.setData({ babies: healed, currentBabyId: app.globalData.babyId })
        // 如果当前没有选中宝宝且有宝宝列表，自动选中第一个
        if (!app.globalData.babyId && healed.length > 0) {
          app.setCurrentBaby(healed[0])
        }
        // 云端自愈：如果当前宝宝在 babies 里 name 为空但在 babyInfo 里有名字，
        // 说明历史 bug 曾把云端 name 清空，静默修复一次（避免换设备后仍显示未命名）
        this.healBabyNameIfNeeded()
      }).catch(() => {})
    }
    this._timer = setInterval(() => this.updateCardTexts(), 30000)
    this.startSleepTick()
  },

  /**
   * 把 globalData 中的 userInfo/babies/babyInfo 同步到视图
   * 数据自愈：若 babies 中当前宝宝的 name 为空（历史 bug 曾把云端 name 清空），
   * 用 babyInfo.name 补上，保证列表/标签/管理面板显示正确昵称
   */
  syncGlobalToView() {
    const babies = (app.globalData.babies || []).map(b => {
      if (!b.name && b.babyId === app.globalData.babyId && app.globalData.babyInfo && app.globalData.babyInfo.name) {
        return { ...b, name: app.globalData.babyInfo.name }
      }
      return b
    })
    // 若补齐过，回写 globalData，让全局状态保持一致
    if (JSON.stringify(babies) !== JSON.stringify(app.globalData.babies || [])) {
      app.globalData.babies = babies
      try { wx.setStorageSync('babies', babies) } catch (e) {}
    }
    this.setData({
      userInfo: app.globalData.userInfo || {},
      babies,
      babyInfo: app.globalData.babyInfo || {},
      currentBabyId: app.globalData.babyId || ''
    })
  },

  /**
   * 收到宝宝切换事件时刷新本页
   */
  onBabySwitched(payload) {
    this.syncGlobalToView()
    this.loadAlbum()
    this.refreshFromCache()
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
    }
  },

  onHide() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.stopSleepTick()
    this.stopRainAnimation()
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
    this.stopSleepTick()
    this.stopRainAnimation()
    app.eventBus.off('recordsUpdated', this.refreshFromCache)
    app.eventBus.off('babySwitched', this.onBabySwitched)
  },

  updateTodayText() {
    const d = new Date()
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    this.setData({ todayText: `${d.getMonth() + 1}/${d.getDate()} 周${week}` })
  },

  // ============================================
  // 每日育娃小贴士
  // ============================================

  /**
   * 按日期取模选择当天小贴士（每天换一条）
   * 标题（缩略）与完整文案统一带“每日育娃小贴士”标识
   */
  initDailyTip() {
    const now = new Date()
    const dayIndex = now.getFullYear() * 1000 + now.getMonth() * 50 + now.getDate()
    const tip = DAILY_TIPS[dayIndex % DAILY_TIPS.length]
    this.setData({
      // 贴士卡缩略文案
      dailyTipShort: tip.short,
      // 完整贴士：正文末尾追加品牌尾注（与正文间只换一行）
      dailyTipFull: `${tip.full}\n--「每日育娃小贴士」`,
      showTipFull: false
    })
  },

  /**
   * 展开/收起完整贴士
   */
  showDailyTip() {
    this.setData({ showTipFull: !this.data.showTipFull })
  },

  /**
   * 复制今日贴士到剪贴板（复制完整正文 + 尾注）
   */
  copyDailyTip() {
    const tip = this.data.dailyTipFull || this.data.dailyTipShort
    if (!tip) return
    wx.setClipboardData({
      data: tip,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  // ============================================
  // 天气皮肤
  // ============================================

  /**
   * 加载天气：本地缓存优先（30 分钟有效），否则调云函数
   */
  async loadWeather() {
    let weather = null
    try {
      const cached = storage.get(storage.CACHE_KEYS.WEATHER_INFO)
      if (cached && (Date.now() - cached.ts) < WEATHER_CACHE_MS && cached.category) {
        weather = cached
      }
    } catch (e) {}

    if (!weather) {
      if (app.globalData.cloudReady) {
        try {
          const res = await call('getWeather', {})
          if (res && res.category) {
            weather = { ...res, ts: Date.now() }
            storage.set(storage.CACHE_KEYS.WEATHER_INFO, weather)
          }
        } catch (err) {
          console.warn('获取天气失败，使用默认晴天皮肤:', (err && err.message) || err)
        }
      }
      if (!weather) {
        // 兜底：默认晴天，短缓存避免每次进页都请求
        weather = { category: 'sunny', temp: '', ts: Date.now() - WEATHER_CACHE_MS + 5 * 60 * 1000 }
      }
    }

    this.applyWeather(weather)
  },

  applyWeather(weather) {
    const category = WEATHER_LABELS[weather.category] ? weather.category : 'sunny'
    const label = WEATHER_LABELS[category]
    const temp = (weather.temp !== undefined && weather.temp !== null && weather.temp !== '') ? ` ${Math.round(weather.temp)}°` : ''
    const d = new Date()
    this.setData({
      weatherClass: category,
      weatherText: `${label}${temp} · ${d.getMonth() + 1}/${d.getDate()}`
    })
    try {
      wx.setBackgroundColor({ backgroundColor: WEATHER_BG[category] })
    } catch (e) {}
    // 雨天启动 Canvas 雨滴动画；其它天气停止
    if (category === 'rain') {
      // 延迟一帧，等 wx:if 渲染出 canvas 节点
      setTimeout(() => this.startRainAnimation(), 50)
    } else {
      this.stopRainAnimation()
    }
  },

  // ============================================
  // 雨天 Canvas 动画（真实雨滴 + 底部涟漪）
  // ============================================
  _rainRAF: null,
  _rainCanvas: null,
  _rainCtx: null,
  _rainDrops: [],
  _ripples: [],
  _rainDPR: 1,

  /**
   * 启动雨滴动画：用 Canvas 2d 直接绘制，不使用 setData，性能友好
   * 设计：
   *  - 雨滴：随机长度（10-22px）、随机倾斜角度（约 100-115 度）、随机速度
   *  - 落地：到达底部约 88% 高度时生成涟漪并重置雨滴
   *  - 涟漪：圆环扩散 + 淡出
   */
  startRainAnimation() {
    this.stopRainAnimation()
    const query = wx.createSelectorQuery()
    query.select('#rainCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // canvas 还没渲染（可能弹层打开中），下次再启动
        return
      }
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getSystemInfoSync().pixelRatio || 1
      const w = res[0].width
      const h = res[0].height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      this._rainCanvas = canvas
      this._rainCtx = ctx
      this._rainDPR = dpr

      // 初始化雨滴：数量根据屏幕宽度自适应（约 70-120 个）
      const count = Math.min(120, Math.max(70, Math.floor(w / 4)))
      this._rainDrops = []
      for (let i = 0; i < count; i++) {
        this._rainDrops.push(this._spawnRainDrop(w, h, true))
      }
      this._ripples = []

      // 动画循环（使用 canvas.requestAnimationFrame）
      const tick = () => {
        this._renderRainFrame(ctx, w, h)
        this._rainRAF = canvas.requestAnimationFrame(tick)
      }
      this._rainRAF = canvas.requestAnimationFrame(tick)
    })
  },

  /**
   * 生成一个雨滴对象（随机长度、角度、速度、位置）
   * initial=true 时 y 随机分布全屏（避免集中从顶部一起落下）
   */
  _spawnRainDrop(w, h, initial) {
    // 倾斜角度：100-115 度（接近垂直，略向右倾斜）
    const angleDeg = 100 + Math.random() * 15
    const angleRad = (angleDeg * Math.PI) / 180
    // 长度：10-22px（短线/长线混合，更像真实雨）
    const len = 10 + Math.random() * 12
    // 速度：6-11 px/帧
    const speed = 6 + Math.random() * 5
    return {
      x: Math.random() * (w + 100) - 50,
      y: initial ? Math.random() * h : -len - Math.random() * 60,
      len,
      angle: angleRad,
      // vx, vy 由角度和速度推导
      vx: Math.cos(angleRad) * speed,
      vy: Math.sin(angleRad) * speed,
      opacity: 0.25 + Math.random() * 0.35
    }
  },

  /**
   * 渲染一帧：雨滴下落 + 涟漪扩散
   */
  _renderRainFrame(ctx, w, h) {
    ctx.clearRect(0, 0, w, h)
    const groundY = h * 0.9 // 涟漪触发线（接近底部）

    // 绘制雨滴
    ctx.lineCap = 'round'
    for (let i = 0; i < this._rainDrops.length; i++) {
      const d = this._rainDrops[i]
      const x2 = d.x + Math.cos(d.angle) * d.len
      const y2 = d.y + Math.sin(d.angle) * d.len
      // 渐变线条：顶部淡，底部浓，更真实
      const grad = ctx.createLinearGradient(d.x, d.y, x2, y2)
      grad.addColorStop(0, `rgba(180, 200, 226, 0)`)
      grad.addColorStop(1, `rgba(180, 200, 226, ${d.opacity})`)
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(x2, y2)
      ctx.stroke()

      // 更新位置
      d.x += d.vx
      d.y += d.vy

      // 落地：生成涟漪并重置雨滴
      if (d.y > groundY + Math.random() * (h - groundY) * 0.6) {
        // 仅有一定概率生成涟漪（避免过密），并且只在地面区域内
        if (Math.random() < 0.5 && d.x > 0 && d.x < w) {
          this._ripples.push({
            x: d.x,
            y: Math.min(h - 2, d.y),
            r: 1,
            maxR: 6 + Math.random() * 8,
            opacity: 0.4
          })
        }
        // 重置雨滴到顶部
        const fresh = this._spawnRainDrop(w, h, false)
        this._rainDrops[i] = fresh
      }
      // 超出右边界也重置
      if (d.x > w + 60) {
        const fresh = this._spawnRainDrop(w, h, false)
        fresh.x = -50
        this._rainDrops[i] = fresh
      }
    }

    // 绘制并更新涟漪
    for (let i = this._ripples.length - 1; i >= 0; i--) {
      const rp = this._ripples[i]
      ctx.strokeStyle = `rgba(190, 210, 232, ${rp.opacity})`
      ctx.lineWidth = 1
      ctx.beginPath()
      // 椭圆涟漪（横向稍扁，更像水面被击打的视觉效果）
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.4, 0, 0, Math.PI * 2)
      ctx.stroke()
      rp.r += 0.6
      rp.opacity -= 0.025
      if (rp.opacity <= 0 || rp.r >= rp.maxR) {
        this._ripples.splice(i, 1)
      }
    }
  },

  /**
   * 停止雨滴动画并清理（页面隐藏/切到非雨天时调用）
   */
  stopRainAnimation() {
    if (this._rainRAF && this._rainCanvas) {
      try { this._rainCanvas.cancelAnimationFrame(this._rainRAF) } catch (e) {}
    }
    this._rainRAF = null
    this._rainCanvas = null
    this._rainCtx = null
    this._rainDrops = []
    this._ripples = []
  },

  /**
   * 弹层关闭后若仍是雨天，延迟 ~120ms 重启 canvas 动画
   * （canvas 被 wx:if 卸载又重新挂载，需要等节点重建后再启动）
   */
  _resumeRainIfNeeded() {
    if (this.data.weatherClass !== 'rain') return
    setTimeout(() => this.startRainAnimation(), 120)
  },

  // ============================================
  // 宝宝封面相册
  // ============================================

loadAlbum(babyId) {
    const key = storage.albumKey(babyId || app.globalData.babyId || 'default')
    const album = storage.get(key) || []
    this.setData({ albumPhotos: album })
  },

  /**
   * 上传照片到相册：先选图 → 固定 4:3 裁剪 → 选择标签 → 上传
   */
  addAlbumPhoto() {
    const remain = ALBUM_MAX - this.data.albumPhotos.length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${ALBUM_MAX} 张`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        this.openUploadCropper(file.tempFilePath)
      },
      fail: () => {}
    })
  },

  /**
   * 获取当前宝宝昵称（多级兜底，防止缓存被历史 bug 清空后取到空名）
   * 优先级：babies 列表 → globalData.babyInfo → 本地缓存 babyInfo
   */
  getCurrentBabyName() {
    const babies = app.globalData.babies || []
    const current = babies.find(b => b.babyId === app.globalData.babyId)
    if (current && current.name) return current.name
    if (app.globalData.babyInfo && app.globalData.babyInfo.name) return app.globalData.babyInfo.name
    const cached = storage.get(storage.CACHE_KEYS.BABY_INFO)
    return (cached && cached.name) || ''
  },

  /**
   * 云端自愈：若当前宝宝在 babies 列表里 name 为空、但本地 babyInfo 有名字
   * （历史 bug：保存相册时 saveBabyInfo 把云端 name 清空），用本地名字静默修复云端一条，
   * 每宝宝只修复一次（_healedBabyId 去重），保证换设备/清缓存后仍显示正确昵称
   */
  healBabyNameIfNeeded() {
    const babyId = app.globalData.babyId
    if (!babyId || this._healedBabyId === babyId || !app.globalData.cloudReady) return
    const current = (app.globalData.babies || []).find(b => b.babyId === babyId)
    const localName = (app.globalData.babyInfo && app.globalData.babyInfo.name) || ''
    // 仅在「 babies 里确实为空 / 缺失，但本地有名字」时修复
    if ((!current || !current.name) && localName) {
      this._healedBabyId = babyId
      call('saveBabyInfo', { babyId, name: localName }).then((data) => {
        this._absorbNewBabyId(data)
        app.refreshBabies().then(() => this.syncGlobalToView()).catch(() => {})
      }).catch(() => { this._healedBabyId = '' })
    }
  },

  /**
   * 吸收 saveBabyInfo 返回的（可能）新 babyId：
   * 历史版本可能有 babyId='default' 或云端不存在的 ID，云函数会自动生成新 ID 并返回。
   * 这里把真实 ID 同步到 globalData + 本地缓存，保证后续记录写入正确的宝宝名下
   */
  _absorbNewBabyId(data) {
    if (!data || !data.babyId) return
    if (data.babyId === app.globalData.babyId) return
    // 仅当返回了新 ID 且原 id 是 default/占位时才吸收，防止异常跳变
    const oldId = app.globalData.babyId
    if (oldId && oldId !== 'default' && !data.wasDefaultPlaceholder) return
    app.globalData.babyId = data.babyId
    app.globalData.babyInfo = { ...(app.globalData.babyInfo || {}), ...data }
    try {
      wx.setStorageSync('babyId', data.babyId)
      wx.setStorageSync('babyInfo', app.globalData.babyInfo)
    } catch (e) {}
    // 宝宝列表里也替换
    const babies = (app.globalData.babies || []).map(b => b.babyId === oldId ? { ...b, ...data } : b)
    app.globalData.babies = babies
    try { wx.setStorageSync('babies', babies) } catch (e) {}
    // 相册缓存迁移：旧 default 键 → 新 ID 键（照片标签仍可用）
    if (oldId && oldId !== data.babyId) {
      try {
        const oldKey = storage.albumKey(oldId)
        const newKey = storage.albumKey(data.babyId)
        const oldAlbum = storage.get(oldKey)
        if (Array.isArray(oldAlbum) && oldAlbum.length > 0 && !storage.get(newKey)) {
          storage.set(newKey, oldAlbum)
        }
        storage.remove(oldKey)
      } catch (e) {}
    }
    this.syncGlobalToView()
  },

  /**
   * 打开上传裁剪（固定 4:3 裁剪框）
   */
  openUploadCropper(path) {
    // 默认标签 = 当前宝宝昵称（多级兜底取真实名字）
    const defaultTag = this.getCurrentBabyName()
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const stage = this.data.cropStageSize
        // 图片完整放入舞台内，等比缩放
        let w = info.width, h = info.height
        if (w > stage || h > stage) {
          const ratio = Math.min(stage / w, stage / h)
          w = Math.floor(w * ratio)
          h = Math.floor(h * ratio)
        }
        this.setData({
          showUploadCropper: true,
          uploadRawPath: path,
          uploadTag: defaultTag,
          cropImgW: w, cropImgH: h,
          cropImgX: Math.floor((stage - w) / 2),
          cropImgY: Math.floor((stage - h) / 2)
        })
      },
      fail: () => {
        // 取不到信息时用默认舞台大小
        this.setData({
          showUploadCropper: true,
          uploadRawPath: path,
          uploadTag: defaultTag,
          cropImgW: 200, cropImgH: 200,
          cropImgX: 50, cropImgY: 50
        })
      }
    })
  },

  // ===== 上传裁剪触摸 =====
  onCropUpTouchStart(e) {
    if (e.touches.length === 1) {
      this.setData({
        touchStartX: e.touches[0].clientX,
        touchStartY: e.touches[0].clientY,
        touchStartImgX: this.data.cropImgX,
        touchStartImgY: this.data.cropImgY
      })
    }
  },

  onCropUpTouchMove(e) {
    if (e.touches.length !== 1) return
    const dx = e.touches[0].clientX - this.data.touchStartX
    const dy = e.touches[0].clientY - this.data.touchStartY
    this.setData({
      cropImgX: this.data.touchStartImgX + dx,
      cropImgY: this.data.touchStartImgY + dy
    })
  },

  onCropUpTouchEnd() {},

  cancelUploadCropper() {
    this.setData({ showUploadCropper: false, uploadRawPath: '' })
    this._resumeRainIfNeeded()
  },

  /**
   * 确认裁剪：用页面内隐藏 canvas 导出 4:3 图片
   * 若处于"替换照片"模式（_replaceMode=true）则替换当前照片，否则新增
   */
  confirmUploadCropper() {
    const { uploadRawPath, cropImgW, cropImgH, cropImgX, cropImgY, cropBoxW, cropBoxH, cropStageSize, uploadTag } = this.data

    const query = wx.createSelectorQuery()
    query.select('#uploadCropCanvas')
      .fields({ node: true })
      .exec((res) => {
        // 降级：无 canvas 时直接用原图继续
        if (!res || !res[0] || !res[0].node) {
          this.afterCropped(uploadRawPath, uploadTag)
          return
        }

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const outputW = 800, outputH = 600   // 4:3 输出
        canvas.width = outputW
        canvas.height = outputH

        const img = canvas.createImage()
        img.onload = () => {
          // 把裁剪框映射回原图坐标（裁剪框居于舞台中央）
          const ratioX = img.width / cropImgW
          const ratioY = img.height / cropImgH
          const cropLeft = (cropStageSize - cropBoxW) / 2
          const cropTop = (cropStageSize - cropBoxH) / 2
          const sx = (cropLeft - cropImgX) * ratioX
          const sy = (cropTop - cropImgY) * ratioY
          const sw = cropBoxW * ratioX
          const sh = cropBoxH * ratioY

          ctx.clearRect(0, 0, outputW, outputH)
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputW, outputH)

          wx.canvasToTempFilePath({
            canvas,
            x: 0, y: 0,
            width: outputW,
            height: outputH,
            destWidth: outputW,
            destHeight: outputH,
            fileType: 'jpg',
            quality: 0.9,
            success: (r) => {
              this.afterCropped(r.tempFilePath, uploadTag)
            },
            fail: () => {
              this.afterCropped(uploadRawPath, uploadTag)
            }
          })
        }
        img.onerror = () => {
          this.afterCropped(uploadRawPath, uploadTag)
        }
        img.src = uploadRawPath
      })
  },

  /**
   * 裁剪完成后分发：新增 or 替换
   */
  async afterCropped(croppedPath, tag) {
    if (this._replaceMode) {
      // 替换模式：上传新图并替换当前照片
      await this.doReplacePhoto(croppedPath, tag)
    } else {
      // 新增模式：上传并追加
      await this.closeModalCropperAndUpload(croppedPath, tag)
    }
  },

  /**
   * 执行"替换当前照片"：上传新图 → 替换 albumPhotos 中对应项
   */
  async doReplacePhoto(croppedPath, tag) {
    const { photoEditCurrent, albumPhotos } = this.data
    this._replaceMode = false
    this.setData({ showUploadCropper: false, uploadRawPath: '' })

    wx.showLoading({ title: '替换中...' })
    const babyId = app.globalData.babyId || 'default'
    let finalSrc = croppedPath
    let finalId = `local_${Date.now()}`

    if (app.globalData.cloudReady) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `album/${babyId}/${Date.now()}_r.jpg`,
          filePath: croppedPath
        })
        if (up && up.fileID) {
          finalSrc = up.fileID
          finalId = up.fileID
        }
      } catch (err) {
        console.warn('替换照片上传失败，暂用本地路径:', (err && err.errMsg) || err)
      }
    }

    // 更新对应照片
    const index = albumPhotos.findIndex(p => p.id === photoEditCurrent.id)
    const finalTag = tag || photoEditCurrent.tag || ''
    const updated = albumPhotos.slice()
    if (index >= 0) {
      // 删除旧云文件
      if (String(updated[index].id).startsWith('cloud://')) {
        wx.cloud.deleteFile({ fileList: [updated[index].id] }).catch(() => {})
      }
      updated[index] = { ...updated[index], src: finalSrc, id: finalId, tag: finalTag }
    } else {
      updated.push({ id: finalId, src: finalSrc, tag: finalTag })
    }

    storage.set(storage.albumKey(babyId || app.globalData.babyId), updated)
    this.setData({ albumPhotos: updated })

    if (app.globalData.cloudReady) {
      try {
        await call('saveBabyInfo', {
          babyId,
          name: this.getCurrentBabyName(),
          albumPhotos: updated.map(p => p.src)
        }).then((data) => this._absorbNewBabyId(data))
      } catch (err) {
        console.warn('相册云端更新失败:', (err && err.message) || err)
      }
    }
    wx.hideLoading()
    wx.showToast({ title: '已替换', icon: 'success' })
  },

  /**
   * 关闭裁剪面板并执行上传（带标签）—— 新增模式
   */
  async closeModalCropperAndUpload(croppedPath, tag) {
    this.setData({ showUploadCropper: false, uploadRawPath: '' })

    wx.showLoading({ title: '添加中...' })
    const babyId = app.globalData.babyId || 'default'
    let uploaded = null

    // 云可用：上传换取永久 fileID；否则退化为本地临时路径
    if (app.globalData.cloudReady) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `album/${babyId}/${Date.now()}.jpg`,
          filePath: croppedPath
        })
        if (up && up.fileID) {
          uploaded = { id: up.fileID, src: up.fileID }
        }
      } catch (err) {
        console.warn('相册照片上传失败，暂用本地路径:', (err && err.errMsg) || err)
      }
    }
    if (!uploaded) {
      uploaded = { id: `local_${Date.now()}`, src: croppedPath }
    }

    // 标签：默认当前宝宝昵称（已由 openUploadCropper 设置），或用户选择的其他宝宝昵称
    uploaded.tag = tag || this.getCurrentBabyName()

    const albumPhotos = this.data.albumPhotos.concat([uploaded]).slice(0, ALBUM_MAX)
    storage.set(storage.albumKey(babyId || app.globalData.babyId), albumPhotos)
    this.setData({ albumPhotos })

    // 云端持久化（babies.albumPhotos），失败不影响本地使用
    if (app.globalData.cloudReady) {
      try {
        await call('saveBabyInfo', {
          babyId,
          name: this.getCurrentBabyName(),
          albumPhotos: albumPhotos.map(p => p.src)
        }).then((data) => this._absorbNewBabyId(data))
      } catch (err) {
        console.warn('相册云端保存失败:', (err && err.message) || err)
      }
    }

    wx.hideLoading()
    wx.showToast({ title: '已添加', icon: 'success' })
  },

  /**
   * 上传动画裁剪标签选择
   */
  selectUploadTag(e) {
    this.setData({ uploadTag: e.currentTarget.dataset.tag })
  },

  /**
   * 长按删除相册照片（保留，编辑面板内也有删除入口）
   */
  async removeAlbumPhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const target = this.data.albumPhotos[index]
    if (!target) return

    const { confirm } = await wx.showModal({
      title: '删除照片',
      content: '确定从相册删除这张照片吗？',
      confirmColor: '#E8554E'
    }).catch(() => ({ confirm: false }))
    if (!confirm) return

    const albumPhotos = this.data.albumPhotos.filter((_, i) => i !== index)
    storage.set(storage.albumKey(app.globalData.babyId), albumPhotos)
    this.setData({ albumPhotos })

    // 删除云文件 + 更新云端相册列表
    if (app.globalData.cloudReady) {
      if (String(target.id).startsWith('cloud://')) {
        wx.cloud.deleteFile({ fileList: [target.id] }).catch(() => {})
      }
      try {
        await call('saveBabyInfo', {
          babyId: app.globalData.babyId || 'default',
          name: this.getCurrentBabyName(),
          albumPhotos: albumPhotos.map(p => p.src)
        }).then((data) => this._absorbNewBabyId(data))
      } catch (err) {
        console.warn('相册云端更新失败:', (err && err.message) || err)
      }
    }
  },

  // ============================================
  // 照片编辑面板（替换 / 标签 / 删除）
  // ============================================

  /**
   * swiper 滑动时记录当前索引
   */
  onAlbumChange(e) {
    this.setData({ currentAlbumIndex: e.detail.current })
  },

  /**
   * 点击右上角编辑按钮（✏️）：打开编辑面板
   */
  showPhotoEdit() {
    const { albumPhotos, currentAlbumIndex } = this.data
    const current = albumPhotos[currentAlbumIndex] || albumPhotos[0]
    if (!current) return
    this.setData({
      showPhotoEditSheet: true,
      currentAlbumIndex,
      photoEditCurrent: {
        id: current.id,
        src: current.src,
        tag: current.tag || this.getCurrentBabyName()
      }
    })
  },

  hidePhotoEdit() {
    this.setData({ showPhotoEditSheet: false })
    this._resumeRainIfNeeded()
  },

  /**
   * 选择标签（宝宝昵称）
   */
  selectPhotoTag(e) {
    this.setData({ 'photoEditCurrent.tag': e.currentTarget.dataset.tag })
  },

  /**
   * 替换当前照片：重新选图 → 裁剪 → 替换
   */
  replaceCurrentPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        // 关闭编辑面板，进入替换模式的裁剪
        this.hidePhotoEdit()
        // 记住进入替换模式（裁剪确认后走替换逻辑而非新增）
        this._replaceMode = true
        // 记住当前的编辑目标（doReplacePhoto 用）
        this.setData({
          uploadRawPath: file.tempFilePath,
          showUploadCropper: true,
          uploadTag: this.data.photoEditCurrent.tag || '',
          cropImgW: 200, cropImgH: 200,
          cropImgX: 50, cropImgY: 50
        })
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => {
            const stage = this.data.cropStageSize
            let w = info.width, h = info.height
            if (w > stage || h > stage) {
              const ratio = Math.min(stage / w, stage / h)
              w = Math.floor(w * ratio)
              h = Math.floor(h * ratio)
            }
            this.setData({
              cropImgW: w, cropImgH: h,
              cropImgX: Math.floor((stage - w) / 2),
              cropImgY: Math.floor((stage - h) / 2)
            })
          },
          fail: () => {}
        })
      },
      fail: () => {}
    })
  },

  /**
   * 删除当前照片
   */
  deleteCurrentPhoto() {
    const { albumPhotos, currentAlbumIndex, photoEditCurrent } = this.data
    const index = albumPhotos.findIndex(p => p.id === photoEditCurrent.id)
    if (index < 0) return

    wx.showModal({
      title: '删除照片',
      content: '确定从相册删除这张照片吗？',
      confirmColor: '#E8554E',
      success: (r) => {
        if (!r.confirm) return
        const target = albumPhotos[index]
        const filtered = albumPhotos.filter((_, i) => i !== index)
        storage.set(storage.albumKey(app.globalData.babyId), filtered)
        this.setData({
          albumPhotos: filtered,
          showPhotoEditSheet: false,
          currentAlbumIndex: Math.max(0, index - 1)
        })
        if (app.globalData.cloudReady) {
          if (String(target.id).startsWith('cloud://')) {
            wx.cloud.deleteFile({ fileList: [target.id] }).catch(() => {})
          }
          call('saveBabyInfo', {
            babyId: app.globalData.babyId || 'default',
            name: this.getCurrentBabyName(),
            albumPhotos: filtered.map(p => p.src)
          }).then((data) => this._absorbNewBabyId(data)).catch(() => {})
        }
      }
    })
  },

  /**
   * 保存照片编辑（标签变更 / 新图替换）
   */
  savePhotoEdit() {
    const { albumPhotos, photoEditCurrent } = this.data
    const index = albumPhotos.findIndex(p => p.id === photoEditCurrent.id)
    if (index < 0) return

    const updated = albumPhotos.map((p, i) => {
      if (i === index) {
        return {
          ...p,
          tag: photoEditCurrent.tag || '',
          src: photoEditCurrent.src || p.src,
          id: photoEditCurrent.id || p.id
        }
      }
      return p
    })

    storage.set(storage.albumKey(app.globalData.babyId), updated)
    this.setData({ albumPhotos: updated, showPhotoEditSheet: false })

    if (app.globalData.cloudReady) {
      call('saveBabyInfo', {
        babyId: app.globalData.babyId || 'default',
        name: this.getCurrentBabyName(),
        albumPhotos: updated.map(p => p.src)
      }).then((data) => this._absorbNewBabyId(data)).catch(() => {})
    }
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  // ============================================
  // 睡眠状态
  // ============================================

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

  // ============================================
  // 数据刷新
  // ============================================

  /**
   * 更新预测缓存（供记录三卡的「预计下次」文案计算 avgInterval）
   * 记录三卡文案仍展示预测信息，因此预测卡区移除后仍需维护 PREDICTION 缓存
   */
  updatePredictionCache() {
    const predictionResult = predictAll(this._allRecords)
    storage.set(storage.CACHE_KEYS.PREDICTION, predictionResult)
  },

  /**
   * 记录操作后统一追加进预测数据源并刷新预测缓存（供记录三卡文案）
   * 记录已由各操作写入 todayRecords 缓存（storage.appendTodayRecord），
   * 这里把它们并入 _allRecords 后立即重算 predictAll
   */
  syncPredictionsAfterRecord() {
    let latest = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    // todayRecords 可能是 { feed: [], diaper: [], sleep: [] } 或纯数组，统一取数组
    if (latest && !Array.isArray(latest)) {
      latest = (latest.feed || []).concat(latest.diaper || [], latest.sleep || [])
    }
    // 与现有 _allRecords 合并去重（按 timestamp + recordType），避免多层记录
    const merged = this._allRecords ? this._allRecords.slice() : []
    const seen = new Set(merged.map(r => `${r.timestamp}_${r.recordType}`))
    ;(latest || []).forEach(r => {
      const key = `${r.timestamp}_${r.recordType}`
      if (!seen.has(key)) {
        merged.push(r)
        seen.add(key)
      }
    })
    this._allRecords = merged
    this.updatePredictionCache()
    this.updateCardTexts()
  },

  // 从本地缓存刷新（首屏/记录事件/切宝宝后）
  refreshFromCache() {
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || { name: '宝宝', age: '新生儿' }
    const lastRecords = storage.getLastRecords()
    this._allRecords = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []

    this.setData({ babyInfo, lastRecords })
    this.updatePredictionCache()
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
        const normalized = data.records.map(r => ({
          ...r,
          timestamp: this.normalizeTimestamp(r.timestamp)
        }))
        normalized.forEach(r => {
          if (lastRecords[r.recordType] !== undefined) {
            if (!lastRecords[r.recordType] || r.timestamp > lastRecords[r.recordType]) {
              lastRecords[r.recordType] = r.timestamp
            }
          }
        })
        storage.set(storage.CACHE_KEYS.LAST_RECORDS, lastRecords)

        const predictionResult = predictAll(normalized)
        storage.set(storage.CACHE_KEYS.PREDICTION, predictionResult)

        this._allRecords = normalized
        this.setData({ lastRecords })
        this.updatePredictionCache()
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

  // ============================================
  // 记录操作：喂奶 / 尿布 / 睡觉
  // ============================================
  // 记录操作：单击 = 记录时间点，长按 = 弹层填详情
  // ============================================

  async handleFeed() {
    await this.recordAction(RECORD_TYPES.FEED, 'feedPress', 'feedSuccess', '已记录喂奶')
  },

  async handleDiaper() {
    await this.recordAction(RECORD_TYPES.DIAPER, 'diaperPress', 'diaperSuccess', '已记录换尿布')
  },

  /**
   * 睡眠单击：切换入睡/醒来
   */
  handleSleepTap() {
    if (this.data.sleeping) {
      this.endSleep()
    } else {
      this.startSleep()
    }
  },

  /**
   * 睡眠长按：弹出回忆记录面板
   */
  showSleepSheet() {
    this.setData({ showSleepSheet: true })
  },

  // ===== 喂奶量弹层（长按） =====
  showFeedSheet() {
    this.setData({ showFeedSheet: true, feedAmountInput: '', feedCustomMode: false, feedQuickAmount: 0 })
  },

  hideFeedSheet() {
    this.setData({ showFeedSheet: false })
    this._resumeRainIfNeeded()
  },

  onFeedAmountInput(e) {
    this.setData({ feedAmountInput: e.detail.value })
  },

  /**
   * 快捷喂奶量标签点击：选中后高亮，可直接保存
   */
  selectFeedQuick(e) {
    const amount = Number(e.currentTarget.dataset.amount) || 0
    this.setData({ feedQuickAmount: amount, feedCustomMode: false, feedAmountInput: '' })
  },

  /**
   * 切换到自定义输入模式
   */
  enableFeedCustom() {
    this.setData({ feedCustomMode: true, feedQuickAmount: 0 })
  },

  async saveFeedWithAmount() {
    // 优先取快捷选择的量，其次取自定义输入
    const amount = this.data.feedQuickAmount || (this.data.feedCustomMode ? (parseFloat(this.data.feedAmountInput) || 0) : 0)
    this.setData({ showFeedSheet: false })
    this.setData({ feedPress: true })
    setTimeout(() => this.setData({ feedPress: false }), 300)

    const timestamp = Date.now()
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.FEED,
      timestamp,
      amount,
      duration: 0,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }

    storage.updateLastRecord(RECORD_TYPES.FEED, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')
    this.syncPredictionsAfterRecord()
    this.updateCardTexts()

    this.setData({ feedSuccess: true })
    setTimeout(() => this.setData({ feedSuccess: false }), 1000)

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    wx.showToast({ title: amount ? `已记录 ${amount}ml` : '已记录喂奶', icon: 'success' })
  },

  // ===== 尿布类型弹层（长按） =====
  showDiaperSheet() {
    this.setData({ showDiaperSheet: true, diaperTypeInput: '' })
  },

  hideDiaperSheet() {
    this.setData({ showDiaperSheet: false })
    this._resumeRainIfNeeded()
  },

  selectDiaperType(e) {
    this.setData({ diaperTypeInput: e.currentTarget.dataset.type })
  },

  async saveDiaperWithType() {
    const subType = this.data.diaperTypeInput
    this.setData({ showDiaperSheet: false })
    this.setData({ diaperPress: true })
    setTimeout(() => this.setData({ diaperPress: false }), 300)

    const timestamp = Date.now()
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.DIAPER,
      timestamp,
      subType,
      duration: 0,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }

    storage.updateLastRecord(RECORD_TYPES.DIAPER, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')
    this.syncPredictionsAfterRecord()
    this.updateCardTexts()

    this.setData({ diaperSuccess: true })
    setTimeout(() => this.setData({ diaperSuccess: false }), 1000)

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    const typeText = subType === 'poop' ? '大便' : subType === 'pee' ? '小便' : subType === 'loose' ? '拉稀' : ''
    wx.showToast({ title: typeText ? `已记录${typeText}` : '已记录换尿布', icon: 'success' })
  },

  /**
   * 标记刚刚入睡
   */
  async startSleep() {
    const now = Date.now()
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
    this.syncPredictionsAfterRecord()
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
    this.syncPredictionsAfterRecord()
    this.updateCardTexts()

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    wx.showToast({ title: `本次睡眠 ${this.minutesToText(minutes)}`, icon: 'success' })
  },

  /**

   * 选择一个时长，立即记录"刚刚结束"的一次睡眠
   */
  async selectDuration(e) {
    const minutes = Number(e.currentTarget.dataset.minutes) || 0
    if (minutes <= 0) return
    const end = Date.now()
    const start = end - minutes * 60000

    this.setData({ showSleepSheet: false, sleepPress: true })
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
    this.syncPredictionsAfterRecord()
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
    this._resumeRainIfNeeded()
  },

  noop() {},

  /**
   * 跳转到宝宝资料页（保留供"编辑"按钮使用）
   */
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // ============================================
  // 宝宝管理面板
  // ============================================

  showBabyPanel() {
    this.syncGlobalToView()
    this.setData({ showBabySheet: true, formMode: '' })
  },

  hideBabyPanel() {
    this.setData({
      showBabySheet: false,
      formMode: '',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: '',
      joinBabyId: '',
      joinBabyCode: ''
    })
    this._resumeRainIfNeeded()
  },

  /**
   * 切换宝宝
   */
  switchBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    const target = (app.globalData.babies || []).find(b => b.babyId === babyId)
    if (!target) return
    if (target.babyId === app.globalData.babyId) {
      // 已是当前宝宝，关闭面板
      this.hideBabyPanel()
      return
    }
    app.setCurrentBaby(target)
    this.syncGlobalToView()
    wx.showToast({ title: `已切换到 ${target.name || '宝宝'}`, icon: 'none' })
    setTimeout(() => this.hideBabyPanel(), 300)
  },

  /**
   * 编辑宝宝：跳转到 profile 页（携带 babyId 参数由 profile 处理）
   */
  editBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    this.hideBabyPanel()
    setTimeout(() => {
      wx.navigateTo({ url: `/pages/profile/profile?babyId=${babyId}` })
    }, 200)
  },

  /**
   * 删除宝宝：二次确认后调 deleteBaby 云函数
   * 仅创建者（parent）可删除；删除后若为当前宝宝则自动切换到剩余第一个
   */
  async deleteBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    const babyName = e.currentTarget.dataset.name || '该宝宝'
    if (!babyId || babyId === 'default') {
      wx.showToast({ title: '无效宝宝', icon: 'none' })
      return
    }

    const { confirm } = await wx.showModal({
      title: '⚠️ 删除宝宝（管理员）',
      content: `你正在删除「${babyName}」。\n\n此操作不可恢复：宝宝的资料、相册和 ${babyName} 的全部记录将永久删除，其他家庭成员也将无法再看到。\n\n确认删除吗？`,
      confirmText: '确认删除',
      confirmColor: '#E8554E',
      cancelText: '再想想'
    }).catch(() => ({ confirm: false }))
    if (!confirm) return

    wx.showLoading({ title: '删除中...', mask: true })
    try {
      if (!app.globalData.cloudReady) {
        throw new Error('云环境不可用')
      }
      await call('deleteBaby', { babyId })
      wx.hideLoading()

      // 清理该宝宝的本地相册缓存（按 babyId 隔离）
      try { storage.remove(storage.albumKey(babyId)) } catch (e) {}

      // 刷新宝宝列表
      const babies = await app.refreshBabies()

      if (babyId === app.globalData.babyId) {
        // 删除的是当前宝宝：切换到剩余第一个
        if (babies.length > 0) {
          app.setCurrentBaby(babies[0])
        } else {
          // 没有宝宝了：清空当前宝宝状态
          app.globalData.babyId = ''
          app.globalData.babyInfo = null
          try {
            wx.removeStorageSync('babyId')
            wx.removeStorageSync('babyInfo')
          } catch (err) {}
          app.eventBus.emit('babySwitched', { babyId: '', babyInfo: null })
        }
        this.syncGlobalToView()
        this.loadAlbum()
        this.refreshFromCache()
        if (app.globalData.cloudReady) this.fetchCloudData()
      } else {
        this.syncGlobalToView()
      }

      wx.showToast({ title: '已删除', icon: 'success' })
      this.hideBabyPanel()
    } catch (err) {
      wx.hideLoading()
      wx.showModal({
        title: '删除失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    }
  },

  // ===== 新建宝宝 =====
  startCreateBaby() {
    this.setData({
      formMode: 'create',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: ''
    })
  },

  onFormChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (avatarUrl) this.setData({ formAvatar: avatarUrl })
  },

  onFormNameInput(e) {
    this.setData({ formName: e.detail.value })
  },

  onFormBirthChange(e) {
    this.setData({ formBirthDate: e.detail.value })
  },

  onFormGenderTap(e) {
    this.setData({ formGender: e.currentTarget.dataset.gender })
  },

  async submitCreateBaby() {
    const { formAvatar, formName, formBirthDate, formGender } = this.data
    if (!formName || !formName.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '云环境不可用', icon: 'none' })
      return
    }

    wx.showLoading({ title: '创建中...', mask: true })

    try {
      let finalAvatar = formAvatar
      // 上传头像
      if (formAvatar && !formAvatar.startsWith('cloud://')) {
        try {
          const ts = Date.now()
          const upRes = await wx.cloud.uploadFile({
            cloudPath: `avatars/${ts}.png`,
            filePath: formAvatar
          })
          if (upRes && upRes.fileID) finalAvatar = upRes.fileID
        } catch (err) {
          console.warn('宝宝头像上传失败:', err)
        }
      }

      const res = await wx.cloud.callFunction({
        name: 'createBaby',
        data: {
          name: formName.trim(),
          avatar: finalAvatar,
          birthDate: formBirthDate,
          gender: formGender
        }
      })

      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.message) || '创建失败')
      }

      const newBaby = res.result.data
      // 刷新宝宝列表
      const babies = await app.refreshBabies()
      // 选中新创建的宝宝
      app.setCurrentBaby(newBaby)
      this.syncGlobalToView()

      // 显示成功页（含 ID 与密码）
      this.setData({
        formMode: 'success',
        newBabyId: newBaby.babyId,
        newBabyCode: newBaby.babyCode
      })
      wx.hideLoading()
    } catch (err) {
      console.error('创建宝宝失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '创建失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    }
  },

  copyNewBaby() {
    const { newBabyId, newBabyCode } = this.data
    wx.setClipboardData({
      data: `宝宝 ID：${newBabyId}\n加入密码：${newBabyCode}`,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' })
        setTimeout(() => this.hideBabyPanel(), 500)
      }
    })
  },

  // ===== 加入宝宝 =====
  startJoinBaby() {
    this.setData({
      formMode: 'join',
      joinBabyId: '',
      joinBabyCode: ''
    })
  },

  onJoinBabyIdInput(e) {
    this.setData({ joinBabyId: (e.detail.value || '').toUpperCase().trim() })
  },

  onJoinBabyCodeInput(e) {
    this.setData({ joinBabyCode: (e.detail.value || '').trim() })
  },

  async submitJoinBaby() {
    const { joinBabyId, joinBabyCode } = this.data
    if (!joinBabyId || joinBabyId.length !== 8) {
      wx.showToast({ title: '请填写 8 位宝宝 ID', icon: 'none' })
      return
    }
    if (!joinBabyCode || joinBabyCode.length !== 6) {
      wx.showToast({ title: '请填写 6 位密码', icon: 'none' })
      return
    }
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '云环境不可用', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加入中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'joinBaby',
        data: { babyId: joinBabyId, babyCode: joinBabyCode }
      })

      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.message) || '加入失败')
      }

      const baby = res.result.data
      // 刷新宝宝列表
      const babies = await app.refreshBabies()
      // 切换到刚加入的宝宝
      app.setCurrentBaby(baby)
      this.syncGlobalToView()

      wx.hideLoading()
      wx.showToast({
        title: baby.alreadyMember ? '已是家庭成员' : `已加入 ${baby.name || '宝宝'}`,
        icon: 'success'
      })
      setTimeout(() => this.hideBabyPanel(), 600)
    } catch (err) {
      console.error('加入宝宝失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '加入失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    }
  },

  cancelForm() {
    this.setData({
      formMode: '',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: '',
      joinBabyId: '',
      joinBabyCode: ''
    })
  },

  // ===== 登出 =====
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将清除本地数据，下次需重新登录。确定继续吗？',
      confirmText: '退出',
      confirmColor: '#E8554E',
      success: (res) => {
        if (res.confirm) {
          app.logout()
        }
      }
    })
  },

  /**
   * 通用记录动作（喂奶 / 尿布）
   */
  async recordAction(type, pressKey, successKey) {
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
    this.syncPredictionsAfterRecord()
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
