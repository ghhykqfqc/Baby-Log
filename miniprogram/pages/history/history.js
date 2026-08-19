// pages/history/history.js - 成长历史记录（纵向滚动 + 分页加载 + 长按删除）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')

const DAYS_PER_MONTH = 30.44
const MS_PER_DAY = 24 * 60 * 60 * 1000
const PAGE_SIZE = 10  // 每页加载条数

Page({
  data: {
    records: [],          // 全部记录（倒序）
    visibleRecords: [],   // 当前分页可见的记录
    loading: true,
    isLoadingMore: false,
    noMore: false,
    latestHeight: '--',
    latestWeight: '--',
    // 编辑弹层
    showEditSheet: false,
    editForm: { _id: '', measureDate: '', height: '', weight: '' }
  },

  _pageIndex: 0,  // 当前已加载页数

  onLoad() {
    this.loadData()
  },

  onShow() {
    // 从成长页保存/删除后返回时刷新
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      // 非 tabBar 页，无操作
    }
  },

  /**
   * 拉取全部成长数据，前端分页切片
   */
  async loadData() {
    // 先用本地缓存秒开
    const cached = storage.get(storage.CACHE_KEYS.GROWTH_DATA) || []
    if (cached.length > 0) {
      this.applyRecords(cached)
    }

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
   * 处理记录：排序、装饰展示字段、重置分页
   */
  applyRecords(rawRecords) {
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || {}
    const birthDate = babyInfo.birthDate ? new Date(babyInfo.birthDate.replace(/-/g, '/')) : null

    // 按测量日期降序（最新在最上）
    const records = (rawRecords || [])
      .slice()
      .sort((a, b) => (b.measureDate || '').localeCompare(a.measureDate || ''))
      .map((r) => ({
        ...r,
        displayDate: this.formatShortDate(r.measureDate),
        monthAgeText: birthDate ? this.getAgeText(birthDate, r.measureDate) : ''
      }))

    // 最新身高/体重（升序取最后一条有对应字段的）
    const ascending = records.slice().sort((a, b) => (a.measureDate || '').localeCompare(b.measureDate || ''))
    let latestHeight = '--'
    let latestWeight = '--'
    for (let i = ascending.length - 1; i >= 0; i--) {
      if (latestHeight === '--' && ascending[i].height) latestHeight = ascending[i].height
      if (latestWeight === '--' && ascending[i].weight) latestWeight = ascending[i].weight
      if (latestHeight !== '--' && latestWeight !== '--') break
    }

    // 重置分页
    this._pageIndex = 1
    const visibleRecords = records.slice(0, PAGE_SIZE)
    const noMore = records.length <= PAGE_SIZE

    this.setData({
      records,
      visibleRecords,
      noMore,
      latestHeight,
      latestWeight
    })
  },

  /**
   * 上拉加载更多（分页切片）
   */
  onLoadMore() {
    if (this.data.isLoadingMore || this.data.noMore) return
    this.setData({ isLoadingMore: true })

    this._pageIndex += 1
    const end = this._pageIndex * PAGE_SIZE
    const visibleRecords = this.data.records.slice(0, end)
    const noMore = end >= this.data.records.length

    this.setData({
      visibleRecords,
      noMore,
      isLoadingMore: false
    })
  },

  /**
   * 删除记录（按钮点击触发）
   */
  onDeleteRecord(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    wx.showModal({
      title: '删除这条记录？',
      content: '删除后不可恢复',
      confirmText: '删除',
      confirmColor: '#E8554E',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          if (!String(id).startsWith('local_')) {
            await call('deleteGrowthData', { id })
          }
          const records = this.data.records.filter((r) => r._id !== id)
          storage.set(storage.CACHE_KEYS.GROWTH_DATA, records)
          this.applyRecords(records)
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // ===== 编辑功能 =====

  noop() {},

  onEditRecord(e) {
    const record = e.currentTarget.dataset.record
    if (!record) return
    this.setData({
      showEditSheet: true,
      editForm: {
        _id: record._id,
        measureDate: record.measureDate || '',
        height: record.height ? String(record.height) : '',
        weight: record.weight ? String(record.weight) : ''
      }
    })
  },

  hideEditSheet() {
    this.setData({ showEditSheet: false })
  },

  onEditDateChange(e) {
    this.setData({ 'editForm.measureDate': e.detail.value })
  },

  onEditHeightInput(e) {
    this.setData({ 'editForm.height': e.detail.value })
  },

  onEditWeightInput(e) {
    this.setData({ 'editForm.weight': e.detail.value })
  },

  async submitEdit() {
    const f = this.data.editForm
    if (!f._id) return
    if (!f.height && !f.weight) {
      wx.showToast({ title: '身高或体重至少填一项', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })
    this.setData({ showEditSheet: false })
    try {
      const isLocal = String(f._id).startsWith('local_')
      if (!isLocal) {
        await call('updateGrowthData', {
          id: f._id,
          height: f.height ? parseFloat(f.height) : null,
          weight: f.weight ? parseFloat(f.weight) : null,
          measureDate: f.measureDate
        })
      }
      // 更新本地数据
      const records = this.data.records.map(r => {
        if (r._id === f._id) {
          return { ...r, height: f.height ? parseFloat(f.height) : null, weight: f.weight ? parseFloat(f.weight) : null, measureDate: f.measureDate, displayDate: this.formatShortDate(f.measureDate) }
        }
        return r
      })
      storage.set(storage.CACHE_KEYS.GROWTH_DATA, records)
      this.applyRecords(records)
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      console.warn('编辑失败:', err)
      const msg = (err && (err.message || err.errMsg)) || '保存失败'
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  /**
   * 计算年龄文案
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

  /**
   * 格式化短日期
   */
  formatShortDate(dateStr) {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    if (parts.length < 3) return dateStr
    const [y, m, d] = parts
    const year = new Date().getFullYear()
    return parseInt(y, 10) === year
      ? `${parseInt(m, 10)}月${parseInt(d, 10)}日`
      : `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`
  }
})
