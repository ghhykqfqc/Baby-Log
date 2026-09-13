// pages/profile/profile.js - 宝宝资料（官方 chooseAvatar + 异步安全审核）
const app = getApp()
const storage = require('../../utils/storage')
const auth = require('../../utils/auth')
const { auditAvatar } = require('../../utils/avatar')

Page({
  data: {
    babyId: '',          // 当前编辑宝宝的 ID（编辑模式时有值，新建时为空）
    babyCode: '',        // 宝宝密码（编辑时可改）
    babyName: '',
    avatarUrl: '',        // 已确认的头像（cloud fileID 或空=默认 emoji）
    originalAvatar: '',   // 进入页面时的原头像（审核拒后恢复用）
    birthDate: '',
    gender: '',
    submitting: false,
    avatarAuditing: false,   // 是否正在安全审核新头像
    avatarAuditFailed: false // 上次审核是否被拒（展示提示用）
  },

  onLoad(options) {
    // 「先体验、后授权」：游客也可进入编辑页（保存时引导登录）
    const targetBabyId = options.babyId || app.globalData.babyId || ''

    const babies = app.globalData.babies || []
    const matched = targetBabyId ? babies.find(b => b.babyId === targetBabyId) : null
    const babyInfo = app.isLoggedIn()
      ? (matched || app.globalData.babyInfo || storage.get(storage.CACHE_KEYS.BABY_INFO) || {})
      : (matched || {})

    this.setData({
      babyId: targetBabyId,
      babyCode: babyInfo.babyCode || '',
      babyName: babyInfo.name || '',
      avatarUrl: babyInfo.avatar || '',
      originalAvatar: babyInfo.avatar || '',
      birthDate: babyInfo.birthDate || '',
      gender: babyInfo.gender || ''
    })

    wx.setNavigationBarTitle({ title: targetBabyId ? '编辑宝宝' : '新建宝宝' })
  },

  noop() {},

  /**
   * 官方 chooseAvatar 组件回调（2.24.4+ 自带微信内容安全检测）
   * 在此之上做「上传云存储 → mediaCheckAsync 异步审核 → 通过后才确认头像」
   */
  async onChooseAvatar(e) {
    const { avatarUrl: tempPath } = e.detail || {}
    if (!tempPath) return
    // 进入审核中：显示灰色占位 + 「审核中…」标签
    this.setData({ avatarAuditing: true, avatarAuditFailed: false, avatarUrl: '' })
    try {
      const result = await auditAvatar(tempPath)
      if (!result.passed) {
        // 审核拒绝：保留原头像（或默认），提示换一张
        this.setData({
          avatarAuditing: false,
          avatarAuditFailed: true,
          avatarUrl: this.data.originalAvatar
        })
        wx.showToast({ title: '头像未通过安全检测，请换一张', icon: 'none' })
        return
      }
      // 通过 / 接口异常降级放行：确认新头像（cloud fileID）
      this.setData({
        avatarAuditing: false,
        avatarAuditFailed: false,
        avatarUrl: result.fileID
      })
      wx.showToast({ title: '已选择新头像', icon: 'success' })
    } catch (err) {
      console.warn('头像审核异常，保持原头像:', err)
      this.setData({
        avatarAuditing: false,
        avatarUrl: this.data.originalAvatar
      })
      wx.showToast({ title: '头像处理失败，请重试', icon: 'none' })
    }
  },

  onNameInput(e) {
    this.setData({ babyName: e.detail.value })
  },

  onBirthChange(e) {
    this.setData({ birthDate: e.detail.value })
  },

  onGenderTap(e) {
    const tapped = e.currentTarget.dataset.gender
    this.setData({ gender: this.data.gender === tapped ? '' : tapped })
  },

  onCodeInput(e) {
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
   * 保存：新建宝宝（无 babyId）或更新已有宝宝（有 babyId）
   * 保存前对昵称做服务端文本安检（textCheck）
   */
  async save() {
    // 保存宝宝资料（新建/编辑）是持久化关键操作：游客先引导登录
    if (!app.isLoggedIn()) {
      auth.ensureLogin(this, {
        onSuccess: () => this.doSave(),
        onGuestClose: () => this.doSave()
      })
      return
    }
    this.doSave()
  },

  async doSave() {
    const { babyId, babyCode, babyName, avatarUrl, birthDate, gender } = this.data
    const trimmed = (babyName || '').trim()
    if (!trimmed) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (babyId && babyCode && String(babyCode).length !== 6) {
      wx.showToast({ title: '宝宝密码需 6 位数字', icon: 'none' })
      return
    }
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '云环境不可用', icon: 'none' })
      return
    }

    // 昵称文本安检（服务端 msgSecCheck）
    if (app.globalData.cloudReady) {
      try {
        const { call } = require('../../utils/request')
        const check = await call('textCheck', { content: trimmed, scene: 1 })
        if (check && check.pass === false) {
          wx.showToast({ title: '换个可爱的名字吧～', icon: 'none' })
          return
        }
      } catch (e) {
        console.warn('昵称安检异常，放行:', e)
      }
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中...', mask: true })

    // 头像已是审核通过的 cloud fileID（onChooseAvatar 阶段完成上传+审核），直接使用
    const finalAvatar = avatarUrl || ''

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
        await app.refreshBabies()
        app.setCurrentBaby(newBaby)

        wx.hideLoading()
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
        const saveRes = await call('saveBabyInfo', {
          babyId,
          name: trimmed,
          avatar: finalAvatar,
          birthDate,
          gender,
          babyCode: babyCode || undefined
        })
        let realBabyId = babyId
        if (saveRes && saveRes.babyId && saveRes.babyId !== babyId) {
          realBabyId = saveRes.babyId
          this.setData({ babyId: realBabyId })
          if (app.globalData.babyId === babyId) {
            app.globalData.babyId = realBabyId
            try { wx.setStorageSync('babyId', realBabyId) } catch (e) {}
          }
          const oldBabies = app.globalData.babies || []
          const replaced = oldBabies.map(b => b.babyId === babyId ? { ...b, babyId: realBabyId } : b)
          app.globalData.babies = replaced
          try { wx.setStorageSync('babies', replaced) } catch (e) {}
        }
        const babies = await app.refreshBabies()
        if (app.globalData.babyId === realBabyId) {
          const updated = babies.find(b => b.babyId === realBabyId) || {
            babyId: realBabyId, name: trimmed, avatar: finalAvatar, birthDate, gender, babyCode
          }
          app.setCurrentBaby(updated)
        }
        wx.hideLoading()
        wx.showToast({ title: '已保存', icon: 'success' })
      }

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