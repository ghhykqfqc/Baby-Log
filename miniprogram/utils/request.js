// utils/request.js - 统一云函数调用封装（带云环境容错）

/**
 * 封装 wx.cloud.callFunction 为 Promise
 * 当云环境未就绪或调用失败时，reject 但不崩溃
 */
const call = (name, data = {}, enableRetry = true) => {
  return new Promise((resolve, reject) => {
    const app = getApp()

    // 云开发未就绪，直接 reject（调用方应处理）
    if (!app || !app.globalData.cloudReady) {
      reject({ code: -501000, message: '云环境未就绪' })
      return
    }

    if (!wx.cloud) {
      reject({ code: -1, message: 'wx.cloud 不可用' })
      return
    }

    const execute = (retryCount = 0) => {
      wx.cloud.callFunction({
        name,
        data,
        success(res) {
          if (res.result && res.result.code === 0) {
            resolve(res.result.data)
          } else {
            reject(res.result || { code: -1, message: '云函数返回异常' })
          }
        },
        fail(err) {
          // 云环境失效错误，标记为不可用
          const errMsg = String(err.errMsg || '')
          if (errMsg.includes('Env Not Exists') || errMsg.includes('-501000')) {
            app.globalData.cloudReady = false
            reject({ code: -501000, message: '云环境不存在', detail: err })
            return
          }
          if (enableRetry && retryCount < 2 && !errMsg.includes('Env Not Exists')) {
            setTimeout(() => execute(retryCount + 1), 1000 * (retryCount + 1))
          } else {
            reject({ code: -1, message: '网络异常', detail: err })
          }
        }
      })
    }
    execute()
  })
}

const batch = async (tasks) => {
  return Promise.all(tasks.map(fn => fn().catch(err => ({ __error: err }))))
}

module.exports = { call, batch }
