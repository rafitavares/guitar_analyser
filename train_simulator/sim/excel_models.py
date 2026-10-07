"""Port fiel das abas ocultas do simulator.xlsm.

Cada função reproduz, coluna a coluna, as fórmulas da aba correspondente
(vetorizado com numpy). Os testes em tests/test_excel_models.py comparam o
resultado com os valores em cache salvos no próprio Excel.
"""
from __future__ import annotations

import numpy as np

# ---------------------------------------------------------------------------
# PWM Level2 / PWM Level3
#   A: tempo (passo 0.0001 s, 1001 linhas)
#   B: referência  = Amp * SIN(2*PI()*f*t)
#   C: portadora   = E2*(1 - 2*ABS((t*fc - INT(t*fc)) - 0.5))   -> triângulo 0..E2
#   D: saída PWM   (comparação |B| x C)
# ---------------------------------------------------------------------------
EXCEL_PWM_DT = 1e-4
EXCEL_PWM_ROWS = 1001


def excel_time(dt: float = EXCEL_PWM_DT, n: int = EXCEL_PWM_ROWS) -> np.ndarray:
    return np.arange(n) * dt


def sine_reference(t: np.ndarray, freq: float, amp: float, phase: float = 0.0) -> np.ndarray:
    return amp * np.sin(2 * np.pi * freq * t + phase)


def triangle_carrier(t: np.ndarray, fc: float, amp: float) -> np.ndarray:
    x = t * fc
    return amp * (1 - 2 * np.abs((x - np.floor(x)) - 0.5))


def pwm_level2_excel(ref: np.ndarray, carrier: np.ndarray, vlevel: float = 1500.0) -> np.ndarray:
    """=IF(B>0, IF(ABS(B)>ABS(C), 1500, 0), IF(ABS(B)>ABS(C), -1500, 0))"""
    on = np.abs(ref) > np.abs(carrier)
    return np.where(ref > 0, np.where(on, vlevel, 0.0), np.where(on, -vlevel, 0.0))


def pwm_level3_excel(ref: np.ndarray, carrier: np.ndarray, vlevel: float = 1500.0) -> np.ndarray:
    """Fórmula da aba PWM Level3 (níveis 0, ±750, ±1500 para Vdc = 3000 V)."""
    half = vlevel / 2
    on = np.abs(ref) > np.abs(carrier)
    high = np.abs(ref) >= half
    pos = np.where(ref >= half, np.where(on, vlevel, half), np.where(on, half, 0.0))
    neg = np.where(high, np.where(on, -vlevel, -half), np.where(on, -half, 0.0))
    return np.where(ref > 0, pos, neg)


def pwm_bipolar(ref: np.ndarray, t: np.ndarray, fc: float, vlevel: float) -> np.ndarray:
    """2 níveis "de livro" (não existe no Excel): portadora -V..+V, saída ±V."""
    carrier = 2 * triangle_carrier(t, fc, vlevel) - vlevel
    return np.where(ref > carrier, vlevel, -vlevel)


def pwm_sheet(level: int, freq: float = 21, amp: float = 1500, fc: float | None = None,
              carrier_amp: float = 1500, dt: float = EXCEL_PWM_DT, n: int = EXCEL_PWM_ROWS) -> dict:
    """Reproduz a aba inteira. Defaults = valores salvos no Excel (fc 400 Hz no 2L, 600 Hz no 3L)."""
    if fc is None:
        fc = 400 if level == 2 else 600
    t = excel_time(dt, n)
    ref = sine_reference(t, freq, amp)
    car = triangle_carrier(t, fc, carrier_amp)
    out = pwm_level2_excel(ref, car, carrier_amp) if level == 2 else pwm_level3_excel(ref, car, carrier_amp)
    return {"t": t, "ref": ref, "carrier": car, "pwm": out}


# ---------------------------------------------------------------------------
# Pre-charge
#   A: tempo = (linha-2) * 5/499          (800 linhas)
#   B: ROUND(Vmax*(1-EXP(-t/(R*C))), 0)
#   C: B/Vmax*100
#   D2: tempo para atingir E2 -> IF(E2=Vmax, 8.5, -R*C*LN(1-E2/Vmax))
#   E2: Vmax * percentual / 100
# ---------------------------------------------------------------------------
def precharge_sheet(vmax: float = 3000, r: float = 1000, c: float = 0.001, percent: float = 100,
                    rows: int = 800) -> dict:
    t = np.arange(rows) * 5 / 499
    v = np.round(vmax * (1 - np.exp(-t / (r * c))))
    target_v = vmax * percent / 100
    if target_v >= vmax:
        target_t = 8.5
    else:
        target_t = float(-r * c * np.log(1 - target_v / vmax))
    return {"t": t, "v": v, "pct": v / vmax * 100, "target_t": target_t, "target_v": target_v,
            "tau": r * c}


def precharge_time_to(percent: float, r: float, c: float) -> float:
    if percent >= 100:
        return float("inf")
    return float(-r * c * np.log(1 - percent / 100))


# ---------------------------------------------------------------------------
# Ripple SImulator
#   A: tempo (passo 1e-5, 5000 linhas)
#   B: Vmax*|SIN(2*PI()*100*t)|                       (tensão retificada)
#   C: Vmax*(1-EXP(-t/(R*C)))                         (carga RC "normal")
#   D: IF(B>C, C, D_prev*EXP(-Δt/(R*C)))             (D3 usa B3>D2 -> B3)
#   E: IF(B>C, C, IF(B<D, D, B))                      (curva final)
#   C = 1e-5 * H3, Δt = 1e-7 * H5
# ---------------------------------------------------------------------------
def ripple_sheet(r: float = 325, c_step: float = 4, vmax: float = 3000, dt_step: float = 7,
                 rows: int = 5000, step: float = 1e-5, f_rect: float = 100) -> dict:
    cap = 1e-5 * c_step
    dt_decay = 1e-7 * dt_step
    tau = r * cap
    decay = np.exp(-dt_decay / tau)
    t = np.arange(rows) * step
    b = vmax * np.abs(np.sin(2 * np.pi * f_rect * t))
    c = vmax * (1 - np.exp(-t / tau))
    c[0] = 0.0  # C2 é a constante 0 no Excel
    d = np.zeros(rows)
    # linha 3 (índice 1) tem uma fórmula diferente das demais
    if rows > 1:
        d[1] = b[1] if b[1] > d[0] else d[0] * decay
    for i in range(2, rows):  # recursivo: precisa de laço
        d[i] = c[i] if b[i] > c[i] else d[i - 1] * decay
    e = np.where(b > c, c, np.where(b < d, d, b))
    e[0] = np.nan  # E2 vazio no Excel
    return {"t": t, "rect": b, "charge": c, "cap": d, "final": e, "C": cap, "tau": tau}


# ---------------------------------------------------------------------------
# Indicadores da aba "Converter Simulator"
#   T40 (Speed) = 'PWM Level2'!B2*4/100     T42 (Power) = 'PWM Level2'!C2/1500
# ---------------------------------------------------------------------------
def excel_gauges(freq: float, amp: float) -> dict:
    return {"speed": freq * 4 / 100, "power": amp / 1500}
