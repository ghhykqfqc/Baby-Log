"""
生成秒记宝宝 tabBar PNG 图标（SVG 设计语言版）
- 尺寸 81x81
- 未选中：灰色 #B5A795
- 选中：奶咖色 #D4B896
"""
from PIL import Image, ImageDraw

SIZE = 81
INACTIVE = (181, 167, 149, 255)   # #B5A795
ACTIVE = (212, 184, 150, 255)     # #D4B896


def new_img():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def draw_record(color):
    """记录图标：奶瓶"""
    img = new_img()
    d = ImageDraw.Draw(img)
    cx = cy = SIZE // 2

    # 奶嘴（弧线）
    d.arc([cx - 12, cy - 32, cx + 12, cy - 8], start=200, end=340, fill=color, width=3)
    # 瓶颈
    d.rectangle([cx - 10, cy - 24, cx + 10, cy - 14], outline=color, width=3)
    # 瓶身
    d.rounded_rectangle([cx - 16, cy - 14, cx + 16, cy + 32], radius=6, outline=color, width=3)
    # 液体（半透明填充）
    r, g, b, a = color
    liquid = (r, g, b, int(a * 0.4))
    d.rounded_rectangle([cx - 12, cy + 2, cx + 12, cy + 28], radius=4, fill=liquid)
    # 刻度线
    for y in [cy - 2, cy + 8, cy + 18]:
        d.line([(cx - 12, y), (cx - 6, y)], fill=color, width=2)
    return img


def draw_timeline(color):
    """时光轴图标：三横线带圆点"""
    img = new_img()
    d = ImageDraw.Draw(img)
    dot_x = 18
    line_x0 = 30
    line_x1 = 62
    y_positions = [22, 40, 58]
    dot_radius = 4

    for y in y_positions:
        # 左侧圆点
        d.ellipse([dot_x - dot_radius, y - dot_radius,
                   dot_x + dot_radius, y + dot_radius], fill=color)
        # 右侧横线
        d.line([(line_x0, y), (line_x1, y)], fill=color, width=4)
    return img


def draw_growth(color):
    """成长图标：上升折线"""
    img = new_img()
    d = ImageDraw.Draw(img)
    points = [(14, 60), (28, 48), (42, 36), (58, 20), (66, 12)]
    # 连线
    for i in range(len(points) - 1):
        d.line([points[i], points[i + 1]], fill=color, width=4)
    # 节点圆点
    for x, y in points:
        d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=color)
    # 底部基线
    r, g, b, a = color
    base = (r, g, b, int(a * 0.4))
    d.line([(12, 68), (68, 68)], fill=base, width=2)
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
        drawer(INACTIVE).save(os.path.join(out_dir, f"{name}.png"))
        print(f"生成: {name}.png")
        # 选中（奶咖色）
        drawer(ACTIVE).save(os.path.join(out_dir, f"{name}-active.png"))
        print(f"生成: {name}-active.png")

    print(f"\n全部 6 个 PNG 图标已生成到: {os.path.abspath(out_dir)}")


if __name__ == "__main__":
    main()
