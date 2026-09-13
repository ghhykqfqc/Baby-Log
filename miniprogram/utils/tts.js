// utils/tts.js - 语音播报（云函数 edge-tts 温柔女声优先 + 微信同声传译插件兜底）+ 语音识别
//
// 播报方案（2026-09-13 升级）：
//  1. 优先调用云函数 aiTts：edge-tts 免费合成「温柔女声 晓晓（zh-CN-XiaoxiaoNeural）」，
//     返回 mp3 base64，写入本地临时文件播放
//  2. 失败 / 云函数未部署 → 自动回退「微信同声传译」插件（默认男声，仅保底）
//
// 依赖：
//  - 小程序后台「设置 → 第三方设置 → 插件管理」添加「微信同声传译」插件
//    AppID: wx069ba97219f66d99，版本 0.3.5（回退方案）
//  - app.json 中已声明 plugins.WechatSI
//
// 使用：
//  - tts.speak(text, opts) ：合成并播放（自动分段 ≤100 字、自动 stop 上一个）
//  - tts.stop()             ：停止播报
//  - tts.startRecord() / tts.stopRecord(cb) ：按住说话录音识别（需插件语音识别权限）
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

/**
 * 停止当前播报
 */
function stop() {
  if (_audio) {
    try {
      _audio.stop()
      _audio.destroy()
    } catch (e) {}
    _audio = null
  }
}

/**
 * 把文本按 ≤100 字分段（中文按字符数切，避免截断句子）
 * 同声传译单次合成文本不宜过长
 */
function splitText(text, maxLen = 100) {
  const s = String(text || '').trim()
  if (!s) return []
  const parts = []
  let cur = ''
  for (const ch of s) {
    cur += ch
    if (cur.length >= maxLen) {
      parts.push(cur)
      cur = ''
    }
  }
  if (cur) parts.push(cur)
  return parts
}

/**
 * 合成并顺序播放（长文本自动分段；云函数 edge-tts 女声优先，失败回退插件）
 * @param {string} text 要播报的文本
 * @param {object} [options]
 * @param {Function} [options.onStart] 开始播放回调
 * @param {Function} [options.onEnd] 全部播放完回调
 * @param {Function} [options.onError] 失败回调
 */
