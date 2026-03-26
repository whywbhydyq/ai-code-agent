document.addEventListener('DOMContentLoaded', function() {
    var statusDot = document.getElementById('status-dot');
    var statusLabel = document.getElementById('status-label');
    var workspaceInfo = document.getElementById('workspace-info');
    var instanceList = document.getElementById('instance-list');
    var recentList = document.getElementById('recent-list');
    var manualText = document.getElementById('manual-text');
    var manualSendBtn = document.getElementById('manual-send-btn');
    var resultDiv = document.getElementById('result');
    var mainContent = document.getElementById('main-content');
    var autoJumpToggle = document.getElementById('auto-jump-toggle');
    var autoScanToggle = document.getElementById('auto-scan-toggle');

    var currentPort = 9960;
    var currentWorkspace = '';
    var discoveredInstances = [];
    var extensionEnabled = true;

    var PROMPT_TEMPLATE = '';
    try {
        fetch(chrome.runtime.getURL('prompt-template.txt'))
            .then(function(r) { return r.text(); })
            .then(function(t) { if (t && t.trim().length > 50) PROMPT_TEMPLATE = t; })
            .catch(function() {});
    } catch (_) {}
    setTimeout(function() {
        if (!PROMPT_TEMPLATE) PROMPT_TEMPLATE = 'Please use agent-action format for code operations.';
    }, 1000);

    // ===== Load settings =====
    chrome.storage.local.get(
        ['serverPort', 'autoJump', 'autoScan', 'savedProjects', 'extensionEnabled', 'exportExcludes'],
        function(r) {
            if (r.serverPort) currentPort = r.serverPort;
            autoJumpToggle.checked = r.autoJump !== false;
            autoScanToggle.checked = r.autoScan !== false;
            extensionEnabled = r.extensionEnabled !== false;
            updateExtToggleBtn();
            renderProjectList(r.savedProjects || []);
            var ee = document.getElementById('export-excludes');
            if (ee && r.exportExcludes) ee.value = r.exportExcludes;
        }
    );
    checkConnection();

    // ===== Collapse sections =====
    document.querySelectorAll('.collapse-header').forEach(function(h) {
        h.addEventListener('click', function() {
            var targetId = h.getAttribute('data-target');
            var body = document.getElementById(targetId);
            var arrow = h.querySelector('.collapse-arrow');
            if (body.classList.contains('open')) {
                body.classList.remove('open');
                arrow.classList.remove('open');
            } else {
                body.classList.add('open');
                arrow.classList.add('open');
            }
        });
    });

    // ===== Extension toggle =====
    var extToggleBtn = document.getElementById('extension-toggle-btn');
    function updateExtToggleBtn() {
        if (extToggleBtn) {
            extToggleBtn.classList.toggle('active', extensionEnabled);
            extToggleBtn.title = extensionEnabled ? '插件已启用（点击关闭）' : '插件已关闭（点击启用）';
        }
        if (mainContent) {
            mainContent.style.opacity = extensionEnabled ? '1' : '0.4';
            mainContent.style.pointerEvents = extensionEnabled ? 'auto' : 'none';
        }
    }
    if (extToggleBtn) {
        extToggleBtn.addEventListener('click', function() {
            extensionEnabled = !extensionEnabled;
            chrome.storage.local.set({ extensionEnabled: extensionEnabled });
            updateExtToggleBtn();
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(function(tab) {
                    try { chrome.tabs.sendMessage(tab.id, { type: 'toggle-extension', enabled: extensionEnabled }); } catch (_) {}
                });
            });
            showResult(extensionEnabled ? '\u2705 \u63d2\u4ef6\u5df2\u542f\u7528' : '\u23f8 \u63d2\u4ef6\u5df2\u5173\u95ed', extensionEnabled);
        });
    }

    // ===== Connection =====
    function scanAllPorts(callback) {
        var instances = []; var pending = 10;
        for (var i = 0; i < 10; i++) {
            (function(port) {
                fetch('http://127.0.0.1:' + port + '/status', { signal: AbortSignal.timeout(500) })
                    .then(function(r) { return r.json(); })
                    .then(function(d) { instances.push({ port: port, workspace: d.workspace || '', wsClients: d.wsClients || 0 }); })
                    .catch(function() {})
                    .finally(function() { pending--; if (pending === 0) { instances.sort(function(a,b){return a.port-b.port;}); discoveredInstances = instances; callback(instances); } });
            })(9960 + i);
        }
    }

    function checkConnection() {
        statusLabel.textContent = '...';
        scanAllPorts(function(instances) {
            if (instances.length === 0) {
                statusDot.className = 'dot dot-red';
                statusLabel.textContent = '\u672a\u8fde\u63a5';
                workspaceInfo.textContent = '\u8bf7\u542f\u52a8 VS Code \u5e76\u5b89\u88c5 AI Code Agent \u6269\u5c55';
                workspaceInfo.style.color = '#f38ba8';
                instanceList.innerHTML = '';
                return;
            }
            var active = instances.find(function(i){return i.port===currentPort;}) || instances[0];
            currentPort = active.port; currentWorkspace = active.workspace;
            chrome.storage.local.set({ serverPort: currentPort });
            statusDot.className = 'dot dot-green';
            statusLabel.textContent = ':' + currentPort;
            var fn = currentWorkspace.split(/[\/\\]/).pop() || currentWorkspace;
            workspaceInfo.textContent = fn;
            workspaceInfo.style.color = '#89b4fa';
            workspaceInfo.title = currentWorkspace;
            renderInstances(instances);
            renderProjectList();
            loadHistory();
        });
    }

    function renderInstances(instances) {
        instanceList.innerHTML = '';
        if (instances.length <= 1) return;
        instances.forEach(function(inst) {
            var chip = document.createElement('div');
            chip.className = 'ws-chip' + (inst.port === currentPort ? ' active' : '');
            var fn = inst.workspace.split(/[\/\\]/).pop() || '?';
            chip.textContent = fn;
            chip.title = inst.workspace + ' (:' + inst.port + ')';
            chip.addEventListener('click', function() {
                currentPort = inst.port; currentWorkspace = inst.workspace;
                chrome.storage.local.set({ serverPort: inst.port });
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(function(tab) {
                        try { chrome.tabs.sendMessage(tab.id, { type: 'reconnect-ws', port: inst.port }); } catch(_){}
                    });
                });
                checkConnection();
                showResult('\u2705 \u5df2\u5207\u6362: ' + fn, true);
            });
            instanceList.appendChild(chip);
        });
    }

    document.getElementById('btn-refresh').addEventListener('click', checkConnection);

    // ===== Copy prompt =====
    document.getElementById('btn-copy-prompt').addEventListener('click', function() {
        navigator.clipboard.writeText(PROMPT_TEMPLATE).then(function() {
            showResult('\u2705 \u63d0\u793a\u8bcd\u5df2\u590d\u5236', true);
        }).catch(function() { showResult('\u274c \u590d\u5236\u5931\u8d25', false); });
    });

    // ===== Scan =====
    document.getElementById('btn-scan').addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) { chrome.tabs.sendMessage(tabs[0].id, { type: 'scan-page-only' }); showResult('\u5df2\u626b\u63cf', true); }
        });
    });

    // ===== Copy reply =====
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

    // ===== Undo =====
    document.getElementById('btn-undo').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'undo-last-change' }, function(resp) {
            showResult(resp && resp.success ? '\u2705 \u5df2\u64a4\u9500' : (resp ? resp.message : '\u5931\u8d25'), resp && resp.success);
        });
    });

    // ===== Manual send =====
    manualSendBtn.addEventListener('click', function() {
        var text = manualText.value.trim();
        if (!text) { showResult('\u8bf7\u8f93\u5165\u5185\u5bb9', false); return; }
        manualSendBtn.disabled = true; manualSendBtn.textContent = '\u23f3...';
        fetch('http://127.0.0.1:' + currentPort + '/apply-text', {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({type:'raw-text',text:text})
        }).then(function(r){return r.json();}).then(function(d) {
            var ok = d.status==='success'||d.success;
            showResult(ok ? '\u2705 '+(d.message||'\u5df2\u53d1\u9001') : '\u274c '+(d.message||'\u5931\u8d25'), ok);
            if (ok) manualText.value = '';
        }).catch(function() { showResult('\u274c \u65e0\u6cd5\u8fde\u63a5', false); })
        .finally(function() { manualSendBtn.disabled = false; manualSendBtn.textContent = '\ud83d\udce4 \u53d1\u9001\u5230 VS Code'; });
    });

    // ===== Settings =====
    autoJumpToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoJump: autoJumpToggle.checked });
        showResult(autoJumpToggle.checked ? '\u5df2\u5f00\u542f\u81ea\u52a8\u8df3\u8f6c' : '\u5df2\u5173\u95ed\u81ea\u52a8\u8df3\u8f6c', true);
    });
    autoScanToggle.addEventListener('change', function() {
        chrome.storage.local.set({ autoScan: autoScanToggle.checked });
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle-auto-scan', enabled: autoScanToggle.checked });
        });
    });

    // ===== Tools =====
    document.getElementById('btn-restart').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'restart-server' }, function(r) {
            showResult(r&&r.success?'\u5df2\u53d1\u9001\u91cd\u542f':'\u5931\u8d25', r&&r.success); setTimeout(checkConnection,2000);
        });
    });
    document.getElementById('btn-open-log').addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'open-log' }); showResult('\u5df2\u6253\u5f00\u65e5\u5fd7', true);
    });
    document.getElementById('btn-reload-page').addEventListener('click', function() {
        chrome.tabs.query({active:true,currentWindow:true}, function(t){if(t[0])chrome.tabs.reload(t[0].id);}); showResult('\u5df2\u5237\u65b0',true);
    });
    document.getElementById('btn-reload-ext').addEventListener('click', function() {
        showResult('\u91cd\u8f7d\u4e2d...',true); setTimeout(function(){chrome.runtime.reload();},500);
    });
    document.getElementById('btn-debug-info').addEventListener('click', function() {
        chrome.tabs.query({active:true,currentWindow:true}, function(tabs) {
            if(!tabs[0])return;
            chrome.tabs.sendMessage(tabs[0].id, {type:'collect-debug-info'}, function(resp) {
                var info='=== AI Code Agent ===\nPort:'+currentPort+'\nWorkspace:'+currentWorkspace+'\n';
                if(resp){info+='Enabled:'+resp.enabled+'\nAutoScan:'+resp.autoScan+'\nWS:'+resp.wsConnected+'\nBlocks:'+resp.codeBlockCount+'\nButtons:'+resp.buttonCount+'\nUnprocessed:'+resp.unprocessedCount;}
                else{info+='content.js not loaded';}
                navigator.clipboard.writeText(info).then(function(){showResult('\u2705 \u8c03\u8bd5\u4fe1\u606f\u5df2\u590d\u5236',true);});
            });
        });
    });
    document.getElementById('btn-clear-history').addEventListener('click', function() {
        chrome.runtime.sendMessage({type:'clear-history'}, function(){recentList.innerHTML='<div style="color:#6c7086;font-size:11px;">\u5df2\u6e05\u7a7a</div>';showResult('\u5386\u53f2\u5df2\u6e05\u7a7a',true);});
    });

    // ===== Export =====
    var btnExport = document.getElementById('btn-export');
    var exportExcludes = document.getElementById('export-excludes');
    if (btnExport) {
        btnExport.addEventListener('click', function() {
            var lines = (exportExcludes.value||'').split('\n').map(function(l){return l.trim();}).filter(function(l){return l&&!l.startsWith('#');});
            chrome.storage.local.set({exportExcludes: exportExcludes.value});
            btnExport.disabled=true; btnExport.textContent='\u23f3 \u5bfc\u51fa\u4e2d...';
            fetch('http://127.0.0.1:'+currentPort+'/export-project',{
                method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({excludes:lines,maxSize:200})
            }).then(function(r){return r.json();}).then(function(d){
                showResult(d.success?'\u2705 '+d.message:'\u274c '+(d.message||'\u5931\u8d25'),d.success);
            }).catch(function(){showResult('\u274c \u65e0\u6cd5\u8fde\u63a5',false);})
            .finally(function(){btnExport.disabled=false;btnExport.textContent='\ud83d\udce6 \u4e00\u952e\u5bfc\u51fa';});
        });
    }

    // ===== Project paths =====
    var pathInput = document.getElementById('path-input');
    var addPathBtn = document.getElementById('add-path-btn');
    var projectListEl = document.getElementById('project-list');
    function getSaved(cb){chrome.storage.local.get(['savedProjects'],function(r){cb(r.savedProjects||[]);});}
    function savePaths(p){chrome.storage.local.set({savedProjects:p});}
    function renderProjectList(projects) {
        if(projects===undefined){getSaved(renderProjectList);return;}
        projectListEl.innerHTML='';
        projects.forEach(function(p,i){
            var matched = discoveredInstances.find(function(inst){return inst.workspace&&(inst.workspace===p||inst.workspace.replace(/\\/g,'/')===p.replace(/\\/g,'/'));});
            var item=document.createElement('div');item.className='path-item';
            var name=document.createElement('span');name.className='path-name';
            name.textContent=p.split(/[\/\\]/).pop()||p; name.title=p;
            name.addEventListener('click',function(){
                if(matched){
                    currentPort=matched.port;currentWorkspace=matched.workspace;
                    chrome.storage.local.set({serverPort:matched.port});
                    chrome.tabs.query({},function(tabs){tabs.forEach(function(tab){try{chrome.tabs.sendMessage(tab.id,{type:'reconnect-ws',port:matched.port});}catch(_){}});});
                    checkConnection();showResult('\u2705 \u5df2\u5207\u6362',true);
                } else {
                    fetch('http://127.0.0.1:'+currentPort+'/open-folder-new-window',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})})
                    .then(function(r){return r.json();}).then(function(d){showResult(d.success?'\u2705 \u5df2\u6253\u5f00':'\u274c '+d.message,d.success);setTimeout(checkConnection,3000);})
                    .catch(function(){showResult('\u274c \u65e0\u6cd5\u8fde\u63a5',false);});
                }
            });
            item.appendChild(name);
            if(matched){var badge=document.createElement('span');badge.className='path-open-badge';badge.textContent=':'+matched.port;item.appendChild(badge);}
            var del=document.createElement('span');del.className='path-del';del.textContent='\u00d7';del.title='\u5220\u9664';
            del.addEventListener('click',function(e){e.stopPropagation();getSaved(function(list){list.splice(i,1);savePaths(list);renderProjectList(list);});});
            item.appendChild(del);
            projectListEl.appendChild(item);
        });
    }
    addPathBtn.addEventListener('click',function(){
        var p=pathInput.value.trim();if(!p){showResult('\u8bf7\u8f93\u5165\u8def\u5f84',false);return;}
        getSaved(function(list){if(list.includes(p)){showResult('\u5df2\u5b58\u5728',false);return;}list.push(p);savePaths(list);renderProjectList(list);pathInput.value='';showResult('\u5df2\u6dfb\u52a0',true);});
    });
    pathInput.addEventListener('keydown',function(e){if(e.key==='Enter')addPathBtn.click();});

    // ===== History =====
    function loadHistory() {
        chrome.runtime.sendMessage({type:'get-history'}, function(resp){
            if(resp&&resp.history) renderRecent(resp.history);
        });
    }
    function renderRecent(items) {
        if(!items||items.length===0){recentList.innerHTML='<div style="color:#6c7086;font-size:11px;">\u6682\u65e0\u8bb0\u5f55</div>';return;}
        var recent=items.slice(0,5);
        recentList.innerHTML=recent.map(function(item){
            var icon=item.accepted?'\u2705':'\u274c';
            var colors={write:'#89b4fa',patch:'#fab387',delete:'#f38ba8',create:'#a6e3a1'};
            var c=colors[item.action]||'#cdd6f4';
            var t=(item.timeStr||'').split(' ')[1]||'';
            return '<div class="recent-item"><span class="recent-icon">'+icon+'</span><span style="color:'+c+';flex-shrink:0;font-size:10px;">'+item.action+'</span><span class="recent-file">'+item.file+'</span><span class="recent-time">'+t+'</span></div>';
        }).join('');
    }
    chrome.runtime.onMessage.addListener(function(msg){
        if(msg.type==='history-updated') renderRecent(msg.history);
    });

    // ===== Result =====
    function showResult(msg,success){
        resultDiv.textContent=msg;
        resultDiv.className=success?'result result-success':'result result-error';
        clearTimeout(resultDiv._t);
        resultDiv._t=setTimeout(function(){resultDiv.className='result';},4000);
    }
});
