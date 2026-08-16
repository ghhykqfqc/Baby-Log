// pages/growth/growth.js - 成长档案
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime } = require('../../utils/time')

Page({
  data: {
    babyInfo: {},
    records: [],
    showForm: false,
    formData: {
      height: '',
      weight: '',
      measureDate: ''
    },
    chartType: 'weight',  // weight | height
    loading: true
  },

  onLoad() {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    this.setData({ 'formData.measureDate': todayStr })
  },

  onShow() {
    this.loadData()
  },

  /**
   * 拉取成长数据
   */
  async loadData() {
    // 本地缓存
    const cached = storage.get(storage.CACHE_KEYS.GROWTH_DATA) || []
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || {}
    this.setData({ babyInfo, records: cached })
    if (cached.length > 0) this.drawChart()

    // 云端
    try {
      const result = await call('getGrowthData', {
        babyId: app.globalData.babyId || 'default'
      })
      if (result && result.records) {
        this.setData({ records: result.records })
        storage.set(storage.CACHE_KEYS.GROWTH_DATA, result.records)
        this.drawChart()
      }
    } catch (err) {
      console.warn('拉取成长数据失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 显示录入表单
   */
  showAddForm() {
    this.setData({ showForm: true })
  },

  hideForm() {
    this.setData({ showForm: false })
  },

  onHeightInput(e) {
    this.setData({ 'formData.height': e.detail.value })
  },

  onWeightInput(e) {
    this.setData({ 'formData.weight': e.detail.value })
  },

  onDateChange(e) {
    this.setData({ 'formData.measureDate': e.detail.value })
  },

  /**
   * 提交成长数据
   */
  async submitGrowth() {
    const { height, weight, measureDate } = this.data.formData
    if (!height && !weight) {
      wx.showToast({ title: '请至少填写身高或体重', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })
    try {
      await call('addGrowthData', {
        babyId: app.globalData.babyId || 'default',
        height: height ? parseFloat(height) : null,
        weight: weight ? parseFloat(weight) : null,
        measureDate
      })

      // 刷新数据
      this.setData({ showForm: false, 'formData.height': '', 'formData.weight': '' })
      await this.loadData()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  /**
   * 切换图表类型
   */
  switchChart(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ chartType: type })
    this.drawChart()
  },

  /**
   * 使用 Canvas 2D 绘制生长曲线（叠加 WHO 标准曲线）
   */
  drawChart() {
    const query = wx.createSelectorQuery()
    query.select('#growthChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio
        const width = res[0].width
        const height = res[0].height

        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)

        // 清空画布
        ctx.fillStyle = '#FAF6F0'
        ctx.fillRect(0, 0, width, height)

        // 绘制 WHO 标准曲线（示例参考数据）
        this.drawWHOStandards(ctx, width, height)

        // 绘制宝宝实际数据
        this.drawBabyCurve(ctx, width, height)

        // 绘制坐标轴
        this.drawAxes(ctx, width, height)
      })
  },

  /**
   * 绘制坐标轴
   */
  drawAxes(ctx, width, height) {
    const padding = { left: 50, right: 20, top: 20, bottom: 40 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    ctx.strokeStyle = '#E0D8CE'
    ctx.lineWidth = 1
    ctx.font = '10px sans-serif'
    ctx.fillStyle = '#8B7D6E'

    // Y 轴
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, padding.top + chartH)
    ctx.stroke()

    // X 轴
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top + chartH)
    ctx.lineTo(padding.left + chartW, padding.top + chartH)
    ctx.stroke()

    // Y 轴标签
    const type = this.data.chartType
    const yLabel = type === 'weight' ? '体重(kg)' : '身高(cm)'
    const yMax = type === 'weight' ? 15 : 100
    const yMin = type === 'weight' ? 0 : 40

    for (let i = 0; i <= 5; i++) {
      const yVal = yMin + (yMax - yMin) * (i / 5)
      const yPos = padding.top + chartH - (chartH * i / 5)
      ctx.fillText(yVal.toFixed(0), 10, yPos + 3)
    }

    // X 轴标签（月龄）
    const months = [0, 3, 6, 12, 24, 36]
    months.forEach((m, i) => {
      const xPos = padding.left + (chartW * i / (months.length - 1))
      ctx.fillText(`${m}月`, xPos - 8, padding.top + chartH + 16)
    })
  },

  /**
   * 绘制 WHO 标准参考曲线（50 百分位）
   */
  drawWHOStandards(ctx, width, height) {
    const padding = { left: 50, right: 20, top: 20, bottom: 40 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    // WHO 体重标准（男，50百分位，0-36月）
    const whoWeight = [
      { month: 0, val: 3.3 },
      { month: 3, val: 6.0 },
      { month: 6, val: 7.9 },
      { month: 12, val: 9.6 },
      { month: 24, val: 12.2 },
      { month: 36, val: 14.3 }
    ]
    // WHO 身高标准（男，50百分位）
    const whoHeight = [
      { month: 0, val: 50 },
      { month: 3, val: 61 },
      { month: 6, val: 67 },
      { month: 12, val: 76 },
      { month: 24, val: 87 },
      { month: 36, val: 95 }
    ]

    const data = this.data.chartType === 'weight' ? whoWeight : whoHeight
    const yMax = this.data.chartType === 'weight' ? 15 : 100
    const yMin = this.data.chartType === 'weight' ? 0 : 40

    // 绘制参考区域（3-97百分位示意阴影）
    ctx.fillStyle = 'rgba(212, 184, 150, 0.1)'
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = padding.left + (chartW * i / (data.length - 1))
      const y = padding.top + chartH - (chartH * (d.val - yMin) / (yMax - yMin)) - 20
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    // 回到基线形成填充
    for (let i = data.length - 1; i >= 0; i--) {
      const x = padding.left + (chartW * i / (data.length - 1))
      const y = padding.top + chartH - (chartH * (data[i].val - yMin) / (yMax - yMin)) + 20
      ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()

    // 绘制 50 百分位线
    ctx.strokeStyle = '#D4B896'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 3])
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = padding.left + (chartW * i / (data.length - 1))
      const y = padding.top + chartH - (chartH * (d.val - yMin) / (yMax - yMin))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])

    // 图例文字
    ctx.fillStyle = '#B5A795'
    ctx.font = '10px sans-serif'
    ctx.fillText('--- WHO 标准', padding.left + 10, padding.top + 14)
  },

  /**
   * 绘制宝宝实际数据曲线
   */
  drawBabyCurve(ctx, width, height) {
    const records = this.data.records.filter(r => {
      return this.data.chartType === 'weight' ? r.weight : r.height
    })

    if (records.length === 0) return

    const padding = { left: 50, right: 20, top: 20, bottom: 40 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom
    const yMax = this.data.chartType === 'weight' ? 15 : 100
    const yMin = this.data.chartType === 'weight' ? 0 : 40

    // 计算宝宝月龄
    const babyInfo = this.data.babyInfo
    const birthDate = babyInfo.birthDate ? new Date(babyInfo.birthDate) : new Date()

    ctx.strokeStyle = '#E89B5F'
    ctx.lineWidth = 3
    ctx.beginPath()

    records.forEach((r, i) => {
      const measureDate = new Date(r.measureDate)
      const monthAge = (measureDate - birthDate) / (30 * 24 * 60 * 60 * 1000)
      const monthClamped = Math.max(0, Math.min(36, monthAge))

      const x = padding.left + (chartW * monthClamped / 36)
      const val = this.data.chartType === 'weight' ? r.weight : r.height
      const y = padding.top + chartH - (chartH * (val - yMin) / (yMax - yMin))

      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)

      // 数据点
      ctx.fillStyle = '#E89B5F'
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, 2 * Math.PI)
      ctx.fill()
    })

    ctx.stroke()

    // 图例
    ctx.fillStyle = '#E89B5F'
    ctx.font = '10px sans-serif'
    ctx.fillText('● 宝宝数据', padding.left + 100, padding.top + 14)
  }
})
