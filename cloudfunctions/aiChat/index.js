// cloudfunctions/aiChat/index.js
// 云朵 AI 育娃伙伴 - 对话核心云函数
//
// 职责：
//  1. 接收用户文本（语音识别结果 / 手动输入 / 快捷提问）
//  2. 先过 msgSecCheck 2.0（scene=4 评论/留言场景）→ 不通过直接拒绝，不调大模型
//  3. 通过后调用大模型（默认 hy3 成长计划免费额度；可环境变量 AI_MODEL 切换，失败回退 hunyuan-exp）
//  4. 大模型输出再过一次 msgSecCheck（scene=4），风险内容拦截不下发
//  5. 返回完整文本（wx.cloud.callFunction 不适合做 SSE 长连接转发，
//     前端拿到完整文本后用打字机动画逐字展示，达到流式观感）
//
// 前端调用：wx.cloud.callFunction({ name: 'aiChat', data: { text: '...' } })
// 返回：{ code: 0, data: { text: '完整回答' } }
//      { code: 4003, message: '这句话不太合适，换个说法吧～' }（输入/输出安检拦截，且不暴露任何 label）
//
// 注意：
//  - 本函数使用 wx-server-sdk ≥ 4.0.1 的 cloud.ai()（返回底层 @cloudbase/node-sdk 的 AI 实例）
//  - 模型：默认 hy3（小程序成长计划免费额度）；如需 DeepSeek，控制台开通后设环境变量 AI_MODEL=deepseek-v4-flash
//  - hy3 失败自动回退免费 hunyuan-exp，避免额度/模型异常导致 AI 不可用
//  - msgSecCheck 为微信官方内容安全接口，scene 取值参考官方文档（1 资料/2 评论/4 其他场景）
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000 // AI 生成较慢，云函数默认 15000ms 不够，需调大（控制台超时也需同步 ≥60s）
})

// ============================================================
// 系统提示词：育儿为主、话题不设限（过审与产品一致 v2.0）
// ============================================================
// v2.0（2026-09-14）：取消话题硬限制——日常闲聊、节日、科普、生活常识都可聊；
// 但宝宝健康类话题保持「谨慎 + 透明」：
//   1. 不确定就明说「我不确定 / 建议问医生」，绝不瞎编；
//   2. 不给诊断、不给用药剂量、不吓唬人（小问题不渲染成必须去医院）；
//   3. 明确的危险信号（高热惊厥、持续呕吐、呼吸困难、误食、意识异常等）
//      要如实提醒马上就医——这是负责任，不是推销医院；
//   4. 开口先说明「我是 AI 助手，不是医生，仅供参考」。
const SYSTEM_PROMPT = [
  '你是「宝宝日志」的育娃小老师，语气温柔，像幼儿园老师。',
  '你是 AI 助手，不是医生，不能提供医疗诊断、用药剂量等专业医疗建议；涉及宝宝健康问题先说清这一点（简短带过即可，不必每句重复）。',
  '话题不设限：0-6 岁育儿、儿歌、故事、哄睡、辅食、作息、亲子互动、日常闲聊、节日、百科、科普等都欢迎。',
  '宝宝健康类话题要谨慎但真实：',
  '  - 不确定的别硬答，明说「这个我不太确定，建议咨询医生或专业机构」；',
  '  - 不给确诊、不给用药剂量、不吓唬人——小症状（如偶尔喷嚏、鼻塞）别渲染成必须去医院；',
  '  - 但真正危险的信号（呼吸急促、口唇发紫、抽搐、持续高烧不退、误食异物等）必须如实提醒「需要尽快就医」，这是负责任的体现；',
  '  - 已就医过的遵医嘱为主，别推翻医生的说法。',
  '不回答政治、色情、暴力、成人内容，也不讨论敏感话题。',
  '儿歌要押韵、短句；故事要有角色、有结尾，6 岁内可听懂。',
  '回答语气亲切，用「宝宝」「爸爸妈妈」等人称，控制篇幅：',
  '  - 互动问答 200 字以内；',
  '  - 讲故事 500 字以内，讲完说「故事讲完啦，宝宝晚安」；',
  '  - 唱儿歌直接给出押韵歌词，附简单提示。'
].join('\n')

