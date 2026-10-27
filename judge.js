(function () {
  'use strict';

  // Only the local WSL judge receives submissions. It is deliberately fixed to
  // the loopback address; public websites cannot configure a remote destination.
  const endpoint = 'http://127.0.0.1:8766';

  async function request(path, options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(endpoint + path, {
        ...options,
        cache: 'no-store',
        signal: controller.signal
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error('本地评测机返回的数据无法识别，请检查评测机版本。'); }
      if (!response.ok) {
        const detail = data && (data.message || data.error);
        throw new Error(detail ? String(detail) : `本地评测机返回 HTTP ${response.status}。`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接或评测超时，请检查 WSL 评测机后重试。');
      if (error instanceof TypeError) throw new Error('无法连接本地评测机。请确认 WSL 服务正在运行，并允许浏览器访问本地网络。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function health() {
    const data = await request('/health', { method: 'GET' }, 4000);
    if (!data || typeof data !== 'object' || data.status !== 'ok' || data.service !== 'wsl-oj') {
      throw new Error('本地端口上没有运行兼容的 WSL 评测机。');
    }
    return data;
  }

  async function run({ problemId, source, language, onProgress } = {}) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('请先填写要提交的代码。');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(problemId))) throw new Error('题目编号无效。');
    if (!['cpp', 'python'].includes(language)) throw new Error('暂不支持该语言。');
    if (typeof onProgress === 'function') onProgress({ message: '正在本机编译并运行测试，请稍候。' });
    const result = await request('/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemId, language, source })
    }, 300000);
    if (!result || typeof result !== 'object' || typeof result.status !== 'string') {
      throw new Error('本地评测机没有返回有效结果。');
    }
    return result;
  }

  window.OJJudge = { run, health, endpoint };
}());
