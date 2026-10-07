"""Garante que o motor JavaScript (versão arquivo único) reproduz o motor Python."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from sim import excel_models as em
from sim.engine import Simulator

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(not NODE, reason="node não instalado")

SCALARS = ["vdc", "speed", "pos", "f_s", "m", "force", "p_elec", "i_phase", "i_dc", "panto_pos", "flux"]


def run_js(*args):
    out = subprocess.run([NODE, str(ROOT / "tests" / "js_scenario.cjs"), *args], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def run_py(supply, levels, method):
    sim = Simulator()
    sim.command("config", {"supply": supply, "levels": int(levels), "pwm_method": method})
    sim.command("start")
    snaps = []
    for i in range(1, 4001):
        sim.step(0.02)
        if i % 1000 == 0:
            snaps.append(sim.snapshot(True))
    sim.command("stop")
    for _ in range(6000):
        sim.step(0.02)
    snaps.append(sim.snapshot(True))
    return snaps


@pytest.mark.parametrize("supply,levels,method", [("DC", "2", "excel"), ("AC", "3", "excel"),
                                                  ("DC", "3", "classic"), ("AC", "2", "classic")])
def test_engine_matches(supply, levels, method):
    js = run_js(supply, levels, method)["snaps"]
    py = run_py(supply, levels, method)
    for a, b in zip(js, py):
        assert a["phase"] == b["phase"]
        for k in SCALARS:
            assert a[k] == pytest.approx(b[k], rel=1e-6, abs=1e-6), k
        assert [e["msg"] for e in a["events"]] == [e["msg"] for e in b["events"]]
        wa, wb = a["wave"], b["wave"]
        for k in ("t", "ref", "carrier", "uab", "dcv"):
            np.testing.assert_allclose(wa[k], wb[k], atol=0.11, err_msg=k)
        # bordas da comparação PWM podem divergir em empates de ponto flutuante
        assert np.mean(np.array(wa["pwm"]) != np.array(wb["pwm"])) < 0.002
        np.testing.assert_allclose(wa["ia"], wb["ia"], atol=2.0)
        if wb["spec"]:
            assert wa["spec"]["thd_uab"] == pytest.approx(wb["spec"]["thd_uab"], rel=1e-3)
            np.testing.assert_allclose(wa["spec"]["a"], wb["spec"]["a"], atol=0.6)


def test_lab_matches():
    lab = run_js("DC", "2", "excel")["lab"]
    p2 = em.pwm_sheet(2, freq=18, amp=1200)
    np.testing.assert_allclose(lab["pwm2"]["pwm"], p2["pwm"])
    np.testing.assert_allclose(lab["pwm3"]["pwm"], em.pwm_sheet(3)["pwm"])
    pre = em.precharge_sheet(percent=90)
    np.testing.assert_allclose(lab["pre"]["v"], pre["v"])
    assert lab["pre"]["target_t"] == pytest.approx(pre["target_t"])
    rip = em.ripple_sheet(r=500, c_step=6)
    np.testing.assert_allclose(lab["rip"]["final"][1:], rip["final"][::2][1:], atol=0.01)
