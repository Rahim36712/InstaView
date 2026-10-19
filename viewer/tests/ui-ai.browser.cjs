/* Development browser check. Synthetic exports and Gemini replies only;
   never reads the user's browser profile or sends real messages externally. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.INSTAVIEW_TEST_URL || 'http://localhost:8000';
const message = (text, date) => `<div class="pam _3-95 _2ph- _a6-g"><h2 class="_3-95 _2pim _a6-h _a6-i">Demo owner</h2><div class="_3-95 _a6-p"><div><div></div><div>${text}</div></div></div><div class="_3-94 _a6-o">Oct 05, 2026 ${date} am</div></div>`;
const candidate = (text, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem('instaview-gemini-key', 'synthetic-test-key');
      localStorage.setItem('instaview-focus-mode', 'true');
      localStorage.setItem('instaview-toolbars-collapsed', 'false');
      localStorage.setItem('instaview-theme', 'dark');
      localStorage.setItem('instaview-wallpaper', 'glass');
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], requests = []; let mode = 'answer', finish = 'STOP', releaseWrapped;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'generativelanguage.googleapis.com') {
        requests.push(JSON.parse(route.request().postData()));
        if (mode === 'wrapped') {
          await new Promise(resolve => { releaseWrapped = resolve; });
          return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        }
        if (mode === 'quota') return route.fulfill({ status: 429, contentType: 'application/json', body: '{}' });
        const text = mode === 'timeline' ? JSON.stringify([{ date: 'October 2026', title: 'Exam', desc: 'Exam discussed', keyMsgId: 0 }]) :
          mode === 'bad-citation' ? 'Invented answer [#999]' : 'The exam is tomorrow [#0]';
        return route.fulfill({ contentType: url.searchParams.get('alt') === 'sse' ? 'text/event-stream' : 'application/json',
          body: url.searchParams.get('alt') === 'sse' ? 'data: ' + JSON.stringify(candidate(text, finish)) + '\n\n' : JSON.stringify(candidate(text, finish)) });
      }
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith('/viewer/')) return route.continue();
      if (url.pathname === '/your_instagram_activity/messages/chats.html') return route.fulfill({ contentType: 'text/html',
        body: '<div class="pam _3-95 _2ph- _a6-g"><h2><a href="your_instagram_activity/messages/inbox/demo/message_1.html">Demo contact</a></h2></div>' });
      if (url.pathname.endsWith('/demo/message_1.html')) return route.fulfill({ contentType: 'text/html', body: message('Good luck', '10:01') + message('Exam tomorrow', '10:00') });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(base + '/viewer/');
    await page.locator('.conversation-item').first().click();
    await page.locator('.message-wrapper').first().waitFor();
    const pressed = id => page.locator('#' + id).getAttribute('aria-pressed');
    assert.equal(await pressed('focus-mode-btn'), 'true');
    assert.equal(await pressed('toggle-extra-bars-btn'), 'false');
    await page.locator('#toggle-extra-bars-btn').click();
    assert.equal(await pressed('focus-mode-btn'), 'false');
    assert.equal(await pressed('toggle-extra-bars-btn'), 'true');
    await page.locator('#chat-search-btn').click();
    assert.equal(await pressed('chat-search-btn'), 'true');
    await page.locator('#chat-search-close').click();
    assert.equal(await pressed('chat-search-btn'), 'false');
    await page.locator('#ai-drawer-btn').click();
    assert.equal(await pressed('ai-drawer-btn'), 'true');
    await page.getByRole('tab', { name: 'Ask & Search' }).press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Range Summary' }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Ask & Search' }).click();
    await page.locator('#ai-chat-input').fill('exam');
    await page.locator('#ai-find-local-btn').click();
    await page.getByText('Found these excerpts on your device.', { exact: false }).waitFor();
    assert.equal(requests.length, 0);
    await page.locator('.ai-generate-evidence').click();
    await page.locator('#ai-chat-thread .ai-citation-chip').waitFor();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.equal(requests[0].generationConfig.maxOutputTokens, 1536);
    await page.locator('#ai-chat-input').fill('exam');
    await page.locator('#ai-chat-send').click();
    await page.getByText('Reused answer · no Google request').waitFor();
    assert.equal(requests.length, 1);
    mode = 'bad-citation';
    await page.locator('#ai-chat-input').fill('what exam?'); await page.locator('#ai-chat-send').click();
    await page.getByText('The answer had missing or unsupported message references', { exact: false }).waitFor();
    mode = 'answer'; finish = 'MAX_TOKENS';
    await page.locator('#ai-chat-input').fill('more about exam'); await page.locator('#ai-chat-send').click();
    await page.getByText('The answer exceeded its output limit', { exact: false }).waitFor();
    finish = 'STOP'; mode = 'answer';
    await page.getByRole('tab', { name: 'Range Summary' }).click();
    await page.locator('#ai-range-from').fill('2026-10-05T10:00'); await page.locator('#ai-range-from').press('Tab');
    await page.locator('#ai-range-to').fill('2026-10-05T10:01'); await page.locator('#ai-range-to').press('Tab');
    await page.locator('#ai-run-range-btn').click();
    await page.locator('#ai-range-results-body .ai-citation-chip[data-msg-id="0"]').waitFor();
    mode = 'timeline';
    await page.getByRole('tab', { name: 'Milestones' }).click();
    await page.locator('#ai-gen-timeline-btn').click();
    await page.locator('#ai-timeline-results .ai-citation-chip[data-msg-id="0"]').waitFor();
    // Local Wrapped slides must be visible while the provider request is pending.
    await page.locator('#ai-drawer-close').click(); mode = 'wrapped';
    await page.locator('#chat-more-menu > summary').click(); await page.locator('#wrapped-btn').click();
    await page.getByText('Your Chat in Numbers', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('#wrapped-slides-viewport').textContent.includes('2 messages'));
    assert.ok(releaseWrapped); releaseWrapped();
    // Cancel retries after the failed first response; local slides were already usable.
    await page.locator('#wrapped-close').click();
    await page.locator('#ai-drawer-btn').click(); await page.locator('#ai-cancel-btn').click();
    await page.locator('#ai-cancel-btn').waitFor({ state: 'hidden' });
    mode = 'quota';
    await page.getByRole('tab', { name: 'Ask & Search' }).click();
    await page.locator('#ai-chat-input').fill('a different exam question'); await page.locator('#ai-chat-send').click();
    await page.getByText('Google quota exceeded.', { exact: false }).waitFor();
    const before = requests.length;
    await page.locator('#ai-chat-input').fill('exam'); await page.locator('#ai-find-local-btn').click();
    await page.locator('#ai-chat-thread .ai-msg-bot').last().getByText('Found these excerpts', { exact: false }).waitFor();
    assert.equal(requests.length, before);
    assert.equal(await page.locator('#ai-retry-btn').isDisabled(), true);
    await page.locator('#ai-drawer-close').click();
    await page.screenshot({ path: 'viewer/verification/clear-controls-desktop.png' });
    await page.setViewportSize({ width: 390, height: 780 });
    for (const id of ['chat-search-btn', 'ai-drawer-btn', 'focus-mode-btn', 'toggle-extra-bars-btn', 'chat-info-btn']) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, id + ' fits phone');
    }
    await page.locator('#ai-drawer-btn').click();
    const drawer = await page.locator('#ai-drawer').boundingBox();
    assert.ok(drawer.x >= 0 && drawer.x + drawer.width <= 390);
    assert.ok(await page.locator('#ai-chat-input').isVisible());
    await page.screenshot({ path: 'viewer/verification/clear-controls-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('UI/AI browser check passed: active labels, keyboard tabs, local retrieval, streamed answers, cache, invalid citations, truncated output, range summary, timeline, immediate Wrapped, quota recovery and 390px layout.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
