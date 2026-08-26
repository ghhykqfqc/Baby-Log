// cloudfunctions/deleteBaby/index.js
// 删除宝宝：仅创建者（parent / createdBy / userId 匹配）可删除。
// 删除范围：
//   1. baby_members 中该 babyId 的所有成员关系
//   2. babies 文档
//   3. 该宝宝名下的 records（作息记录，按 babyId 隔离）——可选，建议删除
// 被删除后被提示「记录与相册将一并删除」，请谨慎。
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
  const { babyId, deleteRecords } = event

  if (!babyId) {
    return { code: -1, message: '缺少宝宝 ID' }
  }
  // 防止误删 default 等异常占位 ID
  if (babyId === 'default') {
    return { code: -1, message: '不能删除默认宝宝' }
  }

  const FALLBACK = { code: -1, message: '云端暂不可用，请稍后重试' }

  return safeDb(async () => {
    // 1. 校验当前用户是否为创建者（parent）
    const memberRes = await db.collection('baby_members').where({
      babyId, openid: OPENID
    }).limit(1).get()
    let isParent = memberRes.data && memberRes.data.length > 0 && memberRes.data[0].role === 'parent'

    if (!isParent) {
      // 兼容旧数据：babies.userId 直接等于 OPENID 也算创建者
      const babyRes = await db.collection('babies').where({ babyId }).limit(1).get()
      const baby = babyRes.data && babyRes.data[0]
      if (!baby) return { code: -1, message: '宝宝不存在' }
      if (baby.userId === OPENID || baby.createdBy === OPENID) {
        isParent = true
      }
    }

    if (!isParent) {
      return { code: -1, message: '只有创建者可删除宝宝' }
    }

    // 2. 删除 babies 文档
    await db.collection('babies').where({ babyId }).remove()

    // 3. 删除所有成员关系
    await db.collection('baby_members').where({ babyId }).remove()

    // 4. 删除该宝宝的所有记录（若集合存在；这是最主要的数据）
    //    默认删除（婴儿记录通常希望一并清理）
    if (deleteRecords !== false) {
      try {
        // 分批删除，避免一次删除过多（云数据库单次 remove 有 1000 条限制，但 where 删除也是分批的）
        const batchSize = 100
        let removed = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const res = await db.collection('records').where({ babyId }).remove()
          const count = res.stats && res.stats.removed
          removed += count || 0
          if (!count || count === 0) break
          if (count < batchSize) break
        }
        console.log(`已删除宝宝 ${babyId} 的 ${removed} 条记录`)
      } catch (err) {
        console.warn('删除记录失败（可能集合不存在，忽略）:', err.errMsg || err.message || err)
      }
    }

    return { code: 0, data: { babyId } }
  }, FALLBACK, ['babies', 'baby_members', 'records'])
}