// pages/login/login.js
const app = getApp()

Page({
  data: {
    avatarUrl: '',   // 选中的头像（临时路径）
    nickName: '',    // 昵称
    logging: false
  },

  onLoad() {
    // 预填：如果之前登录过，恢复头像昵称方便快速重登
    const userInfo = app.globalData.userInfo
    if (userInfo) {
      this.setData({
        avatarUrl: userInfo.avatarUrl || '',
        nickName: userInfo.nickName || ''
      })
    }
  },

  /**
   * 微信头像选择回调（button open-type=chooseAvatar）
   */
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (avatarUrl) {
      this.setData({ avatarUrl })
    }
  },

  /**
   * 昵称输入（type=nickname 的 input 在 bindinput 可能不返回真实昵称，
   * 用 bindblur 兜底，事件统一处理）
   */
  onNickInput(e) {
    const nickName = (e.detail.value || '').trim()
    this.setData({ nickName })
  },

  /**
   * 点击登录
   */
  async handleLogin() {
    const { avatarUrl, nickName, logging } = this.data
    if (logging) return
    if (!avatarUrl) {
      wx.showToast({ title: '请先选择头像', icon: 'none' })
      return
    }
    if (!nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    this.setData({ logging: true })

    // 云不可用时给出明确提示
    if (!app.globalData.cloudReady) {
      this.setData({ logging: false })
      wx.showModal({
        title: '云环境未就绪',
        content: '当前云开发环境不可用，请检查网络或稍后再试。',
        showCancel: false
      })
      return
    }

    wx.showLoading({ title: '登录中...', mask: true })

    try {
      // 1. 上传头像到云存储（如果是本地临时路径）
      let finalAvatar = avatarUrl
      const isLocalTemp = avatarUrl.startsWith('http://tmp') ||
                          avatarUrl.startsWith('wxfile://') ||
                          avatarUrl.startsWith('walrus://') ||
                          !avatarUrl.startsWith('cloud://')
      if (isLocalTemp) {
        try {
          const ts = Date.now()
          const openid = app.globalData.openid || 'unknown'
          const upRes = await wx.cloud.uploadFile({
            cloudPath: `user-avatars/${openid}/${ts}.png`,
            filePath: avatarUrl
          })
          if (upRes && upRes.fileID) {
            finalAvatar = upRes.fileID
          }
        } catch (uploadErr) {
          console.warn('头像上传失败，使用本地路径:', uploadErr)
          // 继续登录，使用本地路径
        }
      }

      // 2. 确保有 openid
      let openid = app.globalData.openid
      if (!openid) {
        openid = await app.getOpenId()
      }
      if (!openid) {
        throw new Error('获取 openid 失败')
      }

      // 3. 调云函数 userLogin 持久化用户信息
      const res = await wx.cloud.callFunction({
        name: 'userLogin',
        data: {
          nickName,
          avatarUrl: finalAvatar
        }
      })

      if (!res.result || res.result.code !== 0) {
        throw new Error((res.result && res.result.message) || '登录失败')
      }

      // 4. 保存登录信息
      const userInfo = {
        openid,
        nickName: res.result.data.nickName || nickName,
        avatarUrl: res.result.data.avatarUrl || finalAvatar
      }
      app.saveUserInfo(userInfo)

      // 5. 加载用户的宝宝列表
      const babies = await app.refreshBabies()

      // 6. 如果有宝宝，自动选中第一个；否则先创建一个默认宝宝
      if (babies.length > 0) {
        app.setCurrentBaby(babies[0])
      }

      wx.hideLoading()
      wx.showToast({ title: '登录成功', icon: 'success' })

      // 7. 跳转首页（reLaunch 清空登录页栈）
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' })
      }, 500)
    } catch (err) {
      console.error('登录失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '登录失败',
        content: (err && err.message) || '请稍后重试',
        showCancel: false
      })
    } finally {
      this.setData({ logging: false })
    }
  }
})
