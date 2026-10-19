/**
 * parser.js — Instagram HTML Data Export Parser
 *
 * Parses the folder structure and HTML files from an Instagram data export
 * selected via <input webkitdirectory>. Extracts conversations, messages,
 * media references, reactions, shared content, and owner identity.
 *
 * Usage:
 *   const parser = new Parser();
 *   await parser.loadFromFileList(inputElement.files);
 *   const conversations = await parser.getConversationList();
 *   const messages = await parser.getMessages(conversations[0].id);
 */

class Parser {
  constructor() {
    /** @type {Map<string, File>} Relative path → File object */
    this.fileMap = new Map();

    /** @type {string} Common prefix stripped from all paths */
    this.rootPrefix = '';

    /** @type {string|null} Cached owner name */
    this._ownerName = null;

    /** @type {boolean} Whether we are fetching data directly from local server */
    this.isServerMode = false;

    /** @type {string} Base URL for local server */
    this.serverRoot = '';
  }

  async loadFromServer(serverRoot) {
    this.isServerMode = true;
    this.serverRoot = serverRoot || '';
    console.log(`[Parser] Server Mode enabled at: ${this.serverRoot}`);
  }

  // ──────────────────────────────────────────────
  //  1. loadFromFileList
  // ──────────────────────────────────────────────

  /**
   * Receives a FileList from an <input webkitdirectory> element.
   * Builds an internal fileMap keyed by relative path (common prefix stripped).
   *
   * @param {FileList} fileList
   */
  async loadFromFileList(fileList) {
    if (!fileList || fileList.length === 0) {
      console.warn('[Parser] loadFromFileList called with empty FileList');
      return;
    }

    // Collect all webkitRelativePath values
    const paths = [];
    for (let i = 0; i < fileList.length; i++) {
      paths.push(fileList[i].webkitRelativePath);
    }

    // Detect common prefix (the top-level folder the user selected).
    // Every path starts with it, e.g. "exportfolder/your_instagram_activity/..."
    this.rootPrefix = this._detectCommonPrefix(paths);
    console.log(`[Parser] Detected root prefix: "${this.rootPrefix}"`);

    // Build the map with the prefix stripped
    this.fileMap.clear();
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      let rel = file.webkitRelativePath;

      // Strip the common prefix so keys start at the export root
      if (this.rootPrefix && rel.startsWith(this.rootPrefix)) {
        rel = rel.substring(this.rootPrefix.length);
      }

      this.fileMap.set(rel, file);
    }

    console.log(`[Parser] Loaded ${this.fileMap.size} files into fileMap`);

