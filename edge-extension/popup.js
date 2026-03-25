document.addEventListener('DOMContentLoaded', function() {

    var statusDot       = document.getElementById('status-dot');
    var statusLabel     = document.getElementById('status-label');
    var workspaceInfo   = document.getElementById('workspace-info');
    var refreshBtn      = document.getElementById('refresh-btn');
    var autoJumpToggle  = document.getElementById('auto-jump-toggle');
    var autoScanToggle  = document.getElementById('auto-scan-toggle');
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
    var instanceListSection = document.getElementById('instance-list-section');

    var currentWorkspace = '';
    var currentPort = 9960;
    var discoveredInstances = [];

    var PROMPT_TEMPLATE = '';
    try {
        fetch(chrome.runtime.getURL('prompt-template.txt'))
            .then(function(r) { return r.text(); })
            .then(function(t) { if (t && t.trim().length > 50) PROMPT_TEMPLATE = t; })
            .catch(function() {});
    } catch (_) {}
    // Fallback
    setTimeout(function() {
        if (!PROMPT_TEMPLATE) {
            PROMPT_TEMPLATE = '\u8bf7\u5728\u540e\u7eed\u5bf9\u8bdd\u4e2d\u4f7f\u7528 agent-action \u683c\u5f0f\u8f93\u51fa\u4ee3\u7801\u64cd\u4f5c\u3002';
        }
    }, 1000);

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
            if (result.serverPort) currentPort = result.serverPort;
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
        var basePort = 9960;
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
    }

    function checkConnection() {
        statusLabel.textContent = '\u68c0\u67e5\u4e2d...';
        scanAllPorts(function(instances) {
            if (instances.length === 0) {
                statusDot.className = 'dot dot-red';
                statusLabel.textContent = '\u672a\u8fde\u63a5 \u2014 \u68c0\u67e5 VS Code \u6269\u5c55\u662f\u5426\u542f\u52a8';
                workspaceInfo.textContent = '';
                currentWorkspace = '';
                instanceListSection.innerHTML = '';
                renderProjectList();
                return;
            }

            // \u627e\u5230\u5f53\u524d\u7aef\u53e3\u5bf9\u5e94\u7684\u5b9e\u4f8b\uff0c\u5982\u679c\u5f53\u524d\u7aef\u53e3\u4e0d\u5728\u5217\u8868\u4e2d\u5219\u7528\u7b2c\u4e00\u4e2a
            var active = instances.find(function(inst) { return inst.port === currentPort; }) || instances[0];
            currentPort = active.port;
            currentWorkspace = active.workspace;

            chrome.storage.local.set({ serverPort: currentPort });

            statusDot.className = 'dot dot-green';
            if (instances.length === 1) {
                statusLabel.textContent = 'VS Code \u5df2\u8fde\u63a5 (\u7aef\u53e3:' + currentPort + ')';
            } else {
                statusLabel.textContent = instances.length + ' \u4e2a VS Code \u7a97\u53e3 (\u5f53\u524d:' + currentPort + ')';
            }

            var folderName = currentWorkspace.split(/[\/\\]/).pop() || currentWorkspace;
            workspaceInfo.textContent = currentWorkspace ? '\ud83d\udcc2 ' + folderName : '';
            workspaceInfo.title = currentWorkspace;

            renderInstanceList(instances);
            renderProjectList();
        });
    }

    function renderInstanceList(instances) {
        instanceListSection.innerHTML = '';
        if (instances.length <= 1) return;

        var title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = '\u70b9\u51fb\u5207\u6362\u76ee\u6807\u7a97\u53e3\uff08\u4ee3\u7801\u53d1\u5230\u54ea\u4e2a VS Code\uff09';
        instanceListSection.appendChild(title);

        instances.forEach(function(inst) {
            var item = document.createElement('div');
            var isActive = inst.port === currentPort;
            item.className = 'instance-item' + (isActive ? ' active' : '');

            var name = document.createElement('span');
            name.className = 'instance-name';
            var folderName = inst.workspace.split(/[\/\\]/).pop() || inst.workspace;
            name.textContent = (isActive ? '\u25cf ' : '\u25cb ') + folderName;
            name.title = inst.workspace;
            name.style.color = isActive ? '#89b4fa' : '#cdd6f4';

            var portLabel = document.createElement('span');
            portLabel.className = 'instance-port';
            portLabel.textContent = ':' + inst.port;

            item.appendChild(name);
            item.appendChild(portLabel);

            item.addEventListener('click', function() {
                currentPort = inst.port;
                currentWorkspace = inst.workspace;
                chrome.storage.local.set({ serverPort: inst.port });

                // \u901a\u77e5\u6240\u6709\u9875\u9762\u7684 content.js \u91cd\u8fde WebSocket
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(function(tab) {
                        try {
                            chrome.tabs.sendMessage(tab.id, { type: 'reconnect-ws', port: inst.port });
                        } catch (_) {}
                    });
                });

                showResult('\u2705 \u5df2\u5207\u6362\u5230: ' + folderName + ' (:' + inst.port + ')', true);
                renderInstanceList(instances);

                var fn = inst.workspace.split(/[\/\\]/).pop() || inst.workspace;
                statusLabel.textContent = instances.length + ' \u4e2a VS Code \u7a97\u53e3 (\u5f53\u524d:' + inst.port + ')';
                workspaceInfo.textContent = '\ud83d\udcc2 ' + fn;
                workspaceInfo.title = inst.workspace;
            });

            instanceListSection.appendChild(item);
        });
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

    btnScan.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'scan-page-only' });
                showResult('\u5df2\u89e6\u53d1\u9875\u9762\u626b\u63cf', true);
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
                            showResult('\u2705 \u5df2\u590d\u5236(' + resp.text.length + '\u5b57\u7b26)', true);
                        }).catch(function() { showResult('\u274c \u590d\u5236\u5931\u8d25', false); });
                    } else {
                        showResult('\u274c \u672a\u627e\u5230AI\u56de\u590d', false);
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
                    var info = '=== AI Code Agent ===\n';
                    info += 'Page: ' + tabs[0].url + '\n';
                    info += 'Port: ' + currentPort + '\n';
                    info += 'Workspace: ' + currentWorkspace + '\n';
                    info += 'Instances: ' + discoveredInstances.length + '\n';
                    if (resp) {
                        info += 'Version: ' + (resp.version || '?') + '\n';
                        info += 'Enabled: ' + resp.enabled + '\n';
                        info += 'AutoScan: ' + resp.autoScan + '\n';
                        info += 'WS: ' + resp.wsConnected + '\n';
                        info += 'CodeBlocks: ' + resp.codeBlockCount + '\n';
                        info += 'Processed: ' + resp.processedCount + '\n';
                        info += 'Buttons: ' + resp.buttonCount + '\n';
                        info += 'Unprocessed: ' + resp.unprocessedCount + '\n';
                        if (resp.unprocessedSamples && resp.unprocessedSamples.length > 0) {
                            info += '--- samples ---\n';
                            resp.unprocessedSamples.forEach(function(s, i) {
                                info += (i+1) + '. ' + s.tag + '(' + s.length + '): ' + s.preview + '\n';
                            });
                        }
                    } else {
                        info += 'content.js: not loaded\n';
                    }
                    navigator.clipboard.writeText(info).then(function() {
                        showResult('\u2705 \u8c03\u8bd5\u4fe1\u606f\u5df2\u590d\u5236', true);
                    }).catch(function() { showResult('\u274c \u590d\u5236\u5931\u8d25', false); });
                });
            });
        });
    }

    var btnReloadPage = document.getElementById('btn-reload-page');
    if (btnReloadPage) {
        btnReloadPage.addEventListener('click', function() {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0]) { chrome.tabs.reload(tabs[0].id); showResult('\u9875\u9762\u5df2\u5237\u65b0', true); }
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

    // ========== \u9879\u76ee\u5feb\u6377\u65b9\u5f0f ==========
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
            // \u68c0\u67e5\u8fd9\u4e2a\u8def\u5f84\u662f\u5426\u5df2\u7ecf\u5728\u67d0\u4e2a VS Code \u7a97\u53e3\u4e2d\u6253\u5f00
            var matchedInstance = discoveredInstances.find(function(inst) {
                return inst.workspace && (inst.workspace === p || inst.workspace.replace(/\\/g, '/') === p.replace(/\\/g, '/'));
            });
            var isOpen = !!matchedInstance;
            item.className = 'project-item' + (isOpen ? ' active' : '');

            var name = document.createElement('span');
            name.className = 'project-item-name';
            var folderName = p.split(/[\/\\]/).pop() || p;
            name.textContent = (isOpen ? '\u25cf ' : '') + folderName;
            name.title = p + (isOpen ? ' (\u5df2\u5728 :' + matchedInstance.port + ' \u6253\u5f00)' : ' (\u70b9\u51fb\u5728\u65b0\u7a97\u53e3\u6253\u5f00)');

            name.addEventListener('click', function() {
                if (isOpen) {
                    // \u5df2\u6253\u5f00 \u2192 \u5207\u6362\u5230\u8be5\u7a97\u53e3
                    currentPort = matchedInstance.port;
                    currentWorkspace = matchedInstance.workspace;
                    chrome.storage.local.set({ serverPort: matchedInstance.port });
                    chrome.tabs.query({}, function(tabs) {
                        tabs.forEach(function(tab) {
                            try { chrome.tabs.sendMessage(tab.id, { type: 'reconnect-ws', port: matchedInstance.port }); } catch (_) {}
                        });
                    });
                    showResult('\u2705 \u5df2\u5207\u6362\u5230: ' + folderName + ' (:' + matchedInstance.port + ')', true);
                    checkConnection();
                } else {
                    // \u672a\u6253\u5f00 \u2192 \u7528 VS Code \u5728\u65b0\u7a97\u53e3\u6253\u5f00
                    // \u901a\u8fc7\u547d\u4ee4\u884c\u6253\u5f00\u65b0\u7a97\u53e3
                    fetch('http://127.0.0.1:' + currentPort + '/open-folder-new-window', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: p })
                    }).then(function(resp) { return resp.json(); }).then(function(data) {
                        if (data.success) {
                            showResult('\u2705 \u5df2\u5728\u65b0\u7a97\u53e3\u6253\u5f00: ' + folderName, true);
                            setTimeout(checkConnection, 3000);
                        } else {
                            showResult('\u274c ' + (data.message || '\u6253\u5f00\u5931\u8d25'), false);
                        }
                    }).catch(function() {
                        showResult('\u274c \u65e0\u6cd5\u8fde\u63a5 VS Code', false);
                    });
                }
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
