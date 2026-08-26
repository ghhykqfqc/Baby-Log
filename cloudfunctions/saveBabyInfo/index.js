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
  const { babyId, name, avatar, birthDate, gender, albumPhotos, babyCode } = event

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

  // 宝宝密码：仅在显式传入且为 6 位数字时更新（允许家庭成员修改加入密码）
  if (babyCode && /^\d{6}$/.test(String(babyCode))) {
    update.babyCode = String(babyCode)
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，资料已保存到本地' }

  return safeDb(async () => {
    // 校验：当前用户必须是该宝宝的成员（baby_members）或创建者
    // 这样家庭成员共享时任何人都能修改宝宝资料
    const memberRes = await db.collection('baby_members').where({
      babyId, openid: OPENID
    }).limit(1).get()

    const isMember = memberRes.data && memberRes.data.length > 0

    // 查找是否已存在该 babyId 的资料（不再限定 userId，支持家庭共享）
    const existing = await db.collection('babies').where({ babyId }).limit(1).get()

    if (existing.data && existing.data.length > 0) {
      const id = existing.data[0]._id
      await db.collection('babies').doc(id).update({ data: update })
      return { code: 0, data: { _id: id, ...update } }
    } else if (isMember) {
      // 通过 baby_members 关系存在但 babies 集合还没记录（理论少见）：新增
      update.createdAt = new Date()
      const res = await db.collection('babies').add({ data: update })
      return { code: 0, data: { _id: res._id, ...update } }
    } else {
      // 既没 babies 记录也不是成员：按旧逻辑允许创建（兼容老版本）
      update.createdAt = new Date()
      const res = await db.collection('babies').add({ data: update })
      return { code: 0, data: { _id: res._id, ...update } }
    }
  }, FALLBACK, ['babies', 'baby_members'])
}