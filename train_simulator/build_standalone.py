"""Builds dist/traction_simulator.html: a single file that runs in any browser.

Author: Rafael Tavares

All CSS/JS (including uPlot) is inlined, and the simulation engine runs in
JavaScript (static/js/engine.js, a port of sim/engine.py validated by
tests/test_js_port.py). No Python, server or internet connection required.

Usage:  python build_standalone.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
OUT = ROOT / "dist" / "traction_simulator.html"

# replaces fetch() calls to the server with direct calls to the JS engine
SHIM = """
(function () {
  const sim = new TractionSim.Simulator();
  const api = TractionSim.makeLocalApi(sim);
  sim.start();
  window.apiGet = async (url) => api.get(url);
  window.apiCmd = async (cmd, value) => { api.command(cmd, value); return { ok: true }; };
})();
"""


def _read(url_path: str) -> str:
    return (STATIC / url_path.removeprefix("/static/")).read_text(encoding="utf-8")


def _script(code: str) -> str:
    return "<script>\n" + code.replace("</script", "<\\/script") + "\n</script>"


def build() -> Path:
    html = (STATIC / "index.html").read_text(encoding="utf-8")

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">',
                  lambda m: "<style>\n" + _read(m.group(1)) + "\n</style>", html)

    def inline_js(m: re.Match) -> str:
        src = m.group(1)
        block = _script(_read(src))
        if src.endswith("/util.js"):  # engine + shim right after apiGet/apiCmd are defined
            block += "\n" + _script(_read("/static/js/engine.js")) + "\n" + _script(SHIM)
        return block

    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
    assert 'src="/static' not in html and 'href="/static' not in html, "external resource not inlined"

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    return OUT


if __name__ == "__main__":
    p = build()
    print(f"Built {p}  ({p.stat().st_size / 1024:.0f} KB)")
