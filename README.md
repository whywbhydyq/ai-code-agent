# ⚡ AI Code Agent

**一句话介绍：** 在任意 AI 网页聊天中生成的代码，一键应用到你的本地项目。

> 不需要 API Key，不绑定任何 AI 服务商，完全免费开源。
> 支持 ChatGPT、Claude、Gemini、DeepSeek、Kimi、通义千问等所有网页端 AI。

![version](https://img.shields.io/badge/版本-1.3.0-blue)
![license](https://img.shields.io/badge/协议-MIT-green)

---

## 🎬 30 秒了解它能做什么

```
你在浏览器里问 AI："帮我写一个登录页面"
          ↓
AI 回复了代码
          ↓
代码旁边自动出现 ⚡ 按钮
          ↓
点一下 → VS Code 弹出 Diff 预览
          ↓
确认 → 文件自动创建/修改完成
```

**不用手动复制粘贴，不用手动创建文件，不用手动找到该改哪一行。**

---

## 🚀 3 分钟安装

### 第 1 步：安装 VS Code 扩展

```bash
cd vscode-extension
npm install
npm run compile
```

然后双击项目根目录的 `dev.bat`（Windows）即可自动打包安装。

或者手动安装：
```bash
npx vsce package --no-dependencies --allow-missing-repository
```
在 VS Code 中 `Ctrl+Shift+P` → `Install from VSIX` → 选择生成的 `.vsix` 文件。

### 第 2 步：安装浏览器扩展

1. 打开 Edge `edge://extensions/` 或 Chrome `chrome://extensions/`
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择项目中的 `edge-extension` 文件夹

### 第 3 步：告诉 AI 用什么格式回复

1. 点击浏览器右上角的 ⚡ 插件图标
2. 点击 **📋 一键复制 AI 提示词**
3. 把提示词粘贴到你和 AI 对话的**第一条消息**中发送
4. 之后 AI 回复的代码旁边会自动出现 ⚡ 按钮

**就这么简单，可以开始用了。**

---

## 📖 日常使用

### 场景 1：让 AI 帮你写代码

你对 AI 说：*"帮我在 src/utils/ 下创建一个日期格式化工具"*

AI 回复代码 → 代码块右上角出现 **⚡ 应用** 按钮 → 点击 → VS Code 弹出 Diff 预览 → 点「接受」→ 文件自动创建好了。

### 场景 2：让 AI 帮你改 bug

1. 在 VS Code 中选中报错的代码
2. 按 `Ctrl+Shift+Alt+S` → 代码自动发送到浏览器 AI 的输入框
3. AI 给出修复方案 → 点 ⚡ 按钮 → 自动应用

### 场景 3：发送错误信息

按 `Ctrl+Shift+Alt+E` → 粘贴终端错误信息 → AI 输入框自动收到 → AI 帮你修复。

### 场景 4：批量修改多个文件

AI 一次回复中可以包含多个文件的修改，每个代码块旁边都有独立的 ⚡ 按钮。
也可以点「全部接受」一次性应用所有修改。

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+Alt+F` | 发送当前文件给 AI |
| `Ctrl+Shift+Alt+S` | 发送选中代码给 AI |
| `Ctrl+Shift+Alt+E` | 发送错误信息给 AI |
| `Esc` | 关闭浮动按钮 |

---

## 🔌 插件弹窗功能

点击浏览器右上角 ⚡ 图标打开弹窗：

| 区域 | 功能 |
|------|------|
| **顶部状态栏** | 连接状态、端口号、复制提示词、插件开关 |
| **工作区选择器** | 开了多个 VS Code？点击芯片切换目标窗口 |
| **核心按钮** | 扫描页面 / 复制AI回复 / 撤销修改 |
| **最近操作** | 最近 5 条操作结果一目了然 |
| **快捷发送** | 粘贴代码直接发送到 VS Code |
| **导出项目** | 一键将项目代码导出为 Word 文档（可排除文件） |
| **设置** | 自动跳转、自动扫描开关 |
| **项目快捷方式** | 保存常用项目路径，点击在新窗口打开 |
| **工具** | 重启服务器、查看日志、调试信息 |

---

## 🛡 安全机制

不用担心 AI 乱改你的代码：

- **Diff 预览**：每次修改前都弹出对比，你确认才写入
- **Git 快照**：每次修改前自动 `git commit`，随时可以回退
- **敏感文件拦截**：自动拦截 `.env`、`.git/`、`.ssh/`、`node_modules/` 等
- **AI 偷懒检测**：如果 AI 输出了 `// ... existing code ...` 这种省略写法，会警告你
- **路径越界检测**：防止写入工作区之外的文件
- **纯本地通信**：所有数据只在 `127.0.0.1` 传输，不经过任何外部服务器

---

## 🪟 多窗口支持

同时开了多个 VS Code 项目？没问题：

- 每个 VS Code 窗口自动分配不同端口（9960、9961、9962...）
- 插件弹窗自动发现所有窗口，显示为可点击的芯片
- 点击芯片切换目标窗口，代码发送到正确的项目
- WebSocket 自动重连，切换后立即生效

---

## 🏗 工作原理

```
  浏览器（任意 AI 网页）              VS Code
  ┌─────────────────────┐          ┌──────────────────────┐
  │                     │          │                      │
  │  content.js         │  HTTP    │  server.ts           │
  │  检测代码块          │────────→│  接收代码             │
  │  显示 ⚡ 按钮        │          │                      │
  │                     │          │  codeApplier.ts      │
  │  background.js      │  WS     │  解析 JSON + Patch    │
  │  消息路由            │←───────→│                      │
  │                     │          │  diffManager.ts      │
  │  popup.js           │          │  Diff 预览 + Git 快照 │
  │  控制面板            │          │                      │
  └─────────────────────┘          └──────────────────────┘
```

---

## ⚙️ VS Code 设置

在 VS Code 设置中搜索 `AI Code Agent`：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `aiCodeAgent.port` | `9960` | 起始端口（被占用会自动 +1） |
| `aiCodeAgent.autoStart` | `true` | VS Code 启动时自动启动 |
| `aiCodeAgent.requireConfirmation` | `true` | 修改前显示 Diff 预览 |
| `aiCodeAgent.autoGitSnapshot` | `true` | 修改前自动 Git 快照 |

---

## 📦 导出项目代码

需要把项目代码发给 AI 看？两种方式：

### 方式 1：在插件弹窗中一键导出

1. 打开弹窗 → 展开「导出项目代码为 Word」
2. 填写要排除的文件（比如 `*.md`、`dist/`）
3. 点击「一键导出」→ 自动生成 .docx 文件

### 方式 2：命令行

```bash
pip install python-docx
python export_code.py
python export_code.py --exclude "*.md" dist/ node_modules/
python export_code.py -o my_project.docx --max-size 500
```

---

## 🌐 支持的 AI 平台

理论上支持所有能显示代码块的网页端 AI：

| 平台 | 状态 |
|------|------|
| ChatGPT | ✅ 已测试 |
| Claude | ✅ 已测试 |
| Google Gemini | ✅ 已测试 |
| DeepSeek | ✅ 已测试 |
| Kimi | ✅ 已测试 |
| 通义千问 | ✅ 已测试 |
| 其他 AI 网站 | ✅ 只要能输出代码块就支持 |

---

## ❓ 常见问题

### Q：按钮不出现？

1. 检查插件弹窗顶部是否显示绿色圆点（已连接）
2. 检查浏览器扩展管理页面，该网站是否允许此扩展运行
3. 点击弹窗中的「🔍 扫描页面」手动触发
4. 按 F12 查看 Console 是否有 `[AI Code Agent] Content script loaded` 输出

### Q：发送后没反应？

1. 检查 VS Code 状态栏右下角是否显示 `AI Agent :9960`
2. 确认 VS Code 打开的项目和你要修改的项目一致
3. 如果开了多个 VS Code，在弹窗中点击正确的窗口芯片切换

### Q：Patch 匹配失败？

这通常是 AI 输出的 `find` 字段和实际代码有微小差异。解决方法：
- 让 AI 用 `write` 模式重新输出完整文件
- 或者在提示词中强调「直接用 write 不要用 patch」

### Q：如何撤销 AI 的修改？

- 插件弹窗点击「⏪ 撤销修改」
- 或在 VS Code 中 `Ctrl+Shift+P` → `AI Agent: 撤销上一次 AI 修改`
- 或直接用 Git：`git log --grep="AI-Agent"` 找到记录后 `git reset`

---

## 📝 更新日志

### v1.3.0
- 插件弹窗 UI 全面重构：顶部状态栏、折叠分组、芯片式窗口切换
- 一键导出项目代码为 Word
- 按钮发送改为直接 HTTP 通信，速度提升
- 页面不可见时暂停扫描，减少内存占用

### v1.2.0
- WebSocket continuation frame 支持
- Patch 匹配 5 级容错
- 历史文件原子写入
- 提示词规则强化

### v1.1.0
- 插件总开关、一键复制提示词
- 多窗口自动端口分配
- Diff 预览全部接受/拒绝

### v1.0.0
- 首个版本：代码检测、Diff 预览、Git 快照、WebSocket 通信

---

## 🤝 贡献

欢迎提 Issue 和 PR！

如果遇到问题：
1. 在插件弹窗点击「🔍 调试信息」复制状态
2. 到 [GitHub Issues](https://github.com/whywbhydyq/ai-code-agent/issues) 提交

## 📄 协议

[MIT License](./LICENSE) © whywbhydyq
