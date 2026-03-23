# ⚡ AI Code Agent

**将任意网页端 AI（ChatGPT、Claude、Gemini、DeepSeek、Kimi...）的代码回答一键应用到本地 VS Code**

不需要 API Key，不绑定任何 AI 服务，完全免费开源。

![status](https://img.shields.io/badge/状态-可用-brightgreen) ![version](https://img.shields.io/badge/版本-1.2.0-blue) ![license](https://img.shields.io/badge/协议-MIT-green)

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🔍 自动检测 | 自动识别 AI 回答中的代码操作指令，显示「应用」按钮 |
| ⚡ 一键应用 | 点击按钮直接创建/修改/删除本地文件 |
| 🔄 Diff 预览 | 修改前在 VS Code 中预览差异，支持「全部接受/全部拒绝」 |
| 🩹 Patch 模式 | 大文件只修改需要的部分，不用替换整个文件 |
| 🛡 安全防护 | 敏感文件拦截 + AI 偷懒检测 + Git 自动快照 |
| ↩️ 一键撤销 | 通过 Git 回退上一次 AI 修改 |
| 🔗 双向通信 | 从 VS Code 发送文件/选中代码/错误信息到浏览器 AI |
| 🔌 总开关 | 一键开关插件，关闭后清除所有页面注入 |
| 📋 一键提示词 | 新用户一键复制 AI 提示词，开箱即用 |
| 🚀 自动跳转 | 发送代码后自动切换到 VS Code 窗口 |
| 🪟 多窗口支持 | 自动寻找可用端口，同时开多个项目不冲突 |
| 🧹 智能过滤 | 终端命令、步骤说明等非代码内容不显示发送按钮 |

## 🆕 v1.2.0 更新内容

### 性能优化
- **MutationObserver 智能过滤**：仅在页面新增 `<pre>`/`<code>` 节点时触发扫描，减少 90%+ 无效扫描
- **端口扫描缓存**：30 秒内复用已发现的服务器地址，避免每次操作都扫描 10 个端口
- **fuzzyFind 行偏移预计算**：大文件 patch 匹配从 O(n²) 降到 O(n)
- **HTTP body Buffer 拼接**：用 Buffer 数组替代字符串拼接，减少内存碎片

### 稳定性提升
- **WebSocket continuation frame 支持**：正确处理浏览器分帧发送的大消息
- **历史文件原子写入**：先写 `.tmp` 再 `rename`，防止崩溃导致文件损坏
- **临时文件自动清理**：启动时清理超过 1 小时的旧 Diff 临时文件
- **AI 偷懒检测修复**：改为逐行+行首锚定检测，不再误报源码中的字符串常量

### 体验改进
- **浮动按钮边界修复**：防止选中文本按钮超出视口底部
- **状态栏实时刷新**：每 5 秒同步 WebSocket 客户端数到 VS Code 状态栏
- **提示词外置管理**：提示词从 `prompt-template.txt` 加载，便于独立维护
- **连接失败自动清缓存**：VS Code 断开后自动清除端口缓存，下次重新扫描

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

## 📖 使用场景

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

## 🏗 架构

```
浏览器 AI 网页
 │
 ├── content.js（自动检测代码块 + 智能过滤 + MutationObserver 优化）
 │       │
 │       ▼
 ├── background.js（消息路由 + 端口探测缓存）
 │       │
 │       ▼  HTTP + WebSocket
 └── VS Code Extension
        ├── server.ts（HTTP/WS 服务器 + 自动端口 + continuation frame）
        ├── codeApplier.ts（JSON 解析 + Patch 引擎 + 行偏移优化）
        ├── diffManager.ts（Diff 预览 + 批量确认 + Git 快照 + 临时文件清理）
        └── historyManager.ts（操作历史 + 原子写入）
```

## ⚙️ 配置

在 VS Code 设置中搜索 `AI Code Agent`：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `aiCodeAgent.port` | `9960` | 本地服务器端口 |
| `aiCodeAgent.autoStart` | `true` | VS Code 启动时自动启动服务器 |
| `aiCodeAgent.requireConfirmation` | `true` | 修改前显示 Diff 预览 |
| `aiCodeAgent.autoGitSnapshot` | `true` | 修改前自动 Git 快照 |

## 🛡 安全机制

- ✅ 所有通信仅限 `127.0.0.1`，不经过外网
- ✅ 修改前 Diff 预览，用户确认后才写入
- ✅ 拦截 `.env`、`.git/`、`.ssh/`、`node_modules/` 等敏感路径
- ✅ 检测 AI 偷懒输出（省略注释行）并警告，逐行锚定不误报
- ✅ 每次修改前自动 Git commit，可一键回退
- ✅ 路径越界检测，防止写入工作区外的文件
- ✅ HTTP body 限制 10MB，WebSocket 缓冲区溢出自动断开

## 🌐 支持的 AI 平台

理论上支持所有网页端 AI，已测试：

- ✅ ChatGPT（chat.openai.com）
- ✅ Claude（claude.ai）
- ✅ Google Gemini
- ✅ DeepSeek
- ✅ Kimi
- ✅ 通义千问
- ✅ 任何能输出 JSON 代码块的 AI

## 📝 更新日志

### v1.2.0
- 性能：MutationObserver 智能过滤、端口缓存、fuzzyFind O(n) 优化
- 稳定性：WS continuation frame、原子写入、临时文件清理
- 修复：AI 偷懒检测误报、浮动按钮越界
- 体验：状态栏实时刷新、提示词外置

### v1.1.0
- 插件总开关、一键复制提示词、自动跳转 VS Code
- 多窗口自动寻找可用端口
- Diff 预览「全部接受/全部拒绝」
- WebSocket 指数退避重连

### v1.0.0
- 浏览器扩展自动检测代码块
- VS Code 扩展接收并应用代码
- Diff 预览 + Git 快照 + 操作历史

## 🤝 贡献

欢迎提 Issue 和 PR！

## 📄 协议

[MIT License](./LICENSE) © whywbhydyq
