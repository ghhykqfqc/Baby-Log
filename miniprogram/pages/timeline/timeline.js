// pages/timeline/timeline.js - 时光轴（摘要卡 + 自定义时间线分布图）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime, minutesToText, toMs } = require('../../utils/time')
const { predictDetail } = require('../../utils/predict')

Page({
  data: {
    loading: true,
    todayLabel: '',
    hasRecords: false,
    hasChartData: false,   // 是否有任何记录（控制图表显示，比 hasRecords 更宽松）
    predictList: [],
    hasPrediction: false,
    chartScale: 'day',      // hour | day | week | month
    summary: {
      feedCount: 0,
      diaperCount: 0,
      sleepDurationText: '0小时',
      sleepSessions: []
    }
  },

  _countdownTimer: null,
  _allRecords: [],
  _chartData: null,     // 图表原始数据（时间戳，绘制时转 x 坐标）
  _todayStart: 0,       // 今天 0 点的时间戳
  _chartDots: [],       // 节点位置（用于点击命中检测）
  _chartBars: [],       // 睡眠条形位置（用于点击命中检测）
  _canvasRect: null,    // canvas 在页面中的位置（坐标转换用）
  _activeTooltip: null, // 当前要绘制在 canvas 上的气泡内容
  _chartCtx: null,      // 缓存的 2d 上下文（气泡重绘用）
  _chartW: 0,           // 缓存的画布逻辑宽高
  _chartH: 0,

  onLoad() {
    const today = new Date()
    this.setData({ todayLabel: `${today.getMonth() + 1}月${today.getDate()}日` })
    // 监听宝宝切换，自动刷新
    app.eventBus.on('babySwitched', this._onBabySwitched = () => {
      this.loadData()
    })
  },

  onShow() {
    // 登录态校验
    if (!app.requireLogin()) return
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/timeline/timeline')
    }
    this.loadData()
  },

  onHide() {
    this.stopCountdown()
  },

  onUnload() {
    this.stopCountdown()
    if (this._onBabySwitched) {
      app.eventBus.off('babySwitched', this._onBabySwitched)
    }
  },

  stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  /**
   * 优先本地缓存，再拉云端
   */
  async loadData() {
    const cached = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this._allRecords = cached
    this.renderSummary(cached)
    this.updatePredictions()

    await this.fetchRecords()
  },

  /**
   * 拉取记录（根据当前刻度决定天数范围）
   */
  async fetchRecords() {
    const scaleDays = this.data.chartScale === 'hour' ? 1 : this.data.chartScale === 'day' ? 1 : this.data.chartScale === 'week' ? 7 : 30
    try {
      const result = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: scaleDays
      })
      if (result && result.records) {
        const normalized = result.records.map(r => ({
          ...r,
          timestamp: toMs(r.timestamp)
        }))
        this._allRecords = normalized
        // 缓存只存今日记录（分享页/首页依赖 todayRecords 的语义）
        const todayRecords = normalized.filter(r => this.isSameDay(r.timestamp, Date.now()))
        storage.set(storage.CACHE_KEYS.TODAY_RECORDS, todayRecords)
        this.renderSummary(normalized)
        this.updatePredictions()
      }
    } catch (err) {
      console.warn('拉取记录失败:', (err && err.message) || (err && err.errMsg) || err)
    } finally {
      this.setData({ loading: false })
      // 数据就绪后绘制图表（周/月视图即使今天无记录也要画）
      if (this.data.hasChartData) {
        setTimeout(() => this.drawTimelineChart(), 50)
      }
    }
  },

  /**
   * 判断两个时间戳是否同一天
   */
  isSameDay(ts1, ts2) {
    const d1 = new Date(ts1)
    const d2 = new Date(ts2)
    return d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
  },

  /**
   * 渲染摘要 + 准备图表数据
   */
  renderSummary(rawRecords) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    this._todayStart = todayStart.getTime()

    const todayRecords = (rawRecords || []).filter(r => this.isSameDay(toMs(r.timestamp), Date.now()))

    if (todayRecords.length === 0) {
      this.setData({
        hasRecords: false,
        hasChartData: (rawRecords || []).length > 0,
        summary: { feedCount: 0, diaperCount: 0, sleepDurationText: '0小时', sleepSessions: [] }
      })
      return
    }

    const feedCount = todayRecords.filter(r => r.recordType === 'feed').length
    const diaperCount = todayRecords.filter(r => r.recordType === 'diaper').length

    // 睡眠统计
    const sleepRecords = todayRecords.filter(r => r.recordType === 'sleep' && r.duration > 0)
    const sleepDurationTotal = sleepRecords.reduce((sum, r) => sum + r.duration, 0)

    // 睡眠时段明细
    const sleepSessions = sleepRecords.map(r => {
      const startTs = toMs(r.timestamp)
      const endTs = startTs + (r.duration || 0) * 60000
      return {
        startText: formatTime(startTs),
        endText: formatTime(endTs),
        durationText: minutesToText(r.duration),
        ongoing: false
      }
    })

    // 检查正在进行的睡眠
    const sleepStart = wx.getStorageSync('sleepStartTime') || 0
    if (sleepStart && this.isSameDay(sleepStart, Date.now())) {
      const elapsedMin = Math.floor((Date.now() - sleepStart) / 60000)
      sleepSessions.push({
        startText: formatTime(sleepStart),
        endText: '入睡中',
        durationText: minutesToText(elapsedMin),
        ongoing: true
      })
    }

    // 准备图表数据（时间戳，绘制时转 x 坐标）
    this._chartData = {
      feeds: todayRecords.filter(r => r.recordType === 'feed').map(r => toMs(r.timestamp)),
      diapers: todayRecords.filter(r => r.recordType === 'diaper').map(r => toMs(r.timestamp)),
      sleepBars: [],
      sleepDots: []
    }

    sleepRecords.forEach(r => {
      const startTs = toMs(r.timestamp)
      const endTs = startTs + (r.duration || 0) * 60000
      this._chartData.sleepBars.push({ start: startTs, end: endTs })
      this._chartData.sleepDots.push({ ts: startTs, isStart: true })
      this._chartData.sleepDots.push({ ts: endTs, isStart: false })
    })

    // duration=0 的入睡标记
    todayRecords.filter(r => r.recordType === 'sleep' && !r.duration).forEach(r => {
      this._chartData.sleepDots.push({ ts: toMs(r.timestamp), isStart: true })
    })

    // 正在进行的睡眠条
    if (sleepStart && this.isSameDay(sleepStart, Date.now())) {
      this._chartData.sleepBars.push({ start: sleepStart, end: Date.now() })
      this._chartData.sleepDots.push({ ts: sleepStart, isStart: true })
    }

    this.setData({
      hasRecords: true,
      hasChartData: true,
      summary: {
        feedCount,
        diaperCount,
        sleepDurationText: sleepDurationTotal ? minutesToText(sleepDurationTotal) : '0小时',
        sleepSessions
      }
    })
  },

  /**
   * 计算并刷新三栏预测卡
   */
  updatePredictions() {
    const detail = predictDetail(this._allRecords)
    const predictList = [
      { key: 'feed', ...detail.feed },
      { key: 'diaper', ...detail.diaper },
      { key: 'sleep', ...detail.sleep }
    ]
    this.setData({ predictList, hasPrediction: predictList.some(p => p.available) })

    this.stopCountdown()
    const hasAnyAvailable = predictList.some(p => p.available)
    if (hasAnyAvailable) {
      this._countdownTimer = setInterval(() => {
        const refreshed = predictList.map(p => {
          if (!p.available) return p
          const detail = predictDetail(this._allRecords)[p.key]
          return { ...p, countdownText: detail.countdownText }
        })
        this.setData({ predictList: refreshed })
      }, 30000)
    }
  },

  /* ============================================
     自定义 Canvas 2D 时间线分布图
     三泳道（喂奶 / 换尿布 / 睡眠），24 小时横轴，
     圆点标记事件，睡眠时段为条形线段
     ============================================ */

  drawTimelineChart() {
    const query = wx.createSelectorQuery().in(this)
    query.select('#timelineChart')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio || 2
        const W = res[0].width
        const H = res[0].height

        // 存储 canvas 在页面中的位置（点击坐标转换用）
        this._canvasRect = { left: res[0].left, top: res[0].top, width: W, height: H }

        if (!W || !H) {
          setTimeout(() => this.drawTimelineChart(), 120)
          return
        }

        canvas.width = W * dpr
        canvas.height = H * dpr
        ctx.scale(dpr, dpr)

        // 缓存画布节点与上下文，点击后重绘气泡时无需再次异步查询
        this._canvasNode = canvas
        this._chartCtx = ctx
        this._chartW = W
        this._chartH = H

        // 数据/尺寸变化后重新绘制，旧的点击气泡一并清除
        this._activeTooltip = null

        this.renderChart(ctx, W, H)
      })
  },

  /**
   * 按当前刻度渲染图表；若存在点击气泡，最后绘制在 canvas 内
   * （画布内绘制可避免原生 canvas 遮挡普通 view 导致的 tooltip 不显示问题）
   */
  renderChart(ctx, W, H) {
    // 清空命中检测数据
    this._chartDots = []
    this._chartBars = []

    const scale = this.data.chartScale
    if (scale === 'hour') {
      this.renderTimelineChart(ctx, W, H, Date.now() - 3 * 3600000, 3)
    } else if (scale === 'day') {
      this.renderTimelineChart(ctx, W, H, this._todayStart, 24)
    } else if (scale === 'week') {
      this.renderAggregateChart(ctx, W, H, 7)
    } else if (scale === 'month') {
      this.renderAggregateChart(ctx, W, H, 30)
    }

    if (this._activeTooltip) {
      this.drawTooltip(ctx, W, H, this._activeTooltip)
    }
  },

  /**
   * 在 canvas 上绘制节点详情气泡（自动避让上下/左右边缘，全部落在画布内）
   */
  drawTooltip(ctx, W, H, tip) {
    const icon = tip.icon || ''
    const title = tip.title || ''
    const sub = tip.sub || ''

    const gap = 8        // 气泡与节点的间距
    const padX = 12
    const padY = 8
    const lineGap = 2

    ctx.font = 'bold 12px sans-serif'
    const titleW = ctx.measureText(title).width
    ctx.font = '10px sans-serif'
    const subW = sub ? ctx.measureText(sub).width : 0
    ctx.font = '14px sans-serif'
    const iconW = ctx.measureText(icon).width || 14

    const textW = Math.max(titleW, subW)
    const boxW = Math.min(W - 8, padX * 2 + iconW + 6 + textW)
    const titleH = 14
    const subH = sub ? 11 : 0
    const boxH = padY * 2 + titleH + (sub ? subH + lineGap : 0)

    // 水平方向：气泡中心尽量对准节点，同时保证不超出画布
    const centerX = Math.min(Math.max(tip.x, boxW / 2 + 4), W - boxW / 2 - 4)
    const boxX = centerX - boxW / 2

    // 垂直方向：优先显示在节点上方，上方空间不足时改到下方
    const above = tip.y - boxH - gap >= 0
    const boxY = above ? tip.y - boxH - gap : tip.y + gap
    const arrowY = above ? boxY + boxH + 1 : boxY - 1

    ctx.save()

    // 指向节点的小箭头（菱形）
    ctx.fillStyle = 'rgba(61, 48, 39, 0.95)'
    ctx.beginPath()
    ctx.moveTo(centerX, arrowY - 4)
    ctx.lineTo(centerX + 4, arrowY)
    ctx.lineTo(centerX, arrowY + 4)
    ctx.lineTo(centerX - 4, arrowY)
    ctx.closePath()
    ctx.fill()

    // 气泡主体
    this.roundRect(ctx, boxX, boxY, boxW, boxH, 8)
    ctx.fill()

    // 内容：图标 + 标题（+ 副标题）
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const textX = boxX + padX
    const titleY = boxY + padY + titleH / 2

    ctx.font = '14px sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(icon, textX, titleY)

    ctx.font = 'bold 12px sans-serif'
    ctx.fillText(title, textX + iconW + 6, titleY)
    if (sub) {
      ctx.font = '10px sans-serif'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
      ctx.fillText(sub, textX + iconW + 6, titleY + titleH / 2 + lineGap + 5)
    }

    ctx.restore()
  },

  /* ============================================
     时间线视图（时/日共用）：三泳道 + 圆点 + 睡眠条形
     @param windowStart 窗口起始时间戳
     @param windowHours 窗口时长（3 或 24）
     ============================================ */
  renderTimelineChart(ctx, W, H, windowStart, windowHours) {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, W, H)

    const pad = { left: 50, right: 14, top: 8, bottom: 24 }
    const chartW = W - pad.left - pad.right
    const chartH = H - pad.top - pad.bottom

    const laneY = {
      feed: pad.top + chartH * 1 / 6,
      diaper: pad.top + chartH * 3 / 6,
      sleep: pad.top + chartH * 5 / 6
    }
    const colors = {
      feed: '#E89B5F', diaper: '#7AAFA8', sleep: '#8B7AAA', sleepLight: '#C7B8D9',
      grid: '#F3EDE4', axis: '#C4B8A8', text: '#8B7D6E', now: 'rgba(232, 85, 78, 0.25)'
    }

    const tsToX = (ts) => {
      const hours = (ts - windowStart) / 3600000
      return pad.left + (Math.max(0, Math.min(windowHours, hours)) / windowHours) * chartW
    }

    // 从 _allRecords 构建窗口内图表数据
    const windowEnd = windowStart + windowHours * 3600000
    const winRecords = this._allRecords.filter(r => r.timestamp >= windowStart && r.timestamp <= windowEnd)
    const feeds = winRecords.filter(r => r.recordType === 'feed').map(r => r.timestamp)
    const diapers = winRecords.filter(r => r.recordType === 'diaper').map(r => r.timestamp)
    const sleepBars = []
    const sleepDots = []
    winRecords.filter(r => r.recordType === 'sleep').forEach(r => {
      if (r.duration > 0) {
        const endTs = r.timestamp + r.duration * 60000
        sleepBars.push({ start: r.timestamp, end: endTs })
        sleepDots.push({ ts: r.timestamp, isStart: true })
        sleepDots.push({ ts: endTs, isStart: false })
      } else {
        sleepDots.push({ ts: r.timestamp, isStart: true })
      }
    })
    const sleepStart = wx.getStorageSync('sleepStartTime') || 0
    if (sleepStart && sleepStart >= windowStart) {
      sleepBars.push({ start: sleepStart, end: Date.now() })
      sleepDots.push({ ts: sleepStart, isStart: true })
    }

    // ===== 1. 泳道引导线 =====
    Object.values(laneY).forEach(y => {
      ctx.strokeStyle = colors.grid
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke()
    })

    // ===== 2. 时间刻度轴 =====
    const pad2 = (n) => String(n).padStart(2, '0')
    ctx.fillStyle = colors.axis
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    // 主刻度间隔：3h 视图每 30min，24h 视图每 3h
    const majorStep = windowHours === 3 ? 0.5 : 3
    for (let h = 0; h <= windowHours; h += majorStep) {
      const x = pad.left + (h / windowHours) * chartW
      const ts = windowStart + h * 3600000
      const d = new Date(ts)
      const label = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      ctx.fillText(label, x, pad.top + chartH + 6)
      ctx.strokeStyle = colors.axis
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, pad.top + chartH); ctx.lineTo(x, pad.top + chartH + 4); ctx.stroke()
    }
    // 小刻度
    const minorStep = windowHours === 3 ? 0.5 : 1
    for (let h = 0; h <= windowHours; h += minorStep) {
      if (h % majorStep === 0) continue
      const x = pad.left + (h / windowHours) * chartW
      ctx.strokeStyle = colors.grid
      ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(x, pad.top + chartH); ctx.lineTo(x, pad.top + chartH + 2); ctx.stroke()
    }

    // ===== 3. 泳道标签 =====
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = colors.feed; ctx.fillText('喂奶', pad.left - 6, laneY.feed)
    ctx.fillStyle = colors.diaper; ctx.fillText('尿布', pad.left - 6, laneY.diaper)
    ctx.fillStyle = colors.sleep; ctx.fillText('睡眠', pad.left - 6, laneY.sleep)

    // ===== 4. 睡眠条形 =====
    const barH = 10
    sleepBars.forEach(bar => {
      const x1 = tsToX(bar.start)
      const x2 = tsToX(bar.end)
      const y = laneY.sleep
      const w = Math.max(3, x2 - x1)
      const grad = ctx.createLinearGradient(x1, y, x2, y)
      grad.addColorStop(0, colors.sleep); grad.addColorStop(1, colors.sleepLight)
      ctx.fillStyle = grad
      this.roundRect(ctx, x1, y - barH / 2, w, barH, barH / 2)
      ctx.fill()
      this._chartBars.push({ x1, x2, y, h: barH, start: bar.start, end: bar.end })
    })

    // ===== 5. 喂奶圆点 =====
    feeds.forEach(ts => {
      const x = tsToX(ts)
      ctx.fillStyle = colors.feed
      ctx.beginPath(); ctx.arc(x, laneY.feed, 4.5, 0, 2 * Math.PI); ctx.fill()
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke()
      this._chartDots.push({ x, y: laneY.feed, r: 4.5, type: 'feed', ts })
    })

    // ===== 6. 换尿布圆点 =====
    diapers.forEach(ts => {
      const x = tsToX(ts)
      ctx.fillStyle = colors.diaper
      ctx.beginPath(); ctx.arc(x, laneY.diaper, 4.5, 0, 2 * Math.PI); ctx.fill()
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke()
      this._chartDots.push({ x, y: laneY.diaper, r: 4.5, type: 'diaper', ts })
    })

    // ===== 7. 睡眠圆点 =====
    sleepDots.forEach(d => {
      const x = tsToX(d.ts)
      ctx.fillStyle = d.isStart ? colors.sleep : colors.sleepLight
      ctx.beginPath(); ctx.arc(x, laneY.sleep, 4.5, 0, 2 * Math.PI); ctx.fill()
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke()
      this._chartDots.push({ x, y: laneY.sleep, r: 4.5, type: 'sleep', ts: d.ts, isStart: d.isStart })
    })

    // ===== 8. 当前时间指示线 =====
    const nowX = tsToX(Date.now())
    if (nowX > pad.left && nowX < pad.left + chartW) {
      ctx.strokeStyle = colors.now
      ctx.lineWidth = 1; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(nowX, pad.top); ctx.lineTo(nowX, pad.top + chartH); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(232, 85, 78, 0.4)'
      ctx.beginPath(); ctx.moveTo(nowX - 3, pad.top); ctx.lineTo(nowX + 3, pad.top); ctx.lineTo(nowX, pad.top + 4); ctx.closePath(); ctx.fill()
    }
  },

  /* ============================================
     周/月视图：按天聚合的三泳道柱状图
     每天一列，3 个泳道各一根柱子（喂奶次数/尿布次数/睡眠小时数）
     ============================================ */
  renderAggregateChart(ctx, W, H, days) {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, W, H)

    const pad = { left: 42, right: 14, top: 12, bottom: 24 }
    const chartW = W - pad.left - pad.right
    const chartH = H - pad.top - pad.bottom
    const laneH = chartH / 3
    const laneY = {
      feed: pad.top + laneH * 0.5,
      diaper: pad.top + laneH * 1.5,
      sleep: pad.top + laneH * 2.5
    }
    const colors = {
      feed: '#E89B5F',
      diaper: '#7AAFA8',
      sleep: '#8B7AAA',
      grid: '#F3EDE4',
      axis: '#C4B8A8',
      text: '#8B7D6E'
    }

    // 按天聚合数据
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const dayStart = now.getTime()
    const dailyData = []
    for (let i = days - 1; i >= 0; i--) {
      const dStart = dayStart - i * 86400000
      const dEnd = dStart + 86400000
      const dayRecords = this._allRecords.filter(r => r.timestamp >= dStart && r.timestamp < dEnd)
      dailyData.push({
        date: new Date(dStart),
        feedCount: dayRecords.filter(r => r.recordType === 'feed').length,
        diaperCount: dayRecords.filter(r => r.recordType === 'diaper').length,
        sleepMinutes: dayRecords
          .filter(r => r.recordType === 'sleep' && r.duration > 0)
          .reduce((sum, r) => sum + r.duration, 0)
      })
    }

    // 计算各泳道最大值（用于柱高归一化）
    const maxFeed = Math.max(1, ...dailyData.map(d => d.feedCount))
    const maxDiaper = Math.max(1, ...dailyData.map(d => d.diaperCount))
    const maxSleep = Math.max(1, ...dailyData.map(d => d.sleepMinutes))
    const barMaxH = laneH * 0.7

    // 泳道引导线
    Object.values(laneY).forEach(y => {
      ctx.strokeStyle = colors.grid
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(pad.left + chartW, y)
      ctx.stroke()
    })

    // 泳道标签
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = colors.feed
    ctx.fillText('喂奶', pad.left - 4, laneY.feed)
    ctx.fillStyle = colors.diaper
    ctx.fillText('尿布', pad.left - 4, laneY.diaper)
    ctx.fillStyle = colors.sleep
    ctx.fillText('睡眠', pad.left - 4, laneY.sleep)

    // 每天一列
    const colW = chartW / days
    const barW = Math.min(colW * 0.5, 16)

    dailyData.forEach((d, i) => {
      const cx = pad.left + colW * (i + 0.5)
      const isToday = i === days - 1

      // 今天列高亮
      if (isToday) {
        ctx.fillStyle = 'rgba(212, 184, 150, 0.06)'
        ctx.fillRect(cx - colW / 2, pad.top, colW, chartH)
      }

      // 喂奶柱
      const feedH = (d.feedCount / maxFeed) * barMaxH
      ctx.fillStyle = colors.feed
      this.roundRect(ctx, cx - barW / 2, laneY.feed - feedH, barW, feedH, 2)
      ctx.fill()
      if (d.feedCount > 0) {
        ctx.fillStyle = '#FFFFFF'
        ctx.font = '8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${d.feedCount}`, cx, laneY.feed - feedH - 2)
      }

      // 尿布柱
      const diaperH = (d.diaperCount / maxDiaper) * barMaxH
      ctx.fillStyle = colors.diaper
      this.roundRect(ctx, cx - barW / 2, laneY.diaper - diaperH, barW, diaperH, 2)
      ctx.fill()
      if (d.diaperCount > 0) {
        ctx.fillStyle = '#FFFFFF'
        ctx.font = '8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${d.diaperCount}`, cx, laneY.diaper - diaperH - 2)
      }

      // 睡眠柱（向下生长）
      const sleepH = (d.sleepMinutes / maxSleep) * barMaxH
      ctx.fillStyle = colors.sleep
      this.roundRect(ctx, cx - barW / 2, laneY.sleep, barW, sleepH, 2)
      ctx.fill()
      if (d.sleepMinutes > 0) {
        ctx.fillStyle = '#FFFFFF'
        ctx.font = '8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(`${(d.sleepMinutes / 60).toFixed(1)}h`, cx, laneY.sleep + sleepH + 2)
      }

      // X 轴日期标签
      ctx.fillStyle = isToday ? colors.text : colors.axis
      ctx.font = `${isToday ? 'bold ' : ''}9px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const label = days === 7
        ? ['日', '一', '二', '三', '四', '五', '六'][d.date.getDay()]
        : `${d.date.getDate()}`
      ctx.fillText(label, cx, pad.top + chartH + 6)

      // 存储柱子位置（点击命中检测用）
      this._chartBars.push({
        x1: cx - colW / 2, x2: cx + colW / 2,
        y: pad.top, h: chartH,
        dailyData: d, type: 'aggregate'
      })
    })

    // X 轴线
    ctx.strokeStyle = colors.axis
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(pad.left, pad.top + chartH)
    ctx.lineTo(pad.left + chartW, pad.top + chartH)
    ctx.stroke()
  },

  /* ============================================
     图表点击：命中检测 → 显示详情气泡
     ============================================ */
  onChartTap(e) {
    // 不同基础库/机型上 tap 事件坐标来源不一致，收集多种解释统一做命中检测：
    // 1) changedTouches.clientX/Y —— 视口坐标（普通 Touch 对象）；
    // 2) changedTouches.x/y —— 部分机型 canvas 事件直接携带 canvas 相对坐标（CanvasTouch）；
    // 3) e.detail.x/y —— 页面文档坐标。
    const candidates = []
    const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0])
    if (touch && typeof touch.clientX === 'number') {
      candidates.push({ x: touch.clientX, y: touch.clientY, local: false })
    }
    if (touch && typeof touch.x === 'number') {
      candidates.push({ x: touch.x, y: touch.y, local: true })
    }
    if (e.detail && typeof e.detail.x === 'number') {
      candidates.push({ x: e.detail.x, y: e.detail.y, local: false })
    }
    if (!candidates.length) return

    // 异步查询 canvas 当前位置（避免 _canvasRect 过期）
    const query = wx.createSelectorQuery().in(this)
    query.select('#timelineChart').fields({ size: true, rect: true }).exec((res) => {
      if (!res || !res[0]) return
      const rect = res[0]

      for (const c of candidates) {
        // local 为 true 表示坐标已是相对于 canvas 的，无需再减去 rect.left/top
        const touchX = c.local ? c.x : c.x - rect.left
        const touchY = c.local ? c.y : c.y - rect.top
        // 只有 X/Y 都落在 canvas 附近，这个坐标系解释才成立
        if (touchX < -30 || touchX > rect.width + 30) continue
        if (touchY < -30 || touchY > rect.height + 30) continue
        if (this._performHitTest(touchX, touchY)) return
      }
      // 所有候选坐标都未命中：清除气泡并重绘
      this._clearTooltip()
    })
  },

  /**
   * 清除当前气泡并重绘画布
   */
  _clearTooltip() {
    this._activeTooltip = null
    if (this._chartCtx && this._chartW && this._chartH) {
      this.renderChart(this._chartCtx, this._chartW, this._chartH)
    }
  },

  /**
   * 命中检测，返回是否命中
   */
  _performHitTest(touchX, touchY) {
    let hit = null
    let hitType = null

    if (this.data.chartScale === 'hour' || this.data.chartScale === 'day') {
      const hitR = 22
      for (const dot of this._chartDots) {
        const dx = touchX - dot.x
        const dy = touchY - dot.y
        if (dx * dx + dy * dy <= hitR * hitR) { hit = dot; hitType = 'dot'; break }
      }
      if (!hit) {
        for (const bar of this._chartBars) {
          if (touchX >= bar.x1 - 6 && touchX <= bar.x2 + 6 && Math.abs(touchY - bar.y) <= bar.h + 6) {
            hit = bar; hitType = 'bar'; break
          }
        }
      }
    } else {
      for (const bar of this._chartBars) {
        if (touchX >= bar.x1 && touchX <= bar.x2) { hit = bar; hitType = 'aggregate'; break }
      }
    }

    if (!hit) { this._clearTooltip(); return false }
    const tooltip = this.buildTooltip(hit, hitType)
    if (tooltip) {
      this._activeTooltip = tooltip
      // 气泡直接绘制在 canvas 上，命中后立即重绘即可展示
      if (this._chartCtx && this._chartW && this._chartH) {
        this.renderChart(this._chartCtx, this._chartW, this._chartH)
      }
      return true
    }
    this._clearTooltip()
    return false
  },

  /**
   * 根据命中对象构建气泡数据
   */
  buildTooltip(hit, hitType) {
    const tooltip = this._buildTooltipContent(hit, hitType)
    if (!tooltip) return null

    // 先粗略钳制 x（drawTooltip 绘制时会再次按气泡实际宽度精确避让边缘）
    const canvasW = (this._canvasRect && this._canvasRect.width) || 320
    const margin = 80
    tooltip.x = Math.min(Math.max(tooltip.x, margin), canvasW - margin)
    return tooltip
  },

  _buildTooltipContent(hit, hitType) {
    // 智能定位：近顶部（y<50）显示在下方，否则上方
    const pos = (hit.y < 50) ? 'below' : 'above'

    if (hitType === 'dot') {
      const time = formatTime(hit.ts)
      if (hit.type === 'feed') {
        const record = this._allRecords.find(r => r.timestamp === hit.ts && r.recordType === 'feed')
        const amount = record && record.amount ? `${record.amount}ml` : ''
        return { x: hit.x, y: hit.y, pos, icon: '🍼', title: `${time} 喂奶`, sub: amount || '' }
      }
      if (hit.type === 'diaper') {
        const record = this._allRecords.find(r => r.timestamp === hit.ts && r.recordType === 'diaper')
        const subType = record && record.subType ? (record.subType === 'poop' ? '大便' : '小便') : ''
        return { x: hit.x, y: hit.y, pos, icon: '🧷', title: `${time} 换尿布`, sub: subType || '' }
      }
      if (hit.type === 'sleep') {
        return { x: hit.x, y: hit.y, pos, icon: hit.isStart ? '😴' : '🌅', title: `${time} ${hit.isStart ? '入睡' : '醒来'}`, sub: '' }
      }
    }
    if (hitType === 'bar') {
      const startT = formatTime(hit.start)
      const endT = formatTime(hit.end)
      const dur = Math.round((hit.end - hit.start) / 60000)
      return { x: (hit.x1 + hit.x2) / 2, y: hit.y, pos, icon: '😴', title: `${startT}-${endT}`, sub: minutesToText(dur) }
    }
    if (hitType === 'aggregate') {
      const d = hit.dailyData
      const dateStr = `${d.date.getMonth() + 1}/${d.date.getDate()}`
      const sleepH = (d.sleepMinutes / 60).toFixed(1)
      return { x: (hit.x1 + hit.x2) / 2, y: hit.y, pos, icon: '📊', title: dateStr, sub: `喂奶${d.feedCount} 尿布${d.diaperCount} 睡眠${sleepH}h` }
    }
    return null
  },

  /**
   * 切换刻度（日/周/月）
   */
  switchScale(e) {
    const scale = e.currentTarget.dataset.scale
    if (scale === this.data.chartScale) return

    this.setData({ chartScale: scale })
    // 立即清除旧气泡并重绘，避免切换刻度后残留上一次的提示
    this._activeTooltip = null
    if (this._chartCtx && this._chartW && this._chartH) {
      this.renderChart(this._chartCtx, this._chartW, this._chartH)
    }
    // 重新加载数据（周/月需要更多天数）+ 重绘
    this.loadData()
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

  /* ============================================
     页面跳转
     ============================================ */

  goRecords() {
    wx.navigateTo({ url: '/pages/timeline-records/timeline-records' })
  },

  goShareCard() {
    wx.navigateTo({ url: '/pages/share/share' })
  },

  onShareAppMessage() {
    return {
      title: '秒记宝宝 - 看看宝宝今天的表现',
      path: '/pages/timeline/timeline'
    }
  }
})
