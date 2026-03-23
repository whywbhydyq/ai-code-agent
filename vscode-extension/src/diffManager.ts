/**
 * Diff 预览管理器
 *
 * 优化：
 * - 新增「全部接受」选项，批量操作时不用逐个确认
 * - 敏感文件正则精确匹配
 * - 新建文件时自动创建目录
 * - [新增] 启动时自动清理超过1小时的旧临时文件
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
    AgentAction,
    applyPatches,
    detectLazyOutput,
} from './codeApplier';

const TEMP_DIR = path.join(os.tmpdir(), 'ai-code-agent-diff');

// [优化] 模块加载时清理超过1小时的旧临时文件，防止磁盘泄漏
(function cleanupOldTempFiles() {
    try {
        if (!fs.existsSync(TEMP_DIR)) return;
        const now = Date.now();
        for (const file of fs.readdirSync(TEMP_DIR)) {
            try {
                const fp = path.join(TEMP_DIR, file);
                if (now - fs.statSync(fp).mtimeMs > 3_600_000) {
                    fs.unlinkSync(fp);
                }
            } catch (_) {}
        }
    } catch (_) {}
})();

let acceptAllMode = false;
let rejectAllMode = false;

export function resetBatchMode() {
    acceptAllMode = false;
    rejectAllMode = false;
}

/**
 * 处理单个 Action，返回结果字符串
 */
export async function processAction(
    action: AgentAction,
    log: vscode.OutputChannel
): Promise<string> {
    const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('请先打开一个工作区文件夹');
    }

    const fullPath = path.resolve(workspaceRoot, action.file);
    if (!fullPath.startsWith(workspaceRoot)) {
        throw new Error(`安全拦截：路径越界 → ${action.file}`);
    }

    const dangerousPatterns: Array<{ pattern: RegExp; desc: string }> = [
        { pattern: /(?:^|[\/\\])\.env(?:\.|$)/i, desc: '.env 文件' },
        { pattern: /(?:^|[\/\\])\.git[\/\\]/i, desc: '.git 目录' },
        { pattern: /(?:^|[\/\\])node_modules[\/\\]/i, desc: 'node_modules 目录' },
        { pattern: /(?:^|[\/\\])\.ssh[\/\\]/i, desc: '.ssh 目录' },
        { pattern: /(?:^|[\/\\])id_rsa/i, desc: 'SSH 私钥' },
    ];

    for (const { pattern, desc } of dangerousPatterns) {
        if (pattern.test(action.file)) {
            throw new Error(`安全拦截：禁止修改${desc} → ${action.file}`);
        }
    }

    log.appendLine(`[DiffManager] Processing: ${action.action} → ${action.file}`);

    if (action.action === 'delete') {
        if (!fs.existsSync(fullPath)) {
            return `⏭ ${action.file}: 文件不存在，跳过删除`;
        }

        if (!acceptAllMode) {
            const confirm = await vscode.window.showWarningMessage(
                `确认删除文件 ${action.file}？`,
                { modal: true },
                '🗑 确认删除',
                '取消'
            );
            if (confirm !== '🗑 确认删除') {
                return `⏭ ${action.file}: 用户取消删除`;
            }
        }

        gitSnapshot(workspaceRoot, `删除 ${action.file} 之前的快照`);
        fs.unlinkSync(fullPath);
        log.appendLine(`[DiffManager] Deleted: ${action.file}`);
        return `✅ ${action.file}: 已删除`;
    }

    let originalContent = '';
    const fileExists = fs.existsSync(fullPath);
    if (fileExists) {
        originalContent = fs.readFileSync(fullPath, 'utf-8');
    }

    let newContent: string;
    if (action.action === 'patch' && action.patches) {
        if (!fileExists) {
            throw new Error(`Patch 失败：文件 ${action.file} 不存在`);
        }
        newContent = applyPatches(originalContent, action.patches);
    } else {
        newContent = action.content;
    }

    const lazyWarnings = detectLazyOutput(newContent);
    if (lazyWarnings.length > 0 && !acceptAllMode) {
        const warningMsg = lazyWarnings.join('\n');
        const choice = await vscode.window.showWarningMessage(
            `⚠ AI 输出中包含省略标记：\n${warningMsg}\n\n直接应用可能导致代码丢失。`,
            { modal: true },
            '仍然应用（我知道风险）',
            '放弃'
        );
        if (choice !== '仍然应用（我知道风险）') {
            return `⏭ ${action.file}: 检测到省略标记，用户放弃`;
        }
    }

    if (originalContent === newContent) {
        return `⏭ ${action.file}: 内容无变化`;
    }

    if (rejectAllMode) {
        return `⏭ ${action.file}: 用户选择全部拒绝`;
    }

    const requireConfirmation = vscode.workspace
        .getConfiguration('aiCodeAgent')
        .get<boolean>('requireConfirmation', true);

    if (requireConfirmation && !acceptAllMode) {
        const accepted = await showDiffAndConfirm(
            fullPath,
            action.file,
            originalContent,
            newContent,
            fileExists
        );

        if (accepted === 'reject') {
            return `⏭ ${action.file}: 用户拒绝`;
        }
        if (accepted === 'accept-all') {
            acceptAllMode = true;
        }
        if (accepted === 'reject-all') {
            rejectAllMode = true;
            return `⏭ ${action.file}: 用户选择全部拒绝`;
        }
    }

    const autoGit = vscode.workspace
        .getConfiguration('aiCodeAgent')
        .get<boolean>('autoGitSnapshot', true);
    if (autoGit) {
        gitSnapshot(workspaceRoot, `修改 ${action.file} 之前`);
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, newContent, 'utf-8');
    log.appendLine(`[DiffManager] Written: ${action.file}`);

    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    return `✅ ${action.file}: 已应用`;
}

