document.addEventListener('DOMContentLoaded', function() {

    var statusDot       = document.getElementById('status-dot');
    var statusLabel     = document.getElementById('status-label');
    var workspaceInfo   = document.getElementById('workspace-info');
    var refreshBtn      = document.getElementById('refresh-btn');
    var autoJumpToggle  = document.getElementById('auto-jump-toggle');
    var autoScanToggle  = document.getElementById('auto-scan-toggle');
    var portInput       = document.getElementById('port-input');
    var savePortBtn     = document.getElementById('save-port-btn');
    var pathInput       = document.getElementById('path-input');
    var addPathBtn      = document.getElementById('add-path-btn');
    var projectList     = document.getElementById('project-list');
    var manualText      = document.getElementById('manual-text');
    var manualSendBtn   = document.getElementById('manual-send-btn');
    var resultDiv       = document.getElementById('result');
    var btnScan         = document.getElementById('btn-scan');
    var btnRestart      = document.getElementById('btn-restart');
    var btnUndo         = document.getElementById('btn-undo');
    var btnOpenLog      = document.getElementById('btn-open-log');
    var extEnabledToggle  = document.getElementById('extension-enabled-toggle');
    var masterToggleCard  = document.getElementById('master-toggle-card');
    var masterHint        = document.getElementById('master-hint');
    var mainContent       = document.getElementById('main-content');
    var btnCopyPrompt     = document.getElementById('btn-copy-prompt');

    var currentWorkspace = '';
    var discoveredInstances = [];

    var PROMPT_TEMPLATE = '\u4f60\u597d\uff0c\u8bf7\u5728\u540e\u7eed\u5bf9\u8bdd\u4e2d\uff0c\u5f53\u6d89\u53ca\u4ee3\u7801\u6587\u4ef6\u7684\u521b\u5efa\u3001\u4fee\u6539\u6216\u5220\u9664\u65f6\uff0c\u4e25\u683c\u6309\u7167\u4ee5\u4e0b\u683c\u5f0f\u8f93\u51fa\u3002\n\n' +
        '## \u683c\u5f0f\u89c4\u8303\n\n' +
        '\u6240\u6709\u4ee3\u7801\u64cd\u4f5c\u6307\u4ee4\u5fc5\u987b\u5305\u88f9\u5728 ```agent-action \u4ee3\u7801\u5757\u4e2d\uff0c\u5185\u5bb9\u662f\u6807\u51c6 JSON\u3002\n\n' +
        '### 1. \u521b\u5efa\u65b0\u6587\u4ef6 \u6216 \u5b8c\u6574\u66ff\u6362\u73b0\u6709\u6587\u4ef6\uff08\u63a8\u8350\uff09\n\n' +
        '```agent-action\n' +
        '{\n' +
        '  "action": "write",\n' +
        '  "file": "\u76f8\u5bf9\u8def\u5f84/\u6587\u4ef6\u540d.\u6269\u5c55\u540d",\n' +
        '  "content": "\u5b8c\u6574\u7684\u6587\u4ef6\u5185\u5bb9..."\n' +
        '}\n' +
        '```\n\n' +
        '### 2. \u5c40\u90e8\u4fee\u6539\u73b0\u6709\u6587\u4ef6\uff08\u4ec5\u7528\u4e8e\u8d85\u8fc7 100 \u884c\u7684\u5927\u6587\u4ef6\uff09\n\n' +
        '```agent-action\n' +
        '{\n' +
        '  "action": "patch",\n' +
        '  "file": "\u76f8\u5bf9\u8def\u5f84/\u6587\u4ef6\u540d.\u6269\u5c55\u540d",\n' +
        '  "patches": [\n' +
        '    {\n' +
        '      "find": "\u8981\u66ff\u6362\u7684\u4ee3\u7801\uff082-3\u884c\u7b80\u5355\u4ee3\u7801\uff09",\n' +
        '      "replace": "\u66ff\u6362\u540e\u7684\u4ee3\u7801"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '```\n\n' +
        '### 3. \u5220\u9664\u6587\u4ef6\n\n' +
        '```agent-action\n' +
        '{\n' +
        '  "action": "delete",\n' +
        '  "file": "\u76f8\u5bf9\u8def\u5f84/\u6587\u4ef6\u540d.\u6269\u5c55\u540d"\n' +
        '}\n' +
        '```\n\n' +
        '## \u91cd\u8981\u89c4\u5219\n\n' +
        '1. \u6587\u4ef6 < 100 \u884c \u2192 \u7528 write \u8f93\u51fa\u5b8c\u6574\u5185\u5bb9\n' +
        '2. find \u5b57\u6bb5\u53ea\u5199 2-3 \u884c\u7b80\u5355\u4ee3\u7801\uff0c\u4e0d\u542b\u5f15\u53f7\u3001\u53cd\u659c\u6760\u3001\u4e09\u5f15\u53f7\u3001\u6b63\u5219\n' +
        '3. \u9047\u5230\u590d\u6742\u8f6c\u4e49\u5b57\u7b26\u7684\u4ee3\u7801 \u2192 \u76f4\u63a5\u7528 write \u4e0d\u8981\u7528 patch\n' +
        '4. \u7edd\u5bf9\u4e0d\u8981\u7701\u7565\u4ee3\u7801\n' +
        '5. \u6587\u4ef6\u8def\u5f84\u4f7f\u7528 / \u5206\u9694\n\n' +
        '\u8bf7\u786e\u8ba4\u4f60\u7406\u89e3\u4e86\u4ee5\u4e0a\u683c\u5f0f\u8981\u6c42\u3002';

    // \u5c1d\u8bd5\u4ece\u5916\u90e8\u6587\u4ef6\u52a0\u8f7d\u63d0\u793a\u8bcd
    try {
        fetch(chrome.runtime.getURL('prompt-template.txt'))
            .then(function(r) { return r.text(); })
            .then(function(t) { if (t && t.trim().length > 50) PROMPT_TEMPLATE = t; })
            .catch(function() {});
    } catch (_) {}

    btnCopyPrompt.addEventListener('click', function() {
        navigator.clipboard.writeText(PROMPT_TEMPLATE).then(function() {
            btnCopyPrompt.textContent = '\u2705 \u5df2\u590d\u5236\uff01\u7c98\u8d34\u5230 AI \u5bf9\u8bdd\u7684\u7b2c\u4e00\u6761\u6d88\u606f';
            btnCopyPrompt.classList.add('copied');
            setTimeout(function() {
                btnCopyPrompt.textContent = '\ud83d\udccb \u4e00\u952e\u590d\u5236 AI \u63d0\u793a\u8bcd';
                btnCopyPrompt.classList.remove('copied');
            }, 3000);
        }).catch(function() {
            var ta = document.createElement('textarea');
            ta.value = PROMPT_TEMPLATE;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            btnCopyPrompt.textContent = '\u2705 \u5df2\u590d\u5236\uff01';
            setTimeout(function() {
                btnCopyPrompt.textContent = '\ud83d\udccb \u4e00\u952e\u590d\u5236 AI \u63d0\u793a\u8bcd';
            }, 3000);
        });
    });

    chrome.storage.local.get(
        ['serverPort', 'autoJump', 'autoScan', 'savedProjects', 'extensionEnabled'],
        function(result) {
            if (result.serverPort) portInput.value = result.serverPort;
            autoJumpToggle.checked = result.autoJump !== false;
            autoScanToggle.checked = result.autoScan !== false;
            var enabled = result.extensionEnabled !== false;
            extEnabledToggle.checked = enabled;
            updateMasterToggleUI(enabled);
            renderProjectList(result.savedProjects || []);
        }
    );

    checkConnection();

    function updateMasterToggleUI(enabled) {
        if (enabled) {
            mainContent.classList.remove('disabled');
            masterToggleCard.classList.remove('disabled');
            masterHint.textContent = '\u63d2\u4ef6\u5df2\u542f\u7528\uff0c\u6b63\u5728\u76d1\u63a7\u9875\u9762';
        } else {
            mainContent.classList.add('disabled');
            masterToggleCard.classList.add('disabled');
            masterHint.textContent = '\u63d2\u4ef6\u5df2\u5173\u95ed\uff0c\u9875\u9762\u4e0a\u7684\u6309\u94ae\u5df2\u5168\u90e8\u79fb\u9664';
        }
    }

    extEnabledToggle.addEventListener('change', function() {
        var enabled = extEnabledToggle.checked;
        chrome.storage.local.set({ extensionEnabled: enabled });
        updateMasterToggleUI(enabled);
        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(tab) {
                try {
                    chrome.tabs.sendMessage(tab.id, { type: 'toggle-extension', enabled: enabled });
                } catch (_) {}
            });
        });
        showResult(enabled ? '\u2705 \u63d2\u4ef6\u5df2\u542f\u7528' : '\u23f8 \u63d2\u4ef6\u5df2\u5173\u95ed', enabled);
    });

    // ========== \u591a\u7a97\u53e3\u7aef\u53e3\u626b\u63cf ==========
    function scanAllPorts(callback) {
        chrome.storage.local.get(['serverPort'], function(r) {
            var basePort = r.serverPort || 9960;
            var instances = [];
            var pending = 10;
            for (var i = 0; i < 10; i++) {
                (function(port) {
                    fetch('http://127.0.0.1:' + port + '/status', { signal: AbortSignal.timeout(500) })
                        .then(function(resp) { return resp.json(); })
                        .then(function(data) {
                            instances.push({ port: port, workspace: data.workspace || '', wsClients: data.wsClients || 0 });
                        })
                        .catch(function() {})
                        .finally(function() {
                            pending--;
                            if (pending === 0) {
                                instances.sort(function(a, b) { return a.port - b.port; });
                                discoveredInstances = instances;
                                callback(instances);
                            }
                        });
                })(basePort + i);
            }
        });
    }

    function checkConnection() {
        statusLabel.textContent = '\u68c0\u67e5\u4e2d...';
        scanAllPorts(function(instances) {
            if (instances.length === 0) {
                statusDot.className = 'dot dot-red';
                statusLabel.textContent = '\u672a\u8fde\u63a5 \u2014 \u68c0\u67e5 VS Code \u6269\u5c55\u662f\u5426\u542f\u52a8';
                workspaceInfo.textContent = '';
                currentWorkspace = '';
                renderProjectList();
                return;
            }
            var active = instances[0];
            statusDot.className = 'dot dot-green';
            if (instances.length === 1) {
                statusLabel.textContent = 'VS Code \u5df2\u8fde\u63a5';
            } else {
                statusLabel.textContent = 'VS Code \u5df2\u8fde\u63a5\uff08\u53d1\u73b0 ' + instances.length + ' \u4e2a\u7a97\u53e3\uff09';
            }
            currentWorkspace = active.workspace;
            workspaceInfo.textContent = currentWorkspace ? '\ud83d\udcc2 ' + currentWorkspace : '';
            if (instances.length > 1) renderInstanceList(instances);
            renderProjectList();
        });
    }

    function renderInstanceList(instances) {
        var existingList = document.getElementById('instance-list-section');
        if (existingList) existingList.remove();
        var section = document.createElement('div');
        section.id = 'instance-list-section';
        section.style.cssText = 'background:#313244;border-radius:8px;padding:10px 12px;margin-bottom:10px;';
        var title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = '\ud83e\ude9f \u591a\u7a97\u53e3\u5207\u6362';
        section.appendChild(title);
        instances.forEach(function(inst) {
            var item = document.createElement('div');
            var isActive = inst.workspace === currentWorkspace;
            item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-top:4px;background:#1e1e2e;border-radius:5px;font-size:11px;cursor:pointer;border:1px solid ' + (isActive ? '#89b4fa' : 'transparent') + ';';
            var name = document.createElement('span');
            name.style.cssText = 'font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + (isActive ? '#89b4fa' : '#cdd6f4') + ';';
            var folderName = inst.workspace.split(/[\/\\]/).pop() || inst.workspace;
            name.textContent = (isActive ? '\u25cf ' : '\u25cb ') + folderName;
            name.title = inst.workspace + ' (\u7aef\u53e3 ' + inst.port + ')';
            var portLabel = document.createElement('span');
            portLabel.style.cssText = 'color:#6c7086;font-size:10px;flex-shrink:0;margin-left:8px;';
            portLabel.textContent = ':' + inst.port;
            item.appendChild(name);
            item.appendChild(portLabel);
            item.addEventListener('click', function() {
                chrome.storage.local.set({ serverPort: inst.port }, function() {
                    portInput.value = inst.port;
                    currentWorkspace = inst.workspace;
                    showResult('\u2705 \u5df2\u5207\u6362\u5230: ' + folderName + ' (\u7aef\u53e3 ' + inst.port + ')', true);
                    checkConnection();
                });
            });
            section.appendChild(item);
        });
        var statusCard = document.querySelector('.status-card');
        if (statusCard && statusCard.nextSibling) {
            statusCard.parentElement.insertBefore(section, statusCard.nextSibling);
        }
    }

    refreshBtn.addEventListener('click', checkConnection);

    autoJumpToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoJump: autoJumpToggle.checked });
        chrome.runtime.sendMessage({ type: 'update-setting', key: 'autoJump', value: autoJumpToggle.checked });
        showResult(autoJumpToggle.checked ? '\u5df2\u5f00\u542f\u81ea\u52a8\u8df3\u8f6c' : '\u5df2\u5173\u95ed\u81ea\u52a8\u8df3\u8f6c', true);
    });

    autoScanToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoScan: autoScanToggle.checked });
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle-auto-scan', enabled: autoScanToggle.checked });
            }
        });
        showResult(autoScanToggle.checked ? '\u5df2\u5f00\u542f\u81ea\u52a8\u68c0\u6d4b' : '\u5df2\u5173\u95ed\u81ea\u52a8\u68c0\u6d4b', true);
    });

    savePortBtn.addEventListener('click', function() {
        var port = parseInt(portInput.value, 10);
        if (port >= 1024 && port <= 65535) {
            chrome.storage.local.set({ serverPort: port }, function() {
                showResult('\u7aef\u53e3\u5df2\u4fdd\u5b58\u4e3a ' + port, true);
                checkConnection();
            });
        } else {
            showResult('\u7aef\u53e3\u53f7\u65e0\u6548\uff081024~65535\uff09', false);
        }
    });

    btnScan.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'scan-page-only' });
                showResult('\u5df2\u89e6\u53d1\u9875\u9762\u626b\u63cf\uff0c\u6309\u94ae\u5c06\u663e\u793a\u5728\u4ee3\u7801\u5757\u65c1', true);
            }
        });
    });

    btnRestart.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'restart-server' }, function(resp) {
            showResult(resp && resp.success ? '\u91cd\u542f\u6307\u4ee4\u5df2\u53d1\u9001' : '\u53d1\u9001\u5931\u8d25', resp && resp.success);
            setTimeout(checkConnection, 2000);
        });
    });

    btnUndo.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'undo-last-change' }, function(resp) {
            showResult(resp && resp.success ? '\u64a4\u9500\u6307\u4ee4\u5df2\u53d1\u9001' : (resp ? resp.message : '\u5931\u8d25'), resp && resp.success);
        });
    });

    btnOpenLog.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'open-log' }, function() {
            showResult('\u5df2\u53d1\u9001\u6253\u5f00\u65e5\u5fd7\u6307\u4ee4', true);
        });
    });

    // ========== \u590d\u5236\u6700\u8fd1AI\u56de\u590d ==========
    var btnCopyReply = document.getElementById('btn-copy-reply');
    if (btnCopyReply) {
        btnCopyReply.addEventListener('click', function() {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (!tabs[0]) return;
                chrome.tabs.sendMessage(tabs[0].id, { type: 'collect-last-reply' }, function(resp) {
                    if (resp && resp.text) {
                        navigator.clipboard.writeText(resp.text).then(function() {
                            showResult('\u2705 \u5df2\u590d\u5236\u6700\u8fd1AI\u56de\u590d\uff08' + resp.text.length + '\u5b57\u7b26\uff09\uff0c\u7c98\u8d34\u7ed9AI\u5373\u53ef', true);
                        }).catch(function() {
                            showResult('\u274c \u590d\u5236\u5931\u8d25', false);
                        });
                    } else {
                        showResult('\u274c \u672a\u627e\u5230AI\u56de\u590d\u5185\u5bb9', false);
                    }
                });
            });
        });
    }

    // ========== \u6536\u96c6\u8c03\u8bd5\u4fe1\u606f ==========
    var btnDebugInfo = document.getElementById('btn-debug-info');
    if (btnDebugInfo) {
        btnDebugInfo.addEventListener('click', function() {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (!tabs[0]) return;
                chrome.tabs.sendMessage(tabs[0].id, { type: 'collect-debug-info' }, function(resp) {
                    var info = '=== AI Code Agent \u8c03\u8bd5\u4fe1\u606f ===\n';
                    info += '\u9875\u9762: ' + tabs[0].url + '\n';
                    if (resp) {
                        info += '\u63d2\u4ef6\u7248\u672c: ' + (resp.version || '\u672a\u77e5') + '\n';
                        info += '\u63d2\u4ef6\u72b6\u6001: ' + (resp.enabled ? '\u542f\u7528' : '\u7981\u7528') + '\n';
                        info += '\u81ea\u52a8\u626b\u63cf: ' + (resp.autoScan ? '\u5f00' : '\u5173') + '\n';
                        info += 'WebSocket: ' + (resp.wsConnected ? '\u5df2\u8fde\u63a5' : '\u672a\u8fde\u63a5') + '\n';
                        info += '\u4ee3\u7801\u5757\u603b\u6570: ' + resp.codeBlockCount + '\n';
                        info += '\u5df2\u5904\u7406\u6570: ' + resp.processedCount + '\n';
                        info += '\u6309\u94ae\u6570: ' + resp.buttonCount + '\n';
                        info += '\u672a\u5904\u7406\u4ee3\u7801\u5757: ' + resp.unprocessedCount + '\n';
                        if (resp.unprocessedSamples && resp.unprocessedSamples.length > 0) {
                            info += '\n--- \u672a\u5904\u7406\u7684\u4ee3\u7801\u5757\u793a\u4f8b ---\n';
                            resp.unprocessedSamples.forEach(function(s, i) {
                                info += '[' + (i+1) + '] (' + s.tag + ', ' + s.length + '\u5b57\u7b26): ' + s.preview + '\n';
                            });
                        }
                    } else {
                        info += '\u72b6\u6001: content.js \u672a\u54cd\u5e94\uff08\u53ef\u80fd\u672a\u52a0\u8f7d\uff09\n';
                    }
                    info += '=== END ===';
                    navigator.clipboard.writeText(info).then(function() {
                        showResult('\u2705 \u8c03\u8bd5\u4fe1\u606f\u5df2\u590d\u5236\uff0c\u7c98\u8d34\u7ed9AI\u5373\u53ef', true);
                    }).catch(function() {
                        showResult('\u274c \u590d\u5236\u5931\u8d25', false);
                    });
                });
            });
        });
    }

    var btnReloadPage = document.getElementById('btn-reload-page');
    if (btnReloadPage) {
        btnReloadPage.addEventListener('click', function() {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0]) {
                    chrome.tabs.reload(tabs[0].id);
                    showResult('\u9875\u9762\u5df2\u5237\u65b0', true);
                }
            });
        });
    }

    var btnReloadExt = document.getElementById('btn-reload-ext');
    if (btnReloadExt) {
        btnReloadExt.addEventListener('click', function() {
            showResult('\u63d2\u4ef6\u91cd\u8f7d\u4e2d...', true);
            setTimeout(function() { chrome.runtime.reload(); }, 500);
        });
    }

    function getSavedProjects(callback) {
        chrome.storage.local.get(['savedProjects'], function(r) { callback(r.savedProjects || []); });
    }
    function saveProjects(projects) {
        chrome.storage.local.set({ savedProjects: projects });
    }

    function renderProjectList(projects) {
        if (projects === undefined) { getSavedProjects(renderProjectList); return; }
        projectList.innerHTML = '';
        if (projects.length === 0) {
            projectList.innerHTML = '<div style="color:#6c7086;font-size:11px;padding:4px 0">\u6682\u65e0\u4fdd\u5b58\u7684\u9879\u76ee\u8def\u5f84</div>';
            return;
        }
        projects.forEach(function(p, i) {
            var item = document.createElement('div');
            item.className = 'project-item' + (p === currentWorkspace ? ' active' : '');
            var name = document.createElement('span');
            name.className = 'project-item-name';
            name.textContent = p;
            name.title = p;
            name.addEventListener('click', function() {
                chrome.runtime.sendMessage({ type: 'switch-workspace', path: p }, function(resp) {
                    showResult(resp && resp.success ? '\u5df2\u5207\u6362: ' + p : (resp ? resp.message : '\u5931\u8d25'), resp && resp.success);
                    setTimeout(checkConnection, 1500);
                });
            });
            var del = document.createElement('span');
            del.className = 'project-item-del';
            del.textContent = '\u00d7';
            del.title = '\u5220\u9664';
            del.addEventListener('click', function(e) {
                e.stopPropagation();
                getSavedProjects(function(list) {
                    list.splice(i, 1);
                    saveProjects(list);
                    renderProjectList(list);
                });
            });
            item.appendChild(name);
            item.appendChild(del);
            projectList.appendChild(item);
        });
    }

    addPathBtn.addEventListener('click', function() {
        var p = pathInput.value.trim();
        if (!p) { showResult('\u8bf7\u8f93\u5165\u8def\u5f84', false); return; }
        getSavedProjects(function(list) {
            if (list.includes(p)) { showResult('\u8def\u5f84\u5df2\u5b58\u5728', false); return; }
            list.push(p);
            saveProjects(list);
            renderProjectList(list);
            pathInput.value = '';
            showResult('\u8def\u5f84\u5df2\u6dfb\u52a0', true);
        });
    });

    pathInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addPathBtn.click(); });

    manualSendBtn.addEventListener('click', function() {
        var text = manualText.value.trim();
        if (!text) { showResult('\u8bf7\u8f93\u5165\u6587\u672c', false); return; }
        manualSendBtn.disabled = true;
        manualSendBtn.textContent = '\u23f3 \u53d1\u9001\u4e2d...';
        chrome.runtime.sendMessage({ type: 'send-raw-text', text: text }, function(response) {
            manualSendBtn.disabled = false;
            manualSendBtn.textContent = '\ud83d\udce4 \u53d1\u9001\u5230 VS Code';
            if (response && response.success) {
                showResult(response.message || '\u5df2\u53d1\u9001', true);
                manualText.value = '';
            } else {
                showResult(response ? response.message : '\u53d1\u9001\u5931\u8d25', false);
            }
        });
    });

    function showResult(msg, success) {
        resultDiv.textContent = msg;
        resultDiv.className = success ? 'result result-success' : 'result result-error';
        clearTimeout(resultDiv._t);
        resultDiv._t = setTimeout(function() { resultDiv.className = 'result'; }, 4000);
    }

    // ========== \u64cd\u4f5c\u5386\u53f2 ==========
    var historySection = document.createElement('div');
    historySection.className = 'manual-section';
    historySection.style.marginBottom = '10px';
    historySection.innerHTML =
        '<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>\ud83d\udcdc \u64cd\u4f5c\u5386\u53f2</span>' +
        '<span id="history-count" style="color:#6c7086;font-size:10px"></span>' +
        '</div>' +
        '<div id="history-list" style="max-height:120px;overflow-y:auto;margin-top:6px"></div>' +
        '<button id="clear-history-btn" style="' +
        'width:100%;margin-top:6px;padding:5px;border:none;border-radius:5px;' +
        'background:#45475a;color:#cdd6f4;font-size:11px;cursor:pointer' +
        '">\ud83d\uddd1 \u6e05\u7a7a\u5386\u53f2</button>';
    var manualSectionEl = document.querySelector('.manual-section');
    if (manualSectionEl) {
        manualSectionEl.parentNode.insertBefore(historySection, manualSectionEl);
    }

    var historyList     = document.getElementById('history-list');
    var historyCount    = document.getElementById('history-count');
    var clearHistoryBtn = document.getElementById('clear-history-btn');

    function renderHistory(items) {
        if (!items || items.length === 0) {
            historyList.innerHTML = '<div style="color:#6c7086;font-size:11px;padding:4px">\u6682\u65e0\u64cd\u4f5c\u8bb0\u5f55</div>';
            historyCount.textContent = '';
            return;
        }
        historyCount.textContent = '\u5171 ' + items.length + ' \u6761';
        historyList.innerHTML = items.map(function(item) {
            var icon = item.accepted ? '\u2705' : '\u274c';
            var colors = { write:'#89b4fa', create:'#a6e3a1', patch:'#fab387', delete:'#f38ba8', update:'#89dceb' };
            var c = colors[item.action] || '#cdd6f4';
            var t = (item.timeStr || '').split(' ')[1] || '';
            return '<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;margin-bottom:2px;background:#1e1e2e;font-size:11px" title="' + (item.timeStr||'') + '">' +
                '<span>' + icon + '</span>' +
                '<span style="color:' + c + ';flex-shrink:0">' + item.action + '</span>' +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;color:#cdd6f4">' + item.file + '</span>' +
                '<span style="color:#6c7086;flex-shrink:0;font-size:10px">' + t + '</span>' +
                '</div>';
        }).join('');
    }

    chrome.runtime.sendMessage({ type: 'get-history' }, function(resp) {
        if (resp && resp.history) renderHistory(resp.history);
    });

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', function() {
            chrome.runtime.sendMessage({ type: 'clear-history' }, function() {
                renderHistory([]);
                showResult('\u5386\u53f2\u5df2\u6e05\u7a7a', true);
            });
        });
    }

    chrome.runtime.onMessage.addListener(function(msg) {
        if (msg.type === 'history-updated') renderHistory(msg.history);
    });

});
