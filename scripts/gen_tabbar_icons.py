"""
生成贝贝log tabBar 图标 PNG 文件
- 尺寸 81x81（官方推荐）
- 未选中：灰色 #999999
- 选中：奶咖色 #D4B896
"""
from PIL import Image, ImageDraw

SIZE = 81  # 官方推荐尺寸
INACTIVE = (153, 153, 153, 255)   # #999999
ACTIVE = (212, 184, 150, 255)     # #D4B896


def new_img():
    """创建透明画布"""
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def draw_record(color):
    """记录图标：圆形外圈 + 中心点（代表打卡按钮）"""
    img = new_img()
    d = ImageDraw.Draw(img)
    cx = cy = SIZE // 2
    # 外圈圆环
    d.ellipse([cx - 28, cy - 28, cx + 28, cy + 28], outline=color, width=4)
    # 中心实心圆
    d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=color)
    return img


def draw_timeline(color):
    """时光轴图标：三条横线带左侧圆点"""
    img = new_img()
    d = ImageDraw.Draw(img)
    dot_x = 16
    line_x0 = 30
    line_x1 = 65
    y_positions = [20, 40, 60]
    dot_radius = 5

    for y in y_positions:
        # 左侧圆点
        d.ellipse([dot_x - dot_radius, y - dot_radius,
                   dot_x + dot_radius, y + dot_radius], fill=color)
        # 右侧横线
        d.line([line_x0, y, line_x1, y], fill=color, width=4)
    return img


def draw_growth(color):
    """成长图标：上升的折线（生长曲线）"""
    img = new_img()
    d = ImageDraw.Draw(img)
    # 折线坐标点：从左下到右上
    points = [(15, 62), (30, 50), (45, 38), (60, 20)]
    # 绘制连线
    for i in range(len(points) - 1):
        d.line([points[i], points[i + 1]], fill=color, width=4)
    # 绘制节点圆点
    for x, y in points:
        d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=color)
    # 底部基线（淡色）
    d.line([(12, 68), (68, 68)], fill=color, width=2)
    return img


def main():
    import os
    out_dir = os.path.join(os.path.dirname(__file__),
                           "..", "miniprogram", "images")
    os.makedirs(out_dir, exist_ok=True)

    icons = {
        "tab-record": draw_record,
        "tab-timeline": draw_timeline,
        "tab-growth": draw_growth,
    }

    for name, drawer in icons.items():
        # 未选中（灰色）
        img_inactive = drawer(INACTIVE)
        img_inactive.save(os.path.join(out_dir, f"{name}.png"))
        print(f"生成: {name}.png")

        # 选中（奶咖色）
        img_active = drawer(ACTIVE)
        img_active.save(os.path.join(out_dir, f"{name}-active.png"))
        print(f"生成: {name}-active.png")

    print(f"\n全部 6 个图标已生成到: {os.path.abspath(out_dir)}")


if __name__ == "__main__":
    main()
