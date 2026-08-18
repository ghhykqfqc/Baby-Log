// cloudfunctions/getWeather/index.js
// 天气查询：IP 定位（无需用户授权）+ Open-Meteo 实时天气
// 返回 { code: 0, data: { category: 'sunny'|'cloudy'|'rain'|'snow'|'wind', temp, city } }
// 任何失败都返回默认晴天，保证前端始终有皮肤可用
const https = require('https')

const TIMEOUT_MS = 4000

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
  })
}

/**
 * IP 定位（无需用户授权）：ipwho.is 优先，ipapi.co 兜底
 * 返回 { latitude, longitude, city }
 */
async function locateByIP() {
  try {
    const r = await getJSON('https://ipwho.is/')
    if (r && r.success !== false && typeof r.latitude === 'number') {
      return { latitude: r.latitude, longitude: r.longitude, city: r.city || '' }
    }
  } catch (e) {}
  try {
    const r = await getJSON('https://ipapi.co/json/')
    if (r && typeof r.latitude === 'number') {
      return { latitude: r.latitude, longitude: r.longitude, city: r.city || '' }
    }
  } catch (e) {}
  return null
}

/**
 * Open-Meteo 实时天气（免费无 Key）
 * 返回 { temp, weathercode, windspeed }
 */
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
  const r = await getJSON(url)
  const cw = r && r.current_weather
  if (!cw) return null
  return {
    temp: typeof cw.temperature === 'number' ? cw.temperature : '',
    weathercode: cw.weathercode,
    windspeed: typeof cw.windspeed === 'number' ? cw.windspeed : 0
  }
}

/**
 * WMO weathercode + 风速 → 皮肤分类
 * wind 优先级：风速 ≥ 28 km/h 视为大风天
 */
function mapCategory(weathercode, windspeed) {
  if (windspeed >= 28) return 'wind'
  if (weathercode === 0 || weathercode === 1) return 'sunny'
  if (weathercode === 2 || weathercode === 3 || weathercode === 45 || weathercode === 48) return 'cloudy'
  if ((weathercode >= 51 && weathercode <= 67) ||
      (weathercode >= 80 && weathercode <= 82) ||
      (weathercode >= 95 && weathercode <= 99)) return 'rain'
  if ((weathercode >= 71 && weathercode <= 77) || weathercode === 85 || weathercode === 86) return 'snow'
  return 'cloudy'
}

exports.main = async (event, context) => {
  try {
    const loc = await locateByIP()
    if (!loc) {
      return { code: 0, data: { category: 'sunny', temp: '', city: '' } }
    }
    const weather = await fetchWeather(loc.latitude, loc.longitude)
    if (!weather) {
      return { code: 0, data: { category: 'sunny', temp: '', city: loc.city } }
    }
    return {
      code: 0,
      data: {
        category: mapCategory(weather.weathercode, weather.windspeed),
        temp: weather.temp,
        city: loc.city
      }
    }
  } catch (err) {
    console.warn('getWeather 失败，返回默认晴天:', (err && err.message) || err)
    return { code: 0, data: { category: 'sunny', temp: '', city: '' } }
  }
}
