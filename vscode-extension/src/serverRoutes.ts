/**
 * 新增路由：上下文收集、目录发送、/focus 修复
 * 独立模块，避免大量修改 server.ts
 */
import * as vscode from 'vscode';
import { getClaudeMd } from './claudeMd';
import { collectDirectoryFiles } from './contextCollector';

export async function handleNewRoutes(
    url: string,
    data: any,
    json: (data: any, code?: number) => void
): Promise<boolean> {
    switch (url) {
        case '/collect-context': {
            const parts: string[] = [];
            const md = getClaudeMd();
            if (md) {
                parts.push('## 项目说明 (CLAUDE.md)\n\n' + md);
            }
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const relPath = vscode.workspace.asRelativePath(editor.document.uri);
                const lang = editor.document.languageId;
                const content = editor.document.getText();
                parts.push('## 当前文件: ' + relPath + '\n\n```' + lang + '\n' + content + '\n```');
            }
            const diagList: string[] = [];
            for (const [uri, ds] of vscode.languages.getDiagnostics()) {
                const rp = vscode.workspace.asRelativePath(uri);
                for (const d of ds) {
                    if (d.severity <= vscode.DiagnosticSeverity.Warning) {
                        const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
                        diagList.push('  [' + sev + '] ' + rp + ':' + (d.range.start.line + 1) + ' - ' + d.message);
                    }
                }
            }
            if (diagList.length > 0) {
                parts.push('## 诊断错误 (' + diagList.length + ' 个)\n\n' + diagList.slice(0, 50).join('\n'));
            }
            json({ success: true, text: parts.join('\n\n---\n\n') });
            return true;
        }
        case '/send-directory': {
            const dirPath = data.path;
            if (!dirPath) {
                json({ success: false, message: '缺少 path 参数' });
                return true;
            }
            try {
                const text = await collectDirectoryFiles(dirPath);
                const fileCount = (text.match(/^### /gm) || []).length;
                json({ success: true, text, fileCount });
            } catch (err: any) {
                json({ success: false, message: err.message });
            }
            return true;
        }
        case '/focus': {
            // 修复：多重手段确保 VS Code 窗口前置
            try {
                await vscode.commands.executeCommand('workbench.action.focusWindow');
            } catch (_) {}
            try {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
                }
            } catch (_) {}
            try {
                const { exec } = require('child_process');
                exec('code --reuse-window');
            } catch (_) {}
            json({ success: true });
            return true;
        }
        default:
            return false;
    }
}
