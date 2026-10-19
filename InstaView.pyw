"""
InstaView — native desktop launcher (pywebview)

Double-click this file. It runs under pythonw.exe (no console window),
serves the Instagram export on fixed localhost port 8765, and shows the
viewer inside a native WebView2 window.

Errors are logged to %TEMP%\\instaview.log and surfaced via a MessageBox.
"""

import os
import sys
import threading
import tempfile
import traceback
import hashlib
import json
from datetime import datetime
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(tempfile.gettempdir(), 'instaview.log')

# Persistent WebView2 profile — REQUIRED so localStorage (starred messages,
# theme, resume position) survives app restarts and PC reboots.
# Must be set BEFORE webview is imported/started.
DATA_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'InstaView', 'WebView2'
)
os.makedirs(DATA_DIR, exist_ok=True)
os.environ['WEBVIEW2_USER_DATA_FOLDER'] = DATA_DIR

WINDOW_TITLE = 'InstaView'
WINDOW_W = 1382
WINDOW_H = 861
BG_COLOR = '#F6F3EF'  # Soft Cream — matches the default theme

# FIXED port is REQUIRED: localStorage (starred messages, theme, resume
# position) is scoped per-origin (host:port). A random port would give a
# fresh origin every launch and silently wipe saved stars. Must match the
# browser fallback launcher (Start InstaView.cmd) so both share storage.
PORT = 8765


def alert(message):
    """Console-free friendly error dialog."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, WINDOW_TITLE, 0x40)
    except Exception:
        pass


def log_crash():
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write('\n--- %s ---\n' % datetime.now().isoformat(timespec='seconds'))
            f.write(traceback.format_exc())
    except Exception:
        pass


class QuietHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/instaview-info.json':
            body = json.dumps({'export_id': export_location_id(), 'name': os.path.basename(ROOT)}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass  # keep silent — no console anyway

    def end_headers(self):
        # Never cache app files: a stale app.js in the WebView2 profile would
        # silently run OLD code (this is how the multi-part fix was missed).
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def is_server_healthy(port):
    try:
        import urllib.request
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/viewer/index.html', timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def export_location_id():
    return hashlib.sha256(os.path.normcase(os.path.realpath(ROOT)).encode('utf-8')).hexdigest()


def is_same_export(port):
    """Never silently open another export when the fixed port is occupied."""
    import urllib.request
    import urllib.error
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/instaview-info.json', timeout=2) as response:
            metadata = json.loads(response.read(4096))
            return metadata.get('export_id') == export_location_id()
    except urllib.error.HTTPError as error:
        if error.code != 404:
            return False
    except Exception:
        return False
    # Older native instances and the browser launcher expose only static files.
    try:
        index_path = 'your_instagram_activity/messages/chats.html'
        with open(os.path.join(ROOT, *index_path.split('/')), 'rb') as source:
            expected = hashlib.sha256(source.read()).digest()
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/{index_path}', timeout=2) as response:
            actual = response.read(16 * 1024 * 1024 + 1)
            return len(actual) <= 16 * 1024 * 1024 and hashlib.sha256(actual).digest() == expected
    except Exception:
        return False


def main():
    try:
        import webview  # noqa: F401
    except ImportError:
        alert(
            'pywebview is missing.\n\n'
            'Fix it by running this once:\n\n'
            '    pip install pywebview\n\n'
            'Then launch InstaView again.'
        )
        return 1

    srv = None
    try:
        ThreadingHTTPServer.allow_reuse_address = True
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', PORT), partial(QuietHandler, directory=ROOT))
            srv.daemon_threads = True
            thread = threading.Thread(target=srv.serve_forever, kwargs={'poll_interval': 0.25}, daemon=True)
            thread.start()
        except OSError:
            if is_server_healthy(PORT):
                if not is_same_export(PORT):
                    alert('Another export is already using InstaView on port 8765.\n\n'
                          'Close its app/server window, then launch this export again.\n'
                          'No process has been stopped.')
                    return 1
                # Port busy with an active, healthy InstaView server; reuse it.
                srv = None
            else:
                # A failed health check does not prove that the port owner is ours.
                alert('Port 8765 is busy, but InstaView is not responding.\n\n'
                      'Close the previous InstaView/server window and try again.\n'
                      'No other process has been stopped.')
                return 1

        webview.create_window(
            WINDOW_TITLE,
            'http://localhost:%d/viewer/' % PORT,
            width=WINDOW_W,
            height=WINDOW_H,
            min_size=(900, 600),
            background_color=BG_COLOR,
        )
        # private_mode=False + storage_path are essential: pywebview defaults
        # to private mode, which wipes localStorage (stars!) on every close.
        webview.start(private_mode=False, storage_path=DATA_DIR)  # blocks until window closes
        return 0
    except Exception:
        log_crash()
        alert('InstaView hit an error and had to close.\n\nDetails saved to:\n' + LOG_PATH)
        return 1
    finally:
        if srv is not None:
            try:
                srv.shutdown()
                srv.server_close()
            except Exception:
                pass


if __name__ == '__main__':
    sys.exit(main())
