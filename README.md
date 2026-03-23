# ⚡ AI Code Agent

**将任意网页端 AI（ChatGPT、Claude、Gemini、DeepSeek、Kimi...）的代码回答一键应用到本地 VS Code**

不需要 API Key，不绑定任何 AI 服务，完全免费开源。

![demo](https://img.shields.io/badge/状态-可用-brightgreen) ![version](https://img.shields.io/badge/版本-1.1.0-blue) ![license](https://img.shields.io/badge/协议-MIT-green)

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🔍 自动检测 | 自动识别 AI 回答中的代码操作指令，显示「应用」按钮 |
| ⚡ 一键应用 | 点击按钮直接创建/修改/删除本地文件 |
| 📄 Diff 预览 | 修改前在 VS Code 中预览差异，支持「全部接受/全部拒绝」 |
| 🔧 Patch 模式 | 大文件只修改需要的部分，不用替换整个文件 |
| 🛡️ 安全防护 | 敏感文件拦截 + AI 偷懒检测 + Git 自动快照 |
| ⏪ 一键撤销 | 通过 Git 回退上一次 AI 修改 |
| 📤 双向通信 | 从 VS Code 发送文件/选中代码/错误信息到浏览器 AI |
| 🔌 总开关 | 一键开关插件，关闭后清除所有页面注入 |
| 📋 一键提示词 | 新用户一键复制 AI 提示词，开箱即用 |
| 🚀 自动跳转 | 发送代码后自动切换到 VS Code 窗口 |
| 🔄 多窗口支持 | 自动寻找可用端口，同时开多个项目不冲突 |
| 🧹 智能过滤 | 终端命令、步骤说明等非代码内容不显示发送按钮 |

## 🚀 快速开始

### 1. 安装 VS Code 扩展

```bash
cd vscode-extension
npm install
npm run compile
npx vsce package
```

在 VS Code 中：`Ctrl+Shift+P` → `Install from VSIX` → 选择生成的 `.vsix` 文件

### 2. 安装浏览器扩展

1. 打开 Edge → `edge://extensions/`（或 Chrome → `chrome://extensions/`）
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `edge-extension` 文件夹

### 3. 开始使用

1. 打开插件弹窗 → 点击 **📋 一键复制 AI 提示词**
2. 将提示词粘贴到 AI 对话的第一条消息中
3. AI 回复的代码旁会自动出现「⚡ 应用到 VS Code」按钮
4. 点击按钮 → 在 VS Code 中预览 Diff → 确认应用

## 📸 使用场景

### 场景 1：AI 生成新文件

AI 回复包含 `agent-action` 代码块 → 点击「应用」→ 文件自动创建

### 场景 2：AI 修改现有文件

AI 用 `patch` 模式 → 只修改需要的部分 → Diff 预览确认

### 场景 3：发送代码给 AI

在 VS Code 中选中代码 → `Ctrl+Shift+Alt+S` → 代码自动注入浏览器 AI 输入框

### 场景 4：发送错误信息

`Ctrl+Shift+Alt+E` → 粘贴错误信息 → AI 收到后帮你修复

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+Alt+F` | 发送当前文件到浏览器 AI |
| `Ctrl+Shift+Alt+S` | 发送选中代码到浏览器 AI |
| `Ctrl+Shift+Alt+E` | 发送错误信息到浏览器 AI |
| `Esc` | 关闭浮动发送按钮 |

## 📐 架构

```
浏览器 AI 网页
    │
    ├── content.js（自动检测代码块 + 智能过滤）
    │       │
    │       ▼
    ├── background.js（消息路由 + 自动端口探测）
    │       │
    │       ▼  HTTP + WebSocket
    └── VS Code Extension
            ├── server.ts（HTTP/WS 服务器 + 自动端口）
            ├── codeApplier.ts（JSON 解析 + Patch 引擎）
            ├── diffManager.ts（Diff 预览 + 批量确认 + Git 快照）
            └── historyManager.ts（操作历史）
```

## 🔧 配置

在 VS Code 设置中搜索 `AI Code Agent`：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `aiCodeAgent.port` | `9960` | 本地服务器端口 |
| `aiCodeAgent.autoStart` | `true` | VS Code 启动时自动启动服务器 |
| `aiCodeAgent.requireConfirmation` | `true` | 修改前显示 Diff 预览 |
| `aiCodeAgent.autoGitSnapshot` | `true` | 修改前自动 Git 快照 |

## 🛡️ 安全机制

- ✅ 所有通信仅限 `127.0.0.1`，不经过外网
- ✅ 修改前 Diff 预览，用户确认后才写入
- ✅ 拦截 `.env`、`.git/`、`.ssh/`、`node_modules/` 等敏感路径
- ✅ 检测 AI 偷懒输出（`// ... existing code ...`）并警告
- ✅ 每次修改前自动 Git commit，可一键回退
- ✅ 路径越界检测，防止写入工作区外的文件

## 📦 支持的 AI 平台

理论上支持所有网页端 AI，已测试：

- ✅ ChatGPT（chat.openai.com）
- ✅ Claude（claude.ai）
- ✅ Google Gemini
- ✅ DeepSeek
- ✅ Kimi
- ✅ 通义千问
- ✅ 任何能输出 JSON 代码块的 AI

## 🤝 贡献

欢迎提 Issue 和 PR！

## 📜 协议

[MIT License](./LICENSE) © whywbhydyq
