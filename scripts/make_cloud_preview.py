# -*- coding: utf-8 -*-
"""生成 ai-clouds 抠图预览图（白底 + 黑底）"""
import os
from PIL import Image

D = r'D:\Program\person\gitProgram\baby-log\miniprogram\images\ai-clouds'
ROOT = r'D:\Program\person\gitProgram\baby-log'
NAMES = ['cloud-purple.png', 'cloud-blue.png', 'cloud-mint.png', 'cloud-yellowgreen.png']

imgs = [Image.open(os.path.join(D, n)).convert('RGBA') for n in NAMES]
cw, ch = 860, 680
pos = [(15, 15), (435, 15), (15, 340), (435, 340)]
scale = 0.52

for bg, outname in [
    ((255, 255, 255, 255), 'preview_clouds_white.png'),
    ((30, 30, 30, 255), 'preview_clouds_black.png'),
]:
    canvas = Image.new('RGBA', (cw, ch), bg)
    for im2, (px, py) in zip(imgs, pos):
        im3 = im2.resize((int(im2.width * scale), int(im2.height * scale)), Image.LANCZOS)
        canvas.paste(im3, (px, py), im3)
    out = os.path.join(ROOT, outname)
    canvas.convert('RGB').save(out)
    print('saved:', out)

for n in NAMES:
    fp = os.path.join(D, n)
    print('%s: %.0f KB %s' % (n, os.path.getsize(fp) / 1024, Image.open(fp).size))