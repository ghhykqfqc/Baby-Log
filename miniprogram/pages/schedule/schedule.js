// pages/schedule/schedule.js - 日程页（日历视图 + 事项 CRUD）
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
    selectedWeekday: '',
    // 选中日事项
    selectedSchedules: [],
    loadingSchedules: false,
    // 表单
    showForm: false,
    editingId: '',
    submitting: false,
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
    app.eventBus.on('babySwitched', this._onBabySwitched = () => {
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
  },

  onHide() {},
  onUnload() {
    if (this._onBabySwitched) app.eventBus.off('babySwitched', this._onBabySwitched)
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
      dotColor: '',
      dotColor2: '',
      dotColor3: ''
    }
    if (schedules && schedules.length > 0) {
      item.dotCount = schedules.length
      // 排序：重要优先，然后按类别顺序
      const sorted = schedules.slice().sort((a, b) => {
        if (!!b.important - !!a.important) return !!b.important - !!a.important
        return 0
      })
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
      selectedWeekday: this._weekdayLabel(sel)
    })
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
  },

  // ============================================
  // 交互：日期 / 月份切换
  // ============================================

  selectDate(e) {
    const dateStr = e.currentTarget.dataset.date
    if (!dateStr || dateStr === this.data.selectedDate) return
    // 若点击非当月日期，自动切换视图月份
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    let viewChanged = false
    const patch = { selectedDate: dateStr }
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
      selectedDate: todayStr
    })
    this.loadMonthSchedules()
  },

  // ============================================
  // 表单：新增 / 编辑
  // ============================================

  openAddSheet() {
    this.setData({
      showForm: true,
      editingId: '',
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
    this.setData({ showForm: false, editingId: '' })
  },

  onTitleInput(e)       { this.setData({ 'formData.title': e.detail.value }) },
  onLocationInput(e)    { this.setData({ 'formData.location': e.detail.value }) },
  onNoteInput(e)        { this.setData({ 'formData.note': e.detail.value }) },
  onDateChange(e)       { this.setData({ 'formData.date': e.detail.value }) },
  onStartTimeChange(e)  { this.setData({ 'formData.startTime': e.detail.value }) },
  onEndTimeChange(e)    { this.setData({ 'formData.endTime': e.detail.value }) },

  onCatTap(e) {
    this.setData({ 'formData.category': e.currentTarget.dataset.key })
  },

  toggleImportant() {
    this.setData({ 'formData.important': !this.data.formData.important })
  },

  async saveSchedule() {
    const f = this.data.formData
    if (!f.title || !f.title.trim()) {
      wx.showToast({ title: '请填写事项标题', icon: 'none' })
      return
    }
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
      title: f.title.trim(),
      category: f.category,
      date: f.date,
      startTime: f.startTime,
      endTime: f.endTime,
      location: f.location.trim(),
      note: f.note.trim(),
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
      this.setData({ showForm: false, editingId: '' })
      this.loadMonthSchedules()
    } catch (err) {
      console.error('save schedule failed', err)
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async deleteSchedule() {
    if (!this.data.editingId) return
    const res = await new Promise(resolve => {
      wx.showModal({
        title: '删除事项',
        content: '确定要删除这条事项吗？',
        confirmText: '删除',
        confirmColor: '#E8554E',
        success: r => resolve(r.confirm)
      })
    })
    if (!res) return
    try {
      await call('deleteSchedule', { scheduleId: this.data.editingId })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.setData({ showForm: false, editingId: '' })
      this.loadMonthSchedules()
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
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
