# InstaView RAG and reliability update — 2026-10-01

The viewer remains plain HTML/CSS/JavaScript. No npm packages, React migration,
local LLM, API-key replacement, or model downloads are required. The supplied
React circular-menu design was adapted to native buttons, CSS animation, and
JavaScript, as requested. Original Instagram export files were not changed.

## What changed

- `js/rag.js` exposes `window.InstaViewRAG`, `ConversationalChunker`, `BM25Index`,
  and `RAGRetriever`. Six-message micro-dialogues overlap by two messages within
  a session; gaps over twenty minutes create a new session. Dates use the parser's
  actual JavaScript Date objects. English, Urdu, Roman Urdu, dates, message IDs,
  sender boosts, and optional recency weighting are supported. Small vocabulary
  expansions improve some queries; this is lexical retrieval, not embeddings.
- `js/rag-worker.js` builds/searches the selected chat off the rendering thread.
  A cooperative fallback yields regularly when workers are unavailable or the
  viewer is opened through `file://`. Superseded builds are cancelled. Only the
  active conversation has a retrieval index.
- Smart RAG is the default AI scope. Questions retrieve up to ten ranked moments
  and deduplicate overlapping messages. Context packing bounds large messages
  and multilingual text. Q&A has a 600-character question limit and a maximum
  estimated 1,200 input tokens including instructions. Estimates are not exact
  Gemini tokenizer counts. No extra token-counting API call is made.
- Recent mode considers the latest 1,000 messages and range mode respects both
  selected endpoints, including message ID zero. Both use bounded samples when
  needed. A RAG query with no matches falls back to a clearly disclosed sample
  of recent messages. The evidence panel shows exactly the supplied excerpts,
  UTC dates, and clickable original message IDs. Retrieval works without a key.
- Range summaries, timeline generation, and Wrapped narratives also receive
  bounded excerpts. Partial samples are labelled; they cannot establish a full
  relationship history. Wrapped falls back to actual local metrics instead of
  fabricated emotional descriptions or invented top emojis.
- `js/ai-client.js` permits one generation request at a time, caps attempts at
  three, waits between transient-error retries, switches models on 404, and stops
  on authentication or malformed-request errors. A 429 starts a cooldown shared
  across models; the cooldown survives reloads. Successful identical prompts are
  cached only in memory (five-minute lifetime, at most eight entries).
- All AI workflows can be cancelled and discard results after a chat switch.
  API keys use HTTPS headers rather than request URL parameters. Model discovery
  is an explicit Settings action, not an automatic call on every app startup.
  Settings includes a preferred-model selector. Model access and quotas depend
  on the user's Google project; discovery does not prove free-tier eligibility.
- Citation buttons are limited to supplied source IDs. Q&A and summaries with
  missing/invalid references are withheld. This validates references, not whether
  a claim logically follows from a message. Generated timeline/award JSON is
  shape-checked and escaped before rendering. Prompt instructions inside message
  evidence are treated as untrusted data.
- AI timestamps, date-range comparisons, peak-hour calculations, and reply-gap
  units are corrected. Corrupted saved JSON no longer prevents startup. Preview
  scans do not retain every chat in RAM, and only three opened chats are cached.
  Repeated file-media renders reuse object URLs; temporary download URLs expire.
- `js/export-cache.js` provides an optional IndexedDB snapshot for folder-picker
  users, with a 256 MB limit and storage-capacity checks. Select **Remember picked
  folder** before choosing it, then **Open remembered folder** on a later load.
  **Settings → Remembered export → Forget browser copy** removes only that copy.
  This is opt-in; browser eviction/clearing can remove it. The native launcher
  already opens its export folder automatically and does not need this cache.
- The circular menu offers AI, global search, stars, media, Wrapped, theme, and
  settings actions. It supports arrow keys, Escape, outside clicks, visible focus,
  and reduced motion. The AI drawer fills a narrow screen; desktop layouts stay
  docked/resizable. New Soft Cream controls use a solid blue accent.
- Parser/server errors now stop analysis instead of silently accepting a partial
  message archive. The native launcher reports an occupied unhealthy port instead
  of forcibly killing its owner. Fixed port 8765, localhost origin, and persistent
  WebView2 settings are retained.

## Verification

Run from the export root:

