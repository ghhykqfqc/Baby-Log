// cloudfunctions/saveBabyInfo/index.js
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
    try {
      await db.createCollection(name)
    } catch (e) {}
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId, name, avatar, birthDate, gender, albumPhotos } = event

  if (!babyId) {
    return { code: -1, message: '缺少 babyId' }
  }

  const update = {
    babyId,
    name: name || '',
    avatar: avatar || '',
    birthDate: birthDate || '',
    gender: gender || '',
    userId: OPENID,
    updatedAt: new Date()
  }

  // 相册：仅在显式传入时更新（数组，元素为 cloud fileID），避免头像保存时误清空
  if (Array.isArray(albumPhotos)) {
    update.albumPhotos = albumPhotos.filter(p => typeof p === 'string').slice(0, 9)
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，资料已保存到本地' }

  return safeDb(async () => {
    // 查找是否已存在该 babyId 的资料
    const existing = await db.collection('babies').where({ babyId, userId: OPENID }).limit(1).get()

    if (existing.data && existing.data.length > 0) {
      // 更新
      const id = existing.data[0]._id
      await db.collection('babies').doc(id).update({ data: update })
      return { code: 0, data: { _id: id, ...update } }
    } else {
      // 新增
      update.createdAt = new Date()
      const res = await db.collection('babies').add({ data: update })
      return { code: 0, data: { _id: res._id, ...update } }
    }
  }, FALLBACK, ['babies'])
}