const fs = require('fs')
const code = fs.readFileSync('miniprogram/utils/time.js', 'utf-8')
const wrapped = code + '\nreturn { formatDurationSmart, formatElapsedSmart, formatRemainingSmart };'
const fn = new Function(wrapped)
const { formatDurationSmart, formatElapsedSmart, formatRemainingSmart } = fn()

const cases = [
  [0, '刚刚'], [5, '5 分钟'], [59, '59 分钟'],
  [60, '1 小时'], [75, '1 小时 15 分'], [120, '2 小时'],
  [135, '2 小时 15 分'], [720, '12 小时'],
  [1440, '1 天'], [1620, '1 天 3 小时'], [2880, '2 天']
]
console.log('=== formatDurationSmart ===')
let pass = 0, fail = 0
cases.forEach(([m, expect]) => {
  const got = formatDurationSmart(m)
  const ok = got === expect
  ok ? pass++ : fail++
  console.log(m + ' min -> "' + got + '"' + (ok ? '  OK' : '  FAIL 期望 "' + expect + '"'))
})

console.log('\n=== formatElapsedSmart ===')
console.log('75 分钟前 -> "' + formatElapsedSmart(Date.now() - 75 * 60 * 1000) + '"')
console.log('2 天前 -> "' + formatElapsedSmart(Date.now() - 2 * 24 * 60 * 60 * 1000) + '"')

console.log('\n=== formatRemainingSmart ===')
console.log('avg=135, 上次 75 分钟前 -> "' + formatRemainingSmart(135, Date.now() - 75 * 60 * 1000) + '"')
console.log('avg=60, 上次 70 分钟前（已超时）-> "' + formatRemainingSmart(60, Date.now() - 70 * 60 * 1000) + '"')
console.log('avg=null -> "' + formatRemainingSmart(null, Date.now()) + '"')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
