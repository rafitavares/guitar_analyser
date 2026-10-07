// JavaScript version of sim/excel_models.py + sim/engine.py, used by the
// single-file build (runs entirely in the browser, no Python server).
// Keep in sync with the Python files: tests/test_js_port.py compares both.
// Author: Rafael Tavares
(function (global) {
  "use strict";
  const PI = Math.PI;
  const clip = (x, a, b) => Math.min(b, Math.max(a, x));
  const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / n); // endpoint=False

  // ======================================================== excel_models
  const EM = {
    EXCEL_PWM_DT: 1e-4,
    EXCEL_PWM_ROWS: 1001,
    sineReference: (t, f, amp, ph = 0) => t.map((x) => amp * Math.sin(2 * PI * f * x + ph)),
    triangleCarrier: (t, fc, amp) => t.map((x) => { const y = x * fc; return amp * (1 - 2 * Math.abs((y - Math.floor(y)) - 0.5)); }),
    pwmLevel2Excel(ref, car, V = 1500) {
      return ref.map((r, i) => { const on = Math.abs(r) > Math.abs(car[i]); return r > 0 ? (on ? V : 0) : (on ? -V : 0); });
    },
    pwmLevel3Excel(ref, car, V = 1500) {
      const h = V / 2;
      return ref.map((r, i) => {
        const on = Math.abs(r) > Math.abs(car[i]);
        if (r > 0) return r >= h ? (on ? V : h) : (on ? h : 0);
        return Math.abs(r) >= h ? (on ? -V : -h) : (on ? -h : 0);
      });
    },
    pwmBipolar(ref, t, fc, V) {
      const car = EM.triangleCarrier(t, fc, V);
      return ref.map((r, i) => (r > 2 * car[i] - V ? V : -V));
    },
    pwmSheet(level, freq = 21, amp = 1500, fc = null, ca = 1500, dt = 1e-4, n = 1001) {
      if (fc == null) fc = level === 2 ? 400 : 600;
      const t = Array.from({ length: n }, (_, i) => i * dt);
      const ref = EM.sineReference(t, freq, amp);
      const carrier = EM.triangleCarrier(t, fc, ca);
      const pwm = level === 2 ? EM.pwmLevel2Excel(ref, carrier, ca) : EM.pwmLevel3Excel(ref, carrier, ca);
      return { t, ref, carrier, pwm };
    },
    prechargeSheet(vmax = 3000, r = 1000, c = 0.001, percent = 100, rows = 800) {
      const t = Array.from({ length: rows }, (_, i) => i * 5 / 499);
      const v = t.map((x) => Math.round(vmax * (1 - Math.exp(-x / (r * c)))));
      const target_v = vmax * percent / 100;
      const target_t = target_v >= vmax ? 8.5 : -r * c * Math.log(1 - target_v / vmax);
      return { t, v, pct: v.map((x) => x / vmax * 100), target_t, target_v, tau: r * c };
    },
    rippleSheet(r = 325, cStep = 4, vmax = 3000, dtStep = 7, rows = 5000, step = 1e-5, fRect = 100) {
      const cap = 1e-5 * cStep, tau = r * cap, decay = Math.exp(-(1e-7 * dtStep) / tau);
      const t = Array.from({ length: rows }, (_, i) => i * step);
      const b = t.map((x) => vmax * Math.abs(Math.sin(2 * PI * fRect * x)));
      const c = t.map((x) => vmax * (1 - Math.exp(-x / tau))); c[0] = 0;
      const d = new Array(rows).fill(0);
      if (rows > 1) d[1] = b[1] > d[0] ? b[1] : d[0] * decay;
      for (let i = 2; i < rows; i++) d[i] = b[i] > c[i] ? c[i] : d[i - 1] * decay;
      const e = b.map((x, i) => (x > c[i] ? c[i] : x < d[i] ? d[i] : x)); e[0] = NaN;
      return { t, rect: b, charge: c, cap: d, final: e, C: cap, tau };
    },
    excelGauges: (freq, amp) => ({ speed: freq * 4 / 100, power: amp / 1500 }),
  };

  // Radix-2 FFT (n power of 2) -> rfft magnitude
  function rfftMag(x) {
    const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    const out = new Float64Array(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(re[k], im[k]);
    return out;
  }

  // ================================================================ engine
  const STEPS = [
    "Raise pantograph", "Close main circuit breaker (MCB)", "Pre-charge DC link (ChCt + Rpre)",
    "Close line contactor (CtL) / open ChCt", "DC link stabilization", "DC → AC conversion (inverter)",
    "Power to traction motors",
  ];

  function newConfig() {
    return {
      supply: "DC", levels: 2, pwm_method: "excel", v_cat_dc: 3000, v_sec_peak_ac: 2700, vdc_ref_ac: 3000,
      f_grid: 50, c_dc: 1e-3, r_pre: 1000, r_line: 0.08, l_line: 0.01, r_ac_eq: 0.5, r_dis: 10000,
      precharge_pct: 95, inrush_trip_a: 600, fc_2l: 400, fc_3l: 600, mass_t: 200, rot_factor: 1.08,
      f_max_kn: 120, f_brake_kn: 120, p_max_mw: 1.2, davis_a: 2000, davis_b: 30, davis_c: 6, v_max_kmh: 140,
      gear: 4.8, wheel_d: 0.92, pole_pairs: 2, slip_nom_hz: 2, eta: 0.92, i_mag: 80, i_rated: 400,
      f_inv_max: 160, target_kmh: 100, time_scale: 1,
    };
  }
  const vnom = (c) => (c.supply === "DC" ? c.v_cat_dc : c.vdc_ref_ac);
  const fcOf = (c) => (c.levels === 2 ? c.fc_2l : c.fc_3l);
  const fRotor = (c, v) => v * c.gear / (PI * c.wheel_d) * c.pole_pairs;
  const fBase = (c) => fRotor(c, c.p_max_mw * 1e6 / (c.f_max_kn * 1e3));

  function newState() {
    return {
      t: 0, mode: "auto", phase: "OFF", phase_t: 0, panto_cmd: false, panto_pos: 0, mcb: false, chct: false,
      ctl: false, qc_on: false, inv_on: false, flux: 0, vdc: 0, v_src: 0, i_src: 0, i_dc: 0, i_vlu: 0, p_vlu: 0,
      speed: 0, pos: 0, f_s: 0, m: 0, force: 0, force_mech: 0, p_elec: 0, i_phase: 0, phi: 0, ctrl: "throttle",
      throttle: 0, throttle_out: 0, f_cmd: 0, m_cmd: 0.5, vf_auto: true, steps: STEPS.map(() => 0), faults: [],
      spark: 0, pc_done_t: -1, stop_req: false, emergency: false,
    };
  }

  class Simulator {
    constructor() { this.cfg = newConfig(); this.s = newState(); this.events = []; this.seq = 0; this.TICK = 0.02; }

    start() {
      if (this.timer) return;
      let last = performance.now(), acc = 0;
      this.timer = setInterval(() => {
        const now = performance.now();
        acc += Math.min(0.5, (now - last) / 1000);
        last = now;
        while (acc >= this.TICK) { this.step(this.TICK * this.cfg.time_scale); acc -= this.TICK; }
      }, 20);
    }

    log(msg, level = "info") {
      this.seq++;
      this.events.push({ id: this.seq, t: Math.round(this.s.t * 100) / 100, msg, level });
      if (this.events.length > 200) this.events.shift();
    }
    fault(msg) { if (!this.s.faults.includes(msg)) this.s.faults.push(msg); this.log(msg, "fault"); }
    goto(p) { this.s.phase = p; this.s.phase_t = 0; }

    // ------------------------------------------------------------ commands
    command(cmd, value) {
      const s = this.s;
      if (cmd === "start") {
        if (s.faults.length) { this.log("Acknowledge the faults (RESET) before starting", "warn"); return; }
        s.mode = "auto"; s.stop_req = false;
        if (["OFF", "MANUAL", "SHUTDOWN"].includes(s.phase)) { this.goto("RAISE_PANTO"); this.log("START — automatic sequence started"); }
        else if (s.phase === "BRAKING") this.goto("TRACTION");
      } else if (cmd === "stop") {
        if (s.mode === "auto" && !["OFF", "SHUTDOWN", "BRAKING"].includes(s.phase)) {
          this.goto(s.inv_on ? "BRAKING" : "SHUTDOWN");
          this.log("STOP — braking and shutdown");
        } else if (s.mode === "manual") s.throttle = s.speed > 0.1 ? -1 : 0;
      } else if (cmd === "emergency") this.emergency();
      else if (cmd === "reset") this.reset(true);
      else if (cmd === "mode") {
        if (value === "manual" && s.mode !== "manual") {
          s.mode = "manual"; s.phase = "MANUAL"; s.throttle = 0; s.f_cmd = s.f_s;
          this.log("MANUAL mode — operate the contactors by clicking the diagram");
        } else if (value === "auto" && s.mode !== "auto") {
          s.mode = "auto";
          if (s.inv_on && s.ctl && s.mcb && s.panto_pos >= 1) this.goto("TRACTION");
          else if (s.vdc < 50 && !(s.mcb || s.ctl || s.chct || s.panto_cmd)) this.goto("OFF");
          else this.goto("SHUTDOWN");
          this.log("AUTOMATIC mode");
        }
      } else if (cmd === "toggle") this.toggle(String(value));
      else if (cmd === "set") this.set(value || {});
      else if (cmd === "config") this.config(value || {});
    }

    set(kv) {
      const s = this.s, c = this.cfg;
      for (const [k, v] of Object.entries(kv)) {
        if (k === "throttle") s.throttle = clip(+v, -1, 1);
        else if (k === "f_cmd") s.f_cmd = clip(+v, 0, c.f_inv_max);
        else if (k === "m_cmd") s.m_cmd = clip(+v, 0, 1.15);
        else if (k === "vf_auto") s.vf_auto = !!v;
        else if (k === "ctrl" && (v === "throttle" || v === "freq")) { if (v === "freq") s.f_cmd = s.f_s; s.ctrl = v; }
        else if (k === "target_kmh") c.target_kmh = clip(+v, 0, c.v_max_kmh);
        else if (k === "time_scale") c.time_scale = clip(+v, 0.25, 10);
      }
    }

    config(kv) {
      const c = this.cfg;
      let topo = false;
      for (const [k, v] of Object.entries(kv)) {
        if (k === "supply" && (v === "DC" || v === "AC") && v !== c.supply) { c.supply = v; topo = true; }
        else if (k === "levels" && (+v === 2 || +v === 3)) c.levels = +v;
        else if (k === "pwm_method" && (v === "excel" || v === "classic")) c.pwm_method = v;
        else if (["fc_2l", "fc_3l", "v_cat_dc", "precharge_pct", "r_pre", "c_dc", "mass_t", "p_max_mw"].includes(k)) c[k] = +v;
      }
      if (topo) {
        this.reset(true);
        this.log("Power supply topology: " + (c.supply === "AC" ? "25 kV 50 Hz AC (transformer + 4QC)" : "3 kV DC"));
      }
    }

    toggle(what) {
      const s = this.s, c = this.cfg;
      if (s.mode !== "manual") { this.log("Switch to MANUAL mode to operate the contactors", "warn"); return; }
      if (what === "panto") {
        s.panto_cmd = !s.panto_cmd;
        if (!s.panto_cmd && s.mcb && Math.abs(s.i_src) > 20) { this.log("Pantograph lowered under load — electric arc!", "warn"); s.spark = 1; }
        this.log("Pantograph " + (s.panto_cmd ? "raising" : "lowering"));
      } else if (what === "mcb") {
        if (!s.mcb && s.faults.length) { this.log("MCB blocked: active faults present (RESET)", "warn"); return; }
        s.mcb = !s.mcb;
        this.log("MCB " + (s.mcb ? "CLOSED" : "OPEN"));
        if (!s.mcb) s.qc_on = false;
      } else if (what === "chct") {
        s.chct = !s.chct;
        this.log("ChCt (pre-charge) " + (s.chct ? "CLOSED" : "OPEN"));
      } else if (what === "ctl") {
        if (!s.ctl) this.closeCtl();
        else { s.ctl = false; s.qc_on = false; this.log("CtL OPEN"); }
      } else if (what === "qc") {
        if (c.supply !== "AC") return;
        if (!s.qc_on && !(s.ctl && s.mcb && s.panto_pos >= 1 && s.vdc > 0.8 * s.v_src)) { this.log("4QC requires CtL closed and DC link charged", "warn"); return; }
        s.qc_on = !s.qc_on;
        this.log("4QC " + (s.qc_on ? "ON" : "OFF"));
      } else if (what === "inv") {
        if (!s.inv_on) {
          if (s.vdc < 0.6 * vnom(c)) { this.log(`Inverter blocked: DC link at ${s.vdc.toFixed(0)} V (< 60 %)`, "warn"); return; }
          s.inv_on = true; s.f_cmd = s.f_s;
          this.log("Inverter ENABLED (pulses released)");
        } else { s.inv_on = false; this.log("Inverter DISABLED"); }
      }
    }

    closeCtl() {
      const s = this.s, c = this.cfg;
      s.ctl = true;
      this.log("CtL CLOSED");
      if (s.panto_pos >= 1 && s.mcb) {
        const dv = s.v_src - s.vdc, ipk = dv / Math.sqrt(c.l_line / c.c_dc);
        if (ipk > 100) this.log(`Inrush current when closing CtL: ${ipk.toFixed(0)} A (ΔV = ${dv.toFixed(0)} V)`, ipk < c.inrush_trip_a ? "warn" : "fault");
        if (ipk > c.inrush_trip_a) {
          s.mcb = false; s.vdc += 0.5 * dv;
          this.fault(`MCB tripped on inrush overcurrent (${ipk.toFixed(0)} A) — pre-charge first!`);
        }
      }
    }

    emergency() {
      const s = this.s;
      s.emergency = true;
      s.inv_on = s.qc_on = s.ctl = s.chct = s.mcb = false;
      s.panto_cmd = false; s.throttle = 0;
      if (s.mode === "auto") s.phase = "EMERGENCY";
      this.fault("EMERGENCY — everything open, full mechanical brake");
    }

    reset(keepMode) {
      const mode = this.s.mode, pos = this.s.pos;
      if (this.s.speed > 0.1) { this.log("RESET is only possible with the train at standstill", "warn"); return; }
      this.s = newState();
      this.s.pos = pos;
      if (keepMode) { this.s.mode = mode; this.s.phase = mode === "manual" ? "MANUAL" : "OFF"; }
      this.log("RESET");
    }

    // ----------------------------------------------------------- sequence
    sequence(dt) {
      const s = this.s, c = this.cfg;
      s.phase_t += dt;
      const p = s.phase, pt = s.phase_t, st = s.steps;
      if (p === "RAISE_PANTO") {
        s.panto_cmd = true; st[0] = s.panto_pos * 100;
        if (s.panto_pos >= 1 && pt > 3.2) { this.log("Pantograph in contact with the catenary"); this.goto("CLOSE_MCB"); }
      } else if (p === "CLOSE_MCB") {
        if (pt >= 1 && !s.mcb) { s.mcb = true; st[1] = 100; this.log("MCB CLOSED"); }
        if (pt >= 2) this.goto("PRECHARGE");
      } else if (p === "PRECHARGE") {
        if (!s.chct) { s.chct = true; this.log(`ChCt CLOSED — pre-charge via Rpre = ${c.r_pre.toFixed(0)} Ω (τ = ${(c.r_pre * c.c_dc).toFixed(2)} s)`); }
        const target = c.precharge_pct / 100 * s.v_src;
        st[2] = Math.min(100, s.vdc / Math.max(target, 1) * 100);
        if (s.vdc >= target) {
          if (s.pc_done_t < 0) {
            s.pc_done_t = pt;
            this.log(`DC link pre-charged: ${s.vdc.toFixed(0)} V (${(s.vdc / s.v_src * 100).toFixed(1)} %) in ${pt.toFixed(2)} s`);
          }
          if (pt - s.pc_done_t >= 0.5) { s.pc_done_t = -1; this.goto("CLOSE_CTL"); }
        } else if (pt > 20) this.fault("Pre-charge timeout (check Rpre / line voltage)");
      } else if (p === "CLOSE_CTL") {
        if (!s.ctl) { this.closeCtl(); st[3] = 50; }
        if (pt >= 0.6 && s.chct) { s.chct = false; st[3] = 100; this.log("ChCt OPEN — Rpre out of circuit"); }
        if (pt >= 1.2) this.goto("STABILIZE");
      } else if (p === "STABILIZE") {
        if (c.supply === "AC" && !s.qc_on) { s.qc_on = true; this.log(`4QC on — regulating DC link at ${c.vdc_ref_ac.toFixed(0)} V`); }
        const err = c.supply === "AC" ? Math.abs(s.vdc - vnom(c)) / vnom(c) : 0;
        st[4] = Math.min(100, pt / 1.5 * 100);
        if (pt >= 1.5 && err < 0.02) { st[4] = 100; this.log(`DC link stable at ${s.vdc.toFixed(0)} V`); this.goto("INVERTER"); }
      } else if (p === "INVERTER") {
        if (!s.inv_on) { s.inv_on = true; this.log("Inverter enabled — magnetizing motors"); }
        st[5] = s.flux * 100;
        if (s.flux >= 0.99) { this.goto("TRACTION"); this.log(`Traction released — target ${c.target_kmh.toFixed(0)} km/h`); }
      } else if (p === "TRACTION") {
        st[5] = 100; st[6] = 100;
        const want = clip((c.target_kmh - s.speed * 3.6) / 4, -0.7, 1);
        s.throttle += clip(want - s.throttle, -0.6 * dt, 0.6 * dt);
      } else if (p === "BRAKING") {
        st[6] = 0;
        s.throttle += clip(-0.8 - s.throttle, -0.6 * dt, 0.6 * dt);
        if (s.speed < 0.05) { s.throttle = 0; this.log("Train stopped"); this.goto("SHUTDOWN"); }
      } else if (p === "SHUTDOWN") {
        s.throttle = 0;
        if (s.inv_on || s.qc_on) { s.inv_on = s.qc_on = false; this.log("Inverter and 4QC off"); }
        if (pt >= 0.6 && s.ctl) { s.ctl = false; this.log("CtL OPEN"); }
        if (pt >= 1.4 && s.mcb) { s.mcb = false; this.log("MCB OPEN"); }
        if (pt >= 2.2) s.panto_cmd = false;
        s.steps = pt >= 2.2 ? STEPS.map(() => 0) : st.map((x, i) => (i < 5 ? x : 0));
        if (pt >= 2.2 && s.panto_pos <= 0) { this.log("Pantograph lowered — system off"); this.goto("OFF"); }
      }
    }

    // --------------------------------------------------------------- physics
    step(dt) {
      const s = this.s, c = this.cfg;
      s.t += dt;
      if (s.mode === "auto") this.sequence(dt);
      s.spark = Math.max(0, s.spark - dt * 2);
      s.panto_pos = s.panto_cmd ? Math.min(1, s.panto_pos + dt / 3) : Math.max(0, s.panto_pos - dt / 2);
      const live = s.panto_pos >= 1 && s.mcb;
      if (s.mcb && s.panto_pos < 1 && s.panto_cmd === false && Math.abs(s.i_src) > 20) s.spark = 1;
      s.v_src = live ? (c.supply === "DC" ? c.v_cat_dc : c.v_sec_peak_ac) : 0;
      if (c.supply === "AC" && s.qc_on && !(live && s.ctl)) { s.qc_on = false; this.log("4QC off (loss of supply)", "warn"); }
      s.flux = s.inv_on ? Math.min(1, s.flux + dt) : Math.max(0, s.flux - dt / 0.3);
      this.traction(dt);
      s.i_dc = s.vdc > 100 ? s.p_elec / s.vdc : 0;
      this.dcLink(dt);
      if (s.inv_on && s.vdc < 0.5 * vnom(c)) { s.inv_on = false; this.fault(`DC link undervoltage (${s.vdc.toFixed(0)} V) — inverter blocked`); }
      if (s.emergency && s.panto_pos <= 0 && s.speed <= 0) s.emergency = false;
    }

    mVf(f) { const fb = fBase(this.cfg), m0 = 0.03; return fb ? Math.min(1, m0 + (1 - m0) * f / fb) : 0; }

    traction(dt) {
      const s = this.s, c = this.cfg, v = s.speed, fr = fRotor(c, v), fmax = c.f_max_kn * 1e3, fb = fBase(c);
      const vn = vnom(c), vratio = vn ? clip(s.vdc / vn, 0, 1.1) : 0;
      const pAvail = c.p_max_mw * 1e6 * Math.min(1, vratio), fAvail = Math.min(fmax, pAvail / Math.max(v, 0.1));
      let fe = 0, fm = 0;
      const ok = s.inv_on && s.flux > 0.05;
      if (s.mode === "manual" && s.ctrl === "freq") {
        if (ok) s.f_s += clip(s.f_cmd - s.f_s, -10 * dt, 10 * dt);
        else s.f_s = s.inv_on ? fr : 0;
        const mvf = this.mVf(s.f_s);
        s.m = s.vf_auto ? mvf : s.m_cmd;
        const fluxRatio = clip(s.m / Math.max(mvf, 1e-3), 0, 1.3) * s.flux;
        const slip = s.f_s - fr;
        if (ok) {
          fe = fmax * clip(slip / c.slip_nom_hz, -1.3, 1.3) * Math.min(1, fluxRatio) ** 2;
          fe = clip(fe, -fAvail * 1.1, fAvail * 1.1);
        }
        s.throttle_out = fe / fmax;
      } else {
        let thr = s.throttle;
        if (s.mode === "manual" && v * 3.6 >= c.v_max_kmh && thr > 0) thr = 0;
        if (s.emergency) fm = -1.2 * c.mass_t * 1e3;
        else if (ok && thr >= 0) fe = thr * fAvail * s.flux;
        else if (thr < 0) {
          const demand = -thr * c.f_brake_kn * 1e3, fade = clip(v / 1.5, 0, 1);
          const ep = ok ? Math.min(demand, Math.min(c.f_brake_kn * 1e3, pAvail / Math.max(v, 0.1))) * fade : 0;
          fe = -ep; fm = -(demand - ep);
        }
        s.throttle_out = thr;
        const slip = ok ? c.slip_nom_hz * (fe / fmax) * Math.max(1, fr / fb) : 0;
        if (s.inv_on) { s.f_s = ok ? Math.max(0, fr + slip) : 0; s.m = this.mVf(s.f_s) * s.flux; }
        else { s.f_s = 0; s.m = 0; }
      }
      if (!s.inv_on) { s.f_s = 0; s.m = 0; fe = 0; }
      const resist = v > 0.01 ? c.davis_a + c.davis_b * v + c.davis_c * v * v : 0;
      const mEff = c.mass_t * 1e3 * c.rot_factor;
      let ft = fe + fm - resist;
      if (v <= 0 && ft < 0) ft = 0;
      const vNew = Math.max(0, v + ft / mEff * dt);
      s.pos += 0.5 * (v + vNew) * dt;
      s.speed = vNew; s.force = fe; s.force_mech = fm;
      const pm = fe * v, ploss = s.inv_on ? 12e3 * s.flux : 0;
      s.p_elec = (pm >= 0 ? pm / c.eta : pm * c.eta) + ploss;
      const fw = fb ? Math.max(1, s.f_s / fb) : 1;
      const it = c.i_rated * (fe / fmax) * fw, im = s.inv_on ? c.i_mag * s.flux / fw : 0;
      s.i_phase = Math.hypot(it, im);
      s.phi = s.i_phase > 1 ? Math.atan2(im, it) : 0;
    }

    dcLink(dt) {
      const s = this.s, c = this.cfg, C = c.c_dc, iL = s.i_dc, live = s.v_src > 0;
      let r = null;
      if (live && (s.ctl || s.chct)) {
        if (s.ctl && c.supply === "DC") r = !s.chct ? c.r_line : (c.r_line * c.r_pre) / (c.r_line + c.r_pre);
        else if (s.ctl && c.supply === "AC") r = c.r_ac_eq;
        else r = c.r_pre;
      }
      const v0 = s.vdc;
      if (c.supply === "AC" && s.qc_on) {
        s.vdc = c.vdc_ref_ac + (s.vdc - c.vdc_ref_ac) * Math.exp(-dt / 0.15);
        s.i_src = iL + C * (s.vdc - v0) / dt;
      } else if (r !== null) {
        const vInf = s.v_src - iL * r;
        if (c.supply === "AC" && vInf < s.vdc) { s.vdc = Math.max(0, s.vdc - iL * dt / C); s.i_src = 0; }
        else { s.vdc = vInf + (s.vdc - vInf) * Math.exp(-dt / (r * C)); s.i_src = (s.v_src - s.vdc) / r; }
      } else {
        s.vdc = Math.max(0, s.vdc * Math.exp(-dt / (c.r_dis * C)) - iL * dt / C);
        s.i_src = 0;
      }
      const vLim = 1.17 * vnom(c);
      if (s.vdc > vLim) {
        s.p_vlu = 0.5 * C * (s.vdc ** 2 - vLim ** 2) / dt;
        s.i_vlu = s.p_vlu / vLim;
        s.vdc = vLim;
      } else { s.p_vlu = 0; s.i_vlu = 0; }
    }

    // -------------------------------------------------------------- snapshot
    snapshot(wave) {
      const s = this.s, c = this.cfg;
      const d = JSON.parse(JSON.stringify(s));
      d.steps = s.steps.map((x) => Math.round(x * 10) / 10);
      d.step_names = STEPS;
      d.speed_kmh = s.speed * 3.6;
      d.f_rotor = fRotor(c, s.speed);
      d.p_src = c.supply === "DC" ? s.v_src * s.i_src : s.vdc * s.i_src;
      d.cfg = { ...c, vnom: vnom(c), fc: fcOf(c), f_base: fBase(c) };
      d.excel = EM.excelGauges(s.f_s, s.m * 1500);
      d.events = this.events.slice(-40);
      if (wave) d.wave = this.waves();
      return d;
    }

    modulate(ref, t, car, V) {
      const c = this.cfg;
      if (c.pwm_method === "excel") return c.levels === 2 ? EM.pwmLevel2Excel(ref, car, V) : EM.pwmLevel3Excel(ref, car, V);
      if (c.levels === 2) return EM.pwmBipolar(ref, t, fcOf(c), V);
      return ref.map((r, i) => (r > car[i] ? V : r < car[i] - V ? -V : 0));
    }

    waves() {
      const s = this.s, c = this.cfg, V = s.vdc / 2, f = s.f_s, fc = fcOf(c);
      const W = f < 21 ? 0.1 : Math.min(0.1, Math.max(0.02, 2.1 / f)), n = 2000;
      const t = linspace(0, W, n);
      const amp = s.inv_on ? s.m * V : 0;
      const refs = [0, 1, 2].map((k) => EM.sineReference(t, f, amp, -k * 2 * PI / 3));
      const car = EM.triangleCarrier(t, fc, V);
      const pwms = s.inv_on ? refs.map((r) => this.modulate(r, t, car, V)) : [0, 1, 2].map(() => new Array(n).fill(0));
      const uab = pwms[0].map((x, i) => x - pwms[1][i]);
      const ipk = s.i_phase * Math.SQRT2, L = 0.01, dtt = t[1] - t[0];
      const cur = [0, 1, 2].map((k) => {
        const base = t.map((x) => ipk * Math.sin(2 * PI * f * x - k * 2 * PI / 3 - s.phi));
        if (s.inv_on && amp > 0) {
          const rip = new Array(n);
          let acc = 0;
          for (let i = 0; i < n; i++) { acc += (pwms[k][i] - refs[k][i]) * dtt; rip[i] = acc / L; }
          // rip -= 51-sample moving average (np.convolve mode="same", zero-padded edges)
          const pre = new Float64Array(n + 1);
          for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + rip[i];
          for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 25), b = Math.min(n, i + 26);
            base[i] += 0.5 * (rip[i] - (pre[b] - pre[a]) / 51);
          }
        }
        return base;
      });
      const spec = s.inv_on && f >= 1 ? this.spectrum(V, s.m * V, f) : null;
      const [dct, dcv] = this.dcZoom();
      const r = (a, nd = 1) => { const p = 10 ** nd; return a.map((x) => Math.round(x * p) / p); };
      return {
        t: r(t.map((x) => x * 1000), 3), ref: r(refs[0]), carrier: r(car), pwm: r(pwms[0]), uab: r(uab),
        ia: r(cur[0]), ib: r(cur[1]), ic: r(cur[2]), spec, dct: r(dct.map((x) => x * 1000), 3), dcv: r(dcv),
      };
    }

    spectrum(V, amp, f) {
      const c = this.cfg, fc = fcOf(c);
      const periods = Math.max(1, Math.round(0.2 * f)), T = periods / f, n = 16384;
      const t = Array.from({ length: n }, (_, i) => i * T / n);
      const car = EM.triangleCarrier(t, fc, V);
      const pa = this.modulate(EM.sineReference(t, f, amp), t, car, V);
      const pb = this.modulate(EM.sineReference(t, f, amp, -2 * PI / 3), t, car, V);
      const mag = (x) => { const X = rfftMag(x); for (let i = 0; i < X.length; i++) X[i] *= 2 / n; X[0] /= 2; return X; };
      const A = mag(pa.map((x, i) => x - pb[i])), P = mag(pa), k = periods;
      const thd = (X) => {
        if (X[k] < 1e-6) return null;
        let s2 = 0;
        for (let i = 1; i < X.length; i++) s2 += X[i] * X[i];
        return Math.sqrt(Math.max(0, s2 - X[k] * X[k])) / X[k] * 100;
      };
      const df = 1 / T, nb = Math.floor(Math.min(3.3 * fc, (n / 2 - 1) * df) / df);
      const fr = [], a = [];
      for (let i = 1; i < nb; i++) { fr.push(Math.round(i * df * 100) / 100); a.push(Math.round(A[i] * 10) / 10); }
      return { f: fr, a, thd_uab: thd(A), thd_pwm: thd(P), fund_uab: A[k], fund_pwm: P[k] };
    }

    dcZoom() {
      const s = this.s, c = this.cfg, n = 2000, W = 0.04, dt = W / n, v0 = s.vdc;
      const t = linspace(0, W, n);
      if (c.supply === "AC" && s.v_src > 0 && (s.ctl || s.chct) && !s.qc_on) {
        const r = s.ctl ? c.r_ac_eq : c.r_pre;
        const vs = t.map((x) => s.v_src * Math.abs(Math.sin(2 * PI * c.f_grid * x)));
        const v = new Array(n);
        let x = v0;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < n; i++) {
            x += (Math.max(0, vs[i] - x) / (r * c.c_dc) - s.i_dc / c.c_dc) * dt;
            x = Math.max(x, 0);
            v[i] = x;
          }
          if (r > 10) break;
          x = Math.abs(v[n - 1] - v0) < 0.2 * Math.max(v0, 1) ? v[n - 1] : v0;
        }
        return [t, v];
      }
      if (c.supply === "AC" && s.qc_on) {
        const w = 2 * PI * c.f_grid;
        const dv = Math.min(Math.abs(s.p_elec) / (2 * w * c.c_dc * Math.max(v0, 1)), 0.3 * v0) + 0.004 * v0;
        return [t, t.map((x) => v0 + dv * Math.sin(2 * w * x) + (s.inv_on ? 0.002 * v0 * Math.sin(2 * PI * 2 * fcOf(c) * x) : 0))];
      }
      if (v0 > 1 && s.inv_on) {
        const a6 = 0.003 * v0 * Math.abs(s.p_elec) / (c.p_max_mw * 1e6);
        return [t, t.map((x) => v0 + a6 * Math.sin(2 * PI * 6 * Math.max(s.f_s, 1) * x) + 0.0015 * v0 * Math.sin(2 * PI * 2 * fcOf(c) * x))];
      }
      return [t, new Array(n).fill(v0)];
    }
  }

  // =============== Local API: same routes as app.py, no server
  function makeLocalApi(sim) {
    const num = (q, k, d, lo, hi) => { const v = parseFloat(q.get(k)); return clip(Number.isFinite(v) ? v : d, lo, hi); };
    const r = (a, nd) => { const p = 10 ** nd; return Array.from(a, (x) => (Number.isFinite(x) ? Math.round(x * p) / p : 0)); };
    return {
      get(url) {
        const [path, qs] = url.split("?");
        const q = new URLSearchParams(qs || "");
        if (path === "/api/state") return sim.snapshot(q.get("wave") === "1");
        if (path === "/api/lab/pwm") {
          const level = q.get("level") === "3" ? 3 : 2;
          const o = EM.pwmSheet(level, num(q, "freq", 21, 0, 200), num(q, "amp", 1500, 0, 3000),
            num(q, "fc", level === 2 ? 400 : 600, 50, 5000), num(q, "carrier_amp", 1500, 1, 3000));
          return { t: r(o.t, 6), ref: r(o.ref, 2), carrier: r(o.carrier, 2), pwm: r(o.pwm, 2) };
        }
        if (path === "/api/lab/precharge") {
          const o = EM.prechargeSheet(num(q, "vmax", 3000, 1, 50000), num(q, "r", 1000, 0.01, 1e6), num(q, "c", 0.001, 1e-6, 10), num(q, "percent", 100, 0, 100));
          return { ...o, t: r(o.t, 4), v: r(o.v, 4), pct: r(o.pct, 4) };
        }
        if (path === "/api/lab/ripple") {
          const o = EM.rippleSheet(num(q, "r", 325, 1, 10000), num(q, "c_step", 4, 0.1, 100), num(q, "vmax", 3000, 0, 50000), num(q, "dt_step", 7, 0.1, 100));
          const half = (a, nd) => r(a.filter((_, i) => i % 2 === 0), nd);
          return { t: half(o.t, 6), rect: half(o.rect, 2), charge: half(o.charge, 2), cap: half(o.cap, 2), final: half(o.final, 2), C: o.C, tau: o.tau };
        }
        throw new Error("unknown route: " + url);
      },
      command(cmd, value) { sim.command(cmd, value); },
    };
  }

  global.TractionSim = { EM, Simulator, makeLocalApi, rfftMag, STEPS };
})(typeof window !== "undefined" ? window : globalThis);
