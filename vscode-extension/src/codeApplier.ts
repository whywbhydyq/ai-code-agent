/**
 * 代码操作解析与应用引擎
 *
 * 职责：
 * 1. 从原始文本中提取 agent-action JSON
 * 2. 执行 patch（查找替换）操作
 * 3. 检测 AI "偷懒"输出
 */

export interface PatchItem {
    find?: string;
    replace?: string;
    after?: string;
    before?: string;
    insert?: string;
    delete?: string;
}

export interface AgentAction {
    action: 'write' | 'create' | 'update' | 'patch' | 'delete';
    file: string;
    content: string;
    patches: PatchItem[] | null;
}

// ========================================================================
// 解析
// ========================================================================

export function parseActionsFromText(text: string): AgentAction[] {
    const actions: AgentAction[] = [];

    const agentRegex =
        /```(?:agent-action|agent_action)\s*\n([\s\S]*?)\n\s*```/gi;
    let match: RegExpExecArray | null;

    while ((match = agentRegex.exec(text)) !== null) {
        const parsed = safeJsonParse(match[1]);
        if (parsed && isValidAction(parsed)) {
            actions.push(normalizeAction(parsed));
        }
    }

    if (actions.length > 0) return actions;

    const jsonRegex = /```json\s*\n([\s\S]*?)\n\s*```/gi;
    while ((match = jsonRegex.exec(text)) !== null) {
        const parsed = safeJsonParse(match[1]);
        if (parsed && isValidAction(parsed)) {
            actions.push(normalizeAction(parsed));
        }
    }

    if (actions.length > 0) return actions;

    const anyRegex = /```\w*\s*\n([\s\S]*?)\n\s*```/gi;
    while ((match = anyRegex.exec(text)) !== null) {
        const parsed = safeJsonParse(match[1]);
        if (parsed && isValidAction(parsed)) {
            actions.push(normalizeAction(parsed));
        }
    }

    if (actions.length > 0) return actions;

    const parsed = safeJsonParse(text);
    if (parsed && isValidAction(parsed)) {
        actions.push(normalizeAction(parsed));
    }

    if (parsed && Array.isArray(parsed)) {
        for (const item of parsed) {
            if (isValidAction(item)) {
                actions.push(normalizeAction(item));
            }
        }
    }

    return actions;
}

// ========================================================================
// JSON 解析
// ========================================================================

function safeJsonParse(text: string): any | null {
    const trimmed = text.trim();

    try {
        return JSON.parse(trimmed);
    } catch (_) {}

    try {
        const fixed = trimmed.replace(/,\s*([\]}])/g, '$1');
        return JSON.parse(fixed);
    } catch (_) {}

    try {
        const fixed = trimmed.replace(/'/g, '"');
        return JSON.parse(fixed);
    } catch (_) {}

    try {
        const objMatch = trimmed.match(/(\{[\s\S]*\})/);
        if (objMatch) {
            return JSON.parse(objMatch[1]);
        }
    } catch (_) {}

    return null;
}

function isValidAction(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.action) return false;
    if (!obj.file && !obj.file_path && !obj.filePath) return false;
    const validActions = ['write', 'create', 'update', 'patch', 'delete'];
    return validActions.includes(obj.action.toLowerCase());
}

function normalizeAction(obj: any): AgentAction {
    const action = obj.action.toLowerCase();
    return {
        action: action as AgentAction['action'],
        file: obj.file || obj.file_path || obj.filePath || '',
        content: obj.content || '',
        patches: obj.patches || null,
    };
}

// ========================================================================
// Patch 应用
// ========================================================================

