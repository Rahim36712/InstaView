/** Read-only discovery of extracted HTML exports beside the launcher. */
(function (root) {
  'use strict';
  const INDEX = 'your_instagram_activity/messages/chats.html';
  const FOLDER = 'Instagram Backups/';

  function directoryLinks(html) {
    return [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href]')]
      .map(anchor => anchor.getAttribute('href'));
  }

  async function discover(options = {}) {
    const base = new URL(options.base || '../', root.location.href);
    const fetcher = options.fetcher || root.fetch.bind(root);
    const readLinks = options.readLinks || directoryLinks;
    const library = new URL(FOLDER, base);
    const exports = [];
    let scanned = 0;
    async function read(url) {
      const response = await fetcher(url.href, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Cannot read backup folders (HTTP ${response.status}). Try Refresh.`);
      return response;
    }
    async function probe(url, name, id) {
      if (!await read(new URL(INDEX, url))) return false;
      exports.push({ id, name, serverRoot: url.href.replace(/\/$/, '') });
      return true;
    }
    await probe(base, 'Original export', 'current');
    async function scan(url, depth) {
      if (++scanned > 100) throw new Error('More than 100 backup folders found. Keep each extracted export directly inside Instagram Backups.');
      const relative = decodeURIComponent(url.pathname.slice(library.pathname.length)).replace(/\/$/, '');
      if (await probe(url, relative || 'Instagram Backups', `backup:${url.pathname.slice(base.pathname.length)}`)) return;
      if (depth === 0) return;
      const response = await read(url);
      if (!response) return;
      const children = new Set();
      for (const href of readLinks(await response.text())) {
        if (typeof href !== 'string' || !href.endsWith('/')) continue;
        const child = new URL(href, url);
        // Only direct children of this directory; ignore parent/external links.
        if (child.origin !== library.origin || child.search || child.hash || !child.pathname.startsWith(url.pathname)) continue;
        const suffix = child.pathname.slice(url.pathname.length);
        if (!suffix || suffix.slice(0, -1).includes('/') || /%2f|%5c/i.test(suffix)) continue;
        children.add(child.href);
      }
      for (const child of [...children].sort()) await scan(new URL(child), depth - 1);
    }
    // Supports Instagram Backups/<label>/<optional Instagram wrapper>/.
    await scan(library, 2);
    return exports;
  }
  root.InstaViewExportLibrary = { discover };
})(window);
