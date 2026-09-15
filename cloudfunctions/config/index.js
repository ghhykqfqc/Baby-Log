// cloudfunctions/config/index.js
// 宝宝日志log - 全局功能开关（远程配置）
//
// 用途：
//   提审时默认「审核模式」（aiEnabled=false），首页仅展示系统内置的
//   【每日睡前小故事】卡片；审核通过后，只需在云开发控制台把
//   app_config 集合里 aiEnabled 改为 true（无需发版），即可恢复
//   「云朵 AI 育娃伙伴」问答功能。
//
// 集合：app_config
//   示例文档：
//   {
//     "_id": "feature_flags",
//     "aiEnabled": false,      // AI 问答+语音开关（false=审核模式；true=完整功能）
//     "storyEnabled": true,    // 每日故事卡片开关
//     "updatedAt": 1234567890
//   }
//
// 兼容：
//   - 集合不存在（-502005）时自动创建并写入默认值（自愈）
//   - 无网络/云环境异常时返回默认值，前端降级为本地默认模式
// 返回：
//   { code: 0, data: { aiEnabled, storyEnabled, reviewMode } }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 默认值：false = 审核模式（提审时保证无 AI 痕迹）
const DEFAULT_FLAGS = {
  aiEnabled: false,
  storyEnabled: true
}
// 集合存在性探测失败时的兜底（防止异常导致首页空态）
const FALLBACK_FLAGS = { aiEnabled: false, storyEnabled: true }

const COLLECTION_NAME = 'app_config'
const DOC_ID = 'feature_flags'

async function ensureCollection(db) {
  try {
    const collections = await db.listCollections()
    const names = (collections && collections.collections
      ? collections.collections
      : collections || []
    ).map((c) => (c && (c.name || c.collectionName)) || '')
    if (!names.includes(COLLECTION_NAME)) {
      await db.createCollection(COLLECTION_NAME)
    }
  } catch (e) {
    // listCollections 在小程序端不可用，但云函数端通常可用；失败时 catch
  }
}

async function readFlags(db) {
  try {
    const res = await db.collection(COLLECTION_NAME).doc(COLLECTION_ID_DOC).get()
    const doc = res && res.data
    if (!doc) throw new Error('doc-missing')
    return {
      aiEnabled: doc.aiEnabled !== false, // 缺省视为 true（有文档即已配置）
      storyEnabled: doc.storyEnabled !== false,
      _raw: doc
    }
  } catch (e) {
    // 文档不存在 → 尝试读取集合第一条
    try {
      const res = await db.collection(COLLECTION_NAME).limit(1).get()
      const doc = res && res.data && res.data[0]
      if (doc) {
        return {
          aiEnabled: doc.aiEnabled !== false,
          storyEnabled: doc.storyEnabled !== false,
          _raw: doc
        }
      }
    } catch (e2) {}
    throw e
  }
}

exports.main = async () => {
  try {
    await ensureCollection(cloud.database)
    const flags = await readFlags(cloud.database())
    const finalFlags = {
      aiEnabled: !!flags.aiEnabled,
      storyEnabled: flags.storyEnabled !== false,
      reviewMode: flags.aiEnabled !== true
    }
    const now = Date.now()
    // 幂等写入默认值（首次创建）
    try {
      await cloud.database().collection(COLLECTION_NAME).doc(COLLECTION_ID).set({
        data: {
          aiEnabled: finalFlags.aiEnabled,
          storyEnabled: finalFlags.storyEnabled,
          updatedAt: now
        }
      })
    } catch (e) {}
    return {
      code: 0,
      data: {
        aiEnabled: finalFlags.aiEnabled,
        storyEnabled: finalFlags.storyEnabled,
        reviewMode: finalFlags.reviewMode
      }
    }
  } catch (err) {
    console.warn('config 读取失败，使用默认值:', (err && err.message) || err)
    return {
      code: 0,
      data: { ...FALLBACK_FLAGS, reviewMode: true }
    }
  }
}