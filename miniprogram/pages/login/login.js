// pages/login/login.js - 登录/注册页（游客可跳过）
// 「先体验、后授权」：不强制在此登录，一键静默登录（手机号用于身份标识，选填）
const app = getApp()
const auth = require('../../utils/auth')

Page({
  data: {
    logging: false,
    // 协议勾选状态：默认不勾选，未勾选点登录会提示（合规要求）
    agreed: false
  },

  /**
   * 勾选/取消勾选《用户协议》《隐私政策》
   */
  onToggleAgreement() {
    this.setData({ agreed: !this.data.agreed })
  },

  /**
   * 跳转《用户协议》详情页
   */
  viewUserAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=user' })
  },

  /**
   * 跳转《隐私政策》详情页
   */
  viewPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
  },

  /**
   * 登录前置校验：必须勾选协议（合规要求）
   * @returns {Boolean} true=已同意可继续
   */
  checkAgreement() {
    if (this.data.agreed) return true
    wx.showModal({
      title: '请先同意协议',
      content: '为保障您的权益，请先阅读并勾选同意《用户协议》和《隐私政策》后再登录。',
      confirmText: '去勾选',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          // 引导用户聚焦勾选框：自动勾选并提示
          this.setData({ agreed: true })
          wx.showToast({ title: '已为您勾选，可继续登录', icon: 'none', duration: 1500 })
        }
      }
    })
    return false
  },

  /**
   * 微信一键登录（open-type=getPhoneNumber）
   * 说明：手机号仅用于标识身份；头像昵称改为选填；
   * 未拿到手机号（用户拒绝/无基础库支持）也完成登录（openid 静默登录）
   * 2026-09-09：用户点击登录按钮即代表明确登录意图，不再因手机号失败转游客
   * 2026-09-09（合规）：未勾选《用户协议》《隐私政策》时拦截，弹窗提示
   */
  onGetPhoneNumber(e) {
    if (!this.checkAgreement()) return
    const detail = e.detail || {}
    this.doLogin(detail.code || '')
  },

  /**
   * 执行登录（统一入口，phoneCode 可为空=静默登录）
   */
  async doLogin(phoneCode) {
    if (this.data.logging) return
    this.setData({ logging: true })

    try {
      let openid = app.globalData.openid
      if (!openid) {
        openid = await app.getOpenId()
      }
      if (!openid) {
        throw new Error('获取登录凭证失败，请稍后重试')
      }

      wx.showLoading({ title: '登录中...', mask: true })
      const res = await wx.cloud.callFunction({
        name: 'userLogin',
        data: {
          nickName: '',
          avatarUrl: '',
          phoneCode: phoneCode || ''
        }
      })
      wx.hideLoading()

      if (!res.result || res.result.code !== 0) {
        console.warn('userLogin 云端失败，本地登录:', res.result)
      }

      const userInfo = {
        ...(res.result && res.result.data ? res.result.data : {}),
        openid,
        nickName: (res.result && res.result.data && res.result.data.nickName) || '微信用户',
        avatarUrl: (res.result && res.result.data && res.result.data.avatarUrl) || ''
      }
      if (!userInfo.openid) userInfo.openid = openid
      app.saveUserInfo(userInfo)

      // 合并游客数据（先回调刷新，再后台合并）
      await auth.notifyLoginSuccess(userInfo)

      wx.showToast({ title: '登录成功', icon: 'success' })
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
  },

  /**
   * 游客进入：先体验、后授权
   */
  enterAsGuest() {
    wx.reLaunch({ url: '/pages/index/index' })
  }
})