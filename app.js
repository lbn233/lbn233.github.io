(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var storagePrefix = 'thinking-oj-v1:';
  var problems = [];
  var selectedId = null;
  var activeRun = false;
  var toastTimer;
  var templates = {
    cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    // 在这里写下你的解法\n\n    return 0;\n}\n',
    python: 'import sys\n\ndef main():\n    # 在这里写下你的解法\n    pass\n\nif __name__ == "__main__":\n    main()\n'
  };

  function read(key, fallback) {
    try { var value = localStorage.getItem(storagePrefix + key); return value === null ? fallback : value; }
    catch (_) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(storagePrefix + key, value); }
    catch (_) { /* Local storage can be unavailable in private browsing. */ }
  }
  function readJSON(key, fallback) {
    try { return JSON.parse(read(key, '')) || fallback; } catch (_) { return fallback; }
  }
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function currentProblem() { return problems.find(function (problem) { return problem.id === selectedId; }); }
  function progress() { return readJSON('progress', {}); }
  function history() { var items = readJSON('history', []); return Array.isArray(items) ? items : []; }
  function toast(message) {
    var element = $('toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.classList.remove('visible'); }, 2200);
  }
  function humanStatus(status) {
    var value = String(status || '').toLowerCase().replace(/[_-]/g, ' ');
    if (value === 'accepted' || value === 'ac' || value === 'passed' || value === 'success') return '通过';
    if (value === 'wrong answer' || value === 'wa') return '答案错误';
    if (value === 'compilation error' || value === 'compile error' || value === 'ce') return '编译错误';
    if (value === 'time limit exceeded' || value === 'time limit' || value === 'tle') return '运行超时';
    if (value === 'memory limit exceeded' || value === 'mle') return '内存超限';
    if (value === 'runtime error' || value === 're') return '运行错误';
    if (value === 'service error' || value === 'network error') return '评测服务不可用';
    if (value === 'error' || value === 'failed') return '评测未完成';
    return status || '评测完成';
  }
  function accepted(result) {
    if (!result || typeof result !== 'object') return false;
    if (result.accepted === true || result.passed === true) return true;
    var value = String(result.status || '').toLowerCase().replace(/[_-]/g, ' ');
    return value === 'accepted' || value === 'ac' || value === 'passed';
  }
  function showResult(kind, title, message) {
    var pill = $('result-pill');
    pill.className = 'result-pill' + (kind ? ' ' + kind : '');
    pill.textContent = title;
    var box = $('result-box');
    box.className = 'result-box has-result';
    box.innerHTML = '<strong>' + escapeHTML(title) + '</strong>' + (message ? '<pre>' + escapeHTML(message) + '</pre>' : '');
  }
  function renderProgress() {
    var done = progress();
    var count = problems.reduce(function (sum, problem) { return sum + (done[problem.id] ? 1 : 0); }, 0);
    $('side-progress').textContent = count + ' / ' + problems.length;
    $('topbar-count').textContent = count + ' / ' + problems.length + ' 已完成';
    $('side-progress-bar').style.width = (problems.length ? 100 * count / problems.length : 0) + '%';
    var status = $('problem-status');
    var isDone = !!done[selectedId];
    status.className = 'status-pill' + (isDone ? ' done' : '');
    status.innerHTML = '<span></span>' + (isDone ? ' 已完成' : ' 未完成');
  }
  function renderSidebar() {
    var search = ($('problem-search').value || '').trim().toLowerCase();
    var done = progress();
    var groups = Array.from(new Set(problems.map(function (problem) { return problem.category; })));
    var host = $('side-problems');
    var html = '';
    groups.forEach(function (group) {
      var inGroup = problems.filter(function (problem) {
        var haystack = (problem.id + ' ' + problem.title + ' ' + problem.category).toLowerCase();
        return problem.category === group && (!search || haystack.indexOf(search) !== -1);
      });
      if (!inGroup.length) return;
      html += '<div class="side-group-label">' + escapeHTML(group) + '</div>';
      inGroup.forEach(function (problem) {
        html += '<button type="button" class="side-problem' + (problem.id === selectedId ? ' current' : '') + '" data-problem="' + escapeHTML(problem.id) + '"' + (problem.id === selectedId ? ' aria-current="page"' : '') + '><span class="side-id">' + escapeHTML(problem.id) + '</span><span class="side-name">' + escapeHTML(problem.title) + '</span>' + (done[problem.id] ? '<span class="side-check" aria-label="已通过">✓</span>' : '') + '</button>';
      });
    });
    host.innerHTML = html || '<div class="side-no-results">没有找到匹配的题目。</div>';
  }
  function renderHistory() {
    var items = history().filter(function (item) { return item.problemId === selectedId; }).slice(0, 4);
    var wrap = $('history-wrap');
    wrap.hidden = !items.length;
    $('history-list').innerHTML = items.map(function (item) {
      var time = new Date(item.time);
      var label = isNaN(time.getTime()) ? '' : time.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<div class="history-item"><strong class="' + (item.ok ? '' : 'history-error') + '">' + escapeHTML(humanStatus(item.status)) + '</strong><span>' + escapeHTML(item.language === 'python' ? 'Python 3' : 'C++17') + ' · ' + escapeHTML(label) + '</span></div>';
    }).join('');
  }
  function showLastResult() {
    var item = history().find(function (entry) { return entry.problemId === selectedId; });
    if (item) showResult(item.ok ? 'success' : 'error', humanStatus(item.status), item.message || '');
    else {
      $('result-pill').className = 'result-pill';
      $('result-pill').textContent = '等待提交';
      $('result-box').className = 'result-box';
      $('result-box').innerHTML = '<div class="result-empty-icon">⌁</div><div><strong>还没有提交记录</strong><p>准备好后，提交代码查看评测结果。</p></div>';
    }
  }
  function renderProblem() {
    var problem = currentProblem();
    if (!problem) return;
    var index = problems.findIndex(function (item) { return item.id === selectedId; });
    $('crumb-current').textContent = problem.id;
    $('problem-number').textContent = String(index + 1).padStart(2, '0');
    $('problem-id').textContent = problem.id;
    $('problem-title').textContent = problem.title;
    $('problem-category').textContent = problem.category;
    $('problem-theme').textContent = problem.category === '二分答案' ? '答案搜索' : (problem.category === '分治' ? '分治思考' : problem.category);
    $('mobile-problem').value = problem.id;
    $('problem-body').innerHTML =
      '<section><h3>题目描述</h3><p>' + escapeHTML(problem.description) + '</p></section>' +
      '<section><h3>输入格式</h3><p>' + escapeHTML(problem.input) + '</p></section>' +
      '<section><h3>输出格式</h3><p>' + escapeHTML(problem.output) + '</p></section>' +
      '<section><h3>数据范围</h3><p class="constraints">' + escapeHTML(problem.constraints) + '</p></section>' +
      '<section><h3>样例</h3><div class="sample-grid">' +
        '<div class="sample-block"><div class="sample-label"><span>输入</span><button type="button" data-copy="input">复制</button></div><pre>' + escapeHTML(problem.sampleInput) + '</pre></div>' +
        '<div class="sample-block"><div class="sample-label"><span>输出</span><button type="button" data-copy="output">复制</button></div><pre>' + escapeHTML(problem.sampleOutput) + '</pre></div>' +
      '</div>' + (problem.sampleExplanation ? '<p class="sample-explanation">' + escapeHTML(problem.sampleExplanation) + '</p>' : '') + '</section>';
    loadEditor();
    renderProgress();
    renderSidebar();
    renderHistory();
    if (!activeRun) showLastResult();
    else showResult('running', '正在评测', '有一份代码正在评测，完成后可在对应题目的提交记录中查看。');
    document.title = problem.id + ' · ' + problem.title + ' | 思维练习 OJ';
  }
  function sourceKey() { return 'source:' + selectedId + ':' + $('language').value; }
  function loadEditor() {
    if (!selectedId) return;
    var language = $('language').value;
    $('editor').value = read(sourceKey(), templates[language] || '');
    $('code-filename').textContent = language === 'python' ? 'solution.py' : 'solution.cpp';
    updateLineNumbers();
  }
  function updateLineNumbers() {
    var count = Math.min(1500, $('editor').value.split('\n').length);
    var rows = [];
    for (var index = 1; index <= count; index++) rows.push(index);
    $('line-numbers').textContent = rows.join('\n');
    $('line-numbers').scrollTop = $('editor').scrollTop;
  }
  function selectProblem(id) {
    if (!problems.some(function (problem) { return problem.id === id; })) return;
    selectedId = id;
    write('last-problem', id);
    if (location.hash !== '#' + id) historyReplaceHash(id);
    renderProblem();
  }
  function historyReplaceHash(id) {
    try { window.history.replaceState(null, '', '#' + encodeURIComponent(id)); }
    catch (_) { location.hash = id; }
  }
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed'; el.style.left = '-9999px';
    document.body.appendChild(el); el.select();
    var copied = document.execCommand('copy');
    el.remove();
    if (!copied) throw new Error('无法访问剪贴板');
  }
  function formatResult(result) {
    if (!result || typeof result !== 'object') return typeof result === 'string' ? result : '';
    var lines = [];
    if (result.message) lines.push(String(result.message));
    if (Number.isFinite(result.passed) && Number.isFinite(result.total)) lines.push('通过 ' + result.passed + ' / ' + result.total + ' 个测试点');
    if (result.details) lines.push(typeof result.details === 'string' ? result.details : JSON.stringify(result.details, null, 2));
    if (result.compileOutput) lines.push('编译信息：\n' + result.compileOutput);
    if (result.stderr) lines.push('错误信息：\n' + result.stderr);
    if (result.stdout && !result.message) lines.push('程序输出：\n' + result.stdout);
    if (Array.isArray(result.cases) && result.cases.length) lines.push(result.cases.map(function (item, index) {
      var label = item.name || ('测试点 ' + (index + 1));
      return label + '：' + humanStatus(item.status) + (item.message ? ' · ' + item.message : '');
    }).join('\n'));
    return lines.join('\n\n');
  }
  async function submit() {
    if (activeRun || !selectedId) return;
    var code = $('editor').value;
    if (!code.trim()) { toast('请先填写代码'); $('editor').focus(); return; }
    if (!window.OJJudge || typeof window.OJJudge.run !== 'function') {
      showResult('error', '评测服务暂不可用', '题目可以继续浏览。评测服务连接完成后，即可在此提交代码。');
      return;
    }
    var problemId = selectedId;
    var language = $('language').value;
    activeRun = true;
    $('submit-button').disabled = true;
    $('submit-button').setAttribute('aria-busy', 'true');
    $('submit-label').textContent = '评测中…';
    showResult('running', '正在评测', '正在发送到本机 WSL 评测机，请稍候。');
    try {
      var result = await window.OJJudge.run({
        problemId: problemId,
        source: code,
        language: language,
        onProgress: function (state) {
          if (selectedId !== problemId) return;
          var message = typeof state === 'string' ? state : state && (state.message || state.status);
          if (state && Number.isFinite(state.completed) && Number.isFinite(state.total)) message = (message || '正在评测') + ' ' + state.completed + ' / ' + state.total;
          else if (state && Number.isFinite(state.current) && Number.isFinite(state.total)) message = (message || '正在评测') + ' ' + state.current + ' / ' + state.total;
          showResult('running', '正在评测', message || '正在处理测试数据。');
        }
      });
      if (!result || typeof result !== 'object') throw new Error('评测服务没有返回有效结果。');
      if (result.status !== 'service_error') setJudgeStatus('online');
      var ok = accepted(result);
      var status = result.status || (ok ? 'Accepted' : '评测未完成');
      var message = formatResult(result);
      var entry = { problemId: problemId, language: language, status: status, ok: ok, message: message, time: new Date().toISOString() };
      var items = history(); items.unshift(entry); write('history', JSON.stringify(items.slice(0, 100)));
      if (ok) { var done = progress(); done[problemId] = true; write('progress', JSON.stringify(done)); }
      if (selectedId === problemId) showResult(ok ? 'success' : 'error', humanStatus(status), message);
      else toast(problemId + ' 评测结束：' + humanStatus(status));
    } catch (error) {
      var detail = error && error.message ? error.message : '请检查网络连接后重试。';
      setJudgeStatus('offline');
      if (selectedId === problemId) showResult('error', '评测未完成', detail);
      else toast(problemId + ' 评测未完成');
    } finally {
      activeRun = false;
      $('submit-button').disabled = false;
      $('submit-button').removeAttribute('aria-busy');
      $('submit-label').textContent = '提交评测';
      renderProgress(); renderSidebar(); renderHistory();
      if (selectedId !== problemId) showLastResult();
    }
  }

  function setJudgeStatus(state) {
    var label = $('judge-status-label');
    var dot = $('judge-status-dot');
    dot.className = 'judge-status-dot ' + state;
    label.textContent = state === 'online' ? '本机 WSL 评测机已连接' :
      state === 'offline' ? '本机评测机未连接' : '正在检测本地评测机…';
  }
  async function checkJudgeStatus() {
    setJudgeStatus('pending');
    try {
      if (!window.OJJudge || typeof window.OJJudge.health !== 'function') throw new Error('评测模块未加载');
      await window.OJJudge.health();
      setJudgeStatus('online');
    } catch (_) { setJudgeStatus('offline'); }
  }

  $('side-problems').addEventListener('click', function (event) {
    var button = event.target.closest('[data-problem]');
    if (button) selectProblem(button.getAttribute('data-problem'));
  });
  $('problem-search').addEventListener('input', renderSidebar);
  $('home-button').addEventListener('click', function () { $('problem-search').value = ''; renderSidebar(); $('problem-search').focus(); });
  $('mobile-problem').addEventListener('change', function (event) { selectProblem(event.target.value); });
  $('language').addEventListener('change', function () { write('language', this.value); loadEditor(); });
  $('editor').addEventListener('input', function () { if (selectedId) write(sourceKey(), this.value); updateLineNumbers(); });
  $('editor').addEventListener('scroll', function () { $('line-numbers').scrollTop = this.scrollTop; });
  $('editor').addEventListener('keydown', function (event) {
    if (event.key === 'Tab') {
      event.preventDefault(); var start = this.selectionStart; var end = this.selectionEnd;
      this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 4;
      this.dispatchEvent(new Event('input', { bubbles: true }));
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); }
  });
  $('submit-button').addEventListener('click', submit);
  $('judge-recheck').addEventListener('click', checkJudgeStatus);
  $('problem-body').addEventListener('click', async function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button || !currentProblem()) return;
    try { await copyText(button.getAttribute('data-copy') === 'input' ? currentProblem().sampleInput : currentProblem().sampleOutput); toast('已复制'); }
    catch (_) { toast('复制失败，请手动选择文本'); }
  });
  $('clear-history').addEventListener('click', function () {
    write('history', JSON.stringify(history().filter(function (item) { return item.problemId !== selectedId; })));
    renderHistory(); showLastResult(); toast('已清空本题提交记录');
  });
  window.addEventListener('hashchange', function () { selectProblem(decodeURIComponent(location.hash.slice(1))); });

  var savedLanguage = read('language', 'cpp');
  $('language').value = savedLanguage === 'python' ? 'python' : 'cpp';
  fetch('./problems.json').then(function (response) {
    if (!response.ok) throw new Error('题目数据加载失败');
    return response.json();
  }).then(function (data) {
    if (!Array.isArray(data) || !data.length) throw new Error('题目数据为空');
    problems = data;
    $('side-count').textContent = String(problems.length).padStart(2, '0');
    $('collection-count').textContent = String(problems.length).padStart(2, '0');
    $('mobile-problem').innerHTML = problems.map(function (problem) { return '<option value="' + escapeHTML(problem.id) + '">' + escapeHTML(problem.id + ' · ' + problem.title) + '</option>'; }).join('');
    var hash = decodeURIComponent(location.hash.slice(1));
    var initial = problems.some(function (problem) { return problem.id === hash; }) ? hash : read('last-problem', problems[0].id);
    if (!problems.some(function (problem) { return problem.id === initial; })) initial = problems[0].id;
    selectProblem(initial);
  }).catch(function (error) {
    $('problem-title').textContent = '题目暂时无法加载';
    $('problem-body').innerHTML = '<p>' + escapeHTML(error.message || '请稍后重试。') + '</p>';
    $('side-problems').innerHTML = '<div class="side-no-results">题目加载失败</div>';
  });
  checkJudgeStatus();
}());
