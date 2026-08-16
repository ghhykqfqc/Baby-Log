// utils/request.js - 统一云函数调用封装

/**
 * 封装 wx.cloud.callFunction 为 Promise
 * @param {string} name - 云函数名
 * @param {object} data - 参数
 * @param {boolean} enableRetry - 是否启用失败重试
 */
const call = (name, data = {}, enableRetry = true) => {
  return new Promise((resolve, reject) => {
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
          if (enableRetry && retryCount < 2) {
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

/**
 * 批量并行调用
 */
const batch = async (tasks) => {
  return Promise.all(tasks.map(fn => fn().catch(err => ({ __error: err }))))
}

module.exports = { call, batch }
