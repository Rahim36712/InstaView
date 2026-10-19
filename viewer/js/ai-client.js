/** Gemini transport: one request at a time, bounded retries and quota cooldown. */
(function (root) {
  'use strict';
  class GeminiClient {
    constructor(options = {}) {
      this.fetch = options.fetch || ((...args) => fetch(...args));
      this.now = options.now || (() => Date.now());
      this.busy = false; this.cooldownUntil = 0; this.cache = new Map();
    }
    clearCache() { this.cache.clear(); }
    async generate(prompt, system, options) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const maxOutputTokens = Math.max(256, Math.min(4096, options.maxOutputTokens || 2048));
      const fast = options.fast !== false;
      const started = this.now();
      const cacheKey = JSON.stringify([options.key, options.models.map(m => m.id), prompt, system, maxOutputTokens, fast]);
      const cached = this.cache.get(cacheKey);
      if (cached && this.now() - cached.time < 300000) {
        options.onText?.(cached.text);
        options.onComplete?.({ cached: true, totalMs: this.now() - started, firstTextMs: 0 });
        return cached.text;
      }
      if (this.busy) throw new Error('An AI request is already running. Wait for it to finish.');
      const remaining = Math.ceil((this.cooldownUntil - this.now()) / 1000);
      if (remaining > 0) throw new Error(`Quota cooldown: try again in ${remaining}s. You can inspect the retrieved messages now.`);
      if (!options.key) throw new Error('Add a Gemini API key in Settings to generate an answer.');
      const models = options.models.slice(0, 3);
      if (!models.length) throw new Error('No text models are available. Refresh Models in Settings.');
      this.busy = true;
      let candidate = 0, lastError;
      try {
        for (let attempt = 0; attempt < 3 && candidate < models.length; attempt++) {
          if (attempt) await this.pause(Math.min(4000, 1000 * 2 ** (attempt - 1)), options.signal);
          const model = models[candidate];
          options.onAttempt?.(attempt + 1);
          const controller = new AbortController();
          const cancel = () => controller.abort();
          options.signal?.addEventListener('abort', cancel, { once: true });
          const timeout = setTimeout(cancel, 35000);
          try {
            if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const payload = {
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.15, maxOutputTokens }
            };
            // Only send reasoning controls for explicitly supported model families.
            if (fast && /^gemini-2\.5-flash(?:-lite)?$/.test(model.id)) payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
            if (fast && /^gemini-3\.5-flash-lite$/.test(model.id)) payload.generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
            if (fast && /^gemini-3\.8-flash$/.test(model.id)) payload.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
            if (system) payload.systemInstruction = { parts: [{ text: system }] };
            const method = options.onText ? 'streamGenerateContent?alt=sse' : 'generateContent';
            const response = await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:${method}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.key },
              body: JSON.stringify(payload), signal: controller.signal
            });
            const streamed = response.ok && options.onText && response.headers?.get('content-type')?.includes('text/event-stream') && response.body?.getReader;
            const data = streamed ? null : await response.json().catch(() => ({}));
            if (!response.ok) {
              if (response.status === 429) {
                const retryInfo = data.error?.details?.find(detail => detail.retryDelay)?.retryDelay;
                const header = response.headers.get('Retry-After');
                const seconds = Number.parseFloat(retryInfo || header);
                const httpDate = header ? Date.parse(header) : NaN;
                const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(httpDate) ? httpDate - this.now() : 60000;
                this.cooldownUntil = this.now() + Math.max(60000, delay);
                options.onCooldown?.(this.cooldownUntil);
                throw Object.assign(new Error('Google quota exceeded. Requests are paused; check your quota in Google AI Studio or retry after the cooldown.'), { terminal: true });
              }
              if (response.status === 404) {
                candidate++;
                lastError = new Error('The selected model is unavailable. Refresh Models in Settings.');
                continue;
              }
              if (response.status >= 500) {
                lastError = new Error('Google is temporarily unavailable. Retrieved evidence remains available; try again later.');
                // One delayed retry, then one alternate model, with three attempts total.
                if (attempt >= 1) candidate++;
                continue;
              }
              const message = response.status === 401 || response.status === 403 ? 'Gemini rejected this API key or its permissions. Check Settings.' :
                response.status === 400 ? 'Gemini rejected the request. Check the key, model availability, and selected context.' : `Gemini returned HTTP ${response.status}.`;
              throw Object.assign(new Error(message), { terminal: true });
            }
            let firstTextMs = null;
            const emit = text => { if (firstTextMs === null) firstTextMs = this.now() - started; options.onText?.(text); };
            let text;
            if (streamed) text = await this.readStream(response.body, controller.signal, emit);
            else {
              this.checkResult(data);
              text = (data.candidates?.[0]?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('\n').trim();
              if (text) emit(text);
            }
            if (!text) throw Object.assign(new Error('Gemini returned no answer. Try a more specific question.'), { terminal: true });
            this.cache.set(cacheKey, { text, time: this.now() });
            while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
            options.onModel?.(model);
            options.onComplete?.({ cached: false, totalMs: this.now() - started, firstTextMs });
            return text;
          } catch (error) {
            if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (error.terminal) throw error;
            lastError = error.name === 'AbortError' ? new Error('AI request timed out. Try again later or narrow the context.') : new Error('Could not reach Gemini. Check your internet connection.');
            if (attempt >= 1) candidate++;
          } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', cancel);
          }
        }
        throw lastError || new Error('Gemini could not complete the request. Try again later.');
      } finally {
        this.busy = false;
      }
    }
    checkResult(data) {
      if (data.error || data.promptFeedback?.blockReason) throw Object.assign(new Error('Gemini blocked or rejected this response. No complete answer was generated.'), { terminal: true });
      const reason = data.candidates?.[0]?.finishReason;
      if (reason && reason !== 'STOP') throw Object.assign(new Error(reason === 'MAX_TOKENS' ?
        'The answer exceeded its output limit and was withheld. Ask a narrower question or select a smaller range.' :
        'Gemini stopped this answer before completion. Review the local evidence instead.'), { terminal: true });
    }
    async readStream(body, signal, emit) {
      const reader = body.getReader(), decoder = new TextDecoder();
      let buffer = '', text = '', finished = false;
      const cancel = () => { reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      const event = block => {
        const json = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!json || json === '[DONE]') return;
        let data;
        try { data = JSON.parse(json); } catch { throw Object.assign(new Error('Gemini returned an invalid response stream.'), { terminal: true }); }
        this.checkResult(data);
        if (data.candidates?.[0]?.finishReason === 'STOP') finished = true;
        const delta = (data.candidates?.[0]?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('');
        if (delta) {
          text += delta;
          if (text.length > 32768) throw Object.assign(new Error('Gemini returned an oversized answer.'), { terminal: true });
          emit(text);
        }
      };
      try {
        while (true) {
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const chunk = await reader.read();
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          if (buffer.length > 262144) throw Object.assign(new Error('Gemini returned an oversized stream event.'), { terminal: true });
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            event(buffer.slice(0, boundary.index));
            buffer = buffer.slice(boundary.index + boundary[0].length);
          }
          if (chunk.done) break;
        }
        if (buffer.trim()) event(buffer);
        if (!finished) throw Object.assign(new Error('The response stream ended early. The incomplete answer was withheld; retry using the saved excerpts.'), { terminal: true });
        return text.trim();
      } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    pause(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
        const cancel = () => {
          clearTimeout(timer); signal?.removeEventListener('abort', cancel);
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
        signal?.addEventListener('abort', cancel, { once: true });
      });
    }
  }
  root.InstaViewGeminiClient = GeminiClient;
})(typeof window === 'undefined' ? globalThis : window);