// ============================================================
// msgSecCheck 2.0 文本安检（输入 & 输出共用）
// 通过=pass，疑似=review（宽松放行但保守），拒绝=risky/block
// 注意：msgSecCheck 结果不暴露给前端，只返回业务友好文案
//
// 容错策略（与 textCheck 云函数一致）：
//   安检接口异常 / 未开通权限时「降级放行」并记录日志 —— 宁可偶发漏检，
//   也不能把用户所有请求都误判为违规（历史 bug：整个 AI 无法使用）。
// ============================================================
async function checkTextSec(text, openid) {
  if (!text || !String(text).trim()) return 'pass'
  try {
    // 官方云调用：无需自备 appid/secret
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      scene: 4,          // 场景：4 = 社交/通用会话
      openid: openid || '',  // 传入真实用户 openid（部分环境要求非空）
      content: String(text).slice(0, 2000)
    })
    const result = (res && res.result) || {}
    const suggest = result.suggest || 'pass'
    // 通过 / 疑似（review 属于「疑似」，这里按可放行处理，仅拦截明确违规）
    if (suggest === 'pass' || suggest === 'review') return 'pass'
    return 'risky'
  } catch (err) {
    // 安检接口异常（未开通权限 / 频控 / 网络等）：降级放行，记录日志便于排查
    console.warn('[aiChat] msgSecCheck 降级放行:', (err && (err.errMsg || err.message)) || err)
    return 'pass'
  }
}

/**
 * 把开放平台的安检失败映射为业务结果
 */
function blockedResult(scene) {
  // 不返回任何 label / 错误码 / 违规类型，审核合规
  return {
    code: 4003,
    message: scene === 'input' ? '这句话不太合适，换个说法吧～' : '回答生成中遇到问题，请稍后再试',
    // data: null
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  // 1. 参数
  const userText = String((event && event.text) || '').trim().slice(0, 500)
  if (!userText) {
    return { code: -1, message: '请输入内容' , text: '' }
  }

  // 2. 输入安检（必须先于大模型）
  const inputSuggest = await checkTextSec(userText, OPENID)
  if (inputSuggest !== 'pass') {
    return blockedResult('input')
  }

  // 3. 调大模型流式生成（在云函数内聚合）
  //  - 使用 wx-server-sdk 4.0.1+ 的 cloud.ai()（依赖 ≥4.0.1）
  //  - 模型选择（默认 hy3，可通过环境变量 AI_MODEL 覆盖）：
  //     ① hy3          —— 小程序成长计划免费领取的混元模型额度，当前环境已开通 ✅（默认）
  //     ② hunyuan-exp  —— 微信云开发通用免费体验模型（兜底）
  //     ③ deepseek-v4-flash（官方主推；需资源点计费）—— 开通后环境变量 AI_MODEL=deepseek-v4-flash 即可切
  //  - 容错：当前模型调用失败时，自动回退 hunyuan-exp 再试一次（双保险，避免额度异常导致 AI 不可用）
  const AI_MODEL = process.env.AI_MODEL || 'hy3'
  const FALLBACK_MODEL = 'hunyuan-exp'
  let aiText = ''
  let lastModelErr = ''
  for (const candidate of AI_MODEL === FALLBACK_MODEL ? [AI_MODEL] : [AI_MODEL, FALLBACK_MODEL]) {
    try {
      const ai = cloud.ai()
      const model = ai.createModel('cloudbase')
      const res = await model.streamText({
        model: candidate,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText }
        ]
      })
      // textStream 是 AsyncIterable，逐块累积
      let text = ''
      for await (const chunk of res.textStream) {
        text += chunk
      }
      if (text && String(text).trim()) {
        aiText = text
        break // 成功即跳出
      }
      lastModelErr = 'empty-response'
    } catch (err) {
      const e = (err && (err.errMsg || err.message)) || String(err || '')
      lastModelErr = e
      console.warn('模型调用失败 (' + candidate + '):', e)
      // 继续尝试回退模型
    }
  }

  if (!aiText || !String(aiText).trim()) {
    const errMsg = lastModelErr || 'unknown'
    console.error('所有模型调用失败:', errMsg)
    return {
      code: 500,
      message: '小云朵今天有点累，稍后再试试吧',
      text: '',
      detail: errMsg.slice(0, 300)   // 透出给前端排障（不暴露密钥）
    }
  }

  // 4. 大模型输出安检（防内容带出敏感信息）
  const outputSuggest = await checkTextSec(aiText, OPENID)
  if (outputSuggest !== 'pass') {
    return blockedResult('output')
  }

  // 5. 返回完整回答（前端打字机逐字展示）
  return {
    code: 0,
    data: {
      text: String(aiText).trim(),
      // 附带生成时间，前端可展示
      ts: Date.now()
    }
  }
}