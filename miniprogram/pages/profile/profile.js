// pages/profile/profile.js - 宝宝资料（自定义头像 + 昵称，含裁剪）
const app = getApp()
const storage = require('../../utils/storage')

Page({
  data: {
    babyName: '',
    avatarUrl: '',        // 已确认的头像（本地临时路径或 cloud fileID）
    originalAvatar: '',   // 进入页面时的原头像（取消时恢复用）
    submitting: false,

    // 裁剪相关
    cropperVisible: false,
    rawImagePath: '',     // 选图后原始路径
    cropperSize: 300,     // 裁剪舞台尺寸（px，在 onLoad 计算）
    imgW: 0, imgH: 0,     // 图片显示尺寸
    imgX: 0, imgY: 0,     // 图片在舞台中的位置（左上角）
    cropSize: 240,        // 裁剪框尺寸
    cropLeft: 0, cropTop: 0,
    // 触摸状态
    touchStartX: 0, touchStartY: 0,
    touchStartImgX: 0, touchStartImgY: 0,
    startDistance: 0,
    startImgW: 0, startImgH: 0
  },

  onLoad(options) {
    // 登录态校验
    if (!app.requireLogin()) return

    // 计算裁剪舞台尺寸（屏幕宽度 * 0.8，不超过 360）
    try {
      const sys = wx.getSystemInfoSync()
      const size = Math.min(360, Math.floor(sys.windowWidth * 0.85))
      this.setData({
        cropperSize: size,
        cropSize: Math.floor(size * 0.8),
        cropLeft: Math.floor((size - size * 0.8) / 2),
        cropTop: Math.floor((size - size * 0.8) / 2)
      })
    } catch (e) {}

    // 优先用 URL 参数指定的 babyId；否则用当前宝宝
    // 当从首页"编辑某宝宝"按钮跳转过来时，会带 babyId
    this._targetBabyId = options.babyId || app.globalData.babyId || ''

    // 读取目标宝宝资料：优先匹配 babies 列表中的对应项
    const babies = app.globalData.babies || []
    const matched = this._targetBabyId ? babies.find(b => b.babyId === this._targetBabyId) : null
    const babyInfo = matched || storage.get(storage.CACHE_KEYS.BABY_INFO) || {}
    this.setData({
      babyName: babyInfo.name || '',
      avatarUrl: babyInfo.avatar || '',
      originalAvatar: babyInfo.avatar || ''
    })
  },

  noop() {},

  onNameInput(e) {
    this.setData({ babyName: e.detail.value })
  },

  /**
   * 选图（从相册）
   */
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original', 'compressed'],
      success: (res) => {
        const tempFile = res.tempFiles && res.tempFiles[0]
        if (!tempFile) return
        this.openCropper(tempFile.tempFilePath)
      },
      fail: () => {}
    })
  },

  /**
   * 打开裁剪视图
   */
  openCropper(path) {
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const stage = this.data.cropperSize
        // 图片完整显示在舞台内：宽高都不超过舞台，等比缩放
        let w = info.width, h = info.height
        if (w > stage || h > stage) {
          const ratio = Math.min(stage / w, stage / h)
          w = Math.floor(w * ratio)
          h = Math.floor(h * ratio)
        }
        const x = Math.floor((stage - w) / 2)
        const y = Math.floor((stage - h) / 2)
        this.setData({
          cropperVisible: true,
          rawImagePath: path,
          imgW: w, imgH: h, imgX: x, imgY: y
        })
      },
      fail: () => {
        // 取不到图片信息时直接用原图
        this.setData({
          cropperVisible: true,
          rawImagePath: path,
          imgW: 200, imgH: 200, imgX: 50, imgY: 50
        })
      }
    })
  },

  // ===== 裁剪触摸处理 =====
  onCropTouchStart(e) {
    if (e.touches.length === 1) {
      this.setData({
        touchStartX: e.touches[0].clientX,
        touchStartY: e.touches[0].clientY,
        touchStartImgX: this.data.imgX,
        touchStartImgY: this.data.imgY
      })
    } else if (e.touches.length === 2) {
      const d = this.getDistance(e.touches[0], e.touches[1])
      this.setData({
        startDistance: d,
        startImgW: this.data.imgW,
        startImgH: this.data.imgH
      })
    }
  },

  onCropTouchMove(e) {
    if (e.touches.length === 1) {
      // 单指拖动
      const dx = e.touches[0].clientX - this.data.touchStartX
      const dy = e.touches[0].clientY - this.data.touchStartY
      this.setData({
        imgX: this.data.touchStartImgX + dx,
        imgY: this.data.touchStartImgY + dy
      })
    } else if (e.touches.length === 2 && this.data.startDistance > 0) {
      // 双指缩放
      const d = this.getDistance(e.touches[0], e.touches[1])
      const scale = d / this.data.startDistance
      const newW = Math.max(50, Math.floor(this.data.startImgW * scale))
      const newH = Math.max(50, Math.floor(this.data.startImgH * scale))
      // 以图片中心为锚点缩放
      const centerX = this.data.imgX + this.data.imgW / 2
      const centerY = this.data.imgY + this.data.imgH / 2
      this.setData({
        imgW: newW, imgH: newH,
        imgX: Math.floor(centerX - newW / 2),
        imgY: Math.floor(centerY - newH / 2)
      })
    }
  },

  onCropTouchEnd() {
    this.setData({ startDistance: 0 })
  },

  getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  },

  /**
   * 取消裁剪
   */
  cancelCrop() {
    this.setData({ cropperVisible: false, rawImagePath: '' })
  },

  /**
   * 确认裁剪 —— 用页面内隐藏 canvas 截取并导出
   */
  confirmCrop() {
    this.cropWithCanvas()
  },

  /**
   * 使用页面内隐藏 canvas 把原始图片按裁剪框比例绘制并导出
   */
  cropWithCanvas() {
    const { rawImagePath, imgW, imgH, imgX, imgY, cropSize, cropLeft, cropTop } = this.data

    const query = wx.createSelectorQuery()
    query.select('#cropCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          // 降级：直接用原图
          this.setData({ avatarUrl: rawImagePath, cropperVisible: false })
          return
        }

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const outputSize = 256
        canvas.width = outputSize
        canvas.height = outputSize

        const img = canvas.createImage()
        img.onload = () => {
          // 把裁剪框映射回原图坐标
          const ratioX = img.width / imgW
          const ratioY = img.height / imgH
          const cropOffsetX = cropLeft - imgX
          const cropOffsetY = cropTop - imgY
          const sx = cropOffsetX * ratioX
          const sy = cropOffsetY * ratioY
          const sw = cropSize * ratioX
          const sh = cropSize * ratioY

          ctx.clearRect(0, 0, outputSize, outputSize)
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputSize, outputSize)

          wx.canvasToTempFilePath({
            canvas,
            x: 0, y: 0,
            width: outputSize,
            height: outputSize,
            destWidth: outputSize,
            destHeight: outputSize,
            fileType: 'png',
            quality: 1,
            success: (r) => {
              this.setData({ avatarUrl: r.tempFilePath, cropperVisible: false })
            },
            fail: () => {
              // 降级：直接用原图
              this.setData({ avatarUrl: rawImagePath, cropperVisible: false })
            }
          })
        }
        img.onerror = () => {
          this.setData({ avatarUrl: rawImagePath, cropperVisible: false })
        }
        img.src = rawImagePath
      })
  },

  /**
   * 保存：上传头像（如有）+ 更新本地缓存 + 云端同步
   */
  async save() {
    const { babyName, avatarUrl, originalAvatar } = this.data
    const trimmed = (babyName || '').trim()
    if (!trimmed) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    let finalAvatar = avatarUrl
    try {
      // 如果头像是新的本地临时文件（非 cloud fileID、非 http URL、与原头像不同），上传到云存储
      const isLocalTemp = avatarUrl && avatarUrl.startsWith('http://tmp') || (avatarUrl && avatarUrl.startsWith('wxfile://')) || (avatarUrl && avatarUrl !== originalAvatar && !avatarUrl.startsWith('cloud://'))
      if (isLocalTemp && app.globalData.cloudReady) {
        const targetId = this._targetBabyId || app.globalData.babyId || 'default'
        const cloudPath = `avatars/${targetId}/${Date.now()}.png`
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath: avatarUrl
        })
        if (uploadRes && uploadRes.fileID) {
          finalAvatar = uploadRes.fileID
        }
      }
    } catch (err) {
      console.warn('头像上传失败，使用本地路径:', err)
      // 上传失败仍保存本地路径，离线可用
    }

    const targetBabyId = this._targetBabyId || app.globalData.babyId || 'default'

    // 更新本地缓存（仅当编辑的是当前宝宝时才更新全局缓存）
    const babyInfo = storage.get(storage.CACHE_KEYS.BABY_INFO) || {}
    const updated = { ...babyInfo, name: trimmed, avatar: finalAvatar }
    storage.set(storage.CACHE_KEYS.BABY_INFO, updated)
    app.globalData.babyInfo = updated

    // 同步到云端（best-effort）
    if (app.globalData.cloudReady) {
      try {
        const { call } = require('../../utils/request')
        await call('saveBabyInfo', {
          babyId: targetBabyId,
          name: trimmed,
          avatar: finalAvatar,
          birthDate: babyInfo.birthDate || '',
          gender: babyInfo.gender || ''
        })
        // 刷新 babies 列表（编辑非当前宝宝时也保持列表最新）
        app.refreshBabies().catch(() => {})
      } catch (err) {
        console.warn('云端保存宝宝资料失败（本地已保存）:', err && err.message)
      }
    }

    this.setData({ submitting: false })
    wx.showToast({ title: '已保存', icon: 'success' })

    // 通知首页刷新
    app.eventBus.emit('recordsUpdated')

    setTimeout(() => {
      wx.navigateBack({ delta: 1 })
    }, 600)
  }
})