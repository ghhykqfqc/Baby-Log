# 产品全面打磨总览（2026-08-18 ~ 08-19）

## 一、成长页重构（简约大气版）

**核心理念**：精简到本质——只保留身高、体重、月龄三个参数；让家长一眼看到「现在多高多重」。

### 界面结构
1. **档案区**：头像 + 宝宝名字 + 出生信息 + 月龄徽标
2. **焦点数据卡**：超大号身高/体重数字（88rpx 细体）+ 增幅 chip（+0.5 cm / 首次记录 / 持平）
3. **生长曲线卡**：宝宝数据平滑贝塞尔曲线（橙色 + 渐变填充）+ WHO 50 百分位虚线参考 + 浅网格 + 体重/身高切换 Tab
4. **历史记录**：短日期 + 月龄 + 数值，长按删除
5. **录入弹层**：测量日期 + 身高 + 体重（去掉头围），大号输入框

### 新增
- `cloudfunctions/deleteGrowthData/` 云函数（仅创建者可删，含集合自愈）

---

## 二、首页睡眠记录交互重构

**痛点**：原方案单击记录无时长概念，父母长辈操作不便。

### 新交互
- 点击睡觉卡 → 底部弹层
- **未入睡**：①「🌙 宝宝刚刚入睡」②「⏱ 回忆记录（选时长）」
- **已入睡**：显示实时睡眠时长（30s 刷新）+「🌅 宝宝起床了」
- **时长选择器**：8 档常用时长网格（30 分钟 ~ 8 小时），一次性记录「刚刚结束的睡眠」
- 状态持久化到 `sleepStartTime`，应对小程序关闭重开
- 14 小时自动复位，防止漏记

---

## 三、时光轴页：智能预测卡 + 删除控件

### 三栏智能预测卡
- 基于 7 天历史数据计算平均间隔，预测下次时间点
- 显示：图标 + 类型 + 预计时间（今日/明日 HH:mm）+ 倒计时（Xh Ym）
- 超时高亮红色提示
- 30 秒自动刷新倒计时
- 数据不足时隐藏预测卡

### 删除控件重构
- **之前**：隐藏式左滑显示删除（父母长辈发现不了）
- **现在**：每条卡片右侧直接可见的圆形 ✕ 按钮（红色浅底 + 悬停加深），一眼可见，一键删除

---

## 四、全局打磨

- 统一文案格式（睡眠时长用「X小时Y分」）
- 所有 tabBar 页面补充 `onShareAppMessage`，增强传播
- 睡眠入睡状态自动复位（14h）
- 空状态、加载态、错误处理沿用项目奶咖色系

---

## 待用户操作

1. **重新部署新增的 `deleteGrowthData` 云函数**（微信开发者工具 → cloudfunctions/deleteGrowthData 右键 → 上传部署）
2. 其他改动随小程序前端上传生效

## 文件清单

| 文件 | 改动 |
|------|------|
| `miniprogram/pages/growth/growth.wxml` | 重写 |
| `miniprogram/pages/growth/growth.wxss` | 重写 |
| `miniprogram/pages/growth/growth.js` | 重写 |
| `miniprogram/pages/growth/growth.json` | 开启下拉刷新 |
| `miniprogram/pages/index/index.wxml` | 新增睡眠操作弹层 |
| `miniprogram/pages/index/index.js` | 睡眠状态管理 |
| `miniprogram/pages/index/index.wxss` | 弹层样式 |
| `miniprogram/pages/timeline/timeline.wxml` | 新增预测卡 |
| `miniprogram/pages/timeline/timeline.js` | 预测计算 + 倒计时 |
| `miniprogram/pages/timeline/timeline.wxss` | 预测卡样式 |
| `miniprogram/components/timeline-card/*` | 重写（直接删除按钮） |
| `miniprogram/utils/predict.js` | 扩展 predictDetail |
| `cloudfunctions/deleteGrowthData/*` | 新增云函数 |

---

# 2026-08-19 晚：三项体验优化

## 一、时光轴页：固定头部 + 列表区滚动 + 分页加载

**痛点**：整页滚动导致头部预测卡/小结跟着一起滚，观感差。

**改造**：
- 页面改为 **flex 三段式**：头部（日期 + 预测卡 + 当日小结）固定不动 → 中间 `scroll-view` 列表区独立滚动 → 底部分享按钮固定在 tabBar 之上，整页不再滚动
- 列表**按日期分组**（今天 / 昨天 / M月D日 分组标题），历史记录一目了然
- **上拉分页加载**：每次触底自动多加载 7 天，最多展示近 60 天（复用 getRecords 的 days 参数，云函数零改动）；底部有「加载中 / 上拉查看更早 / 最多展示近60天」状态提示
- 下拉刷新改用 scroll-view 原生 refresher；今天无记录时自动加载一次历史，避免空白
- `todayRecords` 缓存仍只存当日，首页/分享页依赖不受影响

