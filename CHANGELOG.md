# Changelog

## [1.4.0] - 2025

### 新增功能
- CLAUDE.md 项目说明：在项目根目录创建 CLAUDE.md，发送代码时自动附加技术栈和规范信息
- 智能上下文收集：一键收集当前文件 + 诊断错误 + 项目配置，打包发送给 AI
- 批量文件发送：输入目录路径，自动扫描并发送目录下所有代码文件（最多 30 个）
- 浏览器 popup 新增「🧠 上下文收集」和「📁 发送目录」按钮
- VS Code 新增快捷键 Ctrl+Shift+Alt+C（上下文收集）和 Ctrl+Shift+Alt+D（发送目录）
- 新增服务端路由 /collect-context 和 /send-directory

### 修复
- 修复「发送后跳转 VS Code」从未生效：/focus 端点改为多重手段（focusWindow + showTextDocument + code CLI）
- 修复每个标签页始终连同一个项目：使用 sessionStorage 实现标签页独立端口绑定
- 修复操作结果通知在底部看不到：改为 sticky 置顶 + 自动滚动到顶部

### 改进
- 项目快捷方式从底部折叠区移到顶部始终可见位置
- popup 打开时查询当前标签页的专属端口，正确高亮对应的工作区芯片
- 切换工作区后端口保存到 sessionStorage，刷新页面不丢失
- 新增 autoAttachClaudeMd 配置项，可控制是否自动附加项目说明
- serverRoutes.ts 独立模块化，减少 server.ts 的改动风险

## [1.3.0] - 2025

### 新增
- 插件弹窗 UI 全面重构：顶部状态栏、折叠分组、芯片式窗口切换
- 一键导出项目代码为 Word
- 按钮发送改为直接 HTTP 通信，速度提升
- 页面不可见时暂停扫描，减少内存占用

## [1.2.0] - 2025

### 性能优化
- MutationObserver 智能过滤：仅在新增 pre/code 节点时触发扫描
- 端口扫描结果缓存 30 秒，避免重复扫描
- fuzzyFind 预计算行偏移，大文件 patch 匹配从 O(n²) 降到 O(n)
- HTTP body 改用 Buffer 数组拼接，减少内存碎片

### 稳定性
- WebSocket 支持 continuation frame，正确处理大消息分帧
- 历史文件原子写入（.tmp + rename），防止崩溃损坏
- 启动时自动清理超过 1 小时的旧 Diff 临时文件
- 历史文件损坏时静默重置，不影响插件运行

### 修复
- AI 偷懒检测改为逐行+行首锚定，不再误报源码中的字符串常量
- 浮动按钮防止超出视口底部
- 连接失败时自动清除端口缓存
- ping frame 正确回传 payload

### 改进
- VS Code 状态栏每 5 秒刷新 WebSocket 客户端数
- 新增 getClientCount() API
- 提示词支持从 prompt-template.txt 外部加载
- manifest.json 新增 web_accessible_resources

## [1.1.0] - 2024

### 新增
- 插件总开关，一键关闭所有功能
- 一键复制 AI 提示词
- 发送成功后自动跳转 VS Code
- 多窗口自动寻找可用端口
- 智能过滤终端命令和步骤说明
- Diff 预览支持「全部接受/全部拒绝」
- 所有按钮可手动关闭
- Esc 键关闭浮动按钮
- 插件内重新加载页面和重载插件
- 操作结果显示具体文件名

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