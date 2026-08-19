// pages/growth/growth.js - 成长日志（简约大气版）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')

// 月份常量（按 30.44 天/月 计算平均月龄）
const DAYS_PER_MONTH = 30.44
const MS_PER_DAY = 24 * 60 * 60 * 1000

Page({
  data: {
    babyInfo: {},
    records: [],
    latest: null,        // 最新一条数据（含增幅信息）
    ageText: null,       // 当前月龄 { num, unit }
    birthLabel: '',      // 出生信息文案
    hasRecords: false,
    loading: true,
    showForm: false,
    submitting: false,
    formData: {
      height: '',
      weight: '',
      measureDate: ''
    },
    minDate: '',
    maxDate: '',
    focusHeight: false,
    focusWeight: false,
    chartType: 'weight'  // weight | height
  },

  onLoad() {
    const today = new Date()
    const todayStr = this.toDateStr(today)
    const range = this.getDateRange()
    this.setData({
      'formData.measureDate': todayStr,
      minDate: range.min,
      maxDate: range.max
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/growth/growth')
    }
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh())
  },

  toDateStr(d) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  getDateRange() {
    const now = new Date()
    const min = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    return { min: this.toDateStr(min), max: this.toDateStr(now) }
  },

  /**
   * 拉取成长数据（先本地缓存秒开，再拉云端覆盖）
   */
  async loadData() {
    const cached = storage.get(storage.CACHE_KEYS.GROWTH_DATA) || []
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || {}
    this.setData({ babyInfo })
    this.applyRecords(cached)

    try {
      const result = await call('getGrowthData', {
        babyId: app.globalData.babyId || 'default'
      })
      if (result && result.records) {
        storage.set(storage.CACHE_KEYS.GROWTH_DATA, result.records)
        this.applyRecords(result.records)
      }
    } catch (err) {
      console.warn('拉取成长数据失败，使用本地缓存:', (err && err.message) || (err && err.errMsg) || err)
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 数据预处理：排序 + 计算最新数据与增幅 + 展示文案
   */
  applyRecords(rawRecords) {
    const babyInfo = this.data.babyInfo
    const birthDate = babyInfo.birthDate ? new Date(babyInfo.birthDate.replace(/-/g, '/')) : null

    // 按测量日期升序排序
    const records = (rawRecords || [])
      .slice()
      .sort((a, b) => (a.measureDate || '').localeCompare(b.measureDate || ''))

    // 为每条记录补充展示字段
    const decorated = records.map((r) => ({
      ...r,
      displayDate: this.formatShortDate(r.measureDate),
      monthAgeText: birthDate ? this.getAgeText(birthDate, r.measureDate) : ''
    }))

    const latest = this.buildLatest(decorated)
    const ageText = birthDate && !isNaN(birthDate.getTime())
      ? { full: this.getAgeText(birthDate, null) }
      : null
    const birthLabel = this.buildBirthLabel(babyInfo)

    this.setData({
      records: decorated,
      latest,
      ageText,
      birthLabel,
      hasRecords: decorated.length > 0
    })

    if (decorated.length > 0) {
      // 等待 canvas 节点就绪
      setTimeout(() => this.drawChart(), 50)
    }
  },

  /**
   * 计算最新数据及增幅（与上一条同指标值的记录比较）
   */
  buildLatest(records) {
    if (!records.length) return null
    const last = records[records.length - 1]
    const latest = {
      ...last,
      heightDelta: null,
      weightDelta: null,
      heightDeltaText: '首次记录',
      weightDeltaText: '首次记录',
      heightDeltaClass: '',
      weightDeltaClass: ''
    }

    // 身高增幅
    for (let i = records.length - 2; i >= 0; i--) {
      if (records[i].height) {
        latest.heightDelta = this.round1(last.height - records[i].height)
        break
      }
    }
    // 体重增幅
    for (let i = records.length - 2; i >= 0; i--) {
      if (records[i].weight) {
        latest.weightDelta = this.round1(last.weight - records[i].weight)
        break
      }
    }

    latest.heightDeltaText = this.formatDelta(latest.heightDelta, 'cm')
    latest.weightDeltaText = this.formatDelta(latest.weightDelta, 'kg')
    latest.heightDeltaClass = this.deltaClass(latest.heightDelta)
    latest.weightDeltaClass = this.deltaClass(latest.weightDelta)
    return latest
  },

  formatDelta(delta, unit) {
    if (delta === undefined || delta === null) return '首次记录'
    if (delta === 0) return '持平'
    return `${delta > 0 ? '+' : ''}${delta} ${unit}`
  },

  deltaClass(delta) {
    if (delta === undefined || delta === null || delta === 0) return ''
    return delta > 0 ? 'up' : 'down'
  },

  round1(n) {
    if (n === undefined || n === null) return null
    return Math.round(n * 10) / 10
  },

  /**
   * 获取年龄文案（按出生日期到指定日期计算）
   * @returns {String} 如 "8个月" / "23天" / "1岁2个月"
   */
  getAgeText(birthDate, toDate) {
    const end = toDate ? new Date(toDate.replace(/-/g, '/')) : new Date()
    if (isNaN(end.getTime())) return ''
    const diffMs = end.getTime() - birthDate.getTime()
    if (diffMs <= 0) return '0天'

    const days = Math.floor(diffMs / MS_PER_DAY)
    if (days < 31) return `${days}天`

    const months = Math.floor(days / DAYS_PER_MONTH)
    if (months < 12) return `${months}个月`

    const years = Math.floor(months / 12)
    const remainMonths = months % 12
    return remainMonths ? `${years}岁${remainMonths}个月` : `${years}岁`
  },

  buildBirthLabel(babyInfo) {
    const parts = []
    if (babyInfo.birthDate) parts.push(`出生 ${babyInfo.birthDate}`)
    if (babyInfo.gender) parts.push(babyInfo.gender === 'M' ? '男宝' : '女宝')
    return parts.join(' · ') || '小宝贝'
  },

  formatShortDate(dateStr) {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    if (parts.length < 3) return dateStr
    const [y, m, d] = parts
    const year = new Date().getFullYear()
    return parseInt(y, 10) === year
      ? `${parseInt(m, 10)}月${parseInt(d, 10)}日`
      : `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`
  },

  // ===== 表单 =====
  showAddForm() {
    this.setData({ showForm: true, 'formData.height': '', 'formData.weight': '', focusHeight: true })
  },

  hideForm() {
    this.setData({ showForm: false, focusHeight: false, focusWeight: false })
    // canvas 因 wx:if 被卸载过，节点重建后需重绘曲线
    this.redrawChartSoon()
  },

  /**
   * 延迟重绘曲线图（等 wx:if 重建 canvas 节点）
   */
  redrawChartSoon() {
    setTimeout(() => this.drawChart(), 120)
  },

  noop() {},

  /**
   * 跳转到历史记录页（独立页：滚动 + 分页加载）
   */
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },

  /**
   * 跳转到宝宝资料页
   */
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
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

  focusWeightField() {
    this.setData({ focusWeight: true })
  },

  async submitGrowth() {
    const { height, weight, measureDate } = this.data.formData
    if (!height && !weight) {
      wx.showToast({ title: '请至少填写身高或体重', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await call('addGrowthData', {
        babyId: app.globalData.babyId || 'default',
        height: height ? parseFloat(height) : null,
        weight: weight ? parseFloat(weight) : null,
        measureDate
      })

      this.setData({ showForm: false, 'formData.height': '', 'formData.weight': '' })
      await this.loadData()
      // canvas 重建后确保曲线重绘（loadData 内部 50ms 可能早于节点就绪）
      this.redrawChartSoon()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  // ===== 图表 =====
  switchChart(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.chartType) return
    this.setData({ chartType: type })
    this.drawChart()
  },

  /**
   * 计算宝宝在测量日期时的月龄（浮点数）
   */
  monthAgeOf(birthDate, measureDate) {
    const end = measureDate ? new Date(measureDate.replace(/-/g, '/')) : new Date()
    const diffMs = end.getTime() - birthDate.getTime()
    return Math.max(0, diffMs / (DAYS_PER_MONTH * MS_PER_DAY))
  },

  /**
   * 使用 Canvas 2D 绘制生长曲线（平滑曲线 + 弱化 WHO 参考线）
   */
  drawChart() {
    const query = wx.createSelectorQuery()
    query.select('#growthChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio
        const width = res[0].width
        const height = res[0].height

        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)

        // 背景
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, width, height)

        this.drawWHOStandards(ctx, width, height)
        this.drawBabyCurve(ctx, width, height)
        this.drawAxes(ctx, width, height)
      })
  },

  drawAxes(ctx, width, height) {
    const padding = { left: 44, right: 16, top: 16, bottom: 34 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    // 水平网格线
    ctx.strokeStyle = '#F3EDE4'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + chartH * i / 4
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(padding.left + chartW, y)
      ctx.stroke()
    }

    // Y 轴刻度文字
    const type = this.data.chartType
    const yMax = type === 'weight' ? 15 : 100
    const yMin = type === 'weight' ? 0 : 40
    ctx.fillStyle = '#B5A795'
    ctx.font = '10px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const yVal = yMin + (yMax - yMin) * (1 - i / 4)
      const yPos = padding.top + chartH * i / 4
      ctx.fillText(yVal.toFixed(0), padding.left - 6, yPos)
    }

    // X 轴月龄标签
    const months = [0, 6, 12, 18, 24, 30, 36]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    months.forEach((m) => {
      const xPos = padding.left + chartW * m / 36
      ctx.fillText(`${m}`, xPos, padding.top + chartH + 8)
    })
  },

  /**
   * 绘制 WHO 参考曲线（弱化为背景虚线）
   */
  drawWHOStandards(ctx, width, height) {
    const padding = { left: 44, right: 16, top: 16, bottom: 34 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    const whoWeight = [
      { month: 0, val: 3.3 }, { month: 3, val: 6.0 }, { month: 6, val: 7.9 },
      { month: 12, val: 9.6 }, { month: 24, val: 12.2 }, { month: 36, val: 14.3 }
    ]
    const whoHeight = [
      { month: 0, val: 50 }, { month: 3, val: 61 }, { month: 6, val: 67 },
      { month: 12, val: 76 }, { month: 24, val: 87 }, { month: 36, val: 95 }
    ]

    const data = this.data.chartType === 'weight' ? whoWeight : whoHeight
    const yMax = this.data.chartType === 'weight' ? 15 : 100
    const yMin = this.data.chartType === 'weight' ? 0 : 40

    ctx.strokeStyle = '#E8DCC9'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = padding.left + chartW * d.month / 36
      const y = padding.top + chartH - chartH * (d.val - yMin) / (yMax - yMin)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])
  },

  /**
   * 绘制宝宝实际数据曲线（平滑贝塞尔 + 数据点）
   */
  drawBabyCurve(ctx, width, height) {
    const type = this.data.chartType
    const records = this.data.records.filter(r => r[type])
    if (records.length === 0) return

    const babyInfo = this.data.babyInfo
    const birthDate = babyInfo.birthDate ? new Date(babyInfo.birthDate.replace(/-/g, '/')) : null
    if (!birthDate || isNaN(birthDate.getTime())) return

    const padding = { left: 44, right: 16, top: 16, bottom: 34 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom
    const yMax = type === 'weight' ? 15 : 100
    const yMin = type === 'weight' ? 0 : 40

    // 计算每个点的坐标
    const points = records.map((r) => {
      const monthAge = this.monthAgeOf(birthDate, r.measureDate)
      const monthClamped = Math.max(0, Math.min(36, monthAge))
      const x = padding.left + chartW * monthClamped / 36
      const y = padding.top + chartH - chartH * (r[type] - yMin) / (yMax - yMin)
      return { x, y }
    })

    // 填充渐变区域
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH)
    gradient.addColorStop(0, 'rgba(232, 155, 95, 0.25)')
    gradient.addColorStop(1, 'rgba(232, 155, 95, 0.02)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(points[0].x, padding.top + chartH)
    points.forEach((p) => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[points.length - 1].x, padding.top + chartH)
    ctx.closePath()
    ctx.fill()

    // 平滑曲线（二次贝塞尔）
    ctx.strokeStyle = '#E89B5F'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (points.length === 1) {
      ctx.moveTo(points[0].x, points[0].y)
    } else {
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]
        const curr = points[i]
        const midX = (prev.x + curr.x) / 2
        const midY = (prev.y + curr.y) / 2
        ctx.quadraticCurveTo(prev.x, prev.y, midX, midY)
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
    }
    ctx.stroke()

    // 数据点
    points.forEach((p) => {
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI)
      ctx.fill()
      ctx.fillStyle = '#E89B5F'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI)
      ctx.fill()
    })
  },

  onShareAppMessage() {
    return {
      title: '秒记宝宝 - 见证每一次成长',
      path: '/pages/growth/growth'
    }
  }
})