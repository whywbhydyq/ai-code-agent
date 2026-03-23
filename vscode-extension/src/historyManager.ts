import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface HistoryItem {
    id: string;
    file: string;
    action: string;
    accepted: boolean;
    result?: string;
    timestamp: number;
    timeStr: string;
}

const HISTORY_FILE = path.join(os.tmpdir(), 'ai-code-agent-history.json');
const MAX_ITEMS = 200;

export class HistoryManager {
    private items: HistoryItem[] = [];

    constructor() {
        this.load();
    }

    add(item: Omit<HistoryItem, 'id' | 'timeStr'>) {
        const full: HistoryItem = {
            ...item,
            id: Math.random().toString(36).slice(2),
            timeStr: new Date(item.timestamp).toLocaleString('zh-CN'),
        };
        this.items.unshift(full);
        if (this.items.length > MAX_ITEMS) {
            this.items = this.items.slice(0, MAX_ITEMS);
        }
        this.save();
    }

    getRecent(count: number): HistoryItem[] {
        return this.items.slice(0, count);
    }

    clear() {
        this.items = [];
        this.save();
    }

    private save() {
        try {
            // 原子写入：先写临时文件再重命名，防止写入中途崩溃导致文件损坏
            const tmpFile = HISTORY_FILE + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(this.items), 'utf-8');
            fs.renameSync(tmpFile, HISTORY_FILE);
        } catch (_) {}
    }

    private load() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                // 校验是否为数组，防止文件损坏时加载脏数据
                this.items = Array.isArray(parsed) ? parsed : [];
            }
        } catch (_) {
            // 文件损坏时静默重置，不影响插件正常运行
            this.items = [];
            try { fs.unlinkSync(HISTORY_FILE); } catch (_) {}
        }
    }
}
