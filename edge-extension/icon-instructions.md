# 插件图标制作

需要以下尺寸的 PNG 图标（内容一样，大小不同）：

- icon-16.png (16x16)
- icon-48.png (48x48)  
- icon-128.png (128x128)

## 推荐方案（免费）

1. 打开 https://www.canva.com/
2. 创建 128x128 画布
3. 背景色 #007ACC（VS Code 蓝）
4. 中间放一个白色闪电 ⚡ 图标
5. 导出 PNG
6. 用 https://squoosh.app 缩放成 16x16 和 48x48

## 做完后更新 manifest.json

在 manifest.json 中添加：

```json
"icons": {
    "16": "icon-16.png",
    "48": "icon-48.png",
    "128": "icon-128.png"
}
```

同时更新 action 字段：

```json
"action": {
    "default_popup": "popup.html",
    "default_title": "AI Code Agent",
    "default_icon": {
        "16": "icon-16.png",
        "48": "icon-48.png",
        "128": "icon-128.png"
    }
}
```
