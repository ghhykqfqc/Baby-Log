// pages/index/index.js - 首页（天气皮肤 + 预测卡 + 相册轮播 + 单行记录）
const app = getApp()
const { call } = require('../../utils/request')
const storage = require('../../utils/storage')
const { formatElapsedSmart, formatRemainingSmart, formatDurationSmart } = require('../../utils/time')
const { predictAll, predictDetail } = require('../../utils/predict')
const { RECORD_TYPES } = require('../../utils/constants')

// 入睡后超过此时间（毫秒）仍未结束，视为漏记结束，自动复位
const SLEEP_RESET_MS = 12 * 60 * 60 * 1000

// 天气缓存有效期（30 分钟）
const WEATHER_CACHE_MS = 30 * 60 * 1000

// 相册最多张数
const ALBUM_MAX = 9

// 天气分类 → 展示文案
const WEATHER_LABELS = {
  sunny: '☀️ 晴',
  cloudy: '⛅ 多云',
  rain: '🌧 雨',
  snow: '❄️ 雪',
  wind: '🌬 有风'
}

// 天气分类 → 页面背景色（同步导航栏/窗口背景）
const WEATHER_BG = {
  sunny: '#D8EDF8',
  cloudy: '#E4E7E6',
  rain: '#DCE5EB',
  snow: '#E4EBF1',
  wind: '#EFEAD9'
}

