/**
 * CLAUDE.md 项目说明管理器
 *
 * 读取项目根目录的 CLAUDE.md，发送代码时自动附加。
 * 支持文件变化监听，修改后自动更新缓存。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let cachedContent: string | null = null;
let watcher: vscode.FileSystemWatcher | null = null;

const CLAUDE_MD_FILES = ['CLAUDE.md', 'claude.md', '.claude.md'];

export function initClaudeMd(context: vscode.ExtensionContext): void {
    reload();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, '{CLAUDE,claude,.claude}.md')
        );
        watcher.onDidChange(() => reload());
        watcher.onDidCreate(() => reload());
        watcher.onDidDelete(() => { cachedContent = null; });
        context.subscriptions.push(watcher);
    }
}

export function reload(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { cachedContent = null; return; }

    for (const name of CLAUDE_MD_FILES) {
        const fp = path.join(workspaceRoot, name);
        if (fs.existsSync(fp)) {
            try {
                cachedContent = fs.readFileSync(fp, 'utf-8');
                return;
            } catch (_) {}
        }
    }
    cachedContent = null;
}

export function getClaudeMd(): string | null {
    return cachedContent;
}

export function hasClaudeMd(): boolean {
    return cachedContent !== null && cachedContent.length > 0;
}

/**
 * 将 CLAUDE.md 内容包装成上下文前缀，附加到消息前面
 */
export function wrapWithClaudeMd(message: string): string {
    if (!cachedContent) return message;
    return `## 项目说明 (CLAUDE.md)\n\n${cachedContent}\n\n---\n\n${message}`;
}
