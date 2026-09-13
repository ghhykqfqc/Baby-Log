# 首页 AI 交互区重构 — 云朵语音按钮换新（2026-09-14）

## 完成内容
参考 `云朵ai语音背景图.png`，重构首页「云朵 AI 育娃伙伴」区域的视觉与布局。

## 改动文件
1. **miniprogram/images/icons/cloud-ai.svg**（重绘）
   - 磨砂玻璃质感渐变云朵：天蓝 #8FC8F0 → 薰衣草 #BEC8F2 → 樱粉 #F2B9D4 → 蜜桃 #FFB9A6
   - 白色放大 5% 底层云形成玻璃描边；两处椭圆高光
   - 居中白色麦克风（胶囊 + 支杆 + U 型托架 + 底座）+ 左右各两条声波弧（向外渐淡）
   - 文字不烧进 SVG，改由 WXML 动态覆盖（aiTipText）
2. **miniprogram/pages/index/index.wxml**（AI 区整块重构）
   - 新布局：品牌头（☁️小云朵 + AI 育娃伙伴 + 右侧动态状态徽标）→ 云朵大按钮（居中，双扩散光环）→ 流式字幕 → 底部快捷提问（加「猜你想问」引导词）
   - 云内动态提示文字 `.ai-btn-label`（按住说话 / 松开发送语音… / 思考中…）
   - 删除旧 ai-main / ai-status-chip / ai-wave 声波条 / ai-voice-tip 结构
   - 触摸/长按/点击事件绑定原样保留（onCloudTouchStart 等），index.js 零改动
3. **miniprogram/pages/index/index.wxss**（对应样式重写）
   - 卡片改为粉蓝渐变玻璃底 + 白描边 + 粉紫投影
   - 新增：漂浮装饰小云（deco-float）、状态徽标（st-listening/thinking/speaking 呼吸圆点）、双光环 halo-expand、云内文字 text-shadow、按压 scale(0.94)
   - 保留：talking 呼吸动画、listening 柔光脉冲、字幕区结构

## 第二轮优化（同日）
1. **云朵 SVG 再简化**：移除声波弧线与玻璃高光椭圆，只保留「渐变云体 + 居中白色麦克风」；云体略放大、麦克风上移，给云内提示文字留出空间（label bottom 由 44rpx → 56rpx，字号 24 → 22rpx）。
2. **展开/收起按钮改版**：原圆形「∨ + 全文」小标改为胶囊按钮 —— 新增 `images/icons/chevron-down.svg`（主色 #B08D5D 线稿 chevron），配粉调渐变胶囊底 + 描边 + 阴影；展开时图标 `rotate(180deg)` 翻转、文案变「收起」。
3. **支持收起（toggle）**：
   - 新增 `aiExpanded` 状态；`showFullAnswer()` 改为 toggle，已展开则调 `hideAiAnswer()` 收起。
   - 由原「底部半屏弹层」改为**字幕区内联展开**：展开时字幕区 `flex:1` 吃掉卡片剩余高度（内部滚动），云朵区自动缩小到 0.58、快捷提问让位隐藏，永不溢出卡片。
   - 展开后底部出现操作行：🔊 播报/停止、⧉ 复制 + 「内容由 AI 生成，仅供参考」。
   - 新提问时 `aiExpanded` 自动重置为 false。
   - 已删除 `showAiAnswerPanel` / `.ai-answer-panel` / `.ai-answer-mask` 等半屏面板相关代码与样式。

## 关键决策
- 渐变选参考图左上「蓝粉」配色，与奶咖色品牌通过卡片渐变底过渡调和
- 提示文字放云内（白字+阴影），替代原按钮下方灰色小字，更贴近参考图
- 快捷提问从顶部移至底部，让云朵按钮成为视觉主体
