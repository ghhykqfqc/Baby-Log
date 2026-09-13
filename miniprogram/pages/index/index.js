// pages/index/index.js - 首页（天气皮肤 + 云朵AI育娃伙伴 + 单行记录）
// 2026-09-12 改造：移除照片轮播相册（规避 UGC 图片审核风险），替换为「云朵 AI 育娃伙伴」
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const auth = require('../../utils/auth')
const tts = require('../../utils/tts')
const { formatElapsedSmart, formatRemainingSmart, formatDurationSmart } = require('../../utils/time')
const { predictAll } = require('../../utils/predict')
const { RECORD_TYPES } = require('../../utils/constants')

// 入睡后超过此时间（毫秒）仍未结束，视为漏记结束，自动复位
const SLEEP_RESET_MS = 12 * 60 * 60 * 1000

// 天气缓存有效期（30 分钟）
const WEATHER_CACHE_MS = 30 * 60 * 1000

// ===== 每日育娃小贴士库（按日期取模轮换） =====
const DAILY_TIPS = [
  { short: '辅食从单一食材开始，观察3天', full: '初次添加辅食建议从单一食材（如高铁米粉）开始，每次只添加一种新食物，观察 2-3 天，确认无过敏反应后再尝试下一种。' },
  { short: '宝宝清醒信号：揉眼、打哈欠',  full: '当宝宝开始揉眼睛、打哈欠、目光发直时，就是困了。此时应尽快安排入睡，错过窗口期反而更难睡着。' },
  { short: '喂奶后记得拍嗝',  full: '每次喂奶后竖抱宝宝 10-15 分钟，轻拍后背帮助排出胃里的空气，能有效减少吐奶和胀气，拍出嗝后再放下。' },
  { short: '爬行期清空地面低矮物',  full: '宝宝学爬后活动范围迅速变大，地面上的小物件、电线、桌角都要处理好，给宝宝一个安全探索的空间。' },
  { short: '多和宝宝说话，语言黄金期',  full: '从出生起就要多与宝宝说话，哪怕他听不懂。词汇刺激是语言发展的基础，每天读绘本、唱歌、交流都很重要。' },
  { short: '发热时优先观察精神状态',  full: '宝宝发热时，先看精神状态：吃奶、玩耍正常则先物理降温观察；若精神差、嗜睡、高热不退请及时就医。' },
  { short: '洗澡水温 37℃ 左右',  full: '宝宝洗澡水温略高于体温（37-38℃），不能只用手背试，建议用手肘内侧试温，全程托稳头颈。' },
  { short: '按时体检，别错过疫苗',  full: '按儿保时间表定期体检，监测身高体重与发育里程碑；疫苗按本接种，接种后观察半小时再离开。' },
  { short: '出生 6 个月内纯母乳喂养',  full: '世卫组织建议 0-6 个月纯母乳喂养，6 个月后继续母乳并适时添加辅食。母乳是宝宝最好的口粮。' },
  { short: '宝宝哭闹先排除基本需求',  full: '新手爸妈别慌：哭闹先依次排查「饿、困、尿布、热、胀气」。常见原因逐个排除，多数时候宝宝很快就安静了。' },
  { short: '多趴是前庭与手臂锻炼',  full: '清醒时多让宝宝趴着（tummy time），有助于颈背肌、手眼协调和前庭发育，也是后续爬行的基础，从每天 1-2 分钟开始。' },
  { short: '哭闹≠一定是饿了',  full: '哭闹有多种原因：饥饿、困倦、尿布、过热、受惊等。先观察喂养情况与便尿，别一哭就喂，避免过度喂养。' }
]

