document.addEventListener('DOMContentLoaded', function() {
    var statusDot = document.getElementById('status-dot');
    var statusLabel = document.getElementById('status-label');
    var workspaceName = document.getElementById('workspace-name');
    var instanceList = document.getElementById('instance-list');
    var recentList = document.getElementById('recent-list');
    var manualText = document.getElementById('manual-text');
    var manualSendBtn = document.getElementById('manual-send-btn');
    var resultDiv = document.getElementById('result');
    var autoJumpToggle = document.getElementById('auto-jump-toggle');
    var autoScanToggle = document.getElementById('auto-scan-toggle');
    var extToggle = document.getElementById('extension-toggle');

    var currentPort = 9960;
    var currentWorkspace = '';
    var discoveredInstances = [];
    var extensionEnabled = true;

    // ===== 加载提示词 =====
    var PROMPT_TEMPLATE = '';
    try {
        fetch(chrome.runtime.getURL('prompt-template.txt'))
            .then(function(r) { return r.text(); })
            .then(function(t) { if (t && t.length > 50) PROMPT_TEMPLATE = t; })
            .catch(function() {});
    } catch (_) {}
    setTimeout(function() {
        if (!PROMPT_TEMPLATE) PROMPT_TEMPLATE = 'Please use agent-action format.';
    }, 1000);

    // ===== 加载设置 =====
    chrome.storage.local.get(
        ['serverPort', 'autoJump', 'autoScan', 'savedProjects', 'extensionEnabled', 'exportExcludes'],
        function(r) {
            if (r.serverPort) currentPort = r.serverPort;
            autoJumpToggle.checked = r.autoJump !== false;
            autoScanToggle.checked = r.autoScan !== false;
            extensionEnabled = r.extensionEnabled !== false;
            extToggle.checked = extensionEnabled;
            renderProjectList(r.savedProjects || []);
            if (document.getElementById('export-excludes') && r.exportExcludes) {
                document.getElementById('export-excludes').value = r.exportExcludes;
            }
        }
    );
    checkConnection();

    // ===== 折叠区 =====
    document.querySelectorAll('.collapse-header').forEach(function(h) {
        h.addEventListener('click', function() {
            var body = document.getElementById(h.getAttribute('data-target'));
            var arrow = h.querySelector('.collapse-arrow');
            body.classList.toggle('open');
            arrow.classList.toggle('open');
        });
    });

    // ===== 插件开关 =====
    extToggle.addEventListener('change', function() {
        extensionEnabled = extToggle.checked;
        chrome.storage.local.set({ extensionEnabled: extensionEnabled });
        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(tab) {
                try { chrome.tabs.sendMessage(tab.id, { type: 'toggle-extension', enabled: extensionEnabled }); } catch (_) {}
            });
        });
        showResult(extensionEnabled ? '\u2705 \u5df2\u542f\u7528' : '\u23f8 \u5df2\u5173\u95ed', extensionEnabled);
    });

    // ===== 自动跳转 =====
    autoJumpToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoJump: autoJumpToggle.checked });
        // 同步到所有标签页的 content.js
        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(tab) {
                try { chrome.tabs.sendMessage(tab.id, { type: 'update-auto-jump', enabled: autoJumpToggle.checked }); } catch (_) {}
            });
        });
        showResult(autoJumpToggle.checked ? '\u5df2\u5f00\u542f\u81ea\u52a8\u8df3\u8f6c' : '\u5df2\u5173\u95ed\u81ea\u52a8\u8df3\u8f6c', true);
    });

    // ===== 自动扫描 =====
    autoScanToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoScan: autoScanToggle.checked });
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle-auto-scan', enabled: autoScanToggle.checked });
        });
    });

    // ===== 连接检测 =====
    function scanAllPorts(callback) {
        var instances = [];
        var pending = 10;
        for (var i = 0; i < 10; i++) {
            (function(port) {
                fetch('http://127.0.0.1:' + port + '/status', { signal: AbortSignal.timeout(500) })
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        instances.push({ port: port, workspace: d.workspace || '', wsClients: d.wsClients || 0 });
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
            })(9960 + i);
        }
    }

    function checkConnection() {
        statusLabel.textContent = '\u68c0\u67e5\u4e2d...';
        scanAllPorts(function(instances) {
            if (instances.length === 0) {
                statusDot.className = 'dot dot-red';
                statusLabel.textContent = '\u672a\u8fde\u63a5 \u2014 \u8bf7\u542f\u52a8 VS Code';
                workspaceName.textContent = '';
                instanceList.innerHTML = '';
                return;
            }
            var active = instances.find(function(i) { return i.port === currentPort; }) || instances[0];
            currentPort = active.port;
            currentWorkspace = active.workspace;
            chrome.storage.local.set({ serverPort: currentPort });

            statusDot.className = 'dot dot-green';
            statusLabel.textContent = '\u5df2\u8fde\u63a5 :' + currentPort;

            var fn = currentWorkspace.split(/[\/\\]/).pop() || currentWorkspace;
            workspaceName.textContent = fn;
            workspaceName.title = currentWorkspace;

            renderInstances(instances);
            renderProjectList();
            loadHistory();
        });
    }

    function renderInstances(instances) {
        instanceList.innerHTML = '';
        if (instances.length <= 1) return;

        var label = document.createElement('div');
        label.style.cssText = 'font-size:10px;color:#6c7086;margin-bottom:2px;';
        label.textContent = '\u70b9\u51fb\u5207\u6362\u76ee\u6807\u7a97\u53e3\uff1a';
        instanceList.appendChild(label);

        instances.forEach(function(inst) {
            var chip = document.createElement('span');
            chip.className = 'ws-chip' + (inst.port === currentPort ? ' active' : '');
            var fn = inst.workspace.split(/[\/\\]/).pop() || '?';
            chip.textContent = fn + ' :' + inst.port;
            chip.title = inst.workspace;
            chip.addEventListener('click', function() {
                currentPort = inst.port;
                currentWorkspace = inst.workspace;
                chrome.storage.local.set({ serverPort: inst.port });

                // 只通知当前活跃标签页切换，不影响其他标签页
                chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: 'reconnect-ws', port: inst.port });
                    }
                });

                showResult('\u2705 \u5df2\u5207\u6362: ' + fn + ' :' + inst.port, true);
                renderInstances(instances);
                statusLabel.textContent = '\u5df2\u8fde\u63a5 :' + inst.port;
                workspaceName.textContent = fn;
                workspaceName.title = inst.workspace;
            });
            instanceList.appendChild(chip);
        });
    }

    document.getElementById('btn-refresh').addEventListener('click', checkConnection);

    // ===== 复制提示词 =====
    document.getElementById('btn-copy-prompt').addEventListener('click', function() {
        var btn = document.getElementById('btn-copy-prompt');
        navigator.clipboard.writeText(PROMPT_TEMPLATE).then(function() {
            btn.textContent = '\u2705 \u5df2\u590d\u5236\uff01\u7c98\u8d34\u5230 AI \u5bf9\u8bdd\u7684\u7b2c\u4e00\u6761\u6d88\u606f';
            setTimeout(function() { btn.textContent = '\ud83d\udccb \u4e00\u952e\u590d\u5236 AI \u63d0\u793a\u8bcd\uff08\u9996\u6b21\u5bf9\u8bdd\u5fc5\u7528\uff09'; }, 3000);
        }).catch(function() { showResult('\u274c \u590d\u5236\u5931\u8d25', false); });
    });

    // ===== 扫描 =====
    document.getElementById('btn-scan').addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) { chrome.tabs.sendMessage(tabs[0].id, { type: 'scan-page-only' }); showResult('\u5df2\u626b\u63cf', true); }
        });
    });

    // ===== 复制AI回复 =====
    document.getElementById('btn-copy-reply').addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'collect-last-reply' }, function(resp) {
                if (resp && resp.text) {
                    navigator.clipboard.writeText(resp.text).then(function() {
                        showResult('\u2705 \u5df2\u590d\u5236 ' + resp.text.length + ' \u5b57\u7b26', true);
                    });
                } else { showResult('\u274c \u672a\u627e\u5230\u56de\u590d', false); }
            });
        });
    });

    // ===== 撤销 =====
    document.getElementById('btn-undo').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'undo-last-change' }, function(r) {
            showResult(r && r.success ? '\u2705 \u5df2\u64a4\u9500' : (r ? r.message : '\u5931\u8d25'), r && r.success);
        });
    });

    // ===== 快捷发送 =====
    manualSendBtn.addEventListener('click', function() {
        var text = manualText.value.trim();
        if (!text) { showResult('\u8bf7\u8f93\u5165\u5185\u5bb9', false); return; }
        manualSendBtn.disabled = true;
        manualSendBtn.textContent = '\u23f3...';
        fetch('http://127.0.0.1:' + currentPort + '/apply-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'raw-text', text: text })
        }).then(function(r) { return r.json(); }).then(function(d) {
            var ok = d.status === 'success' || d.success;
            showResult(ok ? '\u2705 ' + (d.message || '\u5df2\u53d1\u9001') : '\u274c ' + (d.message || '\u5931\u8d25'), ok);
            if (ok) manualText.value = '';
        }).catch(function() {
            showResult('\u274c \u65e0\u6cd5\u8fde\u63a5 VS Code', false);
        }).finally(function() {
            manualSendBtn.disabled = false;
            manualSendBtn.textContent = '\ud83d\udce4 \u53d1\u9001';
        });
    });

    // ===== 工具按钮 =====
    document.getElementById('btn-restart').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'restart-server' }, function(r) {
            showResult(r && r.success ? '\u5df2\u91cd\u542f' : '\u5931\u8d25', r && r.success);
            setTimeout(checkConnection, 2000);
        });
    });
    document.getElementById('btn-open-log').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'open-log' });
        showResult('\u5df2\u6253\u5f00', true);
    });
    document.getElementById('btn-reload-page').addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(t) { if (t[0]) chrome.tabs.reload(t[0].id); });
        showResult('\u5df2\u5237\u65b0', true);
    });
    document.getElementById('btn-reload-ext').addEventListener('click', function() {
        showResult('\u91cd\u8f7d\u4e2d...', true);
        setTimeout(function() { chrome.runtime.reload(); }, 500);
    });
    document.getElementById('btn-debug-info').addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: 'collect-debug-info' }, function(resp) {
                var info = '=== AI Code Agent ===\nPort:' + currentPort + '\nWorkspace:' + currentWorkspace + '\n';
                if (resp) {
                    info += 'Enabled:' + resp.enabled + '\nAutoScan:' + resp.autoScan + '\nWS:' + resp.wsConnected;
                    info += '\nBlocks:' + resp.codeBlockCount + '\nButtons:' + resp.buttonCount + '\nUnprocessed:' + resp.unprocessedCount;
                } else { info += 'content.js not loaded'; }
                navigator.clipboard.writeText(info).then(function() { showResult('\u2705 \u5df2\u590d\u5236', true); });
            });
        });
    });
    document.getElementById('btn-clear-history').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'clear-history' }, function() {
            recentList.innerHTML = '<div style="color:#6c7086;font-size:11px;">\u5df2\u6e05\u7a7a</div>';
            showResult('\u5df2\u6e05\u7a7a', true);
        });
    });

    // ===== 导出 =====
    var btnExport = document.getElementById('btn-export');
    if (btnExport) {
        btnExport.addEventListener('click', function() {
            var textarea = document.getElementById('export-excludes');
            var lines = (textarea.value || '').split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l && !l.startsWith('#'); });
            chrome.storage.local.set({ exportExcludes: textarea.value });
            btnExport.disabled = true;
            btnExport.textContent = '\u23f3 \u5bfc\u51fa\u4e2d...';
            fetch('http://127.0.0.1:' + currentPort + '/export-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ excludes: lines, maxSize: 200 })
            }).then(function(r) { return r.json(); }).then(function(d) {
                showResult(d.success ? '\u2705 ' + d.message : '\u274c ' + (d.message || '\u5931\u8d25'), d.success);
            }).catch(function() {
                showResult('\u274c \u65e0\u6cd5\u8fde\u63a5', false);
            }).finally(function() {
                btnExport.disabled = false;
                btnExport.textContent = '\ud83d\udce6 \u4e00\u952e\u5bfc\u51fa';
            });
        });
    }

    // ===== 项目路径 =====
    var pathInput = document.getElementById('path-input');
    var addPathBtn = document.getElementById('add-path-btn');
    var projectListEl = document.getElementById('project-list');

    function getSaved(cb) { chrome.storage.local.get(['savedProjects'], function(r) { cb(r.savedProjects || []); }); }
    function savePaths(p) { chrome.storage.local.set({ savedProjects: p }); }

    function renderProjectList(projects) {
        if (projects === undefined) { getSaved(renderProjectList); return; }
        projectListEl.innerHTML = '';
        projects.forEach(function(p, i) {
            var matched = discoveredInstances.find(function(inst) {
                return inst.workspace && (inst.workspace === p || inst.workspace.replace(/\\/g, '/') === p.replace(/\\/g, '/'));
            });
            var item = document.createElement('div');
            item.className = 'path-item';
            var name = document.createElement('span');
            name.className = 'path-name';
            name.textContent = p.split(/[\/\\]/).pop() || p;
            name.title = p;
            name.addEventListener('click', function() {
                if (matched) {
                    currentPort = matched.port;
                    currentWorkspace = matched.workspace;
                    chrome.storage.local.set({ serverPort: matched.port });
                    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'reconnect-ws', port: matched.port });
                    });
                    showResult('\u2705 \u5df2\u5207\u6362', true);
                    checkConnection();
                } else {
                    fetch('http://127.0.0.1:' + currentPort + '/open-folder-new-window', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: p })
                    }).then(function(r) { return r.json(); }).then(function(d) {
                        showResult(d.success ? '\u2705 \u5df2\u6253\u5f00' : '\u274c ' + d.message, d.success);
                        setTimeout(checkConnection, 3000);
                    }).catch(function() { showResult('\u274c \u65e0\u6cd5\u8fde\u63a5', false); });
                }
            });
            item.appendChild(name);
            if (matched) {
                var badge = document.createElement('span');
                badge.className = 'path-badge';
                badge.textContent = '\u5728\u7ebf :' + matched.port;
                item.appendChild(badge);
            }
            var del = document.createElement('span');
            del.className = 'path-del';
            del.textContent = '\u00d7';
            del.addEventListener('click', function(e) {
                e.stopPropagation();
                getSaved(function(list) { list.splice(i, 1); savePaths(list); renderProjectList(list); });
            });
            item.appendChild(del);
            projectListEl.appendChild(item);
        });
    }

    addPathBtn.addEventListener('click', function() {
        var p = pathInput.value.trim();
        if (!p) { showResult('\u8bf7\u8f93\u5165\u8def\u5f84', false); return; }
        getSaved(function(list) {
            if (list.includes(p)) { showResult('\u5df2\u5b58\u5728', false); return; }
            list.push(p); savePaths(list); renderProjectList(list); pathInput.value = '';
            showResult('\u5df2\u6dfb\u52a0', true);
        });
    });
    pathInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addPathBtn.click(); });

    // ===== 历史 =====
    function loadHistory() {
        chrome.runtime.sendMessage({ type: 'get-history' }, function(resp) {
            if (resp && resp.history) renderRecent(resp.history);
        });
    }
    function renderRecent(items) {
        if (!items || items.length === 0) {
            recentList.innerHTML = '<div style="color:#6c7086;font-size:11px;">\u6682\u65e0\u8bb0\u5f55</div>';
            return;
        }
        recentList.innerHTML = items.slice(0, 5).map(function(item) {
            var icon = item.accepted ? '\u2705' : '\u274c';
            var colors = { write: '#89b4fa', patch: '#fab387', delete: '#f38ba8', create: '#a6e3a1' };
            var c = colors[item.action] || '#cdd6f4';
            var t = (item.timeStr || '').split(' ')[1] || '';
            return '<div class="recent-item">' +
                '<span>' + icon + '</span>' +
                '<span style="color:' + c + ';font-size:10px;flex-shrink:0;">' + item.action + '</span>' +
                '<span class="recent-file">' + item.file + '</span>' +
                '<span class="recent-time">' + t + '</span></div>';
        }).join('');
    }
    chrome.runtime.onMessage.addListener(function(msg) {
        if (msg.type === 'history-updated') renderRecent(msg.history);
    });

    // ===== 结果提示 =====
    function showResult(msg, success) {
        resultDiv.textContent = msg;
        resultDiv.className = success ? 'result result-success' : 'result result-error';
        clearTimeout(resultDiv._t);
        resultDiv._t = setTimeout(function() { resultDiv.className = 'result'; }, 4000);
    }
});
