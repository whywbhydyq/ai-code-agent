import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { AgentServer } from './server';
import { initClaudeMd, wrapWithClaudeMd, hasClaudeMd } from './claudeMd';
import { collectContext, collectDirectoryFiles } from './contextCollector';

let server: AgentServer | null = null;
let outputChannel: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('AI Code Agent');
    outputChannel.appendLine('[AI Code Agent] 扩展已激活');

    // 初始化 CLAUDE.md 管理器
    initClaudeMd(context);
    if (hasClaudeMd()) {
        outputChannel.appendLine('[AI Code Agent] 已加载 CLAUDE.md');
    }

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'aiCodeAgent.startServer';
    context.subscriptions.push(statusBar);

    function updateStatusBar(running: boolean, port = 0, wsCount = 0) {
        if (running) {
            statusBar.text = `$(radio-tower) AI Agent :${port}${wsCount > 0 ? ` (${wsCount})` : ''}`;
            statusBar.tooltip = `AI Code Agent 运行中\n端口: ${port}\nWebSocket 客户端: ${wsCount}\n点击重启`;
            statusBar.backgroundColor = undefined;
        } else {
            statusBar.text = '$(circle-slash) AI Agent 未运行';
            statusBar.tooltip = '点击启动 AI Code Agent';
            statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        statusBar.show();
    }

    function shouldAttachClaudeMd(): boolean {
        return vscode.workspace.getConfiguration('aiCodeAgent').get<boolean>('autoAttachClaudeMd', true);
    }

    function maybeWrap(message: string): string {
        return shouldAttachClaudeMd() ? wrapWithClaudeMd(message) : message;
    }

    // ===== 启动服务器 =====
    const startCmd = vscode.commands.registerCommand('aiCodeAgent.startServer', async () => {
        if (server) { server.stop(); server = null; }
        const basePort = vscode.workspace.getConfiguration('aiCodeAgent').get<number>('port', 9960);
        server = new AgentServer(basePort, outputChannel);
        try {
            const actualPort = await server.start();
            updateStatusBar(true, actualPort, 0);
            const wsCountTimer = setInterval(() => {
                if (server) {
                    updateStatusBar(true, actualPort, server.getClientCount());
                } else {
                    clearInterval(wsCountTimer);
                }
            }, 5000);
            context.subscriptions.push({ dispose: () => clearInterval(wsCountTimer) });
            if (actualPort !== basePort) {
                vscode.window.showInformationMessage(
                    `AI Code Agent 已启动（端口 ${basePort} 被占用，使用 ${actualPort}）`
                );
            } else {
                vscode.window.showInformationMessage(
                    `AI Code Agent 已启动（端口 ${actualPort}）`
                );
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`AI Code Agent 启动失败: ${err.message}`);
            updateStatusBar(false);
        }
    });

    // ===== 停止服务器 =====
    const stopCmd = vscode.commands.registerCommand('aiCodeAgent.stopServer', () => {
        if (server) { server.stop(); server = null; }
        updateStatusBar(false);
        vscode.window.showInformationMessage('AI Code Agent 已停止');
    });

    // ===== 撤销 =====
    const undoCmd = vscode.commands.registerCommand('aiCodeAgent.undoLastChange', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { vscode.window.showWarningMessage('请先打开一个工作区'); return; }
        try {
            const log = execSync('git log --oneline -5 --grep="AI-Agent"', { cwd: root, encoding: 'utf8' }).trim();
            if (!log) { vscode.window.showInformationMessage('没有找到 AI Agent 的修改记录'); return; }
            const confirm = await vscode.window.showWarningMessage(
                `最近的 AI 修改：\n${log}\n\n确认回退？`,
                { modal: true }, '确认回退'
            );
            if (confirm === '确认回退') {
                execSync('git reset --soft HEAD~1', { cwd: root, encoding: 'utf-8' });
                vscode.window.showInformationMessage('已回退上一次 AI 修改');
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Git 操作失败: ${err.message}`);
        }
    });

    // ===== 日志 =====
    const openLogCmd = vscode.commands.registerCommand('aiCodeAgent.openLog', () => {
        outputChannel.show(true);
    });

    // ===== 发送当前文件（自动附加 CLAUDE.md）=====
    const sendFileCmd = vscode.commands.registerCommand('aiCodeAgent.sendCurrentFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('请先打开一个文件'); return; }
        if (!server) { vscode.window.showWarningMessage('AI Agent 服务器未运行'); return; }

        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const content = editor.document.getText();
        const language = editor.document.languageId;

        const rawMsg = `以下是当前文件 \`${file}\` 的完整内容：\n\`\`\`${language}\n${content}\n\`\`\`\n`;

        server.broadcast({
            type: 'inject-to-input',
            mode: 'file',
            file,
            content,
            language,
            message: maybeWrap(rawMsg),
        });
        const suffix = hasClaudeMd() && shouldAttachClaudeMd() ? '（含 CLAUDE.md）' : '';
        vscode.window.showInformationMessage(`已发送文件 ${file} 到浏览器${suffix}`);
    });

    // ===== 发送选中代码（自动附加 CLAUDE.md）=====
    const sendSelectionCmd = vscode.commands.registerCommand('aiCodeAgent.sendSelection', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('请先打开一个文件'); return; }
        if (!server) { vscode.window.showWarningMessage('AI Agent 服务器未运行'); return; }

        const selection = editor.selection;
        if (selection.isEmpty) { vscode.window.showWarningMessage('请先选中要发送的代码'); return; }

        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const content = editor.document.getText(selection);
        const language = editor.document.languageId;
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;

        const rawMsg = `以下是 \`${file}\` 第 ${startLine}-${endLine} 行的代码：\n\`\`\`${language}\n${content}\n\`\`\`\n`;

        server.broadcast({
            type: 'inject-to-input',
            mode: 'selection',
            file,
            content,
            language,
            startLine,
            endLine,
            message: maybeWrap(rawMsg),
        });
        vscode.window.showInformationMessage(`已发送选中代码（${endLine - startLine + 1} 行）到浏览器`);
    });

    // ===== 发送错误信息（自动附加 CLAUDE.md）=====
    const sendErrorCmd = vscode.commands.registerCommand('aiCodeAgent.sendError', async () => {
        if (!server) { vscode.window.showWarningMessage('AI Agent 服务器未运行'); return; }

        const errorText = await vscode.window.showInputBox({
            prompt: '粘贴错误信息',
            placeHolder: 'Traceback (most recent call last)...',
            ignoreFocusOut: true,
        });
        if (!errorText) return;

        const editor = vscode.window.activeTextEditor;
        const file = editor ? vscode.workspace.asRelativePath(editor.document.uri) : '未知文件';

        const rawMsg = `运行 \`${file}\` 时出现以下错误，请帮我修复：\n\`\`\`\n${errorText}\n\`\`\`\n`;

        server.broadcast({
            type: 'inject-to-input',
            mode: 'error',
            file,
            errorText,
            message: maybeWrap(rawMsg),
        });
        vscode.window.showInformationMessage('错误信息已发送到浏览器');
    });

    // ===== 发送目录文件（批量发送）=====
    const sendDirectoryCmd = vscode.commands.registerCommand('aiCodeAgent.sendDirectory', async () => {
        if (!server) { vscode.window.showWarningMessage('AI Agent 服务器未运行'); return; }

        const dirPath = await vscode.window.showInputBox({
            prompt: '输入要发送的目录路径（相对于工作区）',
            placeHolder: 'src/auth',
            ignoreFocusOut: true,
        });
        if (!dirPath) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在收集 ${dirPath} 下的文件...`,
            cancellable: false,
        }, async () => {
            const message = await collectDirectoryFiles(dirPath.trim());
            if (server) {
                server.broadcast({
                    type: 'inject-to-input',
                    mode: 'directory',
                    message,
                });
            }
        });
        vscode.window.showInformationMessage(`已发送目录 ${dirPath} 到浏览器`);
    });

    // ===== 智能上下文收集 =====
    const sendContextCmd = vscode.commands.registerCommand('aiCodeAgent.sendContext', async () => {
        if (!server) { vscode.window.showWarningMessage('AI Agent 服务器未运行'); return; }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在收集上下文信息...',
            cancellable: false,
        }, async () => {
            const message = await collectContext();
            if (server) {
                server.broadcast({
                    type: 'inject-to-input',
                    mode: 'context',
                    message,
                });
            }
        });
        vscode.window.showInformationMessage('上下文信息已发送到浏览器');
    });

    // ===== 注册所有命令 =====
    context.subscriptions.push(
        startCmd, stopCmd, undoCmd, openLogCmd,
        sendFileCmd, sendSelectionCmd, sendErrorCmd,
        sendDirectoryCmd, sendContextCmd
    );

    // ===== 自动启动 =====
    if (vscode.workspace.getConfiguration('aiCodeAgent').get<boolean>('autoStart', true)) {
        vscode.commands.executeCommand('aiCodeAgent.startServer');
    } else {
        updateStatusBar(false);
    }
}

export function deactivate() {
    if (server) { server.stop(); }
}
