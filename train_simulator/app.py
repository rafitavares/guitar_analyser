"""Simulador de conversor de tração — servidor web.

Uso:
    pip install -r requirements.txt
    python app.py            # abre http://127.0.0.1:8050 no navegador
"""
from __future__ import annotations

import argparse
import threading
import webbrowser

import numpy as np
from flask import Flask, jsonify, request, send_from_directory

from sim import excel_models as em
from sim.engine import SIM

app = Flask(__name__, static_folder="static", static_url_path="/static")


def _f(name: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(request.args.get(name, default))
    except ValueError:
        v = default
    return float(np.clip(v, lo, hi))


def _list(a, nd=2):
    return np.round(np.nan_to_num(a), nd).tolist()


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/state")
def state():
    return jsonify(SIM.snapshot(wave=request.args.get("wave") == "1"))


@app.post("/api/command")
def command():
    body = request.get_json(force=True, silent=True) or {}
    SIM.command(str(body.get("cmd", "")), body.get("value"))
    return jsonify(ok=True)


# ----------------------------------------------------------- Laboratório Excel
@app.get("/api/lab/pwm")
def lab_pwm():
    level = 3 if request.args.get("level") == "3" else 2
    out = em.pwm_sheet(
        level,
        freq=_f("freq", 21, 0, 200),
        amp=_f("amp", 1500, 0, 3000),
        fc=_f("fc", 400 if level == 2 else 600, 50, 5000),
        carrier_amp=_f("carrier_amp", 1500, 1, 3000),
        dt=_f("dt", em.EXCEL_PWM_DT, 1e-6, 1e-3),
        n=int(_f("n", em.EXCEL_PWM_ROWS, 100, 20000)),
    )
    return jsonify({k: _list(v, 6 if k == "t" else 2) for k, v in out.items()})


@app.get("/api/lab/precharge")
def lab_precharge():
    out = em.precharge_sheet(vmax=_f("vmax", 3000, 1, 50000), r=_f("r", 1000, 0.01, 1e6),
                             c=_f("c", 0.001, 1e-6, 10), percent=_f("percent", 100, 0, 100))
    return jsonify({k: (_list(v, 4) if isinstance(v, np.ndarray) else v) for k, v in out.items()})


@app.get("/api/lab/ripple")
def lab_ripple():
    out = em.ripple_sheet(r=_f("r", 325, 1, 10000), c_step=_f("c_step", 4, 0.1, 100),
                          vmax=_f("vmax", 3000, 0, 50000), dt_step=_f("dt_step", 7, 0.1, 100))
    # 5000 pontos -> devolve 1 a cada 2 para o gráfico (a curva continua idêntica à do Excel)
    return jsonify({k: (_list(v[::2], 6 if k == "t" else 2) if isinstance(v, np.ndarray) else v)
                    for k, v in out.items()})


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8050)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    SIM.start()
    url = f"http://{args.host}:{args.port}"
    print(f"Simulador rodando em {url}  (Ctrl+C para sair)")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
