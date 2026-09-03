// pages/schedule/schedule.js - 日程页（日历视图 + 事项 CRUD + 倒计时 tips + 常用事项）
const app = getApp()
const { call } = require('../../utils/request')

// 事项类别配置：key/icon/label/color（日历标记颜色）
// 注：无「其他」预设类别，用户可通过「＋」自定义（custom_ 前缀，本地维护）
const CATEGORY_OPTIONS = [
  { key: 'vaccine',     icon: '💉', label: '疫苗',   color: '#E8554E' },
  { key: 'birthday',    icon: '🎂', label: '生日',   color: '#F5A623' },
  { key: 'appointment', icon: '🏥', label: '约诊',   color: '#6CA3C5' },
  { key: 'class',       icon: '📚', label: '上课',   color: '#9B6BD9' },
  { key: 'shopping',    icon: '🛒', label: '购物',   color: '#7FB069' },
  { key: 'gift',        icon: '🎁', label: '礼物',   color: '#D4B896' },
  { key: 'redpacket',   icon: '🧧', label: '红包',   color: '#E4493D' }
]

// 自定义类别的兜底元数据（图标/颜色固定，label 动态）
const CUSTOM_CAT_META = { icon: '🏷️', label: '自定义', color: '#8B7D6E' }

// 类别标签展示省略长度：超过 4 个字符截断为前 4 字 + …（保证标签不超宽；
// 仅影响展示，存储与标题填充仍用完整名）
const CAT_LABEL_MAX = 4

/** 展示用类别名：超过 4 字省略为「前4字…」 */
function ellipsizeLabel(label, max) {
  const m = max || CAT_LABEL_MAX
  const s = String(label || '')
  return s.length > m ? s.slice(0, m) + '…' : s
}

/** 取类别展示名（内置或自定义）：返回完整 label（含自定义类别映射） */
function getCatLabel(key, customCats) {
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key].label
  if (key && key.startsWith('custom_')) {
    const cat = (customCats || []).find(c => c.key === key)
    return (cat && cat.label) || '自定义'
  }
  return '其他'
}

// 内置类别映射（静态）
const CATEGORY_MAP = {}
CATEGORY_OPTIONS.forEach(c => { CATEGORY_MAP[c.key] = c })

// 缓存键
const CACHE_KEY_PREFIX = 'schedules_'
const FAV_KEY_PREFIX = 'schedule_favs_'
const CUSTOM_CAT_KEY_PREFIX = 'schedule_custom_cats_'

// 自定义类别模块级缓存引用：页面加载/保存时同步，供 getCatMeta 取真实 label
let _customCatsRef = []

/** 取类别元数据（内置或自定义）。自定义类别 label 从模块级缓存取真实名 */
function getCatMeta(key) {
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key]
  if (key && key.startsWith('custom_')) {
    // 修复旧版从 key 反推 label 显示乱码的问题：真实名存在 _customCats 里
    return { key, icon: CUSTOM_CAT_META.icon, label: getCatLabel(key, _customCatsRef), color: CUSTOM_CAT_META.color }
  }
  return { key: 'other', icon: '📝', label: '其他', color: '#8B7D6E' }
}

