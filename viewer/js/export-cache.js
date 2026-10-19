/** Optional remembered folder snapshot. The original export is never changed. */
(function (root) {
  'use strict';
  function open() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('Folder persistence is unavailable in this browser.'));
      const request = indexedDB.open('instaview-export-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('exports');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not open the remembered folder.'));
      request.onblocked = () => reject(new Error('Close other InstaView tabs before updating the remembered folder.'));
    });
  }
  async function transact(mode, operation) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('exports', mode);
        const request = operation(transaction.objectStore('exports'));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = transaction.onabort = () => reject(new Error('Browser storage could not complete this operation. Your original folder is unchanged.'));
      });
    } finally { db.close(); }
  }
  root.InstaViewExportCache = {
    async save(fileMap) {
      const files = [...fileMap].map(([path, file]) => ({ path, file }));
      const size = files.reduce((total, record) => total + record.file.size, 0);
      // An 8 GB laptop should not copy multi-gigabyte media archives accidentally.
      if (size > 256 * 1024 * 1024) throw new Error('Folder exceeds the 256 MB browser-cache limit. Use the native launcher to reopen it automatically.');
      const capacity = await navigator.storage?.estimate?.();
      if (capacity?.quota && size > (capacity.quota - capacity.usage) * 0.8) throw new Error('Not enough browser storage to remember this folder.');
      await transact('readwrite', store => store.put({ version: 1, files, savedAt: Date.now() }, 'selected'));
    },
    async restore() {
      const saved = await transact('readonly', store => store.get('selected'));
      if (!saved || saved.version !== 1 || !Array.isArray(saved.files)) return null;
      return saved.files.map(({ path, file }) => {
        if (typeof path !== 'string' || !(file instanceof Blob)) throw new Error('The remembered folder is unreadable. Choose the folder again.');
        const restored = new File([file], path.split('/').pop(), { type: file.type, lastModified: file.lastModified || 0 });
        Object.defineProperty(restored, 'webkitRelativePath', { value: 'remembered-export/' + path });
        return restored;
      });
    },
    clear() { return transact('readwrite', store => store.delete('selected')); }
  };
})(window);
