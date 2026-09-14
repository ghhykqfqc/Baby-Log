// utils/tts.js - 语音播报（云函数 edge-tts 温柔女声优先 + 微信同声传译插件兜底）+ 语音识别
//
// 播报方案（2026-09-15 v3 重构）：
//  1. 优先调用云函数 aiTts：edge-tts 免费合成「温柔女声 晓晓（zh-CN-XiaoxiaoNeural）」，
//     返回 mp3 base64，写入本地临时文件播放
//  2. 失败 / 云函数未部署 → 自动回退「微信同声传译」插件（默认男声，仅保底）
//
// 【2026-09-15 v3：智能分片 + 流水线预取】
//   背景：aiTts 云函数默认 3s 超时，长文本（讲故事 500 字）单段合成必被杀；
//   短文本（鼓励的话）成功 → 长短两重天。
//   解决：
//     A. 云函数端：config.json 已配 timeout:20（务必重新部署生效）+ 单例复用 + 12s 守护
//     B. 前端端（本文件）：
//        - 句读感知分片：优先按 句号/感叹号/问号/省略号/分号/换行 断句，
//          次按 逗号/顿号/冒号，兜底硬切；单段目标 ≤120 字 —— 短段合成快、不落 3s 陷阱，
//          断点落在自然语句处，停顿不突兀
//        - 流水线预取（核心）：播第 N 段的同时，后台并发合成第 N+1/N+2 段
//          （双缓冲），播完立刻有货、无断链等待；失败段实时降级插件单段兜底
//  3. 停止机制（2026-09-14 修复）延续：会话令牌 _seq，stop() 即令所有在途
//     合成/播放/预取链作废，杜绝「停了又播」
//
// 使用：
//  - tts.speak(text, opts) ：合成并播放（自动分片 + 预取 + 无缝衔接）
//  - tts.stop()             ：停止播报（立即、彻底）
//  - tts.startRecord() / tts.stopRecord(cb) ：按住说话录音识别（需插件权限）
const PLUGIN_ID = 'WechatSI'

let _plugin = null
function getPlugin() {
  if (_plugin) return _plugin
  try {
    _plugin = requirePlugin(PLUGIN_ID)
  } catch (e) {
    console.warn('同声传译插件未安装/未声明:', e)
  }
  return _plugin
}

// 当前播放音频上下文（全局单例，避免重叠）
let _audio = null

// 播放会话令牌：每次 speech()/stop() 自增；所有异步回调校验 _seq !== seq 即终止
let _seq = 0
function isAlive(seq) {
  return _seq === seq
}

/**
 * 停止当前播报（并使任何进行中的异步合成/播放/预取链立即失效）
 */
function stop() {
  _seq++ // 先递增令牌：让所有在途链作废
  if (_audio) {
    try {
      _audio.stop()
      _audio.destroy()
    } catch (e) {}
    _audio = null
  }
}

// ============================================================
// 智能分片（句读感知）
// ============================================================
const SEG_TARGET = 120 // 单段目标字数：够短（合成快、不撞 3s 陷阱），又保持语句相对完整

/** 按保留标点的正则把文本切成片段（保留标点） */
function splitByPunct(text, re) {
  const out = []
  let last = 0
  const r = new RegExp(re.source, 'g')
  let m
  while ((m = r.exec(text)) !== null) {
    const end = m.index + m[0].length
    out.push(text.slice(last, end))
    last = end
  }
  if (last < text.length) out.push(text.slice(last))
  return out.map((x) => x.trim()).filter(Boolean)
}

