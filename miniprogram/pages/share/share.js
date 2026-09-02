// pages/share/share.js - 每日小结分享卡片（3 套主题 + 头像 + 底部页脚布局）
const app = getApp()
const { call } = require('../../utils/request')
const { minutesToText, toMs } = require('../../utils/time')

Page({
  data: {
    todayLabel: '',
    weekdayText: '',
    loading: true,
    dataSource: '',
    canvasReady: false,
    tempFilePath: '',
    currentTheme: 'warm',
    themes: [
      { key: 'warm', label: '暖心治愈', icon: '☀️' },
      { key: 'funny', label: '幽默调皮', icon: '📝' },
      { key: 'simple', label: '适老大字', icon: '🔍' }
    ],
    // 聚合数据
    summary: {
      feedCount: 0,
      diaperCount: 0,
      sleepDuration: 0,
      sleepText: '0小时',
      feedAmount: 0,
      firstFeedTime: '--',
      lastFeedTime: '--'
    },
    babyName: '宝宝'
  },

  // Canvas 节点引用（保存避免重复查询）
  _canvasNode: null,
  _ctx: null,
  _dpr: 1,
  _avatarPath: '',   // 宝宝头像本地临时路径（空 = 未上传，回退简笔笑脸）
  _avatarImg: null,  // 已加载进 canvas 的头像 Image 对象
  _qrPath: '',       // 小程序码缓存（避免每次重绘都调云函数）

  onLoad() {
    const today = new Date()
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    this.setData({
      todayLabel: `${today.getMonth() + 1}月${today.getDate()}日`,
      weekdayText: `星期${weekdays[today.getDay()]}`
    })
    this.loadSummary()
  },

  /**
   * 拉取当日聚合数据
   */
  async loadSummary() {
    this.setData({ loading: true })

    // 宝宝昵称
    const babyInfo = wx.getStorageSync('babyInfo')
    if (babyInfo && babyInfo.name) {
      this.setData({ babyName: babyInfo.name })
    }

    // 宝宝头像（优先云端，失败回退默认笑脸）
    this._avatarPath = await this.prepareAvatarPath()

    // 优先尝试云端（云环境就绪且在线时）
    if (app.globalData.isOnline && app.globalData.cloudReady) {
      try {
        const result = await call('getDailySummary', {
          babyId: app.globalData.babyId || 'default',
          date: new Date().toISOString().slice(0, 10)
        })

        if (result) {
          this.setData({
            summary: {
              feedCount: result.feedCount || 0,
              diaperCount: result.diaperCount || 0,
              sleepDuration: result.sleepDuration || 0,
              sleepText: minutesToText(result.sleepDuration || 0),
              feedAmount: result.feedAmount || 0,
              firstFeedTime: result.firstFeedTime ? this.formatTime(result.firstFeedTime) : '--',
              lastFeedTime: result.lastFeedTime ? this.formatTime(result.lastFeedTime) : '--'
            },
            dataSource: '☁️ 数据来自云端'
          })
        }
      } catch (err) {
        console.warn('云端拉取失败，尝试本地缓存:', (err && err.message) || (err && err.errMsg) || err)
        this.loadFromCache()
      }
    } else {
      this.loadFromCache()
    }

    this.setData({ loading: false })

    // 等 WXML 渲染完成后绘制
    setTimeout(() => this.initAndDraw(), 100)
  },

  /**
   * 准备宝宝头像的本地可绘制路径
   * cloud fileID → 云端下载；http(s) → downloadFile；本地路径直接用
   * 任何失败都返回空串（绘制时回退默认笑脸）
   */
  async prepareAvatarPath() {
    try {
      const babyInfo = wx.getStorageSync('babyInfo') || {}
      const avatar = babyInfo.avatar
      if (!avatar) return ''

      if (avatar.startsWith('cloud://')) {
        if (!app.globalData.cloudReady) return ''
        const res = await wx.cloud.downloadFile({ fileID: avatar })
        return res.tempFilePath || ''
      }

      if (/^https?:\/\//.test(avatar)) {
        const res = await new Promise((resolve, reject) => {
          wx.downloadFile({ url: avatar, success: resolve, fail: reject })
        })
        return res.tempFilePath || ''
      }

      return avatar // 本地临时路径
    } catch (err) {
      console.warn('头像加载失败，使用默认笑脸:', (err && err.message) || err)
      return ''
    }
  },

  /**
   * 从本地缓存加载数据
   */
  loadFromCache() {
    const todayRecords = wx.getStorageSync('todayRecords') || []
    const feedCount = todayRecords.filter(r => r.recordType === 'feed').length
    const diaperCount = todayRecords.filter(r => r.recordType === 'diaper').length
    const sleepDuration = todayRecords
      .filter(r => r.recordType === 'sleep' && r.duration)
      .reduce((sum, r) => sum + (r.duration || 0), 0)

    this.setData({
      summary: {
        feedCount,
        diaperCount,
        sleepDuration,
        sleepText: minutesToText(sleepDuration),
        feedAmount: 0,
        firstFeedTime: '--',
        lastFeedTime: '--'
      },
      dataSource: '📱 数据来自本地记录'
    })
  },

  formatTime(ts) {
    const d = new Date(toMs(ts))
    if (isNaN(d.getTime())) return '--'
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  },

  /**
   * ===== Canvas 初始化 =====
   */
  async initAndDraw() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec(async (res) => {
          if (!res || !res[0] || !res[0].node) {
            console.error('Canvas 节点未找到，请检查 wxml')
            this.setData({ loading: false })
            resolve(false)
            return
          }

          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          const dpr = wx.getSystemInfoSync().pixelRatio || 2

          // 按显示尺寸 × dpr 设置画布像素
          const displayW = res[0].width
          const displayH = res[0].height
          canvas.width = displayW * dpr
          canvas.height = displayH * dpr
          ctx.scale(dpr, dpr)

          this._canvasNode = canvas
          this._ctx = ctx
          this._dpr = dpr

          // 预加载宝宝头像（无头像时保持 null，绘制时回退笑脸）
          this._avatarImg = null
          if (this._avatarPath) {
            try {
              const img = canvas.createImage()
              await new Promise((r) => { img.onload = r; img.onerror = r; img.src = this._avatarPath })
              if (img.width && img.height) this._avatarImg = img
            } catch (e) { /* 忽略，回退笑脸 */ }
          }

          // 绘制
          await this.drawCard(ctx, displayW, displayH)

          this.setData({ canvasReady: true, loading: false })
          resolve(true)
        })
    })
  },

  /**
   * 根据当前主题绘制卡片
   * 统一以设计稿基准（300×533）坐标绘制，再整体等比缩放，
   * 保证不同屏宽下排版一致，正文与页脚二维码互不遮挡
   */
  async drawCard(ctx, W, H) {
    const theme = this.data.currentTheme
    // 清空画布（设备坐标）
    ctx.clearRect(0, 0, W, H)

    const DW = 300  // 设计稿宽度（600rpx @375pt 屏幕）
    const DH = 533  // 设计稿高度（1066rpx @375pt 屏幕）

    ctx.save()
    ctx.scale(W / DW, H / DH)

    switch (theme) {
      case 'warm':
        await this.drawWarmTheme(ctx, DW, DH)
        break
      case 'funny':
        await this.drawFunnyTheme(ctx, DW, DH)
        break
      case 'simple':
        await this.drawSimpleTheme(ctx, DW, DH)
        break
    }

    ctx.restore()
  },

  /* ============================================
     主题 1：暖心治愈风
     布局：标题 → 头像/笑脸 → 数据三行 → 爱心分隔 → 金句 → 页脚（码右下角）
     ============================================ */
  async drawWarmTheme(ctx, W, H) {
    // 背景：奶咖色渐变
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H)
    bgGrad.addColorStop(0, '#FAF6F0')
    bgGrad.addColorStop(0.5, '#F5EBDD')
    bgGrad.addColorStop(1, '#FAF6F0')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, W, H)

    // 装饰圆点（左上、右下）
    ctx.fillStyle = 'rgba(212, 184, 150, 0.15)'
    ctx.beginPath(); ctx.arc(30, 40, 60, 0, 2 * Math.PI); ctx.fill()
    ctx.beginPath(); ctx.arc(W - 30, H - 60, 80, 0, 2 * Math.PI); ctx.fill()

    const padding = 28
    const centerX = W / 2

    // 顶部大标题
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 24px sans-serif'
    ctx.fillText(`☀️ ${this.data.babyName}的元气一天`, centerX, 54)

    // 副标题
    ctx.fillStyle = '#B5A795'
    ctx.font = '13px sans-serif'
    ctx.fillText(`${this.data.todayLabel} ${this.data.weekdayText}`, centerX, 78)

    // 中间插图区：宝宝头像（未上传时回退简笔笑脸）
    if (!this.drawBabyPhoto(ctx, centerX, 152, 50)) {
      this.drawBabyIllustration(ctx, centerX, 152, 50)
    }

    // ===== 正文数据 =====
    let y = 262
    const lineH = 38

    ctx.textAlign = 'left'
    ctx.fillStyle = '#5D4F3F'

    // 第一行：喝奶
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(`今天喝了`, padding, y)
    ctx.fillStyle = '#E89B5F'
    ctx.font = 'bold 24px sans-serif'
    const feedText = `${this.data.summary.feedCount}`
    ctx.fillText(feedText, padding + 85, y)
    ctx.fillStyle = '#5D4F3F'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(`顿奶，攒了`, padding + 85 + ctx.measureText(feedText).width + 6, y)

    // 睡眠
    y += lineH
    const sleepHours = Math.floor(this.data.summary.sleepDuration / 60) || 0
    ctx.fillStyle = '#5D4F3F'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(`${sleepHours} 个小觉`, padding, y)
    ctx.fillStyle = '#7AAFA8'
    ctx.fillText(`  😴`, padding + 100, y)

    // 换尿布
    y += lineH
    ctx.fillStyle = '#5D4F3F'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(`换了`, padding, y)
    ctx.fillStyle = '#8B7AAA'
    ctx.font = 'bold 24px sans-serif'
    const diaperText = `${this.data.summary.diaperCount}`
    ctx.fillText(diaperText, padding + 45, y)
    ctx.fillStyle = '#5D4F3F'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(`次尿布，全是黄金便 💩`, padding + 45 + ctx.measureText(diaperText).width + 6, y)

    // ===== 分隔小爱心 =====
    ctx.textAlign = 'center'
    ctx.fillStyle = '#D4B896'
    ctx.font = '16px sans-serif'
    ctx.fillText('♡ ─────── ♡', centerX, 384)

    // ===== 底部金句 =====
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 17px sans-serif'
    this.drawWrappedText(ctx, '你是爸爸妈妈在这个世界上', centerX, 412, W - 56, 24)
    this.drawWrappedText(ctx, '捡到的最好的礼物 🎁', centerX, 436, W - 56, 24)

    // ===== 页脚（分隔线 + 小程序码右下角 + 品牌文案左侧） =====
    await this.drawFooter(ctx, W, H, {
      dividerColor: 'rgba(212, 184, 150, 0.35)',
      brandColor: '#5D4F3F'
    })
  },

  /* ============================================
     主题 2：幽默调皮风
     布局：顶部条带 → 头像 → 三栏「业绩勋章」墙 → 金句 → 页脚
     每条业绩用「左图标圆 + 中标签+后缀 + 右数值」三段式，避免文字重叠
     ============================================ */
  async drawFunnyTheme(ctx, W, H) {
    // 背景：明亮活泼
    ctx.fillStyle = '#FFFBF5'
    ctx.fillRect(0, 0, W, H)

    // 顶部条带
    const topGrad = ctx.createLinearGradient(0, 0, W, 0)
    topGrad.addColorStop(0, '#F5C6A0')
    topGrad.addColorStop(0.5, '#E8D5B8')
    topGrad.addColorStop(1, '#F5C6A0')
    ctx.fillStyle = topGrad
    ctx.fillRect(0, 0, W, 100)

    const padding = 28
    const centerX = W / 2

    // 标题
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText(`📝 ${this.data.babyName}今日"业绩"`, centerX, 55)

    ctx.fillStyle = '#8B7D6E'
    ctx.font = '12px sans-serif'
    ctx.fillText(`${this.data.todayLabel}`, centerX, 78)

    // 中间插图：宝宝头像（未上传时回退拿奶瓶的简笔宝宝）
    if (!this.drawBabyPhoto(ctx, centerX, 150, 46)) {
      this.drawBabyWithBottle(ctx, centerX, 150, 46)
    }

    // ===== 业绩勋章墙（三行，每行三段式） =====
    const sleepHours = Math.floor(this.data.summary.sleepDuration / 60) || 0
    const awakeTimes = Math.max(0, Math.floor(this.data.summary.feedCount / 3))
    const medals = [
      { icon: '🍼', title: '干饭王',  value: `${this.data.summary.feedCount}`,  unit: '顿',  suffix: '嗝~',          color: '#E89B5F', bg: '#FCE8D6' },
      { icon: '😴', title: '睡眠KPI', value: `${sleepHours}`,                   unit: '小时', suffix: `醒了${awakeTimes}次`, color: '#8B7AAA', bg: '#EDE6F5' },
      { icon: '🧷', title: '清洁工',  value: `${this.data.summary.diaperCount}`, unit: '次',  suffix: '辛苦啦',       color: '#7AAFA8', bg: '#E2EFED' }
    ]

    let y = 232
    medals.forEach((m) => {
      this.drawMedalRow(ctx, padding, y, W - padding * 2, m)
      y += 52
    })

    // ===== 底部金句 =====
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('虽然偶尔哭闹', centerX, 404)
    ctx.fillText('但依然是全家人的开心果 ✨', centerX, 428)

    // ===== 页脚 =====
    await this.drawFooter(ctx, W, H, {
      dividerColor: '#F0E8DE',
      brandColor: '#3D3027'
    })
  },

  /**
   * 绘制单行业绩勋章（幽默风专用）
   * 三段式：[左] 圆形图标徽章  [中] 称号 + 吐槽后缀（上下两行）  [右] 大数值 + 单位
   * 所有文字位置基于实测宽度定位，不硬编码偏移，彻底避免重叠
   */
  drawMedalRow(ctx, x, y, w, m) {
    const cardH = 44
    const cardY = y - cardH / 2

    // 1. 卡片底
    ctx.fillStyle = '#FFFFFF'
    this.roundRect(ctx, x, cardY, w, cardH, 14)
    ctx.fill()
    ctx.strokeStyle = '#F0E8DE'
    ctx.lineWidth = 1
    ctx.stroke()

    // 2. 左侧圆形图标徽章（带主题色浅底）
    const badgeR = 15
    const badgeCx = x + 22
    const badgeCy = y
    ctx.fillStyle = m.bg
    ctx.beginPath()
    ctx.arc(badgeCx, badgeCy, badgeR, 0, 2 * Math.PI)
    ctx.fill()
    ctx.font = '17px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(m.icon, badgeCx, badgeCy + 1)

    // 3. 右侧大数值区（数字 + 单位，作为整体右对齐贴卡片右边；单位紧跟数字后）
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = m.color
    ctx.font = 'bold 22px sans-serif'
    const valText = m.value
    const valW = ctx.measureText(valText).width

    ctx.font = '11px sans-serif'
    const unitText = m.unit
    const unitW = ctx.measureText(unitText).width

    const groupW = valW + unitW + 2            // 数字与单位间距 2px
    const groupRight = x + w - 12              // 整体右边界
    const valX = groupRight - groupW           // 数字左端
    const unitX = valX + valW + 2              // 单位左端（紧跟数字后）

    ctx.font = 'bold 22px sans-serif'
    ctx.fillText(valText, valX, y + 2)
    ctx.font = '11px sans-serif'
    ctx.fillText(unitText, unitX, y + 2)

    // 4. 中间称号 + 吐槽（左侧从徽章右边开始，右侧让出数值区，绝不重叠）
    const textLeft = badgeCx + badgeR + 10
    const textRight = valX - 14  // 数值区左侧再留 14px 间距
    const textMaxW = Math.max(60, textRight - textLeft)

    // 称号（粗体）
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText(m.title, textLeft, y - 2)

    // 吐槽后缀（小字，在称号下方，淡色）
    ctx.fillStyle = '#B5A795'
    ctx.font = '10px sans-serif'
    // 限制后缀宽度，过长截断
    let suffix = m.suffix
    while (ctx.measureText(suffix).width > textMaxW && suffix.length > 1) {
      suffix = suffix.slice(0, -1)
    }
    if (suffix !== m.suffix) suffix = suffix.slice(0, -1) + '…'
    ctx.fillText(suffix, textLeft, y + 13)
  },

  /* ============================================
     主题 3：适老大字版
     ============================================ */
  async drawSimpleTheme(ctx, W, H) {
    // 背景：高对比度浅色
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, W, H)

    // 顶部色块
    ctx.fillStyle = '#D4B896'
    ctx.fillRect(0, 0, W, 8)

    const padding = 30
    const centerX = W / 2

    // 超大字标题
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 32px sans-serif'
    ctx.fillText(`${this.data.babyName}今天很好！`, centerX, 66)

    ctx.fillStyle = '#8B7D6E'
    ctx.font = '16px sans-serif'
    ctx.fillText(`${this.data.todayLabel}`, centerX, 96)

    // 分隔线
    ctx.strokeStyle = '#D4B896'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(padding, 122)
    ctx.lineTo(W - padding, 122)
    ctx.stroke()

    // ===== 大号图标 + 数字 =====
    const itemH = 102
    const items = [
      { icon: '🍼', label: '吃了', value: `${this.data.summary.feedCount} 次`, color: '#E89B5F' },
      { icon: '😴', label: '睡了', value: `${Math.floor(this.data.summary.sleepDuration / 60) || 0} 小时`, color: '#8B7AAA' },
      { icon: '💩', label: '便便', value: `${this.data.summary.diaperCount} 次换洗`, color: '#7AAFA8' }
    ]

    let y = 156
    items.forEach((item, i) => {
      const rowY = y + i * itemH

      // 图标（超大）
      ctx.textAlign = 'center'
      ctx.font = '40px sans-serif'
      ctx.fillText(item.icon, padding + 30, rowY + 12)

      // 标签
      ctx.textAlign = 'left'
      ctx.fillStyle = '#5D4F3F'
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(item.label, padding + 70, rowY - 6)

      // 数值（大号加粗，老年人友好）
      ctx.fillStyle = item.color
      ctx.font = 'bold 28px sans-serif'
      ctx.fillText(item.value, padding + 70, rowY + 30)
    })

    // ===== 底部大号文字 =====
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText('别担心，一切顺利', centerX, 424)

    // ===== 页脚（品牌信息由页脚统一呈现） =====
    await this.drawFooter(ctx, W, H, {
      dividerColor: '#F0E8DE',
      brandColor: '#3D3027',
      hint: '长按识别小程序码'
    })
  },

  /* ============================================
     公共绘制辅助方法
     ============================================ */

  /**
   * 绘制页脚：分隔线 + 小程序码（右下角）+ 品牌文案（左侧）
   * 小程序码固定在右下角，绝不遮挡正文；左侧文字与码同行排布
   */
  async drawFooter(ctx, W, H, opts = {}) {
    const pad = 28
    const qrSize = 56

    // 分隔线（在二维码区域上方，留出安全间距）
    ctx.strokeStyle = opts.dividerColor || '#F0E8DE'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pad, H - 82)
    ctx.lineTo(W - pad, H - 82)
    ctx.stroke()

    // 小程序码：右下角，白底圆角卡片包裹
    const qrCx = W - pad - qrSize / 2
    const qrCy = H - 14 - qrSize / 2
    await this.drawQRCode(ctx, qrCx, qrCy, qrSize)

    // 左侧品牌文案（与二维码垂直居中对齐）
    ctx.textAlign = 'left'
    ctx.fillStyle = opts.brandColor || '#3D3027'
    ctx.font = 'bold 15px sans-serif'
    ctx.fillText('贝贝log', pad, H - 46)

    ctx.fillStyle = '#B5A795'
    ctx.font = '10px sans-serif'
    ctx.fillText(opts.hint || '长按识别小程序码 · 记录宝宝每一天', pad, H - 27)
  },

  /**
   * 绘制宝宝头像（圆形裁剪 + 装饰描边）
   * @returns {Boolean} true=已绘制头像；false=无头像，由调用方绘制默认笑脸
   */
  drawBabyPhoto(ctx, cx, cy, radius) {
    const img = this._avatarImg
    if (!img) return false

    ctx.save()
    // 圆形裁剪
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
    ctx.closePath()
    ctx.clip()

    // 兜底底色 + cover 模式绘制（居中裁切，避免拉伸变形）
    ctx.fillStyle = '#F5EBDD'
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    const scale = Math.max((radius * 2) / img.width, (radius * 2) / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
    ctx.restore()

    // 白色描边 + 淡奶咖外环（取消裁剪后绘制，保证描边完整）
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 2, 0, 2 * Math.PI)
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 5, 0, 2 * Math.PI)
    ctx.strokeStyle = 'rgba(212, 184, 150, 0.4)'
    ctx.lineWidth = 2
    ctx.stroke()

    return true
  },

  /**
   * 绘制简笔宝宝（治愈风插图，头像未上传时的默认笑脸）
   */
  drawBabyIllustration(ctx, cx, cy, size) {
    // 脸
    ctx.fillStyle = '#FFE4C4'
    ctx.beginPath()
    ctx.arc(cx, cy, size, 0, 2 * Math.PI)
    ctx.fill()
    ctx.strokeStyle = '#E89B5F'
    ctx.lineWidth = 2
    ctx.stroke()

    // 眯眯眼（睡觉的弧线）
    ctx.strokeStyle = '#5D4F3F'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(cx - size * 0.35, cy - size * 0.1, 6, 0, Math.PI, true)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx + size * 0.35, cy - size * 0.1, 6, 0, Math.PI, true)
    ctx.stroke()

    // 微笑
    ctx.beginPath()
    ctx.arc(cx, cy + size * 0.2, size * 0.2, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()

    // 腮红
    ctx.fillStyle = 'rgba(255, 182, 193, 0.5)'
    ctx.beginPath()
    ctx.arc(cx - size * 0.55, cy + size * 0.2, 8, 0, 2 * Math.PI)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx + size * 0.55, cy + size * 0.2, 8, 0, 2 * Math.PI)
    ctx.fill()
  },

  /**
   * 绘制拿奶瓶的宝宝（幽默风插图，头像未上传时的默认笑脸）
   */
  drawBabyWithBottle(ctx, cx, cy, size) {
    // 头
    ctx.fillStyle = '#FFE4C4'
    ctx.beginPath()
    ctx.arc(cx, cy, size, 0, 2 * Math.PI)
    ctx.fill()
    ctx.strokeStyle = '#E89B5F'
    ctx.lineWidth = 2
    ctx.stroke()

    // 圆眼
    ctx.fillStyle = '#3D3027'
    ctx.beginPath()
    ctx.arc(cx - size * 0.3, cy - size * 0.15, 4, 0, 2 * Math.PI)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx + size * 0.3, cy - size * 0.15, 4, 0, 2 * Math.PI)
    ctx.fill()

    // 大笑嘴
    ctx.strokeStyle = '#3D3027'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(cx, cy + size * 0.15, size * 0.3, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()

    // 奶瓶（右侧）
    const bx = cx + size * 0.8
    const by = cy + size * 0.3
    ctx.fillStyle = '#FFFFFF'
    ctx.strokeStyle = '#E89B5F'
    ctx.lineWidth = 2
    this.roundRect(ctx, bx - 8, by - 16, 16, 24, 3)
    ctx.fill()
    ctx.stroke()
    // 奶嘴
    ctx.fillStyle = '#F5C6A0'
    ctx.beginPath()
    ctx.arc(bx, by - 18, 5, 0, 2 * Math.PI)
    ctx.fill()
  },

  /**
   * 绘制小程序码（固定右下角页脚位置，带缓存与降级占位）
   */
  async drawQRCode(ctx, cx, cy, size) {
    try {
      if (!app.globalData.isOnline) throw new Error('离线状态')

      // 缓存小程序码临时路径，避免切换主题重复调云函数
      let tempPath = this._qrPath
      if (!tempPath) {
        const result = await wx.cloud.callFunction({
          name: 'getMiniProgramCode',
          data: {
            page: 'pages/index/index',
            scene: `baby_${app.globalData.babyId || 'default'}`
          }
        })

        if (result.result && result.result.fileID) {
          const fileRes = await wx.cloud.downloadFile({ fileID: result.result.fileID })
          tempPath = fileRes.tempFilePath
        }
        if (!tempPath) throw new Error('无小程序码')
        this._qrPath = tempPath
      }

      if (this._canvasNode) {
        const img = this._canvasNode.createImage()
        await new Promise((resolve) => {
          img.onload = resolve
          img.onerror = resolve
          img.src = tempPath
        })
        if (!img.width) throw new Error('小程序码图片加载失败')

        // 白底卡片
        ctx.fillStyle = '#FFFFFF'
        this.roundRect(ctx, cx - size / 2 - 5, cy - size / 2 - 5, size + 10, size + 10, 10)
        ctx.fill()
        ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size)
        return
      }
      throw new Error('画布未就绪')
    } catch (err) {
      // 降级：绘制占位框（同样固定在右下角，不遮挡正文）
      ctx.fillStyle = '#F5EBDD'
      this.roundRect(ctx, cx - size / 2 - 5, cy - size / 2 - 5, size + 10, size + 10, 10)
      ctx.fill()
      ctx.strokeStyle = '#D4B896'
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.fillStyle = '#D4B896'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('小程序码', cx, cy + 4)
    }
  },

  /**
   * 圆角矩形
   */
  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  },

  /**
   * 文本换行绘制
   */
  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const chars = text.split('')
    let line = ''
    let yPos = y

    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i]
      if (ctx.measureText(test).width > maxWidth && line.length > 0) {
        ctx.fillText(line, x, yPos)
        line = chars[i]
        yPos += lineHeight
      } else {
        line = test
      }
    }
    if (line) ctx.fillText(line, x, yPos)
  },

  /* ============================================
     用户交互
     ============================================ */

  /**
   * 切换主题
   */
  switchTheme(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.currentTheme) return

    this.setData({ currentTheme: key })

    // 重新绘制
    if (this._ctx && this._canvasNode) {
      const query = wx.createSelectorQuery().in(this)
      query.select('#shareCanvas')
        .fields({ size: true })
        .exec((res) => {
          if (res[0]) {
            this.drawCard(this._ctx, res[0].width, res[0].height)
          }
        })
    }
  },

  /**
   * 保存图片到相册
   */
  async saveImage() {
    if (!this.data.canvasReady || !this._canvasNode) {
      wx.showToast({ title: '卡片生成中，请稍候', icon: 'none' })
      return
    }

    try {
      const { tempFilePath } = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: this._canvasNode,
          fileType: 'png',
          quality: 1,
          success: resolve,
          fail: reject
        })
      })

      this.setData({ tempFilePath })

      await wx.saveImageToPhotosAlbum({ filePath: tempFilePath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('auth deny')) {
        wx.showModal({
          title: '提示',
          content: '需要相册权限才能保存图片，请前往设置开启',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting()
          }
        })
      } else if (err.errMsg && err.errMsg.includes('cancel')) {
        // 用户取消，不提示
      } else {
        console.warn('保存失败:', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    }
  },

  onShareAppMessage() {
    return {
      title: `我家${this.data.babyName}今日作息小结（${this.data.todayLabel}）`,
      path: '/pages/index/index',
      imageUrl: this.data.tempFilePath || ''
    }
  }
})
