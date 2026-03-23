# Changelog

## [1.1.0] - 2024

### 新增
- 🔌 插件总开关，一键关闭所有功能
- 📋 一键复制 AI 提示词
- 🚀 发送成功后自动跳转 VS Code
- 🔄 多窗口自动寻找可用端口
- 🧹 智能过滤终端命令和步骤说明
- ✅ Diff 预览支持「全部接受/全部拒绝」
- × 所有按钮可手动关闭
- ⎋ Esc 键关闭浮动按钮
- 🔃 插件内重新加载页面和重载插件
- 📊 操作结果显示具体文件名

### 修复
- 修复 WebSocket 握手从 socket data 读取导致连接失败
- 修复 WebSocket 帧不处理 TCP 分片导致大消息丢失
- 修复浮动按钮 position:fixed + scrollY 导致定位偏移
- 修复发送按钮卡在「发送中」不返回
- 修复敏感文件检测误拦 environment.ts 等正常文件
- 补全 /get-history /clear-history HTTP 端点

### 优化
- HTTP body 大小限制 10MB
- WebSocket 指数退避重连（1s→30s）
- MutationObserver 仅在有新节点时扫描
- 被手动关闭的按钮不会被重新扫描添加

## [1.0.0] - 2024

### 初始版本
- 浏览器扩展自动检测代码块
- VS Code 扩展接收并应用代码
- Diff 预览 + Git 快照
- 操作历史记录
- WebSocket 双向通信
