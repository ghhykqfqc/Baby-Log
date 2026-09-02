// pages/schedule/schedule.js - 日程页（日历视图 + 事项 CRUD + 倒计时 tips + 常用事项）
const app = getApp()
const { call } = require('../../utils/request')

// 事项类别配置：key/icon/label/dotColor（日历标记颜色）
const CATEGORY_OPTIONS = [
  { key: 'vaccine',     icon: '💉', label: '疫苗',   color: '#E8554E' },
  { key: 'birthday',    icon: '🎂', label: '生日',   color: '#F5A623' },
  { key: 'appointment', icon: '🏥', label: '约诊',   color: '#6CA3C5' },
  { key: 'class',       icon: '📚', label: '上课',   color: '#9B6BD9' },
  { key: 'shopping',    icon: '🛒', label: '购物',   color: '#7FB069' },
  { key: 'gift',        icon: '🎁', label: '礼物',   color: '#D4B896' },
  { key: 'redpacket',   icon: '🧧', label: '红包',   color: '#E4493D' },
  { key: 'other',       icon: '📝', label: '其他',   color: '#8B7D6E' }
]

const CATEGORY_MAP = {}
CATEGORY_OPTIONS.forEach(c => { CATEGORY_MAP[c.key] = c })

// 重要事项的颜色覆盖（比类别色更醒目）
const IMPORTANT_COLOR = '#E4493D'

// 缓存键
const CACHE_KEY_PREFIX = 'schedules_'
const FAV_KEY_PREFIX = 'schedule_favs_'

