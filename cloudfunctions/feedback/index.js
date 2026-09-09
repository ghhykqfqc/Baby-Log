// cloudfunctions/feedback/index.js - 用户意见反馈收集
// 前端在「宝宝管理」面板 → 意见反馈 中提交；
// 数据写入 feedbacks 集合（openid 维度，匿名即可提交，登录/游客均可）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// ====== 集合自愈 + 容错工具 ======
const _ensured = {}

function isCollectionMissing(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  return msg.includes('-502005') || msg.includes('DATABASE_COLLECTION_NOT_EXIST') || msg.includes('collection not exists')
}

async function ensureCollections(names) {
  if (typeof db.createCollection !== 'function') return
  for (const name of names) {
    if (_ensured[name]) continue
    try { await db.createCollection(name) } catch (e) {}
    _ensured[name] = true
  }
}

async function safeDb(fn, fallback, collectionNames) {
  try {
    return await fn()
  } catch (err) {
    if (isCollectionMissing(err)) {
      await ensureCollections(collectionNames)
      try { return await fn() }
      catch (err2) {
        console.error('集合自愈重试后仍失败:', err2)
        return typeof fallback === 'function' ? fallback(err2) : fallback
      }
    }
    console.error('数据库操作失败:', err)
    return typeof fallback === 'function' ? fallback(err) : fallback
  }
}
// ==================================================

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { type = 'other', content = '', contact = '', page = '' } = event

  if (!content || !content.trim()) {
    return { code: -1, message: '反馈内容不能为空' }
  }
  if (content.trim().length > 500) {
    return { code: -1, message: '反馈内容过长（最多500字）' }
  }

  const FALLBACK = { code: 0, data: { ok: true } }

  return safeDb(async () => {
    const res = await db.collection('feedbacks').add({
      data: {
        openid: OPENID || '',
        type,
        content: content.trim(),
        contact: (contact || '').trim(),
        page: page || '',
        status: 'new',          // new | read | resolved
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    return {
      code: 0,
      data: { ok: true, _id: res._id }
    }
  }, FALLBACK, ['feedbacks'])
}