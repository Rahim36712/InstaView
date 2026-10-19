/** InstaView RAG: local micro-dialogue chunking and sparse BM25 retrieval. */
(function (root) {
  'use strict';
  const STOP_WORDS = new Set(('a an the and or to of in on at for from with is are was were be been ' +
    'i me my you your we our they their it this that what when where who how did do does ' +
    'can could would should please tell find show about message messages chat conversation ' +
    'said say talk talked discuss discussed').split(' '));
  const EXPANSIONS = [
    ['travel', 'traveling', 'travelling', 'traveled', 'trip', 'vacation', 'safar', 'سفر'],
    ['exam', 'exams', 'examination', 'imtihan', 'امتحان'],
    ['birthday', 'birthdays', 'bday'],
    ['university', 'uni', 'college'],
    ['meet', 'meeting', 'met', 'milna', 'ملاقات']
  ];
  const lineCache = new WeakMap();
  const termCache = new WeakMap();

  function timestampMs(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === 'number') return Number.isFinite(value) ? (Math.abs(value) < 1e11 ? value * 1000 : value) : null;
    if (typeof value === 'string' && value.trim()) {
      const time = Date.parse(value);
      return Number.isFinite(time) ? time : null;
    }
    return null;
  }
  function dateText(value) {
    const ms = timestampMs(value);
    return ms === null ? 'Unknown date' : new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
  function estimateTokens(text) {
    // Conservative multilingual estimate, not Gemini's exact tokenizer.
    text = String(text);
    const unicode = (text.match(/[^\x00-\x7f]/g) || []).length;
    return Math.ceil((text.length - unicode) / 4 + unicode);
  }
  function formatMessage(message, options = {}) {
    const cached = lineCache.get(message);
    if (cached && cached.ownerName === options.ownerName) return cached.line;
    const sender = message.isOwner ? options.ownerName || message.sender || 'You' : message.sender || 'Unknown';
    const extra = { photo: ' [Photo; image not analyzed]', audio: ' [Voice note; not transcribed]', reel: ' [Reel; video not analyzed]' }[message.type] || '';
    const text = String(message.text || '').replace(/\r?\n/g, ' ').trim();
    const line = `[#${message.id} ${dateText(message.timestamp)}] ${sender}: ${text}${extra}`;
    lineCache.set(message, { ownerName: options.ownerName, line });
    return line;
  }
  function tokenize(text) {
    return (String(text || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) || [])
      .filter(t => !STOP_WORDS.has(t));
  }
  function queryTerms(query) {
    const terms = new Map(tokenize(query).slice(0, 64).map(t => [t, 1]));
    EXPANSIONS.forEach(group => {
      if (group.some(term => terms.has(term))) group.forEach(term => {
        if (!terms.has(term)) terms.set(term, 0.45);
      });
    });
    return terms;
  }
  const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

  class ConversationalChunker {
    static *groups(messages, options = {}) {
      const size = Math.max(5, Math.min(8, options.chunkSize || 6));
      const overlap = Math.max(0, Math.min(2, options.overlap ?? 2));
      const maxGap = (options.maxTimeGapSeconds ?? 1200) * 1000;
      let group = [], previous = null;
      for (const message of messages || []) {
        const time = timestampMs(message.timestamp);
        const sessionBreak = previous !== null && time !== null && Math.abs(time - previous) > maxGap;
        if (group.length && (sessionBreak || group.length >= size)) {
          yield group;
          group = sessionBreak ? [] : group.slice(-overlap || group.length);
        }
        group.push(message);
        previous = time;
      }
      if (group.length) yield group;
    }
    static createChunk(id, messages, options = {}) {
      const rawText = messages.map(m => formatMessage(m, options)).join('\n');
      const chunk = {
        id, startMsgId: messages[0].id, endMsgId: messages[messages.length - 1].id,
        dateRange: `${dateText(messages[0].timestamp)} – ${dateText(messages[messages.length - 1].timestamp)}`,
        startTime: timestampMs(messages[0].timestamp), endTime: timestampMs(messages[messages.length - 1].timestamp),
        participants: new Set(messages.map(m => m.sender || 'Unknown')),
        messages, rawText, tokenCountEstimate: estimateTokens(rawText)
      };
      chunk.ownerName = options.ownerName;
      return chunk;
    }
    static chunk(messages, options = {}) {
      return Array.from(this.groups(messages, options), (group, id) => this.createChunk(id, group, options));
    }
  }

  class BM25Index {
    constructor(k1 = 1.2, b = 0.75) {
      this.k1 = k1; this.b = b; this.chunks = []; this.docLengths = [];
      this.avgDocLength = 1; this.totalLength = 0;
      this.invertedIndex = new Map(); this.idf = new Map(); this.messageChunks = new Map();
    }
    tokenize(text) { return tokenize(text); }
    add(chunk) {
      this.chunks.push(chunk);
      const terms = [];
      chunk.messages.forEach(message => {
        // Dates and IDs are indexed separately; repeated timestamp punctuation
        // should not dominate dialogue length or waste posting-list memory.
        const line = `${message.sender || ''} ${message.text || ''}`;
        let cached = termCache.get(message);
        if (!cached || cached.line !== line) {
          cached = { line, terms: tokenize(line) };
          termCache.set(message, cached);
        }
        for (const term of cached.terms) terms.push(term);
        if (!this.messageChunks.has(message.id)) this.messageChunks.set(message.id, []);
        this.messageChunks.get(message.id).push(chunk.id);
      });
      const dates = new Set(chunk.messages.map(m => dateText(m.timestamp).slice(0, 10)));
      dates.forEach(date => { for (const term of tokenize(date)) terms.push(term); });
      this.docLengths[chunk.id] = terms.length;
      this.totalLength += terms.length;
      const frequencies = new Map();
      terms.forEach(term => frequencies.set(term, (frequencies.get(term) || 0) + 1));
      frequencies.forEach((termFrequency, term) => {
        if (!this.invertedIndex.has(term)) this.invertedIndex.set(term, []);
        this.invertedIndex.get(term).push({ chunkId: chunk.id, termFrequency });
      });
    }
    finish() {
      this.avgDocLength = this.totalLength / (this.chunks.length || 1) || 1;
      const n = this.chunks.length;
      this.invertedIndex.forEach((postings, term) => {
        this.idf.set(term, Math.log(1 + (n - postings.length + 0.5) / (postings.length + 0.5)));
      });
    }
    buildIndex(chunks) {
      this.chunks = []; this.docLengths = []; this.totalLength = 0;
      this.invertedIndex.clear(); this.idf.clear();
      this.messageChunks.clear();
      chunks.forEach(chunk => this.add(chunk)); this.finish();
    }
    search(query, topK = 10, options = {}) {
      const terms = queryTerms(query), scores = new Map();
      terms.forEach((weight, term) => {
        (this.invertedIndex.get(term) || []).forEach(({ chunkId, termFrequency: tf }) => {
          const denominator = tf + this.k1 * (1 - this.b + this.b * this.docLengths[chunkId] / this.avgDocLength);
          scores.set(chunkId, (scores.get(chunkId) || 0) + weight * this.idf.get(term) * tf * (this.k1 + 1) / denominator);
        });
      });
      const ids = [...String(query).matchAll(/#(\d+)/g)].map(match => Number(match[1]));
      ids.forEach(id => (this.messageChunks.get(id) || []).forEach(chunkId => {
        if (!scores.has(chunkId)) scores.set(chunkId, 0);
      }));
      const queryWords = new Set(tokenize(query));
      const latest = this.chunks[this.chunks.length - 1]?.endTime || 0;
      const results = [];
      scores.forEach((score, id) => {
        const chunk = this.chunks[id];
        if (options.startMsgId !== undefined && chunk.endMsgId < options.startMsgId) return;
        if (options.endMsgId !== undefined && chunk.startMsgId > options.endMsgId) return;
        if ([...chunk.participants].some(name => tokenize(name).some(t => queryWords.has(t)))) score *= 1.25;
        if (ids.some(msgId => chunk.messages.some(m => m.id === msgId))) score += 100;
        if (options.recency && chunk.endTime !== null) score *= 1 + 0.2 / (1 + Math.max(0, latest - chunk.endTime) / 86400000);
        if (score >= (options.minScore ?? 0.15)) results.push({ chunk, score });
      });
      return results.sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id).slice(0, Math.max(1, Math.min(30, topK)));
    }
  }

  function packChunks(rankedChunks, maxTokens = 850, options = {}) {
    const chunks = [], used = new Set();
    let remaining = maxTokens;
    for (const original of rankedChunks) {
      const messages = [];
      for (const message of original.messages) {
        if (used.has(message.id)) continue;
        if (options.startMsgId !== undefined && message.id < options.startMsgId) continue;
        if (options.endMsgId !== undefined && message.id > options.endMsgId) continue;
        let packed = message;
        let cost = estimateTokens(formatMessage(packed, options)) + 2;
        if (cost > remaining && remaining >= 75) {
          // Keep source identity while explicitly marking abbreviated message text.
          const chars = Array.from(String(message.text || ''));
          let low = 0, high = chars.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            const candidate = { ...message, text: chars.slice(0, middle).join('') + ' [excerpt truncated]' };
            if (estimateTokens(formatMessage(candidate, options)) + 2 <= remaining) low = middle;
            else high = middle - 1;
          }
          packed = { ...message, text: chars.slice(0, low).join('') + ' [excerpt truncated]' };
          cost = estimateTokens(formatMessage(packed, options)) + 2;
        }
        if (cost > remaining) continue;
        messages.push(packed); used.add(message.id); remaining -= cost;
      }
      if (messages.length) chunks.push(ConversationalChunker.createChunk(original.id, messages, options));
      if (remaining < 30) break;
    }
    const ordered = chunks.slice().sort((a, b) => a.startMsgId - b.startMsgId);
    const context = ordered.map(chunk => chunk.rawText).join('\n---\n');
    return { chunks, context, estimatedTokens: estimateTokens(context), messageIds: [...used], truncated: chunks.length < rankedChunks.length || chunks.some(c => c.rawText.includes('[excerpt truncated]')) };
  }
  function sampleContext(messages, maxTokens = 850, options = {}) {
    // Uniform chronological sample rather than silently dropping the beginning.
    let count = Math.min(messages.length, 48);
    if (count) {
      const probe = Array.from({ length: count }, (_, i) => messages[count === 1 ? 0 : Math.round(i * (messages.length - 1) / (count - 1))]);
      const averageCost = probe.reduce((sum, message) => sum + estimateTokens(formatMessage(message, options)) + 2, 0) / count;
      count = Math.max(1, Math.min(count, Math.floor(maxTokens / (averageCost || 1))));
    }
    const sampled = Array.from({ length: count }, (_, i) => messages[count === 1 ? 0 : Math.round(i * (messages.length - 1) / (count - 1))]);
    const chunks = sampled.map((m, i) => ConversationalChunker.createChunk(i, [m], options));
    const result = packChunks(chunks, maxTokens, options);
    result.sampled = result.messageIds.length < messages.length;
    return result;
  }

  class RAGRetriever {
    constructor(index, options = {}) { this.index = index; this.options = options; }
    retrieve(query, topK = 10, options = {}) {
      const ranked = this.index.search(query, topK, options);
      const result = packChunks(ranked.map(r => r.chunk), options.maxTokens ?? 850, this.options);
      result.matchCount = ranked.length;
      return result;
    }
  }

  class RAGManager {
    constructor() {
      this.worker = null; this.pending = new Map(); this.sequence = 0; this.generation = 0;
      this.isReady = false; this.retriever = null; this.ready = Promise.resolve();
    }
    clear() {
      this.generation++; this.isReady = false; this.retriever = null;
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.pending.forEach(({ reject }) => reject(new DOMException('Conversation changed', 'AbortError')));
      this.pending.clear();
    }
    rpc(type, payload) {
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try { this.worker.postMessage({ id, type, ...payload }); }
        catch (error) { this.pending.delete(id); reject(error); }
      });
    }
    buildIndex(messages, options = {}) {
      this.clear();
      const generation = this.generation;
      this.ready = this.build(messages, options, generation);
      // A superseded build can be intentionally abandoned by the UI.
      this.ready.catch(() => {});
      return this.ready;
    }
    async build(messages, options, generation) {
      if (typeof document !== 'undefined' && typeof Worker !== 'undefined' && location.protocol !== 'file:') {
        try {
          this.worker = new Worker(new URL('rag-worker.js?v=20261001', document.currentScript?.src || new URL('js/rag.js', document.baseURI)));
          this.worker.onmessage = ({ data }) => {
            const pending = this.pending.get(data.id);
            if (!pending) return;
            this.pending.delete(data.id);
            if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
          };
          this.worker.onerror = () => {
            this.pending.forEach(({ reject }) => reject(new Error('Background indexing unavailable')));
            this.pending.clear();
          };
          // Clone only text metadata: File/media objects stay out of the worker.
          const light = [];
          for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            light.push({ id: m.id, text: m.text, sender: m.sender, timestamp: m.timestamp, isOwner: m.isOwner, type: m.type });
            if (i && i % 2000 === 0) {
              await yieldFrame();
              if (generation !== this.generation) throw new DOMException('Conversation changed', 'AbortError');
            }
          }
          const stats = await this.rpc('build', { messages: light, options });
          if (generation !== this.generation) throw new DOMException('Conversation changed', 'AbortError');
          this.isReady = true;
          console.info(`[InstaView RAG] Indexed ${messages.length} messages into ${stats.chunks} chunks in ${stats.indexMs.toFixed(1)}ms (worker)`);
          return stats;
        } catch (error) {
          if (generation !== this.generation || error.name === 'AbortError') throw error;
          if (this.worker) this.worker.terminate();
          this.worker = null;
        }
      }
      const start = performance.now(), index = new BM25Index();
      let sliceStart = start;
      for (const group of ConversationalChunker.groups(messages, options)) {
        index.add(ConversationalChunker.createChunk(index.chunks.length, group, options));
        if (performance.now() - sliceStart > 8) {
          await yieldFrame(); sliceStart = performance.now();
          if (generation !== this.generation) throw new DOMException('Conversation changed', 'AbortError');
        }
      }
      index.finish();
      if (generation !== this.generation) throw new DOMException('Conversation changed', 'AbortError');
      this.retriever = new RAGRetriever(index, options); this.isReady = true;
      const stats = { chunks: index.chunks.length, indexMs: performance.now() - start, worker: false };
      console.info(`[InstaView RAG] Indexed ${messages.length} messages into ${stats.chunks} chunks in ${stats.indexMs.toFixed(1)}ms (cooperative fallback)`);
      return stats;
    }
    async retrieve(query, topK = 10, options = {}) {
      const generation = this.generation;
      await this.ready;
      if (generation !== this.generation) throw new DOMException('Conversation changed', 'AbortError');
      if (!this.isReady) return { chunks: [], context: '', estimatedTokens: 0, messageIds: [] };
      return this.worker ? this.rpc('retrieve', { query, topK, options }) : this.retriever.retrieve(query, topK, options);
    }
  }
  root.InstaViewRAG = new RAGManager();
  Object.assign(root.InstaViewRAG, { ConversationalChunker, BM25Index, RAGRetriever, timestampMs, dateText, estimateTokens, formatMessage, sampleContext, packChunks });
})(typeof window === 'undefined' ? globalThis : window);
