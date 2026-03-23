# ⚡ AI Code Agent

**将任意网页端 AI（ChatGPT、Claude、Gemini、DeepSeek、Kimi...）的代码回答一键应用到本地 VS Code**

不需要 API Key，不绑定任何 AI 服务，完全免费开源。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🔍 自动检测 | 自动识别 AI 回答中的代码操作指令 |
| ⚡ 一键应用 | 点击按钮直接创建/修改/删除本地文件 |
| 📄 Diff 预览 | 修改前在 VS Code 中预览差异，确认后再应用 |
| 🔧 Patch 模式 | 大文件只修改需要的部分，不用替换整个文件 |
| 🛡️ 安全防护 | 敏感文件拦截 + AI 偷懒检测 + Git 自动快照 |
| ⏪ 一键撤销 | 通过 Git 回退上一次 AI 修改 |
| 📤 双向通信 | 从 VS Code 发送文件/选中代码到浏览器 AI |
| 🔌 总开关 | 一键开关插件，关闭后清除所有页面注入 |

## 🚀 快速开始

### 1. 安装 VS Code 扩展

```bash
cd vscode-extension
npm install
npm run compile
```

在 VS Code 中按 `F5` 启动调试，或打包安装：

```bash
npm run package
```

### 2. 安装浏览器扩展

1. 打开 Edge/Chrome → `edge://extensions/` 或 `chrome://extensions/`
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `edge-extension` 文件夹

### 3. 开始使用

1. 打开插件弹窗 → 点击 **📋 一键复制 AI 提示词**
2. 将提示词粘贴到 AI 对话的第一条消息
3. 之后 AI 回复的代码会自动出现「⚡ 应用到 VS Code」按钮
4. 点击按钮 → 在 VS Code 中预览 Diff → 确认应用

## 📐 架构

```
浏览器 AI 网页
    │
    ├── content.js（自动检测代码块）
    │       │
    │       ▼
    ├── background.js（消息路由）
    │       │
    │       ▼  HTTP + WebSocket
    └── VS Code Extension
            ├── server.ts（HTTP/WS 服务器）
            ├── codeApplier.ts（JSON 解析引擎）
            ├── diffManager.ts（Diff 预览 + Git 快照）
            └── historyManager.ts（操作历史）
```

## 🤝 贡献

欢迎提 Issue 和 PR！

## 📜 协议

[MIT License](./LICENSE)
