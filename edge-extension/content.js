(function () {
    'use strict';

    var PROCESSED_ATTR = 'data-aca-processed';
    var BUTTON_CLASS = 'aca-apply-btn';
    var ACTION_KEYWORDS = ['"action"', '"file"'];
    var ACTION_VALUES = ['write', 'patch', 'create', 'update', 'delete'];

    var extensionEnabled = true;
    var autoScanEnabled = true;

    chrome.storage.local.get(['extensionEnabled', 'autoScan'], function(result) {
        extensionEnabled = result.extensionEnabled !== false;
        autoScanEnabled = result.autoScan !== false;
        if (extensionEnabled && autoScanEnabled) {
            setTimeout(scanPage, 1500);
        }
        if (extensionEnabled) {
            wsConnect();
        }
    });

    // ======================== 解析 ========================

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
            str.trim().replace(/,\s*([\]}])/g, '$1'),
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

    // ======================== 智能过滤 ========================

    // 判断文本是否像终端命令 / 非代码内容，不该加按钮
    function looksLikeTerminalOrShort(text) {
        var trimmed = text.trim();
        var lines = trimmed.split('\n');

        // 少于 3 行不加按钮
        if (lines.length < 3) return true;

        // 少于 80 字符不加按钮
        if (trimmed.length < 80) return true;

        // 所有行都以 $ 或 > 或 # 开头 → 终端命令
        var terminalLines = lines.filter(function(l) {
            var s = l.trim();
            return s.startsWith('$') || s.startsWith('>') || s.startsWith('#') || s.startsWith('PS ');
        });
        if (terminalLines.length > lines.length * 0.6) return true;

        // 常见命令关键词占大多数 → 终端
        var cmdPatterns = [
            /^(cd|ls|dir|mkdir|rm|cp|mv|cat|echo|npm|npx|yarn|pnpm|git|pip|python|node|cargo|go |docker|kubectl|brew|apt|sudo|chmod|chown|curl|wget)\s/i,
        ];
        var cmdCount = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            for (var j = 0; j < cmdPatterns.length; j++) {
                if (cmdPatterns[j].test(line)) { cmdCount++; break; }
            }
        }
        var nonEmptyLines = lines.filter(function(l) { return l.trim().length > 0; }).length;
        if (nonEmptyLines > 0 && cmdCount / nonEmptyLines > 0.5) return true;

        return false;
    }

    // ======================== 通信 ========================

    function sendToVSCode(payload, callback) {
        chrome.runtime.sendMessage(
            payload.actions
                ? { type: 'send-actions', actions: payload.actions }
                : { type: 'send-raw-text', text: payload.text },
            callback
        );
    }

    // ======================== Apply 按钮 ========================

    function addApplyButton(element, actions) {
        if (element.getAttribute(PROCESSED_ATTR)) return;
        element.setAttribute(PROCESSED_ATTR, 'true');

        var wrapper = document.createElement('div');
        wrapper.className = 'aca-button-wrapper';

        var dismissBtn = document.createElement('button');
        dismissBtn.className = 'aca-dismiss-btn';
        dismissBtn.textContent = '×';
        dismissBtn.title = '隐藏此按钮';
        dismissBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            wrapper.remove();
            element.setAttribute(PROCESSED_ATTR, 'dismissed');
        });

        var btn = document.createElement('button');
        btn.className = BUTTON_CLASS;
        btn.innerHTML = '⚡ 应用到 VS Code (' + actions.length + ' 个文件)';
        btn.title = actions.map(function(a) { return a.action + ': ' + a.file; }).join('\n');

        var preview = document.createElement('div');
        preview.className = 'aca-preview';
        actions.forEach(function(a) {
            var item = document.createElement('div');
            item.className = 'aca-preview-item';
            var icon = a.action === 'delete' ? '🗑️' : a.action === 'patch' ? '🔧' : '📄';
            item.textContent = icon + ' ' + a.action + ' → ' + a.file;
            preview.appendChild(item);
        });

        var status = document.createElement('span');
        status.className = 'aca-status';

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            btn.innerHTML = '⏳ 发送中...';
            sendToVSCode({ actions: actions }, function(response) {
                if (response && response.success) {
                    btn.innerHTML = '✅ 已发送到 VS Code';
                    btn.classList.add('aca-success');
                    status.textContent = response.message || '';
                } else {
                    btn.innerHTML = '❌ 发送失败（点击重试）';
                    btn.classList.add('aca-error');
                    btn.disabled = false;
                    status.textContent = response ? response.message : '无法连接 VS Code';
                }
            });
        });

        wrapper.appendChild(dismissBtn);
        wrapper.appendChild(btn);
        wrapper.appendChild(preview);
        wrapper.appendChild(status);
        element.parentElement.insertBefore(wrapper, element);
    }

    // ======================== 手动发送按钮 ========================

    function addManualButton(element) {
        if (element.getAttribute(PROCESSED_ATTR)) return;
        element.setAttribute(PROCESSED_ATTR, 'true');

        var container = element.closest('pre') || element;
        container.style.position = 'relative';

        var btn = document.createElement('button');
        btn.className = BUTTON_CLASS + ' aca-manual-btn';
        btn.innerHTML = '📤 发送到 VS Code';
        btn.style.cssText = 'position:absolute;top:5px;right:28px;z-index:100;';

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var code = element.textContent || '';
            if (!code.trim()) return;
            btn.disabled = true;
            btn.innerHTML = '⏳ 发送中...';
            sendToVSCode({ text: code }, function(response) {
                if (response && response.success) {
                    btn.innerHTML = '✅ 已发送';
                    btn.classList.add('aca-success');
                } else {
                    btn.innerHTML = '❌ 失败（点击重试）';
                    btn.classList.add('aca-error');
                    btn.disabled = false;
                }
            });
        });

        var closeBtn = document.createElement('button');
        closeBtn.className = 'aca-manual-close-btn';
        closeBtn.textContent = '×';
        closeBtn.title = '隐藏此按钮';
        closeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            btn.remove();
            closeBtn.remove();
            element.setAttribute(PROCESSED_ATTR, 'dismissed');
        });

        container.appendChild(btn);
        container.appendChild(closeBtn);
    }

    // ======================== 扫描 ========================

    function scanPage() {
        if (!extensionEnabled || !autoScanEnabled) return;

        var processedParents = new Set();
        var codeEls = document.querySelectorAll(
            'pre, code, [class*="code"], [class*="Code"], [class*="highlight"], [class*="markdown"], [class*="prose"]'
        );

        codeEls.forEach(function(el) {
            if (el.getAttribute(PROCESSED_ATTR)) return;
            var text = el.textContent || '';
            if (text.trim().length < 10) return;

            var actions = extractActions(text);
            var target = el.tagName === 'CODE' ? (el.closest('pre') || el) : el;

            if (actions.length > 0) {
                // agent-action 代码块始终显示按钮
                if (processedParents.has(target)) return;
                processedParents.add(target);
                addApplyButton(target, actions);
            } else if (
                (el.tagName === 'PRE' || el.tagName === 'CODE') &&
                !looksLikeTerminalOrShort(text)
            ) {
                // 只给看起来像真正代码的块加手动按钮
                if (processedParents.has(target)) return;
                processedParents.add(target);
                addManualButton(target);
            }
        });

        document.querySelectorAll(
            'div[class*="message"], div[class*="response"], div[class*="answer"], article'
        ).forEach(function(el) {
            if (el.getAttribute(PROCESSED_ATTR)) return;
            var text = el.textContent || '';
            if (!looksLikeAction(text)) return;
            var actions = extractActions(text);
            if (actions.length > 0 && !el.querySelector('[' + PROCESSED_ATTR + ']')) {
                el.setAttribute(PROCESSED_ATTR, 'scan-parent');
                addApplyButton(el, actions);
            }
        });
    }

    // ======================== MutationObserver ========================

    var scanTimeout = null;
    var observer = new MutationObserver(function(mutations) {
        if (!extensionEnabled || !autoScanEnabled) return;
        var hasNewNodes = mutations.some(function(m) { return m.addedNodes.length > 0; });
        if (!hasNewNodes) return;
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(scanPage, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // ======================== 浮动按钮 ========================

    var floatingContainer = null;
    var floatingTimeout = null;

    function removeFloatingBtn() {
        if (floatingContainer) {
            floatingContainer.remove();
            floatingContainer = null;
        }
        if (floatingTimeout) {
            clearTimeout(floatingTimeout);
            floatingTimeout = null;
        }
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') removeFloatingBtn();
    });

    document.addEventListener('mouseup', function(e) {
        if (!extensionEnabled) return;
        if (
            e.target.closest('.aca-floating-container') ||
            e.target.classList.contains(BUTTON_CLASS)
        ) return;

        removeFloatingBtn();

        setTimeout(function() {
            var selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            var text = selection.toString().trim();

            // 选中内容太短不显示
            if (text.length < 15) return;

            // 选中内容看起来像终端命令也不显示
            if (looksLikeTerminalOrShort(text)) return;

            var range = selection.getRangeAt(0);
            var rect = range.getBoundingClientRect();
            var btnTop = Math.max(rect.top - 44, 8);
            var btnLeft = Math.min(Math.max(rect.left, 8), window.innerWidth - 220);

            floatingContainer = document.createElement('div');
            floatingContainer.className = 'aca-floating-container';
            floatingContainer.style.top = btnTop + 'px';
            floatingContainer.style.left = btnLeft + 'px';

            var sendBtn = document.createElement('button');
            sendBtn.className = 'aca-floating-send-btn';
            sendBtn.textContent = '📤 发送到 VS Code';

            sendBtn.addEventListener('click', function(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                var actions = extractActions(text);
                sendBtn.textContent = '⏳ 发送中...';
                sendBtn.disabled = true;

                if (actions.length > 0) {
                    sendToVSCode({ actions: actions }, function(resp) {
                        showNotification(
                            resp && resp.success
                                ? '✅ 已发送 ' + actions.length + ' 个操作到 VS Code'
                                : (resp ? resp.message : '连接失败'),
                            resp && resp.success
                        );
                        removeFloatingBtn();
                    });
                } else {
                    sendToVSCode({ text: text }, function(resp) {
                        showNotification(
                            resp && resp.success
                                ? '✅ 已发送（请在 VS Code 中指定文件路径）'
                                : (resp ? resp.message : '连接失败'),
                            resp && resp.success
                        );
                        removeFloatingBtn();
                    });
                }
            });

            var closeBtn = document.createElement('button');
            closeBtn.className = 'aca-floating-close-btn';
            closeBtn.textContent = '×';
            closeBtn.title = '关闭 (Esc)';
            closeBtn.addEventListener('click', function(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                removeFloatingBtn();
            });

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
        removeFloatingBtn();
        document.querySelectorAll('.aca-button-wrapper').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-manual-btn').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-manual-close-btn').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-floating-container').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-notification').forEach(function(el) { el.remove(); });
        document.querySelectorAll('[' + PROCESSED_ATTR + ']').forEach(function(el) {
            el.removeAttribute(PROCESSED_ATTR);
        });
    }

    function enableExtension() {
        extensionEnabled = true;
        if (autoScanEnabled) scanPage();
        if (!ws) wsConnect();
    }

    // ======================== 消息 ========================

    chrome.runtime.onMessage.addListener(function(message) {
        if (message.type === 'scan-and-send-all') {
            if (!extensionEnabled) return;
            var allActions = [];
            document.querySelectorAll('pre, code').forEach(function(el) {
                extractActions(el.textContent || '').forEach(function(a) { allActions.push(a); });
            });
            if (allActions.length === 0) {
                showNotification('未检测到可用的代码操作指令', false);
                return;
            }
            sendToVSCode({ actions: allActions }, function(resp) {
                showNotification(
                    resp && resp.success
                        ? '已发送 ' + allActions.length + ' 个操作到 VS Code'
                        : (resp ? resp.message : '连接失败'),
                    resp && resp.success
                );
            });
        }
        if (message.type === 'show-notification') {
            showNotification(message.message, message.success);
        }
        if (message.type === 'toggle-auto-scan') {
            autoScanEnabled = message.enabled;
            if (autoScanEnabled && extensionEnabled) scanPage();
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

    console.log('[AI Code Agent] Content script loaded.');

    // ======================== WebSocket ========================

    var ws = null;
    var wsReconnectTimer = null;
    var wsRetryDelay = 1000;
    var WS_MAX_RETRY_DELAY = 30000;
    var wsReqId = 0;
    var pendingRequests = new Map();

    function wsConnect() {
        if (!extensionEnabled) return;
        chrome.storage.local.get(['serverPort'], function(r) {
            var port = r.serverPort || 9960;
            try {
                ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
                ws.onopen = function() {
                    console.log('[AI Code Agent] WebSocket 已连接');
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
        });
    }

    function wsSend(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }

    function wsRequest(data) {
        return new Promise(function(resolve) {
            var reqId = (++wsReqId) + '_' + Date.now();
            data.reqId = reqId;
            var timeout = setTimeout(function() {
                pendingRequests.delete(reqId);
                resolve({ success: false, message: '请求超时' });
            }, 10000);
            pendingRequests.set(reqId, function(resp) {
                clearTimeout(timeout);
                pendingRequests.delete(reqId);
                resolve(resp);
            });
            if (!wsSend(data)) {
                clearTimeout(timeout);
                pendingRequests.delete(reqId);
                resolve({ success: false, message: '未连接到 VS Code' });
            }
        });
    }

    function handleWSMessage(data) {
        if (data.reqId && pendingRequests.has(data.reqId)) {
            pendingRequests.get(data.reqId)(data);
            return;
        }
        switch (data.type) {
            case 'connected':
                console.log('[AI Code Agent] VS Code 工作区:', data.workspace);
                break;
            case 'inject-to-input':
                injectToAIInput(data.message);
                showNotification(
                    data.mode === 'error'
                        ? '✅ 错误信息已注入到 AI 输入框'
                        : '✅ 已注入 ' + (data.mode === 'file' ? '文件' : '选中代码') + ' 到 AI 输入框',
                    true
                );
                break;
            case 'progress':
                showNotification('⏳ 处理中 [' + data.current + '/' + data.total + ']: ' + data.file, true);
                break;
            case 'done':
                showNotification('📋 ' + data.summary, true);
                break;
            case 'history-updated':
                chrome.runtime.sendMessage({ type: 'history-updated', history: data.history });
                break;
        }
    }

    function injectToAIInput(text) {
        var selectors = [
            'textarea[placeholder*="message" i]',
            'textarea[placeholder*="消息" i]',
            'textarea[placeholder*="输入" i]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
            'textarea',
        ];
        var target = null;
        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (el) { target = el; break; }
        }
        if (!target) {
            showNotification('❌ 未找到 AI 输入框，请手动粘贴', false);
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
        if (target.tagName === 'TEXTAREA') {
            target.selectionStart = target.selectionEnd = target.value.length;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

})();
