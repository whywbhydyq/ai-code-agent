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
    // 记录所有发现的 VS Code 实例，用于多窗口切换
    var discoveredInstances = [];

    var PROMPT_TEMPLATE = '你好，请在后续对话中，当涉及代码文件的创建、修改或删除时，严格按照以下格式输出。\n\n' +
        '## 格式规范\n\n' +
        '所有代码操作指令必须包裹在 ```agent-action 代码块中，内容是标准 JSON。\n\n' +
        '### 1. 创建新文件 或 完整替换现有文件\n\n' +
        '```agent-action\n' +
        '{\n' +
        '  "action": "write",\n' +
        '  "file": "相对路径/文件名.扩展名",\n' +
        '  "content": "完整的文件内容..."\n' +
        '}\n' +
        '```\n\n' +
        '### 2. 局部修改现有文件（推荐用于超过 50 行的大文件）\n\n' +
        '```agent-action\n' +
        '{\n' +
        '  "action": "patch",\n' +
        '  "file": "相对路径/文件名.扩展名",\n' +
        '  "patches": [\n' +
        '    {\n' +
        '      "find": "要被替换的原始代码（精确复制，包含前后至少 2 行上下文）",\n' +
        '      "replace": "替换后的完整代码"\n' +
        '    },\n' +
        '    {\n' +
        '      "after": "在这行代码之后插入",\n' +
        '      "insert": "要插入的新代码"\n' +
        '    },\n' +
        '    {\n' +
        '      "delete": "要删除的这行代码"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '```\n\n' +
        '### 3. 删除文件\n\n' +
        '```agent-action\n' +
        '{\n' +
        '  "action": "delete",\n' +
        '  "file": "相对路径/文件名.扩展名"\n' +
        '}\n' +
        '```\n\n' +
        '## 重要规则\n\n' +
        '1. 绝对不要在 content 中使用省略写法\n' +
        '2. 如果用 write 模式，必须输出完整文件内容，一行都不能省\n' +
        '3. patch 的 find 字段至少包含目标代码前后各 1-2 行上下文\n' +
        '4. 一次回答可以输出多个 agent-action 代码块\n' +
        '5. 文件路径使用 / 分隔\n' +
        '6. 小文件（< 50 行）直接用 write，大文件用 patch\n\n' +
        '请确认你理解了以上格式要求。';

    // 尝试从外部文件加载提示词
    try {
        fetch(chrome.runtime.getURL('prompt-template.txt'))
            .then(function(r) { return r.text(); })
            .then(function(t) { if (t && t.trim().length > 50) PROMPT_TEMPLATE = t; })
            .catch(function() {});
    } catch (_) {}

    btnCopyPrompt.addEventListener('click', function() {
        navigator.clipboard.writeText(PROMPT_TEMPLATE).then(function() {
            btnCopyPrompt.textContent = '✅ 已复制！粘贴到 AI 对话的第一条消息';
            btnCopyPrompt.classList.add('copied');
            setTimeout(function() {
                btnCopyPrompt.textContent = '📋 一键复制 AI 提示词';
                btnCopyPrompt.classList.remove('copied');
            }, 3000);
        }).catch(function() {
            var ta = document.createElement('textarea');
            ta.value = PROMPT_TEMPLATE;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            btnCopyPrompt.textContent = '✅ 已复制！';
            setTimeout(function() {
                btnCopyPrompt.textContent = '📋 一键复制 AI 提示词';
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
            masterHint.textContent = '插件已启用，正在监控页面';
        } else {
            mainContent.classList.add('disabled');
            masterToggleCard.classList.add('disabled');
            masterHint.textContent = '插件已关闭，页面上的按钮已全部移除';
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
        showResult(enabled ? '✅ 插件已启用' : '⏸ 插件已关闭', enabled);
    });

    // ========== 多窗口端口扫描 ==========
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
                            instances.push({
                                port: port,
                                workspace: data.workspace || '',
                                wsClients: data.wsClients || 0
                            });
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
        statusLabel.textContent = '检查中...';
        scanAllPorts(function(instances) {
            if (instances.length === 0) {
                statusDot.className = 'dot dot-red';
                statusLabel.textContent = '未连接 — 检查 VS Code 扩展是否启动';
                workspaceInfo.textContent = '';
                currentWorkspace = '';
                renderProjectList();
                return;
            }

            // 默认连接第一个实例
            var active = instances[0];
            statusDot.className = 'dot dot-green';

            if (instances.length === 1) {
                statusLabel.textContent = 'VS Code 已连接';
            } else {
                statusLabel.textContent = 'VS Code 已连接（发现 ' + instances.length + ' 个窗口）';
            }

            currentWorkspace = active.workspace;
            workspaceInfo.textContent = currentWorkspace ? '📂 ' + currentWorkspace : '';

            // 如果有多个实例，显示切换列表
            if (instances.length > 1) {
                renderInstanceList(instances);
            }

            renderProjectList();
        });
    }

    function renderInstanceList(instances) {
        // 在状态卡片下方插入实例列表
        var existingList = document.getElementById('instance-list-section');
        if (existingList) existingList.remove();

        var section = document.createElement('div');
        section.id = 'instance-list-section';
        section.style.cssText = 'background:#313244;border-radius:8px;padding:10px 12px;margin-bottom:10px;';

        var title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = '🪟 多窗口切换（点击切换目标窗口）';
        section.appendChild(title);

        instances.forEach(function(inst) {
            var item = document.createElement('div');
            var isActive = inst.workspace === currentWorkspace;
            item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-top:4px;background:#1e1e2e;border-radius:5px;font-size:11px;cursor:pointer;border:1px solid ' + (isActive ? '#89b4fa' : 'transparent') + ';';

            var name = document.createElement('span');
            name.style.cssText = 'font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + (isActive ? '#89b4fa' : '#cdd6f4') + ';';
            var folderName = inst.workspace.split(/[\/\\]/).pop() || inst.workspace;
            name.textContent = (isActive ? '● ' : '○ ') + folderName;
            name.title = inst.workspace + ' (端口 ' + inst.port + ')';

            var portLabel = document.createElement('span');
            portLabel.style.cssText = 'color:#6c7086;font-size:10px;flex-shrink:0;margin-left:8px;';
            portLabel.textContent = ':' + inst.port;

            item.appendChild(name);
            item.appendChild(portLabel);

            item.addEventListener('click', function() {
                // 切换到这个端口
                chrome.storage.local.set({ serverPort: inst.port }, function() {
                    portInput.value = inst.port;
                    currentWorkspace = inst.workspace;
                    showResult('✅ 已切换到: ' + folderName + ' (端口 ' + inst.port + ')', true);
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
        showResult(autoJumpToggle.checked ? '已开启自动跳转' : '已关闭自动跳转', true);
    });

    autoScanToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoScan: autoScanToggle.checked });
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle-auto-scan', enabled: autoScanToggle.checked });
            }
        });
        showResult(autoScanToggle.checked ? '已开启自动检测' : '已关闭自动检测', true);
    });

    savePortBtn.addEventListener('click', function() {
        var port = parseInt(portInput.value, 10);
        if (port >= 1024 && port <= 65535) {
            chrome.storage.local.set({ serverPort: port }, function() {
                showResult('端口已保存为 ' + port, true);
                checkConnection();
            });
        } else {
            showResult('端口号无效（1024~65535）', false);
        }
    });

    // [修复] 立即扫描 = 只显示按钮，不自动发送
    btnScan.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                // 发送 scan-only 消息，只扫描并显示按钮，不发送
                chrome.tabs.sendMessage(tabs[0].id, { type: 'scan-page-only' });
                showResult('已触发页面扫描，按钮将显示在代码块旁', true);
            }
        });
    });

    btnRestart.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'restart-server' }, function(resp) {
            showResult(resp && resp.success ? '重启指令已发送' : '发送失败', resp && resp.success);
            setTimeout(checkConnection, 2000);
        });
    });

    btnUndo.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'undo-last-change' }, function(resp) {
            showResult(resp && resp.success ? '撤销指令已发送' : (resp ? resp.message : '失败'), resp && resp.success);
        });
    });

    btnOpenLog.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'open-log' }, function() {
            showResult('已发送打开日志指令', true);
        });
    });

    var btnReloadPage = document.getElementById('btn-reload-page');
    if (btnReloadPage) {
        btnReloadPage.addEventListener('click', function() {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0]) {
                    chrome.tabs.reload(tabs[0].id);
                    showResult('页面已刷新', true);
                }
            });
        });
    }

    var btnReloadExt = document.getElementById('btn-reload-ext');
    if (btnReloadExt) {
        btnReloadExt.addEventListener('click', function() {
            showResult('插件重载中...', true);
            setTimeout(function() {
                chrome.runtime.reload();
            }, 500);
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
            projectList.innerHTML = '<div style="color:#6c7086;font-size:11px;padding:4px 0">暂无保存的项目路径</div>';
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
                    showResult(resp && resp.success ? '已切换: ' + p : (resp ? resp.message : '失败'), resp && resp.success);
                    setTimeout(checkConnection, 1500);
                });
            });
            var del = document.createElement('span');
            del.className = 'project-item-del';
            del.textContent = '\u00d7';
            del.title = '删除';
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
        if (!p) { showResult('请输入路径', false); return; }
        getSavedProjects(function(list) {
            if (list.includes(p)) { showResult('路径已存在', false); return; }
            list.push(p);
            saveProjects(list);
            renderProjectList(list);
            pathInput.value = '';
            showResult('路径已添加', true);
        });
    });

    pathInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addPathBtn.click(); });

    manualSendBtn.addEventListener('click', function() {
        var text = manualText.value.trim();
        if (!text) { showResult('请输入文本', false); return; }
        manualSendBtn.disabled = true;
        manualSendBtn.textContent = '⏳ 发送中...';
        chrome.runtime.sendMessage({ type: 'send-raw-text', text: text }, function(response) {
            manualSendBtn.disabled = false;
            manualSendBtn.textContent = '📤 发送到 VS Code';
            if (response && response.success) {
                showResult(response.message || '已发送', true);
                manualText.value = '';
            } else {
                showResult(response ? response.message : '发送失败', false);
            }
        });
    });

    function showResult(msg, success) {
        resultDiv.textContent = msg;
        resultDiv.className = success ? 'result result-success' : 'result result-error';
        clearTimeout(resultDiv._t);
        resultDiv._t = setTimeout(function() { resultDiv.className = 'result'; }, 4000);
    }

    // ========== 操作历史 ==========
    var historySection = document.createElement('div');
    historySection.className = 'manual-section';
    historySection.style.marginBottom = '10px';
    historySection.innerHTML =
        '<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>📜 操作历史</span>' +
        '<span id="history-count" style="color:#6c7086;font-size:10px"></span>' +
        '</div>' +
        '<div id="history-list" style="max-height:120px;overflow-y:auto;margin-top:6px"></div>' +
        '<button id="clear-history-btn" style="' +
        'width:100%;margin-top:6px;padding:5px;border:none;border-radius:5px;' +
        'background:#45475a;color:#cdd6f4;font-size:11px;cursor:pointer' +
        '">🗑 清空历史</button>';

    var manualSectionEl = document.querySelector('.manual-section');
    if (manualSectionEl) {
        manualSectionEl.parentNode.insertBefore(historySection, manualSectionEl);
    }

    var historyList     = document.getElementById('history-list');
    var historyCount    = document.getElementById('history-count');
    var clearHistoryBtn = document.getElementById('clear-history-btn');

    function renderHistory(items) {
        if (!items || items.length === 0) {
            historyList.innerHTML = '<div style="color:#6c7086;font-size:11px;padding:4px">暂无操作记录</div>';
            historyCount.textContent = '';
            return;
        }
        historyCount.textContent = '共 ' + items.length + ' 条';
        historyList.innerHTML = items.map(function(item) {
            var icon = item.accepted ? '✅' : '❌';
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
                showResult('历史已清空', true);
            });
        });
    }

    chrome.runtime.onMessage.addListener(function(msg) {
        if (msg.type === 'history-updated') renderHistory(msg.history);
    });

});