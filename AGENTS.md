# AGENTS.md — InstaView (Instagram DM Viewer)

## What this repo is
Client-side viewer for a real Instagram data export. Zero runtime dependencies,
no build system — plain HTML/CSS/JS served statically. Node's built-in regression
tests live in `viewer/tests/` (Node is only needed for development checks).
- `viewer/` — the entire app: `index.html`, `css/styles.css`, `js/parser.js`, `js/app.js`
- Every other folder (`your_instagram_activity/`, `files/`, etc.) is live export
  data doubling as test data. Never modify or delete it.

## Running / verifying
- Serve the EXPORT ROOT, not `viewer/`: `python -m http.server 8000` → open
  `http://localhost:8000/viewer/`
- One-click launcher: `Start InstaView.cmd` at the export root (desktop shortcut
  `InstaView.lnk` points at it). It starts `python -m http.server 8765 --bind
  127.0.0.1`, health-checks `/viewer/` first so it never double-starts, and opens
  the browser. Closing the minimized server window stops the server.
- NATIVE launcher (default): desktop `InstaView.lnk` now targets `InstaView.pyw`
  (pythonw + pywebview/WebView2, pip-installed). It serves the export root on
  FIXED port 8765 and shows the viewer in a real app window; closing the window
  exits the server. Crash log: `%TEMP%\instaview.log`. The `.cmd` browser
  launcher remains as fallback.
