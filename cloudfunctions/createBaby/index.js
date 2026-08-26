// cloudfunctions/createBaby/index.js
// 创建宝宝：生成唯一 babyId 和加入密码，并把创建者写入 baby_members 集合（role=parent）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

/**
 * 生成 8 位宝宝 ID：大写字母+数字，去除易混淆字符（0/O/I/1）
 */
function generateBabyId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

/**
 * 生成 6 位数字加入密码
 */
function generateBabyCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { name, avatar, birthDate, gender } = event

  if (!OPENID) {
    return { code: -1, message: '请先登录' }
  }
  if (!name || !String(name).trim()) {
    return { code: -1, message: '请填写宝宝昵称' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 重试 5 次确保 babyId 唯一
    let babyId = ''
    let attempts = 0
    while (attempts < 5) {
      const candidate = generateBabyId()
      const dup = await db.collection('babies').where({ babyId: candidate }).count()
      if (dup.total === 0) {
        babyId = candidate
        break
      }
      attempts++
    }
    if (!babyId) {
      return { code: -1, message: 'ID 生成失败，请重试' }
    }

    const babyCode = generateBabyCode()
    const now = new Date()

    // 写入 babies 集合（保存创建者为 userId，向后兼容旧逻辑）
    const babyData = {
      babyId,
      babyCode,
      name: String(name).trim().slice(0, 30),
      avatar: avatar || '',
      birthDate: birthDate || '',
      gender: gender || '',
      userId: OPENID,
      createdBy: OPENID,
      createdAt: now,
      updatedAt: now
    }
    const addRes = await db.collection('babies').add({ data: babyData })

    // 写入 baby_members 集合（多成员共享的核心）
    await db.collection('baby_members').add({
      data: {
        babyId,
        openid: OPENID,
        role: 'parent',
        joinedAt: now
      }
    })

    return {
      code: 0,
      data: {
        _id: addRes._id,
        babyId,
        babyCode,
        name: babyData.name,
        avatar: babyData.avatar,
        birthDate: babyData.birthDate,
        gender: babyData.gender
      }
    }
  }, FALLBACK, ['babies', 'baby_members'])
}
