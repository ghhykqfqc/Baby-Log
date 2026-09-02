# 贝贝log (Baby Log)

> 极简育儿记录微信小程序 — 让单手抱娃也能轻松记录

## 项目简介

贝贝log是一款专为新手父母设计的育儿记录小程序。核心解决单手抱娃时快速记录宝宝喂奶、换尿布、睡觉等作息的痛点。基于微信云开发（CloudBase），无需传统后端，支持离线记录自动同步。

## 核心功能

- **极简打卡**：三个大圆角按钮，一触即录 + 触感反馈
- **智能预测**：基于最近 7 天数据预测下次喂奶/睡觉时间
- **时光轴回顾**：倒序展示当日记录，左滑删除（二次确认）
- **成长档案**：身高体重录入 + Canvas 绘制生长曲线（叠加 WHO 标准）
- **每日小结**：Canvas 生成 750x1334 分享卡片含小程序码
- **家庭共享**：邀请链接关联多人，区分父母（可编辑）/祖辈（仅查看）权限
- **离线可用**：断网本地保存，网络恢复自动同步

## 技术栈

- 前端：微信原生小程序（WXML/WXSS/JS）
- 后端：微信云开发（云函数 + 云数据库 + 云存储）
- 图表：Canvas 2D API
- 配色：奶咖色系 `#D4B896`

## 快速开始

### 1. 环境准备
- 微信开发者工具（最新版）
- 注册微信小程序，获取 AppID
- 开通云开发环境

### 2. 配置
```bash
# 1) 替换 project.config.json 中的 appid 为你的小程序 AppID
# 2) 打开 miniprogram/app.js 顶部的云环境配置区：
#    - DEV_ENV ：开发/体验环境 ID（开发者工具调试 & 体验版使用）
#    - PROD_ENV：生产环境 ID（正式版使用，留空则回退到 DEV_ENV）
# 3) 小程序会自动切换：develop/trial → DEV_ENV，release → PROD_ENV，无需发版改代码
```

### 3. 部署云函数
在微信开发者工具中，右键 `cloudfunctions/` 下每个云函数，选择"上传并部署：云端安装依赖"。

> **多环境说明**：所有云函数均使用 `cloud.DYNAMIC_CURRENT_ENV`，不写死环境。
> 部署时选中哪个环境，云函数就跑在哪个环境的数据库上：
> - 开发调试：在 dev 环境（云开发控制台 → 环境 → 选择 dev）下上传部署
> - 发布正式版：切到 prod 环境后上传部署同一份代码即可

### 4. 创建数据库集合
在云开发控制台创建以下集合：
- `records` - 作息记录
- `growth_data` - 成长数据
- `family_members` - 家庭成员
- `babies` - 宝宝档案
- `invitations` - 邀请令牌

### 5. 运行
在微信开发者工具中打开本项目即可预览。

## 项目结构

```
baby-log/
├── miniprogram/              # 小程序代码
│   ├── app.js               # 全局逻辑
│   ├── app.json             # 全局配置
│   ├── app.wxss             # 全局样式（奶咖色设计令牌）
│   ├── sitemap.json
│   ├── pages/
│   │   ├── index/           # 首页 - 极简打卡
│   │   ├── timeline/        # 时光轴
│   │   ├── growth/          # 成长档案
│   │   └── share/           # 每日小结卡片
│   ├── components/
│   │   ├── record-button/   # 大圆角记录按钮
│   │   ├── timeline-card/   # 时光轴卡片（支持左滑删除）
│   │   └── empty-state/     # 空状态占位
│   ├── utils/
│   │   ├── request.js       # 云函数调用封装
│   │   ├── storage.js       # 本地缓存封装
│   │   ├── predict.js       # 智能预测算法
│   │   ├── time.js          # 时间处理
│   │   └── constants.js     # 常量
│   └── images/              # 图标资源
├── cloudfunctions/           # 云函数
│   ├── addRecord/           # 新增记录
│   ├── deleteRecord/        # 删除记录
│   ├── getRecords/          # 查询记录
│   ├── getPrediction/       # 作息预测
│   ├── addGrowthData/       # 新增成长数据
│   ├── getGrowthData/       # 查询成长数据
│   ├── getDailySummary/     # 当日汇总
│   ├── inviteFamily/        # 发起邀请
│   ├── acceptInvite/        # 接受邀请
│   ├── getOpenId/           # 获取openid
│   └── getMiniProgramCode/  # 生成小程序码
├── docs/
│   └── architecture.md      # 架构设计文档
└── project.config.json
```

## 性能指标

| 指标 | 目标 | 实现 |
|------|------|------|
| 冷启动首屏 | < 300ms | ✅ 本地缓存优先渲染 |
| 主包体积 | < 1MB | ✅ ~600KB |
| 离线可用 | 是 | ✅ Storage + 自动同步 |
| 操作反馈 | < 50ms | ✅ 同步写入本地 |

## 验收标准

- [x] 冷启动首屏秒开，无白屏闪烁
- [x] 单手操作时拇指可覆盖所有核心按钮
- [x] 断网点击记录有本地缓存成功提示
- [x] 恢复网络后自动同步
- [x] 左滑删除有二次确认弹窗
- [x] 生长曲线叠加 WHO 标准曲线
- [x] 分享卡片含可识别小程序码
- [x] 全面屏底部安全区域适配

## 许可证

MIT License