```powershell
node --test viewer/tests/*.test.cjs
Get-ChildItem viewer/js/*.js | ForEach-Object { node --check $_.FullName }
python -m py_compile InstaView.pyw
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/viewer/`. Production launchers continue to use 8765.
Node is needed only for development checks, not for running the viewer.

All **26 automated checks passed**. Regression coverage includes session boundaries, zero IDs, multilingual
retrieval and context budgets, invalid dates/preferences/citations, aborted index
builds, quota/auth/service-error behavior, cancellation, cached responses, reply
statistics, folder-cache round trips and aborted writes, and partial-chat errors.
Folder-cache unit checks use an isolated IndexedDB transaction double; they do
not write to the user's browser cache or original export.

The actual Albert Ross conversation loaded all **23,053 messages** from three
parts and produced **5,934 chunks** in a browser worker. After optimization, a
measured build took **266.4 ms**. An exam query took **0.4 ms**, supplied six
moments, and used approximately **823 total input tokens** by the local estimate.
These are individual measurements, not performance guarantees. Desktop and
narrow-screen rendering were checked in the browser.

Live Gemini response quality, quota behavior, and latency were not tested against
Google because the verification browser has no configured API key. Transport
regressions were verified with mocked responses; no private messages were sent
to Google during verification. Native WebView2 relaunch persistence and actual
folder-picker/browser-cache round trips remain manual checks.

## Limits to preserve and revisit

RAG cannot eliminate provider outages, quota limits, or hallucinations. Sparse
search can miss paraphrases or multilingual synonyms not in its small expansion
list. Source references make review easier, not infallible. Voice notes, photos,
and videos are not transcribed/analyzed by this text pipeline.

Saved archive data now uses stable references and an export index fingerprint;
see the update below. Theme/reading settings still share the fixed origin. Only one
export should run at a time; the native launcher now checks identity before reuse.
The static browser fallback remains unchanged and can reuse an earlier server.
Attachment fallback remains heuristic, and the export has no reply-thread metadata.

References used for API behavior/model availability:
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/troubleshooting

## Calm workspace and saved archive update — 2026-10-01

- The supplied GlowingShadow React design is adapted to a reusable native button
  using `.glowing-shadow`, its orbit decoration and content slot. It opens archive
  search from the empty chat view. Soft Cream uses a solid blue border/glow;
  alternate palettes have a slow CSS orbit. Reduced motion disables animation.
  Existing zero-dependency launchers need no shadcn/Tailwind/TypeScript scaffolding.
- Chat headers keep Search, AI and More visible. More contains the existing stars,
  contact/media, date jump, stats, focus, filters/timeline, print and Wrapped
  actions, plus Pin conversation. The circular menu remains available. Toolbars
  start collapsed and remember their state; resizing into mobile preserves the
  selected chat. Mobile AI hides the floating circular trigger and keeps the input
  and local-search action accessible while evidence is open.
- **Find messages** retrieves excerpts locally, even when a key exists. **Ask AI**
  performs generation. Suggestion chips fill a task-specific question or open the
  period summarizer; clicking one makes no Google call. Evidence can be reviewed
  first and generated from the same prepared payload later. Errors retain evidence,
  quota recovery shows a countdown, and retries are manual. The existing transport
  still bounds attempts; a countdown is not proof that daily quota has reset.
- In-chat search combines keyword, sender, message type/star status and inclusive
  local calendar dates. Searches are saved per conversation (up to twenty), and
  pins sort above the selected conversation sort. Reading settings remember message
  size (12–20px), spacing and width; focus/toolbars and desktop AI-open state also
  persist. New installations default to Inter; existing font choices are preserved.
- `js/archive.js` exposes `InstaViewArchive.ArchiveStore`, `fingerprint`,
  `indexMessages`, `resolve`, and `filterMessages`. Export identity is a deterministic
  fingerprint of the raw chats index, not its absolute path. Identical copied indexes
  share saved data. Changing the chats index creates another profile; backups from a
  different profile are rejected. This does not automatically transfer saved data
  between newly generated exports.
- Message references fingerprint sender, timestamp, text, type and media name/URL,
  with an ordinal and total count for identical messages. Inserting unrelated
  messages does not shift saved stars/resume. Changed/missing messages, changed
  duplicate counts and changed attachment parsing can leave references unresolved;
  these remain saved and are not guessed. Fingerprints are compact noncryptographic
  identifiers, not encryption or a formal guarantee against hash collisions.
