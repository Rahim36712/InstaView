# InstaView 📸💬

> **A fast, privacy-focused, client-side viewer & local AI assistant for Instagram HTML data exports.**  
> Zero external runtime dependencies • Offline-first • In-browser RAG semantic search • Spotify-style Chat Wrapped • Native desktop launcher.

---

## ✨ Features

- **🔒 100% Client-Side & Private:** All parsing, indexing, and rendering happen locally in your browser. None of your direct messages, photos, videos, or audio notes are ever sent to an external server.
- **⚡ Native App & Browser Modes:**
  - **Native Desktop App:** Launch with `InstaView.pyw` via pywebview and Microsoft WebView2. Operates in an app window with persistent localStorage across restarts.
  - **Static Browser Mode:** Launch with `Start InstaView.cmd` or any static HTTP server (`python -m http.server 8765`).
  - **Offline File Picker:** Direct `file://` support via modern Web File System / Directory Picker API with optional IndexedDB caching.
- **📜 Multi-Part HTML Export Parser:**
  - Seamlessly handles multi-chunk exports (`message_1.html`, `message_2.html`, ...).
  - Restores natural chronological ordering from Instagram's reverse-ordered export files.
  - Handles 23,000+ messages per chat effortlessly using virtualized 150-message windows and smooth infinite scrolling.
  - Full media binding: inline image previews, voice notes, video playback, reel links, and reactions.
- **🧠 Local RAG & Gemini AI Assistant:**
  - **In-Browser Semantic Retrieval:** Powered by an offline BM25 search engine and conversational micro-dialogue chunker running in a dedicated Web Worker.
  - **Streaming Gemini Q&A:** Grounded answers powered by Google Gemini Flash via user-provided API key, featuring strict citation validation with interactive `[#ID]` chips that jump directly to source messages in chat.
  - **Range Summarizer & Relationship Timeline:** Summarize specific conversation spans or trace how dynamics evolved over months or years.
  - **Spotify-Style Chat Wrapped:** Computes precise local metrics (total messages, response latency, word ratios, peak chatting hours, emoji stats) blended with Gemini relationship archetypes.
- **🔍 Fast Search & Filtering:**
  - **Global Search (`Ctrl+K`):** Search message text across every conversation in your archive without loading them into memory.
  - **In-Chat Search (`/`):** Instant jumping to matching keywords in the active conversation.
  - **Filter Pills:** Quickly filter by Photos, Audio messages, Shared Reels, Starred messages, or Date Ranges.
- **⭐ Starred Vault & Resume:**
  - Bookmark meaningful messages with custom notes.
  - Resilient archive identifiers survive export reload and positional changes.
  - Automatic resume: picks up reading exactly where you left off.
- **🎨 Modern Theming & UI:**
  - Default "Soft Cream" warm palette, Dark mode, AMOLED, Cyberpunk, and Rose Gold.
  - Glassmorphic UI polish, circular quick-action menu, responsive mobile view, and optional subtle 3D card tilt.

---

## 🚀 Quick Start

### 1. Download Your Instagram Data Export
1. On Instagram, go to **Settings → Accounts Center → Your Information and Permissions → Export Your Information**.
2. Request an export in **HTML format** with **High** media quality.
3. Once ready, download and extract the ZIP file to your computer.

### 2. Run InstaView

You can use InstaView in either of two ways:

#### Option A: Native Desktop App (Recommended)
Double-click **`InstaView.pyw`** (or create a shortcut to it on your desktop).  
*Requirements: Python 3 and `pip install pywebview`.*

#### Option B: Browser Launcher
Double-click **`Start InstaView.cmd`** (or run `python -m http.server 8765 --bind 127.0.0.1` at the export root and open `http://localhost:8765/viewer/` in your browser).

#### Option C: Direct Folder Picker
Open `viewer/index.html` directly in any Chromium-based browser (Edge, Chrome, Brave) and click **"Select Instagram Export Folder"**.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | Open Global Search across all conversations |
| <kbd>/</kbd> | Focus in-chat search |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Navigate conversation list |
| <kbd>T</kbd> | Jump to first message in conversation |
| <kbd>B</kbd> | Jump to latest message in conversation |
| <kbd>F</kbd> | Toggle focus mode (hides sidebar & panels) |
| <kbd>N</kbd> / <kbd>P</kbd> | Jump to Next / Previous starred message |
| <kbd>Esc</kbd> | Close open modals, search, or AI drawer |

---

## 🛠️ Architecture

InstaView is built from the ground up without heavy frameworks, bundlers, or external dependencies:

```
├── InstaView.pyw           # Native WebView2 desktop wrapper (fixed origin, persistent profile)
├── Start InstaView.cmd     # Lightweight Windows one-click local server launcher
├── instaview.ico           # Application icon
├── viewer/
│   ├── index.html          # Main application interface and modal structures
│   ├── css/
│   │   └── styles.css      # Custom styling, theme variables, glassmorphism & responsive layout
│   ├── js/
│   │   ├── app.js          # Core UI controller, virtual windowing & infinite scroll logic
│   │   ├── parser.js       # HTML export parser, multi-part stitcher & media binder
│   │   ├── archive.js      # Stable archive reference storage (stars, notes, resume)
│   │   ├── rag.js          # BM25 indexing, tokenizer & conversational chunker
│   │   ├── rag-worker.js   # Off-thread Web Worker for zero-lag background indexing
│   │   ├── ai-client.js    # Gemini API client, streaming SSE parser, rate-limit cooldown
│   │   ├── circle-menu.js  # Circular quick-action radial menu
│   │   └── export-cache.js # Optional IndexedDB export snapshot manager
│   └── tests/              # 50+ automated unit & regression tests
```

---

## 🧪 Testing & Verification

InstaView includes a comprehensive suite of unit, integration, and launcher tests with zero npm dependencies:

```bash
# Run the complete test suite (50+ tests)
node --test viewer/tests/*.test.cjs

# Run Python launcher tests
python viewer/tests/launcher_test.py
```

---

## 🛡️ Privacy Guarantee

- **Zero Analytics / Telemetry:** No tracking scripts, Google Analytics, or third-party tracking pixels.
- **Local Media Serving:** All images, videos, and voice recordings are served directly from your local filesystem.
- **Optional AI:** The AI features (Gemini Flash) are completely opt-in and require your own Google AI Studio API key. The key is stored solely in your local browser's `localStorage` and sent directly to Google's official API endpoint over HTTPS. Only the bounded excerpts retrieved for a specific question are processed.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
