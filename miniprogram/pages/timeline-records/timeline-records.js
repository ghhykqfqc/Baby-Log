// pages/timeline-records/timeline-records.js - 时光轴记录列表（日期分组 + 滚动分页 + 删除）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatTime, minutesToText, toMs } = require('../../utils/time')
const { RECORD_CONFIG } = require('../../utils/constants')

const PAGE_STEP = 7
const MAX_DAYS = 60

Page({
  data: {
    records: [],
    groups: [],
    loading: true,
    isLoadingMore: false,
    noMore: false,
    refresherTriggered: false,
    maxDays: MAX_DAYS,
    todayLabel: '',
    // 编辑弹层
    showEditSheet: false,
    editFormData: {
      _id: '',
      recordType: '',
      label: '',
      date: '',
      time: '',
      amount: '',
      subType: '',
      duration: ''
    }
  },

  _allRecords: [],
  _loadedDays: 1,
  _autoLoaded: false,

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
    // 从时光轴页跳转来，或从首页记录后返回，都刷新
    this.loadData()
  },

  onUnload() {
    if (this._onBabySwitched) {
      app.eventBus.off('babySwitched', this._onBabySwitched)
    }
  },

  /**
   * 优先本地缓存，再拉云端
   */
  async loadData() {
    const cached = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []
    this._allRecords = cached
    this.renderRecords(cached)
    await this.fetchRecords(true)
  },

  async fetchRecords(isRefresh) {
    try {
      const result = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: this._loadedDays
      })
      if (result && result.records) {
        const normalized = result.records.map(r => ({
          ...r,
          timestamp: toMs(r.timestamp)
        }))
        this._allRecords = normalized
        this.renderRecords(normalized)
        const todayRecords = normalized.filter(r => this.isSameDay(r.timestamp, Date.now()))
        storage.set(storage.CACHE_KEYS.TODAY_RECORDS, todayRecords)

        if (isRefresh && normalized.length === 0 && !this._autoLoaded && !this.data.noMore) {
          this._autoLoaded = true
          this.setData({ loading: false })
          this.onLoadMore()
          return
        }
      }
    } catch (err) {
      console.warn('拉取记录失败:', (err && err.message) || (err && err.errMsg) || err)
    } finally {
      this.setData({ loading: false })
    }
  },

  isSameDay(ts1, ts2) {
    const d1 = new Date(ts1)
    const d2 = new Date(ts2)
    return d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
  },

  formatGroupLabel(timestamp) {
    const d = new Date(timestamp)
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (this.isSameDay(timestamp, now.getTime())) return '今天'
    if (this.isSameDay(timestamp, yesterday.getTime())) return '昨天'
    const label = `${d.getMonth() + 1}月${d.getDate()}日`
    return d.getFullYear() === now.getFullYear() ? label : `${d.getFullYear()}年${label}`
  },

  async onLoadMore() {
    if (this.data.loading || this.data.isLoadingMore || this.data.noMore) return
    this._loadedDays = Math.min(this._loadedDays + PAGE_STEP, MAX_DAYS)
    this.setData({ isLoadingMore: true, noMore: this._loadedDays >= MAX_DAYS })
    await this.fetchRecords(false)
    this.setData({ isLoadingMore: false })
  },

  async onRefresherRefresh() {
    this.setData({ refresherTriggered: true })
    try {
      await this.fetchRecords(true)
    } finally {
      this.setData({ refresherTriggered: false })
    }
  },

  renderRecords(rawRecords) {
    if (!rawRecords || rawRecords.length === 0) {
      this.setData({ records: [], groups: [], loading: false })
      return
    }

    const seen = new Set()
    const deduped = []

    rawRecords.forEach(r => {
      const ts = toMs(r.timestamp)
      if (!ts) return
      const dedupKey = `${ts}_${r.recordType}`
      if (seen.has(dedupKey)) return
      seen.add(dedupKey)

      const config = RECORD_CONFIG[r.recordType] || {}
      let extra = ''
      let extraClass = ''
      if (r.recordType === 'sleep' && r.duration) {
        extra = minutesToText(r.duration)
      } else if (r.recordType === 'feed' && r.amount) {
        extra = `${r.amount}ml`
      } else if (r.recordType === 'diaper' && r.subType) {
        extra = r.subType === 'poop' ? '💩 大便' : '💦 小便'
      } else {
        extra = '无数据'
        extraClass = 'extra-no-data'
      }

      deduped.push({
        _id: r._id || `local_${ts}`,
        recordType: r.recordType,
        timestamp: ts,
        duration: r.duration || 0,
        amount: r.amount || 0,
        subType: r.subType || '',
        label: config.label || r.recordType,
        icon: config.icon || '📝',
        color: config.color || '#D4B896',
        timeText: formatTime(ts),
        extra,
        extraClass
      })
    })

    deduped.sort((a, b) => b.timestamp - a.timestamp)

    const groups = []
    let lastDayKey = ''
    deduped.forEach(r => {
      const d = new Date(r.timestamp)
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
      if (key !== lastDayKey) {
        groups.push({ key, label: this.formatGroupLabel(r.timestamp), records: [] })
        lastDayKey = key
      }
      groups[groups.length - 1].records.push(r)
    })

    this.setData({ records: deduped, groups, loading: false })
  },

  async handleDelete(e) {
    const { id } = e.detail
    const target = this.data.records.find(r => r._id === id)
    if (!target) return

    wx.showLoading({ title: '删除中...' })
    try {
      if (!String(id).startsWith('local_')) {
        await call('deleteRecord', { id })
      }
      const records = this.data.records.filter(r => r._id !== id)
      this._allRecords = this._allRecords.filter(r => (r._id || `local_${toMs(r.timestamp)}`) !== id)
      this.renderRecords(records)
      storage.removeTodayRecord(id)
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ===== 编辑功能 =====

  /**
   * 打开编辑弹层
   */
  handleEdit(e) {
    const { record } = e.detail
    if (!record) return
    const d = new Date(record.timestamp)
    const pad = (n) => String(n).padStart(2, '0')
    this.setData({
      showEditSheet: true,
      editFormData: {
        _id: record._id,
        recordType: record.recordType,
        label: record.label,
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        amount: record.amount ? String(record.amount) : '',
        subType: record.subType || '',
        duration: record.duration ? String(record.duration) : ''
      }
    })
  },

  hideEditSheet() {
    this.setData({ showEditSheet: false })
  },

  onEditDateChange(e) {
    this.setData({ 'editFormData.date': e.detail.value })
  },

  onEditTimeChange(e) {
    this.setData({ 'editFormData.time': e.detail.value })
  },

  onEditAmountInput(e) {
    this.setData({ 'editFormData.amount': e.detail.value })
  },

  onEditDurationInput(e) {
    this.setData({ 'editFormData.duration': e.detail.value })
  },

  onEditSubType(e) {
    this.setData({ 'editFormData.subType': e.currentTarget.dataset.type })
  },

  noop() {},

  /**
   * 保存编辑
   */
  async submitEdit() {
    const f = this.data.editFormData
    if (!f._id) return

    // 组合新时间戳
    const newTs = new Date(`${f.date.replace(/-/g, '/')} ${f.time}`).getTime()
    if (isNaN(newTs)) {
      wx.showToast({ title: '时间格式有误', icon: 'none' })
      return
    }

    const updateData = { timestamp: newTs }
    if (f.recordType === 'feed') {
      updateData.amount = parseFloat(f.amount) || 0
    } else if (f.recordType === 'diaper') {
      updateData.subType = f.subType || ''
    } else if (f.recordType === 'sleep') {
      updateData.duration = parseInt(f.duration) || 0
    }

    wx.showLoading({ title: '保存中...' })
    this.setData({ showEditSheet: false })

    try {
      const isLocal = String(f._id).startsWith('local_')
      if (!isLocal) {
        await call('updateRecord', { id: f._id, ...updateData })
      }

      // 更新本地数据
      this._allRecords = this._allRecords.map(r => {
        const rid = r._id || `local_${toMs(r.timestamp)}`
        if (rid === f._id) {
          return { ...r, ...updateData }
        }
        return r
      })

      // 更新今日缓存
      const todayRecords = this._allRecords.filter(r => this.isSameDay(toMs(r.timestamp), Date.now()))
      storage.set(storage.CACHE_KEYS.TODAY_RECORDS, todayRecords)

      this.renderRecords(this._allRecords)
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      console.warn('编辑失败:', err)
      const errMsg = (err && (err.message || err.errMsg)) || '保存失败'
      wx.showToast({ title: errMsg, icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