- Starred Messages has collection filtering and private notes (500 characters),
  with optional collection names (60 characters). Settings downloads/restores a
  matching export backup containing stars, notes, pins, searches and resume. Restore
  validates the entire input before merging and keeps newer stars/notes. API keys,
  message bodies, theme/reading preferences and export files are excluded.
- Legacy positional stars are retained in their original key. **Settings → Saved
  archive data → Stars from older versions → Import legacy positions** explicitly
  claims them once for the active export. Because their original fingerprints were
  never saved, the user must review them. Legacy resume positions are retained but
  not automatically applied. Corrupted new archive data is retained in a `-recovery`
  preference key before fresh session writes.
- Native server reuse checks a hashed location identity via `/instaview-info.json`.
  For older/static servers, it compares chats index bytes. Other/unknown exports
  are refused with an explanation. The fixed port, localhost origin and persistent
  WebView2 settings are unchanged; no other process is killed.

Additional verification: `node --test viewer/tests/*.test.cjs` and
`python viewer/tests/launcher_test.py`. Launcher checks mock remote responses and
do not open a native window or stop a server. Local-only and manual-generation
tests use mocked Gemini responses. Original export files remain read-only.

Final result for this update: **35 Node checks and 4 Python launcher checks passed**;
all eight runtime JavaScript files passed syntax checks, Python compiled, and HTML
tags/IDs were checked. Browser verification loaded the 23,053-message stress chat,
checked the reduced header and saved search/pin behavior, confirmed local evidence
retrieval, and verified note/collection plus reading-setting persistence on reload.
At 390×780, the AI drawer began at x=0, fit the viewport, and kept the input/local
search action visible with evidence open. Browser error logs were empty. Verification
stars, notes, pin and saved search were removed through the UI; reading settings
returned to defaults. The component preview is `verification/glowing-shadow.png`
and excludes private message content. Live Gemini generation, actual file-picker
backup restoration and a native WebView2 relaunch remain manual checks.

## Backup library — 2026-10-05

The existing remembered-folder cache stored one browser snapshot, and the native
launcher opened one export. Neither offered an in-app switcher for multiple
Instagram exports. The sidebar now displays **Backups** with a named button for
each export; a single click opens that backup and, when possible, the same chat.
The last successfully selected backup reopens automatically on startup.

Put each extracted **HTML** Instagram export in its own named folder inside
`Instagram Backups/` beside `InstaView.pyw`. For example:

```text
Instagram Backups/
  2026-10-05/
    your_instagram_activity/messages/chats.html
    your_instagram_activity/messages/inbox/...
    files/...
```

One additional Instagram wrapper directory is supported. Retain the complete
export structure and media. ZIPs must be extracted first; JSON exports are not
supported by this HTML parser. Click **Refresh** after adding a backup while the
app is open, or reopen the app. Folder names label the buttons. The existing
original export remains in place as **Original export**.

`js/export-library.js` discovers folders through the existing local HTTP server's
directory indexes. Both the native server and the unchanged Python/browser
fallback support this. No new Python bridge, packages, server writes or browser
snapshot are needed; the 256 MB browser-cache cap does not apply to disk backups.
Only the designated directory and its immediate export/wrapper levels are
scanned, with at most 100 directory probes and individual request timeouts.
External links, parent links and encoded directory separators are ignored.
An HTTP error retains the previous catalog and offers Refresh. Custom static
hosts need directory listing enabled. `file://` continues to use the existing
folder picker and single opt-in browser copy; automatic disk discovery requires
the native launcher or a local HTTP server.

Exports stay separate, with no message merging or deduplication. A newer export
can omit old/deleted messages, so keep the older folders. For named backups,
archive identity includes the backup's relative folder path plus the chats-index
fingerprint; two backups with equal indexes have separate stars, notes, pins,
searches and resume positions. The original export retains its existing identity
and saved data. Renaming/moving a backup folder or replacing its chats index
changes its saved-data profile; use a new folder for every export and retain
existing folder names. Stars are not automatically copied between exports.
Settings' **Download backup** still exports saved annotations, not Instagram
messages or media. The new library reads the actual extracted Instagram exports.

