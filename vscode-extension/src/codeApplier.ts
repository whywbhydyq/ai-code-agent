/**
 * Code Applier - parse + patch + lazy detection
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
// Parse
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
// JSON safe parse
// ========================================================================

function safeJsonParse(text: string): any | null {
    const trimmed = text.trim();

    try {
        return JSON.parse(trimmed);
    } catch (_) {}

    try {
        const fixed = trimmed.replace(/,\s*([\]\}])/g, '$1');
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
// Patch engine (multi-level matching)
// ========================================================================

export function applyPatches(
    originalContent: string,
    patches: PatchItem[]
): string {
    let result = originalContent;

    for (let pi = 0; pi < patches.length; pi++) {
        const patch = patches[pi];
        const patchLabel = `Patch[${pi + 1}/${patches.length}]`;

        if (patch.find !== undefined && patch.replace !== undefined) {
            result = doFindReplace(result, patch.find, patch.replace, patchLabel);
        } else if (patch.after !== undefined && patch.insert !== undefined) {
            result = doAfterInsert(result, patch.after, patch.insert, patchLabel);
        } else if (patch.before !== undefined && patch.insert !== undefined) {
            result = doBeforeInsert(result, patch.before, patch.insert, patchLabel);
        } else if (patch.delete !== undefined) {
            result = doDelete(result, patch.delete);
        }
    }

    return result;
}

// ---- find/replace with multi-level matching ----

function doFindReplace(content: string, find: string, replace: string, label: string): string {
    // Level 1: exact match
    let idx = content.indexOf(find);
    if (idx !== -1) {
        return content.substring(0, idx) + replace + content.substring(idx + find.length);
    }

    // Level 2: trim both sides then match
    const findTrimmed = find.trim();
    idx = content.indexOf(findTrimmed);
    if (idx !== -1) {
        return content.substring(0, idx) + replace + content.substring(idx + findTrimmed.length);
    }

    // Level 3: normalize whitespace (collapse spaces, trim each line)
    const normalFind = normalizeWS(find);
    const normalContent = normalizeWS(content);
    const normalIdx = normalContent.indexOf(normalFind);
    if (normalIdx !== -1) {
        // Found in normalized space, now map back to original
        const fuzzyResult = fuzzyFind(content, find);
        if (fuzzyResult.start !== -1) {
            return content.substring(0, fuzzyResult.start) + replace + content.substring(fuzzyResult.end);
        }
    }

    // Level 4: line-by-line trim match (fuzzyFind)
    const fuzzyResult = fuzzyFind(content, find);
    if (fuzzyResult.start !== -1) {
        return content.substring(0, fuzzyResult.start) + replace + content.substring(fuzzyResult.end);
    }

    // Level 5: try matching just the first and last non-empty lines as anchors
    const anchorResult = anchorFind(content, find);
    if (anchorResult.start !== -1) {
        return content.substring(0, anchorResult.start) + replace + content.substring(anchorResult.end);
    }

    // All levels failed - build helpful error message
    const findPreview = find.split('\n').slice(0, 3).join('\n');
    const bestMatch = findClosestMatch(content, find);
    let errMsg = `${label} find/replace failed.\n`;
    errMsg += `Looking for (first 3 lines):\n  ${findPreview.substring(0, 200)}\n`;
    if (bestMatch) {
        errMsg += `Closest match found at line ${bestMatch.line}:\n  ${bestMatch.text.substring(0, 200)}`;
    }
    throw new Error(errMsg);
}

function doAfterInsert(content: string, after: string, insert: string, label: string): string {
    let idx = content.indexOf(after);

    // Try trimmed
    if (idx === -1) {
        const afterTrimmed = after.trim();
        idx = content.indexOf(afterTrimmed);
        if (idx !== -1) {
            idx = idx; // use the trimmed match position
            const insertPos = idx + afterTrimmed.length;
            const nextNewline = content.indexOf('\n', insertPos);
            const actualPos = nextNewline !== -1 ? nextNewline + 1 : insertPos;
            return content.substring(0, actualPos) + insert + '\n' + content.substring(actualPos);
        }
    } else {
        const insertPos = idx + after.length;
        const nextNewline = content.indexOf('\n', insertPos);
        const actualPos = nextNewline !== -1 ? nextNewline + 1 : insertPos;
        return content.substring(0, actualPos) + insert + '\n' + content.substring(actualPos);
    }

    // Try fuzzy
    const lines = content.split('\n');
    const afterLines = after.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (afterLines.length > 0) {
        const lastAfterLine = afterLines[afterLines.length - 1];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === lastAfterLine) {
                // Check preceding lines match
                let allMatch = true;
                for (let j = afterLines.length - 2; j >= 0; j--) {
                    const targetLine = i - (afterLines.length - 1 - j);
                    if (targetLine < 0 || lines[targetLine].trim() !== afterLines[j]) {
                        allMatch = false;
                        break;
                    }
                }
                if (allMatch) {
                    const insertLineIdx = i + 1;
                    lines.splice(insertLineIdx, 0, insert);
                    return lines.join('\n');
                }
            }
        }
    }

    throw new Error(`${label} after/insert failed: anchor not found`);
}

function doBeforeInsert(content: string, before: string, insert: string, label: string): string {
    let idx = content.indexOf(before);
    if (idx === -1) {
        idx = content.indexOf(before.trim());
    }
    if (idx !== -1) {
        return content.substring(0, idx) + insert + '\n' + content.substring(idx);
    }
    throw new Error(`${label} before/insert failed: anchor not found`);
}

function doDelete(content: string, target: string): string {
    let idx = content.indexOf(target);
    if (idx === -1) {
        idx = content.indexOf(target.trim());
    }
    if (idx !== -1) {
        let endIdx = idx + (idx === content.indexOf(target) ? target.length : target.trim().length);
        if (content[endIdx] === '\n') endIdx++;
        return content.substring(0, idx) + content.substring(endIdx);
    }
    return content; // silently skip if not found
}

// ========================================================================
// Fuzzy find (line-by-line trim match, precomputed offsets)
// ========================================================================

interface FuzzyResult {
    start: number;
    end: number;
}

function normalizeWS(s: string): string {
    return s.split('\n').map(l => l.trim()).join('\n').replace(/\s+/g, ' ').trim();
}

function fuzzyFind(haystack: string, needle: string): FuzzyResult {
    const needleLines = needle.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (needleLines.length === 0) return { start: -1, end: -1 };

    const haystackLines = haystack.split('\n');

    // Precompute line offsets
    const lineOffsets: number[] = new Array(haystackLines.length + 1);
    lineOffsets[0] = 0;
    for (let k = 0; k < haystackLines.length; k++) {
        lineOffsets[k + 1] = lineOffsets[k] + haystackLines[k].length + 1;
    }

    for (let i = 0; i < haystackLines.length; i++) {
        if (haystackLines[i].trim() !== needleLines[0]) continue;
        if (i + needleLines.length > haystackLines.length) continue;

        let allMatch = true;
        for (let j = 1; j < needleLines.length; j++) {
            if (haystackLines[i + j].trim() !== needleLines[j]) {
                allMatch = false;
                break;
            }
        }
        if (allMatch) {
            return {
                start: lineOffsets[i],
                end: lineOffsets[i + needleLines.length],
            };
        }
    }

    return { start: -1, end: -1 };
}

// Anchor find: match using only the first and last non-empty lines of find
function anchorFind(haystack: string, needle: string): FuzzyResult {
    const needleLines = needle.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (needleLines.length < 2) return { start: -1, end: -1 };

    const firstLine = needleLines[0];
    const lastLine = needleLines[needleLines.length - 1];
    const expectedSpan = needleLines.length;

    const haystackLines = haystack.split('\n');
    const lineOffsets: number[] = new Array(haystackLines.length + 1);
    lineOffsets[0] = 0;
    for (let k = 0; k < haystackLines.length; k++) {
        lineOffsets[k + 1] = lineOffsets[k] + haystackLines[k].length + 1;
    }

    for (let i = 0; i < haystackLines.length; i++) {
        if (haystackLines[i].trim() !== firstLine) continue;

        // Look for lastLine within a reasonable range
        const searchEnd = Math.min(i + expectedSpan + 5, haystackLines.length);
        for (let j = i + 1; j < searchEnd; j++) {
            if (haystackLines[j].trim() === lastLine) {
                return {
                    start: lineOffsets[i],
                    end: lineOffsets[j + 1],
                };
            }
        }
    }

    return { start: -1, end: -1 };
}

// Find the closest matching line for error reporting
function findClosestMatch(haystack: string, needle: string): { line: number; text: string } | null {
    const needleLines = needle.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (needleLines.length === 0) return null;

    const firstNeedleLine = needleLines[0];
    const haystackLines = haystack.split('\n');

    let bestScore = 0;
    let bestLine = -1;
    let bestText = '';

    for (let i = 0; i < haystackLines.length; i++) {
        const trimmed = haystackLines[i].trim();
        if (trimmed.length === 0) continue;

        const score = similarity(trimmed, firstNeedleLine);
        if (score > bestScore) {
            bestScore = score;
            bestLine = i + 1;
            bestText = haystackLines.slice(i, Math.min(i + 3, haystackLines.length)).join('\n');
        }
    }

    if (bestScore > 0.4) {
        return { line: bestLine, text: bestText };
    }
    return null;
}

// Simple similarity score (0-1) based on common substrings
function similarity(a: string, b: string): number {
    if (a === b) return 1;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (shorter.length === 0) return 0;

    let matches = 0;
    const words = shorter.split(/\s+/);
    for (const word of words) {
        if (word.length > 2 && longer.includes(word)) matches++;
    }
    return words.length > 0 ? matches / words.length : 0;
}

// ========================================================================
// Lazy output detection (line-anchored, no false positives)
// ========================================================================

export function detectLazyOutput(content: string): string[] {
    const warnings: string[] = [];
    const lines = content.split('\n');
    let lazyCount = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\/\/\s*\.{3}\s*(existing|rest|remaining|其余|省略|原有|不变)/i.test(trimmed)) {
            lazyCount++;
        } else if (/^#\s*\.{3}\s*(existing|rest|remaining|其余|省略|原有|不变)/i.test(trimmed)) {
            lazyCount++;
        } else if (/^\/\*\s*\.{3}\s*(existing|rest|remaining|其余|省略|原有|不变)/i.test(trimmed)) {
            lazyCount++;
        } else if (/^\/\/\s*(same|unchanged|omitted|keep|skip)\s*$/i.test(trimmed)) {
            lazyCount++;
        } else if (/^\.{3}\s*(此处|这里|此部分|上述|以下|其他|前面|后面)\s*(省略|不变|保持|跳过|同上)/i.test(trimmed)) {
            lazyCount++;
        }
    }

    if (lazyCount > 0) {
        warnings.push(`detected ${lazyCount} lazy-output markers`);
    }

    return warnings;
}
