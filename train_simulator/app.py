"""Traction converter simulator — local web server.

Author: Rafael Tavares

The simulation runs in the browser (static/js/engine.js); this script only serves
the files. No third-party packages are required.

Usage:
    python app.py                 # opens http://127.0.0.1:8050
    python app.py --port 8080 --no-browser
"""
from __future__ import annotations

import argparse
import functools
import http.server
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        if path.split("?")[0] in ("/", "/index.html"):
            return str(ROOT / "static" / "index.html")
        return super().translate_path(path)

    def log_message(self, *args) -> None:  # keep the console quiet
        pass


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8050)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    handler = functools.partial(Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}"
    print(f"Simulator running at {url}  (Ctrl+C to quit)")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