Loads prepare a candidate parser before replacing the active export. Empty or
unreadable candidates and stale overlapping requests cannot replace the current
selection. Successful switches save the old reading position, cancel AI work,
clear retrieved context and Gemini's response cache, discard stale preview/search/
media-vault work, stop media playback, revoke old file URLs and close overlays.
Conversation ownership is detected afresh. Message parts still use the existing
error handling and bounded RAG pipeline.

Verification: **42 Node checks and 4 Python launcher checks passed**, and all nine
runtime JavaScript files passed syntax checks. The optional
`tests/export-library.browser.cjs` uses a fresh Playwright context and synthetic
export responses: it checks discovery, equal-index isolation and stars, switching
the same contact, media paths, reload selection, Refresh, failed-backup recovery
and a 390px layout. It can run against a server at `INSTAVIEW_TEST_URL` with a
development Playwright module supplied through `PLAYWRIGHT_MODULE`. Neither the
unit tests nor browser fixtures write to original exports or the user's browser
profile. Native WebView2 relaunch is still a manual check.
The actual original export also loaded its 23,053-message multipart Albert Ross
chat in an isolated browser with no page exceptions. No private message content
was included in screenshots or sent to an external service during verification.

## Clear controls and faster answers — 2026-10-09

The conversation header exposes Search, AI assistant, Filters, Media and Focus
by name. These controls use a green **On** badge, a neutral **Off** badge and
`aria-pressed` derived from actual panel visibility. More keeps secondary actions.
Selected AI tabs have a solid accent fill, a checkmark, `aria-selected` and arrow/
Home/End keyboard navigation. Scope pills also expose their selection. The Glass
wallpaper uses a plain canvas, with quieter header motion and solid AI send colour.

Two state bugs are fixed: the toolbar highlight used to indicate hidden controls,
and restoring Focus on startup hid the conversation list before a chat was chosen.
Opening Filters now exits Focus and shows the controls in one click. Focus is
restored only after selecting a conversation, and export reset reveals the list.

Q&A, manual generation from saved excerpts and range summaries use Google's
`streamGenerateContent?alt=sse`. Incoming text is escaped and labelled as a draft;
source buttons appear only after the complete answer passes reference validation.
The stream parser handles fragmented UTF-8/SSE, ignores thought parts, cancels its
reader, bounds response size and refuses malformed, blocked, truncated or unfinished
output. Reference validation checks source membership, not whether every claim is
entailed by the evidence. It cannot guarantee zero hallucinations.

Brief Q&A prompts and a 1,536-token output cap reduce answer length. Fast reasoning
controls are restricted to documented model IDs: minimal for 3.5 Flash-Lite, low
for 3.8 Flash, and a zero thinking budget for 2.5 Flash/Flash-Lite. Unknown/discovered
models retain their own defaults. These choices favour latency over deep reasoning;
the output cap includes thought tokens, so difficult answers may be withheld when
the model hits it. JSON workflows retain their 2,048-token cap. Response cache keys
include output/reasoning options; matching answers are reused for five minutes.
First-text and complete-response timings appear below generated answers; a visible
phase/timer distinguishes local search, Google wait and retries.

Wrapped renders exact local metrics before waiting for the optional AI narrative.
Provider failure or cancellation keeps those slides usable. AI award reasons now
also require valid supplied references. Range perspective instructions ask about
stated statements/feelings, rather than inferred intent.

Provider contracts checked against official documentation:
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/generate-content/thinking

Verification: **50 Node checks and 4 Python launcher checks passed**, all runtime JS
syntax checks and Python compilation passed. Both development browser checks passed
using fresh contexts and synthetic exports/Gemini responses. `tests/ui-ai.browser.cjs`
covers restored Focus, state labels, keyboard tabs, local-only retrieval, streamed
answers, cache reuse, invalid citations, output truncation, range summaries, timeline
source zero, immediate Wrapped metrics, cancellation, quota recovery and 390px fit.
Synthetic screenshots are under `verification/clear-controls-*.png`.

A separate read-only browser measurement of the actual 23,053-message original
chat indexed 5,934 chunks in **229.9 ms** in its worker; one `exam` query completed
in **13.7 ms** with six excerpts/~662 estimated tokens and no page exceptions.
This measures local retrieval, not Gemini latency, and is a single run on this
machine. All external requests were blocked during that measurement. Live Gemini
generation and native WebView2 relaunch remain unverified. Streaming improves time
to visible text; RAG and caching reduce workload but cannot remove Google's quotas,
outages or network latency. No model/runtime installation or export-data edits.
