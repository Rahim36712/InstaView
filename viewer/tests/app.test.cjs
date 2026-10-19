const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../js/rag.js');

function app(saved = {}) {
  const elements = new Map(), values = new Map(Object.entries(saved));
  const element = () => {
    let text = '', html = '';
    return {
      value: '', disabled: false, dataset: {}, children: [], className: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: { setProperty() {} }, addEventListener() {}, setAttribute() {},
      removeAttribute() {}, replaceChildren() { this.children = []; html = ''; },
      remove() {},
      getBoundingClientRect() { return { top: 0 }; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
      get textContent() { return text; }, set textContent(value) { text = String(value); html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      get innerHTML() { return html; }, set innerHTML(value) { html = value; }
    };
  };
  const document = {
    readyState: 'loading', addEventListener() {}, createElement: element,
    body: element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({ document, Date, Map, Set, WeakMap, DOMException, AbortController, URL, console,
    setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), performance, location: { protocol: 'file:' },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    innerWidth: 1400, addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; }
  });
  context.window = context;
  for (const name of ['rag.js', 'ai-client.js', 'archive.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context);
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8').replace(/\}\)\(\);\s*$/, `
    window.testApp = { state, dom, geminiClient, calculateLocalChatStats, serializeMessagesForAI, selectedRangeMessages,
      onDatePickersChanged, syncAiRangeInputs, renderAiMarkdown, validateAiAnswer, resetAiForNewChat,
      beginAiTask, endAiTask, taskIsCurrent, submitAiChat, updateAiRecovery, retryAiEvidence,
      runRangeSummary, generateTimeline, openChatWrapped, streamedAnswerOptions,
      loadExport, initializeArchive, preloadConversationPreviews, checkServerMode };
  })();`);
  vm.runInContext(source, context);
  return { ...context.testApp, context };
}

function exportParser(instance, name, conversations = [{ id: 'demo', name: 'Contact' }]) {
  instance.context.Parser = class {
    archiveIdentityText = 'identical index';
    async getConversationList() { return conversations.map(item => ({ ...item })); }
    async getMessages() { return [{ id: 0, sender: name, text: 'hello', timestamp: new Date('2026-01-01') }]; }
    getOwnerName() { return name; }
  };
}

test('switching exports isolates equal indexes, clears old messages and cancels AI; original profile is retained', async () => {
  const instance = app();
  exportParser(instance, 'First owner');
  const original = { id: 'current', name: 'Original export' };
  assert.equal(await instance.loadExport(async () => {}, original), true);
  const originalId = instance.state.archive.profile.id;
  assert.equal(originalId, instance.context.InstaViewArchive.fingerprint('identical index'));
  instance.state.archive.index('demo', [{ id: 0, sender: 'First owner', text: 'hello', timestamp: new Date('2026-01-01') }]);
  instance.state.archive.toggle('demo', 0);
  const task = instance.beginAiTask();
  instance.state.currentConversation = { id: 'demo' };
  instance.state.currentMessages = [{ id: 0 }];
  instance.state.rangeStartMsg = 0;
  exportParser(instance, 'Second owner');
  assert.equal(await instance.loadExport(async () => {}, { id: 'backup:new/', name: 'New backup' }), true);
  assert.equal(instance.state.ownerName, 'Second owner');
  assert.equal(instance.state.currentConversation, null);
  assert.equal(instance.state.currentMessages.length, 0);
  assert.equal(instance.state.rangeStartMsg, null);
  assert.equal(task.controller.signal.aborted, true);
  assert.notEqual(instance.state.archive.profile.id, originalId);
  assert.equal(instance.state.archive.chat('demo').stars.length, 0);
  assert.equal(await instance.loadExport(async () => {}, original), true);
  assert.equal(instance.state.archive.profile.id, originalId);
  assert.equal(instance.state.archive.chat('demo').stars.length, 1);
});

test('failed and superseded export loads preserve the successful selection', async () => {
  const instance = app();
  exportParser(instance, 'Owner');
  const original = { id: 'current', name: 'Original export' };
  assert.equal(await instance.loadExport(async () => {}, original), true);
  const parser = instance.state.parser;
  exportParser(instance, 'Owner', []);
  // Avoid the toast timer in this isolated load test.
  instance.context.document.body.appendChild = () => {};
  assert.equal(await instance.loadExport(async () => {}, { id: 'backup:broken/', name: 'Broken' }), false);
  assert.equal(instance.state.parser, parser);
  assert.equal(instance.state.activeExport, original);
  assert.equal(instance.context.localStorage.getItem('instaview-active-export'), 'current');
  exportParser(instance, 'Latest owner');
  let resume;
  const waiting = instance.loadExport(() => new Promise(resolve => { resume = resolve; }), { id: 'backup:slow/', name: 'Slow' });
  assert.equal(await instance.loadExport(async () => {}, { id: 'backup:latest/', name: 'Latest' }), true);
  resume();
  assert.equal(await waiting, false);
  assert.equal(instance.state.activeExport.id, 'backup:latest/');
  assert.equal(instance.context.localStorage.getItem('instaview-active-export'), 'backup:latest/');
});

test('corrupt or wrong-shaped saved preferences do not prevent app startup', () => {
  for (const value of ['invalid json', 'null', '42', '[]']) {
    const instance = app({ 'instaview-bookmarks': value, 'instaview-discovered-models': value });
    assert.equal(Object.keys(instance.state.bookmarks).length, 0);
    assert.equal(instance.state.availableGeminiModels.length, 0);
  }
});
test('range ID zero works and date pickers compare milliseconds', () => {
  const instance = app();
  instance.state.currentMessages = [0, 1, 2].map(id => ({ id, sender: 'Owner', timestamp: new Date(`2026-04-12T13:0${id}:00`) }));
  instance.state.rangeStartMsg = 0; instance.state.rangeEndMsg = 1;
  assert.deepEqual(Array.from(instance.selectedRangeMessages(), m => m.id), [0, 1]);
  instance.syncAiRangeInputs();
  assert.equal(instance.dom.aiRangeFrom.value, '2026-04-12T13:00');
  instance.dom.aiRangeFrom.value = '2026-04-12T13:00';
  instance.dom.aiRangeTo.value = '2026-04-12T13:01';
  instance.onDatePickersChanged();
  assert.equal(instance.state.rangeStartMsg, 0);
  assert.equal(instance.state.rangeEndMsg, 1);
  instance.dom.aiRangeFrom.value = '2027-04-12T13:00';
  instance.dom.aiRangeTo.value = '2027-04-12T13:01';
  instance.onDatePickersChanged();
  assert.equal(instance.state.rangeStartMsg, null);
});
test('Wrapped reply delays use seconds and missing emojis stay empty', () => {
  const instance = app();
  const stats = instance.calculateLocalChatStats([
    { id: 0, sender: 'Owner', isOwner: true, timestamp: new Date('2026-04-12T13:00:00Z'), text: 'hi' },
    { id: 1, sender: 'Contact', timestamp: new Date('2026-04-12T13:00:30Z'), text: 'hello' }
  ]);
  assert.equal(stats.otherAvgDelay, '30s');
  assert.equal(stats.topEmojis.length, 0);
  assert.doesNotMatch(instance.serializeMessagesForAI([{ id: 0, sender: 'Owner', timestamp: new Date('2026-04-12T13:00:00Z'), text: 'hello' }]), /\+0/);
});
test('citations are restricted to supplied IDs and AI HTML is escaped', () => {
  const instance = app();
  const allowed = new Set([0]);
  const html = instance.renderAiMarkdown('<img src=x onerror=alert(1)> [#0] [#99]', allowed);
  assert.ok(!html.includes('<img'));
  assert.match(html, /data-msg-id="0"/);
  assert.ok(!html.includes('data-msg-id="99"'));
  assert.equal(instance.validateAiAnswer('It happened [#99]', allowed), false);
  assert.equal(instance.validateAiAnswer('It happened', allowed), false);
  assert.equal(instance.validateAiAnswer('Insufficient evidence to determine that.', allowed), true);
});
test('changing conversations invalidates task results and clears the old range', () => {
  const instance = app();
  const task = instance.beginAiTask();
  assert.equal(instance.taskIsCurrent(task), true);
  instance.state.conversationEpoch++;
  assert.equal(instance.taskIsCurrent(task), false);
  instance.state.rangeStartMsg = 0; instance.state.rangeEndMsg = 12;
  instance.resetAiForNewChat();
  assert.equal(instance.state.rangeStartMsg, null);
  instance.endAiTask(task);
  assert.equal(instance.state.aiTask, null);
});
test('a long Urdu question still produces a bounded Gemini payload with matching source IDs', async () => {
  const instance = app();
  instance.state.geminiApiKey = 'test-key';
  instance.state.aiScope = 'recent';
  instance.state.currentMessages = Array.from({ length: 1000 }, (_, id) => ({ id, text: 'امتحان کی بات ہوئی تھی', sender: 'Owner', timestamp: new Date('2026-04-12T13:00:00Z') }));
  let tokens;
  instance.geminiClient.fetch = async (_, init) => {
    const payload = JSON.parse(init.body);
    tokens = globalThis.InstaViewRAG.estimateTokens(payload.contents[0].parts[0].text + payload.systemInstruction.parts[0].text);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Evidence [#0]' }] } }] }) };
  };
  await instance.submitAiChat('امتحان '.repeat(70));
  assert.ok(tokens <= 1200, `${tokens} estimated input tokens`);
  assert.ok(instance.state.aiContext.messageIds.includes(0));
  assert.equal(instance.state.aiTask, null);
});

test('Find messages retrieves evidence without calling Google even with a configured key', async () => {
  const instance = app(); let calls = 0;
  instance.state.geminiApiKey = 'test-key'; instance.state.aiScope = 'recent';
  instance.state.currentMessages = [ { id: 0, text: 'exam', sender: 'Owner', timestamp: new Date('2026-04-12T13:00:00Z') } ];
  instance.geminiClient.fetch = async () => { calls++; throw new Error('Should not call Google'); };
  await instance.submitAiChat('exam', true);
  assert.equal(calls, 0); assert.ok(instance.state.aiContext.messageIds.includes(0));
  assert.ok(instance.state.pendingAiRetry); assert.equal(instance.state.aiTask, null);
});
test('manual generation reuses prepared evidence and refuses evidence from an old chat', async () => {
  const instance = app(); let calls = 0;
  instance.state.geminiApiKey = 'test-key'; instance.state.aiScope = 'recent';
  instance.state.currentMessages = [ { id: 0, text: 'exam', sender: 'Owner', timestamp: new Date('2026-04-12T13:00:00Z') } ];
  instance.geminiClient.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Evidence [#0]' }] } }] }) }; };
  await instance.submitAiChat('exam', true);
  const prepared = instance.state.pendingAiRetry;
  await instance.retryAiEvidence();
  assert.equal(calls, 1); assert.equal(instance.state.pendingAiRetry, null);
  instance.state.conversationEpoch++;
  instance.state.pendingAiRetry = prepared;
  await instance.retryAiEvidence(); assert.equal(calls, 1);
});

function prepareAi(instance) {
  instance.state.geminiApiKey = 'test-key';
  instance.state.currentConversation = { id: 'demo', name: 'Contact' };
  instance.state.ownerName = 'Owner';
  instance.state.currentMessages = [
    { id: 0, text: 'exam tomorrow', sender: 'Owner', isOwner: true, timestamp: new Date('2026-04-12T13:00:00Z') },
    { id: 1, text: 'good luck', sender: 'Contact', timestamp: new Date('2026-04-12T13:01:00Z') }
  ];
  instance.state.rangeStartMsg = 0; instance.state.rangeEndMsg = 1;
}
function aiResponse(text) { return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) }; }
test('range summary validates citations and timeline accepts source zero while dropping invented IDs', async () => {
  const instance = app(); prepareAi(instance);
  instance.geminiClient.fetch = async () => aiResponse('Tomorrow is the exam [#0]');
  await instance.runRangeSummary();
  assert.match(instance.dom.aiRangeResultsBody.innerHTML, /data-msg-id="0"/);
  instance.geminiClient.fetch = async () => aiResponse(JSON.stringify([
    { date: 'April 2026', title: 'Exam', desc: '<script>unsafe</script>', keyMsgId: 0 },
    { date: 'April 2026', title: 'Invented', desc: 'unsupported', keyMsgId: 99 }
  ]));
  await instance.generateTimeline();
  assert.match(instance.dom.aiTimelineResults.innerHTML, /data-msg-id="0"/);
  assert.doesNotMatch(instance.dom.aiTimelineResults.innerHTML, /Invented|<script>/);
  instance.geminiClient.clearCache();
  instance.geminiClient.fetch = async () => aiResponse('Invented claim [#99]');
  await instance.runRangeSummary();
  assert.match(instance.dom.aiRangeResultsBody.innerHTML, /withheld/);
  assert.equal(instance.state.aiTask, null);
});
test('Wrapped publishes exact local metrics before Google responds and preserves them on failure', async () => {
  const instance = app(); prepareAi(instance); let reply;
  instance.geminiClient.fetch = async () => new Promise(resolve => { reply = resolve; });
  const pending = instance.openChatWrapped();
  assert.equal(instance.state.wrappedData.localStats.total, 2);
  assert.match(instance.dom.wrappedSlidesViewport.innerHTML, /Your Chat in Numbers/);
  reply(aiResponse('invalid JSON'));
  await pending;
  assert.equal(instance.state.wrappedData.localStats.total, 2);
  assert.match(instance.state.wrappedData.aiInsights.trajectory, /unavailable/);
  assert.equal(instance.state.aiTask, null);
});
test('live drafts escape HTML, have no citation actions, and ignore cancelled tasks', () => {
  const instance = app(); prepareAi(instance);
  const task = instance.beginAiTask(), target = instance.context.document.createElement('div');
  const callbacks = instance.streamedAnswerOptions(task, target);
  callbacks.onText('<img src=x onerror=alert(1)> [#0]');
  assert.match(target.innerHTML, /Live draft/);
  assert.doesNotMatch(target.innerHTML, /<img|data-msg-id/);
  const draft = target.innerHTML; task.controller.abort(); callbacks.onText('stale');
  assert.equal(target.innerHTML, draft);
  instance.endAiTask(task);
});

test('cancelling Wrapped retains its already available local slides', async () => {
  const instance = app(); prepareAi(instance);
  instance.geminiClient.fetch = async (_, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))));
  const pending = instance.openChatWrapped();
  instance.state.aiTask.controller.abort(); await pending;
  assert.equal(instance.state.wrappedData.localStats.total, 2);
  assert.match(instance.dom.wrappedSlidesViewport.innerHTML, /Your Chat in Numbers/);
  assert.equal(instance.state.aiTask, null);
});
