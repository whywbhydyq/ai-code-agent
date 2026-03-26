(function () {
    'use strict';

    var PROCESSED_ATTR = 'data-aca-processed';
    var BUTTON_CLASS = 'aca-apply-btn';
    var ACTION_KEYWORDS = ['"action"', '"file"'];
    var ACTION_VALUES = ['write', 'patch', 'create', 'update', 'delete'];

    var extensionEnabled = true;
    var autoScanEnabled = true;
    var autoJumpEnabled = true;
    var serverPort = 9960;

    // 每个标签页独立端口：sessionStorage 刷新后保留，关闭标签页后清除
    var _savedTabPort = null;
    try { _savedTabPort = sessionStorage.getItem('aca-server-port'); } catch (_) {}
    if (_savedTabPort) serverPort = parseInt(_savedTabPort, 10);

    chrome.storage.local.get(['extensionEnabled', 'autoScan', 'autoJump', 'serverPort'], function(result) {
        extensionEnabled = result.extensionEnabled !== false;
        autoScanEnabled = result.autoScan !== false;
        autoJumpEnabled = result.autoJump !== false;
        // 仅在没有标签页专属端口时使用全局端口
        if (!_savedTabPort && result.serverPort) serverPort = result.serverPort;
        if (extensionEnabled && autoScanEnabled) {
            setTimeout(scanPage, 1500);
            startPolling();
        }
        if (extensionEnabled) {
            wsConnect();
        }
    });

    chrome.storage.onChanged.addListener(function(changes) {
        if (changes.autoJump) autoJumpEnabled = changes.autoJump.newValue !== false;
        // 不再监听 serverPort 变化，由 reconnect-ws 消息控制每个标签页的端口
    });

    function looksLikeAction(text) {
        if (!text) return false;
        var lower = text.toLowerCase();
        var hasKeys = ACTION_KEYWORDS.every(function(k) { return lower.includes(k); });
        var hasValue = ACTION_VALUES.some(function(v) { return lower.includes('"' + v + '"'); });
        return hasKeys && hasValue;
    }

    function extractActions(text) {
        var actions = [];
        var patterns = [
            /```(?:agent-action|agent_action)\s*\n([\s\S]*?)\n\s*```/gi,
            /```json\s*\n([\s\S]*?)\n\s*```/gi,
            /```\w*\s*\n([\s\S]*?)\n\s*```/gi,
        ];
        for (var p = 0; p < patterns.length; p++) {
            var regex = patterns[p];
            var match;
            while ((match = regex.exec(text)) !== null) {
                if (looksLikeAction(match[1])) {
                    tryParseAndPush(match[1], actions);
                }
            }
            if (actions.length > 0) return actions;
        }
        var nakedJson = text.match(/\{\s*"action"\s*:[\s\S]*?\}/g);
        if (nakedJson) {
            nakedJson.forEach(function(s) { tryParseAndPush(s, actions); });
        }
        return actions;
    }

    function tryParseAndPush(str, arr) {
        var attempts = [
            str.trim(),
            str.trim().replace(/,\s*([\]\}])/g, '$1'),
            str.trim().replace(/'/g, '"'),
        ];
        for (var i = 0; i < attempts.length; i++) {
            try {
                var obj = JSON.parse(attempts[i]);
                if (isValidAction(obj)) {
                    arr.push(normalizeAction(obj));
                    return;
                }
            } catch (_) {}
        }
    }

    function isValidAction(obj) {
        if (!obj || typeof obj !== 'object') return false;
        if (!obj.action) return false;
        if (!obj.file && !obj.file_path && !obj.filePath) return false;
        return ACTION_VALUES.includes(obj.action.toLowerCase());
    }

    function normalizeAction(obj) {
        return {
            action: obj.action.toLowerCase(),
            file: obj.file || obj.file_path || obj.filePath,
            content: obj.content || '',
            patches: obj.patches || null,
        };
    }

    function looksLikeNonCode(text) {
        var trimmed = text.trim();
        var lines = trimmed.split('\n');
        var nonEmptyLines = lines.filter(function(l) { return l.trim().length > 0; });
        if (nonEmptyLines.length < 2) return true;
        if (trimmed.length < 40) return true;
        var terminalCount = 0;
        var stepCount = 0;
        var naturalLangCount = 0;
        for (var i = 0; i < nonEmptyLines.length; i++) {
            var line = nonEmptyLines[i].trim();
            if (/^[$>]\s/.test(line) || /^PS\s/.test(line) || /^C:\\/.test(line)) { terminalCount++; continue; }
            if (/^\d+[\.\)\u3001]\s/.test(line)) { stepCount++; continue; }
            if (/[\u2192\-\>]/.test(line) && /[\u4e00-\u9fff]/.test(line)) { stepCount++; continue; }
            var chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length;
            if (chineseChars > line.length * 0.3 && line.length > 5) { naturalLangCount++; continue; }
        }
        if (nonEmptyLines.length > 0 && terminalCount / nonEmptyLines.length > 0.6) return true;
        if (nonEmptyLines.length > 0 && stepCount / nonEmptyLines.length > 0.5) return true;
        if (nonEmptyLines.length > 0 && naturalLangCount / nonEmptyLines.length > 0.5) return true;
        var cmdRegex = /^(cd|ls|dir|mkdir|rm|cp|mv|cat|echo|npm|npx|yarn|pnpm|git|pip|python|node|cargo|go|docker|kubectl|brew|apt|sudo|chmod|chown|curl|wget|code|vsce)\s/i;
        var cmdCount = 0;
        for (var j = 0; j < nonEmptyLines.length; j++) {
            if (cmdRegex.test(nonEmptyLines[j].trim())) cmdCount++;
        }
        if (nonEmptyLines.length > 0 && cmdCount / nonEmptyLines.length > 0.5) return true;
        return false;
    }

    function isCodeBlockHeader(el) {
        var tag = el.tagName;
        if (tag === 'SPAN' || tag === 'BUTTON' || tag === 'SMALL' || tag === 'LABEL') return true;
        var cls = (el.className || '').toLowerCase();
        if (/header|title|label|badge|toolbar|copy-btn|copy-code/.test(cls)) return true;
        if (tag === 'PRE') return false;
        if (tag === 'CODE' && el.closest && el.closest('pre')) return false;
        if (tag === 'CODE') {
            if (/^lang|^language/.test(cls)) return true;
            var text = (el.textContent || '').trim();
            if (text.length < 10 && text.indexOf('\n') === -1) return true;
        }
        return false;
    }

    function hasDirectButtonWrapper(el) {
        var container = el.closest('pre') || el;
        if (container.querySelector('.aca-button-wrapper')) return true;
        return false;
    }

    function httpSend(endpoint, payload) {
        return fetch('http://127.0.0.1:' + serverPort + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function(r) { return r.json(); });
    }

    function jumpToVSCode() {
        if (!autoJumpEnabled) return;
        httpSend('/focus', {}).catch(function() {});
    }

    function sendToVSCode(payload, callback) {
        var responded = false;
        var timeoutId = setTimeout(function() {
            if (responded) return;
            responded = true;
            if (callback) callback({ success: false, message: '\u8bf7\u6c42\u8d85\u65f6(10s)' });
        }, 10000);
        var endpoint = payload.actions ? '/apply' : '/apply-text';
        var body = payload.actions ? { type: 'actions', actions: payload.actions } : { type: 'raw-text', text: payload.text };
        httpSend(endpoint, body).then(function(data) {
            if (responded) return;
            responded = true;
            clearTimeout(timeoutId);
            var success = data.status === 'success' || data.success;
            if (success) jumpToVSCode();
            if (callback) callback({ success: success, message: data.message || '' });
        }).catch(function(err) {
            if (responded) return;
            responded = true;
            clearTimeout(timeoutId);
            if (callback) callback({ success: false, message: 'VS Code\u670d\u52a1\u5668\u672a\u542f\u52a8' });
        });
    }

    function createButtonWrapper(element, btnText, btnTitle, onClick) {
        var container = element.closest('pre') || element;
        var pos = window.getComputedStyle(container).position;
        if (pos === 'static' || pos === '') {
            container.style.position = 'relative';
        }
        var wrapper = document.createElement('div');
        wrapper.className = 'aca-button-wrapper';
        var dismissBtn = document.createElement('button');
        dismissBtn.className = 'aca-dismiss-btn';
        dismissBtn.textContent = '\u00d7';
        dismissBtn.title = '\u9690\u85cf';
        dismissBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            wrapper.remove();
            element.setAttribute(PROCESSED_ATTR, 'dismissed');
        });
        var btn = document.createElement('button');
        btn.className = BUTTON_CLASS;
        btn.textContent = btnText;
        if (btnTitle) btn.title = btnTitle;
        var status = document.createElement('span');
        status.className = 'aca-status';
        btn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            onClick(btn, status);
        });
        wrapper.appendChild(btn);
        wrapper.appendChild(dismissBtn);
        wrapper.appendChild(status);
        container.appendChild(wrapper);
        return wrapper;
    }

    function addApplyButton(element, actions) {
        if (element.getAttribute(PROCESSED_ATTR)) return;
        element.setAttribute(PROCESSED_ATTR, 'true');
        var fileList = actions.map(function(a) { return a.action + ': ' + a.file; }).join('\n');
        createButtonWrapper(
            element,
            '\u26a1 \u5e94\u7528 (' + actions.length + ')',
            fileList,
            function(btn, status) {
                btn.disabled = true;
                btn.textContent = '\u23f3...';
                sendToVSCode({ actions: actions }, function(response) {
                    if (response && response.success) {
                        btn.textContent = '\u2705';
                        btn.classList.add('aca-success');
                        status.textContent = response.message || '';
                    } else {
                        btn.textContent = '\u274c \u91cd\u8bd5';
                        btn.classList.add('aca-error');
                        btn.disabled = false;
                        status.textContent = response ? response.message : '';
                    }
                });
            }
        );
    }

    function addManualButton(element) {
        if (element.getAttribute(PROCESSED_ATTR)) return;
        element.setAttribute(PROCESSED_ATTR, 'true');
        createButtonWrapper(
            element,
            '\ud83d\udce4 VS Code',
            '\u53d1\u9001\u6b64\u4ee3\u7801\u5757',
            function(btn, status) {
                var code = element.textContent || '';
                if (!code.trim()) return;
                btn.disabled = true;
                btn.textContent = '\u23f3...';
                sendToVSCode({ text: code }, function(response) {
                    if (response && response.success) {
                        btn.textContent = '\u2705';
                        btn.classList.add('aca-success');
                    } else {
                        btn.textContent = '\u274c \u91cd\u8bd5';
                        btn.classList.add('aca-error');
                        btn.disabled = false;
                    }
                });
            }
        );
    }

    var lastScanHash = '';

    function scanPage() {
        if (!extensionEnabled || !autoScanEnabled) return;
        var allBlocks = document.querySelectorAll('pre, code');
        var unprocessedCount = 0;
        for (var ci = 0; ci < allBlocks.length; ci++) {
            if (!allBlocks[ci].getAttribute(PROCESSED_ATTR)) unprocessedCount++;
        }
        var hash = allBlocks.length + ':' + unprocessedCount;
        if (hash === lastScanHash) return;
        lastScanHash = hash;

        for (var ei = 0; ei < allBlocks.length; ei++) {
            var el = allBlocks[ei];
            if (el.getAttribute(PROCESSED_ATTR)) continue;
            if (isCodeBlockHeader(el)) continue;
            var text = el.textContent || '';
            if (text.trim().length < 10) continue;
            var target;
            if (el.tagName === 'CODE' && el.closest('pre')) {
                target = el.closest('pre');
            } else {
                target = el;
            }
            if (target.getAttribute(PROCESSED_ATTR)) continue;
            if (hasDirectButtonWrapper(target)) continue;
            var actions = extractActions(text);
            if (actions.length > 0) {
                addApplyButton(target, actions);
            } else if (!looksLikeNonCode(text)) {
                addManualButton(target);
            }
        }
    }

    // ======================== MutationObserver ========================
    var scanTimeout = null;
    var observer = new MutationObserver(function(mutations) {
        if (!extensionEnabled || !autoScanEnabled) return;
        var hasNewNodes = false;
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) { hasNewNodes = true; break; }
        }
        if (!hasNewNodes) return;
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanPage, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    var pollInterval = null;
    var isPageVisible = true;
    document.addEventListener('visibilitychange', function() {
        isPageVisible = !document.hidden;
    });

    function startPolling() {
        if (pollInterval) return;
        pollInterval = setInterval(function() {
            if (!extensionEnabled || !autoScanEnabled) return;
            if (!isPageVisible) return;
            scanPage();
        }, 3000);
    }
    function stopPolling() {
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    }

    // ======================== 浮动按钮 ========================
    var floatingContainer = null;
    var floatingTimeout = null;

    function removeFloatingBtn() {
        if (floatingContainer) { floatingContainer.remove(); floatingContainer = null; }
        if (floatingTimeout) { clearTimeout(floatingTimeout); floatingTimeout = null; }
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') removeFloatingBtn();
    });

    document.addEventListener('mouseup', function(e) {
        if (!extensionEnabled) return;
        if (e.target.closest('.aca-floating-container') || e.target.classList.contains(BUTTON_CLASS)) return;
        removeFloatingBtn();
        setTimeout(function() {
            var selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            var text = selection.toString().trim();
            if (text.length < 15) return;
            if (looksLikeNonCode(text)) return;
            var range = selection.getRangeAt(0);
            var rect = range.getBoundingClientRect();
            var btnTop = Math.max(rect.top - 44, 8);
            if (btnTop + 40 > window.innerHeight) btnTop = Math.max(window.innerHeight - 50, 8);
            var btnLeft = Math.min(Math.max(rect.left, 8), window.innerWidth - 220);
            floatingContainer = document.createElement('div');
            floatingContainer.className = 'aca-floating-container';
            floatingContainer.style.top = btnTop + 'px';
            floatingContainer.style.left = btnLeft + 'px';
            var sendBtn = document.createElement('button');
            sendBtn.className = 'aca-floating-send-btn';
            sendBtn.textContent = '\ud83d\udce4 \u53d1\u9001\u5230 VS Code';
            sendBtn.addEventListener('click', function(ev) {
                ev.preventDefault(); ev.stopPropagation();
                var actions = extractActions(text);
                sendBtn.textContent = '\u23f3...';
                sendBtn.disabled = true;
                if (actions.length > 0) {
                    sendToVSCode({ actions: actions }, function(resp) {
                        showNotification(resp && resp.success ? '\u2705 \u5df2\u53d1\u9001 ' + actions.length + ' \u4e2a\u64cd\u4f5c' : (resp ? resp.message : '\u5931\u8d25'), resp && resp.success);
                        removeFloatingBtn();
                    });
                } else {
                    sendToVSCode({ text: text }, function(resp) {
                        showNotification(resp && resp.success ? '\u2705 \u5df2\u53d1\u9001' : (resp ? resp.message : '\u5931\u8d25'), resp && resp.success);
                        removeFloatingBtn();
                    });
                }
            });
            var closeBtn = document.createElement('button');
            closeBtn.className = 'aca-floating-close-btn';
            closeBtn.textContent = '\u00d7';
            closeBtn.title = 'Esc';
            closeBtn.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); removeFloatingBtn(); });
            floatingContainer.appendChild(sendBtn);
            floatingContainer.appendChild(closeBtn);
            document.body.appendChild(floatingContainer);
            floatingTimeout = setTimeout(removeFloatingBtn, 8000);
        }, 200);
    });

    document.addEventListener('mousedown', function(e) {
        if (floatingContainer && !floatingContainer.contains(e.target)) removeFloatingBtn();
    });

    // ======================== 启用/禁用 ========================
    function disableExtension() {
        extensionEnabled = false;
        stopPolling();
        removeFloatingBtn();
        document.querySelectorAll('.aca-button-wrapper').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-floating-container').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-notification').forEach(function(el) { el.remove(); });
        document.querySelectorAll('[' + PROCESSED_ATTR + ']').forEach(function(el) { el.removeAttribute(PROCESSED_ATTR); });
        lastScanHash = '';
    }

    function enableExtension() {
        extensionEnabled = true;
        lastScanHash = '';
        if (autoScanEnabled) { scanPage(); startPolling(); }
        if (!ws) wsConnect();
    }

    function collectLastAIReply() {
        var selectors = [
            'div[class*="response"]', 'div[class*="assistant"]',
            'div[data-message-author-role="assistant"]', 'div.markdown',
            'div[class*="message"]', 'div[class*="answer"]', 'article',
        ];
        var allReplies = [];
        for (var si = 0; si < selectors.length; si++) {
            var els = document.querySelectorAll(selectors[si]);
            if (els.length > 0) {
                els.forEach(function(el) {
                    var text = (el.textContent || '').trim();
                    if (text.length > 50) allReplies.push({ text: text, length: text.length });
                });
                if (allReplies.length > 0) break;
            }
        }
        if (allReplies.length === 0) return '';
        allReplies.sort(function(a, b) { return b.length - a.length; });
        var unique = [];
        for (var i = 0; i < allReplies.length; i++) {
            var isDup = false;
            for (var j = 0; j < unique.length; j++) {
                if (unique[j].text.includes(allReplies[i].text)) { isDup = true; break; }
            }
            if (!isDup) unique.push(allReplies[i]);
        }
        return unique.slice(-3).map(function(item, idx) {
            return '--- ' + (idx + 1) + ' ---\n' + item.text;
        }).join('\n\n');
    }

    // ======================== 消息监听 ========================
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        // 返回当前标签页绑定的端口
        if (message.type === 'get-current-port') {
            sendResponse({ port: serverPort });
            return true;
        }

        // 从 popup 注入文本到 AI 输入框
        if (message.type === 'inject-text-to-input') {
            if (message.text) {
                injectToAIInput(message.text);
                showNotification('\u2705 \u5df2\u6ce8\u5165\u5230\u8f93\u5165\u6846', true);
            }
            return;
        }

        // 切换端口（保存到 sessionStorage 实现标签页独立）
        if (message.type === 'reconnect-ws') {
            if (ws) { try { ws.close(); } catch (_) {} ws = null; }
            if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
            wsRetryDelay = 1000;
            if (message.port) {
                serverPort = message.port;
                try { sessionStorage.setItem('aca-server-port', String(serverPort)); } catch (_) {}
            }
            setTimeout(wsConnect, 200);
            showNotification('\u5df2\u5207\u6362\u7a97\u53e3\uff0c\u91cd\u8fde\u4e2d...', true);
            return;
        }

        if (message.type === 'update-auto-jump') {
            autoJumpEnabled = message.enabled;
            return;
        }
        if (message.type === 'collect-last-reply') {
            sendResponse({ text: collectLastAIReply() });
            return true;
        }
        if (message.type === 'collect-debug-info') {
            var codeBlocks = document.querySelectorAll('pre, code');
            var processed = document.querySelectorAll('[' + PROCESSED_ATTR + ']');
            var buttons = document.querySelectorAll('.aca-button-wrapper');
            var unprocessed = [];
            codeBlocks.forEach(function(el) {
                if (!el.getAttribute(PROCESSED_ATTR) && !isCodeBlockHeader(el)) {
                    var text = (el.textContent || '').trim();
                    if (text.length > 10) unprocessed.push({ tag: el.tagName, length: text.length, preview: text.substring(0, 80).replace(/\n/g, ' ') });
                }
            });
            sendResponse({ version: '1.3.0', enabled: extensionEnabled, autoScan: autoScanEnabled, wsConnected: ws && ws.readyState === WebSocket.OPEN, serverPort: serverPort, codeBlockCount: codeBlocks.length, processedCount: processed.length, buttonCount: buttons.length, unprocessedCount: unprocessed.length, unprocessedSamples: unprocessed.slice(0, 5) });
            return true;
        }
        if (message.type === 'scan-page-only') {
            if (!extensionEnabled) return;
            lastScanHash = '';
            autoScanEnabled = true;
            scanPage();
            showNotification('\u5df2\u626b\u63cf\u9875\u9762', true);
            return;
        }
        if (message.type === 'scan-and-send-all') {
            if (!extensionEnabled) return;
            var allActions = [];
            document.querySelectorAll('pre, code').forEach(function(el) {
                extractActions(el.textContent || '').forEach(function(a) { allActions.push(a); });
            });
            if (allActions.length === 0) { showNotification('\u672a\u68c0\u6d4b\u5230\u64cd\u4f5c\u6307\u4ee4', false); return; }
            sendToVSCode({ actions: allActions }, function(resp) {
                showNotification(resp && resp.success ? '\u5df2\u53d1\u9001 ' + allActions.length + ' \u4e2a\u64cd\u4f5c' : (resp ? resp.message : '\u5931\u8d25'), resp && resp.success);
            });
        }
        if (message.type === 'show-notification') { showNotification(message.message, message.success); }
        if (message.type === 'toggle-auto-scan') {
            autoScanEnabled = message.enabled;
            if (autoScanEnabled && extensionEnabled) { lastScanHash = ''; scanPage(); startPolling(); } else { stopPolling(); }
        }
        if (message.type === 'toggle-extension') {
            if (message.enabled) { enableExtension(); } else { disableExtension(); }
        }
    });

    // ======================== 通知 ========================
    function showNotification(text, success) {
        var existing = document.querySelector('.aca-notification');
        if (existing) existing.remove();
        var notif = document.createElement('div');
        notif.className = 'aca-notification ' + (success ? 'aca-notif-success' : 'aca-notif-error');
        notif.textContent = text;
        document.body.appendChild(notif);
        setTimeout(function() {
            notif.style.transition = 'all 0.5s ease';
            notif.style.opacity = '0';
            notif.style.transform = 'translateX(100px)';
            setTimeout(function() { notif.remove(); }, 500);
        }, 3000);
    }

    console.log('[AI Code Agent] Content script loaded. v1.3.0');

    // ======================== WebSocket ========================
    var ws = null;
    var wsReconnectTimer = null;
    var wsRetryDelay = 1000;
    var WS_MAX_RETRY_DELAY = 30000;
    var wsReqId = 0;
    var pendingRequests = new Map();

    function wsConnect() {
        if (!extensionEnabled) return;
        try {
            ws = new WebSocket('ws://127.0.0.1:' + serverPort + '/ws');
            ws.onopen = function() {
                console.log('[AI Code Agent] WebSocket connected to :' + serverPort);
                wsRetryDelay = 1000;
                if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
            };
            ws.onmessage = function(event) {
                try { handleWSMessage(JSON.parse(event.data)); } catch (_) {}
            };
            ws.onclose = function() {
                ws = null;
                if (extensionEnabled) {
                    wsReconnectTimer = setTimeout(wsConnect, wsRetryDelay);
                    wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_RETRY_DELAY);
                }
            };
            ws.onerror = function() {
                ws = null;
                if (extensionEnabled) {
                    wsReconnectTimer = setTimeout(wsConnect, wsRetryDelay);
                    wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_RETRY_DELAY);
                }
            };
        } catch (_) {
            if (extensionEnabled) {
                wsReconnectTimer = setTimeout(wsConnect, wsRetryDelay);
                wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_RETRY_DELAY);
            }
        }
    }

    function wsSend(data) {
        if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(data)); return true; }
        return false;
    }

    function wsRequest(data) {
        return new Promise(function(resolve) {
            var reqId = (++wsReqId) + '_' + Date.now();
            data.reqId = reqId;
            var timeout = setTimeout(function() { pendingRequests.delete(reqId); resolve({ success: false, message: 'timeout' }); }, 10000);
            pendingRequests.set(reqId, function(resp) { clearTimeout(timeout); pendingRequests.delete(reqId); resolve(resp); });
            if (!wsSend(data)) { clearTimeout(timeout); pendingRequests.delete(reqId); resolve({ success: false, message: 'not connected' }); }
        });
    }

    function handleWSMessage(data) {
        if (data.reqId && pendingRequests.has(data.reqId)) { pendingRequests.get(data.reqId)(data); return; }
        switch (data.type) {
            case 'connected': console.log('[AI Code Agent] workspace:', data.workspace); break;
            case 'inject-to-input':
                injectToAIInput(data.message);
                showNotification(data.mode === 'error' ? '\u2705 \u9519\u8bef\u4fe1\u606f\u5df2\u6ce8\u5165' : '\u2705 \u5df2\u6ce8\u5165\u5230\u8f93\u5165\u6846', true);
                break;
            case 'progress': showNotification('\u23f3 [' + data.current + '/' + data.total + '] ' + data.file, true); break;
            case 'done': showNotification('\ud83c\udf89 ' + data.summary, true); break;
            case 'history-updated': chrome.runtime.sendMessage({ type: 'history-updated', history: data.history }); break;
        }
    }

    function injectToAIInput(text) {
        var selectors = ['textarea[placeholder*="message" i]', 'textarea[placeholder*="\u6d88\u606f" i]', 'textarea[placeholder*="\u8f93\u5165" i]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'];
        var target = null;
        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (el) { target = el; break; }
        }
        if (!target) {
            showNotification('\u274c \u672a\u627e\u5230\u8f93\u5165\u6846', false);
            navigator.clipboard.writeText(text).catch(function() {});
            return;
        }
        if (target.tagName === 'TEXTAREA') {
            var currentVal = target.value;
            target.value = currentVal ? currentVal + '\n\n' + text : text;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            var currentContent = target.innerText || '';
            target.innerText = currentContent ? currentContent + '\n\n' + text : text;
            target.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        target.focus();
        if (target.tagName === 'TEXTAREA') { target.selectionStart = target.selectionEnd = target.value.length; }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

})();