/** 类别 → CSS 类名键：内置用 key，自定义/未知统一映射为 custom */
function catCssKey(category) {
  if (CATEGORY_MAP[category]) return category
  return 'custom'
}

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
    showCatEditor: false,     // 自定义类别编辑弹层
    catEditorValue: '',       // 自定义类别输入值
    catEditorEditingKey: '',  // 正在重命名的自定义类别 key（空=新增）
    catEditorError: '',
    formData: {
      title: '',
      category: '',
      date: '',
      startTime: '',
      endTime: '',
      location: '',
      note: '',
      important: false
    },
    // 类别选项（渲染用）：自定义类别在前 + 内置在后 + 「+」入口排最前
    categoryOptions: [],
    // 自定义类别（本地存储）：[{ key, label }]
    customCategories: [],
    // 常用事项（自定义快捷选项）
    favoriteItems: [],
    favManageMode: false,
    isFavSaved: false,        // 当前输入的标题是否已收藏
    titleFocus: false,        // 标题输入框受控聚焦（联动更新前强制失焦，规避 input 聚焦时不刷新 value 的特性）
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
    this._loadCustomCategories()
    this._startCountdownTimer()
    app.eventBus.on('babySwitched', this._onBabySwitched = () => {
      this._loadFavorites()
      this._loadCustomCategories()
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

    const meta = getCatMeta(best.category)
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
  // 自定义类别（本地存储）
  // ============================================

  _customCatKey() {
    const babyId = app.globalData.babyId || 'default'
    return CUSTOM_CAT_KEY_PREFIX + babyId
  },

  _loadCustomCategories() {
    let cats = []
    try { cats = wx.getStorageSync(this._customCatKey()) || [] } catch (e) {}
    this._customCats = cats
    _customCatsRef = cats // 同步模块级引用（getCatMeta 用）
    this._rebuildCategoryOptions()
  },

  _saveCustomCategories(cats) {
    try { wx.setStorageSync(this._customCatKey(), cats) } catch (e) {}
    this._customCats = cats
    _customCatsRef = cats // 同步模块级引用（getCatMeta 用）
    this._rebuildCategoryOptions()
  },

  /** 组装渲染用类别选项：＋入口 → 自定义类别 → 内置类别（自定义类别超 4 字省略展示） */
  _rebuildCategoryOptions() {
    const customs = (this._customCats || []).map(c => ({
      key: c.key, icon: CUSTOM_CAT_META.icon, label: ellipsizeLabel(c.label), custom: true
    }))
    this.setData({
      categoryOptions: [{ key: '__add__', icon: '＋', label: '自定义', isAdd: true }, ...customs, ...CATEGORY_OPTIONS]
    })
  },

  /** 打开自定义类别编辑弹层（editingKey 空=新增） */
  openCatEditor(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset.key) || ''
    if (key) {
      const cat = (this._customCats || []).find(c => c.key === key)
      if (!cat) return
      this.setData({ showCatEditor: true, catEditorEditingKey: key, catEditorValue: cat.label, catEditorError: '' })
    } else {
      this.setData({ showCatEditor: true, catEditorEditingKey: '', catEditorValue: '', catEditorError: '' })
    }
  },

  onCatEditorInput(e) {
    this.setData({ catEditorValue: e.detail.value, catEditorError: '' })
  },

  closeCatEditor() {
    this.setData({ showCatEditor: false, catEditorEditingKey: '', catEditorValue: '', catEditorError: '' })
  },

  /** 保存自定义类别（新增或重命名）。生成 custom_<id> 格式 key。不限字数，超长仅展示省略。 */
  saveCatEditor() {
    const label = (this.data.catEditorValue || '').trim()
    if (!label) {
      this.setData({ catEditorError: '给类别起个名字吧' })
      return
    }
    const cats = (this._customCats || []).slice()
    const allLabels = [
      ...cats.map(c => c.label),
      ...CATEGORY_OPTIONS.map(c => c.label)
    ]
    if (allLabels.indexOf(label) >= 0) {
      this.setData({ catEditorError: '已经有这个类别啦' })
      return
    }
    const editingKey = this.data.catEditorEditingKey
    let newCatKey = '' // 新增成功后的 key（用于自动选中）
    if (editingKey) {
      // 重命名
      const cat = cats.find(c => c.key === editingKey)
      if (cat) cat.label = label
      // 若当前表单选中的正是该类别：标题无条件跟随新类别名（超长省略，与标签一致）
      if (this.data.formData.category === editingKey) {
        const displayLabel = ellipsizeLabel(label)
        this.setData({ 'formData.title': displayLabel, isFavSaved: this.data.favoriteItems.indexOf(displayLabel) >= 0 })
      }
    } else {
      // 新增：custom_<时间戳> 保证唯一；头插排第一个（刚建的最常用）
      const key = 'custom_' + Date.now().toString(36)
      cats.unshift({ key, label })
      newCatKey = key
    }
    this._saveCustomCategories(cats)
    this.closeCatEditor()
    // 新增成功：默认选中新类别，标题无条件填充为类别展示名（与标签一致，超长省略）
    if (newCatKey && this.data.showForm) {
      const displayLabel = ellipsizeLabel(label)
      const patch = {
        'formData.category': newCatKey,
        'formData.title': displayLabel,
        isFavSaved: this.data.favoriteItems.indexOf(displayLabel) >= 0
      }
      if (this.data.titleFocus) patch.titleFocus = false
      this.setData(patch)
    }
    wx.showToast({ title: editingKey ? '已更新' : '已添加', icon: 'success' })
  },

  /** 长按自定义类别：删除确认 */
  removeCustomCat(e) {
    const key = e.currentTarget.dataset.key
    const cat = (this._customCats || []).find(c => c.key === key)
    if (!cat) return
    wx.showModal({
      title: '删除类别',
      content: `删除「${cat.label}」类别？已保存的事项不受影响，但会归入「其他」显示。`,
      confirmText: '删除',
      confirmColor: '#E8554E',
      success: r => {
        if (!r.confirm) return
        const cats = (this._customCats || []).filter(c => c.key !== key)
        this._saveCustomCategories(cats)
        // 若当前表单选中该类别，回落到无选中并清空标题（下次点类别重新联动）
        if (this.data.formData.category === key) {
          this.setData({ 'formData.category': '', 'formData.title': '', isFavSaved: false })
        }
        wx.showToast({ title: '已删除', icon: 'none' })
      }
    })
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
    // 匹配类别名自动选中类别（兼容完整名与省略名：chip 可能存完整名，pill 展示省略名）
    const cat = this.data.categoryOptions.find(c => !c.isAdd && (c.label === fav || ellipsizeLabel(fav) === c.label))
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
      dotCssKey: '',
      dotCssKey2: '',
      dotCssKey3: ''
    }
    if (schedules && schedules.length > 0) {
      item.dotCount = schedules.length
      // 排序：重要优先
      const sorted = schedules.slice().sort((a, b) => {
        if (!!b.important - !!a.important) return !!b.important - !!a.important
        return 0
      })
      item.hasImportant = !!(sorted.length > 0 && sorted[0].important)
      const dots = sorted.slice(0, 3).map(s => s.important ? 'important' : catCssKey(s.category))
      item.dotCssKey = dots[0] || ''
      item.dotCssKey2 = dots[1] || ''
      item.dotCssKey3 = dots[2] || ''
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
   * 给单条事项补上 categoryMeta 和 timeText（类别名超长省略展示，与类别标签一致）
   */
  _enrichSchedule(s) {
    const meta = getCatMeta(s.category)
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
      categoryMeta: { ...meta, label: ellipsizeLabel(meta.label), cssKey: catCssKey(s.category) },
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
    // 默认选中第一个可选类别（自定义在前，若无则第一个内置）
    const firstCat = this.data.categoryOptions.find(c => !c.isAdd)
    this.setData({
      showForm: true,
      editingId: '',
      showMore: false,
      favManageMode: false,
      isFavSaved: false,
      titleFocus: false, // 打开表单后延迟聚焦，避免聚焦态干扰联动更新
      formData: {
        title: firstCat ? firstCat.label : '',
        category: firstCat ? firstCat.key : '',
        date: this.data.selectedDate,
        startTime: '',
        endTime: '',
        location: '',
        note: '',
        important: false
      }
    })
    // 新增模式延迟自动聚焦标题框（延迟期内用户已点类别/输入则不再强制聚焦）
    this._titleFocusTimer = setTimeout(() => {
      if (this.data.showForm && !this.data.editingId) this.setData({ titleFocus: true })
    }, 300)
  },

  editSchedule(e) {
    const id = e.currentTarget.dataset.id
    const target = (this._monthSchedules[this.data.selectedDate] || []).find(s => s._id === id)
    if (!target) return
    this.setData({
      showForm: true,
      editingId: id,
      titleFocus: false, // 编辑模式不自动聚焦，避免键盘遮挡
      isFavSaved: this.data.favoriteItems.indexOf(target.title || '') >= 0,
      formData: {
        title: target.title || '',
        category: target.category || '',
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
    if (this._titleFocusTimer) { clearTimeout(this._titleFocusTimer); this._titleFocusTimer = null }
    this.setData({ showForm: false, editingId: '', favManageMode: false, titleFocus: false })
  },

  onTitleInput(e) {
    const title = e.detail.value
    this.setData({
      'formData.title': title,
      isFavSaved: this.data.favoriteItems.indexOf(title.trim()) >= 0 && !!title.trim()
    })
  },

  /** 标题输入框失焦：解除聚焦态，后续切类别的联动更新才能刷新 input 显示 */
  onTitleBlur(e) {
    if (this.data.titleFocus) this.setData({ titleFocus: false })
  },
  onLocationInput(e)    { this.setData({ 'formData.location': e.detail.value }) },
  onNoteInput(e)        { this.setData({ 'formData.note': e.detail.value }) },
  onDateChange(e)       { this.setData({ 'formData.date': e.detail.value }) },
  onStartTimeChange(e)  { this.setData({ 'formData.startTime': e.detail.value }) },
  onEndTimeChange(e)    { this.setData({ 'formData.endTime': e.detail.value }) },

  onCatTap(e) {
    const newKey = e.currentTarget.dataset.key
    // 「＋」入口：打开自定义类别编辑弹层
    if (newKey === '__add__') {
      this.openCatEditor()
      return
    }
    const oldKey = this.data.formData.category
    if (newKey === oldKey) return
    const newMeta = getCatMeta(newKey)
    // 点击类别即联动：标题无条件切换为该类别展示名（超长省略，与标签一致）；
    // 用户随后仍可手动编辑标题，保存时按输入框实际内容存储
    const displayLabel = ellipsizeLabel(newMeta.label)
    const patch = {
      'formData.category': newKey,
      'formData.title': displayLabel,
      isFavSaved: this.data.favoriteItems.indexOf(displayLabel) >= 0
    }
    // 微信 input 聚焦期间 setData 不刷新显示：先解除聚焦再更新
    if (this.data.titleFocus) patch.titleFocus = false
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
    // 类别必选
    if (!f.category) {
      wx.showToast({ title: '请选择一个类别', icon: 'none' })
      return
    }
    // 事项非必填：留空则默认取类别名
    const catMeta = getCatMeta(f.category)
    // 留空回退与类别展示一致：超长类别用省略名
    const title = (f.title && f.title.trim()) || ellipsizeLabel(catMeta.label)
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