Page({
  data: {
    babyInfo: {},
    // 当前视图月份
    viewYear: 0,
    viewMonth: 0,
    // 日历格子数据
    calendarDays: [],
    // 当前选中日期 YYYY-MM-DD
    selectedDate: '',
    selectedDateLabel: '',
    selectedShortLabel: '',
    selectedWeekday: '',
    // 选中日事项
    selectedSchedules: [],
    loadingSchedules: false,
    // 当日事项弹层
    showDaySheet: false,
    // 最近未来事项（倒计时 tips）
    upcoming: null,
    countdown: { days: 0, hours: '00', minutes: '00', seconds: '00' },
    // 表单
    showForm: false,
    editingId: '',
    submitting: false,
    showMore: false,          // 新增模式「更多选项」折叠开关
    formData: {
      title: '',
      category: 'other',
      date: '',
      startTime: '',
      endTime: '',
      location: '',
      note: '',
      important: false
    },
    categoryOptions: CATEGORY_OPTIONS,
    // 常用事项（自定义快捷选项）
    favoriteItems: [],
    favManageMode: false,
    isFavSaved: false,        // 当前输入的标题是否已收藏
    // 当前月份所有事项（按 date 分组），用于日历标记
    _monthSchedules: {} // 不在 setData 里更新，纯运行时缓存
  },

  onLoad() {
    const today = new Date()
    const todayStr = this._fmtDate(today)
    this.setData({
      viewYear: today.getFullYear(),
      viewMonth: today.getMonth() + 1,
      selectedDate: todayStr,
      'formData.date': todayStr
    })
    this._refreshCalendar()
    this._loadFavorites()
    this._startCountdownTimer()
    app.eventBus.on('babySwitched', this._onBabySwitched = () => {
      this._loadFavorites()
      this.loadMonthSchedules()
    })
  },

  onShow() {
    if (!app.requireLogin()) return
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/schedule/schedule')
    }
    this.setData({ babyInfo: app.globalData.babyInfo || {} })
    this.loadMonthSchedules()
    // 页面重新可见：恢复倒计时，并立即校正一次（处理后台期间的时间流逝）
    this._startCountdownTimer()
    this._tickCountdown(true)
  },

  onHide() {
    this._stopCountdownTimer()
  },

  onUnload() {
    this._stopCountdownTimer()
    if (this._onBabySwitched) app.eventBus.off('babySwitched', this._onBabySwitched)
  },

  // ============================================
  // 最近未来事项 + 实时倒计时
  // ============================================

  /**
   * 从「运行时已加载的全部事项」里找出最近的未来事项。
   * 数据源：本月事项 + 云端拉取的未来 90 天事项（_upcomingPool）。
   * 规则：事项时间点 > 当前时间；有 startTime 按 date+startTime，
   * 无 startTime 按 date 当天 00:00 结束后视为当天过期（当天无时间事项仍提示「今天」）。
   */
  _refreshUpcoming() {
    const pool = []
    const monthSchedules = this._monthSchedules || {}
    Object.keys(monthSchedules).forEach(k => {
      pool.push(...monthSchedules[k])
    })
    if (this._upcomingPool && this._upcomingPool.length > 0) {
      pool.push(...this._upcomingPool)
    }

    const now = new Date()
    const todayStr = this._fmtDate(now)
    let best = null
    let bestTs = Infinity
    let todayNoTime = null // 兜底：今天的无时间事项（无未来事项时才展示）
    const seen = {}
    pool.forEach(s => {
      if (!s || !s.date || seen[s._id]) return
      seen[s._id] = true
      const ts = this._scheduleTs(s)
      if (ts > now.getTime()) {
        if (ts < bestTs) { bestTs = ts; best = s }
      } else if (!s.startTime && s.date === todayStr) {
        if (!todayNoTime) todayNoTime = s
      }
    })
    if (!best) best = todayNoTime

    if (!best) {
      if (this.data.upcoming) this.setData({ upcoming: null })
      return
    }

    const meta = CATEGORY_MAP[best.category] || CATEGORY_MAP.other
    this._upcomingTarget = best
    this.setData({
      upcoming: {
        ...best,
        categoryMeta: meta,
        dateLabel: best.date === todayStr ? '今天' : this._fmtDateLabel(best.date),
        isToday: best.date === todayStr
      }
    })
    this._tickCountdown(true)
  },

  /** 计算事项的目标时间戳：date + startTime（无 startTime 则当天 00:00） */
  _scheduleTs(s) {
    const [y, m, d] = s.date.split('-').map(n => parseInt(n, 10))
    if (s.startTime) {
      const [hh, mm] = s.startTime.split(':').map(n => parseInt(n, 10))
      return new Date(y, m - 1, d, hh, mm, 0).getTime()
    }
    return new Date(y, m - 1, d, 0, 0, 0).getTime()
  },

  /** 启动每秒倒计时（只在页面可见时运行） */
  _startCountdownTimer() {
    if (this._countdownTimer) return
    this._countdownTimer = setInterval(() => this._tickCountdown(), 1000)
  },

  _stopCountdownTimer() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  /**
   * 计算并渲染倒计时。force=true 时强制重算（即使无目标也清零）。
   * 到期后自动刷新数据源（防止显示负数）。
   */
  _tickCountdown(force) {
    const target = this._upcomingTarget
    if (!target) {
      if (force && this.data.upcoming) this.setData({ upcoming: null })
      return
    }
    let diff = this._scheduleTs(target) - Date.now()
    if (diff <= 0) {
      // 已到期：若是无时间事项且还在今天，显示提示但倒计时归零
      if (!target.startTime && target.date === this._fmtDate(new Date())) {
        if (this.data.countdown.seconds !== '00') {
          this.setData({ countdown: { days: 0, hours: '00', minutes: '00', seconds: '00' } })
        }
        return
      }
      // 到期：刷新最近事项
      this._refreshUpcoming()
      return
    }
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    const pad = n => String(n).padStart(2, '0')
    this.setData({
      countdown: { days, hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) }
    })
  },

  /** 拉取未来 90 天内的事项（只用于倒计时 tips，不影响日历） */
  async _loadUpcomingPool() {
    const babyId = app.globalData.babyId || 'default'
    if (!app.globalData.cloudReady || !app.globalData.isOnline) return
    const today = new Date()
    const start = this._fmtDate(today)
    const endD = new Date(today.getTime() + 90 * 86400000)
    const end = this._fmtDate(endD)
    try {
      const data = await call('getSchedules', { babyId, startDate: start, endDate: end })
      this._upcomingPool = (data && data.schedules) || []
    } catch (e) {
      // 静默失败：仅用本月数据兜底
    }
    this._refreshUpcoming()
  },

  // ============================================
  // 常用事项（本地收藏）
  // ============================================

  _favKey() {
    const babyId = app.globalData.babyId || 'default'
    return FAV_KEY_PREFIX + babyId
  },

  _loadFavorites() {
    let favs = []
    try { favs = wx.getStorageSync(this._favKey()) || [] } catch (e) {}
    this.setData({ favoriteItems: favs.slice(0, 20) })
  },

  _saveFavorites(favs) {
    try { wx.setStorageSync(this._favKey(), favs) } catch (e) {}
    this.setData({ favoriteItems: favs.slice(0, 20) })
  },

  /** 点击常用事项 chip：填充标题并联动类别 */
  onFavTap(e) {
    if (this.data.favManageMode) return
    const fav = e.currentTarget.dataset.fav
    if (!fav) return
    const patch = { 'formData.title': fav }
    // 匹配类别名自动选中类别
    const cat = CATEGORY_OPTIONS.find(c => c.label === fav)
    if (cat) patch['formData.category'] = cat.key
    // 检查是否已收藏状态
    const favs = this.data.favoriteItems
    patch.isFavSaved = favs.indexOf(fav) >= 0
    this.setData(patch)
  },

  /** 收藏当前输入的事项为常用 */
  addFavItem() {
    const title = (this.data.formData.title || '').trim()
    if (!title) {
      wx.showToast({ title: '先输入事项名称', icon: 'none' })
      return
    }
    let favs = this.data.favoriteItems.slice()
    const idx = favs.indexOf(title)
    if (idx >= 0) {
      // 已收藏：再次点击取消收藏
      favs.splice(idx, 1)
      this._saveFavorites(favs)
      this.setData({ isFavSaved: false })
      wx.showToast({ title: '已取消收藏', icon: 'none' })
      return
    }
    favs.unshift(title)
    if (favs.length > 20) favs.pop()
    this._saveFavorites(favs)
    this.setData({ isFavSaved: true })
    wx.showToast({ title: '已存为常用 ✓', icon: 'none' })
  },

  /** 管理模式删除常用事项 */
  removeFavItem(e) {
    const fav = e.currentTarget.dataset.fav
    const favs = this.data.favoriteItems.filter(f => f !== fav)
    this._saveFavorites(favs)
    if (this.data.formData.title === fav) this.setData({ isFavSaved: false })
  },

  toggleFavManage() {
    this.setData({ favManageMode: !this.data.favManageMode })
  },

  // ============================================
  // 日历构建
  // ============================================

  /**
   * 重算 calendarDays 数组（包含上月末尾 + 当月 + 下月开头，凑齐 6 行 42 格）
   * 同时根据 this._monthSchedules 在每个格子注入事项标记
   */
  _refreshCalendar() {
    const year = this.data.viewYear
    const month = this.data.viewMonth // 1-12
    const firstDay = new Date(year, month - 1, 1)
    const firstWeekday = firstDay.getDay() // 0=周日
    const daysInMonth = new Date(year, month, 0).getDate()
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate()

    const today = new Date()
    const todayStr = this._fmtDate(today)
    const monthSchedules = this._monthSchedules || {}

    const days = []
    // 上月填充
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i
      const d = new Date(year, month - 2, day)
      const ds = this._fmtDate(d)
      days.push(this._buildDay(day, ds, false, ds === todayStr, monthSchedules[ds]))
    }
    // 当月
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = this._fmtDate(new Date(year, month - 1, day))
      days.push(this._buildDay(day, ds, true, ds === todayStr, monthSchedules[ds]))
    }
    // 下月填充至 42 格
    let nextDay = 1
    while (days.length < 42) {
      const ds = this._fmtDate(new Date(year, month, nextDay))
      days.push(this._buildDay(nextDay, ds, false, ds === todayStr, monthSchedules[ds]))
      nextDay++
    }

    this.setData({ calendarDays: days })
    // 同时刷新选中日的事项显示
    this._refreshSelectedSchedules()
  },

  /**
   * 构造单个日历格子
   */
  _buildDay(day, dateStr, isCurrentMonth, isToday, schedules) {
    const item = {
      key: dateStr,
      day,
      dateStr,
      isCurrentMonth,
      isToday,
      dotCount: 0,
      hasImportant: false,
      dotColor: '',
      dotColor2: '',
      dotColor3: ''
    }
    if (schedules && schedules.length > 0) {
      item.dotCount = schedules.length
      // 排序：重要优先
      const sorted = schedules.slice().sort((a, b) => {
        if (!!b.important - !!a.important) return !!b.important - !!a.important
        return 0
      })
      item.hasImportant = !!(sorted.length > 0 && sorted[0].important)
      const dots = sorted.slice(0, 3).map(s => s.important ? 'important' : s.category)
      item.dotColor = dots[0] || ''
      item.dotColor2 = dots[1] || ''
      item.dotColor3 = dots[2] || ''
    }
    return item
  },

  /**
   * 根据当前选中日期从 _monthSchedules 取出并刷新 selectedSchedules
   */
  _refreshSelectedSchedules() {
    const sel = this.data.selectedDate
    const list = (this._monthSchedules && this._monthSchedules[sel]) || []
    // 渲染附加字段
    const enriched = list.map(s => this._enrichSchedule(s))
    // 排序：有 startTime 在前，无时间靠后；同 startTime 升序
    enriched.sort((a, b) => {
      const at = a.startTime || 'zz'
      const bt = b.startTime || 'zz'
      return at.localeCompare(bt)
    })
    this.setData({
      selectedSchedules: enriched,
      selectedDateLabel: this._fmtDateLabel(sel),
      selectedShortLabel: this._fmtShortLabel(sel),
      selectedWeekday: this._weekdayLabel(sel)
    })
  },

  /** 短日期标签：今天 / 明天 / X月X日 */
  _fmtShortLabel(dateStr) {
    if (!dateStr) return ''
    const todayStr = this._fmtDate(new Date())
    if (dateStr === todayStr) return '今天'
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (dateStr === this._fmtDate(tomorrow)) return '明天'
    const [, m, d] = dateStr.split('-').map(n => parseInt(n, 10))
    return `${m}月${d}日`
  },

  /**
   * 给单条事项补上 categoryMeta 和 timeText
   */
  _enrichSchedule(s) {
    const meta = CATEGORY_MAP[s.category] || CATEGORY_MAP.other
    let timeText = ''
    if (s.startTime && s.endTime) {
      timeText = `${s.startTime} - ${s.endTime}`
    } else if (s.startTime) {
      timeText = s.startTime
    } else if (s.endTime) {
      timeText = `截至 ${s.endTime}`
    }
    return {
      ...s,
      categoryMeta: meta,
      timeText
    }
  },

  // ============================================
  // 数据加载（云端 + 本地缓存兜底）
  // ============================================

  async loadMonthSchedules() {
    const { viewYear, viewMonth } = this.data
    const start = new Date(viewYear, viewMonth - 1, 1)
    const end = new Date(viewYear, viewMonth, 0) // 当月最后一天
    const startDate = this._fmtDate(start)
    const endDate = this._fmtDate(end)
    const babyId = app.globalData.babyId || 'default'

    this.setData({ loadingSchedules: true })

    // 优先读本地缓存（即时回显）
    const cacheKey = CACHE_KEY_PREFIX + babyId + '_' + startDate + '_' + endDate
    let cached = []
    try { cached = wx.getStorageSync(cacheKey) || [] } catch (e) {}

    this._applySchedules(cached)
    this.setData({ loadingSchedules: false })

    // 拉云端
    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try {
        const data = await call('getSchedules', { babyId, startDate, endDate })
        const schedules = (data && data.schedules) || []
        try { wx.setStorageSync(cacheKey, schedules) } catch (e) {}
        this._applySchedules(schedules)
      } catch (err) {
        // 静默失败，已用缓存兜底
        console.warn('getSchedules failed', err)
      }
    }

    // 倒计时数据源：本月 + 未来 90 天
    this._loadUpcomingPool()
  },

  /**
   * 把数组按 date 分组成 { 'YYYY-MM-DD': [...] }，并触发日历刷新
   */
  _applySchedules(schedules) {
    const grouped = {}
    ;(schedules || []).forEach(s => {
      if (!s || !s.date) return
      if (!grouped[s.date]) grouped[s.date] = []
      grouped[s.date].push(s)
    })
    this._monthSchedules = grouped
    this._refreshCalendar()
    this._refreshUpcoming()
  },

  // ============================================
  // 交互：日期 / 月份切换
  // ============================================

  selectDate(e) {
    const dateStr = e.currentTarget.dataset.date
    if (!dateStr) return
    // 若点击非当月日期，自动切换视图月份
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    let viewChanged = false
    const patch = { selectedDate: dateStr, showDaySheet: true }
    if (y !== this.data.viewYear || m !== this.data.viewMonth) {
      patch.viewYear = y
      patch.viewMonth = m
      viewChanged = true
    }
    this.setData(patch)
    if (viewChanged) {
      this.loadMonthSchedules()
    } else {
      this._refreshSelectedSchedules()
    }
  },

  prevMonth() {
    let { viewYear, viewMonth } = this.data
    viewMonth--
    if (viewMonth < 1) { viewMonth = 12; viewYear-- }
    this.setData({ viewYear, viewMonth })
    this.loadMonthSchedules()
  },

  nextMonth() {
    let { viewYear, viewMonth } = this.data
    viewMonth++
    if (viewMonth > 12) { viewMonth = 1; viewYear++ }
    this.setData({ viewYear, viewMonth })
    this.loadMonthSchedules()
  },

  goToday() {
    const today = new Date()
    const todayStr = this._fmtDate(today)
    this.setData({
      viewYear: today.getFullYear(),
      viewMonth: today.getMonth() + 1,
      selectedDate: todayStr,
      showDaySheet: true
    })
    this.loadMonthSchedules()
  },

  // ============================================
  // 当日事项弹层
  // ============================================

  openDaySheet() {
    this.setData({ showDaySheet: true })
  },

  closeDaySheet() {
    this.setData({ showDaySheet: false })
  },

  // ============================================
  // 表单：新增 / 编辑
  // ============================================

  openAddSheet() {
    this.setData({
      showForm: true,
      editingId: '',
      showMore: false,
      favManageMode: false,
      isFavSaved: false,
      formData: {
        title: '',
        category: 'other',
        date: this.data.selectedDate,
        startTime: '',
        endTime: '',
        location: '',
        note: '',
        important: false
      }
    })
  },

  editSchedule(e) {
    const id = e.currentTarget.dataset.id
    const target = (this._monthSchedules[this.data.selectedDate] || []).find(s => s._id === id)
    if (!target) return
    this.setData({
      showForm: true,
      editingId: id,
      isFavSaved: this.data.favoriteItems.indexOf(target.title || '') >= 0,
      formData: {
        title: target.title || '',
        category: target.category || 'other',
        date: target.date || this.data.selectedDate,
        startTime: target.startTime || '',
        endTime: target.endTime || '',
        location: target.location || '',
        note: target.note || '',
        important: !!target.important
      }
    })
  },

  closeForm() {
    this.setData({ showForm: false, editingId: '', favManageMode: false })
  },

  onTitleInput(e) {
    const title = e.detail.value
    this.setData({
      'formData.title': title,
      isFavSaved: this.data.favoriteItems.indexOf(title.trim()) >= 0 && !!title.trim()
    })
  },
  onLocationInput(e)    { this.setData({ 'formData.location': e.detail.value }) },
  onNoteInput(e)        { this.setData({ 'formData.note': e.detail.value }) },
  onDateChange(e)       { this.setData({ 'formData.date': e.detail.value }) },
  onStartTimeChange(e)  { this.setData({ 'formData.startTime': e.detail.value }) },
  onEndTimeChange(e)    { this.setData({ 'formData.endTime': e.detail.value }) },

  onCatTap(e) {
    const newKey = e.currentTarget.dataset.key
    const oldKey = this.data.formData.category
    if (newKey === oldKey) return
    const oldMeta = CATEGORY_MAP[oldKey] || CATEGORY_MAP.other
    const newMeta = CATEGORY_MAP[newKey] || CATEGORY_MAP.other
    const patch = { 'formData.category': newKey }
    // 标题智能联动：当前标题为空、或就是旧类别名（用户未自定义）时，切换类别自动换成新类别名
    const curTitle = (this.data.formData.title || '').trim()
    if (!curTitle || curTitle === oldMeta.label) {
      patch['formData.title'] = newMeta.label
      patch.isFavSaved = this.data.favoriteItems.indexOf(newMeta.label) >= 0
    }
    this.setData(patch)
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore })
  },

  toggleImportant() {
    this.setData({ 'formData.important': !this.data.formData.important })
  },

  async saveSchedule() {
    const f = this.data.formData
    // 事项非必填：留空则默认取类别名
    const catMeta = CATEGORY_MAP[f.category] || CATEGORY_MAP.other
    const title = (f.title && f.title.trim()) || catMeta.label
    if (!f.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    if (f.startTime && f.endTime && f.endTime < f.startTime) {
      wx.showToast({ title: '结束时间不能早于开始时间', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    const babyId = app.globalData.babyId || 'default'
    const payload = {
      babyId,
      title,
      category: f.category,
      date: f.date,
      startTime: f.startTime,
      endTime: f.endTime,
      location: (f.location || '').trim(),
      note: (f.note || '').trim(),
      important: f.important
    }

    try {
      if (this.data.editingId) {
        await call('updateSchedule', { scheduleId: this.data.editingId, updates: payload })
        wx.showToast({ title: '已更新', icon: 'success' })
      } else {
        await call('addSchedule', payload)
        wx.showToast({ title: '已添加', icon: 'success' })
      }
      // 保存成功：关闭表单弹层，回到当日事项弹层
      this.setData({ showForm: false, editingId: '', favManageMode: false })
      this.loadMonthSchedules()
    } catch (err) {
      console.error('save schedule failed', err)
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  deleteSchedule() {
    if (!this.data.editingId) return
    wx.showModal({
      title: '删除事项',
      content: '确定要删除这条事项吗？',
      confirmText: '删除',
      confirmColor: '#E8554E',
      success: r => {
        if (!r.confirm) return
        call('deleteSchedule', { scheduleId: this.data.editingId }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          // 删除成功：关闭表单，回到当日事项弹层
          this.setData({ showForm: false, editingId: '' })
          this.loadMonthSchedules()
        }).catch(() => {
          wx.showToast({ title: '删除失败', icon: 'none' })
        })
      }
    })
  },

  noop() {},

  // ============================================
  // 工具：日期格式化
  // ============================================

  _fmtDate(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },

  _fmtDateLabel(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10))
    return `${y}年${m}月${d}日`
  },

  _weekdayLabel(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return names[d.getDay()]
  }
})
