"""Serve the game locally with caching disabled, so edits show up on reload.

    python3 tools/serve.py [port]
"""
import http.server
import sys
from functools import partial
from pathlib import Path

GAME = Path(__file__).resolve().parent.parent / "game"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = partial(NoCacheHandler, directory=str(GAME))
    with http.server.ThreadingHTTPServer(("", port), handler) as server:
        print(f"Serving on http://localhost:{port}")
        server.serve_forever()
