// pages/share/share.js - 每日小结分享卡片
const app = getApp()
const { call } = require('../../utils/request')
const { formatTime, minutesToText } = require('../../utils/time')

Page({
  data: {
    todayLabel: '',
    summary: {
      feedCount: 0,
      diaperCount: 0,
      sleepDuration: 0,
      sleepText: '0h',
      firstFeedTime: '--',
      lastFeedTime: '--'
    },
    canvasReady: false,
    tempFilePath: ''
  },

  onLoad() {
    const today = new Date()
    this.setData({
      todayLabel: `${today.getMonth() + 1}月${today.getDate()}日`
    })
    this.loadSummary()
  },

  /**
   * 拉取当日汇总数据
   */
  async loadSummary() {
    wx.showLoading({ title: '加载中...' })
    try {
      const result = await call('getDailySummary', {
        babyId: app.globalData.babyId || 'default',
        date: new Date().toISOString().slice(0, 10)
      })

      if (result) {
        const sleepText = minutesToText(result.sleepDuration || 0)
        this.setData({
          summary: {
            feedCount: result.feedCount || 0,
            diaperCount: result.diaperCount || 0,
            sleepDuration: result.sleepDuration || 0,
            sleepText,
            firstFeedTime: result.firstFeedTime ? formatTime(result.firstFeedTime) : '--',
            lastFeedTime: result.lastFeedTime ? formatTime(result.lastFeedTime) : '--'
          }
        })

        // 数据准备好后绘制 canvas
        setTimeout(() => this.drawShareCard(), 100)
      }
    } catch (err) {
      console.warn('拉取汇总数据失败:', err)
    } finally {
      wx.hideLoading()
    }
  },

  /**
   * 绘制 750x1334 分享卡片
   */
  drawShareCard() {
    const query = wx.createSelectorQuery()
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res[0]) return

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio

        // 设计稿 750x1334，实际按屏幕宽度等比缩放
        const displayWidth = res[0].width
        const displayHeight = res[0].height
        canvas.width = displayWidth * dpr
        canvas.height = displayHeight * dpr
        ctx.scale(dpr, dpr)

        const W = displayWidth
        const H = displayHeight

        // === 背景 ===
        const gradient = ctx.createLinearGradient(0, 0, 0, H)
        gradient.addColorStop(0, '#FAF6F0')
        gradient.addColorStop(1, '#F5EBDD')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, W, H)

        // === 顶部装饰 ===
        ctx.fillStyle = '#D4B896'
        ctx.beginPath()
        ctx.arc(W / 2, 80, 50, 0, 2 * Math.PI)
        ctx.fill()

        ctx.font = '48px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('👶', W / 2, 95)

        // === 标题 ===
        ctx.fillStyle = '#3D3027'
        ctx.font = 'bold 36px sans-serif'
        ctx.fillText('秒记宝宝', W / 2, 180)

        ctx.fillStyle = '#8B7D6E'
        ctx.font = '24px sans-serif'
        ctx.fillText(`${this.data.todayLabel} 作息小结`, W / 2, 220)

        // === 分隔线 ===
        ctx.strokeStyle = '#F0E8DE'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(60, 250)
        ctx.lineTo(W - 60, 250)
        ctx.stroke()

        // === 数据卡片区域 ===
        const cardY = 290
        const cardH = 140
        const cardW = W - 80
        const cardX = 40
        const gap = 20

        // 喂奶卡片
        this.drawDataCard(ctx, cardX, cardY, cardW, cardH,
          '🍼', '喂奶次数', `${this.data.summary.feedCount}`, '次')

        // 换尿布卡片
        this.drawDataCard(ctx, cardX, cardY + cardH + gap, cardW, cardH,
          '🧷', '换尿布', `${this.data.summary.diaperCount}`, '次')

        // 睡眠卡片
        this.drawDataCard(ctx, cardX, cardY + (cardH + gap) * 2, cardW, cardH,
          '🌙', '睡眠总时长', this.data.summary.sleepText, '')

        // === 详细信息 ===
        const detailY = cardY + (cardH + gap) * 3 + 20
        ctx.fillStyle = '#8B7D6E'
        ctx.font = '22px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`首次喂奶：${this.data.summary.firstFeedTime}`, 60, detailY)
        ctx.fillText(`末次喂奶：${this.data.summary.lastFeedTime}`, 60, detailY + 36)

        // === 底部信息 ===
        ctx.fillStyle = '#B5A795'
        ctx.font = '20px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('让育儿记录变得更简单', W / 2, H - 200)

        // === 小程序码区域 ===
        // 获取小程序码
        await this.drawMiniProgramCode(ctx, canvas, W, H)

        ctx.fillStyle = '#D4B896'
        ctx.font = '22px sans-serif'
        ctx.fillText('扫码体验「秒记宝宝」', W / 2, H - 60)

        this.setData({ canvasReady: true })
      })
  },

  /**
   * 绘制单个数据卡片
   */
  drawDataCard(ctx, x, y, w, h, icon, label, value, unit) {
    // 背景
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    this.roundRect(ctx, x, y, w, h, 20)
    ctx.fill()

    // 阴影
    ctx.shadowColor = 'rgba(180, 150, 110, 0.12)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 4

    // 图标
    ctx.font = '40px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(icon, x + 30, y + h / 2 + 14)

    // 标签
    ctx.shadowBlur = 0
    ctx.fillStyle = '#8B7D6E'
    ctx.font = '24px sans-serif'
    ctx.fillText(label, x + 100, y + h / 2 - 10)

    // 数值
    ctx.fillStyle = '#D4B896'
    ctx.font = 'bold 48px sans-serif'
    ctx.fillText(value, x + 100, y + h / 2 + 35)

    // 单位
    const valueWidth = ctx.measureText(value).width
    ctx.fillStyle = '#8B7D6E'
    ctx.font = '22px sans-serif'
    ctx.fillText(unit, x + 100 + valueWidth + 6, y + h / 2 + 32)
  },

  /**
   * 圆角矩形辅助
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
   * 获取并绘制小程序码
   */
  async drawMiniProgramCode(ctx, canvas, W, H) {
    try {
      // 通过云函数获取小程序码
      const result = await wx.cloud.callFunction({
        name: 'getMiniProgramCode',
        data: { page: 'pages/index/index', scene: 'share_card' }
      })

      if (result.result && result.result.fileID) {
        // 下载图片
        const fileRes = await wx.cloud.downloadFile({ fileID: result.result.fileID })
        const img = canvas.createImage()
        await new Promise((resolve) => {
          img.onload = resolve
          img.onerror = resolve
          img.src = fileRes.tempFilePath
        })

        // 绘制小程序码
        const codeSize = 140
        const codeX = (W - codeSize) / 2
        const codeY = H - 180

        // 白底
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        this.roundRect(ctx, codeX - 10, codeY - 10, codeSize + 20, codeSize + 20, 12)
        ctx.fill()

        ctx.drawImage(img, codeX, codeY, codeSize, codeSize)
      } else {
        // 后备方案：绘制占位框
        const codeSize = 140
        const codeX = (W - codeSize) / 2
        const codeY = H - 180

        ctx.fillStyle = '#F5EBDD'
        ctx.beginPath()
        this.roundRect(ctx, codeX, codeY, codeSize, codeSize, 12)
        ctx.fill()

        ctx.fillStyle = '#B5A795'
        ctx.font = '20px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('小程序码', codeX + codeSize / 2, codeY + codeSize / 2 + 6)
      }
    } catch (err) {
      console.warn('获取小程序码失败:', err)
    }
  },

  /**
   * 保存图片到相册
   */
  async saveImage() {
    if (!this.data.canvasReady) {
      wx.showToast({ title: '卡片生成中，请稍候', icon: 'none' })
      return
    }

    try {
      const { tempFilePath } = await wx.canvasToTempFilePath({
        canvas: (await wx.createSelectorQuery().select('#shareCanvas').fields({ node: true }).exec())[0].node,
        fileType: 'png',
        quality: 1
      })

      await wx.saveImageToPhotosAlbum({
        filePath: tempFilePath
      })

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
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    }
  },

  /**
   * 分享到聊天
   */
  onShareAppMessage() {
    return {
      title: `我家宝宝今日作息小结（${this.data.todayLabel}）`,
      path: '/pages/index/index',
      imageUrl: this.data.tempFilePath || ''
    }
  }
})
