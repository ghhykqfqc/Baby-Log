// cloudfunctions/getMiniProgramCode/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 生成小程序码并上传到云存储，返回 fileID
 */
exports.main = async (event, context) => {
  const { page = 'pages/index/index', scene = 'share_card' } = event

  try {
    // 调用微信接口生成小程序码
    const result = await cloud.openapi.wxaapp.getWXACodeUnlimit({
      scene,
      page,
      checkPath: false,
      envVersion: 'release',
      width: 280
    })

    // 上传到云存储
    const cloudPath = `qrcodes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: result.buffer
    })

    return {
      code: 0,
      data: {
        fileID: uploadRes.fileID
      }
    }
  } catch (err) {
    console.error('生成小程序码失败:', err)
    return {
      code: -1,
      message: '生成小程序码失败',
      detail: err.errMsg || err.message
    }
  }
}