## 二、分享卡片：小程序码移位 + 宝宝头像替代笑脸

**痛点**：小程序码居中压住正文金句（适老版甚至超出画布）；笑脸是简笔画不够亲切。

**改造**：
- 新增**统一页脚布局**：细分隔线 + 小程序码固定**右下角**（白底圆角卡片）+ 左侧「秒记宝宝 / 长按识别小程序码」品牌文案，三套主题复用，正文与码互不遮挡
- **笑脸区域优先绘制宝宝头像**：`babyInfo.avatar`（cloud fileID 自动下载）圆形裁剪 cover 绘制 + 白色描边 + 奶咖外环；未上传头像时回退原简笔笑脸
- 绘制改为**设计稿基准（300×533）+ 等比缩放**，任意屏宽排版一致；三主题纵向坐标全部重排
- 小程序码临时路径缓存，切换主题不再重复调用云函数

## 三、成长页 ＋ 号弹窗被 tabBar 遮挡（bug 修复）

**根因**：`.sheet-mask` 使用 `inset: 0` 简写——部分安卓 WebView（X5 内核 < Chromium 87）不支持该简写，导致 `position: fixed` 元素定位失效、停留在文档流位置被 tabBar 盖住。

**修复**：改为显式 `top/left/right/bottom: 0` + z-index 提升至 10000；同类隐患一并修复（首页弹层与天气背景层、资料页裁剪弹层、记录按钮成功层）。

## 本次改动文件

| 文件 | 改动 |
|------|------|
| `miniprogram/pages/timeline/timeline.wxml/.wxss/.js/.json` | 重构为固定头部 + 滚动列表 + 分页 |
| `miniprogram/pages/share/share.js` | 页脚布局 + 头像绘制 + 等比缩放重排 |
| `miniprogram/pages/growth/growth.wxss` | 弹窗定位兼容性修复 |
| `miniprogram/pages/index/index.wxss` | inset 兼容性修复（5 处） |
| `miniprogram/pages/profile/profile.wxss` | inset 兼容性修复 |
| `miniprogram/components/record-button/record-button.wxss` | inset 兼容性修复 |

**待用户操作**：无需部署云函数，前端直接在开发者工具预览验证即可（重点真机验证成长页弹窗、时光轴滚动）。

---

# 2026-08-19 深夜续：首页自适应 + 成长页瘦身 + 历史页

## 一、首页自适应布局（整页不滚动）
- `page-index` / `content-layer` 改 `height:100vh` + `overflow:hidden`，json 加 `disableScroll:true`
- content-layer 是 flex 列布局，**相册区作为弹性区**（`flex:1; min-height:200rpx`）：大屏相册更高、小屏自动压缩，其余区块（header/predict-card/record-row/bottom-hint）全部 `flex-shrink:0`，间距从 24~32rpx 收紧到 20rpx
- 效果：任何机型首页内容都一屏装下，不出现纵向滚动

## 二、成长页瘦身
- 顶部字号统一缩小（profile-name 36→32rpx、avatar 88→80rpx、metric-num 88→76rpx、chart 380→340rpx）
- metric 焦点卡**右上角新增小巧胶囊按钮**「📋 历史 N」（22rpx 字号 + 奶咖底），点击跳转历史页
- 移除页内历史列表 UI 和 onDeleteRecord 方法（已迁历史页）

## 三、新建历史记录页 `pages/history/history`
- app.json 注册；布局 `height:100vh` flex 三段式（顶部统计卡 + scroll-view 列表 + 底部留白），`disableScroll:true`
- 顶部统计卡：总记录数 / 最新身高 / 最新体重
- scroll-view `bindscrolltolower` 分页：**前端切片**（PAGE_SIZE=10），云函数 getGrowthData 一次取 100 条已够用，无需改云函数
- 长按删除（迁自成长页）；navigateTo 跳转，返回成长页时 onShow 自动 loadData 刷新

## 本次改动文件

| 文件 | 改动 |
|------|------|
| `miniprogram/pages/index/index.wxml/.wxss/.json` | 100vh flex 自适应布局 |
| `miniprogram/pages/growth/growth.wxml/.wxss/.js` | 瘦身 + 历史入口按钮 |
| `miniprogram/pages/history/history.wxml/.wxss/.js/.json` | 新建历史记录页 |
| `miniprogram/app.json` | 注册 history 页 |

**待用户操作**：无需部署云函数，开发者工具直接预览。重点验证：①首页不同机型不超高；②成长页历史按钮跳转；③历史页上拉分页。