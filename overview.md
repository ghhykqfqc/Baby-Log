# 产品全面打磨总览（2026-08-18）

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