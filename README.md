<div align="center">

# 宝宝日志log

**科学育娃 · 智能预测宝宝作息**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-WeChat%20Mini%20Program-07c160.svg)](https://developers.weixin.qq.com/miniprogram/dev/framework/)
[![CloudBase](https://img.shields.io/badge/Backend-CloudBase-07aeec.svg)](https://tcb.cloud.tencent.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

> 一款面向新手父母的科学育娃小程序。随手记录宝宝作息，智能预测辅助决策，离线可用、自动同步，记录宝宝每一天的成长。

---

## 目录

- [✨ 核心功能](#-核心功能)
- [🎨 设计风格](#-设计风格)
- [🛠 技术栈](#-技术栈)
- [🚀 快速开始](#-快速开始)
- [📁 项目结构](#-项目结构)
- [📊 数据模型](#-数据模型)
- [⚡ 性能指标](#-性能指标)
- [✅ 验收标准](#-验收标准)
- [🗺 路线图](#-路线图)
- [🤝 贡献](#-贡献)
- [📄 许可证](#-许可证)

---

## ✨ 核心功能

### 一键打卡 · 单手可用
- **三大圆角按钮**：喂奶 / 换尿布 / 睡觉，一触即录 + 触感反馈
- **单行记录**：保存即时 Toast 提示，不切页
- **断网离线**：本地缓存，网络恢复自动同步云端

### 智能预测 · 主动提醒
- 基于最近 7 天作息数据，智能预测下次喂奶 / 睡觉时间
- 当日摘要卡：喂奶 / 换尿布 / 睡眠三栏一目了然

### 时光轴 · 一日回看
- 三泳道 × 24h 横轴可视化时间分布图（Canvas 2D 绘制）
- 倒序当日记录列表，长按删除（二次确认）
- 独立记录详情页，按日期分组分页加载

### 成长档案 · WHO 对照
- 身高 / 体重录入，Canvas 绘制生长曲线
- 叠加 WHO 标准生长曲线对照
- 历史记录独立页，长按删除，前端分页

### 日程事项 · 温柔日历
- 自定义日历视图，按类别色点标记日期
- 支持 9 种事项类别：疫苗 / 生日 / 预约 / 兴趣班 / 购物 / 礼物 / 红包 / 其他
- 未来事项倒计时提示

### 宝宝资料 · 多宝宝管理
- 头像裁剪上传（自定义 Canvas 裁剪框）
- 多宝宝档案管理，支持切换
- 宝宝 ID + 密码邀请家人共享

### 每日小结 · 一键分享
- Canvas 绘制 750×1334 分享卡片（含小程序码）
- 自动汇总当日作息数据
- 头像、品牌文案、小程序码自动嵌入

### 实时天气 · 沉浸皮肤
- IP 定位 + Open-Meteo 免费天气 API
- 五种天气皮肤：晴 / 阴 / 雨 / 雪 / 风
- 雨天 Canvas 真实雨滴 + 涟漪动画

---

## 🎨 设计风格

**奶咖色系** · 温暖、柔和、不打扰

| 角色 | 色值 | 用途 |
|------|------|------|
| 主色 | `#D4B896` | 按钮、强调 |
| 背景 | `#FAF6F0` | 全局背景 |
| 卡片 | `#FFFFFF` | 卡片底 |
| 主文本 | `#3D3027` | 正文 |
| 危险 | `#E8554E` | 删除、警告 |
| 成功 | `#7FB069` | 完成提示 |

圆角梯度：`12 / 24 / 40 / 60 rpx`，全部通过 CSS 变量统一管理。

---

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 微信原生小程序（WXML / WXSS / JS） |
| 后端 | 微信云开发（云函数 + 云数据库 + 云存储） |
| 图表 | Canvas 2D API（生长曲线 / 时光轴 / 分享卡） |
| 天气 | Open-Meteo + ipwho.is（免 Key） |
| 基础库 | ≥ 3.5.0 |

---

## 🚀 快速开始

### 1. 环境准备

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（最新版）
- 注册微信小程序，获取 AppID
- 开通云开发环境（建议建两个：开发 + 生产）

### 2. 克隆 & 配置

```bash
git clone <your-repo-url> baby-log
cd baby-log
```

替换 `project.config.json` 中的 `appid` 为你的小程序 AppID。

打开 `miniprogram/app.js` 顶部云环境配置区：

```js
const DEV_ENV  = 'your-dev-env-id'   // 开发/体验环境 ID
const PROD_ENV = 'your-prod-env-id'  // 生产环境 ID（留空则回退到 DEV_ENV）
```

> 小程序会自动切换：`develop/trial → DEV_ENV`，`release → PROD_ENV`，无需发版改代码。

### 3. 部署云函数

在微信开发者工具中，右键 `cloudfunctions/` 下每个云函数，选择 **「上传并部署：云端安装依赖」**。

> 所有云函数均使用 `cloud.DYNAMIC_CURRENT_ENV`，不写死环境。部署时选中哪个环境，就跑哪个环境的数据库。

### 4. 创建数据库集合

在云开发控制台创建以下集合（云函数首次调用时会自动尝试自愈创建，但建议手动建好权限更可控）：

| 集合名 | 用途 |
|--------|------|
| `records` | 作息记录（喂奶 / 尿布 / 睡觉） |
| `growth_data` | 成长数据（身高 / 体重 / 测量日期） |
| `babies` | 宝宝档案 |
| `family_members` | 家庭成员关联 |
| `invitations` | 邀请令牌 |
| `schedules` | 日程事项 |

### 5. 运行预览

在微信开发者工具中打开本项目即可预览。

---

## 📁 项目结构

```
baby-log/
├── miniprogram/                  # 小程序前端代码
│   ├── app.js                    # 全局逻辑（云环境自动切换）
│   ├── app.json                  # 全局配置（tabBar、页面注册）
│   ├── app.wxss                  # 全局样式（设计令牌 CSS 变量）
│   ├── sitemap.json
│   ├── pages/
│   │   ├── index/                # 首页：天气皮肤 + 预测卡 + 相册 + 单行记录
│   │   ├── timeline/             # 时光轴：当日摘要 + 时间分布图
│   │   ├── timeline-records/     # 时光记录详情：按日期分组、分页、删除
│   │   ├── growth/               # 成长档案：焦点数据 + 生长曲线
│   │   ├── history/              # 历史记录：成长数据历史 + 长按删除
│   │   ├── schedule/             # 日程事项：日历视图 + 事项管理
│   │   ├── profile/              # 宝宝资料：头像裁剪 + 多宝宝管理
│   │   ├── share/                # 分享卡片：Canvas 绘制 + 小程序码
│   │   └── login/                # 登录引导页
│   ├── components/
│   │   ├── record-button/        # 大圆角记录按钮（触感反馈）
│   │   ├── timeline-card/        # 时光轴卡片（支持长按删除）
│   │   └── empty-state/          # 空状态占位
│   ├── utils/
│   │   ├── request.js            # 云函数调用封装
│   │   ├── storage.js            # 本地缓存封装
│   │   ├── predict.js            # 智能预测算法
│   │   ├── time.js               # 时间处理工具
│   │   └── constants.js          # 常量
│   ├── custom-tab-bar/           # 自定义 tabBar
│   └── images/                   # 图标资源
├── cloudfunctions/               # 云函数（共 27 个）
│   ├── addRecord/                # 新增作息记录
│   ├── updateRecord/             # 更新记录
│   ├── deleteRecord/             # 删除记录
│   ├── getRecords/               # 查询记录
│   ├── getPrediction/            # 作息预测
│   ├── getDailySummary/          # 当日汇总
│   ├── addGrowthData/            # 新增成长数据
│   ├── updateGrowthData/         # 更新成长数据
│   ├── deleteGrowthData/         # 删除成长数据
│   ├── getGrowthData/            # 查询成长数据
│   ├── addSchedule/              # 新增日程事项
│   ├── updateSchedule/           # 更新日程
│   ├── deleteSchedule/           # 删除日程
│   ├── getSchedules/             # 查询日程
│   ├── createBaby/               # 创建宝宝档案
│   ├── saveBabyInfo/             # 保存宝宝资料
│   ├── deleteBaby/               # 删除宝宝档案
│   ├── listBabies/               # 查询宝宝列表
│   ├── joinBaby/                 # 加入宝宝（通过 ID + 密码）
│   ├── inviteFamily/             # 发起家庭邀请
│   ├── acceptInvite/             # 接受邀请
│   ├── userLogin/                # 用户登录
│   ├── getOpenId/                # 获取 openid
│   ├── getMiniProgramCode/       # 生成小程序码
│   └── getWeather/               # 获取天气（IP 定位 + Open-Meteo）
├── docs/
│   └── architecture.md           # 架构设计文档
├── scripts/                      # 辅助脚本
└── project.config.json
```

---

## 📊 数据模型

### `records` — 作息记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 记录 ID |
| `babyId` | string | 所属宝宝 ID |
| `userId` | string | 记录者 openid |
| `type` | string | `feed` 喂奶 / `diaper` 尿布 / `sleep` 睡觉 |
| `subType` | string | 尿布：`pee` / `poop` / `loose`（拉稀） |
| `duration` | number | sleep 类型专用，分钟 |
| `recordTime` | Date | 记录发生时间 |
| `note` | string | 备注 |
| `createdAt` | Date | 创建时间 |

### `growth_data` — 成长数据

| 字段 | 类型 | 说明 |
|------|------|------|
| `babyId` | string | 所属宝宝 ID |
| `height` | number | 身高 cm |
| `weight` | number | 体重 kg |
| `measureDate` | Date | 测量日期 |
| `monthAge` | number | 测量时月龄 |
| `userId` | string | 记录者 openid |

### `babies` — 宝宝档案

| 字段 | 类型 | 说明 |
|------|------|------|
| `babyId` | string | 宝宝唯一 ID（用于家人加入） |
| `name` | string | 昵称 |
| `avatar` | string | 头像 cloud fileID（空字符串 = 默认 emoji） |
| `birthDate` | Date | 出生日期 |
| `gender` | string | 性别 |
| `albumPhotos` | string[] | 相册（cloud fileID 数组，≤ 9） |
| `userId` | string | 创建者 openid |

### `schedules` — 日程事项

| 字段 | 类型 | 说明 |
|------|------|------|
| `babyId` | string | 所属宝宝 ID |
| `title` | string | 标题 |
| `category` | string | 疫苗 / 生日 / 预约 / 兴趣班 / 购物 / 礼物 / 红包 / 其他 |
| `date` | string | 日期 YYYY-MM-DD |
| `startTime` | string | 开始时间 HH:mm |
| `endTime` | string | 结束时间 HH:mm |
| `location` | string | 地点 |
| `note` | string | 备注 |
| `important` | bool | 是否重要 |

---

## ⚡ 性能指标

| 指标 | 目标 | 实际 |
|------|------|------|
| 冷启动首屏 | < 300ms | ✅ 本地缓存优先渲染 |
| 主包体积 | < 1MB | ✅ ~600KB |
| 离线可用 | 是 | ✅ Storage + 自动同步 |
| 操作反馈 | < 50ms | ✅ 同步写入本地 |
| 按钮拇指可达 | 100% | ✅ 底部大圆角按钮 |

---

## ✅ 验收标准

- [x] 冷启动首屏秒开，无白屏闪烁
- [x] 单手操作时拇指可覆盖所有核心按钮
- [x] 断网点记录有本地缓存成功提示
- [x] 恢复网络后自动同步
- [x] 长按 / 左滑删除均有二次确认
- [x] 生长曲线叠加 WHO 标准曲线
- [x] 分享卡片含可识别小程序码
- [x] 全面屏底部安全区域适配
- [x] 雨 / 雪 / 晴 / 阴 / 风 五种天气皮肤
- [x] 日程事项按类别色点在日历上标记

---

## 🗺 路线图

- [x] **v1.0** — 科学打卡 + 时光轴 + 成长档案 + 家庭共享
- [x] **v1.1** — 天气皮肤 + 相册 + 分享卡片
- [x] **v1.2** — 日程事项 + 多宝宝管理 + 历史记录页
- [ ] **v1.3** — 数据导出（CSV / PDF）
- [ ] **v1.4** — 喂养统计周报 / 月报
- [ ] **v2.0** — AI 育儿助手接入

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本仓库
2. 创建你的分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源，欢迎自由使用、修改、分发。

---

<div align="center">

**给宝宝最好的礼物 · 是用心的记录**

Made with 💛 for new parents

</div>