/** 把小片段打包成 ≤max 的段 */
function packSegments(segs, max) {
  const out = []
  let cur = ''
  for (const s of segs) {
    if ((cur + s).length <= max) cur += s
    else {
      if (cur) out.push(cur)
      cur = s
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * 智能分片：句号级别优先 → 逗号级别 → 硬切兜底
 * @param {string} text 全文
 * @param {number} [maxLen] 目标单段长度（默认 SEG_TARGET=120）
 * @returns {string[]} 有序分片
 */
function smartSplit(text, maxLen) {
  const s = String(text || '').trim()
  if (!s) return []
  const MAX = maxLen || SEG_TARGET
  if (s.length <= MAX) return [s]

  // 一级：句末标点/换行
  let segs = splitByPunct(s, /[。！？；…\n]/)
  segs = packSegments(segs, MAX)

  // 二级：仍有超长者按逗号/顿号/冒号拆
  const level2 = []
  for (const p of segs) {
    if (p.length <= MAX) {
      level2.push(p)
      continue
    }
    const subs = splitByPunct(p, /[，、：]/)
    level2.push(...packSegments(subs, MAX))
  }

  // 三级：仍超长（无标点长串）→ 硬切
  const final = []
  for (const p of level2) {
    if (p.length <= MAX) final.push(p)
    else {
      for (let i = 0; i < p.length; i += MAX) final.push(p.slice(i, i + MAX))
    }
  }
  return final
}

/** 兼容旧导出名（供调试） */
function splitText(text, maxLen) {
  return smartSplit(text, maxLen || 100)
}

// ============================================================
// 单段合成：云函数 edge-tts 优先 → 同声传译插件兜底 → null 跳过
// ============================================================

/** 云函数 aiTts 合成 → 本地临时 mp3 路径 */
function _synthCloud(content, seq) {
  return new Promise((resolve, reject) => {
    if (!isAlive(seq) || !wx.cloud || !wx.cloud.callFunction) {
      reject(new Error('cloud-unavailable'))
      return
    }
    wx.cloud.callFunction({
      name: 'aiTts',
      data: { text: content }
    }).then((res) => {
      if (!isAlive(seq)) { reject(new Error('stopped')); return }
      const r = (res && res.result) || {}
      if (r.code !== 0 || !r.data || !r.data.audioBase64) {
        reject(new Error((r && r.message) || 'cloud-tts-failed'))
        return
      }
      const fs = wx.getFileSystemManager()
      const tmp = `${wx.env.USER_DATA_PATH}/tts_${seq}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp3`
      try {
        fs.writeFileSync(tmp, r.data.audioBase64, 'base64')
        resolve(tmp)
      } catch (e) {
        reject(e)
      }
    }).catch((err) => reject(err))
  })
}

/** 同声传译插件合成（单段 ≤100 字）→ 插件临时文件路径 */
function _synthPlugin(content, seq) {
  return new Promise((resolve, reject) => {
    const pl = getPlugin()
    if (!pl || !pl.textToSpeech) {
      reject(new Error('plugin-unavailable'))
      return
    }
    pl.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: String(content).slice(0, 100),
      success: (res) => {
        if (!isAlive(seq)) { reject(new Error('stopped')); return }
        if (!res || !res.filename) reject(new Error('plugin-empty'))
        else resolve(res.filename)
      },
      fail: reject
    })
  })
}

/** 单段全链路合成：云 → 插件兜底；都失败 resolve(null)（该段跳过，不中断整体） */
function _synthOne(content, seq) {
  return new Promise((resolve) => {
    _synthCloud(content, seq).then(
      (src) => resolve(src),
      (err) => {
        if (!isAlive(seq)) { resolve(null); return }
        console.warn('edge-tts 女声合成失败，回退插件:', err)
        _synthPlugin(content, seq)
          .then((src) => resolve(src))
          .catch(() => resolve(null))
      }
    )
  })
}

// ============================================================
// 播放本地文件（令牌校验 + 60s 防呆 + 停止轮询 + 播完清理临时文件）
// ============================================================
function _playLocal(src) {
  return new Promise((resolve) => {
    const seq = _seq // 当前会话号（stop() 会递增，poll 检测到即终止）
    if (_audio) {
      try { _audio.stop(); _audio.destroy() } catch (e) {}
      _audio = null
    }
    const audio = wx.createInnerAudioContext()
    audio.src = src
    audio.play()
    _audio = audio
    let settled = false
    let guard = null
    let poll = null
    const finish = () => {
      if (settled) return
      settled = true
      if (poll) clearInterval(poll)
      if (guard) clearTimeout(guard)
      if (_audio === audio) _audio = null
      try { audio.destroy() } catch (e) {}
      // 播完清理临时文件（云/插件产物）
      try { wx.getFileSystemManager().unlinkSync(src) } catch (e) {}
      resolve()
    }
    audio.onEnded(() => {
      if (!isAlive(seq)) return // 已被停止：不触发任何回调
      finish()
    })
    audio.onError(() => {
      if (!isAlive(seq)) return
      finish()
    })
    // 防呆：播放 60s 未结束视为异常，强制结束
    guard = setTimeout(() => {
      if (!isAlive(seq)) return
      try { audio.stop() } catch (e) {}
      finish()
    }, 60000)
    // 轮询捕获「stop() 已触发但原生层没有回调」的极端情况
    poll = setInterval(() => {
      if (!isAlive(seq) && !settled) {
        try { audio.stop() } catch (e) {}
        finish()
      }
    }, 400)
  })
}

// ============================================================
// speech：智能分片 + 流水线预取 + 无缝播放
// ============================================================
const PREFETCH_BATCH = 2 // 预取并发数（双缓冲：第 N 段播放时，N+1/N+2 已在合成）

/**
 * 合成并顺序播放（长文本自动分片；云函数 edge-tts 女声优先，失败回退插件）
 * @param {string} text 要播报的文本
 * @param {object} [options]
 * @param {Function} [options.onStart] 开始播放回调
 * @param {Function} [options.onEnd] 全部播放完回调
 * @param {Function} [options.onError] 失败回调
 */
function speech(text, options = {}) {
  const parts = smartSplit(text)
  if (!parts.length) return
  stop() // 先停旧播放链（令牌自增）
  const seq = ++_seq // 再取本次会话号（顺序敏感：先 stop 后取号）
  const alive = () => isAlive(seq)
  const opts = options || {}

  let pendingIdx = 0 // 下一个待合成分片下标
  const ready = [] // 已合成完、可立即播放的文件队列
  let inflight = 0 // 在途合成数
  let anyPlayed = false // 是否至少成功播过一段
  let startFired = false
  let ended = false // 防止 onEnd/onError 重复触发

  /** 预取：保证 ready+inflight 至少到 target */
  const kickPrefetch = (target) => {
    while (alive() && pendingIdx < parts.length && (ready.length + inflight) < target) {
      const content = parts[pendingIdx++]
      inflight++
      _synthOne(content, seq).then((src) => {
        inflight--
        if (alive() && src) ready.push(src)
      })
    }
  }

  /** 等待队首就绪；返回 false 表示「已无可用内容」（全部合成失败/处理完） */
  const waitReady = () => new Promise((resolve) => {
    const t = setInterval(() => {
      if (!alive()) { clearInterval(t); resolve(false); return }
      if (ready.length > 0) { clearInterval(t); resolve(true); return }
      if (pendingIdx >= parts.length && inflight === 0) {
        clearInterval(t)
        resolve(ready.length > 0)
        return
      }
    }, 30)
    kickPrefetch(PREFETCH_BATCH)
  })

  const run = async () => {
    kickPrefetch(PREFETCH_BATCH) // 开播即预取第一、二段
    while (alive()) {
      const ok = await waitReady()
      if (!alive()) break
      if (!ok) break // 无可用内容，结束
      const src = ready.shift()
      if (!src) continue
      if (!startFired) {
        startFired = true
        if (opts.onStart) opts.onStart()
      }
      await _playLocal(src) // 无论 播完/出错/被停 都继续循环（循环顶部再校验 alive）
      if (!alive()) break
      anyPlayed = true
      kickPrefetch(PREFETCH_BATCH) // 播完一段：补足预取
    }
    // 会话结束：正常播完 → onEnd；全程无成功片段 → onError
    if (alive() && !ended) {
      ended = true
      if (anyPlayed) {
        if (opts.onEnd) opts.onEnd()
      } else if (opts.onError) {
        opts.onError(new Error('tts-all-failed'))
      }
    }
  }
  run()
}

// ============================================================
// 语音识别（按住说话 → 转文字）
// 需要插件「语音识别」接口权限（公众平台插件管理里申请）
// ============================================================
let _recorder = null
let _onRecognize = null
let _onRecognizeFail = null

/**
 * 开始录音识别（按住说话时调用）
 * @param {object} callbacks { onText(text), onError(err), onStart() }
 */
function startRecord(callbacks = {}) {
  const pl = getPlugin()
  if (!pl || !pl.getRecordRecognitionManager) {
    if (callbacks.onError) callbacks.onError({ errMsg: '语音插件未就绪' })
    return
  }
  if (_recorder) {
    try { _recorder.stop() } catch (e) {}
    _recorder = null
  }
  _onRecognize = callbacks.onText
  _onRecognizeFail = callbacks.onError
  const manager = pl.getRecordRecognitionManager()
  _recorder = manager
  manager.onRecognize = (res) => {
    // 识别过程中返回的中间结果（可忽略，最终用 onStop）
  }
  manager.onStop = (res) => {
    const text = (res && res.result) || ''
    if (text && _onRecognize) _onRecognize(text)
    else if (_onRecognizeFail) _onRecognizeFail({ errMsg: '未识别到内容' })
  }
  manager.onError = (res) => {
    if (_onRecognizeFail) _onRecognizeFail(res || { errMsg: '语音识别失败' })
  }
  try {
    manager.start({ lang: 'zh_CN', duration: 60000 })
    if (callbacks.onStart) callbacks.onStart()
  } catch (e) {
    if (callbacks.onError) callbacks.onError(e)
  }
}

/**
 * 停止录音并触发识别回调
 */
function stopRecord() {
  if (_recorder) {
    try { _recorder.stop() } catch (e) {}
    _recorder = null
  }
}

module.exports = {
  speech,
  stop,
  startRecord,
  stopRecord,
  // 供调试
  splitText
}