export function applyPatches(
    originalContent: string,
    patches: PatchItem[]
): string {
    let result = originalContent;

    for (const patch of patches) {
        if (patch.find !== undefined && patch.replace !== undefined) {
            const idx = result.indexOf(patch.find);
            if (idx !== -1) {
                result =
                    result.substring(0, idx) +
                    patch.replace +
                    result.substring(idx + patch.find.length);
            } else {
                const fuzzyIdx = fuzzyFind(result, patch.find);
                if (fuzzyIdx.start !== -1) {
                    result =
                        result.substring(0, fuzzyIdx.start) +
                        patch.replace +
                        result.substring(fuzzyIdx.end);
                } else {
                    throw new Error(
                        `Patch 失败：找不到要替换的代码段\n查找: "${patch.find.substring(0, 80)}..."`
                    );
                }
            }
        } else if (patch.after !== undefined && patch.insert !== undefined) {
            const idx = result.indexOf(patch.after);
            if (idx !== -1) {
                const insertPos = idx + patch.after.length;
                const nextNewline = result.indexOf('\n', insertPos);
                const actualPos =
                    nextNewline !== -1 ? nextNewline + 1 : insertPos;
                result =
                    result.substring(0, actualPos) +
                    patch.insert +
                    '\n' +
                    result.substring(actualPos);
            } else {
                throw new Error(
                    `Patch 失败：找不到插入锚点\n查找: "${patch.after.substring(0, 80)}..."`
                );
            }
        } else if (patch.before !== undefined && patch.insert !== undefined) {
            const idx = result.indexOf(patch.before);
            if (idx !== -1) {
                result =
                    result.substring(0, idx) +
                    patch.insert +
                    '\n' +
                    result.substring(idx);
            } else {
                throw new Error(
                    `Patch 失败：找不到插入锚点\n查找: "${patch.before.substring(0, 80)}..."`
                );
            }
        } else if (patch.delete !== undefined) {
            const idx = result.indexOf(patch.delete);
            if (idx !== -1) {
                let endIdx = idx + patch.delete.length;
                if (result[endIdx] === '\n') endIdx++;
                result = result.substring(0, idx) + result.substring(endIdx);
            }
        }
    }

    return result;
}

// ========================================================================
// 模糊查找
// ========================================================================

interface FuzzyResult {
    start: number;
    end: number;
}

function fuzzyFind(haystack: string, needle: string): FuzzyResult {
    const normalize = (s: string) =>
        s
            .split('\n')
            .map((line) => line.trim())
            .join('\n')
            .replace(/\s+/g, ' ')
            .trim();

    const normalizedNeedle = normalize(needle);
    const normalizedHaystack = normalize(haystack);

    const pos = normalizedHaystack.indexOf(normalizedNeedle);
    if (pos === -1) {
        return { start: -1, end: -1 };
    }

    let origStart = -1;
    let origEnd = -1;

    const needleLines = needle
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const haystackLines = haystack.split('\n');

    for (let i = 0; i < haystackLines.length; i++) {
        if (haystackLines[i].trim() === needleLines[0]) {
            let allMatch = true;
            for (let j = 1; j < needleLines.length; j++) {
                if (
                    i + j >= haystackLines.length ||
                    haystackLines[i + j].trim() !== needleLines[j]
                ) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                origStart = haystackLines
                    .slice(0, i)
                    .reduce((sum, l) => sum + l.length + 1, 0);
                const endLine = i + needleLines.length - 1;
                origEnd = haystackLines
                    .slice(0, endLine + 1)
                    .reduce((sum, l) => sum + l.length + 1, 0);
                return { start: origStart, end: origEnd };
            }
        }
    }

    return { start: -1, end: -1 };
}

// ========================================================================
// 偷懒检测
// ========================================================================

export function detectLazyOutput(content: string): string[] {
    const warnings: string[] = [];

    const lazyPatterns: Array<{ regex: RegExp; desc: string }> = [
        {
            regex: /\/\/\s*\.{3}\s*(existing|rest|remaining|其余|省略|原有|不变)/gi,
            desc: '// ... existing code ...',
        },
        {
            regex: /#\s*\.{3}\s*(existing|rest|remaining|其余|省略|原有|不变)/gi,
            desc: '# ... existing code ...',
        },
        {
            regex: /\/\*\s*\.{3}\s*(existing|rest|remaining|其余|省略|原有|不变)[\s\S]*?\*\//gi,
            desc: '/* ... existing code ... */',
        },
        {
            regex: /\.{3}\s*(此处|这里|此部分|上述|以下|其他|前面|后面)\s*(省略|不变|保持|跳过|同上)/gi,
            desc: '...省略...',
        },
        {
            regex: /\/\/\s*(same|unchanged|omitted|keep|skip)/gi,
            desc: '// same/unchanged',
        },
    ];

    for (const pattern of lazyPatterns) {
        const matches = content.match(pattern.regex);
        if (matches && matches.length > 0) {
            warnings.push(
                `检测到 ${matches.length} 处省略标记：${pattern.desc}`
            );
        }
    }

    return warnings;
}
