/** Export-scoped preferences and stable source references. No message bodies in backups. */
(function (root) {
  'use strict';
  function fingerprint(value) {
    // Two independent 32-bit hashes. No positional ID, ownership flag or absolute path.
    let a = 2166136261, b = 3339675911;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function messageKey(message) {
    const time = new Date(message.timestamp).getTime();
    return fingerprint(JSON.stringify([message.sender || '', Number.isFinite(time) ? time : message.timestampRaw || '',
      message.text || '', message.type || '', message.sharedContent?.url || '',
      message.photoFile?.name || message.photoUrl?.split('/').pop() || '',
      message.audioFile?.name || message.audioUrl?.split('/').pop() || '']));
  }
  function indexMessages(messages) {
    const groups = new Map(), refs = new Map();
    messages.forEach(message => {
      const key = messageKey(message);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(message);
    });
    groups.forEach((group, key) => group.forEach((message, ordinal) => {
      refs.set(message.id, { key, ordinal, count: group.length });
    }));
    return { groups, refs };
  }
  function resolve(index, ref) {
    if (!ref) return null;
    const group = index.groups.get(ref.key);
    // Repeated identical messages are ambiguous if their multiplicity changed.
    return group?.length === ref.count ? group[ref.ordinal]?.id ?? null : null;
  }
  function emptyProfile(id, name) { return { version: 1, id, name, conversations: {}, pins: [] }; }
  const unsafe = key => ['__proto__', 'constructor', 'prototype'].includes(key);
  function validateProfile(value, expectedId) {
    const fail = () => { throw new Error('This is not a valid InstaView archive backup for the active export.'); };
    if (!value || value.version !== 1 || value.id !== expectedId || !/^[a-f0-9]{16}$/.test(value.id) ||
        typeof value.name !== 'string' || value.name.length > 160 || !Array.isArray(value.pins) || value.pins.length > 5000 ||
        !value.conversations || typeof value.conversations !== 'object' || Array.isArray(value.conversations)) fail();
    const profile = emptyProfile(value.id, value.name);
    const entries = Object.entries(value.conversations);
    if (entries.length > 5000) fail();
    const validRef = ref => ref && typeof ref.key === 'string' && /^[a-f0-9]{16}$/.test(ref.key) && Number.isInteger(ref.ordinal) && ref.ordinal >= 0 &&
      Number.isInteger(ref.count) && ref.count > ref.ordinal && ref.count <= 1000000;
    for (const [id, data] of entries) {
      if (unsafe(id) || id.length > 200 || !data || !Array.isArray(data.stars) || data.stars.length > 10000 ||
          !Array.isArray(data.searches) || data.searches.length > 20 || (data.resume !== null && !validRef(data.resume))) fail();
      const stars = data.stars.map(ref => {
        if (!validRef(ref) || typeof ref.note !== 'string' || ref.note.length > 500 ||
            typeof ref.collection !== 'string' || ref.collection.length > 60) fail();
        return { key: ref.key, ordinal: ref.ordinal, count: ref.count, note: ref.note, collection: ref.collection };
      });
      const searches = data.searches.map(search => {
        if (!search || typeof search.query !== 'string' || search.query.length > 200 || typeof search.sender !== 'string' || search.sender.length > 200 ||
            !['all', 'text', 'photo', 'audio', 'reel', 'link', 'starred'].includes(search.type) ||
            ![search.from, search.to].every(date => typeof date === 'string' && (date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))))) fail();
        return { query: search.query, sender: search.sender, type: search.type, from: search.from, to: search.to };
      });
      profile.conversations[id] = { stars, resume: data.resume && { key: data.resume.key, ordinal: data.resume.ordinal, count: data.resume.count }, searches };
    }
    if (value.pins.some(id => typeof id !== 'string' || unsafe(id) || id.length > 200)) fail();
    profile.pins = [...new Set(value.pins)];
    return profile;
  }
  class ArchiveStore {
    constructor(storage, id, name) {
      this.storage = storage; this.key = `instaview-archive-v1-${id}`; this.indexes = new Map();
      this.profile = emptyProfile(id, name);
      try {
        const raw = storage.getItem(this.key);
        if (raw) this.profile = validateProfile(JSON.parse(raw), id);
      } catch (_) {
        this.invalidSavedData = true;
        // Retain the original bytes before a fresh session saves anything.
        const raw = storage.getItem(this.key);
        if (raw && !storage.getItem(`${this.key}-recovery`)) storage.setItem(`${this.key}-recovery`, raw);
      }
    }
    chat(id) {
      if (unsafe(id)) throw new Error('Invalid conversation identity.');
      return this.profile.conversations[id] ||= { stars: [], resume: null, searches: [] };
    }
    index(id, messages) {
      const index = indexMessages(messages); this.indexes.delete(id); this.indexes.set(id, index);
      // Keep only a few indexes, matching the app's opened-chat cache budget.
      while (this.indexes.size > 3) this.indexes.delete(this.indexes.keys().next().value);
      return this.stars(id);
    }
    stars(id) {
      const index = this.indexes.get(id);
      return index ? this.chat(id).stars.map(ref => resolve(index, ref)).filter(id => id !== null) : [];
    }
    unresolved(id) { return this.chat(id).stars.length - this.stars(id).length; }
    star(id, msgId) {
      const index = this.indexes.get(id), ref = index?.refs.get(msgId);
      if (!ref) return null;
      return this.chat(id).stars.find(star => star.key === ref.key && star.ordinal === ref.ordinal && star.count === ref.count) || null;
    }
    toggle(id, msgId) {
      const ref = this.indexes.get(id)?.refs.get(msgId);
      if (!ref) return;
      const chat = this.chat(id), existing = this.star(id, msgId);
      if (existing) chat.stars = chat.stars.filter(star => star !== existing);
      else chat.stars.push({ ...ref, note: '', collection: '' });
      this.save();
    }
    annotate(id, msgId, note, collection) {
      const star = this.star(id, msgId);
      if (!star) return;
      star.note = String(note).slice(0, 500); star.collection = String(collection).trim().slice(0, 60); this.save();
    }
    resume(id) { return resolve(this.indexes.get(id) || { groups: new Map() }, this.chat(id).resume); }
    setResume(id, msgId) {
      const ref = this.indexes.get(id)?.refs.get(msgId);
      if (!ref || JSON.stringify(ref) === JSON.stringify(this.chat(id).resume)) return;
      this.chat(id).resume = ref; this.save();
    }
    saveSearch(id, search) {
      const chat = this.chat(id), text = JSON.stringify(search);
      chat.searches = [search, ...chat.searches.filter(s => JSON.stringify(s) !== text)].slice(0, 20); this.save();
    }
    togglePin(id) {
      this.profile.pins = this.profile.pins.includes(id) ? this.profile.pins.filter(pin => pin !== id) : [...this.profile.pins, id]; this.save();
    }
    save() { this.storage.setItem(this.key, JSON.stringify(this.profile)); }
    backup() { return JSON.stringify({ kind: 'InstaView archive backup', profile: this.profile }, null, 2); }
    restore(text) {
      if (text.length > 2 * 1024 * 1024) throw new Error('Backup is too large (maximum 2 MB).');
      const value = JSON.parse(text);
      if (value.kind !== 'InstaView archive backup') throw new Error('Choose an InstaView archive backup.');
      const incoming = validateProfile(value.profile, this.profile.id);
      // Merge: restoring a backup never removes newer saved stars or searches.
      for (const [id, chat] of Object.entries(incoming.conversations)) {
        const current = this.chat(id);
        for (const ref of chat.stars) {
          if (!current.stars.some(s => s.key === ref.key && s.ordinal === ref.ordinal && s.count === ref.count)) current.stars.push(ref);
        }
        if (!current.resume) current.resume = chat.resume;
        current.searches = [...current.searches, ...chat.searches].filter((s, i, all) => all.findIndex(t => JSON.stringify(s) === JSON.stringify(t)) === i).slice(0, 20);
      }
      this.profile.pins = [...new Set([...this.profile.pins, ...incoming.pins])]; this.save();
    }
  }
  function filterMessages(messages, search, stars = []) {
    const query = (search.query || '').trim().toLocaleLowerCase();
    const from = search.from ? new Date(`${search.from}T00:00:00`).getTime() : -Infinity;
    const to = search.to ? new Date(`${search.to}T23:59:59.999`).getTime() : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new Error('Choose a valid date range with the start before the end.');
    const starred = new Set(stars);
    return messages.filter(m => {
      const timestamp = new Date(m.timestamp).getTime();
      return (!query || (m.text || '').toLocaleLowerCase().includes(query)) && (!search.sender || m.sender === search.sender) &&
        (search.type === 'all' || search.type === 'starred' && starred.has(m.id) || m.type === search.type || search.type === 'link' && m.sharedContent?.url) &&
        (from === -Infinity && to === Infinity || timestamp >= from && timestamp <= to);
    });
  }
  root.InstaViewArchive = { ArchiveStore, fingerprint, indexMessages, resolve, filterMessages };
})(typeof window === 'undefined' ? globalThis : window);
