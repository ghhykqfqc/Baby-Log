// utils/avatar.js - 宝宝头像安全审核统一封装
//
// 背景：首页/个人中心使用官方 <button open-type="chooseAvatar"> 组件，
//       该组件自基础库 2.24.4 起已接入微信内容安全（未通过不触发回调）。
//       这里在官方组件之上，再做一次「异步审核」增强（对审核员可见遮罩）：
//   1. 用户选图 → 先上传云存储 avatars/pending/xxx.jpg（不立即展示为正式头像）
//   2. 调 avatarCheck(submit) → mediaCheckAsync 异步审核 → traceId
//   3. 轮询 avatarCheck(query)（800ms × 最多8次 ≈ 6.4s）：
//        - pass  → 返回 fileID，页面才更新头像
//        - fail  → 返回 null，页面保留默认头像 + 提示
//        - 超时/接口异常 → 返回 fileID（降级：官方组件已过安检，允许使用）
//   页面不再自己调 chooseMedia/chooseImage（避免媒体接口放大审核风险面）。
const { call } = require('./request')

const MAX_POLL = 8
const POLL_INTERVAL = 800

/**
 * 把用户选择的临时头像路径上传并异步审核
 * @param {string} tempPath chooseAvatar 回调返回的临时路径
 * @param {object} [opts] { maxPoll, interval }
 * @returns {Promise<{ fileID: string, passed: boolean, degraded: boolean }>}
 *   - passed=true：审核通过或降级（fileID 可用）
 *   - passed=false：审核未通过（不可用）
 */
async function auditAvatar(tempPath, opts = {}) {
  const maxPoll = opts.maxPoll || MAX_POLL
  const interval = opts.interval || POLL_INTERVAL

  if (!tempPath) return { fileID: '', passed: false }

  // 0. 上传云存储（唯一需要上传的时机，均带内容安全兜底）
  let fileID = ''
  try {
    const up = await wx.cloud.uploadFile({
      cloudPath: `avatars/pending/${Date.now()}_${Math.floor(Math.random() * 10000)}.png`,
      filePath: tempPath
    })
    fileID = (up && up.fileID) || ''
  } catch (err) {
    console.warn('头像上传失败:', err)
    return { fileID: '', passed: false }
  }
  if (!fileID) return { fileID: '', passed: false }

  // 2. 提交异步审核（avatarCheck 云函数内部调 mediaCheckAsync）
  let traceId = ''
  try {
    const submitRes = await call('avatarCheck', { type: 'submit', fileID })
    traceId = (submitRes && submitRes.traceId) || ''
  } catch (err) {
    console.warn('头像审核提交失败（降级放行）:', err)
    return { fileID, passed: true, audited: false }
  }

  // 3. 轮询审核结果
  if (traceId) {
    for (let i = 0; i < maxPoll; i++) {
      await new Promise(r => setTimeout(r, interval))
      try {
        const q = await call('avatarCheck', { type: 'query', traceId })
        const status = (q && q.status) || 'pending'
        if (status === 'pass') return { fileID, passed: true, audited: true }
        if (status === 'fail' || status === 'block') return { fileID, passed: false, audited: true }
        // pending 继续轮询
      } catch (err) {
        console.warn('头像审核轮询异常:', err)
        break
      }
    }
  }

  // 超时：官方 chooseAvatar 已安检，降级放行
  return { fileID, passed: true, audited: false }
}

module.exports = { auditAvatar }