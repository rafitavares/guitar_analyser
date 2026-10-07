"""Gera dist/simulador_tracao.html: um único arquivo que roda em qualquer navegador.

Todo o CSS/JS (incluindo o uPlot) é embutido, e o motor de simulação roda em
JavaScript (static/js/engine.js, port de sim/engine.py validado por
tests/test_js_port.py). Não precisa de Python, servidor nem internet.

Uso:  python build_standalone.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
OUT = ROOT / "dist" / "simulador_tracao.html"

# substitui fetch() para o servidor por chamadas diretas ao motor JS
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
        if src.endswith("/util.js"):  # motor + shim logo após definir apiGet/apiCmd
            block += "\n" + _script(_read("/static/js/engine.js")) + "\n" + _script(SHIM)
        return block

    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
    assert 'src="/static' not in html and 'href="/static' not in html, "recurso externo não embutido"

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    return OUT


if __name__ == "__main__":
    p = build()
    print(f"Gerado {p}  ({p.stat().st_size / 1024:.0f} KB)")