Page({
  data: {
    babyInfo: {},
    userInfo: {},       // 当前微信用户 { nickName, avatarUrl, openid }
    babies: [],         // 当前用户可访问的所有宝宝
    currentBabyId: '',  // 用于面板高亮当前宝宝
    lastRecords: { feed: 0, diaper: 0, sleep: 0 },
    // 每张卡片的双行文案：elapsed（距上次）+ next（预计下次）
    cardTexts: {
      feed:   { elapsed: '--', next: '' },
      diaper: { elapsed: '--', next: '' },
      sleep:  { elapsed: '--', next: '' }
    },
    // 三栏预测卡数据（对齐时光轴）
    predictList: [],
    hasPrediction: false,
    // 天气皮肤
    weatherClass: 'sunny',
    weatherText: '',
    // 宝宝相册
    albumPhotos: [],
    isOffline: false,
    cloudReady: true,
    todayText: '',
    feedPress: false,
    diaperPress: false,
    sleepPress: false,
    feedSuccess: false,
    diaperSuccess: false,
    sleepSuccess: false,
    // 睡眠状态
    sleeping: false,
    sleepStartTime: 0,
    sleepDurationText: '',     // 已睡时长文案
    showSleepSheet: false,     // 睡眠回忆记录面板（长按触发）
    // 喂奶量弹层（长按触发）
    showFeedSheet: false,
    feedAmountInput: '',
    // 尿布类型弹层（长按触发）
    showDiaperSheet: false,
    diaperTypeInput: '',
    // 宝宝管理面板
    showBabySheet: false,
    formMode: '',         // '' | 'create' | 'join' | 'success'
    formAvatar: '',
    formName: '',
    formBirthDate: '',
    formGender: '',
    joinBabyId: '',
    joinBabyCode: '',
    newBabyId: '',
    newBabyCode: '',
    // 照片编辑面板
    showPhotoEditSheet: false,
    currentAlbumIndex: 0,        // 当前 swiper 索引
    photoEditCurrent: {          // 当前编辑的照片 { src, tag, id }
      src: '',
      tag: '',
      id: ''
    },
    // 上传裁剪（固定 4:3 裁剪框）
    showUploadCropper: false,
    uploadRawPath: '',          // 待裁剪原图
    cropStageSize: 300,         // 裁剪舞台边长（px，onLoad 计算）
    cropImgW: 0, cropImgH: 0,   // 图片显示尺寸
    cropImgX: 0, cropImgY: 0,   // 图片在舞台位置
    cropBoxW: 300,              // 裁剪框宽（4:3 → 宽 = 舞台宽）
    cropBoxH: 225,              // 裁剪框高（舞台 * 0.75）
    touchStartX: 0, touchStartY: 0,
    touchStartImgX: 0, touchStartImgY: 0,
    // 上传标签选择（默认当前宝宝昵称）
    uploadTag: ''                // 标签 = 宝宝昵称
  },

  _timer: null,
  _sleepTick: null,
  _countdownTimer: null,
  _allRecords: [],   // 用于预测计算的完整记录

  onLoad() {
    app.eventBus.on('recordsUpdated', this.refreshFromCache.bind(this))
    app.eventBus.on('babySwitched', this.onBabySwitched.bind(this))
    this.updateTodayText()
    this.restoreSleepState()
    // 初始化上传裁剪舞台尺寸（4:3 裁剪框）
    try {
      const sys = wx.getSystemInfoSync()
      const stage = Math.min(320, Math.floor(sys.windowWidth * 0.9))
      this.setData({
        cropStageSize: stage,
        cropBoxW: stage,
        cropBoxH: Math.floor(stage * 0.75)
      })
    } catch (e) {}
  },

  onShow() {
    // 登录态校验：未登录直接跳登录页
    if (!app.requireLogin()) return

    this.setData({ cloudReady: app.globalData.cloudReady })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().switchTab('pages/index/index')
    }
    // 同步当前用户与宝宝信息到视图
    this.syncGlobalToView()
    this.loadAlbum()
    this.refreshFromCache()
    this.loadWeather()
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
      // 异步刷新宝宝列表（不阻塞渲染）
      app.refreshBabies().then(babies => {
        this.setData({ babies, currentBabyId: app.globalData.babyId })
        // 如果当前没有选中宝宝且有宝宝列表，自动选中第一个
        if (!app.globalData.babyId && babies.length > 0) {
          app.setCurrentBaby(babies[0])
        }
      }).catch(() => {})
    }
    this._timer = setInterval(() => this.updateCardTexts(), 30000)
    this.startSleepTick()
  },

  /**
   * 把 globalData 中的 userInfo/babies/babyInfo 同步到视图
   */
  syncGlobalToView() {
    this.setData({
      userInfo: app.globalData.userInfo || {},
      babies: app.globalData.babies || [],
      babyInfo: app.globalData.babyInfo || {},
      currentBabyId: app.globalData.babyId || ''
    })
  },

  /**
   * 收到宝宝切换事件时刷新本页
   */
  onBabySwitched(payload) {
    this.syncGlobalToView()
    this.loadAlbum()
    this.refreshFromCache()
    if (app.globalData.cloudReady) {
      this.fetchCloudData()
    }
  },

  onHide() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.stopCountdown()
    this.stopSleepTick()
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
    this.stopCountdown()
    this.stopSleepTick()
    app.eventBus.off('recordsUpdated', this.refreshFromCache)
    app.eventBus.off('babySwitched', this.onBabySwitched)
  },

  updateTodayText() {
    const d = new Date()
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    this.setData({ todayText: `${d.getMonth() + 1}/${d.getDate()} 周${week}` })
  },

  // ============================================
  // 天气皮肤
  // ============================================

  /**
   * 加载天气：本地缓存优先（30 分钟有效），否则调云函数
   */
  async loadWeather() {
    let weather = null
    try {
      const cached = storage.get(storage.CACHE_KEYS.WEATHER_INFO)
      if (cached && (Date.now() - cached.ts) < WEATHER_CACHE_MS && cached.category) {
        weather = cached
      }
    } catch (e) {}

    if (!weather) {
      if (app.globalData.cloudReady) {
        try {
          const res = await call('getWeather', {})
          if (res && res.category) {
            weather = { ...res, ts: Date.now() }
            storage.set(storage.CACHE_KEYS.WEATHER_INFO, weather)
          }
        } catch (err) {
          console.warn('获取天气失败，使用默认晴天皮肤:', (err && err.message) || err)
        }
      }
      if (!weather) {
        // 兜底：默认晴天，短缓存避免每次进页都请求
        weather = { category: 'sunny', temp: '', ts: Date.now() - WEATHER_CACHE_MS + 5 * 60 * 1000 }
      }
    }

    this.applyWeather(weather)
  },

  applyWeather(weather) {
    const category = WEATHER_LABELS[weather.category] ? weather.category : 'sunny'
    const label = WEATHER_LABELS[category]
    const temp = (weather.temp !== undefined && weather.temp !== null && weather.temp !== '') ? ` ${Math.round(weather.temp)}°` : ''
    const d = new Date()
    this.setData({
      weatherClass: category,
      weatherText: `${label}${temp} · ${d.getMonth() + 1}/${d.getDate()}`
    })
    try {
      wx.setBackgroundColor({ backgroundColor: WEATHER_BG[category] })
    } catch (e) {}
  },

  // ============================================
  // 宝宝封面相册
  // ============================================

  loadAlbum() {
    const album = storage.get(storage.CACHE_KEYS.ALBUM_PHOTOS) || []
    this.setData({ albumPhotos: album })
  },

  /**
   * 上传照片到相册：先选图 → 固定 4:3 裁剪 → 选择标签 → 上传
   */
  addAlbumPhoto() {
    const remain = ALBUM_MAX - this.data.albumPhotos.length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${ALBUM_MAX} 张`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        this.openUploadCropper(file.tempFilePath)
      },
      fail: () => {}
    })
  },

  /**
   * 打开上传裁剪（固定 4:3 裁剪框）
   */
  openUploadCropper(path) {
    // 默认标签 = 当前宝宝昵称
    const defaultTag = (app.globalData.babyInfo && app.globalData.babyInfo.name) || ''
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const stage = this.data.cropStageSize
        // 图片完整放入舞台内，等比缩放
        let w = info.width, h = info.height
        if (w > stage || h > stage) {
          const ratio = Math.min(stage / w, stage / h)
          w = Math.floor(w * ratio)
          h = Math.floor(h * ratio)
        }
        this.setData({
          showUploadCropper: true,
          uploadRawPath: path,
          uploadTag: defaultTag,
          cropImgW: w, cropImgH: h,
          cropImgX: Math.floor((stage - w) / 2),
          cropImgY: Math.floor((stage - h) / 2)
        })
      },
      fail: () => {
        // 取不到信息时用默认舞台大小
        this.setData({
          showUploadCropper: true,
          uploadRawPath: path,
          uploadTag: defaultTag,
          cropImgW: 200, cropImgH: 200,
          cropImgX: 50, cropImgY: 50
        })
      }
    })
  },

  // ===== 上传裁剪触摸 =====
  onCropUpTouchStart(e) {
    if (e.touches.length === 1) {
      this.setData({
        touchStartX: e.touches[0].clientX,
        touchStartY: e.touches[0].clientY,
        touchStartImgX: this.data.cropImgX,
        touchStartImgY: this.data.cropImgY
      })
    }
  },

  onCropUpTouchMove(e) {
    if (e.touches.length !== 1) return
    const dx = e.touches[0].clientX - this.data.touchStartX
    const dy = e.touches[0].clientY - this.data.touchStartY
    this.setData({
      cropImgX: this.data.touchStartImgX + dx,
      cropImgY: this.data.touchStartImgY + dy
    })
  },

  onCropUpTouchEnd() {},

  cancelUploadCropper() {
    this.setData({ showUploadCropper: false, uploadRawPath: '' })
  },

  /**
   * 确认裁剪：用页面内隐藏 canvas 导出 4:3 图片
   * 若处于"替换照片"模式（_replaceMode=true）则替换当前照片，否则新增
   */
  confirmUploadCropper() {
    const { uploadRawPath, cropImgW, cropImgH, cropImgX, cropImgY, cropBoxW, cropBoxH, cropStageSize, uploadTag } = this.data

    const query = wx.createSelectorQuery()
    query.select('#uploadCropCanvas')
      .fields({ node: true })
      .exec((res) => {
        // 降级：无 canvas 时直接用原图继续
        if (!res || !res[0] || !res[0].node) {
          this.afterCropped(uploadRawPath, uploadTag)
          return
        }

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const outputW = 800, outputH = 600   // 4:3 输出
        canvas.width = outputW
        canvas.height = outputH

        const img = canvas.createImage()
        img.onload = () => {
          // 把裁剪框映射回原图坐标（裁剪框居于舞台中央）
          const ratioX = img.width / cropImgW
          const ratioY = img.height / cropImgH
          const cropLeft = (cropStageSize - cropBoxW) / 2
          const cropTop = (cropStageSize - cropBoxH) / 2
          const sx = (cropLeft - cropImgX) * ratioX
          const sy = (cropTop - cropImgY) * ratioY
          const sw = cropBoxW * ratioX
          const sh = cropBoxH * ratioY

          ctx.clearRect(0, 0, outputW, outputH)
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputW, outputH)

          wx.canvasToTempFilePath({
            canvas,
            x: 0, y: 0,
            width: outputW,
            height: outputH,
            destWidth: outputW,
            destHeight: outputH,
            fileType: 'jpg',
            quality: 0.9,
            success: (r) => {
              this.afterCropped(r.tempFilePath, uploadTag)
            },
            fail: () => {
              this.afterCropped(uploadRawPath, uploadTag)
            }
          })
        }
        img.onerror = () => {
          this.afterCropped(uploadRawPath, uploadTag)
        }
        img.src = uploadRawPath
      })
  },

  /**
   * 裁剪完成后分发：新增 or 替换
   */
  async afterCropped(croppedPath, tag) {
    if (this._replaceMode) {
      // 替换模式：上传新图并替换当前照片
      await this.doReplacePhoto(croppedPath, tag)
    } else {
      // 新增模式：上传并追加
      await this.closeModalCropperAndUpload(croppedPath, tag)
    }
  },

  /**
   * 执行"替换当前照片"：上传新图 → 替换 albumPhotos 中对应项
   */
  async doReplacePhoto(croppedPath, tag) {
    const { photoEditCurrent, albumPhotos } = this.data
    this._replaceMode = false
    this.setData({ showUploadCropper: false, uploadRawPath: '' })

    wx.showLoading({ title: '替换中...' })
    const babyId = app.globalData.babyId || 'default'
    let finalSrc = croppedPath
    let finalId = `local_${Date.now()}`

    if (app.globalData.cloudReady) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `album/${babyId}/${Date.now()}_r.jpg`,
          filePath: croppedPath
        })
        if (up && up.fileID) {
          finalSrc = up.fileID
          finalId = up.fileID
        }
      } catch (err) {
        console.warn('替换照片上传失败，暂用本地路径:', (err && err.errMsg) || err)
      }
    }

    // 更新对应照片
    const index = albumPhotos.findIndex(p => p.id === photoEditCurrent.id)
    const finalTag = tag || photoEditCurrent.tag || ''
    const updated = albumPhotos.slice()
    if (index >= 0) {
      // 删除旧云文件
      if (String(updated[index].id).startsWith('cloud://')) {
        wx.cloud.deleteFile({ fileList: [updated[index].id] }).catch(() => {})
      }
      updated[index] = { ...updated[index], src: finalSrc, id: finalId, tag: finalTag }
    } else {
      updated.push({ id: finalId, src: finalSrc, tag: finalTag })
    }

    storage.set(storage.CACHE_KEYS.ALBUM_PHOTOS, updated)
    this.setData({ albumPhotos: updated })

    if (app.globalData.cloudReady) {
      try {
        await call('saveBabyInfo', {
          babyId,
          albumPhotos: updated.map(p => p.src)
        })
      } catch (err) {
        console.warn('相册云端更新失败:', (err && err.message) || err)
      }
    }
    wx.hideLoading()
    wx.showToast({ title: '已替换', icon: 'success' })
  },

  /**
   * 关闭裁剪面板并执行上传（带标签）—— 新增模式
   */
  async closeModalCropperAndUpload(croppedPath, tag) {
    this.setData({ showUploadCropper: false, uploadRawPath: '' })

    wx.showLoading({ title: '添加中...' })
    const babyId = app.globalData.babyId || 'default'
    let uploaded = null

    // 云可用：上传换取永久 fileID；否则退化为本地临时路径
    if (app.globalData.cloudReady) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `album/${babyId}/${Date.now()}.jpg`,
          filePath: croppedPath
        })
        if (up && up.fileID) {
          uploaded = { id: up.fileID, src: up.fileID }
        }
      } catch (err) {
        console.warn('相册照片上传失败，暂用本地路径:', (err && err.errMsg) || err)
      }
    }
    if (!uploaded) {
      uploaded = { id: `local_${Date.now()}`, src: croppedPath }
    }

    // 标签：默认当前宝宝昵称（已由 openUploadCropper 设置），或用户选择的其他宝宝昵称
    uploaded.tag = tag || (app.globalData.babyInfo && app.globalData.babyInfo.name) || ''

    const albumPhotos = this.data.albumPhotos.concat([uploaded]).slice(0, ALBUM_MAX)
    storage.set(storage.CACHE_KEYS.ALBUM_PHOTOS, albumPhotos)
    this.setData({ albumPhotos })

    // 云端持久化（babies.albumPhotos），失败不影响本地使用
    if (app.globalData.cloudReady) {
      try {
        await call('saveBabyInfo', {
          babyId,
          albumPhotos: albumPhotos.map(p => p.src)
        })
      } catch (err) {
        console.warn('相册云端保存失败:', (err && err.message) || err)
      }
    }

    wx.hideLoading()
    wx.showToast({ title: '已添加', icon: 'success' })
  },

  /**
   * 上传动画裁剪标签选择
   */
  selectUploadTag(e) {
    this.setData({ uploadTag: e.currentTarget.dataset.tag })
  },

  /**
   * 长按删除相册照片（保留，编辑面板内也有删除入口）
   */
  async removeAlbumPhoto(e) {
    const index = Number(e.currentTarget.dataset.index)
    const target = this.data.albumPhotos[index]
    if (!target) return

    const { confirm } = await wx.showModal({
      title: '删除照片',
      content: '确定从相册删除这张照片吗？',
      confirmColor: '#E8554E'
    }).catch(() => ({ confirm: false }))
    if (!confirm) return

    const albumPhotos = this.data.albumPhotos.filter((_, i) => i !== index)
    storage.set(storage.CACHE_KEYS.ALBUM_PHOTOS, albumPhotos)
    this.setData({ albumPhotos })

    // 删除云文件 + 更新云端相册列表
    if (app.globalData.cloudReady) {
      if (String(target.id).startsWith('cloud://')) {
        wx.cloud.deleteFile({ fileList: [target.id] }).catch(() => {})
      }
      try {
        await call('saveBabyInfo', {
          babyId: app.globalData.babyId || 'default',
          albumPhotos: albumPhotos.map(p => p.src)
        })
      } catch (err) {
        console.warn('相册云端更新失败:', (err && err.message) || err)
      }
    }
  },

  // ============================================
  // 照片编辑面板（替换 / 标签 / 删除）
  // ============================================

  /**
   * swiper 滑动时记录当前索引
   */
  onAlbumChange(e) {
    this.setData({ currentAlbumIndex: e.detail.current })
  },

  /**
   * 点击右上角编辑按钮（✏️）：打开编辑面板
   */
  showPhotoEdit() {
    const { albumPhotos, currentAlbumIndex } = this.data
    const current = albumPhotos[currentAlbumIndex] || albumPhotos[0]
    if (!current) return
    this.setData({
      showPhotoEditSheet: true,
      currentAlbumIndex,
      photoEditCurrent: {
        id: current.id,
        src: current.src,
        tag: current.tag || (app.globalData.babyInfo && app.globalData.babyInfo.name) || ''
      }
    })
  },

  hidePhotoEdit() {
    this.setData({ showPhotoEditSheet: false })
  },

  /**
   * 选择标签（宝宝昵称）
   */
  selectPhotoTag(e) {
    this.setData({ 'photoEditCurrent.tag': e.currentTarget.dataset.tag })
  },

  /**
   * 替换当前照片：重新选图 → 裁剪 → 替换
   */
  replaceCurrentPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        // 关闭编辑面板，进入替换模式的裁剪
        this.hidePhotoEdit()
        // 记住进入替换模式（裁剪确认后走替换逻辑而非新增）
        this._replaceMode = true
        // 记住当前的编辑目标（doReplacePhoto 用）
        this.setData({
          uploadRawPath: file.tempFilePath,
          showUploadCropper: true,
          uploadTag: this.data.photoEditCurrent.tag || '',
          cropImgW: 200, cropImgH: 200,
          cropImgX: 50, cropImgY: 50
        })
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => {
            const stage = this.data.cropStageSize
            let w = info.width, h = info.height
            if (w > stage || h > stage) {
              const ratio = Math.min(stage / w, stage / h)
              w = Math.floor(w * ratio)
              h = Math.floor(h * ratio)
            }
            this.setData({
              cropImgW: w, cropImgH: h,
              cropImgX: Math.floor((stage - w) / 2),
              cropImgY: Math.floor((stage - h) / 2)
            })
          },
          fail: () => {}
        })
      },
      fail: () => {}
    })
  },

  /**
   * 删除当前照片
   */
  deleteCurrentPhoto() {
    const { albumPhotos, currentAlbumIndex, photoEditCurrent } = this.data
    const index = albumPhotos.findIndex(p => p.id === photoEditCurrent.id)
    if (index < 0) return

    wx.showModal({
      title: '删除照片',
      content: '确定从相册删除这张照片吗？',
      confirmColor: '#E8554E',
      success: (r) => {
        if (!r.confirm) return
        const target = albumPhotos[index]
        const filtered = albumPhotos.filter((_, i) => i !== index)
        storage.set(storage.CACHE_KEYS.ALBUM_PHOTOS, filtered)
        this.setData({
          albumPhotos: filtered,
          showPhotoEditSheet: false,
          currentAlbumIndex: Math.max(0, index - 1)
        })
        if (app.globalData.cloudReady) {
          if (String(target.id).startsWith('cloud://')) {
            wx.cloud.deleteFile({ fileList: [target.id] }).catch(() => {})
          }
          call('saveBabyInfo', {
            babyId: app.globalData.babyId || 'default',
            albumPhotos: filtered.map(p => p.src)
          }).catch(() => {})
        }
      }
    })
  },

  /**
   * 保存照片编辑（标签变更 / 新图替换）
   */
  savePhotoEdit() {
    const { albumPhotos, photoEditCurrent } = this.data
    const index = albumPhotos.findIndex(p => p.id === photoEditCurrent.id)
    if (index < 0) return

    const updated = albumPhotos.map((p, i) => {
      if (i === index) {
        return {
          ...p,
          tag: photoEditCurrent.tag || '',
          src: photoEditCurrent.src || p.src,
          id: photoEditCurrent.id || p.id
        }
      }
      return p
    })

    storage.set(storage.CACHE_KEYS.ALBUM_PHOTOS, updated)
    this.setData({ albumPhotos: updated, showPhotoEditSheet: false })

    if (app.globalData.cloudReady) {
      call('saveBabyInfo', {
        babyId: app.globalData.babyId || 'default',
        albumPhotos: updated.map(p => p.src)
      }).catch(() => {})
    }
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  // ============================================
  // 睡眠状态
  // ============================================

  /**
   * 从本地存储恢复睡眠中的状态（应对小程序被关闭重开）
   */
  restoreSleepState() {
    try {
      const sleepStart = wx.getStorageSync('sleepStartTime') || 0
      if (sleepStart && (Date.now() - sleepStart) < SLEEP_RESET_MS) {
        this.setData({ sleeping: true, sleepStartTime: sleepStart })
      } else if (sleepStart) {
        // 超时复位
        wx.removeStorageSync('sleepStartTime')
      }
    } catch (e) {}
  },

  startSleepTick() {
    this.stopSleepTick()
    if (!this.data.sleeping) return
    this.updateSleepDurationText()
    this._sleepTick = setInterval(() => this.updateSleepDurationText(), 30000)
  },

  stopSleepTick() {
    if (this._sleepTick) {
      clearInterval(this._sleepTick)
      this._sleepTick = null
    }
  },

  updateSleepDurationText() {
    if (!this.data.sleeping || !this.data.sleepStartTime) {
      this.setData({ sleepDurationText: '' })
      return
    }
    // 超过 14 小时视为漏记结束，自动复位
    if (Date.now() - this.data.sleepStartTime > 14 * 60 * 60 * 1000) {
      this.autoResetSleep()
      return
    }
    const minutes = Math.max(0, Math.floor((Date.now() - this.data.sleepStartTime) / 60000))
    this.setData({ sleepDurationText: this.minutesToText(minutes) })
  },

  autoResetSleep() {
    this.stopSleepTick()
    try { wx.removeStorageSync('sleepStartTime') } catch (e) {}
    this.setData({ sleeping: false, sleepStartTime: 0, sleepDurationText: '' })
    this.updateCardTexts()
  },

  minutesToText(minutes) {
    if (minutes < 1) return '0分钟'
    if (minutes < 60) return `${minutes}分钟`
    const hours = Math.floor(minutes / 60)
    const remain = minutes % 60
    return remain ? `${hours}小时${remain}分` : `${hours}小时`
  },

  // ============================================
  // 数据刷新
  // ============================================

  stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  /**
   * 计算三栏预测卡（预计时间点 + 倒计时）
   */
  updatePredictions() {
    const detail = predictDetail(this._allRecords)
    const predictList = [
      { key: 'feed', ...detail.feed },
      { key: 'diaper', ...detail.diaper },
      { key: 'sleep', ...detail.sleep }
    ]
    const hasPrediction = predictList.some(p => p.available)
    this.setData({ predictList, hasPrediction })

    this.stopCountdown()
    if (hasPrediction) {
      this._countdownTimer = setInterval(() => {
        const refreshed = predictList.map(p => {
          if (!p.available) return p
          const d = predictDetail(this._allRecords)[p.key]
          return { ...p, countdownText: d.countdownText, overdue: d.overdue, predictedText: d.predictedText }
        })
        this.setData({ predictList: refreshed })
      }, 30000)
    }
  },

  refreshFromCache() {
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || { name: '宝宝', age: '新生儿' }
    const lastRecords = storage.getLastRecords()
    this._allRecords = storage.get(storage.CACHE_KEYS.TODAY_RECORDS) || []

    this.setData({ babyInfo, lastRecords })
    this.updatePredictions()
    this.updateCardTexts()
  },

  /**
   * 统一生成三张卡片的「距上次 + 预计下次」双行文案
   * 睡眠入睡中时改用「已睡 + 预计醒来」
   */
  updateCardTexts() {
    const { lastRecords, sleeping, sleepStartTime } = this.data
    const predictionData = storage.get(storage.CACHE_KEYS.PREDICTION) || {}

    const build = (type) => {
      const last = lastRecords[type] || 0
      const pred = predictionData[type] || {}
      const avgInterval = pred.avgInterval || 0

      if (type === 'sleep' && sleeping && sleepStartTime) {
        // 入睡中：已睡 + 预计醒来
        const sleptMin = (Date.now() - sleepStartTime) / 60000
        return {
          elapsed: `已睡 ${formatDurationSmart(sleptMin)}`,
          next: avgInterval ? `${formatDurationSmart(avgInterval - sleptMin)}后醒` : ''
        }
      }

      const elapsed = last ? `距上次 ${formatElapsedSmart(last)}` : '--'
      const next = formatRemainingSmart(avgInterval, last)
      return { elapsed, next }
    }

    this.setData({
      cardTexts: {
        feed: build('feed'),
        diaper: build('diaper'),
        sleep: build('sleep')
      }
    })
  },

  async fetchCloudData() {
    if (!app.globalData.cloudReady) return
    try {
      const data = await call('getRecords', {
        babyId: app.globalData.babyId || 'default',
        days: 7
      })
      if (data && data.records) {
        const lastRecords = { feed: 0, diaper: 0, sleep: 0 }
        const normalized = data.records.map(r => ({
          ...r,
          timestamp: this.normalizeTimestamp(r.timestamp)
        }))
        normalized.forEach(r => {
          if (lastRecords[r.recordType] !== undefined) {
            if (!lastRecords[r.recordType] || r.timestamp > lastRecords[r.recordType]) {
              lastRecords[r.recordType] = r.timestamp
            }
          }
        })
        storage.set(storage.CACHE_KEYS.LAST_RECORDS, lastRecords)

        const predictionResult = predictAll(normalized)
        storage.set(storage.CACHE_KEYS.PREDICTION, predictionResult)

        this._allRecords = normalized
        this.setData({ lastRecords })
        this.updatePredictions()
        this.updateCardTexts()
      }
    } catch (err) {
      console.warn('拉取云端数据失败，使用本地缓存:', (err && err.message) || (err && err.errMsg) || err)
      if (String(err.errCode || '').includes('-501000') || String(err.errMsg || '').includes('-501000')) {
        app.globalData.cloudReady = false
        this.setData({ cloudReady: false })
      }
    }
  },

  normalizeTimestamp(ts) {
    if (!ts) return 0
    if (typeof ts === 'number') return ts
    const d = new Date(ts)
    return isNaN(d.getTime()) ? 0 : d.getTime()
  },

  // ============================================
  // 记录操作：喂奶 / 尿布 / 睡觉
  // ============================================
  // 记录操作：单击 = 记录时间点，长按 = 弹层填详情
  // ============================================

  async handleFeed() {
    await this.recordAction(RECORD_TYPES.FEED, 'feedPress', 'feedSuccess', '已记录喂奶')
  },

  async handleDiaper() {
    await this.recordAction(RECORD_TYPES.DIAPER, 'diaperPress', 'diaperSuccess', '已记录换尿布')
  },

  /**
   * 睡眠单击：切换入睡/醒来
   */
  handleSleepTap() {
    if (this.data.sleeping) {
      this.endSleep()
    } else {
      this.startSleep()
    }
  },

  /**
   * 睡眠长按：弹出回忆记录面板
   */
  showSleepSheet() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ showSleepSheet: true })
  },

  // ===== 喂奶量弹层（长按） =====
  showFeedSheet() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ showFeedSheet: true, feedAmountInput: '' })
  },

  hideFeedSheet() {
    this.setData({ showFeedSheet: false })
  },

  onFeedAmountInput(e) {
    this.setData({ feedAmountInput: e.detail.value })
  },

  async saveFeedWithAmount() {
    const amount = parseFloat(this.data.feedAmountInput) || 0
    this.setData({ showFeedSheet: false })
    wx.vibrateShort({ type: 'light' })
    this.setData({ feedPress: true })
    setTimeout(() => this.setData({ feedPress: false }), 300)

    const timestamp = Date.now()
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.FEED,
      timestamp,
      amount,
      duration: 0,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }

    storage.updateLastRecord(RECORD_TYPES.FEED, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    this.setData({ feedSuccess: true })
    setTimeout(() => this.setData({ feedSuccess: false }), 1000)

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    wx.showToast({ title: amount ? `已记录 ${amount}ml` : '已记录喂奶', icon: 'success' })
  },

  // ===== 尿布类型弹层（长按） =====
  showDiaperSheet() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ showDiaperSheet: true, diaperTypeInput: '' })
  },

  hideDiaperSheet() {
    this.setData({ showDiaperSheet: false })
  },

  selectDiaperType(e) {
    this.setData({ diaperTypeInput: e.currentTarget.dataset.type })
  },

  async saveDiaperWithType() {
    const subType = this.data.diaperTypeInput
    this.setData({ showDiaperSheet: false })
    wx.vibrateShort({ type: 'light' })
    this.setData({ diaperPress: true })
    setTimeout(() => this.setData({ diaperPress: false }), 300)

    const timestamp = Date.now()
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.DIAPER,
      timestamp,
      subType,
      duration: 0,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }

    storage.updateLastRecord(RECORD_TYPES.DIAPER, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    this.setData({ diaperSuccess: true })
    setTimeout(() => this.setData({ diaperSuccess: false }), 1000)

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    const typeText = subType === 'poop' ? '大便' : subType === 'pee' ? '小便' : ''
    wx.showToast({ title: typeText ? `已记录${typeText}` : '已记录换尿布', icon: 'success' })
  },

  /**
   * 标记刚刚入睡
   */
  async startSleep() {
    const now = Date.now()
    wx.vibrateShort({ type: 'light' })
    this.setData({
      showSleepSheet: false,
      sleeping: true,
      sleepStartTime: now,
      sleepPress: true
    })
    setTimeout(() => this.setData({ sleepPress: false }), 300)
    try { wx.setStorageSync('sleepStartTime', now) } catch (e) {}

    storage.updateLastRecord(RECORD_TYPES.SLEEP, now)
    app.eventBus.emit('recordsUpdated')
    this.startSleepTick()
    this.updateCardTexts()

    // 写入云端一条 duration=0 的入睡记录（结束时再补 duration）
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.SLEEP,
      timestamp: now,
      duration: 0,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }
    storage.appendTodayRecord({ ...record, _id: `local_${now}` })

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    this.setData({ sleepSuccess: true })
    setTimeout(() => this.setData({ sleepSuccess: false }), 1000)
    wx.showToast({ title: '已记录入睡', icon: 'none' })
  },

  /**
   * 结束睡眠：计算时长并写入新记录（duration 为本次睡眠分钟数）
   */
  async endSleep() {
    const start = this.data.sleepStartTime
    if (!start) {
      this.setData({ sleeping: false, showSleepSheet: false })
      return
    }
    const end = Date.now()
    const minutes = Math.max(1, Math.round((end - start) / 60000))

    wx.vibrateShort({ type: 'light' })
    this.setData({
      sleeping: false,
      showSleepSheet: false,
      sleepStartTime: 0,
      sleepDurationText: ''
    })
    try { wx.removeStorageSync('sleepStartTime') } catch (e) {}
    this.stopSleepTick()

    // 写入结束记录（带 duration）
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.SLEEP,
      timestamp: start,        // 以入睡时间为准
      duration: minutes,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }
    storage.updateLastRecord(RECORD_TYPES.SLEEP, end)
    storage.appendTodayRecord({ ...record, _id: `local_${end}`, timestamp: end, duration: minutes })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    wx.showToast({ title: `本次睡眠 ${this.minutesToText(minutes)}`, icon: 'success' })
  },

  /**

   * 选择一个时长，立即记录"刚刚结束"的一次睡眠
   */
  async selectDuration(e) {
    const minutes = Number(e.currentTarget.dataset.minutes) || 0
    if (minutes <= 0) return
    const end = Date.now()
    const start = end - minutes * 60000

    wx.vibrateShort({ type: 'light' })
    this.setData({ showSleepSheet: false, sleepPress: true })
    setTimeout(() => this.setData({ sleepPress: false }), 300)

    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: RECORD_TYPES.SLEEP,
      timestamp: start,
      duration: minutes,
      userId: app.globalData.openid || '',
      createdAt: new Date().toISOString()
    }
    storage.updateLastRecord(RECORD_TYPES.SLEEP, end)
    storage.appendTodayRecord({ ...record, _id: `local_${end}`, timestamp: end, duration: minutes })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }

    this.setData({ sleepSuccess: true })
    setTimeout(() => this.setData({ sleepSuccess: false }), 1000)
    wx.showToast({ title: `已记录 ${this.minutesToText(minutes)}`, icon: 'success' })
  },

  hideSleepSheet() {
    this.setData({ showSleepSheet: false })
  },

  noop() {},

  /**
   * 跳转到宝宝资料页（保留供"编辑"按钮使用）
   */
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // ============================================
  // 宝宝管理面板
  // ============================================

  showBabyPanel() {
    this.syncGlobalToView()
    this.setData({ showBabySheet: true, formMode: '' })
  },

  hideBabyPanel() {
    this.setData({
      showBabySheet: false,
      formMode: '',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: '',
      joinBabyId: '',
      joinBabyCode: ''
    })
  },

  /**
   * 切换宝宝
   */
  switchBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    const target = (app.globalData.babies || []).find(b => b.babyId === babyId)
    if (!target) return
    if (target.babyId === app.globalData.babyId) {
      // 已是当前宝宝，关闭面板
      this.hideBabyPanel()
      return
    }
    app.setCurrentBaby(target)
    this.syncGlobalToView()
    wx.showToast({ title: `已切换到 ${target.name || '宝宝'}`, icon: 'none' })
    setTimeout(() => this.hideBabyPanel(), 300)
  },

  /**
   * 编辑宝宝：跳转到 profile 页（携带 babyId 参数由 profile 处理）
   */
  editBaby(e) {
    const babyId = e.currentTarget.dataset.babyId
    this.hideBabyPanel()
    setTimeout(() => {
      wx.navigateTo({ url: `/pages/profile/profile?babyId=${babyId}` })
    }, 200)
  },

  // ===== 新建宝宝 =====
  startCreateBaby() {
    this.setData({
      formMode: 'create',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: ''
    })
  },

  onFormChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (avatarUrl) this.setData({ formAvatar: avatarUrl })
  },

  onFormNameInput(e) {
    this.setData({ formName: e.detail.value })
  },

  onFormBirthChange(e) {
    this.setData({ formBirthDate: e.detail.value })
  },

  onFormGenderTap(e) {
    this.setData({ formGender: e.currentTarget.dataset.gender })
  },

  async submitCreateBaby() {
    const { formAvatar, formName, formBirthDate, formGender } = this.data
    if (!formName || !formName.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '云环境不可用', icon: 'none' })
      return
    }

    wx.showLoading({ title: '创建中...', mask: true })

    try {
      let finalAvatar = formAvatar
      // 上传头像
      if (formAvatar && !formAvatar.startsWith('cloud://')) {
        try {
          const ts = Date.now()
          const upRes = await wx.cloud.uploadFile({
            cloudPath: `avatars/${ts}.png`,
            filePath: formAvatar
          })
          if (upRes && upRes.fileID) finalAvatar = upRes.fileID
        } catch (err) {
          console.warn('宝宝头像上传失败:', err)
        }
      }

      const res = await wx.cloud.callFunction({
        name: 'createBaby',
        data: {
          name: formName.trim(),
          avatar: finalAvatar,
          birthDate: formBirthDate,
          gender: formGender
        }
      })

      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.message) || '创建失败')
      }

      const newBaby = res.result.data
      // 刷新宝宝列表
      const babies = await app.refreshBabies()
      // 选中新创建的宝宝
      app.setCurrentBaby(newBaby)
      this.syncGlobalToView()

      // 显示成功页（含 ID 与密码）
      this.setData({
        formMode: 'success',
        newBabyId: newBaby.babyId,
        newBabyCode: newBaby.babyCode
      })
      wx.hideLoading()
    } catch (err) {
      console.error('创建宝宝失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '创建失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    }
  },

  copyNewBaby() {
    const { newBabyId, newBabyCode } = this.data
    wx.setClipboardData({
      data: `宝宝 ID：${newBabyId}\n加入密码：${newBabyCode}`,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' })
        setTimeout(() => this.hideBabyPanel(), 500)
      }
    })
  },

  // ===== 加入宝宝 =====
  startJoinBaby() {
    this.setData({
      formMode: 'join',
      joinBabyId: '',
      joinBabyCode: ''
    })
  },

  onJoinBabyIdInput(e) {
    this.setData({ joinBabyId: (e.detail.value || '').toUpperCase().trim() })
  },

  onJoinBabyCodeInput(e) {
    this.setData({ joinBabyCode: (e.detail.value || '').trim() })
  },

  async submitJoinBaby() {
    const { joinBabyId, joinBabyCode } = this.data
    if (!joinBabyId || joinBabyId.length !== 8) {
      wx.showToast({ title: '请填写 8 位宝宝 ID', icon: 'none' })
      return
    }
    if (!joinBabyCode || joinBabyCode.length !== 6) {
      wx.showToast({ title: '请填写 6 位密码', icon: 'none' })
      return
    }
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '云环境不可用', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加入中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'joinBaby',
        data: { babyId: joinBabyId, babyCode: joinBabyCode }
      })

      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.message) || '加入失败')
      }

      const baby = res.result.data
      // 刷新宝宝列表
      const babies = await app.refreshBabies()
      // 切换到刚加入的宝宝
      app.setCurrentBaby(baby)
      this.syncGlobalToView()

      wx.hideLoading()
      wx.showToast({
        title: baby.alreadyMember ? '已是家庭成员' : `已加入 ${baby.name || '宝宝'}`,
        icon: 'success'
      })
      setTimeout(() => this.hideBabyPanel(), 600)
    } catch (err) {
      console.error('加入宝宝失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '加入失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    }
  },

  cancelForm() {
    this.setData({
      formMode: '',
      formAvatar: '',
      formName: '',
      formBirthDate: '',
      formGender: '',
      joinBabyId: '',
      joinBabyCode: ''
    })
  },

  // ===== 登出 =====
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将清除本地数据，下次需重新登录。确定继续吗？',
      confirmText: '退出',
      confirmColor: '#E8554E',
      success: (res) => {
        if (res.confirm) {
          app.logout()
        }
      }
    })
  },

  /**
   * 通用记录动作（喂奶 / 尿布）
   */
  async recordAction(type, pressKey, successKey) {
    wx.vibrateShort({ type: 'light' })
    this.setData({ [pressKey]: true })
    setTimeout(() => this.setData({ [pressKey]: false }), 300)

    const timestamp = Date.now()
    const babyId = app.globalData.babyId || 'default'
    const record = {
      babyId,
      recordType: type,
      timestamp,
      userId: app.globalData.openid || '',
      duration: 0,
      createdAt: new Date().toISOString()
    }

    storage.updateLastRecord(type, timestamp)
    storage.appendTodayRecord({ ...record, _id: `local_${timestamp}` })
    app.eventBus.emit('recordsUpdated')
    this.updateCardTexts()

    this.setData({ [successKey]: true })
    setTimeout(() => this.setData({ [successKey]: false }), 1000)

    if (app.globalData.cloudReady && app.globalData.isOnline) {
      try { await call('addRecord', record) } catch (err) { app.enqueuePendingSync(record) }
    } else {
      app.enqueuePendingSync(record)
    }
  },

  onShareAppMessage() {
    return {
      title: '秒记宝宝 - 极简育儿记录',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return { title: '我用秒记宝宝轻松记录宝宝作息' }
  }
})