- PERSISTENCE (critical, don't regress): `InstaView.pyw` must keep
  `webview.start(private_mode=False, storage_path=%LOCALAPPDATA%\InstaView\WebView2)`
  AND the fixed port. localStorage — where stars/theme/resume live — is scoped
  per-origin (host:port): a random port or private mode silently wipes saved
  stars every launch. Fixed 8765 + `http://localhost:` also shares the origin
  with the `.cmd` browser launcher, so stars sync across both.
- Server mode auto-detects on load: `checkServerMode()` in `js/app.js` fetches
  `../your_instagram_activity/messages/chats.html` relative to `viewer/`; if found,
  data loads without the folder picker. Serving only `viewer/` breaks that path.
- `file://` also works via the folder picker (FileReader + object URLs), just slower.
- Multiple exports: the launcher is location-relative — copy `InstaView.pyw` +
  `viewer/` (+ `instaview.ico`) into any export folder and it serves that folder
  (server-mode autodetect). Fixed port 8765 = same origin, so theme/reading settings
  carry over. Saved archive data is scoped by the chats index. Only one export runs
  at a time. The native launcher checks identity before reusing a healthy server,
  and refuses another export. The unchanged browser fallback can still reuse the
  first static server.
- Run `node --test viewer/tests/*.test.cjs` and syntax-check `viewer/js/*.js`.
  Also verify manually: load chats, open a long chat, check
  photo/audio/reel rendering, search, starring, theme switching, reload persistence.

## Architecture facts that bite
- `js/parser.js`: global `Parser` class (`window.Parser`). Instagram's HTML export
  lists messages NEWEST-FIRST; the parser reverses to oldest-first arrays and
  assigns positional ids (array index). These shift if export content/parsing
  changes; use archive source references for persistence and resolve to ids only
  after loading messages. Never persist a new star/resume as a raw position.
- Multi-part parsing: `getMessages(convId, onProgress)` reads ALL `message_N.html`
  parts (part 1 = newest chunk; `_findConversationParts` sorts numerically;
  server mode probes parts until fetch fails). Each part is reversed to
  oldest-first BEFORE the global stable timestamp sort (same-second ties stay
  in chat order); sequential attachment fallback runs once post-merge.
  `albertross` = 3 parts / ~23k messages — the stress case.
- Media binding: photos/audio are matched by filename from `<img>`/`<audio>` src;
  fallback assigns files sequentially (`_refineAttachmentType`) — fragile if a
  message block lacks media tags.
- A missing later part (404) ends multipart probing; network/other HTTP failures
  raise an error instead of silently allowing AI analysis of a partial chat.
- `js/app.js`: single IIFE containing all UI logic. Renders 150-message windows
  with infinite scroll. User prefs live in localStorage under `instaview-*`.
- Stars/resume: `js/archive.js` stores `instaview-archive-v1-<indexFingerprint>`.
  References use timestamp/sender/text/type/media fingerprints plus duplicate
  ordinal/count; positional IDs remain a resolved, session-only UI map. Reconcile
  after loading messages. Unmatched or ambiguous references stay in backups and
  never point to a different position. Access stars through the existing helpers.
  Old `instaview-bookmarks`/`instaview-lastread` keys are preserved. Legacy stars
  require explicit Settings import because their original identity is unknown.
- Filter pills: `applyChatFilter()` stores the subset in `state.viewList` and sets
  `state.activeChatFilter`. Route scroll/pagination/jumps through `activeList()`,
  not `state.currentMessages`. Filtered cards show a position chip (#N of total ·
  date); clicking one calls `showInChatContext()` → resets filter + `jumpToMessage`
  flash in the full chat. Any explicit jump (`jumpToMessage`) auto-exits filter mode.
- UI polish layer sits at the END of `css/styles.css` inside ONE `@media screen`
  block (glass, 3D tilt via `initCardTilt()` CSS vars, gated entrance animations
  `.msg-enter` / `state.animateNextRender` so re-renders don't replay them;
  reduced-motion + touch guards included). Print styles unaffected — keep it that way.
- Resume position: a stable source reference in the active archive, saved on scroll
  (topmost visible message); `openConversation` centers the render window on it
  (priority over last-star) and toasts "Resumed". Toasts via `showToast()`.
- Global search: `#global-search-modal`, engine `runGlobalSearch()` scans every
  conversation (no caching into `_messages` — deliberate, RAM guard), results
  click → `selectConversation` + `jumpToMessage`. Opened by sidebar button or Ctrl/Cmd+K.
- Keyboard shortcuts (`initKeyboardShortcuts`): `/` in-chat search, ↑/↓ switch
  chats, T first msg, B bottom, F focus mode, N/P next/prev starred message,
  Esc closes overlays.
- Reply threading is IMPOSSIBLE from this export: HTML has no reply metadata
  (verified — no JSON files, no nested quote structures). Don't attempt to
  reconstruct it.
- Theming: CSS custom properties switched via body classes (`theme-*`, `font-*`,
  `wp-*`, `light-mode`). DEFAULT is `light` = "Soft Cream" palette (warm whites,
  brown neutrals, solid soft-blue accent #5C8FD6 — user's choice; keep accents
  solid & subtle there, gradients only on logo/avatars). Reel thumbnails/embeds
  hit instagram.com — need internet, fail silently offline.
- AI Layer: powered client-side by Google Gemini Flash via free API key saved in
  localStorage (`instaview-gemini-key`). Direct HTTPS fetch to Google's endpoint;
  zero server dependencies.
  - `#ai-drawer`: right-side slide-over with tabs for Q&A/semantic search,
    range summarizer, and relationship timeline.
  - Citations: AI responses include `[#ID]` tokens automatically transformed into
    interactive `.ai-citation-chip` buttons that trigger `jumpToMessage(id, 'ai')`
    with glowing `.ai-highlight-flash` pulse in the chat.
  - Range selection: `#range-select-banner` with click-to-select in the chat
    or datetime pickers, supporting presets (e.g. "What I said vs What they said").
  - Chat Wrapped (`#wrapped-modal`): Spotify Wrapped-style card carousel calculating
    exact local metrics (message counts, word ratios, response latency, peak hours,
    top emojis) blended with Gemini relationship archetypes and awards.
  - In-browser RAG (`js/rag.js`, `js/rag-worker.js`) chunks/indexes the selected chat
    in a worker with a cooperative fallback. Smart RAG is the default scope;
    payloads are bounded, sampled scopes are disclosed, and supplied source IDs
    constrain citation buttons. Do not restore full-chat prompt dumps.
  - `js/ai-client.js` caps generation at three attempts with delays, cancels stale
    work, switches on 404, stops on auth/bad requests, and persists a shared quota
    cooldown on 429. Model discovery is manual; Settings has a model selector.
    Never claim that RAG guarantees zero errors or hallucinations.

## Recently fixed (context — don't regress)
- `#settings-modal` was missing its closing `</div>`, nesting `#starred-modal`
  inside it so the Starred vault could never display.
- `selectConversation()` was called but not defined → vault card clicks threw
  ReferenceError. Now defined and routes through `openConversation()`.
- Stars were single-per-conversation (replaced on each new star); now arrays.
- Added AI Assistant side drawer, Range Summarizer, and Spotify Wrapped-style
  Relationship Dynamics powered by Gemini Flash.
- Added Gemini model automatic fallback chain with high-context prioritization (>= 1M
  tokens), dynamic Google AI Studio model discovery, and seamless error recovery.
- Converted AI panel to a docked side-by-side flex layout with draggable divider (`#ai-resizer`),
  preventing sent messages from being covered or hidden.
- Added Adaptive Message Scope selector (`Recent 2.5k`, `Range`, `Full Chat`) with smart
  compaction for scaling up to 23,000 messages without hitting Google API rate limits.
- `InstaView.pyw` health-checks existing servers. An unhealthy occupied port now
  produces a useful error; do not forcibly kill an unknown port owner.

## Roadmap (user priorities, in order)
1. Robustness/reliability fixes first.
2. Persistence: cache the picked export in IndexedDB so users don't re-select the
   folder on every load (top UX complaint).
3. New features + refreshed UI (AI assistant, Range summarizer & Chat Wrapped completed).
4. Optional React/Vite migration — if started, scaffold inside `viewer/` and keep
   parser logic framework-portable (already a standalone class).

## 2026-10-01 update
See `viewer/IMPLEMENTATION_NOTES.md` for the RAG API, verification, and remaining
limits. The circular menu was intentionally adapted to vanilla JavaScript per
user preference; do not introduce React/Tailwind for it. Optional IndexedDB
folder snapshots are implemented with a 256 MB cap and explicit opt-in. Existing
stars/resume now resolve stable references through the export-scoped archive.
Legacy positional keys remain untouched. New tests cover identity shifts,
ambiguous duplicates, backup validation, local-only evidence and manual generation.
The supplied GlowingShadow card is adapted to reusable vanilla markup/CSS on the
empty-state Search action; no React/Tailwind/TypeScript setup is needed. New screen
styles stay in the final screen block. Run Python launcher checks with
`python viewer/tests/launcher_test.py` in addition to the Node checks.

## 2026-10-09 update
Primary conversation actions have names and On/Off badges derived from actual
visibility. Focus is restored after selecting a chat; never hide the conversation
list before a chat is open. Opening Filters exits Focus. AI tabs expose selection
and keyboard navigation. Q&A/manual answers and range summaries stream escaped
drafts; only complete, source-checked answers have citation actions. Keep bounded
retries/quota cooldown and reject interrupted or MAX_TOKENS responses. Fast thinking
settings are model-specific; do not send unsupported parameters to discovered
models. Wrapped renders local metrics immediately and retains them on cancellation.
See IMPLEMENTATION_NOTES for model contracts, performance and verification limits.
The optional `viewer/tests/ui-ai.browser.cjs` uses synthetic exports and mocked
Gemini with fresh storage; never send real export data during automated checks.
