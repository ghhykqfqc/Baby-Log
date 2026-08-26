// cloudfunctions/listBabies/index.js
// 查询当前用户可访问的所有宝宝（通过 baby_members 关系）
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

  if (!OPENID) {
    return { code: -1, message: '请先登录' }
  }

  const FALLBACK = { code: 0, data: { babies: [] } }

  return safeDb(async () => {
    // 1. 查询用户加入的所有 babyId，并建立「babyId → 我的角色」映射
    const memberRes = await db.collection('baby_members').where({ openid: OPENID }).get()
    const memberMap = {}     // babyId -> role
    const babyIds = []
    ;(memberRes.data || []).forEach(m => {
      if (!memberMap[m.babyId]) memberMap[m.babyId] = m.role || 'family'
      if (babyIds.indexOf(m.babyId) < 0) babyIds.push(m.babyId)
    })

    // 同时兼容旧数据：直接以 userId = OPENID 创建过但还没写入 baby_members 的宝宝
    const legacyRes = await db.collection('babies').where({ userId: OPENID }).get()
    const legacyIds = (legacyRes.data || []).map(b => b.babyId).filter(id => babyIds.indexOf(id) < 0)
    // 旧数据创建者视为 owner（管理员）
    ;(legacyRes.data || []).forEach(b => {
      if (!memberMap[b.babyId]) memberMap[b.babyId] = b.userId === OPENID ? 'parent' : 'family'
    })

    const allBabyIds = babyIds.concat(legacyIds)
    if (allBabyIds.length === 0) {
      return { code: 0, data: { babies: [] } }
    }

    // 2. 查询这些宝宝的详情，并计算 isOwner（是否创建者/管理员，只有他能删除）
    const babyRes = await db.collection('babies').where({ babyId: _.in(allBabyIds) }).get()
    const babies = (babyRes.data || []).map(b => {
      const myRole = memberMap[b.babyId] || 'family'
      // owner 判定：member 里 role=parent，或者回退检查 babies.createdBy/userId 是否等于当前用户
      const isOwner = myRole === 'parent' ||
        (b.userId === OPENID) ||
        (b.createdBy === OPENID)
      return {
        babyId: b.babyId,
        name: b.name || '',
        avatar: b.avatar || '',
        birthDate: b.birthDate || '',
        gender: b.gender || '',
        babyCode: b.babyCode || '',
        createdAt: b.createdAt,
        role: myRole,
        isOwner
      }
    })

    return { code: 0, data: { babies } }
  }, FALLBACK, ['baby_members', 'babies'])
}
