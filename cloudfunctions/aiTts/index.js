// cloudfunctions/aiTts/index.js
// 云朵 AI 语音合成（TTS）云函数 —— 免费温柔女声
//
// 方案：node-edge-tts（微软 Edge 在线 TTS，免 API Key / 免费 / MIT 协议）
//   - 女声 zh-CN-XiaoxiaoNeural（晓晓）：温柔、清晰，育儿场景首选
//   - 备选女声 zh-CN-XiaoyiNeural（晓伊）更甜、zh-CN-XiaohanNeural（晓涵）
//   - 云函数可访问外网（仅小程序端 wx.request 需域名白名单，云函数不需要）
//   - 合成 mp3 → 读成 base64 返回 → 前端写临时文件播放
//
// 前端调用：wx.cloud.callFunction({ name: 'aiTts', data: { text: '...' } })
// 返回：{ code: 0, data: { audioBase64, voice, format } }
//      { code: 400, message: '文本不能为空' } / { code: 500, message: '语音合成失败' }
//
// 注意：
//  - 非官方付费服务，有速率限制，前端已做「失败自动回退同声传译插件」兜底
//  - 建议在控制台把本云函数超时调到 20s 以上（合成需连外网 ws，约 1-4s/段）
//  - 微信云开发运行环境 /tmp 可写，用于临时落盘（node-edge-tts 需要文件路径）
const cloud = require('wx-server-sdk')
const { EdgeTTS } = require('node-edge-tts')
const os = require('os')
const path = require('path')
const fs = require('fs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 默认温柔女声（晓晓），可环境变量 TTS_VOICE 覆盖
const TTS_VOICE = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural'
const TTS_RATE = process.env.TTS_RATE || '+0%'
const TTS_PITCH = process.env.TTS_PITCH || '+0Hz'
const TTS_VOLUME = process.env.TTS_VOLUME || '+0%'

// 单段文本长度：前端已按 ≤100 字分段，这里防御性截断
const MAX_CHARS = 300

exports.main = async (event) => {
  const text = String((event && event.text) || '').trim().slice(0, MAX_CHARS)
  if (!text) {
    return { code: 400, message: '文本不能为空' }
  }

  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp3`)
  try {
    const tts = new EdgeTTS({
      voice: TTS_VOICE,
      lang: 'zh-CN',
      rate: TTS_RATE,
      pitch: TTS_PITCH,
      volume: TTS_VOLUME,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    })
    await tts.ttsPromise(text, tmpFile)

    const buf = fs.readFileSync(tmpFile)
    if (!buf || !buf.length) {
      throw new Error('empty-audio')
    }
    return {
      code: 0,
      data: {
        audioBase64: buf.toString('base64'),
        voice: TTS_VOICE,
        format: 'mp3'
      }
    }
  } catch (err) {
    const e = (err && (err.errMsg || err.message)) || String(err || '')
    console.error('edge-tts 合成失败:', e)
    return {
      code: 500,
      message: '语音合成失败',
      detail: e.slice(0, 300)
    }
  } finally {
    // 清理临时文件
    try { fs.unlinkSync(tmpFile) } catch (e) {}
  }
}