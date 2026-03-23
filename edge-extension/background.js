const DEFAULT_PORT = 9960;

function getServerUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['serverPort'], (r) => {
            resolve(`http://127.0.0.1:${r.serverPort || DEFAULT_PORT}`);
        });
    });
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'send-to-vscode',
        title: '📤 发送选中文本到 VS Code',
        contexts: ['selection'],
    });
    chrome.contextMenus.create({
        id: 'scan-page',
        title: '📤 扫描本页所有代码块',
        contexts: ['page'],
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'send-to-vscode' && info.selectionText) {
        const result = await sendToVSCode({ type: 'raw-text', text: info.selectionText });
        chrome.tabs.sendMessage(tab.id, {
            type: 'show-notification',
            success: result.success,
            message: result.message,
        });
    }
    if (info.menuItemId === 'scan-page') {
        chrome.tabs.sendMessage(tab.id, { type: 'scan-and-send-all' });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type === 'send-actions') {
        sendToVSCode({ type: 'actions', actions: message.actions })
            .then(sendResponse);
        return true;
    }

    if (message.type === 'send-raw-text') {
        sendToVSCode({ type: 'raw-text', text: message.text })
            .then(sendResponse);
        return true;
    }

    if (message.type === 'check-connection') {
        checkConnection().then(sendResponse);
        return true;
    }

    if (message.type === 'restart-server') {
        callVSCode('/restart', {}).then(sendResponse);
        return true;
    }

    if (message.type === 'undo-last-change') {
        callVSCode('/undo', {}).then(sendResponse);
        return true;
    }

    if (message.type === 'open-log') {
        callVSCode('/open-log', {}).then(sendResponse);
        return true;
    }

    if (message.type === 'switch-workspace') {
        callVSCode('/switch-workspace', { path: message.path }).then(sendResponse);
        return true;
    }

    if (message.type === 'update-setting') {
        chrome.storage.local.set({ [message.key]: message.value });
        sendResponse({ success: true });
        return;
    }

    if (message.type === 'get-history') {
        callVSCode('/get-history', {}).then((resp) => {
            sendResponse({ history: resp.history || [] });
        });
        return true;
    }

    if (message.type === 'clear-history') {
        callVSCode('/clear-history', {}).then(sendResponse);
        return true;
    }
});

async function sendToVSCode(payload) {
    try {
        const baseUrl = await getServerUrl();
        const endpoint = payload.type === 'raw-text' ? '/apply-text' : '/apply';
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            return { success: false, message: `服务器返回错误: ${response.status}` };
        }
        const data = await response.json();
        return { success: true, message: data.message || '已发送', data };
    } catch {
        return { success: false, message: 'VS Code 服务器未启动，请检查 VS Code 中的 AI Code Agent 扩展' };
    }
}

async function callVSCode(endpoint, body, method = 'POST') {
    try {
        const baseUrl = await getServerUrl();
        const options = method === 'GET'
            ? { method: 'GET' }
            : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        const response = await fetch(`${baseUrl}${endpoint}`, options);
        if (!response.ok) return { success: false, message: `错误: ${response.status}` };
        return await response.json();
    } catch {
        return { success: false, message: '无法连接 VS Code 服务器' };
    }
}

async function checkConnection() {
    try {
        const baseUrl = await getServerUrl();
        const response = await fetch(`${baseUrl}/status`);
        if (response.ok) {
            const data = await response.json();
            return { connected: true, workspace: data.workspace };
        }
        return { connected: false };
    } catch {
        return { connected: false };
    }
}
