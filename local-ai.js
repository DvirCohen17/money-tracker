/* MoneyTracker Local AI bridge */
(function () {
  const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
  const MODEL_VERSION = '1';
  let worker = null;
  let requestId = 0;
  const pending = new Map();
  let loadPromise = null;
  let status = 'idle';
  let lastError = '';

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('./local-ai-worker.js', { type: 'module' });
    worker.onmessage = e => {
      const m = e.data || {};
      if (m.type === 'progress') { status = 'downloading'; window.dispatchEvent(new CustomEvent('local-ai-progress', { detail: m })); return; }
      if (m.type === 'loading') { status = 'loading'; window.dispatchEvent(new CustomEvent('local-ai-status', { detail: m })); return; }
      if (m.type === 'ready') { status = 'ready'; window.dispatchEvent(new CustomEvent('local-ai-status', { detail: m })); return; }
      if (m.type === 'error') {
        status = 'error'; lastError = m.error || 'Unknown error';
        const p = pending.get(m.id); if (p) { pending.delete(m.id); p.reject(new Error(lastError)); }
        window.dispatchEvent(new CustomEvent('local-ai-status', { detail: { error: lastError } }));
        return;
      }
      if (m.type === 'result') {
        const p = pending.get(m.id); if (p) { pending.delete(m.id); p.resolve(m.result); }
      }
    };
    worker.onerror = e => {
      status = 'error'; lastError = e.message || 'Local AI worker failed';
      for (const [, p] of pending) p.reject(new Error(lastError));
      pending.clear();
      window.dispatchEvent(new CustomEvent('local-ai-status', { detail: { error: lastError } }));
      worker = null;
    };
    return worker;
  }

  function call(action, payload = {}) {
    const w = ensureWorker();
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, action, ...payload });
    });
  }

  async function load(onProgress) {
    if (status === 'ready') return true;
    if (!loadPromise) {
      loadPromise = call('load').then(() => {
        status = 'ready';
        return true;
      }).catch(err => {
        loadPromise = null;
        status = 'error';
        lastError = err.message;
        throw err;
      });
    }
    if (onProgress) {
      const handler = e => onProgress(e.detail);
      window.addEventListener('local-ai-progress', handler);
      loadPromise.finally(() => window.removeEventListener('local-ai-progress', handler));
    }
    return loadPromise;
  }

  function getExamples() {
    try { return typeof window.getLocalAIExamples === 'function' ? (window.getLocalAIExamples() || {}) : {}; } catch { return {}; }
  }

  async function classify(description) {
    const text = String(description || '').trim();
    if (!text) return null;
    const result = await call('classify', { description: text, examples: getExamples() });
    return result;
  }

  function remember(description, category) {
    const text = String(description || '').trim();
    if (!text || !category || category === 'שונות') return;
    try { if (typeof window.rememberLocalAIExample === 'function') window.rememberLocalAIExample(text, category); } catch {}
  }

  window.localCategoryAI = {
    modelId: MODEL_ID,
    load,
    classify,
    remember,
    getStatus: () => ({ status, error: lastError }),
    reset: () => { if (worker) worker.terminate(); worker = null; loadPromise = null; status = 'idle'; lastError = ''; }
  };
})();