function speech(text, options = {}) {
  const parts = _splitForTTS(text)
  if (!parts.length) return
  stop() // 先停旧播报，防止重叠

  // 播放下一个分段：优先云函数合成，失败回退插件
  let index = 0
  let anySuccess = false
  let startFired = false
  const playNext = () => {
    if (index >= parts.length) {
      // 全部失败 → onError（原语义）；只要成功过一段 → onEnd
      if (!anySuccess && options.onError) options.onError(new Error('tts-all-failed'))
      else if (options.onEnd) options.onEnd()
      return
    }
    const content = parts[index++]
    _speakPart(content)
      .then(() => {
        anySuccess = true
        playNext()            // 本段播放完成 → 下一段
      })
      .catch(() => {
        // 云函数 + 插件兜底都失败：跳过本段继续（不阻塞整体）
        playNext()
      })
  }

  /**
   * 合成并播放单段
   * 优先云函数 aiTts（免费温柔女声），失败自动回退同声传译插件
   * @returns {Promise} 播放完成 resolve；全部失败 reject
   */
  function _speakPart(content) {
    return new Promise((resolve, reject) => {
      _playWithCloud(content)
        .then(() => {
          if (!startFired && options.onStart) { startFired = true; options.onStart() }
          resolve()
        })
        .catch((err) => {
          console.warn('edge-tts 女声合成失败，回退插件:', err)
          _playWithPlugin(content)
            .then(() => {
              if (!startFired && options.onStart) { startFired = true; options.onStart() }
              resolve()
            })
            .catch(reject)
        })
    })
  }

  // 方案一：云函数 aiTts → base64 → 本地临时文件播放
  function _playWithCloud(content) {
    return new Promise((resolve, reject) => {
      if (!wx.cloud || !wx.cloud.callFunction) {
        reject(new Error('cloud-unavailable'))
        return
      }
      wx.cloud.callFunction({
        name: 'aiTts',
        data: { text: content }
      }).then((res) => {
        const r = (res && res.result) || {}
        if (r.code !== 0 || !r.data || !r.data.audioBase64) {
          reject(new Error((r && r.message) || 'cloud-tts-failed'))
          return
        }
        // base64 → 本地临时文件 → 播放
        const fs = wx.getFileSystemManager()
        const tmp = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp3`
        try {
          fs.writeFileSync(tmp, r.data.audioBase64, 'base64')
        } catch (e) {
          reject(e)
          return
        }
        _playFile(tmp).then(resolve, (err) => {
          reject(err)
        })
      }).catch((err) => {
        reject(err)
      })
    })
  }

  // 方案二：同声传译插件（默认男声，仅保底；内部按 ≤100 字细分，兼容插件限制）
  function _playWithPlugin(content) {
    return new Promise((resolve, reject) => {
      const pl = getPlugin()
      if (!pl || !pl.textToSpeech) {
        reject(new Error('plugin-unavailable'))
        return
      }
      // 插件单次合成建议 ≤100 字（官方限制 1000 字节），大段细分依次播放
      const subParts = _splitForTTS(content, 100)
      let subIdx = 0
      const playSub = () => {
        if (subIdx >= subParts.length) {
          resolve()
          return
        }
        const sub = subParts[subIdx++]
        pl.textToSpeech({
          lang: 'zh_CN',
          tts: true,
          content: sub,
          success: (res) => {
            if (!res || !res.filename) {
              playSub() // 单段失败跳过
              return
            }
            _playFile(res.filename).then(playSub, playSub)
          },
          fail: () => playSub() // 单段失败跳过
        })
      }
      playSub()
    })
  }

  // 播放本地 / 临时文件，播完 resolve、出错 reject
  function _playFile(src) {
    return new Promise((resolve, reject) => {
      stop() // 确保上一段上下文释放
      const audio = wx.createInnerAudioContext()
      audio.src = src
      audio.play()
      _audio = audio
      let guard = null
      audio.onEnded(() => {
        if (guard) clearTimeout(guard)
        try { audio.destroy() } catch (e) {}
        if (_audio === audio) _audio = null
        resolve()
      })
      audio.onError((err) => {
        if (guard) clearTimeout(guard)
        try { audio.destroy() } catch (e) {}
        if (_audio === audio) _audio = null
        reject(err)
      })
      // 防呆：播放 60s 未结束视为异常，强制结束防卡死（继续下一段）
      guard = setTimeout(() => {
        try { audio.stop() } catch (e) {}
        if (_audio === audio) _audio = null
        try { audio.destroy() } catch (e) {}
        resolve()
      }, 60000)
    })
  }

  playNext()
}

// 拆分文本：优先按标点断句，再按最大长度
function _splitForTTS(text, maxLen) {
  const s = String(text || '').trim()
  if (!s) return []
  const MAX = maxLen || 280   // 默认 edge-tts 云函数单段上限（内置 300 防御截断），留余量
  if (s.length <= MAX) return [s]
  // 按句子切分（。！？；\n 等）
  const sentences = s.split(/(?<=[。！？；\n])/)
  const parts = []
  let cur = ''
  for (const seg of sentences) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    if ((cur + trimmed).length <= MAX) {
      cur += trimmed
    } else {
      if (cur) parts.push(cur)
      cur = trimmed
    }
  }
  if (cur) parts.push(cur)
  // 极端情况仍有超长段（无标点长串），按 MAX 硬切
  const result = []
  for (const p of parts) {
    if (p.length <= MAX) result.push(p)
    else {
      for (let i = 0; i < p.length; i += MAX) result.push(p.slice(i, i + MAX))
    }
  }
  return result
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