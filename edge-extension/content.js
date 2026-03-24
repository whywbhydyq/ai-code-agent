(function () {
    'use strict';

    var PROCESSED_ATTR = 'data-aca-processed';
    var BUTTON_CLASS = 'aca-apply-btn';
    var ACTION_KEYWORDS = ['"action"', '"file"'];
    var ACTION_VALUES = ['write', 'patch', 'create', 'update', 'delete'];

    var extensionEnabled = true;
    var autoScanEnabled = true;
    var autoJumpEnabled = true;

    chrome.storage.local.get(['extensionEnabled', 'autoScan', 'autoJump'], function(result) {
        extensionEnabled = result.extensionEnabled !== false;
        autoScanEnabled = result.autoScan !== false;
        autoJumpEnabled = result.autoJump !== false;
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

        if (nonEmptyLines.length < 3) return true;
        if (trimmed.length < 80) return true;

        var terminalCount = 0;
        var stepCount = 0;
        var naturalLangCount = 0;

        for (var i = 0; i < nonEmptyLines.length; i++) {
            var line = nonEmptyLines[i].trim();
            if (/^[$>]\s/.test(line) || /^PS\s/.test(line) || /^C:\\/.test(line)) {
                terminalCount++;
                continue;
            }
            if (/^\d+[\.\)\u3001]\s/.test(line)) {
                stepCount++;
                continue;
            }
            if (/[\u2192\-\>]/.test(line) && /[\u4e00-\u9fff]/.test(line)) {
                stepCount++;
                continue;
            }
            var chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length;
            if (chineseChars > line.length * 0.3 && line.length > 5) {
                naturalLangCount++;
                continue;
            }
        }

        if (terminalCount / nonEmptyLines.length > 0.6) return true;
        if (stepCount / nonEmptyLines.length > 0.5) return true;
        if (naturalLangCount / nonEmptyLines.length > 0.5) return true;

        var cmdRegex = /^(cd|ls|dir|mkdir|rm|cp|mv|cat|echo|npm|npx|yarn|pnpm|git|pip|python|node|cargo|go|docker|kubectl|brew|apt|sudo|chmod|chown|curl|wget|code|vsce)\s/i;
        var cmdCount = 0;
        for (var j = 0; j < nonEmptyLines.length; j++) {
            if (cmdRegex.test(nonEmptyLines[j].trim())) cmdCount++;
        }
        if (nonEmptyLines.length > 0 && cmdCount / nonEmptyLines.length > 0.5) return true;

        return false;
    }

    function isCodeBlockHeader(el) {
        var text = (el.textContent || '').trim();
        if (text.length < 30) return true;
        if (text.split('\n').filter(function(l) { return l.trim(); }).length <= 1) return true;
        var cls = (el.className || '').toLowerCase();
        if (/lang|language|header|title|label|tag|badge|toolbar|copy/.test(cls)) return true;
        var tag = el.tagName;
        if (tag === 'SPAN' || tag === 'BUTTON' || tag === 'SMALL' || tag === 'LABEL') return true;
        return false;
    }

    function hasProcessedAncestor(el) {
        var parent = el.parentElement;
        while (parent) {
            if (parent.getAttribute(PROCESSED_ATTR)) return true;
            if (parent.querySelector('.aca-button-wrapper')) return true;
            parent = parent.parentElement;
        }
        return false;
    }

    // ======================== 跳转到 VS Code ========================
    function jumpToVSCode() {
        if (!autoJumpEnabled) return;
        chrome.storage.local.get(['serverPort'], function(r) {
            var port = r.serverPort || 9960;
            fetch('http://127.0.0.1:' + port + '/focus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            }).catch(function() {});
        });
    }

    // ======================== 发送到 VS Code（带超时） ========================
    function sendToVSCode(payload, callback) {
        var responded = false;
        var timeoutId = setTimeout(function() {
            if (responded) return;
            responded = true;
            if (callback) callback({ success: false, message: '请求超时（15秒），请检查VS Code是否打开了正确的项目' });
        }, 15000);

        chrome.runtime.sendMessage(
            payload.actions
                ? { type: 'send-actions', actions: payload.actions }
                : { type: 'send-raw-text', text: payload.text },
            function(response) {
                if (responded) return;
                responded = true;
                clearTimeout(timeoutId);
                if (response && response.success) {
                    jumpToVSCode();
                }
                if (callback) callback(response);
            }
        );
    }

    function addApplyButton(element, actions) {
        if (element.getAttribute(PROCESSED_ATTR)) return;
        element.setAttribute(PROCESSED_ATTR, 'true');

        var container = element.closest('pre') || element;
        container.style.position = 'relative';

        var wrapper = document.createElement('div');
        wrapper.className = 'aca-button-wrapper';

        var dismissBtn = document.createElement('button');
        dismissBtn.className = 'aca-dismiss-btn';
        dismissBtn.textContent = '\u00d7';
        dismissBtn.title = '\u9690\u85cf\u6b64\u6309\u94ae';
        dismissBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            wrapper.remove();
            element.setAttribute(PROCESSED_ATTR, 'dismissed');
        });

        var btn = document.createElement('button');
        btn.className = BUTTON_CLASS;
        btn.textContent = '\u26a1 \u5e94\u7528\u5230 VS Code (' + actions.length + ' \u4e2a\u6587\u4ef6)';
        btn.title = actions.map(function(a) { return a.action + ': ' + a.file; }).join('\n');

        var status = document.createElement('span');
        status.className = 'aca-status';

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            btn.textContent = '\u23f3 \u53d1\u9001\u4e2d...';
            sendToVSCode({ actions: actions }, function(response) {
                if (response && response.success) {
                    btn.textContent = '\u2705 \u5df2\u53d1\u9001\u5230 VS Code';
                    btn.classList.add('aca-success');
                    status.textContent = response.message || '';
                } else {
                    btn.textContent = '\u274c \u53d1\u9001\u5931\u8d25\uff08\u70b9\u51fb\u91cd\u8bd5\uff09';
                    btn.classList.add('aca-error');
                    btn.disabled = false;
                    status.textContent = response ? response.message : '\u65e0\u6cd5\u8fde\u63a5 VS Code';
                }
            });
        });

        wrapper.appendChild(dismissBtn);
        wrapper.appendChild(btn);
        wrapper.appendChild(status);

        if (container.nextSibling) {
            container.parentElement.insertBefore(wrapper, container.nextSibling);
        } else {
            container.parentElement.appendChild(wrapper);
        }
    }

    function addManualButton(element) {
        if (element.getAttribute(PROCESSED_ATTR)) return;
        element.setAttribute(PROCESSED_ATTR, 'true');

        var container = element.closest('pre') || element;
        container.style.position = 'relative';

        var btn = document.createElement('button');
        btn.className = BUTTON_CLASS + ' aca-manual-btn';
        btn.textContent = '\ud83d\udce4 VS Code';
        btn.style.cssText = 'position:absolute;top:5px;right:28px;z-index:100;';

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var code = element.textContent || '';
            if (!code.trim()) return;
            btn.disabled = true;
            btn.textContent = '\u23f3 ...';
            sendToVSCode({ text: code }, function(response) {
                if (response && response.success) {
                    btn.textContent = '\u2705 \u5df2\u53d1\u9001';
                    btn.classList.add('aca-success');
                } else {
                    btn.textContent = '\u274c \u91cd\u8bd5';
                    btn.classList.add('aca-error');
                    btn.disabled = false;
                }
            });
        });

        var closeBtn = document.createElement('button');
        closeBtn.className = 'aca-manual-close-btn';
        closeBtn.textContent = '\u00d7';
        closeBtn.title = '\u9690\u85cf';
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

    // ======================== 扫描逻辑 ========================
    var lastScanHash = '';

    function getPageCodeHash() {
        var els = document.querySelectorAll('pre, code');
        var total = 0;
        els.forEach(function(el) {
            if (!el.getAttribute(PROCESSED_ATTR)) {
                total += (el.textContent || '').length;
            }
        });
        return els.length + ':' + total;
    }

    function scanPage() {
        if (!extensionEnabled || !autoScanEnabled) return;

        var hash = getPageCodeHash();
        if (hash === lastScanHash) return;
        lastScanHash = hash;

        var processedParents = new Set();

        var codeEls = document.querySelectorAll('pre, code');
        codeEls.forEach(function(el) {
            if (el.getAttribute(PROCESSED_ATTR)) return;
            if (isCodeBlockHeader(el)) return;
            if (hasProcessedAncestor(el)) return;

            var text = el.textContent || '';
            if (text.trim().length < 10) return;

            var target;
            if (el.tagName === 'CODE') {
                target = el.closest('pre') || el;
            } else {
                target = el;
            }

            if (target.getAttribute(PROCESSED_ATTR)) return;
            if (processedParents.has(target)) return;
            processedParents.add(target);

            var actions = extractActions(text);
            if (actions.length > 0) {
                addApplyButton(target, actions);
            } else if (!looksLikeNonCode(text)) {
                addManualButton(target);
            }
        });

        document.querySelectorAll(
            'div[class*="message"], div[class*="response"], div[class*="answer"], article'
        ).forEach(function(el) {
            if (el.getAttribute(PROCESSED_ATTR)) return;
            var text = el.textContent || '';
            if (!looksLikeAction(text)) return;

            if (el.querySelector('.aca-button-wrapper')) {
                el.setAttribute(PROCESSED_ATTR, 'scan-parent');
                return;
            }

            var actions = extractActions(text);
            if (actions.length > 0) {
                var innerCode = el.querySelector('pre, code');
                if (innerCode && !innerCode.getAttribute(PROCESSED_ATTR)) {
                    var innerTarget = innerCode.closest('pre') || innerCode;
                    if (!innerTarget.getAttribute(PROCESSED_ATTR)) {
                        addApplyButton(innerTarget, actions);
                    }
                }
                el.setAttribute(PROCESSED_ATTR, 'scan-parent');
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
        scanTimeout = setTimeout(scanPage, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // ======================== 定时轮询兜底 ========================
    var pollInterval = null;
    function startPolling() {
        if (pollInterval) return;
        pollInterval = setInterval(function() {
            if (!extensionEnabled || !autoScanEnabled) return;
            scanPage();
        }, 3000);
    }
    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    // ======================== 选中文本浮动按钮 ========================
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
            if (text.length < 15) return;
            if (looksLikeNonCode(text)) return;

            var range = selection.getRangeAt(0);
            var rect = range.getBoundingClientRect();
            var btnTop = Math.max(rect.top - 44, 8);
            if (btnTop + 40 > window.innerHeight) {
                btnTop = Math.max(window.innerHeight - 50, 8);
            }
            var btnLeft = Math.min(Math.max(rect.left, 8), window.innerWidth - 220);

            floatingContainer = document.createElement('div');
            floatingContainer.className = 'aca-floating-container';
            floatingContainer.style.top = btnTop + 'px';
            floatingContainer.style.left = btnLeft + 'px';

            var sendBtn = document.createElement('button');
            sendBtn.className = 'aca-floating-send-btn';
            sendBtn.textContent = '\ud83d\udce4 \u53d1\u9001\u5230 VS Code';

            sendBtn.addEventListener('click', function(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                var actions = extractActions(text);
                sendBtn.textContent = '\u23f3 \u53d1\u9001\u4e2d...';
                sendBtn.disabled = true;

                if (actions.length > 0) {
                    sendToVSCode({ actions: actions }, function(resp) {
                        showNotification(
                            resp && resp.success
                                ? '\u2705 \u5df2\u53d1\u9001 ' + actions.length + ' \u4e2a\u64cd\u4f5c\u5230 VS Code'
                                : (resp ? resp.message : '\u8fde\u63a5\u5931\u8d25'),
                            resp && resp.success
                        );
                        removeFloatingBtn();
                    });
                } else {
                    sendToVSCode({ text: text }, function(resp) {
                        showNotification(
                            resp && resp.success
                                ? '\u2705 \u5df2\u53d1\u9001\uff08\u8bf7\u5728 VS Code \u4e2d\u6307\u5b9a\u6587\u4ef6\u8def\u5f84\uff09'
                                : (resp ? resp.message : '\u8fde\u63a5\u5931\u8d25'),
                            resp && resp.success
                        );
                        removeFloatingBtn();
                    });
                }
            });

            var closeBtn = document.createElement('button');
            closeBtn.className = 'aca-floating-close-btn';
            closeBtn.textContent = '\u00d7';
            closeBtn.title = '\u5173\u95ed (Esc)';
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

    // ======================== 开关控制 ========================
    function disableExtension() {
        extensionEnabled = false;
        stopPolling();
        removeFloatingBtn();
        document.querySelectorAll('.aca-button-wrapper').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-manual-btn').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-manual-close-btn').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-floating-container').forEach(function(el) { el.remove(); });
        document.querySelectorAll('.aca-notification').forEach(function(el) { el.remove(); });
        document.querySelectorAll('[' + PROCESSED_ATTR + ']').forEach(function(el) {
            el.removeAttribute(PROCESSED_ATTR);
        });
        lastScanHash = '';
    }

    function enableExtension() {
        extensionEnabled = true;
        lastScanHash = '';
        if (autoScanEnabled) {
            scanPage();
            startPolling();
        }
        if (!ws) wsConnect();
    }

    chrome.runtime.onMessage.addListener(function(message) {
        if (message.type === 'scan-page-only') {
            if (!extensionEnabled) return;
            lastScanHash = '';
            autoScanEnabled = true;
            scanPage();
            showNotification('\u5df2\u626b\u63cf\u9875\u9762\uff0c\u6309\u94ae\u5df2\u663e\u793a\u5728\u4ee3\u7801\u5757\u65c1', true);
            return;
        }
        if (message.type === 'scan-and-send-all') {
            if (!extensionEnabled) return;
            var allActions = [];
            document.querySelectorAll('pre, code').forEach(function(el) {
                extractActions(el.textContent || '').forEach(function(a) { allActions.push(a); });
            });
            if (allActions.length === 0) {
                showNotification('\u672a\u68c0\u6d4b\u5230\u53ef\u7528\u7684\u4ee3\u7801\u64cd\u4f5c\u6307\u4ee4', false);
                return;
            }
            sendToVSCode({ actions: allActions }, function(resp) {
                showNotification(
                    resp && resp.success
                        ? '\u5df2\u53d1\u9001 ' + allActions.length + ' \u4e2a\u64cd\u4f5c\u5230 VS Code'
                        : (resp ? resp.message : '\u8fde\u63a5\u5931\u8d25'),
                    resp && resp.success
                );
            });
        }
        if (message.type === 'show-notification') {
            showNotification(message.message, message.success);
        }
        if (message.type === 'toggle-auto-scan') {
            autoScanEnabled = message.enabled;
            if (autoScanEnabled && extensionEnabled) {
                lastScanHash = '';
                scanPage();
                startPolling();
            } else {
                stopPolling();
            }
        }
        if (message.type === 'toggle-extension') {
            if (message.enabled) { enableExtension(); } else { disableExtension(); }
        }
    });

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

    console.log('[AI Code Agent] Content script loaded. v1.2.1');

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
                    console.log('[AI Code Agent] WebSocket connected');
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
                resolve({ success: false, message: 'timeout' });
            }, 10000);
            pendingRequests.set(reqId, function(resp) {
                clearTimeout(timeout);
                pendingRequests.delete(reqId);
                resolve(resp);
            });
            if (!wsSend(data)) {
                clearTimeout(timeout);
                pendingRequests.delete(reqId);
                resolve({ success: false, message: 'not connected' });
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
                console.log('[AI Code Agent] VS Code workspace:', data.workspace);
                break;
            case 'inject-to-input':
                injectToAIInput(data.message);
                showNotification(
                    data.mode === 'error'
                        ? '\u2705 \u9519\u8bef\u4fe1\u606f\u5df2\u6ce8\u5165\u5230 AI \u8f93\u5165\u6846'
                        : '\u2705 \u5df2\u6ce8\u5165 ' + (data.mode === 'file' ? '\u6587\u4ef6' : '\u9009\u4e2d\u4ee3\u7801') + ' \u5230 AI \u8f93\u5165\u6846',
                    true
                );
                break;
            case 'progress':
                showNotification('\u23f3 [' + data.current + '/' + data.total + ']: ' + data.file, true);
                break;
            case 'done':
                showNotification('\ud83c\udf89 ' + data.summary, true);
                break;
            case 'history-updated':
                chrome.runtime.sendMessage({ type: 'history-updated', history: data.history });
                break;
        }
    }

    function injectToAIInput(text) {
        var selectors = [
            'textarea[placeholder*="message" i]',
            'textarea[placeholder*="\u6d88\u606f" i]',
            'textarea[placeholder*="\u8f93\u5165" i]',
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
            showNotification('\u274c \u672a\u627e\u5230 AI \u8f93\u5165\u6846\uff0c\u8bf7\u624b\u52a8\u7c98\u8d34', false);
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
