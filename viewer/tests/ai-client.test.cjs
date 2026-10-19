const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../js/ai-client.js');
const Client = globalThis.InstaViewGeminiClient;
const options = { key: 'test-key', models: [{ id: 'model-one' }, { id: 'model-two' }] };
const response = (status, body, headers = {}) => ({ ok: status === 200, status, headers: new Headers(headers), json: async () => body });
const success = () => response(200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Answer [#0]' }] } }] });

test('429 sends only one request and pauses subsequent requests across models', async () => {
  let calls = 0;
  const client = new Client({ now: () => 1000, fetch: async () => { calls++; return response(429, { error: { details: [{ retryDelay: '120s' }] } }); } });
  await assert.rejects(client.generate('q', '', options), /quota exceeded/i);
  assert.equal(calls, 1);
  assert.equal(client.cooldownUntil, 121000);
  await assert.rejects(client.generate('different question', '', options), /cooldown/i);
  assert.equal(calls, 1);
  assert.equal(client.busy, false);
});
test('auth and malformed request errors stop instead of trying every model', async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0;
    const client = new Client({ fetch: async () => { calls++; return response(status, {}); } });
    await assert.rejects(client.generate('q', '', options));
    assert.equal(calls, 1);
  }
});
test('temporary errors have at most three attempts and delayed retries', async () => {
  const modelURLs = [], pauses = [];
  const client = new Client({ fetch: async url => { modelURLs.push(url); return response(503, {}); } });
  client.pause = async ms => { pauses.push(ms); };
  await assert.rejects(client.generate('q', '', options), /temporarily unavailable/);
  assert.equal(modelURLs.length, 3);
  assert.ok(modelURLs[0].includes('model-one'));
  assert.ok(modelURLs[2].includes('model-two'));
  assert.deepEqual(pauses, [1000, 2000]);
});
test('404 switches models, caches successful results and excludes thinking', async () => {
  let calls = 0, request;
  const client = new Client({ fetch: async (_, init) => { request = init; return ++calls === 1 ? response(404, {}) : success(); } });
  client.pause = async () => {};
  assert.equal(await client.generate('q', 'system', options), 'Answer [#0]');
  assert.equal(await client.generate('q', 'system', options), 'Answer [#0]');
  assert.equal(calls, 2);
  assert.equal(request.headers['x-goog-api-key'], 'test-key');
  assert.equal(JSON.parse(request.body).systemInstruction.parts[0].text, 'system');
});
test('overlapping requests are refused and cancellation releases the lock', async () => {
  const controller = new AbortController();
  const client = new Client({ fetch: async (_, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))) });
  const pending = client.generate('q', '', { ...options, signal: controller.signal });
  await assert.rejects(client.generate('other', '', options), /already running/);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(client.busy, false);
});
test('no key or empty model list does not trigger a request', async () => {
  const client = new Client({ fetch: async () => { throw new Error('Should not call'); } });
  await assert.rejects(client.generate('q', '', { ...options, key: '' }), /API key/);
  await assert.rejects(client.generate('q', '', { ...options, models: [] }), /No text models/);
});

const event = data => 'data: ' + JSON.stringify(data) + '\r\n\r\n';
const chunk = (text, finishReason) => ({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
function streamResponse(data) {
  const bytes = new TextEncoder().encode(data);
  return new Response(new ReadableStream({ start(controller) {
    // Deliberately split both UTF-8 characters and SSE boundaries.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
test('SSE assembles split Unicode, omits thoughts and reports cached timing without another call', async () => {
  let calls = 0, url, payload; const drafts = [], timings = [];
  const client = new Client({ fetch: async (endpoint, init) => {
    calls++; url = endpoint; payload = JSON.parse(init.body);
    return streamResponse(event({ candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' }] } }] }) + event(chunk('سلام ')) + event(chunk('world [#0]', 'STOP')));
  } });
  const config = { ...options, models: [{ id: 'gemini-3.5-flash-lite' }], maxOutputTokens: 1536, onText: text => drafts.push(text), onComplete: data => timings.push(data) };
  assert.equal(await client.generate('q', '', config), 'سلام world [#0]');
  assert.equal(await client.generate('q', '', config), 'سلام world [#0]');
  assert.equal(calls, 1); assert.match(url, /streamGenerateContent\?alt=sse$/);
  assert.equal(payload.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(payload.generationConfig.maxOutputTokens, 1536);
  assert.deepEqual(drafts.slice(0, 2), ['سلام ', 'سلام world [#0]']);
  assert.equal(timings[0].cached, false); assert.equal(timings[1].cached, true);
  assert.ok(!drafts.join('').includes('private reasoning'));
});
test('truncated, blocked and malformed streams are withheld and never cached', async () => {
  for (const data of [event(chunk('partial')), event(chunk('partial', 'MAX_TOKENS')), event(chunk('unsafe', 'SAFETY')), 'data: broken\n\n']) {
    let calls = 0;
    const client = new Client({ fetch: async () => { calls++; return streamResponse(data); } });
    await assert.rejects(client.generate('q', '', { ...options, onText() {} }));
    assert.equal(calls, 1); assert.equal(client.cache.size, 0); assert.equal(client.busy, false);
  }
});
test('cancelling a live stream cancels its reader and releases the request lock', async () => {
  let cancelled = false; const controller = new AbortController();
  const client = new Client({ fetch: async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode(event(chunk('draft')))); },
    cancel() { cancelled = true; }
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  await assert.rejects(client.generate('q', '', { ...options, signal: controller.signal, onText() { controller.abort(); } }), { name: 'AbortError' });
  assert.equal(cancelled, true); assert.equal(client.busy, false); assert.equal(client.cache.size, 0);
});
test('reasoning settings are model-specific and cache separates output modes', async () => {
  for (const [id, thinking] of [['gemini-2.5-flash', { thinkingBudget: 0 }], ['gemini-3.8-flash', { thinkingLevel: 'low' }], ['unknown-model', undefined]]) {
    const requests = [];
    const client = new Client({ fetch: async (_, init) => { requests.push(JSON.parse(init.body)); return success(); } });
    const config = { ...options, models: [{ id }] };
    await client.generate('q', '', config);
    await client.generate('q', '', { ...config, maxOutputTokens: 1536 });
    await client.generate('q', '', { ...config, fast: false });
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0].generationConfig.thinkingConfig, thinking);
    assert.equal(requests[2].generationConfig.thinkingConfig, undefined);
  }
});
