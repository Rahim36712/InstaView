const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cache() {
  let saved, fail = false;
  const db = {
    createObjectStore() {}, close() {},
    transaction() {
      const transaction = {};
      transaction.objectStore = () => ({
        get() { return complete(() => saved); },
        put(value) { return complete(() => { saved = structuredClone(value); }); },
        delete() { return complete(() => { saved = undefined; }); }
      });
      function complete(operation) {
        const request = {};
        queueMicrotask(() => {
          if (fail) { transaction.onabort(); return; }
          request.result = operation(); transaction.oncomplete();
        });
        return request;
      }
      return transaction;
    }
  };
  const context = { File, Blob, navigator: { storage: { estimate: async () => ({ quota: 1e9, usage: 0 }) } }, indexedDB: { open() {
    const request = {};
    queueMicrotask(() => { request.result = db; request.onupgradeneeded(); request.onsuccess(); });
    return request;
  } } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/export-cache.js'), 'utf8'), context);
  return { api: context.InstaViewExportCache, setFailure(value) { fail = value; } };
}
test('picked files retain normalized paths and bytes after save and restore', async () => {
  const { api } = cache();
  assert.equal(await api.restore(), null);
  const original = new File(['hello'], 'message_1.html', { type: 'text/html' });
  await api.save(new Map([['your_instagram_activity/messages/inbox/demo/message_1.html', original]]));
  const restored = await api.restore();
  assert.equal(restored.length, 1);
  assert.equal(await restored[0].text(), 'hello');
  assert.equal(restored[0].webkitRelativePath, 'remembered-export/your_instagram_activity/messages/inbox/demo/message_1.html');
  assert.equal(await original.text(), 'hello');
});
test('oversized folders are refused without replacing the previous browser copy', async () => {
  const { api } = cache();
  await api.save(new Map([['old.html', new File(['original'], 'old.html')]]));
  await assert.rejects(api.save(new Map([['large', { size: 257 * 1024 * 1024 }]])), /256 MB/);
  assert.equal(await (await api.restore())[0].text(), 'original');
});
test('aborted writes preserve the old snapshot and forgetting only removes the browser copy', async () => {
  const instance = cache();
  const original = new File(['original'], 'old.html');
  await instance.api.save(new Map([['old.html', original]]));
  instance.setFailure(true);
  await assert.rejects(instance.api.save(new Map([['new.html', new File(['new'], 'new.html')]])), /original folder is unchanged/i);
  instance.setFailure(false);
  assert.equal(await (await instance.api.restore())[0].text(), 'original');
  await instance.api.clear();
  assert.equal(await instance.api.restore(), null);
  assert.equal(await original.text(), 'original');
});