    // Reset cached owner since we loaded new data
    this._ownerName = null;
  }

  /**
   * Finds the longest common directory prefix shared by all paths.
   * Returns the prefix WITH a trailing slash so it can be cleanly stripped.
   *
   * @param {string[]} paths
   * @returns {string}
   */
  _detectCommonPrefix(paths) {
    if (paths.length === 0) return '';

    // Split each path into segments
    const splitPaths = paths.map(p => p.split('/'));
    const shortest = Math.min(...splitPaths.map(s => s.length));

    const commonSegments = [];
    for (let i = 0; i < shortest; i++) {
      const segment = splitPaths[0][i];
      const allMatch = splitPaths.every(sp => sp[i] === segment);
      if (allMatch) {
        commonSegments.push(segment);
      } else {
        break;
      }
    }

    // We only strip full directory prefixes (at least one segment deep)
    if (commonSegments.length > 0) {
      return commonSegments.join('/') + '/';
    }
    return '';
  }

  // ──────────────────────────────────────────────
  //  2. getConversationList
  // ──────────────────────────────────────────────

  /**
   * Finds and parses chats.html from the fileMap.
   * Returns a sorted array of conversation descriptor objects.
   *
   * @returns {Promise<Array<{id: string, name: string, path: string, isMessageRequest: boolean}>>}
   */
  async getConversationList() {
    let html;
    if (this.isServerMode) {
      console.log('[Parser] Fetching chats.html from server...');
      const response = await fetch(`${this.serverRoot}/your_instagram_activity/messages/chats.html`);
      if (!response.ok) {
        console.error('[Parser] Could not fetch chats.html from server');
        return [];
      }
      html = await response.text();
    } else {
      // Locate chats.html — it could be at several possible paths
      const chatsFile = this._findFile('chats.html', 'your_instagram_activity/messages');
      if (!chatsFile) {
        console.error('[Parser] Could not find chats.html in fileMap');
        return [];
      }
      console.log('[Parser] Parsing chats.html …');
      html = await this._readFileAsText(chatsFile);
    }
    // Content identity separates browser preferences for different export indexes.
    this.archiveIdentityText = html;
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Each conversation is a div.pam containing an h2 > a
    const blocks = doc.querySelectorAll('div.pam._3-95._2ph-._a6-g');
    const conversations = [];

    blocks.forEach(block => {
      const anchor = block.querySelector('h2 a');
      if (!anchor) return; // skip if malformed

      const name = (anchor.textContent || '').trim();
      const href = (anchor.getAttribute('href') || '').trim();

      // Extract folder name (conversation ID) from the path
      // e.g. "your_instagram_activity/messages/inbox/abdullahzafar_123/message_1.html"
      const pathParts = href.split('/');
      // The conversation ID is the second-to-last segment
      const id = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : href;

      // Detect message requests vs inbox
      const isMessageRequest = href.includes('message_requests');

      conversations.push({
        id,
        name,
        path: href,
        isMessageRequest
      });
    });

    // Sort alphabetically by display name (case-insensitive)
    conversations.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    console.log(`[Parser] Found ${conversations.length} conversations`);
    return conversations;
  }

  // ──────────────────────────────────────────────
  //  3. getMessages
  // ──────────────────────────────────────────────

  /**
   * Reads and parses ALL message_N.html parts for a conversation, merges them
   * chronologically and returns messages oldest-first.
   *
   * Instagram splits long exports into message_1.html, message_2.html, …
   * (part 1 = newest chunk, higher numbers go back in time). Within every part,
   * blocks are listed newest-first.
   *
   * @param {string} conversationId  Folder name, e.g. "abdullahzafar_17875050840022296"
   * @param {function(number, number=)=} onProgress  Optional (currentPart, totalParts?)
   * @returns {Promise<Array<Object>>}
   */
  async getMessages(conversationId, onProgress) {
    const parts = [];
    let media = { photos: [], audios: [] };

    if (this.isServerMode) {
      // Locate the conversation folder (inbox first, then message_requests)
      let base = null;
      for (const folder of ['inbox', 'message_requests']) {
        const url = `${this.serverRoot}/your_instagram_activity/messages/${folder}/${conversationId}/message_1.html`;
        try {
          const res = await fetch(url);
          if (res.ok) {
            base = `${this.serverRoot}/your_instagram_activity/messages/${folder}/${conversationId}`;
            break;
          }
          if (res.status !== 404) throw new Error(`Conversation returned HTTP ${res.status}. Retry before analyzing it.`);
        } catch (e) { throw new Error('Could not load this conversation. ' + e.message); }
      }
      if (!base) {
        console.error(`[Parser] Could not locate message_1.html for conversation: ${conversationId}`);
        return [];
      }
      // Probe parts until one is missing
      for (let n = 1; n <= 500; n++) {
        if (onProgress) onProgress(n);
        let res;
        try {
          res = await fetch(`${base}/message_${n}.html`);
        } catch (e) { throw new Error(`Could not load message part ${n}. Retry before analyzing this chat.`); }
        if (res.status === 404 && n > 1) break;
        if (!res.ok) throw new Error(`Message part ${n} returned HTTP ${res.status}. Retry before analyzing this chat.`);
        parts.push(await res.text());
      }
    } else {
      media = this.getConversationMediaFiles(conversationId);
      const files = this._findConversationParts(conversationId);
      if (!files.length) {
        console.error(`[Parser] Could not find message_1.html for conversation: ${conversationId}`);
        return [];
      }
      for (let i = 0; i < files.length; i++) {
        if (onProgress) onProgress(i + 1, files.length);
        parts.push(await this._readFileAsText(files[i]));
      }
    }

    // Parse every part. Blocks inside a part are newest-first, so reverse each
    // part to oldest-first BEFORE the global stable sort — this keeps
    // same-timestamp messages (very common) in true chat order.
    let ownerName = null;
    const rawMessages = [];

    for (const html of parts) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!ownerName) ownerName = this._getOwnerNameFromDoc(doc);

      const blocks = doc.querySelectorAll('div.pam._3-95._2ph-._a6-g');
      const partMsgs = [];
      blocks.forEach(block => {
        try {
          const msg = this._parseMessageBlock(block, media, ownerName, conversationId);
          if (msg) partMsgs.push(msg);
        } catch (err) {
          console.warn('[Parser] Error parsing message block:', err);
        }
      });
      partMsgs.reverse();
      rawMessages.push(...partMsgs);
    }

    // Global chronological sort (stable → ties keep per-part chat order)
    rawMessages.sort((a, b) => {
      const ta = a.timestamp ? a.timestamp.getTime() : NaN;
      const tb = b.timestamp ? b.timestamp.getTime() : NaN;
      if (isNaN(ta) && isNaN(tb)) return 0;
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return ta - tb;
    });

    // Attachment fallback (file mode only): after the merge, walk the final
    // order once and hand out unmatched photos/audio sequentially.
    if (!this.isServerMode) {
      let photoIndex = 0;
      let audioIndex = 0;
      for (const msg of rawMessages) {
        if ((msg.type === 'attachment' || msg.type === 'photo' || msg.type === 'audio') &&
            !msg.photoFile && !msg.audioFile) {
          const refined = this._refineAttachmentType(msg, media, photoIndex, audioIndex);
          if (refined.type === 'photo') {
            msg.type = 'photo';
            msg.photoFile = refined.file;
            photoIndex++;
          } else if (refined.type === 'audio') {
            msg.type = 'audio';
            msg.audioFile = refined.file;
            audioIndex++;
          }
        }
      }
    }

    rawMessages.forEach((msg, i) => {
      msg.id = i;
    });

    console.log(`[Parser] Parsed ${rawMessages.length} messages for ${conversationId} (${parts.length} part${parts.length > 1 ? 's' : ''})`);
    return rawMessages;
  }

  /**
   * Finds ALL message_N.html files for a conversation, sorted by part number.
   *
   * @param {string} conversationId
   * @returns {File[]}
   */
  _findConversationParts(conversationId) {
    const found = [];
    const re = /^message_(\d+)\.html$/i;
    for (const [path, file] of this.fileMap) {
      if (!path.includes(`/${conversationId}/`)) continue;
      const name = path.split('/').pop();
      const m = re.exec(name);
      if (m) found.push({ n: parseInt(m[1], 10), file });
    }
    found.sort((a, b) => a.n - b.n);
    return found.map(f => f.file);
  }

  /**
   * Parses a single message block <div> into a message object.
   *
   * @param {Element} block
   * @param {{photos: File[], audios: File[]}} media
   * @param {string|null} ownerName
   * @param {string} conversationId
   * @returns {Object|null}
   */
  _parseMessageBlock(block, media, ownerName, conversationId) {
    // ── Sender name ──
    const h2 = block.querySelector('h2._3-95._2pim._a6-h._a6-i');
    const sender = h2 ? h2.textContent.trim() : 'Unknown';

    // ── Timestamp ──
    const timeDiv = block.querySelector('div._3-94._a6-o');
    const timestampRaw = timeDiv ? timeDiv.textContent.trim() : '';
    const timestamp = timestampRaw ? new Date(timestampRaw) : null;

    // ── Content area (the _a6-p div) ──
    const contentArea = block.querySelector('div._3-95._a6-p');
    if (!contentArea) {
      return {
        id: 0,
        sender,
        text: '',
        timestamp,
        timestampRaw,
        type: 'text',
        isOwner: ownerName ? sender === ownerName : false,
        sharedContent: null,
        reactionEmoji: null,
        reactions: [],
        photoFile: null,
        photoUrl: null,
        audioFile: null,
        audioUrl: null
      };
    }

    // The content divs are nested: _a6-p > div > div (multiple children)
    const innerWrapper = contentArea.querySelector(':scope > div');
    const innerDivs = innerWrapper ? innerWrapper.querySelectorAll(':scope > div') : [];

    // Message text is typically in the second div (index 1)
    let text = '';
    if (innerDivs.length > 1) {
      text = (innerDivs[1].textContent || '').trim();
    }

    // ── Shared content (reels, posts) — in the third div (index 2) ──
    let sharedContent = null;
    if (innerDivs.length > 2) {
      sharedContent = this._parseSharedContent(innerDivs[2]);
    }

    // ── Reactions on this message — look for ul._a6-q ──
    const reactions = this._parseReactions(contentArea);

    let type = 'text';
    let reactionEmoji = null;
    let photoFile = null;
    let photoUrl = null;
    let audioFile = null;
    let audioUrl = null;

    // Direct element scanning for media (robust and server-mode friendly)
    const imgEl = block.querySelector('img');
    const audioEl = block.querySelector('audio');

    if (imgEl) {
      const src = imgEl.getAttribute('src');
      if (src && !src.includes('Instagram-Logo.png')) {
        type = 'photo';
        const filename = src.split('/').pop();
        if (this.isServerMode) {
          photoUrl = `${this.serverRoot}/${src}`;
        } else {
          photoFile = this._findMediaFileInMap(filename);
        }
      }
    } else if (audioEl) {
      const src = audioEl.getAttribute('src');
      if (src) {
        type = 'audio';
        const filename = src.split('/').pop();
        if (this.isServerMode) {
          audioUrl = `${this.serverRoot}/${src}`;
        } else {
          audioFile = this._findMediaFileInMap(filename);
        }
      }
    }

    // If type is still text, fall back to matching rules
    if (type === 'text') {
      if (sharedContent && sharedContent.url) {
        type = 'reel';
      } else if (this._isReactionText(text)) {
        type = 'reaction';
        reactionEmoji = this._extractReactionEmoji(text);
      } else if (this._isAttachmentText(text)) {
        type = 'attachment';
      }
    }

    const isOwner = ownerName ? sender === ownerName : false;

    return {
      id: 0, // assigned later after reversing
      sender,
      text,
      timestamp,
      timestampRaw,
      type,
      isOwner,
      sharedContent,
      reactionEmoji,
      reactions,
      photoFile,
      photoUrl,
      audioFile,
      audioUrl
    };
  }

  // Helper method to look up a media file directly in map
  _findMediaFileInMap(filename) {
    for (const [path, file] of this.fileMap) {
      if (path.endsWith(`/${filename}`)) {
        return file;
      }
    }
    return null;
  }


  /**
   * Parses shared content (reels/posts) from a div.
   * Returns object with caption, account, url, shortcode — or null.
   *
   * @param {Element} div
   * @returns {Object|null}
   */
  _parseSharedContent(div) {
    if (!div) return null;

    const anchor = div.querySelector('a[href*="instagram.com"]');
    if (!anchor) return null;

    const url = anchor.getAttribute('href') || '';
    const shortcode = this._extractShortcode(url);

    // The shared content structure has nested divs:
    // div > div > div (caption), div (account), div > a (link)
    const nestedDivs = div.querySelectorAll(':scope > div > div');
    let caption = '';
    let account = '';

    if (nestedDivs.length >= 2) {
      caption = (nestedDivs[0].textContent || '').trim();
      account = (nestedDivs[1].textContent || '').trim();
    }

    return { caption, account, url, shortcode };
  }

  /**
   * Parses reactions list (ul._a6-q) from a content area.
   *
   * @param {Element} contentArea
   * @returns {Array<{emoji: string, name: string}>}
   */
  _parseReactions(contentArea) {
    const reactions = [];
    const reactionList = contentArea.querySelector('ul._a6-q');
    if (!reactionList) return reactions;

    const items = reactionList.querySelectorAll('li');
    items.forEach(li => {
      const span = li.querySelector('span');
      if (!span) return;

      const raw = span.textContent || '';
      // Format: "😂PersonName" — emoji is first character(s), rest is name
      // Emojis can be multi-codepoint, so we use Array.from to split properly
      const chars = Array.from(raw);
      if (chars.length === 0) return;

      // Find where the emoji ends and the name begins.
      // We look for the first character that is a letter or space.
      let emojiEnd = 0;
      for (let i = 0; i < chars.length; i++) {
        // If the character is a standard letter/digit/space, the name starts here
        if (/[\p{L}\p{N}\s]/u.test(chars[i])) {
          emojiEnd = i;
          break;
        }
        emojiEnd = i + 1;
      }

      const emoji = chars.slice(0, emojiEnd).join('');
      const name = chars.slice(emojiEnd).join('').trim();

      if (emoji) {
        reactions.push({ emoji, name });
      }
    });

    return reactions;
  }

  /**
   * Extracts the shortcode from an Instagram URL.
   * e.g. "https://www.instagram.com/reel/DWZpP3zjENI/?id=..." → "DWZpP3zjENI"
   *
   * @param {string} url
   * @returns {string|null}
   */
  _extractShortcode(url) {
    const match = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : null;
  }

  /**
   * Checks if message text indicates an attachment.
   *
   * @param {string} text
   * @returns {boolean}
   */
  _isAttachmentText(text) {
    if (text === 'You sent an attachment.') return true;
    if (/^.+ sent an attachment\.$/.test(text)) return true;
    return false;
  }

  /**
   * Checks if message text indicates a reaction.
   *
   * @param {string} text
   * @returns {boolean}
   */
  _isReactionText(text) {
    return /^Reacted .+ to your message$/.test(text);
  }

  /**
   * Extracts the emoji from a reaction text like "Reacted 😂 to your message".
   *
   * @param {string} text
   * @returns {string|null}
   */
  _extractReactionEmoji(text) {
    const match = text.match(/^Reacted (.+) to your message$/);
    return match ? match[1].trim() : null;
  }

  /**
   * Determines whether an attachment message is a photo or audio,
   * and attaches the corresponding File object.
   *
   * @param {Object} msg
   * @param {{photos: File[], audios: File[]}} media
   * @param {number} photoIndex  Current photo assignment index
   * @param {number} audioIndex  Current audio assignment index
   * @returns {{type: string, file: File|null}}
   */
  _refineAttachmentType(msg, media, photoIndex, audioIndex) {
    // Photos are assigned first; if we've exhausted photos, try audio
    if (photoIndex < media.photos.length) {
      return { type: 'photo', file: media.photos[photoIndex] };
    }
    if (audioIndex < media.audios.length) {
      return { type: 'audio', file: media.audios[audioIndex] };
    }
    // No media files left — keep as generic attachment
    return { type: 'attachment', file: null };
  }

  // ──────────────────────────────────────────────
  //  4. getOwnerName
  // ──────────────────────────────────────────────

  /**
   * Determines the owner (the user who downloaded the export) by finding
   * messages where the text is exactly "You sent an attachment." — the
   * sender of those messages is the owner.
   *
   * @param {Array<Object>} messages  Parsed messages array
   * @returns {string|null}
   */
  getOwnerName(messages) {
    if (this._ownerName) return this._ownerName;

    // Strategy: find messages with text "You sent an attachment."
    // The sender of those messages is the owner.
    for (const msg of messages) {
      if (msg.text === 'You sent an attachment.') {
        this._ownerName = msg.sender;
        console.log(`[Parser] Detected owner name: "${this._ownerName}"`);
        return this._ownerName;
      }
    }

    console.warn('[Parser] Could not detect owner name from messages');
    return null;
  }

  /**
   * Internal helper: tries to extract owner name from a parsed document
   * during message parsing (before full message array is available).
   *
   * @param {Document} doc
   * @returns {string|null}
   */
  _getOwnerNameFromDoc(doc) {
    if (this._ownerName) return this._ownerName;

    // Scan all message blocks for "You sent an attachment."
    const blocks = doc.querySelectorAll('div.pam._3-95._2ph-._a6-g');
    for (const block of blocks) {
      const contentArea = block.querySelector('div._3-95._a6-p');
      if (!contentArea) continue;

      const innerWrapper = contentArea.querySelector(':scope > div');
      const innerDivs = innerWrapper ? innerWrapper.querySelectorAll(':scope > div') : [];
      if (innerDivs.length < 2) continue;

      const text = (innerDivs[1].textContent || '').trim();
      if (text === 'You sent an attachment.') {
        const h2 = block.querySelector('h2._3-95._2pim._a6-h._a6-i');
        if (h2) {
          this._ownerName = h2.textContent.trim();
          console.log(`[Parser] Detected owner name from doc: "${this._ownerName}"`);
          return this._ownerName;
        }
      }
    }

    return null;
  }

  // ──────────────────────────────────────────────
  //  5. getMediaFile
  // ──────────────────────────────────────────────

  /**
   * Looks up a specific media file (photo or audio) within a conversation folder.
   *
   * @param {string} conversationId  Folder name
   * @param {string} filename        e.g. "photo_123.jpg"
   * @returns {Promise<File|null>}
   */
  async getMediaFile(conversationId, filename) {
    // Search through the fileMap for a matching path
    for (const [path, file] of this.fileMap) {
      // Match paths like: .../inbox/conversationId/photos/filename
      //                 or .../inbox/conversationId/audio/filename
      if (path.includes(`/${conversationId}/`) && path.endsWith(`/${filename}`)) {
        return file;
      }
    }

    console.warn(`[Parser] Media file not found: ${conversationId}/${filename}`);
    return null;
  }

  // ──────────────────────────────────────────────
  //  6. getConversationMediaFiles
  // ──────────────────────────────────────────────

  /**
   * Returns all photo and audio File objects for a conversation.
   *
   * @param {string} conversationId  Folder name
   * @returns {{photos: File[], audios: File[]}}
   */
  getConversationMediaFiles(conversationId) {
    const photos = [];
    const audios = [];

    for (const [path, file] of this.fileMap) {
      if (!path.includes(`/${conversationId}/`)) continue;

      // Normalize path separators and check subfolder
      const lower = path.toLowerCase();

      if (lower.includes(`/${conversationId.toLowerCase()}/photos/`) && lower.endsWith('.jpg')) {
        photos.push(file);
      } else if (lower.includes(`/${conversationId.toLowerCase()}/audio/`) && lower.endsWith('.mp4')) {
        audios.push(file);
      }
    }

    // Sort by name to maintain consistent ordering
    photos.sort((a, b) => a.name.localeCompare(b.name));
    audios.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[Parser] Media for ${conversationId}: ${photos.length} photos, ${audios.length} audios`);
    return { photos, audios };
  }

  // ──────────────────────────────────────────────
  //  Utility: File reading helpers
  // ──────────────────────────────────────────────

  /**
   * Reads a File object as UTF-8 text using FileReader wrapped in a Promise.
   *
   * @param {File} file
   * @returns {Promise<string>}
   */
  _readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * Finds a file in the fileMap by partial path matching.
   * Searches for entries whose key ends with the given filename
   * and optionally contains a directory hint.
   *
   * @param {string} filename   e.g. "chats.html"
   * @param {string} [dirHint]  e.g. "your_instagram_activity/messages"
   * @returns {File|null}
   */
  _findFile(filename, dirHint) {
    // First try exact directory hint match
    if (dirHint) {
      for (const [path, file] of this.fileMap) {
        if (path.includes(dirHint) && path.endsWith(`/${filename}`)) {
          return file;
        }
      }
    }

    // Fallback: find any file with this name
    for (const [path, file] of this.fileMap) {
      if (path.endsWith(`/${filename}`) || path === filename) {
        return file;
      }
    }

    return null;
  }

  /**
   * Finds the message_1.html file for a specific conversation.
   *
   * @param {string} conversationId  e.g. "abdullahzafar_17875050840022296"
   * @param {string} filename        e.g. "message_1.html"
   * @returns {File|null}
   */
  _findConversationFile(conversationId, filename) {
    for (const [path, file] of this.fileMap) {
      if (path.includes(`/${conversationId}/`) && path.endsWith(`/${filename}`)) {
        return file;
      }
    }

    // Try without leading slash (edge case for root-level paths)
    for (const [path, file] of this.fileMap) {
      if (path.includes(`${conversationId}/`) && path.endsWith(filename)) {
        return file;
      }
    }

    return null;
  }
}

// ──────────────────────────────────────────────
//  Export to global scope
// ──────────────────────────────────────────────
window.Parser = Parser;
