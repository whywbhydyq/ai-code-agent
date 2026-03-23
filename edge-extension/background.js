var DEFAULT_PORT = 9960;
var MAX_PORT_SCAN = 10;
var cachedServerUrl = null;
var cacheExpiry = 0;

// 自动探测可用端口（从配置端口开始扫描）
async function findServerUrl() {
 if (cachedServerUrl && Date.now() < cacheExpiry) {
  try {
   var resp = await fetch(cachedServerUrl + '/status', { signal: AbortSignal.timeout(300) });
   if (resp.ok) return cachedServerUrl;
  } catch (_) {}
  cachedServerUrl = null;
 }
 return new Promise(function(resolve) {
  chrome.storage.local.get(['serverPort'], async function(r) {            var basePort = r.serverPort || DEFAULT_PORT;

            for (var i = 0; i < MAX_PORT_SCAN; i++) {
                var port = basePort + i;
                var url = 'http://127.0.0.1:' + port;
                try {
                    var resp = await fetch(url + '/status', { signal: AbortSignal.timeout(500) });
if (resp.ok) {
       cachedServerUrl = url;
       cacheExpiry = Date.now() + 30000;
       resolve(url);
       return;
      }                } catch (_) {}
            }
            // 都找不到，返回默认
            resolve('http://127.0.0.1:' + basePort);
        });
    });
}

// 简单版（不扫描，直接用配置端口）
function getServerUrl() {
    return new Promise(function(resolve) {
        chrome.storage.local.get(['serverPort'], function(r) {
            resolve('http://127.0.0.1:' + (r.serverPort || DEFAULT_PORT));
        });
    });
}

chrome.runtime.onInstalled.addListener(function() {
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

chrome.contextMenus.onClicked.addListener(async function(info, tab) {
    if (info.menuItemId === 'send-to-vscode' && info.selectionText) {
        var result = await sendToVSCode({ type: 'raw-text', text: info.selectionText });
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

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {

    if (message.type === 'send-actions') {
        sendToVSCode({ type: 'actions', actions: message.actions }).then(sendResponse);
        return true;
    }

    if (message.type === 'send-raw-text') {
        sendToVSCode({ type: 'raw-text', text: message.text }).then(sendResponse);
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
        callVSCode('/get-history', {}).then(function(resp) {
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
        var baseUrl = await findServerUrl();
        var endpoint = payload.type === 'raw-text' ? '/apply-text' : '/apply';
        var response = await fetch(baseUrl + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            return { success: false, message: '服务器返回错误: ' + response.status };
        }
        var data = await response.json();
        return { success: true, message: data.message || '已发送', data: data };
    } catch (e) {
        return { success: false, message: 'VS Code 服务器未启动，请检查 VS Code 中的 AI Code Agent 扩展' };
    }
}

async function callVSCode(endpoint, body, method) {
    method = method || 'POST';
    try {
        var baseUrl = await findServerUrl();
        var options = method === 'GET'
            ? { method: 'GET' }
            : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        var response = await fetch(baseUrl + endpoint, options);
        if (!response.ok) return { success: false, message: '错误: ' + response.status };
        return await response.json();
    } catch (e) {
        return { success: false, message: '无法连接 VS Code 服务器' };
    }
}

async function checkConnection() {
    try {
        var baseUrl = await findServerUrl();
        var response = await fetch(baseUrl + '/status');
        if (response.ok) {
            var data = await response.json();
            return { connected: true, workspace: data.workspace, port: data.port };
        }
        return { connected: false };
    } catch (e) {
        return { connected: false };
    }
}
