// components/login-panel/login-panel.js - 登录引导面板（半屏弹层）
// 「先体验、后授权」：游客点击关键操作时弹出，提供
//   1. 微信一键登录（button open-type=getPhoneNumber 获取手机号）
//   2. 暂不登录（游客继续浏览）
//
// 2026-09-09 修复：手机号获取失败不再当作「拒绝」而绕过登录，
// 因为 openid 才是身份主键（游客期已静默获取），手机号仅为增强字段。
// 只要用户点击了「微信一键登录」按钮（明确登录意图），无论手机号
// 是否授权成功，都执行静默登录（wx.login + userLogin 建档/更新），
// 保证个人主体小程序（无 getPhoneNumber 能力）也能正常登录。
const app = getApp()
const auth = require('../../utils/auth')

Component({
  data: {
    visible: false,
    logging: false,
    // 协议勾选状态：每次打开面板重置为 false（合规：默认不勾选）
    agreed: false
  },

  methods: {
    noop() {},

    /**
     * 打开登录面板（由页面在关键操作时调用）
     * @param {Object} options { onGuestClose }
     */
    openLogin(options = {}) {
      this._guestClose = options.onGuestClose || null
      // 每次打开重置勾选状态（合规：默认不勾选，用户须主动勾选）
      this.setData({ visible: true, agreed: false })
      this.triggerEvent('change', { visible: true })
    },

    /**
     * 勾选/取消勾选协议
     */
    onToggleAgreement() {
      this.setData({ agreed: !this.data.agreed })
    },

    /**
     * 查看《用户协议》
     */
    viewUserAgreement() {
      wx.navigateTo({ url: '/pages/agreement/agreement?type=user' })
    },

    /**
     * 查看《隐私政策》
     */
    viewPrivacyPolicy() {
      wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' })
    },

    /**
     * 登录前置校验：未勾选协议时拦截并提示（合规要求）
     * @returns {Boolean}
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
            this.setData({ agreed: true })
            wx.showToast({ title: '已为您勾选，可继续登录', icon: 'none', duration: 1500 })
          }
        }
      })
      return false
    },

    onMaskTap() {
      // 点击遮罩：当作「暂不登录」关闭（不强制授权）
      this.onGuest()
    },

    /**
     * 暂不登录：游客继续浏览
     */
    onGuest() {
      this.setData({ visible: false })
      this.triggerEvent('change', { visible: false })
      if (typeof this._guestClose === 'function') this._guestClose()
    },

    /**
     * 微信一键登录（open-type=getPhoneNumber 回调）
     * 只要用户点过这个按钮就代表有登录意图：
     * - 能拿到手机号 code → 云端换取手机号存档
     * - 拿不到手机号（个人主体无此能力/用户拒绝了手机号）→ 同样静默登录，
     *   openid 是身份主键，手机号只是可选增强，绝不因手机号失败而登录失败
     */
    onGetPhoneNumber(e) {
      // 合规：未勾选协议拦截
      if (!this.checkAgreement()) return
      const detail = e.detail || {}
      this.doLogin(detail.code || '')
    },

    /**
     * 执行登录（统一入口）
     * @param {String} phoneCode 手机号授权 code（可为空串=静默登录）
     */
    async doLogin(phoneCode) {
      if (this.data.logging) return
      this.setData({ logging: true })

      try {
        // 1. 确保有 openid（游客期早已静默获取，这里兜底）
        let openid = app.globalData.openid
        if (!openid) {
          openid = await app.getOpenId()
        }
        if (!openid) {
          throw new Error('获取登录凭证失败，请稍后重试')
        }

        // 2. 上报云端 userLogin（手机号 code 由云函数换取；头像昵称选填）
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
          // 云端异常仍走本地登录（openid 已建档），保证流程不断
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

        // 3. 关闭面板
        this.setData({ visible: false, logging: false })
        this.triggerEvent('change', { visible: false })

        // 4. 通知调用方（内部：先回调刷新登录态，再后台合并游客数据）
        await auth.notifyLoginSuccess(userInfo)

        wx.showToast({ title: '登录成功', icon: 'success' })
      } catch (err) {
        console.error('登录失败:', err)
        wx.hideLoading()
        this.setData({ logging: false })
        wx.showToast({ title: (err && err.message) || '登录失败，请重试', icon: 'none' })
      }
    }
  }
})