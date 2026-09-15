# -*- coding: utf-8 -*-
"""WXML 标签配对校验：正确处理 <view\n class=...> 换行格式。
用法: python scripts/wxml_check.py [文件或目录...]（默认扫描 miniprogram 下全部 .wxml）
"""
import re, sys, glob

# 自闭合标签（微信小程序中不需要闭合标签的）
VOID_TAGS = {'input', 'image', 'import', 'include', 'icon', 'progress', 'checkbox',
             'radio', 'slider', 'switch', 'audio'}

def check_wxml(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # 去掉注释（含多行）
    content = re.sub(r'<!--.*?-->', '', content, flags=re.S)
    errors = []
    stack = []
    # 匹配 <tag ...> / </tag> / <tag ... />，tag 名后允许空格、换行、斜杠或 >
    token_re = re.compile(r'<(/?)([a-zA-Z][\w-]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*?)(/?)>', re.S)
    for m in token_re.finditer(content):
        closing, tag, attrs, selfclose = m.group(1), m.group(2), m.group(3), m.group(4)
        if selfclose or tag.lower() in VOID_TAGS:
            continue  # 自闭合或空元素
        if closing:
            if not stack:
                errors.append(f"第{content[:m.start()].count(chr(10))+1}行: 多余闭合 </{tag}>")
            elif stack[-1] != tag:
                errors.append(f"第{content[:m.start()].count(chr(10))+1}行: 期望 </{stack[-1]}> 实际 </{tag}> (堆栈: {stack[-5:]})")
                # 弹出直到匹配，避免级联报错
                while stack and stack[-1] != tag:
                    stack.pop()
            if stack and stack[-1] == tag:
                stack.pop()
        else:
            stack.append(tag)
    if stack:
        errors.append(f"文件末尾未闭合标签: {stack}")
    return errors


if __name__ == '__main__':
    targets = sys.argv[1:] or glob.glob('miniprogram/**/*.wxml', recursive=True)
    all_ok = True
    for p in sorted(targets):
        errs = check_wxml(p)
        if errs:
            all_ok = False
            print(f"[FAIL] {p}")
            for e in errs[:20]:
                print("    ", e)
        else:
            print(f"[OK]   {p}")
    print("ALL OK" if all_ok else "HAS ERRORS")