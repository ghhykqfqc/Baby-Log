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
 * 生成唯一 babyId（重试 5 次）
 */
async function generateUniqueBabyId() {
  for (let attempts = 0; attempts < 5; attempts++) {
    const candidate = generateBabyId()
    const dup = await db.collection('babies').where({ babyId: candidate }).count()
    if (dup.total === 0) return candidate
  }
  return ''
}

/**
 * 生成 6 位数字加入密码
 */
function generateBabyCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * 批量迁移某个集合中指定 babyId 的记录到新 babyId
 * 云数据库 where().update() 单次最多更新 20 条，因此循环迁移直到没有剩余
 * @returns {number} 迁移总条数
 */
async function migrateCollection(collectionName, fromId, toId) {
  let total = 0
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await db.collection(collectionName).where({ babyId: fromId }).update({
        data: {
          babyId: toId,
          migratedFrom: fromId,
          migratedAt: new Date()
        }
      })
      const count = (res.stats && res.stats.updated) || 0
      total += count
      if (count === 0) {
        break
      }
      // 单次最多 20 条，若达到则继续下一轮
      if (count < 20) break
    }
    if (total > 0) {
      console.log(`迁移 ${collectionName}: ${fromId} → ${toId}，共 ${total} 条`)
    }
    return total
  } catch (err) {
    // 集合不存在等场景不阻断主流程
    console.warn(`迁移 ${collectionName} 失败（忽略）:`, (err && (err.errMsg || err.message)) || err)
    return 0
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { babyId, name, avatar, birthDate, gender, albumPhotos, babyCode } = event

  const FALLBACK = { code: -1, message: '云端暂不可用，资料已保存到本地' }

  return safeDb(async () => {
    // ========== 确定真实 babyId ==========
    // 场景：
    //   a) babyId 为空或 'default'（历史离线/占位数据）→ 生成真实 ID，并把旧占位数据「升级迁移」到新 ID
    //   b) babyId 非 default 但云端查无此宝宝（被删/未创建）→ 生成新 ID，同样升级旧记录
    // 其余情况沿用原 ID，避免已有记录被切走/重复
    const isPlaceholder = !babyId || babyId === 'default'
    const placeholderId = isPlaceholder ? 'default' : babyId

    let foundBaby = null
    if (!isPlaceholder) {
      // 非占位：云端有该 ID 的宝宝文档 → 正常更新
      const existing = await db.collection('babies').where({ babyId }).limit(1).get()
      foundBaby = (existing.data && existing.data.length > 0) ? existing.data[0] : null
    } else {
      // default/空：看看云端是否已存在 default 占位文档（此前离线记录留下的）
      const ph = await db.collection('babies').where({ babyId: 'default' }).limit(1).get()
      foundBaby = (ph.data && ph.data.length > 0) ? ph.data[0] : null
    }

    // 需要「升级为真实 ID」：占位 ID（null/空/default）必须升级；
    // 或非占位但云端查无此宝宝的失效 ID 同样升级
    const needMigrate = isPlaceholder || !foundBaby

    let realBabyId = babyId
    if (needMigrate) {
      realBabyId = await generateUniqueBabyId()
      if (!realBabyId) {
        return { code: -1, message: 'ID 生成失败，请重试' }
      }
    }

    // ======== 字段级更新（核心！）========
    // 仅当显式传入时才更新对应字段，避免「只传 albumPhotos 保存相册」时
    // 把 name/avatar/birthDate/gender 误覆盖为空字符串（历史 bug：宝宝昵称被清空）
    const update = { babyId: realBabyId, userId: OPENID, updatedAt: new Date() }

    if (name !== undefined) {
      update.name = String(name || '').trim().slice(0, 30)
    }
    if (avatar !== undefined) {
      update.avatar = String(avatar || '')
    }
    if (birthDate !== undefined) {
      update.birthDate = String(birthDate || '')
    }
    if (gender !== undefined) {
      update.gender = String(gender || '')
    }

    // 相册：仅在显式传入时更新（数组，元素为 cloud fileID），避免头像保存时误清空
    if (Array.isArray(albumPhotos)) {
      update.albumPhotos = albumPhotos.filter(p => typeof p === 'string').slice(0, 9)
    }

    // 宝宝密码：仅在显式传入且为 6 位数字时更新（允许家庭成员修改加入密码）
    if (babyCode && /^\d{6}$/.test(String(babyCode))) {
      update.babyCode = String(babyCode)
    }

    // ========== 情况 1：真实 ID 已存在于云端 → 直接更新，返回原 ID ==========
    if (foundBaby && !needMigrate) {
      const id = foundBaby._id
      await db.collection('babies').doc(id).update({ data: update })
      return {
        code: 0,
        data: {
          _id: id,
          babyId: realBabyId,
          babyCode: update.babyCode || foundBaby.babyCode || '',
          name: update.name !== undefined ? update.name : (foundBaby.name || ''),
          avatar: update.avatar !== undefined ? update.avatar : (foundBaby.avatar || ''),
          birthDate: update.birthDate !== undefined ? update.birthDate : (foundBaby.birthDate || ''),
          gender: update.gender !== undefined ? update.gender : (foundBaby.gender || ''),
          albumPhotos: update.albumPhotos || foundBaby.albumPhotos || [],
          wasDefaultPlaceholder: false
        }
      }
    }

    // ============================================================
    // ========== 情况 2：升级迁移（default/失效 ID → 真实 ID） ==========
    // 目标：保存成功后“原先 default 的宝宝”直接变成真实 ID，
    //       而不是新建一个同名宝宝、旧记录仍挂在 default 下。
    // ============================================================
    const migratedAt = new Date()

    // 1) 把 default 占位文档更新为真实宝宝（保留 _id，避免重复）
    if (foundBaby) {
      try {
        await db.collection('babies').doc(foundBaby._id).update({
          data: Object.assign({}, update, {
            babyId: realBabyId,
            migratedFrom: 'default',
            migratedAt
          })
        })
      } catch (err) {
        console.warn('升级占位宝宝文档失败，走新建兜底:', (err && (err.errMsg || err.message)) || err)
        // 不 return：仍会迁移记录，并走到下方「文档不存在则新建」
        return { code: -1, message: '升级宝宝失败，请重试' }
      }
    } else {
      // 占位文档不存在（可能从未入库），直接以真实 ID 新建
      if (!update.babyCode) update.babyCode = generateBabyCode()
      update.createdAt = new Date()
      update.migratedFrom = 'default'
      update.migratedAt = migratedAt
      await db.collection('babies').add({ data: update })
    }

    // —— 2) 迁移历史数据：records / growth_data / baby_members 全部从占位 ID 升级到真实 ID
    await migrateCollection('records', placeholderId, realBabyId)
    await migrateCollection('growth_data', placeholderId, realBabyId)
    await migrateCollection('baby_members', placeholderId, realBabyId)

    // —— 3) 补齐资料字段（若是更新了占位文档，这里补上显式传入的资料）
    //        注意：刚把占位 doc 的 babyId 改成 realBabyId，重新查一次拿到 _id
    const afterRes = await db.collection('babies').where({ babyId: realBabyId }).limit(1).get()
    let babyDocId = afterRes.data && afterRes.data[0] ? afterRes.data[0]._id : null
    if (babyDocId) {
      await db.collection('babies').doc(babyDocId).update({ data: update })
    } else {
      // 兜底：直接新建（并发罕见场景）
      if (!update.babyCode) update.babyCode = generateBabyCode()
      update.createdAt = new Date()
      update.migratedFrom = 'default'
      const addRes = await db.collection('babies').add({ data: update })
      babyDocId = addRes._id
    }

    // —— 4) 确保成员关系（当前用户升级为 parent）
    const memberRes = await db.collection('baby_members').where({
      babyId: realBabyId, openid: OPENID
    }).limit(1).get()
    if (!memberRes.data || memberRes.data.length === 0) {
      await db.collection('baby_members').add({
        data: { babyId: realBabyId, openid: OPENID, role: 'parent', joinedAt: new Date() }
      })
    }

    // —— 5) 查询最终资料返回（保证 name/avatar/birthDate 等完整）
    const finalRes = await db.collection('babies').where({ babyId: realBabyId }).limit(1).get()
    const finalBaby = finalRes.data && finalRes.data[0] ? finalRes.data[0] : update

    return {
      code: 0,
      data: {
        _id: babyDocId,
        babyId: realBabyId,
        babyCode: finalBaby.babyCode || update.babyCode || '',
        name: (update.name !== undefined ? update.name : finalBaby.name) || '',
        avatar: (update.avatar !== undefined ? update.avatar : finalBaby.avatar) || '',
        birthDate: (update.birthDate !== undefined ? update.birthDate : finalBaby.birthDate) || '',
        gender: (update.gender !== undefined ? update.gender : finalBaby.gender) || '',
        albumPhotos: update.albumPhotos || finalBaby.albumPhotos || [],
        wasDefaultPlaceholder: true,   // 前端据此吸收新 ID
        migratedFrom: 'default'        // 告诉前端：原先 default 占位宝宝已被升级
      }
    }
  }, FALLBACK, ['babies', 'baby_members', 'records', 'growth_data'])
}