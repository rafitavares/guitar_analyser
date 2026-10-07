"""Traction converter simulation engine + train dynamics.

Author: Rafael Tavares

Runs in a background thread (20 ms real-time step, multiplied by the time
scale). All DC link physics follows the Excel sheets:
  - RC pre-charge  -> "Pre-charge" sheet (R = 1000 Ω, C = 1 mF, Vmax = 3000 V)
  - 100 Hz ripple  -> "Ripple SImulator" sheet (rectifier + capacitor)
  - 2/3-level PWM  -> "PWM Level2"/"PWM Level3" sheets
The rest (train, motor, protections) is a simplified but physically consistent model.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field

import numpy as np

from . import excel_models as em

STEPS = [
    "Raise pantograph",
    "Close main circuit breaker (MCB)",
    "Pre-charge DC link (ChCt + Rpre)",
    "Close line contactor (CtL) / open ChCt",
    "DC link stabilization",
    "DC → AC conversion (inverter)",
    "Power to traction motors",
]


@dataclass
class Config:
    supply: str = "DC"            # "DC" = 3 kV DC catenary | "AC" = 25 kV 50 Hz + transformer + 4QC
    levels: int = 2               # 2- or 3-level inverter
    pwm_method: str = "excel"     # "excel" (spreadsheet formulas) | "classic" (2L bipolar / 3L NPC-PD)
    v_cat_dc: float = 3000.0      # DC catenary voltage  (= Excel Max Voltage)
    v_sec_peak_ac: float = 2700.0  # rectified secondary peak (passive AC pre-charge)
    vdc_ref_ac: float = 3000.0    # 4QC reference
    f_grid: float = 50.0
    c_dc: float = 1e-3            # Capacitance (C, Farads) from the Pre-charge sheet
    r_pre: float = 1000.0         # Resistance (R, Ohms) from the Pre-charge sheet
    r_line: float = 0.08
    l_line: float = 0.01          # for the inrush current calculation (Z0 = sqrt(L/C))
    r_ac_eq: float = 0.5          # equivalent transformer + bridge resistance (passive AC)
    r_dis: float = 10_000.0       # DC link discharge resistor
    precharge_pct: float = 95.0
    inrush_trip_a: float = 600.0
    fc_2l: float = 400.0          # 'freq port' from the PWM Level2 sheet
    fc_3l: float = 600.0          # 'freq port' from the PWM Level3 sheet
    # train
    mass_t: float = 200.0
    rot_factor: float = 1.08
    f_max_kn: float = 120.0
    f_brake_kn: float = 120.0
    p_max_mw: float = 1.2
    davis_a: float = 2000.0
    davis_b: float = 30.0
    davis_c: float = 6.0
    v_max_kmh: float = 140.0
    gear: float = 4.8
    wheel_d: float = 0.92
    pole_pairs: int = 2
    slip_nom_hz: float = 2.0
    eta: float = 0.92
    i_mag: float = 80.0
    i_rated: float = 400.0
    f_inv_max: float = 160.0
    target_kmh: float = 100.0
    time_scale: float = 1.0

    @property
    def vnom(self) -> float:
        return self.v_cat_dc if self.supply == "DC" else self.vdc_ref_ac

    @property
    def fc(self) -> float:
        return self.fc_2l if self.levels == 2 else self.fc_3l

    def f_rotor(self, v: float) -> float:
        return v * self.gear / (math.pi * self.wheel_d) * self.pole_pairs

    @property
    def f_base(self) -> float:
        # end of the constant V/f region = base speed (where P_max = F_max * v)
        return self.f_rotor(self.p_max_mw * 1e6 / (self.f_max_kn * 1e3))


@dataclass
class State:
    t: float = 0.0
    mode: str = "auto"            # "auto" | "manual"
    phase: str = "OFF"
    phase_t: float = 0.0
    panto_cmd: bool = False
    panto_pos: float = 0.0
    mcb: bool = False
    chct: bool = False
    ctl: bool = False
    qc_on: bool = False           # 4QC active (AC only)
    inv_on: bool = False
    flux: float = 0.0             # 0..1 motor magnetization
    vdc: float = 0.0
    v_src: float = 0.0            # voltage available at the source (catenary/rectified)
    i_src: float = 0.0
    i_dc: float = 0.0             # inverter current
    i_vlu: float = 0.0
    p_vlu: float = 0.0
    speed: float = 0.0            # m/s
    pos: float = 0.0              # m
    f_s: float = 0.0              # inverter output frequency
    m: float = 0.0                # modulation index
    force: float = 0.0            # electric tractive effort (N)
    force_mech: float = 0.0       # mechanical brake (N, negative)
    p_elec: float = 0.0           # DC link power (W)
    i_phase: float = 0.0          # rms phase current
    phi: float = 0.0
    ctrl: str = "throttle"        # manual: "throttle" | "freq"
    throttle: float = 0.0         # -1..1
    throttle_out: float = 0.0
    f_cmd: float = 0.0
    m_cmd: float = 0.5
    vf_auto: bool = True
    steps: list = field(default_factory=lambda: [0.0] * len(STEPS))
    faults: list = field(default_factory=list)
    spark: float = 0.0
    pc_done_t: float = -1.0
    stop_req: bool = False
    emergency: bool = False


class Simulator:
    TICK = 0.02

    def __init__(self) -> None:
        self.cfg = Config()
        self.s = State()
        self.events: deque = deque(maxlen=200)
        self._seq = 0
        self.lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._running = False

    # ------------------------------------------------------------------ infra
    def start(self) -> None:
        if self._thread:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        nxt = time.perf_counter()
        while self._running:
            with self.lock:
                self.step(self.TICK * self.cfg.time_scale)
            nxt += self.TICK
            time.sleep(max(0.0, nxt - time.perf_counter()))
            if time.perf_counter() - nxt > 0.5:  # fell far behind (debugger, OS sleep)
                nxt = time.perf_counter()

    def log(self, msg: str, level: str = "info") -> None:
        self._seq += 1
        self.events.append({"id": self._seq, "t": round(self.s.t, 2), "msg": msg, "level": level})

    def fault(self, msg: str) -> None:
        if msg not in self.s.faults:
            self.s.faults.append(msg)
        self.log(msg, "fault")

    # --------------------------------------------------------------- commands
    def command(self, cmd: str, value=None) -> None:
        with self.lock:
            s, c = self.s, self.cfg
            if cmd == "start":
                if s.faults:
                    self.log("Acknowledge the faults (RESET) before starting", "warn")
                    return
                s.mode = "auto"
                s.stop_req = False
                if s.phase in ("OFF", "MANUAL", "SHUTDOWN"):
                    self._goto("RAISE_PANTO")
                    self.log("START — automatic sequence started")
                elif s.phase == "BRAKING":
                    self._goto("TRACTION")
            elif cmd == "stop":
                if s.mode == "auto" and s.phase not in ("OFF", "SHUTDOWN", "BRAKING"):
                    if s.inv_on:
                        self._goto("BRAKING")
                    else:
                        self._goto("SHUTDOWN")
                    self.log("STOP — braking and shutdown")
                elif s.mode == "manual":
                    s.throttle = -1.0 if s.speed > 0.1 else 0.0
            elif cmd == "emergency":
                self._emergency()
            elif cmd == "reset":
                self._reset(keep_mode=True)
            elif cmd == "mode":
                if value == "manual" and s.mode != "manual":
                    s.mode = "manual"
                    s.phase = "MANUAL"
                    s.throttle = 0.0
                    s.f_cmd = s.f_s
                    self.log("MANUAL mode — operate the contactors by clicking the diagram")
                elif value == "auto" and s.mode != "auto":
                    s.mode = "auto"
                    if s.inv_on and s.ctl and s.mcb and s.panto_pos >= 1:
                        self._goto("TRACTION")
                    elif s.vdc < 50 and not (s.mcb or s.ctl or s.chct or s.panto_cmd):
                        self._goto("OFF")
                    else:
                        self._goto("SHUTDOWN")
                    self.log("AUTOMATIC mode")
            elif cmd == "toggle":
                self._manual_toggle(str(value))
            elif cmd == "set":
                self._set(value or {})
            elif cmd == "config":
                self._config(value or {})

    def _set(self, kv: dict) -> None:
        s, c = self.s, self.cfg
        for k, v in kv.items():
            if k == "throttle":
                s.throttle = float(np.clip(float(v), -1, 1))
            elif k == "f_cmd":
                s.f_cmd = float(np.clip(float(v), 0, c.f_inv_max))
            elif k == "m_cmd":
                s.m_cmd = float(np.clip(float(v), 0, 1.15))
            elif k == "vf_auto":
                s.vf_auto = bool(v)
            elif k == "ctrl" and v in ("throttle", "freq"):
                if v == "freq":
                    s.f_cmd = s.f_s
                s.ctrl = v
            elif k == "target_kmh":
                c.target_kmh = float(np.clip(float(v), 0, c.v_max_kmh))
            elif k == "time_scale":
                c.time_scale = float(np.clip(float(v), 0.25, 10))

    def _config(self, kv: dict) -> None:
        s, c = self.s, self.cfg
        changed_topology = False
        for k, v in kv.items():
            if k == "supply" and v in ("DC", "AC") and v != c.supply:
                c.supply = v
                changed_topology = True
            elif k == "levels" and int(v) in (2, 3):
                c.levels = int(v)
            elif k == "pwm_method" and v in ("excel", "classic"):
                c.pwm_method = v
            elif k in ("fc_2l", "fc_3l", "v_cat_dc", "precharge_pct", "r_pre", "c_dc", "mass_t", "p_max_mw"):
                setattr(c, k, float(v))
        if changed_topology:
            self._reset(keep_mode=True)
            self.log(f"Power supply topology: {'25 kV 50 Hz AC (transformer + 4QC)' if c.supply == 'AC' else '3 kV DC'}")

    def _manual_toggle(self, what: str) -> None:
        s, c = self.s, self.cfg
        if s.mode != "manual":
            self.log("Switch to MANUAL mode to operate the contactors", "warn")
            return
        if what == "panto":
            s.panto_cmd = not s.panto_cmd
            if not s.panto_cmd and s.mcb and abs(s.i_src) > 20:
                self.log("Pantograph lowered under load — electric arc!", "warn")
                s.spark = 1.0
            self.log("Pantograph " + ("raising" if s.panto_cmd else "lowering"))
        elif what == "mcb":
            if not s.mcb and s.faults:
                self.log("MCB blocked: active faults present (RESET)", "warn")
                return
            s.mcb = not s.mcb
            self.log("MCB " + ("CLOSED" if s.mcb else "OPEN"))
            if not s.mcb:
                s.qc_on = False
        elif what == "chct":
            s.chct = not s.chct
            self.log("ChCt (pre-charge) " + ("CLOSED" if s.chct else "OPEN"))
        elif what == "ctl":
            if not s.ctl:
                self._close_ctl()
            else:
                s.ctl = False
                s.qc_on = False
                self.log("CtL OPEN")
        elif what == "qc":
            if c.supply != "AC":
                return
            if not s.qc_on and not (s.ctl and s.mcb and s.panto_pos >= 1 and s.vdc > 0.8 * s.v_src):
                self.log("4QC requires CtL closed and DC link charged", "warn")
                return
            s.qc_on = not s.qc_on
            self.log("4QC " + ("ON" if s.qc_on else "OFF"))
        elif what == "inv":
            if not s.inv_on:
                if s.vdc < 0.6 * c.vnom:
                    self.log(f"Inverter blocked: DC link at {s.vdc:.0f} V (< 60 %)", "warn")
                    return
                s.inv_on = True
                s.f_cmd = s.f_s
                self.log("Inverter ENABLED (pulses released)")
            else:
                s.inv_on = False
                self.log("Inverter DISABLED")

    def _close_ctl(self) -> None:
        s, c = self.s, self.cfg
        s.ctl = True
        self.log("CtL CLOSED")
        if s.panto_pos >= 1 and s.mcb:
            dv = s.v_src - s.vdc
            i_pk = dv / math.sqrt(c.l_line / c.c_dc)
            if i_pk > 100:
                self.log(f"Inrush current when closing CtL: {i_pk:.0f} A (ΔV = {dv:.0f} V)",
                         "warn" if i_pk < c.inrush_trip_a else "fault")
            if i_pk > c.inrush_trip_a:
                s.mcb = False
                s.vdc += 0.5 * dv
                self.fault(f"MCB tripped on inrush overcurrent ({i_pk:.0f} A) — pre-charge first!")

    def _emergency(self) -> None:
        s = self.s
        s.emergency = True
        s.inv_on = s.qc_on = s.ctl = s.chct = s.mcb = False
        s.panto_cmd = False
        s.throttle = 0.0
        if s.mode == "auto":
            s.phase = "EMERGENCY"
        self.fault("EMERGENCY — everything open, full mechanical brake")

    def _reset(self, keep_mode: bool = False) -> None:
        mode = self.s.mode
        pos = self.s.pos
        moving = self.s.speed > 0.1
        if moving:
            self.log("RESET is only possible with the train at standstill", "warn")
            return
        cfg = self.cfg
        self.s = State()
        self.s.pos = pos
        if keep_mode:
            self.s.mode = mode
            self.s.phase = "MANUAL" if mode == "manual" else "OFF"
        self.cfg = cfg
        self.log("RESET")

    def _goto(self, phase: str) -> None:
        self.s.phase = phase
        self.s.phase_t = 0.0

    # --------------------------------------------------------------- sequence
    def _sequence(self, dt: float) -> None:
        s, c = self.s, self.cfg
        s.phase_t += dt
        p, pt = s.phase, s.phase_t
        st = s.steps
        if p == "RAISE_PANTO":
            s.panto_cmd = True
            st[0] = s.panto_pos * 100
            if s.panto_pos >= 1 and pt > 3.2:
                self.log("Pantograph in contact with the catenary")
                self._goto("CLOSE_MCB")
        elif p == "CLOSE_MCB":
            if pt >= 1.0 and not s.mcb:
                s.mcb = True
                st[1] = 100
                self.log("MCB CLOSED")
            if pt >= 2.0:
                self._goto("PRECHARGE")
        elif p == "PRECHARGE":
            if not s.chct:
                s.chct = True
                self.log(f"ChCt CLOSED — pre-charge via Rpre = {c.r_pre:.0f} Ω (τ = {c.r_pre * c.c_dc:.2f} s)")
            target = c.precharge_pct / 100 * s.v_src
            st[2] = min(100.0, s.vdc / max(target, 1) * 100)
            if s.vdc >= target:
                if s.pc_done_t < 0:
                    s.pc_done_t = pt
                    self.log(f"DC link pre-charged: {s.vdc:.0f} V ({s.vdc / s.v_src * 100:.1f} %) in {pt:.2f} s")
                if pt - s.pc_done_t >= 0.5:
                    s.pc_done_t = -1.0
                    self._goto("CLOSE_CTL")
            elif pt > 20:
                self.fault("Pre-charge timeout (check Rpre / line voltage)")
        elif p == "CLOSE_CTL":
            if not s.ctl:
                self._close_ctl()
                st[3] = 50
            if pt >= 0.6 and s.chct:
                s.chct = False
                st[3] = 100
                self.log("ChCt OPEN — Rpre out of circuit")
            if pt >= 1.2:
                self._goto("STABILIZE")
        elif p == "STABILIZE":
            if c.supply == "AC" and not s.qc_on:
                s.qc_on = True
                self.log(f"4QC on — regulating DC link at {c.vdc_ref_ac:.0f} V")
            err = abs(s.vdc - c.vnom) / c.vnom if c.supply == "AC" else 0.0
            st[4] = min(100.0, pt / 1.5 * 100)
            if pt >= 1.5 and err < 0.02:
                st[4] = 100
                self.log(f"DC link stable at {s.vdc:.0f} V")
                self._goto("INVERTER")
        elif p == "INVERTER":
            if not s.inv_on:
                s.inv_on = True
                self.log("Inverter enabled — magnetizing motors")
            st[5] = s.flux * 100
            if s.flux >= 0.99:
                self._goto("TRACTION")
                self.log(f"Traction released — target {c.target_kmh:.0f} km/h")
        elif p == "TRACTION":
            st[5] = 100
            st[6] = 100
            # P speed controller with jerk limit
            err = c.target_kmh - s.speed * 3.6
            want = float(np.clip(err / 4.0, -0.7, 1.0))
            s.throttle += float(np.clip(want - s.throttle, -0.6 * dt, 0.6 * dt))
        elif p == "BRAKING":
            st[6] = 0
            s.throttle += float(np.clip(-0.8 - s.throttle, -0.6 * dt, 0.6 * dt))
            if s.speed < 0.05:
                s.throttle = 0
                self.log("Train stopped")
                self._goto("SHUTDOWN")
        elif p == "SHUTDOWN":
            s.throttle = 0
            if s.inv_on or s.qc_on:
                s.inv_on = s.qc_on = False
                self.log("Inverter and 4QC off")
            if pt >= 0.6 and s.ctl:
                s.ctl = False
                self.log("CtL OPEN")
            if pt >= 1.4 and s.mcb:
                s.mcb = False
                self.log("MCB OPEN")
            if pt >= 2.2:
                s.panto_cmd = False
            s.steps = [0.0] * len(STEPS) if pt >= 2.2 else [x if i < 5 else 0 for i, x in enumerate(st)]
            if pt >= 2.2 and s.panto_pos <= 0:
                self.log("Pantograph lowered — system off")
                self._goto("OFF")

    # ----------------------------------------------------------------- physics
    def step(self, dt: float) -> None:
        s, c = self.s, self.cfg
        s.t += dt
        if s.mode == "auto":
            self._sequence(dt)
        s.spark = max(0.0, s.spark - dt * 2)

        # pantograph: 3 s to raise, 2 s to lower
        if s.panto_cmd:
            s.panto_pos = min(1.0, s.panto_pos + dt / 3.0)
        else:
            s.panto_pos = max(0.0, s.panto_pos - dt / 2.0)
        live = s.panto_pos >= 1.0 and s.mcb
        if s.mcb and s.panto_pos < 1.0 and s.panto_cmd is False and abs(s.i_src) > 20:
            s.spark = 1.0
        s.v_src = (c.v_cat_dc if c.supply == "DC" else c.v_sec_peak_ac) if live else 0.0
        if c.supply == "AC" and s.qc_on and not (live and s.ctl):
            s.qc_on = False
            self.log("4QC off (loss of supply)", "warn")

        # magnetization
        s.flux = min(1.0, s.flux + dt / 1.0) if s.inv_on else max(0.0, s.flux - dt / 0.3)

        self._traction(dt)

        # current drawn by the inverter from the DC link
        s.i_dc = s.p_elec / s.vdc if s.vdc > 100 else 0.0
        self._dc_link(dt)

        # protections
        if s.inv_on and s.vdc < 0.5 * c.vnom:
            s.inv_on = False
            self.fault(f"DC link undervoltage ({s.vdc:.0f} V) — inverter blocked")
        if s.emergency and s.panto_pos <= 0 and s.speed <= 0:
            s.emergency = False

    def _traction(self, dt: float) -> None:
        s, c = self.s, self.cfg
        v = s.speed
        f_rot = c.f_rotor(v)
        fmax = c.f_max_kn * 1e3
        vratio = float(np.clip(s.vdc / c.vnom, 0, 1.1)) if c.vnom else 0
        p_avail = c.p_max_mw * 1e6 * min(1.0, vratio)
        f_avail = min(fmax, p_avail / max(v, 0.1))
        f_elec = 0.0
        f_mech = 0.0
        ok = s.inv_on and s.flux > 0.05

        if s.mode == "manual" and s.ctrl == "freq":
            # commanded frequency ramp (10 Hz/s), torque from slip
            if ok:
                s.f_s += float(np.clip(s.f_cmd - s.f_s, -10 * dt, 10 * dt))
            else:
                s.f_s = f_rot if s.inv_on else 0.0
            m_vf = self._m_vf(s.f_s)
            s.m = m_vf if s.vf_auto else s.m_cmd
            flux_ratio = float(np.clip(s.m / max(m_vf, 1e-3), 0, 1.3)) * s.flux
            slip = s.f_s - f_rot
            if ok:
                f_elec = fmax * float(np.clip(slip / c.slip_nom_hz, -1.3, 1.3)) * min(1.0, flux_ratio) ** 2
                f_elec = float(np.clip(f_elec, -f_avail * 1.1, f_avail * 1.1))
            s.throttle_out = f_elec / fmax
        else:
            thr = s.throttle
            if s.mode == "manual" and v * 3.6 >= c.v_max_kmh and thr > 0:
                thr = 0.0  # overspeed protection
            if s.emergency:
                f_mech = -1.2 * c.mass_t * 1e3
            elif ok and thr >= 0:
                f_elec = thr * f_avail * s.flux
            elif thr < 0:
                demand = -thr * c.f_brake_kn * 1e3
                fade = float(np.clip(v / 1.5, 0, 1))
                e_part = min(demand, min(c.f_brake_kn * 1e3, p_avail / max(v, 0.1))) * fade if ok else 0.0
                f_elec = -e_part
                f_mech = -(demand - e_part)
            s.throttle_out = thr
            slip = c.slip_nom_hz * (f_elec / fmax) * max(1.0, f_rot / c.f_base) if ok else 0.0
            if s.inv_on:
                s.f_s = max(0.0, f_rot + slip) if ok else 0.0
                s.m = self._m_vf(s.f_s) * s.flux
            else:
                s.f_s = 0.0
                s.m = 0.0
        if not s.inv_on:
            s.f_s = s.m = f_elec = 0.0

        # longitudinal dynamics
        resist = (c.davis_a + c.davis_b * v + c.davis_c * v * v) if v > 0.01 else 0.0
        m_eff = c.mass_t * 1e3 * c.rot_factor
        f_total = f_elec + f_mech - resist
        if v <= 0.0 and f_total < 0:  # at standstill: static friction/brake holds
            f_total = 0.0
        v_new = max(0.0, v + f_total / m_eff * dt)
        s.pos += 0.5 * (v + v_new) * dt
        s.speed = v_new
        s.force = f_elec
        s.force_mech = f_mech

        # power and currents
        p_mech = f_elec * v
        p_loss_mag = 12e3 * s.flux if s.inv_on else 0.0
        s.p_elec = (p_mech / c.eta if p_mech >= 0 else p_mech * c.eta) + p_loss_mag
        fw = max(1.0, s.f_s / c.f_base) if c.f_base else 1.0
        i_t = c.i_rated * (f_elec / fmax) * fw
        i_m = c.i_mag * s.flux / fw if s.inv_on else 0.0
        s.i_phase = math.hypot(i_t, i_m)
        s.phi = math.atan2(i_m, i_t) if s.i_phase > 1 else 0.0

    def _m_vf(self, f: float) -> float:
        c = self.cfg
        m0 = 0.03
        return float(min(1.0, m0 + (1 - m0) * f / c.f_base)) if c.f_base else 0.0

    def _dc_link(self, dt: float) -> None:
        s, c = self.s, self.cfg
        C = c.c_dc
        i_load = s.i_dc
        live = s.v_src > 0
        r = None
        if live and (s.ctl or s.chct):
            if s.ctl and c.supply == "DC":
                r = c.r_line if not s.chct else (c.r_line * c.r_pre) / (c.r_line + c.r_pre)
            elif s.ctl and c.supply == "AC":
                r = c.r_ac_eq
            else:
                r = c.r_pre
        v0 = s.vdc
        if c.supply == "AC" and s.qc_on:
            # 4QC regulates the voltage (τ = 150 ms) and supplies/absorbs the load power
            s.vdc = c.vdc_ref_ac + (s.vdc - c.vdc_ref_ac) * math.exp(-dt / 0.15)
            s.i_src = i_load + C * (s.vdc - v0) / dt
        elif r is not None:
            tau = r * C
            v_inf = s.v_src - i_load * r
            if c.supply == "AC" and v_inf < s.vdc:
                # diode bridge: cannot return energy, DC link only discharges through the load
                s.vdc = max(0.0, s.vdc - i_load * dt / C)
                s.i_src = 0.0
            else:
                s.vdc = v_inf + (s.vdc - v_inf) * math.exp(-dt / tau)
                s.i_src = (s.v_src - s.vdc) / r
        else:
            # isolated: load + discharge resistor
            s.vdc = max(0.0, s.vdc * math.exp(-dt / (c.r_dis * C)) - i_load * dt / C)
            s.i_src = 0.0
        # VLU / brake chopper clamps the overvoltage
        v_lim = 1.17 * c.vnom
        if s.vdc > v_lim:
            e = 0.5 * C * (s.vdc ** 2 - v_lim ** 2)
            s.p_vlu = e / dt
            s.i_vlu = s.p_vlu / v_lim
            s.vdc = v_lim
        else:
            s.p_vlu = 0.0
            s.i_vlu = 0.0

    # --------------------------------------------------------------- snapshot
    def snapshot(self, wave: bool = False) -> dict:
        with self.lock:
            s, c = self.s, self.cfg
            d = asdict(s)
            d["steps"] = [round(x, 1) for x in s.steps]
            d["step_names"] = STEPS
            d["speed_kmh"] = s.speed * 3.6
            d["f_rotor"] = c.f_rotor(s.speed)
            d["p_src"] = s.v_src * s.i_src if c.supply == "DC" else s.vdc * s.i_src
            d["cfg"] = {**asdict(c), "vnom": c.vnom, "fc": c.fc, "f_base": c.f_base}
            d["excel"] = em.excel_gauges(s.f_s, s.m * 1500)
            d["events"] = list(self.events)[-40:]
            if wave:
                d["wave"] = self._waves()
            return d

    def _waves(self) -> dict:
        s, c = self.s, self.cfg
        vdc = s.vdc
        vlevel = vdc / 2
        f = s.f_s
        fc = c.fc
        W = 0.1 if f < 21 else min(0.1, max(0.02, 2.1 / f))
        n = 2000
        t = np.linspace(0, W, n, endpoint=False)
        amp = s.m * vlevel if s.inv_on else 0.0
        refs = [em.sine_reference(t, f, amp, -k * 2 * np.pi / 3) for k in range(3)]
        carrier = em.triangle_carrier(t, fc, vlevel)
        pwms = [self._modulate(r, t, carrier, vlevel) for r in refs] if s.inv_on else [np.zeros(n)] * 3
        uab = pwms[0] - pwms[1]

        # currents: sine lagging by phi + switching ripple (L_sigma = 10 mH)
        ipk = s.i_phase * math.sqrt(2)
        L = 0.01
        dtt = t[1] - t[0]
        currents = []
        for k in range(3):
            base = ipk * np.sin(2 * np.pi * f * t - k * 2 * np.pi / 3 - s.phi)
            if s.inv_on and amp > 0:
                # ripple: integrates the difference between switched voltage and fundamental
                rip = np.cumsum((pwms[k] - refs[k]) * dtt) / L
                rip -= np.convolve(rip, np.ones(51) / 51, mode="same")
                base = base + rip * 0.5
            currents.append(base)

        spec = self._spectrum(vlevel, s.m * vlevel, f) if s.inv_on and f >= 1 else None
        dct, dcv = self._dc_zoom()
        r = lambda a, nd=1: np.round(a, nd).tolist()  # noqa: E731
        return {
            "t": r(t * 1000, 3), "ref": r(refs[0]), "carrier": r(carrier),
            "pwm": r(pwms[0]), "uab": r(uab),
            "ia": r(currents[0]), "ib": r(currents[1]), "ic": r(currents[2]),
            "spec": spec, "dct": r(dct * 1000, 3), "dcv": r(dcv),
        }

    def _modulate(self, ref, t, carrier, vlevel):
        c = self.cfg
        if c.pwm_method == "excel":
            return em.pwm_level2_excel(ref, carrier, vlevel) if c.levels == 2 else em.pwm_level3_excel(ref, carrier, vlevel)
        if c.levels == 2:
            return em.pwm_bipolar(ref, t, c.fc, vlevel)
        # 3-level NPC, phase disposition: upper carrier 0..V and lower carrier -V..0
        up = carrier
        lo = carrier - vlevel
        return np.where(ref > up, vlevel, np.where(ref < lo, -vlevel, 0.0))

    def _spectrum(self, vlevel, amp, f):
        c = self.cfg
        periods = max(1, round(0.2 * f))
        T = periods / f
        n = 16384
        t = np.arange(n) * T / n
        ref_a = amp * np.sin(2 * np.pi * f * t)
        ref_b = amp * np.sin(2 * np.pi * f * t - 2 * np.pi / 3)
        car = em.triangle_carrier(t, c.fc, vlevel)
        pa = self._modulate(ref_a, t, car, vlevel)
        pb = self._modulate(ref_b, t, car, vlevel)
        uab = pa - pb

        def mag(x):
            X = np.abs(np.fft.rfft(x)) * 2 / n
            X[0] /= 2
            return X

        A, P = mag(uab), mag(pa)
        k = periods

        def thd(X):
            fund = X[k]
            if fund < 1e-6:
                return None
            rest = np.sqrt(np.sum(X[1:] ** 2) - fund ** 2)
            return float(rest / fund * 100)

        df = 1 / T
        fmax_show = min(3.3 * c.fc, (n / 2 - 1) * df)
        nb = int(fmax_show / df)
        return {"f": np.round(np.arange(1, nb) * df, 2).tolist(), "a": np.round(A[1:nb], 1).tolist(),
                "thd_uab": thd(A), "thd_pwm": thd(P), "fund_uab": float(A[k]), "fund_pwm": float(P[k])}

    def _dc_zoom(self):
        """40 ms of the DC link at high resolution (dynamic equivalent of the Ripple SImulator sheet)."""
        s, c = self.s, self.cfg
        n = 2000
        W = 0.04
        t = np.linspace(0, W, n, endpoint=False)
        dt = W / n
        v0 = s.vdc
        if c.supply == "AC" and s.v_src > 0 and (s.ctl or s.chct) and not s.qc_on:
            # diode rectifier + capacitor: v' = max(0, |vs|-v)/(R C) - i/C
            r = c.r_ac_eq if s.ctl else c.r_pre
            vs = s.v_src * np.abs(np.sin(2 * np.pi * c.f_grid * t))
            v = np.empty(n)
            x = v0
            # pre-run one cycle to reach steady state
            for _ in range(2):
                for i in range(n):
                    x += (max(0.0, vs[i] - x) / (r * c.c_dc) - s.i_dc / c.c_dc) * dt
                    x = max(x, 0.0)
                    v[i] = x
                if r > 10:  # slow pre-charge: show only the real evolution
                    break
                x = v[-1] if abs(v[-1] - v0) < 0.2 * max(v0, 1) else v0
            return t, v
        if c.supply == "AC" and s.qc_on:
            w = 2 * np.pi * c.f_grid
            dv = min(abs(s.p_elec) / (2 * w * c.c_dc * max(v0, 1)), 0.3 * v0) + 0.004 * v0
            sw = 0.002 * v0 * np.sin(2 * np.pi * 2 * c.fc * t) * (1 if s.inv_on else 0)
            return t, v0 + dv * np.sin(2 * w * t) + sw
        if v0 > 1 and s.inv_on:
            rip = 0.003 * v0 * abs(s.p_elec) / (c.p_max_mw * 1e6) * np.sin(2 * np.pi * 6 * max(s.f_s, 1) * t)
            rip += 0.0015 * v0 * np.sin(2 * np.pi * 2 * c.fc * t)
            return t, v0 + rip
        return t, np.full(n, v0)


SIM = Simulator()