const WEATHER_LABELS = {
  sunny: '☀️ 晴',
  cloudy: '⛅ 多云',
  rain: '🌧 雨',
  snow: '❄️ 雪',
  wind: '🌬 有风'
}

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
    userInfo: {},
    babies: [],
    currentBabyId: '',
    lastRecords: { feed: 0, diaper: 0, sleep: 0 },
    cardTexts: {
      feed:   { elapsed: '--', next: '' },
      diaper: { elapsed: '--', next: '' },
      sleep:  { elapsed: '--', next: '' }
    },
    showTipFull: false,
    dailyTipShort: '',
    dailyTipFull: '',
    weatherClass: 'sunny',
    weatherText: '',
    // 云朵 AI 育娃伙伴
    quickQuestions: [
      '讲个睡前小故事',
      '唱首哄睡儿歌',
      '8个月夜醒怎么办',
      '给宝宝说句鼓励的话'
    ],
    aiTipText: '按住说话，或点一下问问育儿问题',
    aiSubtitle: '',          // 单行字幕
    aiFullAnswer: '',        // 本次完整回答
    aiShowArrow: false,      // 是否显示 ∨ 展开箭头
    aiThinking: false,       // 生成中
    aiListening: false,      // 按住说话中
    aiTalking: false,        // 播报中（呼吸）
    aiWaveActive: false,     // CSS 声波条
    aiSpeaking: false,       // 完整面板播报按钮状态
    aiInputValue: '',
    aiInputFocus: false,
    showAiSheet: false,      // 文本输入弹层
    showAiAnswerPanel: false, // 完整回答
    isOffline: false,
    cloudReady: true,
    todayText: '',
    feedPress: false,
    diaperPress: false,
    sleepPress: false,
    feedSuccess: false,
    diaperSuccess: false,
    sleepSuccess: false,
    sleeping: false,
    sleepStartTime: 0,
    sleepDurationText: '',
    showSleepSheet: false,
    showFeedSheet: false,
    feedAmountInput: '',
    feedCustomMode: false,
    feedQuickAmount: 0,
    feedQuickOptions: [30, 60, 90, 120, 150, 180, 210, 240],
    showDiaperSheet: false,
    diaperTypeInput: '',
    showBabySheet: false,
    formMode: '',
    formAvatar: '',
    formAvatarAuditing: false,   // 新建宝宝表单头像审核中
    formName: '',
    formBirthDate: '',
    formGender: '',
    joinBabyId: '',
    joinBabyCode: '',
    newBabyId: '',
    newBabyCode: '',
    showFeedbackSheet: false,
    feedbackTypes: [
      { key: 'bug', label: '🐛 问题反馈' },
      { key: 'suggest', label: '💡 功能建议' },
      { key: 'other', label: '✉️ 其他' }
    ],
    feedbackType: 'bug',
    feedbackContent: '',
    feedbackContact: '',
    feedbackSending: false,
    showLoginPanel: false
  },

  _timer: null,
  _sleepTick: null,
  _allRecords: [],
  // AI 内部状态（不 setData）
  _aiBusy: false,          // 防止并发提问
  _aiPressTimer: null,     // 按住说话计时
  _aiPressStarted: false,  // 是否已确认是长按
  _aiPressLocked: false,
  _aiTypeTimer: null,      // 打字机定时器
  _aiTypingFull: '',
  _aiCurrentFull: '',

  onLoad() {
    app.eventBus.on('recordsUpdated', this.refreshFromCache.bind(this))
    app.eventBus.on('babySwitched', this.onBabySwitched.bind(this))
    this.updateTodayText()
    this.restoreSleepState()
    this.initDailyTip()
  },

  onShow() {
    this.setData({ cloudReady: app.globalData.cloudReady })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/index/index')
    }
    try {
      if (wx.getStorageSync('autoOpenLogin')) {
        wx.removeStorageSync('autoOpenLogin')
        if (!app.isLoggedIn() && !this.data.showLoginPanel) {
          this.setData({ showLoginPanel: true })
        }
      }
    } catch (e) {}
    this.syncGlobalToView()
    this.refreshFromCache()
    this.loadWeather()
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
      if (app.isLoggedIn()) {
        app.refreshBabies().then(babies => {
          const healed = (babies || []).map(b => {
            if (!b.name && b.babyId === app.globalData.babyId && app.globalData.babyInfo && app.globalData.babyInfo.name) {
              return { ...b, name: app.globalData.babyInfo.name }
            }
            return b
          })
          this.setData({ babies: healed, currentBabyId: app.globalData.babyId })
          if (!app.globalData.babyId && healed.length > 0) {
            app.setCurrentBaby(healed[0])
          }
          this.healBabyNameIfNeeded()
        }).catch(() => {})
      } else {
        this.setData({ babies: [], currentBabyId: app.globalData.babyId || '' })
      }
    }
    this._timer = setInterval(() => this.updateCardTexts(), 30000)
    this.startSleepTick()
  },

  syncGlobalToView() {
    const isGuest = !app.isLoggedIn()
    const babies = isGuest ? [] : (app.globalData.babies || []).map(b => {
      if (!b.name && b.babyId === app.globalData.babyId && app.globalData.babyInfo && app.globalData.babyInfo.name) {
        return { ...b, name: app.globalData.babyInfo.name }
      }
      return b
    })
    const babyInfo = isGuest ? {} : (app.globalData.babyInfo || {})
    if (JSON.stringify(babies) !== JSON.stringify(app.globalData.babies || [])) {
      app.globalData.babies = babies
      try { wx.setStorageSync('babies', babies) } catch (e) {}
    }
    this.setData({
      userInfo: app.globalData.userInfo || {},
      babies,
      babyInfo,
      currentBabyId: isGuest ? '' : (app.globalData.babyId || '')
    })
  },

  onBabySwitched() {
    this.syncGlobalToView()
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
    this.aiCancelRecording()
    this.aiStopSpeaking()
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
    this.stopSleepTick()
    this.stopRainAnimation()
    this.aiCancelRecording()
    this.aiStopSpeaking()
    this.clearAiTypeTimer()
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
  initDailyTip() {
    const now = new Date()
    const dayIndex = now.getFullYear() * 1000 + now.getMonth() * 50 + now.getDate()
    const tip = DAILY_TIPS[dayIndex % DAILY_TIPS.length]
    this.setData({
      dailyTipShort: tip.short,
      dailyTipFull: `${tip.full}\n--「每日育娃小贴士」`,
      showTipFull: false
    })
  },

  showDailyTip() {
    this.setData({ showTipFull: !this.data.showTipFull })
  },

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
    if (category === 'rain') {
      setTimeout(() => this.startRainAnimation(), 50)
    } else {
      this.stopRainAnimation()
    }
  },

  // ============================================
  // 雨天 Canvas 动画（保留原实现）
  // ============================================
  _rainRAF: null,
  _rainCanvas: null,
  _rainCtx: null,
  _rainDrops: [],
  _ripples: [],
  _rainDPR: 1,

  startRainAnimation() {
    this.stopRainAnimation()
    const query = wx.createSelectorQuery()
    query.select('#rainCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
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

      const count = Math.min(120, Math.max(70, Math.floor(w / 4)))
      this._rainDrops = []
      for (let i = 0; i < count; i++) {
        this._rainDrops.push(this._spawnRainDrop(w, h, true))
      }
      this._ripples = []

      const tick = () => {
        this._renderRainFrame(ctx, w, h)
        this._rainRAF = canvas.requestAnimationFrame(tick)
      }
      this._rainRAF = canvas.requestAnimationFrame(tick)
    })
  },

  _spawnRainDrop(w, h, initial) {
    const angleDeg = 100 + Math.random() * 15
    const angleRad = (angleDeg * Math.PI) / 180
    const len = 10 + Math.random() * 12
    const speed = 6 + Math.random() * 5
    return {
      x: Math.random() * (w + 100) - 50,
      y: initial ? Math.random() * h : -len - Math.random() * 60,
      len,
      angle: angleRad,
      vx: Math.cos(angleRad) * speed,
      vy: Math.sin(angleRad) * speed,
      opacity: 0.25 + Math.random() * 0.35
    }
  },

  _renderRainFrame(ctx, w, h) {
    ctx.clearRect(0, 0, w, h)
    const groundY = h * 0.9
    ctx.lineCap = 'round'
    for (let i = 0; i < this._rainDrops.length; i++) {
      const d = this._rainDrops[i]
      const x2 = d.x + Math.cos(d.angle) * d.len
      const y2 = d.y + Math.sin(d.angle) * d.len
      const grad = ctx.createLinearGradient(d.x, d.y, x2, y2)
      grad.addColorStop(0, `rgba(180, 200, 226, 0)`)
      grad.addColorStop(1, `rgba(180, 200, 226, ${d.opacity})`)
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(x2, y2)
      ctx.stroke()

      d.x += d.vx
      d.y += d.vy

      if (d.y > groundY + Math.random() * (h - groundY) * 0.6) {
        if (Math.random() < 0.5 && d.x > 0 && d.x < w) {
          this._ripples.push({
            x: d.x,
            y: Math.min(h - 2, d.y),
            r: 1,
            maxR: 6 + Math.random() * 8,
            opacity: 0.4
          })
        }
        const fresh = this._spawnRainDrop(w, h, false)
        this._rainDrops[i] = fresh
      }
      if (d.x > w + 60) {
        const fresh = this._spawnRainDrop(w, h, false)
        fresh.x = -50
        this._rainDrops[i] = fresh
      }
    }

    for (let i = this._ripples.length - 1; i >= 0; i--) {
      const rp = this._ripples[i]
      ctx.strokeStyle = `rgba(190, 210, 232, ${rp.opacity})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.4, 0, 0, Math.PI * 2)
      ctx.stroke()
      rp.r += 0.6
      rp.opacity -= 0.025
      if (rp.opacity <= 0 || rp.r >= rp.maxR) {
        this._ripples.splice(i, 1)
      }
    }
  },

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

  _resumeRainIfNeeded() {
    if (this.data.weatherClass !== 'rain') return
    setTimeout(() => this.startRainAnimation(), 120)
  },

  // ============================================
  // 云朵 AI 育娃伙伴
  // ============================================

  /** 快捷提问气泡点击 */
  onQuickQuestion(e) {
    const text = e.currentTarget.dataset.text
    if (!text) return
    this.aiSend(text)
  },

  /** 云朵触摸开始：启动长按计时 */
  onCloudTouchStart() {
    if (this._aiBusy) return
    this.aiCancelRecording()
    this._aiPressStarted = false
    this._aiPressLocked = false
    if (this._aiPressTimer) clearTimeout(this._aiPressTimer)
    // 350ms 后触发「按住说话」
    this._aiPressTimer = setTimeout(() => {
      this._aiPressTimer = null
      if (this._aiBusy) return
      this._aiPressStarted = true
      this.aiStartListening()
    }, 350)
  },

  /** 云朵触摸结束：若未触发长按则视为点击（由 onCloudTap 处理），否则停止录音 */
  onCloudTouchEnd() {
    if (this._aiPressTimer) {
      clearTimeout(this._aiPressTimer)
      this._aiPressTimer = null
    }
    if (this._aiPressStarted) {
      this.aiStopListening()
    }
    this._aiPressStarted = false
    this._aiPressLocked = false
  },

  onCloudTouchCancel() {
    if (this._aiPressTimer) {
      clearTimeout(this._aiPressTimer)
      this._aiPressTimer = null
    }
    this.aiCancelRecording()
    this._aiPressStarted = false
    this._aiPressLocked = false
  },

  /** 长按已触发（bindlongpress 兜底，防移动时 touchend 丢失） */
  onCloudLongPress() {
    if (this._aiBusy) return
    if (this._aiPressTimer) {
      clearTimeout(this._aiPressTimer)
      this._aiPressTimer = null
    }
    if (!this._aiPressStarted) {
      this._aiPressStarted = true
      this.aiStartListening()
    }
  },

  /** 云朵点击（非长按）→ 弹出文本输入 */
  onCloudTap() {
    if (this._aiPressStarted || this._aiPressLocked) return
    if (this._aiBusy) {
      wx.showToast({ title: '小云朵正在回答，稍等一下～', icon: 'none' })
      return
    }
    this.openAiInputSheet()
  },

  /** 打开文本输入弹层 */
  openAiInputSheet() {
    tts.stop() // 切停播报
    this.setData({ showAiSheet: true, aiInputValue: '', aiInputFocus: true })
  },

  hideAiSheet() {
    this.setData({ showAiSheet: false, aiInputFocus: false })
    this._resumeRainIfNeeded()
  },

  onAiInput(e) {
    this.setData({ aiInputValue: e.detail.value })
  },

  /** 文本输入弹层提交 */
  submitAiFromInput() {
    const text = (this.data.aiInputValue || '').trim()
    if (!text) {
      wx.showToast({ title: '先输入点内容吧', icon: 'none' })
      return
    }
    this.setData({ showAiSheet: false, aiInputFocus: false })
    this.aiSend(text)
  },

  /** 开始录音识别（按住说话） */
  aiStartListening() {
    if (this._aiBusy) return
    this._aiPressLocked = true
    this.setData({
      aiListening: true,
      aiWaveActive: true,
      aiTipText: '松开发送语音…'
    })
    tts.stop()
    // 插件可能在真机/工具上不可用，捕获 300ms 内未识别则提示
    tts.startRecord({
      onStart: () => {},
      onText: (text) => {
        // 识别完成
        this.aiStopListeningUI()
        const clean = String(text || '').trim()
        if (clean) this.aiSend(clean, { fromVoice: true })
        else wx.showToast({ title: '没听清，换个说法吧～', icon: 'none' })
      },
      onError: (err) => {
        console.warn('语音识别失败:', err)
        this.aiStopListeningUI()
        wx.showToast({ title: '语音暂不可用，试试文字输入', icon: 'none' })
      }
    })
  },

  /** 停止录音识别（松手） */
  aiStopListening() {
    // 仅 UI 停止，回调里发请求
    this.aiStopListeningUI()
    tts.stopRecord()
  },

  aiStopListeningUI() {
    this.setData({
      aiListening: false,
      aiWaveActive: false,
      aiTipText: this.data.aiTipTextDefault || '按住说话，或点一下问问育儿问题'
    })
  },

  /** 取消录音（长按取消 / 页面隐藏） */
  aiCancelRecording() {
    if (this._aiPressTimer) {
      clearTimeout(this._aiPressTimer)
      this._aiPressTimer = null
    }
    tts.stopRecord()
    if (this.data.aiListening) {
      this.aiStopListeningUI()
    }
  },

  /** 统一发送问题（语音 / 文本 / 快捷）
   * @param {string} userText 问题文本
   * @param {object} [opts] { fromVoice: true } 语音输入：回答生成完后自动播报
   */
  async aiSend(userText, opts) {
    const fromVoice = !!(opts && opts.fromVoice)
    const text = String(userText || '').trim().slice(0, 300)
    if (!text) {
      wx.showToast({ title: '先输入点内容吧', icon: 'none' })
      return
    }
    if (this._aiBusy) {
      wx.showToast({ title: '小云朵正在回答中…', icon: 'none' })
      return
    }
    this._aiBusy = true

    // 停止旧的播报与打字机
    this.aiStopSpeaking()
    this.clearAiTypeTimer()

    // 语音输入标记：回答完成后自动播报
    this._aiAutoSpeak = fromVoice

    this.setData({
      aiSubtitle: '',
      aiFullAnswer: '',
      aiShowArrow: false,
      aiThinking: true,
      aiTipText: '小云朵思考中…'
    })
    this.setData({ aiWaveActive: false })
    this._aiTypingFull = ''

    // 记录问题（本地不存历史，仅本次会话展示）
    this._aiLastQuestion = text

    try {
      if (!app.globalData.cloudReady) {
        throw new Error('cloud-not-ready')
      }
      const result = await call('aiChat', { text })
      // call 会解包 res.result.data
      if (!result || !result.text) {
        throw new Error('empty-result')
      }
      const answer = String(result.text).trim()
      this.setData({ aiThinking: false, aiFullAnswer: answer, aiShowArrow: true })
      // 打字机逐字展示（80ms/字，节流）
      this.aiStartTyping(answer)
    } catch (err) {
      console.warn('AI 请求失败:', err)
      this._aiAutoSpeak = false
      const msg = (err && err.message) || ''
      // 安检拦截 → 友好提示
      let tip = '小云朵开小差了，稍后再试'
      if (msg && msg.indexOf('换个说法') >= 0) {
        tip = '这句话不太合适，换个说法吧～'
      } else {
        // 模型调用失败：透出 detail 判断是否「AI 未开通/配额」类问题
        const detail = String((err && err.detail) || '')
        if (/配额|未开通|not.*open|MODEL_NOT|RISK_CTRL|quota/i.test(detail)) {
          tip = '小云朵还没准备好（AI 能力未开通），请稍后再试'
        } else if (msg && msg.indexOf('小云朵今天有点累') >= 0) {
          tip = '小云朵今天有点累，稍后再试试吧'
        }
      }
      this.setData({
        aiThinking: false,
        aiSubtitle: tip,
        aiShowArrow: false,
        aiSubtitleEmpty: false
      })
      this._aiBusy = false
      this.resetAiTip()
    }
  },

  isEmptyErr(err) {
    return !!(err && (err.message === 'cloud-not-ready' || err.message === 'empty-result'))
  },

  /** 打字机：把完整回答逐字填入字幕行 */
  aiStartTyping(fullText) {
    this.clearAiTypeTimer()
    this._aiTypingFull = fullText
    let index = 0
    const TICK = 40 // ms
    const CHARS_PER_TICK = 2 // 每 tick 2 字，约 50 字/s，低端机也流畅
    const t = setInterval(() => {
      index += CHARS_PER_TICK
      const shown = fullText.slice(0, index)
      this.setData({ aiSubtitle: shown, aiShowArrow: index < fullText.length })
      if (index >= fullText.length) {
        this.clearAiTypeTimer()
        this.setData({ aiSubtitle: fullText, aiShowArrow: true })
        this._aiBusy = false
        this.resetAiTip()
        // 语音输入场景：回答生成完后自动播报（§3 需求）
        if (this._aiAutoSpeak) {
          this._aiAutoSpeak = false
          this._aiAutoSpeakTimer = setTimeout(() => {
            this._aiAutoSpeakTimer = null
            this.speakAnswer()
          }, 300)
        }
      }
    }, TICK)
    this._aiTypeTimer = t
    this._aiSubtitleTimer = t
  },

  clearAiTypeTimer() {
    if (this._aiTypeTimer) {
      clearInterval(this._aiTypeTimer)
      this._aiTypeTimer = null
    }
    if (this._aiSubtitleTimer) {
      clearInterval(this._aiSubtitleTimer)
      this._aiSubtitleTimer = null
    }
  },

  /** AI 播报（完整回答，点击字幕 ∨ 面板中的播报按钮） */
  speakAnswer() {
    const full = this.data.aiFullAnswer
    if (!full) return
    if (this.data.aiSpeaking) {
      this.aiStopSpeaking()
      return
    }
    this.setData({ aiSpeaking: true, aiTalking: true, aiWaveActive: true })
    tts.speech(full, {
      onEnd: () => {
        this.setData({ aiSpeaking: false, aiTalking: false, aiWaveActive: false })
      },
      onError: () => {
        this.setData({ aiSpeaking: false, aiTalking: false, aiWaveActive: false })
        wx.showToast({ title: '播报暂不可用', icon: 'none' })
      }
    })
  },

  aiStopSpeaking() {
    if (this._aiAutoSpeakTimer) {
      clearTimeout(this._aiAutoSpeakTimer)
      this._aiAutoSpeakTimer = null
    }
    this._aiAutoSpeak = false
    tts.stop()
    this.setData({ aiSpeaking: false, aiTalking: false, aiWaveActive: false })
  },

  /** 语音输入的场景：回答流式生成完成后自动播报（由 aiSend 的 promise 完成时触发） */

  /** 展开完整回答 */
  showFullAnswer() {
    if (!this.data.aiFullAnswer) return
    this.setData({ showAiAnswerPanel: true, aiSpeaking: false, aiTalking: false, aiWaveActive: false })
    tts.stop()
  },

  hideAiAnswer() {
    this.setData({ showAiAnswerPanel: false })
    this.aiStopSpeaking()
    this._resumeRainIfNeeded()
  },

  copyAnswer() {
    if (!this.data.aiFullAnswer) return
    wx.setClipboardData({
      data: this.data.aiFullAnswer,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  resetAiTip() {
    this.setData({
      aiTipText: '按住说话，或点一下问问育儿问题',
      aiListening: false,
      aiWaveActive: false
    })
  },

  /** 简化入口：tts.stop（供 onCloudTap 等调用） */
  aiStopTts() {
    tts.stop()
  },

  // 别名（兼容 say 命名）
  aiStopTyping() {
    this.clearAiTypeTimer()
  },

  // ============================================
  // 睡眠状态
  // ============================================
  restoreSleepState() {
    try {
      const sleepStart = wx.getStorageSync('sleepStartTime') || 0
      if (sleepStart && (Date.now() - sleepStart) < SLEEP_RESET_MS) {
        this.setData({ sleeping: true, sleepStartTime: sleepStart })
      } else if (sleepStart) {
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
  updatePredictionCache() {
    const predictionResult = predictAll(this._allRecords)
    storage.set(storage.CACHE_KEYS.PREDICTION, predictionResult)
  },

  syncPredictionsAfterRecord() {
    let latest = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    if (latest && !Array.isArray(latest)) {
      latest = (latest.feed || []).concat(latest.diaper || [], latest.sleep || [])
    }
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

  refreshFromCache() {
    const babyInfo = app.isLoggedIn()
      ? (storage.get(storage.CACHE_KEYS.BABY_INFO) || { name: '宝宝', age: '新生儿' })
      : {}
    const lastRecords = storage.getLastRecords()
    this._allRecords = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this.setData({ babyInfo, lastRecords })
    this.updatePredictionCache()
    this.updateCardTexts()
  },

  updateCardTexts() {
    const { lastRecords, sleeping, sleepStartTime } = this.data
    const predictionData = storage.get(storage.CACHE_KEYS.PREDICTION) || {}

    const build = (type) => {
      const last = lastRecords[type] || 0
      const pred = predictionData[type] || {}
      const avgInterval = pred.avgInterval || 0

      if (type === 'sleep' && sleeping && sleepStartTime) {
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

  onLoginPanelChange(e) {
    const visible = e.detail && e.detail.visible
    this.setData({ showLoginPanel: !!visible })
    if (!visible) this._resumeRainIfNeeded()
  },

  // ============================================
  // 育儿记录（喂奶 / 尿布 / 睡觉）
  // ============================================
  async handleFeed() {
    await this.recordAction(RECORD_TYPES.FEED, 'feedPress', 'feedSuccess', '已记录喂奶')
  },

  async handleDiaper() {
    await this.recordAction(RECORD_TYPES.DIAPER, 'diaperPress', 'diaperSuccess', '已记录换尿布')
  },

  handleSleepTap() {
    if (this.data.sleeping) {
      this.endSleep()
    } else {
      this.startSleep()
    }
  },

  showSleepSheet() {
    this.setData({ showSleepSheet: true })
  },

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

  selectFeedQuick(e) {
    const amount = Number(e.currentTarget.dataset.amount) || 0
    this.setData({ feedQuickAmount: amount, feedCustomMode: false, feedAmountInput: '' })
  },

  enableFeedCustom() {
    this.setData({ feedCustomMode: true, feedQuickAmount: 0 })
  },

  async saveFeedWithAmount() {
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
    wx.showToast({ title: app.isLoggedIn() ? '已记录入睡' : '已记录入睡 · 登录后自动同步', icon: 'none' })
  },

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

    wx.showToast({ title: app.isLoggedIn() ? `本次睡眠 ${this.minutesToText(minutes)}` : `本次睡眠 ${this.minutesToText(minutes)} · 登录后同步`, icon: 'none' })
  },

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

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // ============================================
  // 宝宝管理面板（保留原逻辑）
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

  switchBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    const target = (app.globalData.babies || []).find(b => b.babyId === babyId)
    if (!target) return
    if (target.babyId === app.globalData.babyId) {
      this.hideBabyPanel()
      return
    }
    app.setCurrentBaby(target)
    this.syncGlobalToView()
    wx.showToast({ title: `已切换到 ${target.name || '宝宝'}`, icon: 'none' })
    setTimeout(() => this.hideBabyPanel(), 300)
  },

  editBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    if (app.isLoggedIn()) {
      this.hideBabyPanel()
      wx.navigateTo({ url: `/pages/profile/profile?babyId=${babyId}` })
      return
    }
    auth.ensureLogin(this, {
      onSuccess: () => {
        this.syncGlobalToView()
        if (app.globalData.cloudReady && app.isLoggedIn()) {
          app.refreshBabies().then(() => this.syncGlobalToView()).catch(() => {})
        }
        setTimeout(() => { wx.showToast({ title: '已登录，再次点击即可编辑', icon: 'none' }) }, 400)
      },
      onGuestClose: () => {
        wx.showToast({ title: '登录后即可编辑宝宝', icon: 'none' })
      }
    })
  },

  async deleteBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    const babyName = e.currentTarget.dataset.name || '该宝宝'
    if (!babyId || babyId === 'default') {
      wx.showToast({ title: '无效宝宝', icon: 'none' })
      return
    }

    const { confirm } = await wx.showModal({
      title: '⚠️ 删除宝宝（管理员）',
      content: `你正在删除「${babyName}」。\n\n此操作不可恢复：宝宝的资料和全部记录将永久删除。\n\n确认删除吗？`,
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

      const babies = await app.refreshBabies()

      if (babyId === app.globalData.babyId) {
        if (babies.length > 0) {
          app.setCurrentBaby(babies[0])
        } else {
          app.globalData.babyId = ''
          app.globalData.babyInfo = null
          try {
            wx.removeStorageSync('babyId')
            wx.removeStorageSync('babyInfo')
          } catch (err) {}
          app.eventBus.emit('babySwitched', { babyId: '', babyInfo: null })
        }
        this.syncGlobalToView()
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

  startCreateBaby() {
    if (app.isLoggedIn()) {
      this._openCreateForm()
      return
    }
    auth.ensureLogin(this, {
      onSuccess: () => {
        this.syncGlobalToView()
        if (app.globalData.cloudReady && app.isLoggedIn()) {
          app.refreshBabies().then(() => this.syncGlobalToView()).catch(() => {})
        }
        setTimeout(() => { wx.showToast({ title: '已登录，再次点击即可创建宝宝', icon: 'none' }) }, 400)
      },
      onGuestClose: () => {
        wx.showToast({ title: '登录后即可创建宝宝', icon: 'none' })
      }
    })
  },

  _openCreateForm() {
    this.setData({
      formMode: 'create',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: ''
    })
  },

  /** 官方 chooseAvatar 组件回调（新建宝宝表单）：选图后先异步审核，通过才确认头像 */
  async onFormChooseAvatar(e) {
    const { avatarUrl } = e.detail || {}
    if (!avatarUrl) return
    const { auditAvatar } = require('../../utils/avatar')
    this.setData({ formAvatarAuditing: true })
    try {
      const result = await auditAvatar(avatarUrl)
      if (!result.passed) {
        this.setData({ formAvatarAuditing: false, formAvatar: '' })
        wx.showToast({ title: '头像未通过安全检测，请换一张', icon: 'none' })
        return
      }
      this.setData({ formAvatarAuditing: false, formAvatar: result.fileID })
      wx.showToast({ title: '已选择新头像', icon: 'success' })
    } catch (err) {
      console.warn('新建宝宝头像审核失败:', err)
      this.setData({ formAvatarAuditing: false, formAvatar: '' })
      wx.showToast({ title: '头像处理失败，请重试', icon: 'none' })
    }
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
      // 昵称安检（服务端 textCheck 兜底）
      if (app.globalData.cloudReady) {
        try {
          const check = await call('textCheck', { content: formName.trim(), scene: 1 })
          if (check && check.pass === false) {
            wx.hideLoading()
            wx.showToast({ title: '换个可爱的名字吧～', icon: 'none' })
            return
          }
        } catch (e) { /* 安检异常放行 */ }
      }

      let finalAvatar = ''
      // 头像上传：先传云存储（组件已做微信端安全检测），头像落库前在本地先显示为选图结果
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
      } else {
        finalAvatar = formAvatar
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
      const babies = await app.refreshBabies()
      app.setCurrentBaby(newBaby)
      this.syncGlobalToView()

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

  startJoinBaby() {
    if (app.isLoggedIn()) {
      this._openJoinForm()
      return
    }
    auth.ensureLogin(this, {
      onSuccess: () => {
        this.syncGlobalToView()
        if (app.globalData.cloudReady && app.isLoggedIn()) {
          app.refreshBabies().then(() => this.syncGlobalToView()).catch(() => {})
        }
        setTimeout(() => { wx.showToast({ title: '已登录，再次点击即可加入宝宝', icon: 'none' }) }, 400)
      },
      onGuestClose: () => {
        wx.showToast({ title: '登录后即可加入家人共享', icon: 'none' })
      }
    })
  },

  _openJoinForm() {
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
      const babies = await app.refreshBabies()
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

  // ============================================
  // 意见反馈
  // ============================================
  openFeedback() {
    this.setData({ showBabySheet: false })
    this.setData({ showFeedbackSheet: true })
  },

  closeFeedback() {
    this.setData({ showFeedbackSheet: false })
    this._resumeRainIfNeeded()
  },

  onFeedbackTypeTap(e) {
    this.setData({ feedbackType: e.currentTarget.dataset.key })
  },

  onFeedbackInput(e) {
    this.setData({ feedbackContent: e.detail.value })
  },

  onFeedbackContactInput(e) {
    this.setData({ feedbackContact: e.detail.value })
  },

  async submitFeedback() {
    const content = (this.data.feedbackContent || '').trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (this.data.feedbackSending) return

    // 反馈内容安检（服务端）
    if (app.globalData.cloudReady) {
      try {
        const check = await call('textCheck', { content, scene: 4 })
        if (check && check.pass === false) {
          wx.showToast({ title: '反馈内容不太合适，换个说法吧～', icon: 'none' })
          return
        }
      } catch (e) { /* 安检异常放行 */ }
    }

    this.setData({ feedbackSending: true })

    const payload = {
      type: this.data.feedbackType,
      content,
      contact: (this.data.feedbackContact || '').trim(),
      page: 'index',
      userAgent: 'mini-program'
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'feedback',
        data: payload
      })
      if (res.result && res.result.code === 0) {
        this.setData({ showFeedbackSheet: false, feedbackContent: '', feedbackContact: '' })
        wx.showToast({ title: '感谢你的反馈 🌱', icon: 'none' })
      } else {
        this._feedbackLocalFallback(payload)
      }
    } catch (err) {
      this._feedbackLocalFallback(payload)
    } finally {
      this.setData({ feedbackSending: false })
    }
  },

  _feedbackLocalFallback(payload) {
    this.setData({ showFeedbackSheet: false, feedbackContent: '', feedbackContact: '' })
    wx.showModal({
      title: '反馈提交暂不可用',
      content: '云端反馈通道暂未开通，你可以将反馈内容发送至联系邮箱 2662481663@qq.com，我们会尽快查看。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  showLoginInPanel() {
    const wasBabySheetOpen = this.data.showBabySheet
    if (wasBabySheetOpen) {
      this.setData({ showBabySheet: false })
    }
    auth.ensureLogin(this, {
      onSuccess: () => {
        this.syncGlobalToView()
        if (app.globalData.cloudReady && app.isLoggedIn()) {
          app.refreshBabies().then(() => this.syncGlobalToView()).catch(() => {})
        }
      },
      onGuestClose: () => {
        if (wasBabySheetOpen) {
          this.setData({ showBabySheet: true, formMode: '' })
        }
      }
    })
  },

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

    if (!app.isLoggedIn()) {
      wx.showToast({ title: '已记录 · 登录后自动同步云端', icon: 'none' })
    }
  },

  onShareAppMessage() {
    return {
      title: '宝宝日志 - 智能预测宝宝作息',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return { title: '我用宝宝日志科学记录宝宝作息' }
  },

  _onSheetTouchStart(e) {
    this._sheetDragStartY = e.touches[0].clientY
    this._sheetDragCurrent = e.touches[0].clientY
  },
  _onSheetTouchMove(e) {
    this._sheetDragCurrent = e.touches[0].clientY
  },
  _onSheetTouchEnd(e) {
    const startY = this._sheetDragStartY
    const endY = this._sheetDragCurrent
    if (typeof startY !== 'number' || typeof endY !== 'number') return
    this._sheetDragStartY = null
    this._sheetDragCurrent = null
    if (endY - startY > 50) {
      const handler = e.currentTarget.dataset.close
      if (handler && typeof this[handler] === 'function') this[handler]()
    }
  }
})