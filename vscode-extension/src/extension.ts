import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { AgentServer } from './server';

let server: AgentServer | null = null;
let outputChannel: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('AI Code Agent');
    outputChannel.appendLine('[AI Code Agent] 扩展已激活');

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

    const startCmd = vscode.commands.registerCommand('aiCodeAgent.startServer', async () => {
        if (server) { server.stop(); server = null; }

        const basePort = vscode.workspace.getConfiguration('aiCodeAgent').get<number>('port', 9960);
        server = new AgentServer(basePort, outputChannel);

        try {
            const actualPort = await server.start();
            updateStatusBar(true, actualPort, 0);

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

    const stopCmd = vscode.commands.registerCommand('aiCodeAgent.stopServer', () => {
        if (server) { server.stop(); server = null; }
        updateStatusBar(false);
        vscode.window.showInformationMessage('AI Code Agent 已停止');
    });

    const undoCmd = vscode.commands.registerCommand('aiCodeAgent.undoLastChange', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { vscode.window.showWarningMessage('请先打开一个工作区'); return; }
        try {
            const log = execSync('git log --oneline -5 --grep="AI-Agent"', { cwd: root, encoding: 'utf-8' }).trim();
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

    const openLogCmd = vscode.commands.registerCommand('aiCodeAgent.openLog', () => {
        outputChannel.show(true);
    });

    const sendFileCmd = vscode.commands.registerCommand('aiCodeAgent.sendCurrentFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('请先打开一个文件'); return; }
        if (!server) { vscode.window.showWarningMessage('AI Agent 服务器未运行'); return; }

        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const content = editor.document.getText();
        const language = editor.document.languageId;

        server.broadcast({
            type: 'inject-to-input',
            mode: 'file',
            file,
            content,
            language,
            message: `以下是当前文件 \`${file}\` 的完整内容：\n\`\`\`${language}\n${content}\n\`\`\`\n`,
        });
        vscode.window.showInformationMessage(`已发送文件 ${file} 到浏览器`);
    });

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

        server.broadcast({
            type: 'inject-to-input',
            mode: 'selection',
            file,
            content,
            language,
            startLine,
            endLine,
            message: `以下是 \`${file}\` 第 ${startLine}-${endLine} 行的代码：\n\`\`\`${language}\n${content}\n\`\`\`\n`,
        });
        vscode.window.showInformationMessage(`已发送选中代码（${endLine - startLine + 1} 行）到浏览器`);
    });

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

        server.broadcast({
            type: 'inject-to-input',
            mode: 'error',
            file,
            errorText,
            message: `运行 \`${file}\` 时出现以下错误，请帮我修复：\n\`\`\`\n${errorText}\n\`\`\`\n`,
        });
        vscode.window.showInformationMessage('错误信息已发送到浏览器');
    });

    context.subscriptions.push(
        startCmd, stopCmd, undoCmd, openLogCmd,
        sendFileCmd, sendSelectionCmd, sendErrorCmd
    );

    if (vscode.workspace.getConfiguration('aiCodeAgent').get<boolean>('autoStart', true)) {
        vscode.commands.executeCommand('aiCodeAgent.startServer');
    } else {
        updateStatusBar(false);
    }
}

export function deactivate() {
    if (server) { server.stop(); }
}
