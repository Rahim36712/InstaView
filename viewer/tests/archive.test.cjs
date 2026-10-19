const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../js/archive.js');
const { ArchiveStore, fingerprint, filterMessages } = globalThis.InstaViewArchive;
const id = fingerprint('export-one');
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), data };
};
const message = (id, text, sender = 'Owner') => ({ id, text, sender, type: 'text', timestamp: new Date('2026-04-12T13:00:00Z') });

test('stars, notes and resume survive positional changes and relaunch', () => {
  const saved = storage(), archive = new ArchiveStore(saved, id, 'Export');
  archive.index('chat', [message(0, 'exam'), message(1, 'meet')]);
  archive.toggle('chat', 0); archive.annotate('chat', 0, 'Remember this', 'College'); archive.setResume('chat', 1);
  const reopened = new ArchiveStore(saved, id, 'Export');
  reopened.index('chat', [message(0, 'new'), message(1, 'exam'), message(2, 'meet')]);
  assert.deepEqual(reopened.stars('chat'), [1]);
  assert.equal(reopened.star('chat', 1).note, 'Remember this');
  assert.equal(reopened.resume('chat'), 2);
});
test('missing and ambiguous duplicate references stay saved without pointing to another message', () => {
  const archive = new ArchiveStore(storage(), id, 'Export');
  archive.index('chat', [message(0, 'same'), message(1, 'same')]); archive.toggle('chat', 1);
  archive.index('chat', [message(0, 'same')]);
  assert.deepEqual(archive.stars('chat'), []);
  assert.equal(archive.unresolved('chat'), 1);
  assert.equal(JSON.parse(archive.backup()).profile.conversations.chat.stars.length, 1);
  archive.index('chat', [message(0, 'new'), message(1, 'same'), message(2, 'same')]);
  assert.deepEqual(archive.stars('chat'), [2]);
});
test('different exports are isolated; backups merge without removing newer notes and stars', () => {
  const saved = storage(), first = new ArchiveStore(saved, id, 'Export');
  first.index('chat', [message(0, 'one'), message(1, 'two')]); first.toggle('chat', 0);
  const backup = first.backup(); first.annotate('chat', 0, 'newer note', ''); first.toggle('chat', 1);
  first.restore(backup);
  assert.deepEqual(first.stars('chat'), [0, 1]); assert.equal(first.star('chat', 0).note, 'newer note');
  const second = new ArchiveStore(saved, fingerprint('export-two'), 'Other export');
  second.index('chat', [message(0, 'one')]);
  assert.deepEqual(second.stars('chat'), []);
  assert.throws(() => second.restore(backup), /active export/);
});
test('invalid backup is rejected before changing saved data and no credentials or message text are included', () => {
  const saved = storage(), archive = new ArchiveStore(saved, id, 'Export');
  archive.index('chat', [message(0, 'private original message')]); archive.toggle('chat', 0);
  const before = archive.backup();
  const bad = JSON.parse(before); bad.profile.conversations.chat.stars[0].ordinal = -1;
  assert.throws(() => archive.restore(JSON.stringify(bad)), /valid/); assert.equal(archive.backup(), before);
  const prototype = JSON.parse(before); Object.defineProperty(prototype.profile.conversations, '__proto__', { value: { stars: [], searches: [], resume: null }, enumerable: true });
  assert.throws(() => archive.restore(JSON.stringify(prototype)), /valid/);
  assert.ok(!before.includes('private original message')); assert.ok(!before.includes('gemini-key'));
});
test('combined keyword, sender, type, star and inclusive date filters handle message ID zero', () => {
  const messages = [message(0, 'Exam tomorrow'), message(1, 'Exam tomorrow', 'Other'), { ...message(2, 'Exam photo'), type: 'photo' }];
  const search = { query: 'exam', sender: 'Owner', type: 'text', from: '2026-04-12', to: '2026-04-12' };
  assert.deepEqual(filterMessages(messages, search).map(m => m.id), [0]);
  assert.deepEqual(filterMessages(messages, { ...search, type: 'starred' }, [0]).map(m => m.id), [0]);
  assert.throws(() => filterMessages(messages, { ...search, from: '2027-01-01' }), /valid date range/);
});
test('saved searches and pins survive restart and search history stays bounded', () => {
  const saved = storage(), archive = new ArchiveStore(saved, id, 'Export');
  archive.togglePin('chat');
  for (let i = 0; i < 30; i++) archive.saveSearch('chat', { query: String(i), sender: '', type: 'all', from: '', to: '' });
  const reopened = new ArchiveStore(saved, id, 'Export');
  assert.deepEqual(reopened.profile.pins, ['chat']); assert.equal(reopened.chat('chat').searches.length, 20);
  assert.equal(reopened.chat('chat').searches[0].query, '29');
});
test('corrupted archive bytes are retained separately before fresh session saves', () => {
  const saved = storage(); saved.setItem(`instaview-archive-v1-${id}`, '{broken');
  const archive = new ArchiveStore(saved, id, 'Export');
  assert.equal(archive.invalidSavedData, true);
  archive.index('chat', [message(0, 'exam')]); archive.toggle('chat', 0);
  assert.equal(saved.getItem(`instaview-archive-v1-${id}-recovery`), '{broken');
});
