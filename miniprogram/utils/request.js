// utils/request.js - 统一云函数调用封装（带云环境容错）

// ============================================================
// 游客数据隔离：以下「数据读取」类云函数，游客（未登录）一律不调用。
// 数据库中的 records / growth_data / schedules / baby 档案 均属于
// 已登录账号的云端宝宝数据，游客不得触达（问题 2 修复核心）。
// 游客仍可调用：写入/创建类（addRecord 等，走 openid 归属 + 登录后合并）、
// 工具类（getWeather/getOpenId 等）。
// ============================================================
const GUEST_READ_BLOCKLIST = new Set([
  'getRecords',
  'getGrowthData',
  'getDailySummary',
  'getSchedules',
  'getPrediction',
  'listBabies',
  'getBabyInfo'
])

// ============================================================
// 游客「写入」拦截：游客模式下一律不得向云端写入业务数据。
// 游客产生的记录/成长/日程统一先落本机（local_ 前缀），
// 登录后由 mergeGuestDataAfterLogin 批量合并上云。
// （防护：growth 页等入口已显式短路游客，这里做纵深兜底，
//   防止未来新入口漏判；登录后 openid 存在，不受影响。）
// ============================================================
const GUEST_WRITE_BLOCKLIST = new Set([
  'addGrowthData',
  'updateGrowthData',
  'deleteGrowthData',
  'addRecord',
  'updateRecord',
  'deleteRecord',
  'addSchedule',
  'updateSchedule',
  'deleteSchedule',
  'createBaby',
  'joinBaby',
  'saveBabyInfo'
])

/**
 * 判断是否为「云环境不存在」类错误（重试无意义，直接降级）
 */
function isEnvError(err) {
  const errMsg = String((err && (err.errMsg || err.message)) || '')
  const errCode = String((err && (err.errCode || err.code)) || '')
  return errMsg.includes('Env Not Exists') || errMsg.includes('-501000') || errCode.includes('-501000')
}

/**
 * 判断是否为「集合不存在 / 云函数执行失败」类错误。
 * 这类错误重试大概率仍是同样结果（如云端未建集合），
 * 应快速失败并回退本地缓存，避免无谓重试与误报「网络异常」。
 */
function isNoRetryError(err) {
  const errMsg = String((err && (err.errMsg || err.message)) || '')
  return errMsg.includes('-502005') ||
    errMsg.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    errMsg.includes('collection not exists') ||
    errMsg.includes('-504002') ||
    errMsg.includes('functions execute fail')
}

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

    // 游客数据隔离：游客不得读取云端宝宝数据（本地空态/留白）
    if (GUEST_READ_BLOCKLIST.has(name) && !app.isLoggedIn()) {
      reject({ code: -403, message: '游客模式暂不读取云端数据', guestBlocked: true })
      return
    }

    // 游客数据隔离：游客不得向云端写入业务数据（统一先本地暂存，登录后合并）
    if (GUEST_WRITE_BLOCKLIST.has(name) && !app.isLoggedIn()) {
      reject({ code: -403, message: '游客模式暂不写入云端，已保存到本机', guestBlocked: true })
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
          if (isEnvError(err)) {
            app.globalData.cloudReady = false
            reject({ code: -501000, message: '云环境不存在', detail: err })
            return
          }

          // 集合不存在/云函数执行失败：不重试，快速失败让页面回退本地缓存
          if (isNoRetryError(err)) {
            reject({ code: -1, message: '云端数据暂不可用，已为您展示本地记录', cloudBusy: true, detail: err })
            return
          }

          // 网络类错误：按需重试
          if (enableRetry && retryCount < 2) {
            setTimeout(() => execute(retryCount + 1), 1000 * (retryCount + 1))
          } else {
            reject({ code: -1, message: '网络异常，已为您展示本地记录', networkError: true, detail: err })
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