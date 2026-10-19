const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../js/rag.js');
const api = globalThis.InstaViewRAG;
const message = (id, text = 'ordinary conversation', minute = id) => ({ id, text, sender: id % 2 ? 'Contact' : 'Owner', timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)) });

test('Date objects, seconds and milliseconds serialize to the same UTC date', () => {
  const date = new Date('2026-04-12T13:30:00Z');
  assert.equal(api.timestampMs(date), date.getTime());
  assert.equal(api.timestampMs(date.getTime() / 1000), date.getTime());
  assert.equal(api.timestampMs(date.getTime()), date.getTime());
  assert.match(api.formatMessage(message(0)), /\[#0 2026-01-01/);
  assert.equal(api.timestampMs(new Date('invalid')), null);
});
test('micro-dialogues overlap within sessions, but not across a twenty-minute gap', () => {
  const messages = Array.from({ length: 10 }, (_, i) => message(i));
  messages.push(message(10, 'new session', 60));
  const chunks = api.ConversationalChunker.chunk(messages);
  assert.deepEqual(chunks[0].messages.map(m => m.id), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(chunks[1].messages.map(m => m.id), [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(chunks[2].messages.map(m => m.id), [10]);
  assert.ok(chunks[0].participants instanceof Set);
  assert.match(chunks[0].dateRange, /UTC/);
});
test('explicit zero overlap and empty index are supported', () => {
  const chunks = api.ConversationalChunker.chunk(Array.from({ length: 12 }, (_, i) => message(i)), { overlap: 0 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].startMsgId, 6);
  assert.deepEqual(api.ConversationalChunker.chunk([]), []);
});
test('BM25 retrieves rare terms, Urdu, Roman Urdu, dates and exact IDs', () => {
  const messages = Array.from({ length: 30 }, (_, i) => message(i));
  messages[0].text = 'exam tomorrow امتحان imtihan';
  messages[15].text = 'safar next week';
  const index = new api.BM25Index();
  index.buildIndex(api.ConversationalChunker.chunk(messages));
  assert.equal(index.search('امتحان')[0].chunk.startMsgId, 0);
  assert.equal(index.search('exams')[0].chunk.startMsgId, 0);
  assert.ok(index.search('travel')[0].chunk.messages.some(m => m.id === 15));
  assert.ok(index.search('#0')[0].chunk.messages.some(m => m.id === 0));
  assert.ok(index.search('2026-01-01').length);
  assert.equal(index.search('zyxmissingword').length, 0);
});
test('packed contexts deduplicate overlap and respect a multilingual budget', () => {
  const messages = Array.from({ length: 30 }, (_, i) => message(i, 'امتحان '.repeat(80)));
  const result = api.packChunks(api.ConversationalChunker.chunk(messages), 200);
  assert.ok(result.estimatedTokens <= 200, `${result.estimatedTokens} tokens`);
  assert.equal(new Set(result.messageIds).size, result.messageIds.length);
  assert.ok(result.context.includes('[excerpt truncated]'));
  assert.ok(result.messageIds.length);
});
test('oversized pasted text is bounded rather than becoming a giant API prompt', () => {
  const result = api.sampleContext([message(0, 'word '.repeat(100000))], 300);
  assert.ok(result.estimatedTokens <= 300);
  assert.deepEqual(result.messageIds, [0]);
});
test('restricted packing cannot leak neighboring messages outside scope', () => {
  const result = api.packChunks(api.ConversationalChunker.chunk(Array.from({ length: 10 }, (_, i) => message(i))), 850, { startMsgId: 0, endMsgId: 2 });
  assert.deepEqual(result.messageIds, [0, 1, 2]);
});
test('uniform samples retain early and late messages when they fit', () => {
  const messages = Array.from({ length: 100 }, (_, i) => message(i, 'hi'));
  const result = api.sampleContext(messages, 3000);
  assert.ok(result.messageIds.includes(0));
  assert.ok(result.messageIds.includes(99));
  assert.equal(result.sampled, true);
});
test('an abandoned cooperative build cannot replace the new conversation index', async () => {
  const older = api.buildIndex(Array.from({ length: 23053 }, (_, i) => message(i)));
  const newer = api.buildIndex([message(0, 'newunique topic')]);
  await assert.rejects(older, { name: 'AbortError' });
  await newer;
  const result = await api.retrieve('newunique');
  assert.match(result.context, /newunique/);
  assert.equal((await api.retrieve('ordinary')).chunks.length, 0);
});
