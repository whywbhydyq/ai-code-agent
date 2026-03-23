/**
 * AI Code Agent - 服务器
 * 优化：自动寻找可用端口（解决多窗口冲突）
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { parseActionsFromText, AgentAction } from './codeApplier';
import { processAction, resetBatchMode } from './diffManager';
import { HistoryManager } from './historyManager';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const MAX_BODY_SIZE = 10 * 1024 * 1024;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PORT_TRIES = 10;

interface WSClient {
  socket: import('net').Socket;
  id: string;
  alive: boolean;
  buffer: Buffer;
  fragmentBuffer: Buffer;
}
export class AgentServer {
    private httpServer: http.Server | null = null;
    private wsClients: Map<string, WSClient> = new Map();
    private basePort: number;
    private actualPort: number = 0;
    private log: vscode.OutputChannel;
public history: HistoryManager;
  private pingInterval: NodeJS.Timeout | null = null;
  public onClientCountChange: ((count: number) => void) | null = null;
    constructor(port: number, log: vscode.OutputChannel) {
        this.basePort = port;
        this.log = log;
        this.history = new HistoryManager();
    }

    /**
     * 启动服务器，返回实际使用的端口号
     * 如果 basePort 被占用，自动尝试 +1, +2, ... 直到 +MAX_PORT_TRIES
     */
    async start(): Promise<number> {
        for (let offset = 0; offset < MAX_PORT_TRIES; offset++) {
            const port = this.basePort + offset;
            try {
                await this.tryListen(port);
                this.actualPort = port;
                this.log.appendLine(`[Server] HTTP+WS 服务器启动：127.0.0.1:${port}`);
                this.pingInterval = setInterval(() => this.pingClients(), 20000);
                return port;
            } catch (err: any) {
                if (err.code === 'EADDRINUSE') {
                    this.log.appendLine(`[Server] 端口 ${port} 被占用，尝试 ${port + 1}...`);
                    continue;
                }
                throw err;
            }
        }
        throw new Error(`端口 ${this.basePort}-${this.basePort + MAX_PORT_TRIES - 1} 全部被占用`);
    }

    private tryListen(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                this.handleHttp(req, res);
            });

            server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
                if (req.url === '/ws') {
                    this.handleWSUpgrade(req, socket, head);
                } else {
                    socket.destroy();
                }
            });

            server.on('error', (err: any) => {
                reject(err);
            });

            server.listen(port, '127.0.0.1', () => {
                this.httpServer = server;
                resolve();
            });
        });
    }

    stop() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.wsClients.forEach((client) => {
            try { client.socket.destroy(); } catch (_) {}
        });
        this.wsClients.clear();
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            this.log.appendLine('[Server] 服务器已停止');
        }
    }

    // ======================================================================
    // WebSocket 握手
    // ======================================================================

    private handleWSUpgrade(
        req: http.IncomingMessage,
        socket: import('net').Socket,
        head: Buffer
    ) {
        const key = req.headers['sec-websocket-key'];
        if (!key) {
            this.log.appendLine('[WS] 握手失败：缺少 Sec-WebSocket-Key');
            socket.destroy();
            return;
        }

        const acceptKey = createHash('sha1')
            .update(key + WS_MAGIC)
            .digest('base64');

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
        );

        const id = Math.random().toString(36).slice(2);
        const client: WSClient = { socket, id, alive: true, buffer: Buffer.alloc(0), fragmentBuffer: Buffer.alloc(0) };
        this.wsClients.set(id, client);
        this.log.appendLine(`[WS] 客户端连接: ${id} (共 ${this.wsClients.size} 个)`);

        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.sendToClient(client, {
            type: 'connected',
            workspace,
            port: this.actualPort,
            version: '1.1.0',
        });

        socket.on('data', (data: Buffer) => this.handleWSData(client, data));
        socket.on('close', () => {
            this.wsClients.delete(id);
            this.log.appendLine(`[WS] 客户端断开: ${id}`);
        });
        socket.on('error', () => {
            this.wsClients.delete(id);
        });

        if (head.length > 0) {
            this.handleWSData(client, head);
        }
    }

    // ======================================================================
    // WebSocket 帧缓冲
    // ======================================================================

    private handleWSData(client: WSClient, data: Buffer) {
        client.buffer = Buffer.concat([client.buffer, data]);

        while (client.buffer.length >= 2) {
            const result = this.tryDecodeWSFrame(client.buffer);
            if (!result) break;
            client.buffer = client.buffer.slice(result.totalLength);
            this.processWSFrame(client, result.opcode, result.payload);
        }

        if (client.buffer.length > MAX_BODY_SIZE) {
            this.log.appendLine(`[WS] 客户端 ${client.id} 缓冲区溢出，断开`);
            client.socket.destroy();
            this.wsClients.delete(client.id);
        }
    }

    private tryDecodeWSFrame(
        data: Buffer
    ): { opcode: number; payload: Buffer; totalLength: number } | null {
        if (data.length < 2) return null;
        const opcode = data[0] & 0x0f;
        const masked = (data[1] & 0x80) !== 0;
        let payloadLen = data[1] & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
            if (data.length < 4) return null;
            payloadLen = data.readUInt16BE(2);
            offset = 4;
        } else if (payloadLen === 127) {
            if (data.length < 10) return null;
            payloadLen = Number(data.readBigUInt64BE(2));
            offset = 10;
        }

        const maskLen = masked ? 4 : 0;
        const totalLength = offset + maskLen + payloadLen;
        if (data.length < totalLength) return null;

        let payload: Buffer;
        if (masked) {
            const mask = data.slice(offset, offset + 4);
            offset += 4;
            payload = Buffer.alloc(payloadLen);
            for (let i = 0; i < payloadLen; i++) {
                payload[i] = data[offset + i] ^ mask[i % 4];
            }
        } else {
            payload = data.slice(offset, offset + payloadLen);
        }
        return { opcode, payload, totalLength };
    }

    private processWSFrame(client: WSClient, opcode: number, payload: Buffer) {
        if (opcode === 0x8) { client.socket.destroy(); this.wsClients.delete(client.id); return; }
        if (opcode === 0x9) { this.sendRawFrame(client.socket, Buffer.alloc(0), 0xA); return; }
        if (opcode === 0xA) { client.alive = true; return; }

        const text = payload.toString('utf8');
        let parsed: any;
        try { parsed = JSON.parse(text); } catch {
            this.log.appendLine(`[WS] 无法解析: ${text.slice(0, 100)}`);
            return;
        }
        this.handleWSCommand(client, parsed);
    }

    // ======================================================================
    // WebSocket 命令
    // ======================================================================

    private async handleWSCommand(client: WSClient, cmd: any) {
        this.log.appendLine(`[WS] 收到命令: ${cmd.type}`);

        switch (cmd.type) {
            case 'apply':
                if (cmd.actions && cmd.actions.length > 0) {
                    this.sendToClient(client, { type: 'ack', reqId: cmd.reqId, message: `正在处理 ${cmd.actions.length} 个操作` });
                    this.processActionsAsync(cmd.actions, client);
                }
                break;

            case 'apply-text': {
                const actions = parseActionsFromText(cmd.text || '');
                if (actions.length > 0) {
                    this.sendToClient(client, { type: 'ack', reqId: cmd.reqId, message: `解析到 ${actions.length} 个操作` });
                    this.processActionsAsync(actions, client);
                } else {
                    this.sendToClient(client, { type: 'ack', reqId: cmd.reqId, success: true, message: '已在 VS Code 中打开，请指定文件路径' });
                    this.handleManualCode(cmd.text || '');
                }
                break;
            }

            case 'get-status': {
                const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                this.sendToClient(client, { type: 'status', workspace: ws, port: this.actualPort, history: this.history.getRecent(10) });
                break;
            }

            case 'undo':
                await this.doUndo();
                this.sendToClient(client, { type: 'undo-done', reqId: cmd.reqId });
                break;

            case 'get-history':
                this.sendToClient(client, { type: 'history', items: this.history.getRecent(50) });
                break;

            case 'clear-history':
                this.history.clear();
                this.sendToClient(client, { type: 'history-cleared', reqId: cmd.reqId, success: true });
                break;

            case 'pong':
                client.alive = true;
                break;

            case 'get-current-file': {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    this.sendToClient(client, {
                        type: 'current-file', reqId: cmd.reqId,
                        file: vscode.workspace.asRelativePath(editor.document.uri),
                        content: editor.document.getText(),
                        language: editor.document.languageId,
                    });
                } else {
                    this.sendToClient(client, { type: 'error', reqId: cmd.reqId, message: '当前没有打开的文件' });
                }
                break;
            }

            case 'get-selection': {
                const sel = vscode.window.activeTextEditor;
                if (sel && !sel.selection.isEmpty) {
                    this.sendToClient(client, {
                        type: 'selection', reqId: cmd.reqId,
                        file: vscode.workspace.asRelativePath(sel.document.uri),
                        content: sel.document.getText(sel.selection),
                        language: sel.document.languageId,
                        startLine: sel.selection.start.line + 1,
                        endLine: sel.selection.end.line + 1,
                    });
                } else {
                    this.sendToClient(client, { type: 'error', reqId: cmd.reqId, message: '当前没有选中任何文本' });
                }
                break;
            }
        }
    }

    // ======================================================================
    // 发送工具
    // ======================================================================

    broadcast(data: any) {
        this.wsClients.forEach((client) => { this.sendToClient(client, data); });
    }

    private sendToClient(client: WSClient, data: any) {
        try {
            const payload = Buffer.from(JSON.stringify(data), 'utf8');
            this.sendRawFrame(client.socket, payload, 0x1);
        } catch (_) {}
    }

    private sendRawFrame(socket: import('net').Socket, payload: Buffer, opcode: number) {
        const len = payload.length;
        let header: Buffer;
        if (len < 126) {
            header = Buffer.alloc(2);
            header[0] = 0x80 | opcode;
            header[1] = len;
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        try { socket.write(Buffer.concat([header, payload])); } catch (_) {}
    }

    private pingClients() {
        this.wsClients.forEach((client, id) => {
            if (!client.alive) { client.socket.destroy(); this.wsClients.delete(id); return; }
            client.alive = false;
            this.sendRawFrame(client.socket, Buffer.alloc(0), 0x9);
        });
    }

    // ======================================================================
    // HTTP
    // ======================================================================

    private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const json = (data: any, code = 200) => {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        };

        if (req.method === 'GET' && req.url === '/status') {
            json({
                status: 'running',
                workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                port: this.actualPort,
                wsClients: this.wsClients.size,
                version: '1.1.0',
            });
            return;
        }

if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      let bodySize = 0;
      req.on('data', (chunk: Buffer) => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
          json({ status: 'error', message: '请求体过大' }, 413);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const data = JSON.parse(body || '{}');                    await this.routePost(req.url || '', data, json);
                } catch (err: any) {
                    json({ status: 'error', message: err.message }, 400);
                }
            });
            return;
        }

        res.writeHead(404); res.end('Not Found');
    }

    private async routePost(url: string, data: any, json: (data: any, code?: number) => void) {
        switch (url) {
            case '/apply': {
                const actions: AgentAction[] = data.actions || [];
                if (actions.length === 0) { json({ status: 'error', message: '无有效操作' }, 400); return; }
                this.processActionsAsync(actions, null);
                json({ status: 'success', message: `正在处理 ${actions.length} 个操作`, count: actions.length });
                return;
            }
            case '/apply-text': {
                const text = data.text || '';
                const actions = parseActionsFromText(text);
                if (actions.length > 0) {
                    this.processActionsAsync(actions, null);
                    json({ status: 'success', message: `解析到 ${actions.length} 个操作` });
                } else {
                    json({ status: 'success', message: '已在 VS Code 中打开，请查看 VS Code 窗口' });
                    this.handleManualCode(text);
                }
                return;
            }
            case '/restart':
                json({ status: 'success', message: '重启中...' });
                setTimeout(() => vscode.commands.executeCommand('aiCodeAgent.startServer'), 300);
                return;
            case '/undo':
                await this.doUndo();
                json({ status: 'success', message: '撤销操作已执行' });
                return;
            case '/open-log':
                vscode.commands.executeCommand('aiCodeAgent.openLog');
                json({ status: 'success' });
                return;
            case '/switch-workspace': {
                const targetPath = data.path;
                if (!targetPath) { json({ status: 'error', message: '缺少 path 参数' }, 400); return; }
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), false);
                json({ status: 'success', message: `已切换到 ${targetPath}` });
                return;
            }
            case '/get-history':
                json({ success: true, history: this.history.getRecent(50) });
                return;
            case '/clear-history':
                this.history.clear();
                json({ success: true, message: '历史已清空' });
                return;
            case '/focus':
                // 把 VS Code 窗口切到前台
                vscode.commands.executeCommand('workbench.action.focusWindow');
                json({ success: true });
                return;
            default:
                json({ status: 'error', message: '未知路由' }, 404);
        }
    }

    // ======================================================================
    // 操作处理
    // ======================================================================

    private async processActionsAsync(actions: AgentAction[], client: WSClient | null) {
        resetBatchMode();
        const results: Array<{ file: string; result: string; accepted: boolean }> = [];

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            if (client) {
                this.sendToClient(client, {
                    type: 'progress', current: i + 1, total: actions.length,
                    file: action.file, action: action.action,
                });
            }

            try {
                const result = await processAction(action, this.log);
                const accepted = result.startsWith('✅');
                results.push({ file: action.file, result, accepted });
                this.history.add({ file: action.file, action: action.action, accepted, timestamp: Date.now() });
                if (client) {
                    this.sendToClient(client, { type: 'action-result', file: action.file, result, accepted });
                }
            } catch (err: any) {
                const errMsg = `❌ ${action.file}: ${err.message}`;
                results.push({ file: action.file, result: errMsg, accepted: false });
                this.log.appendLine(`[Server] 错误: ${err.message}`);
                this.history.add({ file: action.file, action: action.action, accepted: false, timestamp: Date.now() });
                if (client) {
                    this.sendToClient(client, { type: 'action-result', file: action.file, result: errMsg, accepted: false });
                }
            }
        }

        const acceptedFiles = results.filter((r) => r.accepted).map((r) => r.file);
        const failedFiles = results.filter((r) => r.result.startsWith('❌')).map((r) => r.file);
        const skippedCount = results.length - acceptedFiles.length - failedFiles.length;

        let summary = `处理完成：✅${acceptedFiles.length} 接受`;
        if (skippedCount > 0) summary += ` ⏭️${skippedCount} 跳过`;
        if (failedFiles.length > 0) summary += ` ❌${failedFiles.length} 失败`;
        if (acceptedFiles.length > 0 && acceptedFiles.length <= 5) summary += '\n✅ ' + acceptedFiles.join(', ');
        if (failedFiles.length > 0 && failedFiles.length <= 3) summary += '\n❌ ' + failedFiles.join(', ');

        vscode.window.showInformationMessage(`AI Agent: ${summary}`);
        if (client) { this.sendToClient(client, { type: 'done', summary, results }); }
        this.broadcast({ type: 'history-updated', history: this.history.getRecent(20) });
    }

    private async doUndo() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) { vscode.window.showWarningMessage('请先打开一个工作区'); return; }
        try {
            execSync('git reset --soft HEAD~1', { cwd: workspaceRoot, encoding: 'utf-8' });
            vscode.window.showInformationMessage('AI Agent: 已撤销上一次 AI 修改');
        } catch (err: any) {
            vscode.window.showErrorMessage(`撤销失败: ${err.message}`);
        }
    }

    private async handleManualCode(code: string) {
        const filePath = await vscode.window.showInputBox({
            prompt: '请输入目标文件路径（相对于工作区）',
            placeHolder: 'src/main.py',
        });
        if (!filePath) {
            const doc = await vscode.workspace.openTextDocument({ content: code });
            await vscode.window.showTextDocument(doc);
            return;
        }
        const action: AgentAction = { action: 'write', file: filePath.trim(), content: code, patches: null };
        processAction(action, this.log);
    }
}
