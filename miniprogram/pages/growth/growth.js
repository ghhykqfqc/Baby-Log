// pages/growth/growth.js - 成长日志（简约大气版）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')

// 月份常量（按 30.44 天/月 计算平均月龄）
const DAYS_PER_MONTH = 30.44
const MS_PER_DAY = 24 * 60 * 60 * 1000

// 图表内边距（bottom 40：容纳 X 轴两行标签——「日」刻度 + 年月单位，互不遮挡）
const CHART_PADDING = { left: 44, right: 16, top: 16, bottom: 40 }

// WHO 生长参考标准锚点（月龄 → 中位参考值）
const WHO_WEIGHT = [
  { month: 0, val: 3.3 }, { month: 3, val: 6.0 }, { month: 6, val: 7.9 },
  { month: 12, val: 9.6 }, { month: 24, val: 12.2 }, { month: 36, val: 14.3 }
]
const WHO_HEIGHT = [
  { month: 0, val: 50 }, { month: 3, val: 61 }, { month: 6, val: 67 },
  { month: 12, val: 76 }, { month: 24, val: 87 }, { month: 36, val: 95 }
]

/** 月龄 → WHO 参考值（相邻锚点线性插值，超出 0~36 月取端点值） */
function whoValAt(month, isWeight) {
  const anchors = isWeight ? WHO_WEIGHT : WHO_HEIGHT
  if (month <= anchors[0].month) return anchors[0].val
  const lastA = anchors[anchors.length - 1]
  if (month >= lastA.month) return lastA.val
  for (let i = 1; i < anchors.length; i++) {
    if (month <= anchors[i].month) {
      const a = anchors[i - 1]
      const b = anchors[i]
      const t = (month - a.month) / (b.month - a.month)
      return a.val + (b.val - a.val) * t
    }
  }
  return lastA.val
}

