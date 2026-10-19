const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function library(routes) {
  const requested = [];
  const context = { URL, AbortSignal, location: { href: 'http://localhost:8765/viewer/' } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/export-library.js'), 'utf8'), context);
  return {
    requested,
    discover: () => context.InstaViewExportLibrary.discover({
      readLinks: value => JSON.parse(value),
      fetcher: async url => {
        requested.push(new URL(url).pathname);
        const value = routes[new URL(url).pathname];
        return { status: value?.status || (value ? 200 : 404), ok: Boolean(value) && !value.status,
          text: async () => JSON.stringify(value) };
      }
    })
  };
}
const index = '/your_instagram_activity/messages/chats.html';

test('discovers original, named backups and one wrapper, with encoded media roots', async () => {
  const instance = library({
    [index]: 'index',
    '/Instagram%20Backups/': ['../', 'October%20new/', 'older/', 'ignore.zip'],
    ['/Instagram%20Backups/October%20new' + index]: 'index',
    '/Instagram%20Backups/older/': ['instagram-export/'],
    ['/Instagram%20Backups/older/instagram-export' + index]: 'index'
  });
  const entries = await instance.discover();
  assert.deepEqual(Array.from(entries, item => item.name), ['Original export', 'October new', 'older/instagram-export']);
  assert.equal(entries[1].serverRoot, 'http://localhost:8765/Instagram%20Backups/October%20new');
  assert.equal(entries[1].id, 'backup:Instagram%20Backups/October%20new/');
  assert.ok(instance.requested.every(url => url === index || url.startsWith('/Instagram%20Backups/')));
});

test('ignores parent, external, encoded separators and deep directory links', async () => {
  const instance = library({
    [index]: 'index',
    '/Instagram%20Backups/': ['../', '/private/', 'https://example.com/export/', 'bad%2Fname/', 'bad%5Cname/', 'a/b/', '?sort=name/', 'ok/', 'ok/'],
    ['/Instagram%20Backups/ok' + index]: 'index'
  });
  assert.equal((await instance.discover()).length, 2);
  assert.equal(instance.requested.filter(url => url.includes('/ok/')).length, 1);
  assert.ok(!instance.requested.some(url => /private|bad|a\/b/.test(url)));
});

test('missing library retains original and missing original supports a library-only installation', async () => {
  assert.equal((await library({ [index]: 'index' }).discover())[0].id, 'current');
  const entries = await library({ '/Instagram%20Backups/': ['new/'], ['/Instagram%20Backups/new' + index]: 'index' }).discover();
  assert.equal(entries.length, 1);
  assert.match(entries[0].id, /^backup:/);
});

test('HTTP failures are reported rather than publishing an incomplete catalog', async () => {
  await assert.rejects(library({ [index]: 'index', '/Instagram%20Backups/': { status: 503 } }).discover(), /HTTP 503/);
});

test('directory scan is bounded to prevent following an enormous tree', async () => {
  const routes = { [index]: 'index', '/Instagram%20Backups/': Array.from({ length: 101 }, (_, i) => `${i}/`) };
  await assert.rejects(library(routes).discover(), /100 backup folders/);
});
