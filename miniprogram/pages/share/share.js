// pages/share/share.js - 每日小结分享卡片（3 套主题 + Canvas 修复）
const app = getApp()
const { call } = require('../../utils/request')
const { minutesToText, toMs } = require('../../utils/time')

// 设计稿基准尺寸（逻辑像素）
const DESIGN_W = 375
const DESIGN_H = 667

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

    // 先尝试本地缓存
    const babyInfo = wx.getStorageSync('babyInfo')
    if (babyInfo && babyInfo.name) {
      this.setData({ babyName: babyInfo.name })
    }

    // 优先尝试云端
    if (app.globalData.isOnline) {
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
        console.warn('云端拉取失败，尝试本地缓存:', err)
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
   * ===== Canvas 初始化（修复空白核心） =====
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

          // 绘制
          await this.drawCard(ctx, displayW, displayH)

          this.setData({ canvasReady: true, loading: false })
          resolve(true)
        })
    })
  },

  /**
   * 根据当前主题绘制卡片
   */
  async drawCard(ctx, W, H) {
    const theme = this.data.currentTheme
    // 清空画布
    ctx.clearRect(0, 0, W, H)

    switch (theme) {
      case 'warm':
        await this.drawWarmTheme(ctx, W, H)
        break
      case 'funny':
        await this.drawFunnyTheme(ctx, W, H)
        break
      case 'simple':
        await this.drawSimpleTheme(ctx, W, H)
        break
    }
  },

  /* ============================================
     主题 1：暖心治愈风
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
    ctx.fillText(`☀️ ${this.data.babyName}的元气一天`, centerX, 60)

    // 副标题
    ctx.fillStyle = '#B5A795'
    ctx.font = '13px sans-serif'
    ctx.fillText(`${this.data.todayLabel} ${this.data.weekdayText}`, centerX, 84)

    // 中间插图区（绘制简笔宝宝）
    this.drawBabyIllustration(ctx, centerX, 170, 60)

    // ===== 正文数据 =====
    let y = 280
    const lineH = 38

    ctx.textAlign = 'left'
    ctx.fillStyle = '#5D4F3F'

    // 第一行：喝奶 + 小觉
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
    y += 50
    ctx.textAlign = 'center'
    ctx.fillStyle = '#D4B896'
    ctx.font = '16px sans-serif'
    ctx.fillText('♡ ─────── ♡', centerX, y)

    // ===== 底部金句 =====
    y += 40
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 17px sans-serif'
    ctx.textAlign = 'center'
    this.drawWrappedText(ctx, '你是爸爸妈妈在这个世界上', centerX, y, W - 56, 24)
    y += 28
    this.drawWrappedText(ctx, '捡到的最好的礼物 🎁', centerX, y, W - 56, 24)

    // ===== 底部小程序码 =====
    await this.drawQRCode(ctx, centerX, H - 110, 70)

    // 最底部小字
    ctx.fillStyle = '#B5A795'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('记录于「秒记宝宝」小程序', centerX, H - 20)
  },

  /* ============================================
     主题 2：幽默调皮风
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

    // 中间插图：拿着奶瓶的宝宝
    this.drawBabyWithBottle(ctx, centerX, 170, 50)

    // ===== KPI 数据列表 =====
    let y = 270
    const lineH = 48

    // 干饭王
    this.drawKPILine(ctx, padding, y, W - padding * 2, '🍼', '干饭王',
      `${this.data.summary.feedCount} 顿`, '嗝~', '#E89B5F')
    y += lineH

    // 睡眠 KPI
    const sleepHours = Math.floor(this.data.summary.sleepDuration / 60) || 0
    const awakeTimes = Math.max(0, Math.floor(this.data.summary.feedCount / 3))
    this.drawKPILine(ctx, padding, y, W - padding * 2, '😴', '睡眠KPI',
      `${sleepHours} 小时`, `其实醒了${awakeTimes}次`, '#8B7AAA')
    y += lineH

    // 清洁工
    this.drawKPILine(ctx, padding, y, W - padding * 2, '🧷', '清洁工',
      `${this.data.summary.diaperCount} 次`, '辛苦奶奶啦', '#7AAFA8')
    y += lineH + 10

    // ===== 底部金句 =====
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('虽然偶尔哭闹', centerX, y)
    y += 26
    ctx.fillText('但依然是全家人的开心果 ✨', centerX, y)

    // ===== 小程序码 =====
    await this.drawQRCode(ctx, centerX, H - 110, 70)

    ctx.fillStyle = '#B5A795'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('记录于「秒记宝宝」小程序', centerX, H - 20)
  },

  /**
   * 绘制 KPI 单行（幽默风）
   */
  drawKPILine(ctx, x, y, w, icon, label, value, suffix, color) {
    // 背景卡片
    ctx.fillStyle = '#FFFFFF'
    this.roundRect(ctx, x, y - 18, w, 40, 12)
    ctx.fill()
    ctx.strokeStyle = '#F0E8DE'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.textAlign = 'left'

    // 图标
    ctx.font = '18px sans-serif'
    ctx.fillText(icon, x + 12, y + 6)

    // 标签
    ctx.fillStyle = '#8B7D6E'
    ctx.font = '13px sans-serif'
    ctx.fillText(label, x + 40, y + 6)

    // 数值（大字突出）
    ctx.fillStyle = color
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText(value, x + 115, y + 6)

    // 后缀
    ctx.fillStyle = '#B5A795'
    ctx.font = '11px sans-serif'
    ctx.fillText(suffix, x + 115 + ctx.measureText(value).width + 8, y + 6)
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
    ctx.fillText(`${this.data.babyName}今天很好！`, centerX, 80)

    ctx.fillStyle = '#8B7D6E'
    ctx.font = '16px sans-serif'
    ctx.fillText(`${this.data.todayLabel}`, centerX, 110)

    // 分隔线
    ctx.strokeStyle = '#D4B896'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(padding, 140)
    ctx.lineTo(W - padding, 140)
    ctx.stroke()

    // ===== 大号图标 + 数字 =====
    const itemH = 120
    const items = [
      { icon: '🍼', label: '吃了', value: `${this.data.summary.feedCount} 次`, color: '#E89B5F' },
      { icon: '😴', label: '睡了', value: `${Math.floor(this.data.summary.sleepDuration / 60) || 0} 小时`, color: '#8B7AAA' },
      { icon: '💩', label: '便便', value: `${this.data.summary.diaperCount} 次换洗`, color: '#7AAFA8' }
    ]

    let y = 180
    items.forEach((item, i) => {
      const rowY = y + i * itemH

      // 图标（超大）
      ctx.textAlign = 'center'
      ctx.font = '40px sans-serif'
      ctx.fillText(item.icon, padding + 30, rowY + 10)

      // 标签
      ctx.textAlign = 'left'
      ctx.fillStyle = '#5D4F3F'
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(item.label, padding + 70, rowY - 5)

      // 数值（大号加粗，老年人友好）
      ctx.fillStyle = item.color
      ctx.font = 'bold 28px sans-serif'
      ctx.fillText(item.value, padding + 70, rowY + 28)
    })

    // ===== 底部大号文字 =====
    const bottomY = y + items.length * itemH + 10
    ctx.textAlign = 'center'
    ctx.fillStyle = '#3D3027'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText('别担心，一切顺利', centerX, bottomY)

    ctx.fillStyle = '#D4B896'
    ctx.font = '16px sans-serif'
    ctx.fillText('—— 秒记宝宝', centerX, bottomY + 30)

    // ===== 小程序码 =====
    await this.drawQRCode(ctx, centerX, H - 110, 70)

    ctx.fillStyle = '#B5A795'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('扫码查看详细记录', centerX, H - 20)
  },

  /* ============================================
     公共绘制辅助方法
     ============================================ */

  /**
   * 绘制简笔宝宝（治愈风插图）
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
   * 绘制拿奶瓶的宝宝（幽默风插图）
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
   * 绘制小程序码（带降级占位）
   */
  async drawQRCode(ctx, cx, cy, size) {
    try {
      if (!app.globalData.isOnline) throw new Error('离线状态')

      const result = await wx.cloud.callFunction({
        name: 'getMiniProgramCode',
        data: {
          page: 'pages/index/index',
          scene: `baby_${app.globalData.babyId || 'default'}`
        }
      })

      if (result.result && result.result.fileID) {
        const fileRes = await wx.cloud.downloadFile({ fileID: result.result.fileID })
        if (this._canvasNode && fileRes.tempFilePath) {
          const img = this._canvasNode.createImage()
          await new Promise((resolve) => {
            img.onload = resolve
            img.onerror = resolve
            img.src = fileRes.tempFilePath
          })
          // 白底
          ctx.fillStyle = '#FFFFFF'
          this.roundRect(ctx, cx - size / 2 - 6, cy - size / 2 - 6, size + 12, size + 12, 8)
          ctx.fill()
          ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size)
          return
        }
      }
      throw new Error('无 fileID')
    } catch (err) {
      // 降级：绘制占位框
      ctx.fillStyle = '#F5EBDD'
      this.roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 8)
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
