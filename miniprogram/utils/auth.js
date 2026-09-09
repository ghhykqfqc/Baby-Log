// utils/auth.js - 登录引导与游客数据合并
// ============================================================
// 「先体验、后授权」的核心控制层：
// 1. 游客（未授权）可以自由浏览、试用全部页面与核心功能（整体开放）
// 2. 关键操作（记录/创建宝宝/生成分享卡等）触发「登录引导面板」
// 3. 登录成功后，把游客期间产生的本地数据（记录/成长/相册/宝宝资料）
//    合并同步到云端 —— openid 从游客到登录保持不变，天然归属同一用户
// ============================================================
const app = getApp()

/** 等待登录完成的回调队列（面板登录成功时统一执行，含 onGuest 关闭回调） */
let _pendingCallbacks = []

/**
 * 当前是否已「授权登录」（有 userInfo 即视为已授权）
 */
function isLoggedIn() {
  return !!app.isLoggedIn()
}

/**
 * 登录成功总入口：登录面板保存 userInfo 后调用。
 * 执行顺序（2026-09-09 优化）：
 *   1. 先执行所有等待回调 → 页面立即刷新登录态（头像/昵称/模式切换）
 *   2. 再在后台合并游客本地数据到云端（幂等，不阻塞 UI，失败可重试）
 */
async function notifyLoginSuccess(user) {
  // 1) 通知所有等待的调用方（先刷新 UI，保证登录反馈即时）
  const cbs = _pendingCallbacks.splice(0)
  _pendingCallbacks = []
  cbs.forEach((cb) => {
    try {
      if (typeof cb === 'function') cb(user)
    } catch (err) {
      console.warn('登录成功回调执行失败:', err)
    }
  })

  // 2) 后台合并游客数据（不阻塞登录反馈）
  if (app.globalData.cloudReady) {
    setTimeout(async () => {
      try {
        if (app.mergeGuestDataAfterLogin) {
          await app.mergeGuestDataAfterLogin()
        }
      } catch (err) {
        console.warn('游客数据合并失败（不影响登录）:', err)
      }
    }, 0)
  }
}

/**
 * 触发登录引导（关键操作拦截入口）
 * @param {Object} page 页面实例（wxml 中须挂载 <login-panel id="loginPanel">）
 * @param {Object} [options]
 *   onSuccess(userInfo): 登录成功并完成数据合并后的回调
 *   onGuestClose(): 用户选择「暂不登录」时执行（用于关闭弹层/继续浏览）
 * 返回 boolean：true=已登录或已在引导中；false=页面未挂载登录面板（放行，避免卡死）
 */
function ensureLogin(page, options = {}) {
  if (app.isLoggedIn() && app.globalData.userInfo && app.globalData.userInfo.openid) {
    if (options.onSuccess) options.onSuccess(app.globalData.userInfo)
    return true
  }

  const panel = page && page.selectComponent && page.selectComponent('#loginPanel')

  // 兜底：面板缺失时放行（游客模式不阻断体验），用 toast 轻提醒
  if (!panel || typeof panel.openLogin !== 'function') {
    console.warn('[auth] 当前页面未挂载登录面板，本次操作放行')
    return false
  }

  // 记录成功后回调（面板登录成功 → notifyLoginSuccess → 执行）
  if (options.onSuccess) {
    _pendingCallbacks.push(options.onSuccess)
  }

  // 打开登录面板（半屏弹层）
  panel.openLogin({ onGuestClose: options.onGuestClose || null })
  return true
}

/**
 * 移除单个 pending 回调（页面卸载时调用，避免内存泄漏）
 */
function clearPending(fn) {
  _pendingCallbacks = _pendingCallbacks.filter((cb) => cb !== fn)
}

module.exports = {
  isLoggedIn,
  ensureLogin,
  notifyLoginSuccess,
  clearPending
}