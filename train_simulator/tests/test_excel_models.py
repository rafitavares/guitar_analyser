"""Compares the Python port with the cached values of simulator.xlsm.

Run with:  SIMULATOR_XLSM=/path/simulator.xlsm pytest tests
(if the variable is not set, the comparison tests are skipped).
"""
import os

import numpy as np
import pytest

from sim import excel_models as em

XLSM = os.environ.get("SIMULATOR_XLSM")
needs_xlsm = pytest.mark.skipif(not XLSM or not os.path.exists(XLSM), reason="SIMULATOR_XLSM not set")


def _cols(sheet, first_row, cols, last_row):
    import openpyxl
    ws = openpyxl.load_workbook(XLSM, data_only=True, read_only=True)[sheet]
    rows = ws.iter_rows(min_row=first_row, max_row=last_row, values_only=True)
    data = list(zip(*[[r[c] for c in cols] for r in rows]))
    return [np.array(d, dtype=float) for d in data]


@needs_xlsm
@pytest.mark.parametrize("level,sheet", [(2, "PWM Level2"), (3, "PWM Level3")])
def test_pwm_matches_excel(level, sheet):
    b, c, d = _cols(sheet, 3, [1, 2, 3], 1003)
    out = em.pwm_sheet(level)
    np.testing.assert_allclose(out["ref"], b, atol=1e-6)
    np.testing.assert_allclose(out["carrier"], c, atol=1e-6)
    # |B|==|C| ties can flip due to floating-point rounding: allow 0.5 %
    assert np.mean(out["pwm"] != d) < 0.005


@needs_xlsm
def test_precharge_matches_excel():
    a, b = _cols("Pre-charge", 2, [0, 1], 801)
    out = em.precharge_sheet()
    np.testing.assert_allclose(out["t"], a, atol=1e-9)
    np.testing.assert_allclose(out["v"], b, atol=1)


@needs_xlsm
def test_ripple_matches_excel():
    b, c, d, e = _cols("Ripple SImulator", 3, [1, 2, 3, 4], 5001)
    out = em.ripple_sheet()
    np.testing.assert_allclose(out["rect"][1:], b, atol=1e-6)
    np.testing.assert_allclose(out["charge"][1:], c, atol=1e-6)
    np.testing.assert_allclose(out["cap"][1:], d, rtol=1e-9, atol=1e-6)
    np.testing.assert_allclose(out["final"][1:], e, rtol=1e-9, atol=1e-6)


def test_pwm3_levels():
    out = em.pwm_sheet(3)
    assert set(np.unique(out["pwm"])) <= {-1500, -750, 0, 750, 1500}


def test_precharge_time_formula():
    assert em.precharge_sheet(percent=95)["target_t"] == pytest.approx(-1.0 * np.log(0.05))
