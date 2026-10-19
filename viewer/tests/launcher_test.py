"""Read-only launcher ownership checks; no server/window/process is started."""
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

path = Path(__file__).resolve().parents[2] / 'InstaView.pyw'
loader = importlib.machinery.SourceFileLoader('instaview_launcher', str(path))
spec = importlib.util.spec_from_loader(loader.name, loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)


class LauncherIdentityTests(unittest.TestCase):
    def test_same_native_export_is_reusable(self):
        response = io.BytesIO(json.dumps({'export_id': launcher.export_location_id()}).encode())
        with patch('urllib.request.urlopen', return_value=response):
            self.assertTrue(launcher.is_same_export(8765))

    def test_other_export_is_refused(self):
        with patch('urllib.request.urlopen', return_value=io.BytesIO(b'{"export_id":"other"}')):
            self.assertFalse(launcher.is_same_export(8765))

    def test_static_browser_fallback_compares_chat_index(self):
        chats = (path.parent / 'your_instagram_activity/messages/chats.html').read_bytes()
        missing = HTTPError('http://localhost/info', 404, 'Not found', {}, None)
        with patch('urllib.request.urlopen', side_effect=[missing, io.BytesIO(chats)]):
            self.assertTrue(launcher.is_same_export(8765))
        with patch('urllib.request.urlopen', side_effect=[missing, io.BytesIO(b'other export')]):
            self.assertFalse(launcher.is_same_export(8765))

    def test_unknown_or_failed_server_is_refused(self):
        with patch('urllib.request.urlopen', side_effect=OSError('unavailable')):
            self.assertFalse(launcher.is_same_export(8765))


if __name__ == '__main__':
    unittest.main()
