// cloudfunctions/joinBaby/index.js
// 加入宝宝：凭 babyId + babyCode 校验，成功后写入 baby_members
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId, babyCode } = event

  if (!OPENID) {
    return { code: -1, message: '请先登录' }
  }
  if (!babyId || !babyCode) {
    return { code: -1, message: '请填写宝宝 ID 和密码' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 查找宝宝
    const babyRes = await db.collection('babies').where({ babyId }).limit(1).get()
    if (!babyRes.data || babyRes.data.length === 0) {
      return { code: -1, message: '宝宝 ID 不存在' }
    }
    const baby = babyRes.data[0]

    // 校验密码
    if (!baby.babyCode || String(baby.babyCode) !== String(babyCode)) {
      return { code: -1, message: '宝宝密码不正确' }
    }

    // 检查是否已加入
    const memberRes = await db.collection('baby_members').where({
      babyId, openid: OPENID
    }).limit(1).get()

    if (memberRes.data && memberRes.data.length > 0) {
      // 已是成员：直接返回成功（幂等）
      return {
        code: 0,
        data: {
          babyId: baby.babyId,
          name: baby.name,
          avatar: baby.avatar,
          birthDate: baby.birthDate,
          gender: baby.gender,
          alreadyMember: true
        }
      }
    }

    // 写入成员关系
    await db.collection('baby_members').add({
      data: {
        babyId: baby.babyId,
        openid: OPENID,
        role: 'family',  // 通过密码加入的成员默认为家人
        joinedAt: new Date()
      }
    })

    return {
      code: 0,
      data: {
        babyId: baby.babyId,
        name: baby.name,
        avatar: baby.avatar,
        birthDate: baby.birthDate,
        gender: baby.gender,
        alreadyMember: false
      }
    }
  }, FALLBACK, ['babies', 'baby_members'])
}
