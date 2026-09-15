/**
 * Mock Web Worker Engine — Nice Assistant v1.2.0
 * Simulates isolated Web Workers (embedding-worker.js & local-llm-worker.js)
 * with deterministic vector computation, grounded RAG synthesis, mutex serialization,
 * and idle auto-eviction simulation.
 */

export class MockWorker {
  constructor(scriptUrl) {
    this.scriptUrl = String(scriptUrl || '');
    this.isTerminated = false;
    this.listeners = new Map();
    this.onmessage = null;
    this.onerror = null;
    this.ready = true;
    this.lastActiveTime = Date.now();
    this.simulatedTimeoutMs = 0;
    this.shouldThrowOnMessage = false;

    // Track instance in global registry
    MockWorker.instances.push(this);
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  dispatchEvent(event) {
    if (this.isTerminated) return;
    if (event.type === 'message' && typeof this.onmessage === 'function') {
      this.onmessage(event);
    }
    if (event.type === 'error' && typeof this.onerror === 'function') {
      this.onerror(event);
    }
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const fn of handlers) {
        try {
          fn(event);
        } catch (e) {
          console.error('[MockWorker listener error]', e);
        }
      }
    }
  }

  terminate() {
    this.isTerminated = true;
    this.ready = false;
    MockWorker.terminatedInstances.push(this);
  }

  postMessage(data) {
    if (this.isTerminated) {
      throw new Error('Cannot postMessage on a terminated worker');
    }

    this.lastActiveTime = Date.now();

    if (this.shouldThrowOnMessage) {
      setTimeout(() => {
        const errorEvent = { type: 'error', message: 'Worker internal failure', error: new Error('Worker internal failure') };
        this.dispatchEvent(errorEvent);
      }, 5);
      return;
    }

    if (this.simulatedTimeoutMs > 0) {
      // Intentionally delay past timeout
      setTimeout(() => {
        if (!this.isTerminated) {
          this._handleMessage(data);
        }
      }, this.simulatedTimeoutMs);
      return;
    }

    // Standard asynchronous delivery
    setTimeout(() => {
      if (!this.isTerminated) {
        this._handleMessage(data);
      }
    }, 5);
  }

  _handleMessage(data) {
    const action = data?.type || data?.action || '';
    const id = data?.id || data?.requestId || `req_${Date.now()}`;

    // --- EMBEDDING WORKER PROTOCOL ---
    if (action === 'init' || action === 'init-embedding') {
      this.dispatchEvent({
        type: 'message',
        data: { type: 'init-done', status: 'ready', model: 'all-MiniLM-L6-v2' },
      });
      return;
    }

    if (action === 'embed' || action === 'embedText') {
      const text = String(data.text || '');
      const embedding = MockWorker.computeDeterministicEmbedding(text);
      this.dispatchEvent({
        type: 'message',
        data: { type: 'embed-done', id, embedding, dims: embedding.length },
      });
      return;
    }

    if (action === 'embed-batch' || action === 'embedBatch') {
      const texts = Array.isArray(data.texts) ? data.texts : [];
      const embeddings = texts.map(t => MockWorker.computeDeterministicEmbedding(String(t)));
      this.dispatchEvent({
        type: 'message',
        data: { type: 'embed-batch-done', id, embeddings },
      });
      return;
    }

    // --- LOCAL LLM WORKER PROTOCOL ---
    if (action === 'init-llm' || action === 'check-ready') {
      this.dispatchEvent({
        type: 'message',
        data: { type: 'ready', status: 'ready', model: 'flan-t5-small' },
      });
      return;
    }

    if (action === 'generate' || action === 'run' || action === 'summarize') {
      const prompt = String(data.prompt || data.input || data.text || '');
      const maxTokens = data.maxTokens || data.max_new_tokens || 150;
      const responseText = MockWorker.synthesizeGroundedResponse(prompt, maxTokens);

      this.dispatchEvent({
        type: 'message',
        data: {
          type: 'generate-done',
          id,
          response: responseText,
          text: responseText,
          generated_text: responseText,
          tokensUsed: Math.min(maxTokens, Math.ceil(responseText.length / 4)),
        },
      });
      return;
    }

    // Default fallback
    this.dispatchEvent({
      type: 'message',
      data: { type: 'ack', id, status: 'ok' },
    });
  }

  // --- DETERMINISTIC VECTOR & TEXT SYNTHESIS ---
  static computeDeterministicEmbedding(text) {
    const dim = 384;
    const vec = new Float32Array(dim);
    const cleaned = String(text || '').toLowerCase().trim();
    if (!cleaned) return Array.from(vec);

    let hash = 0;
    for (let i = 0; i < cleaned.length; i++) {
      hash = (hash << 5) - hash + cleaned.charCodeAt(i);
      hash |= 0;
      const idx = Math.abs(hash) % dim;
      vec[idx] += 1.0 / (1.0 + (i % 7));
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1.0;
    for (let i = 0; i < dim; i++) vec[i] /= norm;

    return Array.from(vec);
  }

  static synthesizeGroundedResponse(prompt, maxTokens = 150) {
    const p = String(prompt || '');

    // Extract Question and Context if present
    const qMatch = p.match(/(?:Question|Query):\s*([^\n]+)/i);
    const cMatch = p.match(/(?:Context|Evidence|Passages):\s*([\s\S]+?)(?:\n\s*(?:Question|Answer):|$)/i);

    const question = qMatch ? qMatch[1].trim() : p;
    const context = cMatch ? cMatch[1].trim() : '';

    if (!context || context.length < 10) {
      return "I could not find enough evidence in local files to answer this question.";
    }

    // Search context for keywords matching question
    const qWords = question.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    const sentences = context.split(/(?<=[.!?\n])\s+/).filter(s => s.trim().length > 5);

    let bestSentence = '';
    let bestScore = 0;

    for (const sent of sentences) {
      const lower = sent.toLowerCase();
      let score = 0;
      for (const w of qWords) {
        if (lower.includes(w)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sent.trim();
      }
    }

    if (bestScore === 0 || !bestSentence) {
      return "I could not find enough evidence in local files to answer this question.";
    }

    // Look for file citation preceding or containing bestSentence
    let citation = '';
    const bestIdx = context.indexOf(bestSentence);
    if (bestIdx >= 0) {
      const preceding = context.slice(0, bestIdx + bestSentence.length);
      const matches = [...preceding.matchAll(/\[(?:File|Table|Doc|Sheet):\s*([^\]]+)\]/gi)];
      if (matches.length > 0) {
        citation = ` (Source: ${matches[matches.length - 1][1]})`;
      }
    }
    if (!citation) {
      const fileCitationMatch = context.match(/\[(?:File|Table|Doc|Sheet):\s*([^\]]+)\]/i);
      citation = fileCitationMatch ? ` (Source: ${fileCitationMatch[1]})` : '';
    }

    return `${bestSentence}${citation}`;
  }

  static resetRegistry() {
    MockWorker.instances = [];
    MockWorker.terminatedInstances = [];
  }
}

MockWorker.instances = [];
MockWorker.terminatedInstances = [];

export default MockWorker;