Page({
  data: {
    babyInfo: {},
    records: [],
    latest: null,        // 最新一条数据（含增幅信息）
    ageText: null,       // 当前月龄 { num, unit }
    birthLabel: '',      // 出生信息文案
    hasRecords: false,
    showSkeleton: true,      // 首屏骨架占位（有缓存/云端数据即消失）
    heightAnimText: '--',    // 身高数值动画显示文本
    weightAnimText: '--',    // 体重数值动画显示文本
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
    // 监听宝宝切换，自动刷新
    app.eventBus.on('babySwitched', this._onBabySwitched = () => {
      this.loadData()
    })
  },

  onShow() {
    // 登录态校验
    if (!app.requireLogin()) return
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/growth/growth')
    }
    // 每次进入页面都重播数值动画
    this._lastAnimEnd = null
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh())
  },

  onUnload() {
    if (this._onBabySwitched) {
      app.eventBus.off('babySwitched', this._onBabySwitched)
    }
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
    // 合并全局与本地缓存的宝宝资料：缓存可能缺 birthDate（旧数据），
    // 缺失时用 globalData 补齐——否则 WHO 虚线会退化为水平参考线
    const globalInfo = app.globalData.babyInfo || {}
    const storedInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || {}
    const babyInfo = { ...globalInfo, ...storedInfo }
    if (!babyInfo.birthDate && globalInfo.birthDate) babyInfo.birthDate = globalInfo.birthDate
    this.setData({ babyInfo })

    // 有缓存 → 立即渲染数据卡并结束骨架，不等云端（卡片首先出现，图表随后）
    if (cached.length > 0) {
      this.setData({ showSkeleton: false })
    }
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
    }
    // 无论云端成功与否，都结束骨架屏
    this.setData({ showSkeleton: false })
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

    // 数据就绪后启动数值动画（从“上一条/起始”滚到最新值）
    if (decorated.length > 0) {
      this.animateNumbers(latest)
    }

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
      heightPrev: null,   // 上一次身高（动画起点）
      weightPrev: null,   // 上一次体重（动画起点）
      heightDeltaText: '首次记录',
      weightDeltaText: '首次记录',
      heightDeltaClass: '',
      weightDeltaClass: ''
    }

    // 身高增幅
    for (let i = records.length - 2; i >= 0; i--) {
      if (records[i].height) {
        latest.heightPrev = this.round1(records[i].height)
        latest.heightDelta = this.round1(last.height - records[i].height)
        break
      }
    }
    // 体重增幅
    for (let i = records.length - 2; i >= 0; i--) {
      if (records[i].weight) {
        latest.weightPrev = this.round1(records[i].weight)
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

  /**
   * 数字滚动动画：身高/体重数值从“上一条记录值”平滑滚动到最新值
   * - 首次记录：从 0 滚到最新值
   * - 已有上一条：从上一次数值滚到最新值
   * - 仅动画数字部分，保留一位小数
   * 注意：小程序 JS 环境（JSCore）没有全局 requestAnimationFrame，
   *       改用 setTimeout 16ms 定时驱动（≈60fps），零依赖
   */
  animateNumbers(latest) {
    if (!latest) return
    this._animToken = (this._animToken || 0) + 1
    const token = this._animToken
    const prevEnd = this._lastAnimEnd || {}
    this._lastAnimEnd = { height: latest.height, weight: latest.weight }

    const run = (startValue, endValue, setField) => {
      if (endValue === undefined || endValue === null || Number.isNaN(Number(endValue))) {
        this.setData({ [setField]: '--' })
        return
      }
      const end = Number(endValue)
      const fieldKey = setField === 'heightAnimText' ? 'height' : 'weight'
      // 目标值与上次动画结束时一致（如云端返回相同数据）→ 直接落定，避免重复滚动
      if (prevEnd[fieldKey] === end) {
        this.setData({ [setField]: end.toFixed(1) })
        return
      }
      const start = (startValue === undefined || startValue === null) ? 0 : Number(startValue)
      const t0 = Date.now()
      const durationMs = 700

      // 递归 setTimeout 驱动（替代不可用的小程序无 rAF）
      const frame = () => {
        // 新的动画已启动，放弃旧的
        if (token !== this._animToken) return
        const p = Math.min(1, (Date.now() - t0) / durationMs)
        const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
        const val = start + (end - start) * eased
        this.setData({ [setField]: val.toFixed(1) })
        if (p < 1) setTimeout(frame, 16)
      }
      frame()
    }

    run(latest.heightPrev, latest.height, 'heightAnimText')
    run(latest.weightPrev, latest.weight, 'weightAnimText')
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
   * 图表主题色：体重=暖橙，身高=雾蓝（与日程页约诊同色系），数据点/曲线/渐变统一取色
   */
  chartTheme() {
    return this.data.chartType === 'weight'
      ? { main: '#E89B5F', fillTop: 'rgba(232, 155, 95, 0.25)' }
      : { main: '#6CA3C5', fillTop: 'rgba(108, 163, 197, 0.25)' }
  },

  /**
   * 构建自适应 Y 轴范围：包络「可见记录值 ∪ 窗口内 WHO 参考值」，
   * 上下各扩 15% 呼吸空间后取整到漂亮刻度。
   * 效果：12 天窗口内 WHO 虚线 ~0.35kg 的增长被放大为清晰斜率，
   * 而不是在 0~15kg 全量程里被压成水平线。
   */
  buildYRange() {
    const type = this.data.chartType
    const isWeight = type === 'weight'
    const range = this._dateRange
    const babyInfo = this.data.babyInfo
    const birthTs = babyInfo.birthDate && !isNaN(new Date(babyInfo.birthDate.replace(/-/g, '/')).getTime())
      ? new Date(babyInfo.birthDate.replace(/-/g, '/')).getTime()
      : null

    const vals = []
    // 宝宝记录值
    this.data.records.forEach(r => {
      if (r[type]) vals.push(Number(r[type]))
    })
    // 窗口内 WHO 参考值（有生日才换算月龄；无生日取 0 月龄锚点值）
    if (range) {
      if (birthTs !== null) {
        const startM = (range.startTs - birthTs) / (DAYS_PER_MONTH * MS_PER_DAY)
        const endM = (range.endTs - birthTs) / (DAYS_PER_MONTH * MS_PER_DAY)
        vals.push(whoValAt(startM, isWeight), whoValAt(endM, isWeight))
        // WHO 在区间内非单调时（凸增），中点也要采样，避免包络偏窄
        vals.push(whoValAt((startM + endM) / 2, isWeight))
      } else {
        vals.push(whoValAt(0, isWeight))
      }
    }
    if (vals.length === 0) {
      return isWeight ? { min: 0, max: 15 } : { min: 40, max: 100 }
    }

    let min = Math.min(...vals)
    let max = Math.max(...vals)
    const span = max - min || Math.max(1, max * 0.2) // 全部同值时给 20% 展开空间
    min = min - span * 0.15
    max = max + span * 0.15
    // 取整到漂亮刻度：体重步长 0.5kg，身高步长 2cm
    const step = isWeight ? 0.5 : 2
    min = Math.floor(min / step) * step
    max = Math.ceil(max / step) * step
    if (max - min < step * 4) max = min + step * 4 // 至少 4 格，防止过窄
    return { min, max }
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
   * 使用 Canvas 2D 绘制生长曲线（日期横轴 + WHO 参考虚线 + 宝宝数据点）
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

        // 构建日期范围（横轴数据域）+ 自适应 Y 轴范围；无有效日期则只画 Y 轴
        this._dateRange = this.buildDateRange()
        this._yRange = this.buildYRange()
        this.drawYAxis(ctx, width, height)
        if (this._dateRange) {
          this.drawWHOStandards(ctx, width, height)
          this.drawBabyCurve(ctx, width, height)
          this.drawDateAxis(ctx, width, height)
          this.drawYearMonthLabel(ctx, width, height)
        }
      })
  },

  /**
   * 构建日期横轴的时间范围：当前指标的记录日 - 2天 ~ +2天（单条 ±3 天）。
   * 只看当前图表类型（体重/身高）有值的记录，避免另一指标的日期把窗口撑宽。
   */
  buildDateRange() {
    const type = this.data.chartType
    const dates = this.data.records
      .filter(r => r[type] && r.measureDate)
      .map(r => r.measureDate)
      .sort()
    if (dates.length === 0) return null
    const start = new Date(dates[0].replace(/-/g, '/'))
    const end = new Date(dates[dates.length - 1].replace(/-/g, '/'))
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
    const pad = dates.length === 1 ? 3 * MS_PER_DAY : 2 * MS_PER_DAY
    return {
      startTs: start.getTime() - pad,
      endTs: end.getTime() + pad
    }
  },

  /**
   * 时间戳 → 图表 x 坐标
   */
  xOfTs(ts, chartW) {
    const range = this._dateRange
    const ratio = (ts - range.startTs) / (range.endTs - range.startTs)
    return CHART_PADDING.left + chartW * Math.max(0, Math.min(1, ratio))
  },

  /**
   * 绘制 Y 轴：水平网格线 + 刻度值 + 单位（kg/cm 放左上角）
   */
  drawYAxis(ctx, width, height) {
    const padding = CHART_PADDING
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

    // Y 轴刻度值（自适应范围，保留合适小数位：体重 1 位、身高 0 位）
    const { min: yMin, max: yMax } = this._yRange
    const type = this.data.chartType
    const decimals = type === 'weight' ? 1 : 0
    ctx.fillStyle = '#B5A795'
    ctx.font = '10px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const yVal = yMin + (yMax - yMin) * (1 - i / 4)
      const yPos = padding.top + chartH * i / 4
      ctx.fillText(yVal.toFixed(decimals), padding.left - 6, yPos)
    }
    // 单位放 Y 轴顶端左上角
    ctx.font = '600 10px -apple-system, sans-serif'
    ctx.fillStyle = '#8B7D6E'
    ctx.textAlign = 'left'
    ctx.fillText(type === 'weight' ? 'kg' : 'cm', 4, padding.top + 2)
  },

  /**
   * 绘制日期横轴刻度：每 1~3 天一个「日」刻度，右端预留年月单位区不遮挡
   */
  drawDateAxis(ctx, width, height) {
    const padding = CHART_PADDING
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom
    const range = this._dateRange

    // 候选刻度：从起始日到结束日，每 1~3 天取一个（保证相邻刻度间隔 ≥ 18px）
    const totalDays = Math.ceil((range.endTs - range.startTs) / MS_PER_DAY)
    const approxW = totalDays > 0 ? chartW / totalDays : chartW
    const step = Math.max(1, Math.ceil(18 / approxW))

    ctx.font = '10px -apple-system, sans-serif'
    ctx.fillStyle = '#B5A795'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const dayStart = new Date(range.startTs)
    dayStart.setHours(0, 0, 0, 0)
    const firstDayTs = dayStart.getTime()
    let tickCount = 0
    for (let d = 0; d <= totalDays; d += step) {
      const ts = firstDayTs + d * MS_PER_DAY
      const date = new Date(ts)
      const xPos = this.xOfTs(ts, chartW)
      // 右端预留「年月」单位区（约 34px），超出则不画刻度
      if (xPos > padding.left + chartW - 34) continue
      ctx.fillText(`${date.getDate()}`, xPos, padding.top + chartH + 8)
      tickCount++
    }
    return tickCount
  },

  /**
   * 绘制横轴「年月」单位：取数据范围实际覆盖的年月，放在 X 轴下方第二行
   * （与「日」刻度错行 + 右侧留白，互不遮挡）
   */
  drawYearMonthLabel(ctx, width, height) {
    const padding = CHART_PADDING
    const chartH = height - padding.top - padding.bottom
    const range = this._dateRange
    const startD = new Date(range.startTs)
    const endD = new Date(range.endTs)
    const sameYear = startD.getFullYear() === endD.getFullYear()
    const sameMonth = sameYear && startD.getMonth() === endD.getMonth()
    let label
    if (sameMonth) {
      label = `${startD.getFullYear()}年${startD.getMonth() + 1}月`
    } else if (sameYear) {
      label = `${startD.getFullYear()}年 ${startD.getMonth() + 1}~${endD.getMonth() + 1}月`
    } else {
      label = `${startD.getFullYear()}.${startD.getMonth() + 1} ~ ${endD.getFullYear()}.${endD.getMonth() + 1}`
    }
    ctx.font = '600 10px -apple-system, sans-serif'
    ctx.fillStyle = '#8B7D6E'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(label, width - 4, padding.top + chartH + 22)
  },

  /**
   * 绘制 WHO 参考虚线：按可见日期区间逐日采样，月龄值由 WHO 锚点线性插值得出，
   * 虚线铺满横轴且随宝宝月龄平滑上升（自适应 Y 轴下上升趋势清晰可见）。
   * 无出生日期时退化为水平参照线（取 0 月龄锚点值，仍可对比数值高低）。
   */
  drawWHOStandards(ctx, width, height) {
    const padding = CHART_PADDING
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom
    const isWeight = this.data.chartType === 'weight'
    const { min: yMin, max: yMax } = this._yRange

    const range = this._dateRange
    const babyInfo = this.data.babyInfo
    const birthTs = babyInfo.birthDate && !isNaN(new Date(babyInfo.birthDate.replace(/-/g, '/')).getTime())
      ? new Date(babyInfo.birthDate.replace(/-/g, '/')).getTime()
      : null

    ctx.strokeStyle = '#E8DCC9'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()

    let labelAnchor = null // 用于「WHO 参考线」标注定位
    if (birthTs !== null) {
      // 有生日：可见区间内逐日采样（最多 ~40 个点，足够平滑），虚线铺满横轴
      const totalDays = Math.ceil((range.endTs - range.startTs) / MS_PER_DAY)
      const stepDays = Math.max(1, Math.ceil(totalDays / 40))
      const dayStart = new Date(range.startTs)
      dayStart.setHours(0, 0, 0, 0)
      let started = false
      for (let d = 0; d <= totalDays; d += stepDays) {
        const ts = dayStart.getTime() + d * MS_PER_DAY
        const monthAge = (ts - birthTs) / (DAYS_PER_MONTH * MS_PER_DAY)
        const val = whoValAt(monthAge, isWeight)
        const x = this.xOfTs(ts, chartW)
        const y = padding.top + chartH - chartH * (val - yMin) / (yMax - yMin)
        if (!started) { ctx.moveTo(x, y); started = true; labelAnchor = { x, y } }
        else ctx.lineTo(x, y)
      }
    } else {
      // 无生日：0 月龄锚点值画水平参照线
      const midTs = (range.startTs + range.endTs) / 2
      const x1 = this.xOfTs(range.startTs, chartW)
      const x2 = this.xOfTs(range.endTs, chartW)
      const val = whoValAt(0, isWeight)
      const y = padding.top + chartH - chartH * (val - yMin) / (yMax - yMin)
      ctx.moveTo(x1, y)
      ctx.lineTo(x2, y)
      labelAnchor = { x: this.xOfTs(midTs, chartW), y }
    }
    ctx.stroke()
    ctx.setLineDash([])

    // 虚线含义标注：贴在虚线起点（或水平参照线中部）下方
    if (labelAnchor) {
      ctx.font = '9px -apple-system, sans-serif'
      ctx.fillStyle = '#C9BBAA'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      const labelY = Math.min(labelAnchor.y + 10, padding.top + chartH - 12)
      const labelX = Math.min(labelAnchor.x + 6, padding.left + chartW - 56)
      ctx.fillText('WHO 参考线', labelX, labelY)
    }
  },

  /**
   * 绘制宝宝实际数据曲线（按测量日期定位，不依赖出生日期）
   * 体重=暖橙 / 身高=雾蓝，白底描边大圆点 + 数值标注，与 WHO 虚线清晰对比
   */
  drawBabyCurve(ctx, width, height) {
    const type = this.data.chartType
    const records = this.data.records
      .filter(r => r[type] && r.measureDate)
      .sort((a, b) => (a.measureDate || '').localeCompare(b.measureDate || ''))
    if (records.length === 0) return

    const theme = this.chartTheme()
    const padding = CHART_PADDING
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom
    const { min: yMin, max: yMax } = this._yRange

    // 每条记录按测量日期映射 x 坐标（日期轴，与出生日期无关）
    const points = records.map((r) => {
      const ts = new Date(r.measureDate.replace(/-/g, '/')).getTime()
      const x = this.xOfTs(ts, chartW)
      const y = padding.top + chartH - chartH * (r[type] - yMin) / (yMax - yMin)
      return { x, y, record: r }
    })

    // 填充渐变区域（跟随主题色）
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH)
    gradient.addColorStop(0, theme.fillTop)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(points[0].x, padding.top + chartH)
    points.forEach((p) => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[points.length - 1].x, padding.top + chartH)
    ctx.closePath()
    ctx.fill()

    // 平滑曲线（两点以上才有连线；单点只画数据点）
    if (points.length > 1) {
      ctx.strokeStyle = theme.main
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]
        const curr = points[i]
        const midX = (prev.x + curr.x) / 2
        const midY = (prev.y + curr.y) / 2
        ctx.quadraticCurveTo(prev.x, prev.y, midX, midY)
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
      ctx.stroke()
    }

    // 醒目数据点：白底大圆（主题色描边）+ 内充实心圆——不依赖任何生日信息，必定绘制
    points.forEach((p) => {
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = theme.main
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = theme.main
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.2, 0, 2 * Math.PI)
      ctx.fill()
    })

    // 数值标注：每个点上方标注「数值+单位」，边缘避让（顶部不够翻到点下方、左右不出界）
    const unit = type === 'weight' ? 'kg' : 'cm'
    ctx.font = 'bold 10px -apple-system, sans-serif'
    ctx.fillStyle = theme.main
    ctx.textAlign = 'center'
    points.forEach((p) => {
      const label = `${this.round1(p.record[type])}${unit}`
      const above = p.y - 18 >= padding.top
      const labelY = above ? p.y - 18 : p.y + 14
      const labelX = Math.min(Math.max(p.x, padding.left + 18), padding.left + chartW - 18)
      ctx.textBaseline = above ? 'bottom' : 'top'
      ctx.fillText(label, labelX, labelY)
    })
  },

  onShareAppMessage() {
    return {
      title: '贝贝log - 见证每一次成长',
      path: '/pages/growth/growth'
    }
  }
})