// cloudfunctions/getPrediction/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// ====== 集合自愈 + 容错工具：集合不存在时自动创建，避免 -502005 报错 ======
const _ensured = {}

function isCollectionMissing(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  return msg.includes('-502005') || msg.includes('DATABASE_COLLECTION_NOT_EXIST') || msg.includes('collection not exists')
}

async function ensureCollections(names) {
  if (typeof db.createCollection !== 'function') return
  for (const name of names) {
    if (_ensured[name]) continue
    try {
      await db.createCollection(name)
    } catch (e) {
      // 已存在或暂不可用：忽略
    }
    _ensured[name] = true
  }
}

async function safeDb(fn, fallback, collectionNames) {
  try {
    return await fn()
  } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(collectionNames)
      try {
        return await fn()
      } catch (err2) {
        console.error('集合自愈重试后仍失败:', err2)
        return typeof fallback === 'function' ? fallback(err2) : fallback
      }
    }
    console.error('数据库操作失败:', err)
    return typeof fallback === 'function' ? fallback(err) : fallback
  }
}
// ==================================================

/**
 * 基于最近7天数据计算喂奶/睡眠/换尿布的平均间隔
 */
exports.main = async (event, context) => {
  const { babyId = 'default' } = event
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  // 集合缺失时返回「数据不足」结果，前端正常展示
  const FALLBACK = {
    code: 0,
    data: {
      feed: { avgInterval: null, lastTimestamp: 0, text: '数据不足，记录几天后即可预测' },
      diaper: { avgInterval: null, lastTimestamp: 0, text: '数据不足，记录几天后即可预测' },
      sleep: { avgInterval: null, lastTimestamp: 0, text: '数据不足，记录几天后即可预测' }
    }
  }

  return safeDb(async () => {
    // 拉取近7天记录
    const res = await db.collection('records').where({
      babyId,
      timestamp: _.gte(sevenDaysAgo)
    }).orderBy('timestamp', 'asc').limit(1000).get()

    const records = res.data
    const types = ['feed', 'diaper', 'sleep']
    const result = {}

    types.forEach(type => {
      const typeRecords = records.filter(r => r.recordType === type)
        .sort((a, b) => a.timestamp - b.timestamp)

      if (typeRecords.length < 2) {
        result[type] = { avgInterval: null, text: '数据不足，记录几天后即可预测' }
        return
      }

      let totalDiff = 0
      let count = 0
      for (let i = 1; i < typeRecords.length; i++) {
        const diff = (typeRecords[i].timestamp - typeRecords[i - 1].timestamp) / (60 * 1000)
        if (diff > 0 && diff < 480) { // 过滤超8小时的异常间隔
          totalDiff += diff
          count++
        }
      }

      const avgInterval = count === 0 ? null : Math.round(totalDiff / count)
      const lastTs = typeRecords[typeRecords.length - 1].timestamp

      let text = ''
      if (!avgInterval) {
        text = '数据不足'
      } else {
        const elapsed = (Date.now() - lastTs) / (60 * 1000)
        const remaining = avgInterval - elapsed
        if (remaining <= 0) {
          text = '已超过通常间隔，请留意宝宝状态'
        } else if (remaining < 30) {
          text = `预计 ${Math.round(remaining)} 分钟内`
        } else if (remaining < 60) {
          text = '预计约 1 小时内'
        } else {
          text = `预计约 ${Math.round(remaining / 60)} 小时后`
        }
      }

      result[type] = { avgInterval, lastTimestamp: lastTs, text }
    })

    return { code: 0, data: result }
  }, FALLBACK, ['records'])
}