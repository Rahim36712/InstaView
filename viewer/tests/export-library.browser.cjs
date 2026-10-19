/* Optional browser check: requires a development Playwright installation.
   Serve the export root; set INSTAVIEW_TEST_URL and PLAYWRIGHT_MODULE if needed.
   All export responses are synthetic and storage belongs to a fresh context. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.INSTAVIEW_TEST_URL || 'http://localhost:8000';
const indexPath = '/your_instagram_activity/messages/chats.html';
const backupRoot = '/Instagram%20Backups/';
const index = '<div class="pam _3-95 _2ph- _a6-g"><h2><a href="your_instagram_activity/messages/inbox/demo/message_1.html">Demo contact</a></h2></div>';
const message = (text, media = '') => `<div class="pam _3-95 _2ph- _a6-g"><h2 class="_3-95 _2pim _a6-h _a6-i">Demo owner</h2><div class="_3-95 _a6-p"><div><div></div><div>${text}</div></div>${media}</div><div class="_3-94 _a6-o">Oct 05, 2026 10:00 am</div></div>`;
const directory = names => names.map(name => `<a href="${name}/">${name}</a>`).join('');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const requested = [];
    let added = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      const path = url.pathname;
      requested.push(path);
      if (path.startsWith('/viewer/')) return route.continue();
      const respond = body => route.fulfill({ status: 200, contentType: 'text/html', body });
      if (path === backupRoot) return respond(directory(added ? ['Older', 'Newer', 'Broken', 'Added'] : ['Older', 'Newer', 'Broken']));
      if (path === indexPath || ['Older', 'Newer', 'Broken', ...(added ? ['Added'] : [])].some(name => path === backupRoot + name + indexPath)) return respond(index); // equal indexes deliberately
      if (path.endsWith('/demo/message_1.html')) {
        const label = path.startsWith(backupRoot) ? path.split('/')[2] : 'Original';
        if (label === 'Broken') return route.fulfill({ status: 503, body: 'Unavailable' });
        const newer = label === 'Newer' ? message('Newest message') : '';
        return respond(newer + message(label + ' text') + message('You sent an attachment.', '<img src="files/photo.svg">') + message('Voice note', '<audio src="files/audio.wav"></audio>'));
      }
      if (path.endsWith('/files/photo.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#5C8FD6"/></svg>' });
      if (path.endsWith('/files/audio.wav')) {
        // Valid tiny silent PCM WAV; playback stays local.
        const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
        wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
        return route.fulfill({ contentType: 'audio/wav', body: wav });
      }
      return route.fulfill({ status: 404, body: 'Not found' });
    });
    const buttons = () => page.locator('#sidebar-backup-list');
    const choose = name => buttons().getByRole('button', { name, exact: true }).click();
    const label = () => page.locator('#active-export-label');
    const waitText = text => page.waitForFunction(value => document.getElementById('messages-container').textContent.includes(value), text);
    await page.goto(base + '/viewer/');
    await page.locator('.conversation-item').first().waitFor();
    assert.equal(await buttons().getByRole('button').count(), 4);
    await page.locator('.conversation-item').first().click();
    await waitText('Original text');
    await page.locator('.message-star-btn').first().click({ force: true });
    await choose('Older');
    await waitText('Older text'); // same contact opened with the single backup click
    assert.equal(await page.locator('.message-star-btn[title="Unstar message"]').count(), 0);
    await choose('Original export');
    await waitText('Original text');
    assert.equal(await page.locator('.message-star-btn[title="Unstar message"]').count(), 1);
    await choose('Newer');
    await waitText('Newest message');
    assert.ok((await label().textContent()).startsWith('Newer'));
    assert.ok((await page.locator('#messages-container img').first().getAttribute('src')).includes('/Instagram%20Backups/Newer/files/photo.svg'));
    assert.ok((await page.locator('#messages-container audio').first().getAttribute('src')).includes('/Instagram%20Backups/Newer/files/audio.wav'));
    await page.reload();
    await buttons().getByRole('button', { name: 'Newer', exact: true }).waitFor();
    await page.waitForFunction(() => document.getElementById('active-export-label').textContent.startsWith('Newer'));
    await page.locator('.conversation-item').first().click();
    await waitText('Newest message');
    added = true;
    await page.locator('#sidebar-backups .backup-refresh').click();
    await buttons().getByRole('button', { name: 'Added', exact: true }).waitFor();
    await choose('Added');
    await waitText('Added text');
    // The broken backup has an index but no readable conversation parts.
    await choose('Broken');
    await page.locator('#sidebar-backups .backup-status').filter({ hasText: 'Could not read' }).waitFor();
    assert.ok((await label().textContent()).startsWith('Added'));
    await waitText('Added text');
    await choose('Older');
    await waitText('Older text');
    await page.setViewportSize({ width: 390, height: 780 });
    await page.locator('#back-btn').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.equal(errors.length, 0, errors.join('\n'));
    if (process.env.INSTAVIEW_TEST_SCREENSHOT) {
      await page.locator('.toast').waitFor({ state: 'detached' });
      await page.screenshot({ path: process.env.INSTAVIEW_TEST_SCREENSHOT });
    }
    assert.ok(requested.some(path => path.includes('/Newer/files/photo.svg')));
    console.log('Browser checks passed: discovery, one-click switching, stars, media paths, reload, Refresh, failed chat, mobile layout.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
