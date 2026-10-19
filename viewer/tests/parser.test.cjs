const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/parser.js'), 'utf8');

test('a failing later part raises an error instead of silently returning a partial chat', async () => {
  let count = 0;
  const context = { console, fetch: async () => {
    count++;
    return { ok: count < 3, status: count < 3 ? 200 : 503, text: async () => '<html></html>' };
  } };
  context.window = context;
  vm.runInNewContext(source, context);
  const parser = new context.Parser();
  await parser.loadFromServer('');
  await assert.rejects(parser.getMessages('demo'), /part 2 returned HTTP 503/);
});
test('a failing first part is not misreported as an empty conversation', async () => {
  const context = { console, fetch: async () => ({ ok: false, status: 500 }) };
  context.window = context;
  vm.runInNewContext(source, context);
  const parser = new context.Parser();
  await parser.loadFromServer('');
  await assert.rejects(parser.getMessages('demo'), /HTTP 500/);
});
