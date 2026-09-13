// utils/tts.js - 语音播报（微信同声传译插件）+ 语音识别（按住说话）
//
// 依赖：
//  - 小程序后台「设置 → 第三方设置 → 插件管理」添加「微信同声传译」插件
//    AppID: wx069ba97219f66d99，版本 0.3.5
//  - app.json 中已声明 plugins.WechatSI
//
// 使用：
//  - tts.speak('你好，宝宝') ：合成并播放（自动分段 ≤100 字、自动 stop 上一个）
//  - tts.stop()              ：停止播报
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
 * 合成并顺序播放（长文本自动分段）
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

  // 依次合成播放：合成成功播一段，播放完继续下一段
  let index = 0
  const playNext = () => {
    if (index >= parts.length) {
      if (options.onEnd) options.onEnd()
      return
    }
    const content = parts[index++]
    const pl = getPlugin()
    if (!pl || !pl.textToSpeech) {
      if (options.onError) options.onError(new Error('插件未就绪'))
      else if (options.onEnd) options.onEnd()
      return
    }
    pl.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content,
      success: (res) => {
        if (!res || !res.filename) {
          playNext() // 合成失败直接下一段或结束
          return
        }
        stop() // 确保上一段上下文释放
        const audio = wx.createInnerAudioContext()
        audio.src = res.filename
        audio.play()
        _audio = audio
        if (index === 1 && options.onStart) options.onStart()
        audio.onEnded(() => {
          try { audio.destroy() } catch (e) {}
          if (_audio === audio) _audio = null
          playNext()
        })
        audio.onError(() => {
          try { audio.destroy() } catch (e) {}
          if (_audio === audio) _audio = null
          playNext()
        })
      },
      fail: (err) => {
        // 单段失败继续下一段（不阻塞整体）
        playNext()
      }
    })
  }
  playNext()
}

// 拆分文本：优先按标点断句，再按最大长度
function _splitForTTS(text) {
  const s = String(text || '').trim()
  if (!s) return []
  const MAX = 100
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