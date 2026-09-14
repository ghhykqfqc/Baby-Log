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
//  - 【超时修复 2026-09-14】控制台默认云函数超时 3s，edge-tts 需要连外网 WebSocket
//    （约 1-4s/段），3s 必然被杀 → 前端报 -504003 Invoking task timed out。
//    必须：
//     1. 本目录 config.json 已配置 "timeout": 20（部署时生效）
//     2. 如果你用控制台/开发者工具部署，请把超时手动改到 20s 以上
//     3. 合成增加 12s 的 Promise.race 守护：偶发卡网时快速失败回退插件，不再盲目等超时
//  - TTS 客户端单例复用（EdgeTTS 每次 new 会重建 WebSocket 连接握手，
//    复用连接可显著提速）；失败时重置单例，下次请求重建，
//    避免连接僵死时反复复用坏连接
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

// 合成超时守护（ms）：Edge 在线合成偶尔网络抖动，
// 超过该时间直接判失败回退插件，避免占用云函数配额
const TTS_TIMEOUT_MS = 12000

// 模块级单例：复用 WebSocket 连接，避免每次调用都重建
let _ttsClient = null

function getTtsClient() {
  if (_ttsClient) return _ttsClient
  _ttsClient = new EdgeTTS({
    voice: TTS_VOICE,
    lang: 'zh-CN',
    rate: TTS_RATE,
    pitch: TTS_PITCH,
    volume: TTS_VOLUME,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
  })
  return _ttsClient
}

// 合成语音 → 临时文件；失败抛错
async function synthesize(text, tmpFile) {
  const client = getTtsClient()
  // 超时守护：网络不发怵时快速失败，令前端回退插件
  await Promise.race([
    client.ttsPromise(text, tmpFile),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('tts-synthesize-timeout')), TTS_TIMEOUT_MS)
    )
  ])
}

exports.main = async (event) => {
  const text = String((event && event.text) || '').trim().slice(0, MAX_CHARS)
  if (!text) {
    return { code: 400, message: '文本不能为空' }
  }

  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp3`)
  try {
    await synthesize(text, tmpFile)

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
    // 连接可能已损坏，重置单例让下次请求重建连接
    _ttsClient = null
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