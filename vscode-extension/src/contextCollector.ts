/**
 * 智能上下文收集器 + 批量文件发送
 *
 * collectContext()  - 一键收集当前文件、诊断错误、项目配置、终端输出、CLAUDE.md
 * collectDirectoryFiles() - 扫描指定目录下所有代码文件并打包
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getClaudeMd } from './claudeMd';

const CONFIG_FILES = [
    'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
    'webpack.config.js', 'next.config.js', 'next.config.mjs',
    '.eslintrc.json', '.eslintrc.js', 'eslint.config.js',
    'pyproject.toml', 'setup.py', 'requirements.txt',
    'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
];

const EXCLUDE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next',
    '__pycache__', '.venv', 'venv', 'coverage', '.cache',
    '.idea', '.vscode', 'target', 'bin', 'obj',
]);

const EXCLUDE_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
    '.mp4', '.mp3', '.wav', '.zip', '.tar', '.gz', '.7z',
    '.exe', '.dll', '.so', '.wasm', '.map', '.min.js',
    '.lock', '.vsix', '.pdf', '.docx', '.xlsx',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.pyc', '.class', '.o', '.a',
]);

// ========================================================================
// 智能上下文收集
// ========================================================================

export async function collectContext(): Promise<string> {
    const parts: string[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const editor = vscode.window.activeTextEditor;

    // 1. CLAUDE.md
    const claudeMd = getClaudeMd();
    if (claudeMd) {
        parts.push(`## 项目说明 (CLAUDE.md)\n\n${claudeMd}`);
    }

    // 2. 当前文件
    if (editor) {
        const relPath = vscode.workspace.asRelativePath(editor.document.uri);
        const lang = editor.document.languageId;
        const content = editor.document.getText();
        parts.push(
            `## 当前文件: ${relPath}\n\n` +
            '```' + lang + '\n' + content + '\n```'
        );
    }

    // 3. 诊断错误（lint / type errors）
    const diagnostics: string[] = [];
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        const relPath = vscode.workspace.asRelativePath(uri);
        for (const d of diags) {
            if (d.severity <= vscode.DiagnosticSeverity.Warning) {
                const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
                diagnostics.push(`  [${sev}] ${relPath}:${d.range.start.line + 1} - ${d.message}`);
            }
        }
    }
    if (diagnostics.length > 0) {
        const limited = diagnostics.slice(0, 50);
        parts.push(`## 诊断错误 (${diagnostics.length} 个)\n\n${limited.join('\n')}`);
        if (diagnostics.length > 50) {
            parts.push(`（仅显示前 50 个，共 ${diagnostics.length} 个）`);
        }
    }

    // 4. 配置文件
    const configs: string[] = [];
    for (const name of CONFIG_FILES) {
        const fp = path.join(workspaceRoot, name);
        if (fs.existsSync(fp)) {
            try {
                const content = fs.readFileSync(fp, 'utf-8');
                if (content.length < 10000) {
                    const ext = path.extname(name).replace('.', '') || 'text';
                    configs.push(`### ${name}\n` + '```' + ext + '\n' + content + '\n```');
                }
            } catch (_) {}
        }
    }
    if (configs.length > 0) {
        parts.push(`## 项目配置\n\n${configs.join('\n\n')}`);
    }

    // 5. 剪贴板内容（可能是终端输出）
    try {
        const clip = await vscode.env.clipboard.readText();
        if (clip && clip.length > 20 && clip.length < 50000) {
            const use = await vscode.window.showQuickPick(
                ['是，包含剪贴板内容', '否，跳过'],
                { placeHolder: `剪贴板有 ${clip.length} 字符，是否作为终端/错误输出一起发送？` }
            );
            if (use && use.startsWith('是')) {
                parts.push('## 终端/错误输出（来自剪贴板）\n\n```\n' + clip + '\n```');
            }
        }
    } catch (_) {}

    if (parts.length === 0) {
        return '（未收集到任何上下文信息）';
    }

    return parts.join('\n\n---\n\n');
}

// ========================================================================
// 批量文件发送
// ========================================================================

export async function collectDirectoryFiles(dirRelPath: string): Promise<string> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return '（请先打开工作区）';

    const dirPath = path.resolve(workspaceRoot, dirRelPath);
    if (!dirPath.startsWith(workspaceRoot)) return '（路径越界）';
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return `（目录不存在: ${dirRelPath}）`;
    }

    const files: { relPath: string; content: string; lang: string }[] = [];
    const claudeMd = getClaudeMd();

    scanDir(dirPath, workspaceRoot, files);

    if (files.length === 0) return `（目录 ${dirRelPath} 中没有找到代码文件）`;

    const parts: string[] = [];

    if (claudeMd) {
        parts.push(`## 项目说明 (CLAUDE.md)\n\n${claudeMd}`);
    }

    parts.push(`## 目录: ${dirRelPath} (${files.length} 个文件)`);

    // 文件列表索引
    const index = files.map((f, i) => `  ${i + 1}. ${f.relPath}`).join('\n');
    parts.push(`文件列表:\n${index}`);

    // 每个文件的完整内容
    for (const f of files) {
        parts.push(`### ${f.relPath}\n` + '```' + f.lang + '\n' + f.content + '\n```');
    }

    return parts.join('\n\n');
}

// ========================================================================
// 内部工具函数
// ========================================================================

function scanDir(
    dirPath: string,
    workspaceRoot: string,
    result: { relPath: string; content: string; lang: string }[],
    maxFiles = 30,
    maxFileSize = 100 * 1024
) {
    if (result.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (_) { return; }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (result.length >= maxFiles) break;
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                scanDir(fullPath, workspaceRoot, result, maxFiles, maxFileSize);
            }
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (EXCLUDE_EXTS.has(ext)) continue;

            try {
                const rawBuf = fs.readFileSync(fullPath);
                if (rawBuf.length > maxFileSize || rawBuf.length === 0) continue;

                // 二进制检测：前 512 字节中有空字节则跳过
                const sample = rawBuf.slice(0, 512);
                let isBinary = false;
                for (let i = 0; i < sample.length; i++) {
                    if (sample[i] === 0) { isBinary = true; break; }
                }
                if (isBinary) continue;

                const content = rawBuf.toString('utf-8');
                const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
                const lang = extToLang(ext);
                result.push({ relPath, content, lang });
            } catch (_) {}
        }
    }
}

function extToLang(ext: string): string {
    const map: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
        '.py': 'python', '.java': 'java', '.go': 'go', '.rs': 'rust',
        '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
        '.cs': 'csharp', '.rb': 'ruby', '.php': 'php',
        '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
        '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
        '.md': 'markdown', '.sql': 'sql', '.sh': 'bash',
        '.xml': 'xml', '.toml': 'toml', '.vue': 'vue',
        '.svelte': 'svelte', '.swift': 'swift', '.kt': 'kotlin',
        '.bat': 'batch', '.ps1': 'powershell', '.r': 'r',
    };
    return map[ext] || ext.replace('.', '') || 'text';
}