// ========================================================================
// Diff 预览
// ========================================================================

type DiffChoice = 'accept' | 'accept-all' | 'reject' | 'reject-all';

async function showDiffAndConfirm(
    fullPath: string,
    relativePath: string,
    originalContent: string,
    newContent: string,
    fileExists: boolean
): Promise<DiffChoice> {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    const baseName = path.basename(relativePath);
    const originalTempPath = path.join(TEMP_DIR, `original_${timestamp}_${baseName}`);
    const newTempPath = path.join(TEMP_DIR, `modified_${timestamp}_${baseName}`);

    fs.writeFileSync(originalTempPath, originalContent, 'utf-8');
    fs.writeFileSync(newTempPath, newContent, 'utf-8');

    const originalUri = vscode.Uri.file(originalTempPath);
    const newUri = vscode.Uri.file(newTempPath);

    const title = fileExists
        ? `AI 修改预览: ${relativePath} (当前 ↔ AI 建议)`
        : `AI 新建文件: ${relativePath}`;

    await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, title);

    const choice = await vscode.window.showInformationMessage(
        `是否接受 AI 对 "${relativePath}" 的修改？\n` +
        `${fileExists ? '（将覆盖现有文件）' : '（将创建新文件）'}`,
        { modal: false },
        '✅ 接受',
        '✅ 全部接受',
        '❌ 拒绝',
        '❌ 全部拒绝'
    );

    cleanup();

    switch (choice) {
        case '✅ 接受':     return 'accept';
        case '✅ 全部接受': return 'accept-all';
        case '❌ 全部拒绝': return 'reject-all';
        default:             return 'reject';
    }

    function cleanup() {
        try { fs.unlinkSync(originalTempPath); } catch (_) {}
        try { fs.unlinkSync(newTempPath); } catch (_) {}
    }
}

// ========================================================================
// Git 快照
// ========================================================================

function gitSnapshot(workspaceRoot: string, message: string) {
    try {
        execSync('git rev-parse --is-inside-work-tree', {
            cwd: workspaceRoot,
            stdio: 'ignore',
        });
        execSync('git add -A', {
            cwd: workspaceRoot,
            stdio: 'ignore',
        });
        execSync(
            `git commit -m "AI-Agent: ${message}" --allow-empty --no-verify`,
            {
                cwd: workspaceRoot,
                stdio: 'ignore',
            }
        );
    } catch (_) {
    }
}
