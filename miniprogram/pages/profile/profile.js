// pages/profile/profile.js - 宝宝资料（自定义头像 + 昵称，含裁剪）
const app = getApp()
const storage = require('../../utils/storage')

Page({
  data: {
    babyId: '',          // 当前编辑宝宝的 ID（编辑模式时有值，新建时为空）
    babyCode: '',        // 宝宝密码（编辑时可改）
    babyName: '',
    avatarUrl: '',        // 已确认的头像（本地临时路径或 cloud fileID）
    originalAvatar: '',   // 进入页面时的原头像（取消时恢复用）
    birthDate: '',
    gender: '',
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
    const targetBabyId = options.babyId || app.globalData.babyId || ''

    // 从 babies 列表中查找对应宝宝的完整资料
    const babies = app.globalData.babies || []
    const matched = targetBabyId ? babies.find(b => b.babyId === targetBabyId) : null
    const babyInfo = matched || app.globalData.babyInfo || storage.get(storage.CACHE_KEYS.BABY_INFO) || {}

    this.setData({
      babyId: targetBabyId,
      babyCode: babyInfo.babyCode || '',
      babyName: babyInfo.name || '',
      avatarUrl: babyInfo.avatar || '',
      originalAvatar: babyInfo.avatar || '',
      birthDate: babyInfo.birthDate || '',
      gender: babyInfo.gender || ''
    })

    // 设置导航栏标题
    wx.setNavigationBarTitle({ title: targetBabyId ? '编辑宝宝' : '新建宝宝' })
  },

  noop() {},

  onNameInput(e) {
    this.setData({ babyName: e.detail.value })
  },

  onBirthChange(e) {
    this.setData({ birthDate: e.detail.value })
  },

  onGenderTap(e) {
    const tapped = e.currentTarget.dataset.gender
    // 再次点击相同性别则取消选择
    this.setData({ gender: this.data.gender === tapped ? '' : tapped })
  },

  onCodeInput(e) {
    // 仅保留数字，最多 6 位
    const code = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    this.setData({ babyCode: code })
  },

  copyBabyId() {
    if (!this.data.babyId) return
    wx.setClipboardData({
      data: this.data.babyId,
      success: () => wx.showToast({ title: '已复制 ID', icon: 'success' })
    })
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
   * 保存：新建宝宝（无 babyId）或更新已有宝宝（有 babyId）
   * - 无 babyId：调 createBaby 云函数生成 babyId + babyCode，并把当前用户设为 parent
   * - 有 babyId：调 saveBabyInfo 更新资料，若 babyCode 变更则同步更新密码
   */
  async save() {
    const { babyId, babyCode, babyName, avatarUrl, originalAvatar, birthDate, gender } = this.data
    const trimmed = (babyName || '').trim()
    if (!trimmed) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    // 编辑模式下密码必须是 6 位
    if (babyId && babyCode && String(babyCode).length !== 6) {
      wx.showToast({ title: '宝宝密码需 6 位数字', icon: 'none' })
      return
    }
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '云环境不可用', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中...', mask: true })

    // 1. 上传头像（若是本地临时文件）
    let finalAvatar = avatarUrl
    try {
      const isLocalTemp = avatarUrl && (
        avatarUrl.startsWith('http://tmp') ||
        avatarUrl.startsWith('wxfile://') ||
        avatarUrl.startsWith('walrus://') ||
        !avatarUrl.startsWith('cloud://')
      )
      const isChanged = avatarUrl !== originalAvatar
      if (isLocalTemp && isChanged) {
        const ts = Date.now()
        const tmpId = babyId || 'new'
        const upRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${tmpId}/${ts}.png`,
          filePath: avatarUrl
        })
        if (upRes && upRes.fileID) finalAvatar = upRes.fileID
      }
    } catch (err) {
      console.warn('头像上传失败，使用本地路径:', err)
    }

    try {
      if (!babyId) {
        // ===== 场景 A：新建宝宝 =====
        const res = await wx.cloud.callFunction({
          name: 'createBaby',
          data: {
            name: trimmed,
            avatar: finalAvatar,
            birthDate,
            gender
          }
        })
        if (!res.result || res.result.code !== 0) {
          throw new Error((res.result && res.result.message) || '创建失败')
        }
        const newBaby = res.result.data
        // 刷新宝宝列表 + 设为当前宝宝
        await app.refreshBabies()
        app.setCurrentBaby(newBaby)

        wx.hideLoading()
        // 展示创建成功 + ID/密码（用户可复制分享给家人）
        wx.showModal({
          title: '🎉 宝宝已创建',
          content: `宝宝 ID：${newBaby.babyId}\n加入密码：${newBaby.babyCode}\n\n请把 ID 和密码分享给家人，他们就能一起记录啦！`,
          confirmText: '复制',
          showCancel: false,
          success: (r) => {
            if (r.confirm) {
              wx.setClipboardData({
                data: `宝宝 ID：${newBaby.babyId}\n加入密码：${newBaby.babyCode}`
              })
            }
          }
        })
      } else {
        // ===== 场景 B：更新已有宝宝 =====
        const { call } = require('../../utils/request')
        await call('saveBabyInfo', {
          babyId,
          name: trimmed,
          avatar: finalAvatar,
          birthDate,
          gender,
          babyCode: babyCode || undefined  // 仅显式传入才更新密码
        })
        // 刷新 babies 列表
        const babies = await app.refreshBabies()
        // 若编辑的是当前宝宝，同步更新 globalData.babyInfo
        if (app.globalData.babyId === babyId) {
          const updated = babies.find(b => b.babyId === babyId) || {
            babyId, name: trimmed, avatar: finalAvatar, birthDate, gender, babyCode
          }
          app.setCurrentBaby(updated)
        }
        wx.hideLoading()
        wx.showToast({ title: '已保存', icon: 'success' })
      }

      // 通知其他页面刷新
      app.eventBus.emit('recordsUpdated')

      setTimeout(() => {
        wx.navigateBack({ delta: 1 })
      }, 800)
    } catch (err) {
      console.error('保存宝宝资料失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: babyId ? '保存失败' : '创建失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})