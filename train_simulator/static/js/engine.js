// Traction converter simulation engine — runs entirely in the browser.
// Author: Rafael Tavares
//
// Physics overview
//  * DC link: time-domain simulation with 0.25 ms sub-steps (line filter LC, pre-charge,
//    single-phase 2f power pulsation, 2f resonant filter, VLU chopper, constant-power loads).
//  * Supply: EN 50163 voltage limits; DC lines with substation spacing, line resistance and
//    receptivity; AC lines with transformer + 4QC line converter; diesel generator set;
//    battery (ESS) and hydrogen fuel cell with energy management.
//  * Motor: induction-machine T-equivalent circuit (slip solved for the commanded torque),
//    V/f + field weakening limited by the DC link, current and breakdown torque limits.
//  * Modulation: SVPWM asynchronous → synchronous pulse patterns → block (six-step),
//    2-level or 3-level NPC.
//  * Train: Davis resistance, gradient, Curtius–Kniffler adhesion, blended braking.
(function (global) {
  "use strict";
  const PI = Math.PI, SQ2 = Math.SQRT2, SQ3 = Math.sqrt(3), GRAV = 9.81;
  const DT_SUB = 0.25e-3;
  const clip = (x, a, b) => Math.min(b, Math.max(a, x));

  // ============================================================== catalog
  // EN 50163 voltage limits (V). Umin2/Umax2: non-permanent limits; Umin1/Umax1: permanent.
  const SUPPLIES = {
    DC600: { id: "DC600", kind: "DC", Un: 600, f: 0, Umin2: 400, Umin1: 400, Umax1: 720, Umax2: 800, label: "600 V DC", where: "Trams, light rail, some metros" },
    DC750: { id: "DC750", kind: "DC", Un: 750, f: 0, Umin2: 500, Umin1: 500, Umax1: 900, Umax2: 1000, label: "750 V DC", where: "Metros, trams, UK and Berlin third rail" },
    DC1500: { id: "DC1500", kind: "DC", Un: 1500, f: 0, Umin2: 1000, Umin1: 1000, Umax1: 1800, Umax2: 1950, label: "1.5 kV DC", where: "Netherlands, southern France" },
    DC3000: { id: "DC3000", kind: "DC", Un: 3000, f: 0, Umin2: 2000, Umin1: 2000, Umax1: 3600, Umax2: 3900, label: "3 kV DC", where: "Italy, Belgium, Poland, Spain (conventional), Czechia (north), Slovenia" },
    AC15: { id: "AC15", kind: "AC", Un: 15000, f: 16.7, Umin2: 11000, Umin1: 12000, Umax1: 17250, Umax2: 18000, label: "15 kV 16.7 Hz", where: "Germany, Austria, Switzerland, Sweden, Norway" },
    AC25: { id: "AC25", kind: "AC", Un: 25000, f: 50, Umin2: 17500, Umin1: 19000, Umax1: 27500, Umax2: 29000, label: "25 kV 50 Hz", where: "France (north, LGV), UK, Denmark, Finland, Hungary, Portugal, Czechia (south), high-speed lines" },
  };

  const SYSTEMS = {
    dc_ohl: { label: "DC overhead line", src: "dcline", supplies: ["DC600", "DC750", "DC1500", "DC3000"], def: "DC3000", collector: "pantograph", vehicles: ["metro", "emu", "loco"], ess: "optional", traction: true },
    dc_3rail: { label: "Third rail DC", src: "dcline", supplies: ["DC600", "DC750"], def: "DC750", collector: "shoe", vehicles: ["metro", "emu"], ess: "optional", traction: true },
    ac_ohl: { label: "AC overhead line", src: "acline", supplies: ["AC15", "AC25"], def: "AC25", collector: "pantograph", vehicles: ["emu", "loco"], ess: "optional", traction: true },
    diesel: { label: "Diesel-electric (generator)", src: "genset", supplies: [], collector: null, vehicles: ["regional", "loco"], ess: "optional", traction: true },
    battery: { label: "Battery train (ESS)", src: "battery", supplies: [], collector: null, vehicles: ["regional", "emu"], ess: "main", traction: true },
    hydrogen: { label: "Hydrogen fuel cell + ESS", src: "fuelcell", supplies: [], collector: null, vehicles: ["regional"], ess: "main", traction: true },
    aux: { label: "Auxiliary converter only", src: "line", supplies: ["DC600", "DC750", "DC1500", "DC3000", "AC15", "AC25"], def: "DC3000", collector: "pantograph", vehicles: [], ess: "none", traction: false },
  };

  // Per traction converter (one converter drives nm motors). Typical values, not a specific product.
  const VEHICLES = {
    metro: { label: "Metro (2 cars)", mass: 72, adh: 0.75, nm: 4, pm: 140, vmax: 90, fmax: 100, bmax: 110, davis: [1300, 20, 4.0], nmax: 5000, wheel: 0.84, auxKW: 60 },
    emu: { label: "EMU / regional (half unit)", mass: 110, adh: 0.6, nm: 4, pm: 300, vmax: 160, fmax: 120, bmax: 120, davis: [1800, 30, 6.0], nmax: 4200, wheel: 0.92, auxKW: 90 },
    loco: { label: "Locomotive + 500 t train (per bogie converter)", mass: 294, adh: 0.15, nm: 2, pm: 1600, vmax: 200, fmax: 150, bmax: 150, davis: [3500, 60, 7.0], nmax: 3800, wheel: 1.25, auxKW: 70 },
    regional: { label: "Regional multiple unit (2 cars)", mass: 115, adh: 0.45, nm: 2, pm: 315, vmax: 140, fmax: 90, bmax: 90, davis: [1800, 30, 5.5], nmax: 4200, wheel: 0.86, auxKW: 70 },
  };

  // DC line feeding: substation spacing (km), line+return resistance (ohm/km), substation resistance (ohm)
  const DC_LINES = {
    pantograph: { DC600: [2, 0.08, 0.02], DC750: [2.5, 0.07, 0.02], DC1500: [8, 0.03, 0.03], DC3000: [18, 0.035, 0.06] },
    shoe: { DC600: [2.5, 0.02, 0.015], DC750: [3, 0.018, 0.015] },
  };
  const RAIL = { dry: 1, wet: 0.7, leaves: 0.4 };

  function defaultVehicle(sys, sup) {
    if (sys === "dc_3rail") return "metro";
    if (sys === "dc_ohl") return SUPPLIES[sup].Un <= 750 ? "metro" : "emu";
    if (sys === "ac_ohl") return "emu";
    if (sys === "aux") return null;
    return "regional";
  }

  // ================================================================ motor
  function makeMotor(veh, vdcN) {
    const p = 2, nm = veh.nm, P = veh.pm * 1e3, etaG = 0.975;
    const VLL = 0.70 * vdcN, Vph = VLL / SQ3;
    const S = P / (0.95 * 0.87);
    const Zb = 3 * Vph * Vph / S;
    const r = veh.wheel / 2;
    const gear = (veh.nmax / 60) * 2 * PI * r / (veh.vmax / 3.6);
    const vb = veh.vmax / 3.6 / 3; // rated (base) speed: constant-power range ≈ 3:1
    const fRb = vb * gear / (2 * PI * r) * p;
    const fr = fRb * 1.01;
    const w = 2 * PI * fr;
    const M = {
      p, nm, P, etaG, VLL, Vph, S, Zb, r, gear, vb, fr,
      Rs: 0.012 * Zb, Rr: 0.011 * Zb, Lls: 0.1 * Zb / w, Llr: 0.1 * Zb / w, Lm: 3.2 * Zb / w,
      Ir: S / (3 * Vph), Tr: P / (2 * PI * fRb / p), Fr: nm * P * etaG / vb,
    };
    M.Imag = Vph / (w * (M.Lls + M.Lm));
    M.fRot = (v) => v * gear / (2 * PI * r) * p;
    return M;
  }

  // Steady-state T-equivalent circuit, phase voltage V (rms, real), stator frequency fs, slip frequency fsl
  function motorEval(M, fs, fsl, V) {
    fs = Math.max(fs, 0.02);
    const w = 2 * PI * fs, s = fsl / fs;
    const xr = s * w * M.Llr, den = M.Rr * M.Rr + xr * xr;
    const yrR = s * M.Rr / den, yrI = -s * xr / den;
    const yI = yrI - 1 / (w * M.Lm), dY = yrR * yrR + yI * yI;
    const zR = M.Rs + yrR / dY, zI = w * M.Lls - yI / dY, dZ = zR * zR + zI * zI;
    const iR = V * zR / dZ, iI = -V * zI / dZ;
    const Is = Math.hypot(iR, iI);
    const eR = V - (iR * M.Rs - iI * w * M.Lls), eI = -(iR * w * M.Lls + iI * M.Rs);
    const irR = eR * yrR - eI * yrI, irI = eR * yrI + eI * yrR;
    const Pag = 3 * (eR * irR + eI * irI);
    const wsyn = w / M.p;
    const T = Pag / wsyn;
    const Pfe = 0.006 * M.S * Math.pow(fs / M.fr, 1.3) * (V / M.Vph) ** 2;
    const Pin = 3 * V * iR + Pfe;
    const Pcu = 3 * Is * Is * M.Rs + 3 * (irR * irR + irI * irI) * M.Rr;
    return { T, Is, Pin, Pcu, Pfe, fs, fsl, V, phi: Math.atan2(-iI, iR), pf: Is > 0 ? (3 * V * iR) / (3 * V * Is) : 0 };
  }

  // V/f with IR compensation (keeps nominal flux at low frequency), limited by the DC link
  const vfLaw = (M, fs, vdc, mmax, flux) => Math.min(Math.hypot(M.Vph * fs / M.fr, 3 * M.Imag * M.Rs), mmax * vdc / (2 * SQ2)) * flux;

  // Finds the slip frequency giving torque Tcmd (limited by breakdown and current limit)
  function motorSolve(M, fRot, Tcmd, vdc, mmax, flux, Ilim) {
    const Vmax = mmax * vdc / (2 * SQ2) * flux;
    const at = (fsl) => {
      let fs = fRot + fsl;
      if (fs < 0.05) { fs = 0.05; fsl = fs - fRot; }
      const V = vfLaw(M, fs, vdc, mmax, flux);
      const op = motorEval(M, fs, fsl, V);
      // load-dependent IR compensation at low frequency (as a vector-controlled drive does)
      const k = clip(1 - fs / (0.3 * M.fr), 0, 1);
      return k > 0 ? motorEval(M, fs, fsl, Math.min(Vmax, V + op.Is * M.Rs * k)) : op;
    };
    const idle = () => { const fs = Math.max(fRot, 0.05); return { ...motorEval(M, fs, 0, vfLaw(M, fs, vdc, mmax, flux)), T: 0, limit: "" }; };
    if (vdc < 1 || flux <= 0 || Math.abs(Tcmd) < 1e-6) return idle();
    const sg = Tcmd >= 0 ? 1 : -1, hi = 0.3 * M.fr + 3;
    let best = 0, bestT = 0;
    for (let k = 1; k <= 24; k++) {
      const f = sg * hi * k / 24, T = at(f).T * sg;
      if (T > bestT) { bestT = T; best = f; }
    }
    let limit = "", Tt = Math.abs(Tcmd);
    if (Tt > 0.92 * bestT) { Tt = 0.92 * bestT; limit = "breakdown"; }
    let op = null;
    for (let it = 0; it < 3; it++) {
      let a = 0, b = best;
      for (let k = 0; k < 32; k++) {
        const mid = 0.5 * (a + b);
        if (at(mid).T * sg < Tt) a = mid; else b = mid;
      }
      op = at(0.5 * (a + b));
      if (op.Is <= Ilim || Tt < 1) break;
      Tt *= Math.pow(Ilim / op.Is, 1.6);
      limit = "current";
    }
    op.limit = limit;
    return op;
  }

  // ============================================================= battery
  const OCV = {
    NMC: (s) => 3.30 + 0.85 * s - 0.25 * Math.exp(-15 * s) + 0.05 * Math.exp(-20 * (1 - s)),
    LTO: (s) => 2.15 + 0.40 * s - 0.20 * Math.exp(-15 * s) + 0.08 * Math.exp(-25 * (1 - s)),
  };

  // ============================================================ fuel cell
  const FC_CELL = (i) => (i < 1e-4 ? 1.0 : 1.0 - 0.03 * Math.log(i / 0.001) - 0.15 * i - 3e-5 * Math.exp(8 * i));

  // ================================================================ design
  function makeDesign(cfg) {
    const sys = SYSTEMS[cfg.system];
    const sup = sys.supplies.length ? SUPPLIES[cfg.supply] : null;
    const src = sys.src === "line" ? (sup.kind === "DC" ? "dcline" : "acline") : sys.src;
    const aux = cfg.system === "aux";
    const veh = sys.traction ? VEHICLES[cfg.vehicle] : null;
    const levels = cfg.levels;
    const D = { key: [cfg.system, cfg.supply, cfg.vehicle, levels, cfg.ess].join("|"), sys, sup, src, aux, veh, levels, traction: sys.traction };
    D.collector = sys.collector && (src === "dcline" || src === "acline") ? sys.collector : null;

    let vdc;
    if (src === "dcline") vdc = sup.Un;
    else if (src === "acline") vdc = aux ? 750 : 3000;
    else if (src === "genset") vdc = 1800;
    else if (src === "battery") vdc = 1500;
    else vdc = 750;
    D.vdc = vdc;
    D.dcFollowsLine = src === "dcline";

    // semiconductor class and switching frequency
    if (levels === 3) Object.assign(D, vdc <= 1000 ? { igbt: "1.2 kV IGBT (NPC)", fswDev: 2000 } : vdc <= 2000 ? { igbt: "1.7 kV IGBT (NPC)", fswDev: 1000 } : { igbt: "3.3 kV IGBT (NPC)", fswDev: 500 });
    else Object.assign(D, vdc <= 1000 ? { igbt: "1.7 kV IGBT", fswDev: 1500 } : vdc <= 2000 ? { igbt: "3.3 kV IGBT", fswDev: 800 } : { igbt: "6.5 kV IGBT", fswDev: 450 });
    D.fc = levels === 3 ? 2 * D.fswDev : D.fswDev; // carrier frequency (3L PD: devices switch half the time)

    D.C = vdc <= 1000 ? 10e-3 : vdc <= 2000 ? 6e-3 : src === "acline" ? 9e-3 : 4e-3;
    D.Rpre = 0.8 / D.C;

    // power ratings
    D.Pmc = veh ? veh.nm * veh.pm * 1e3 / 0.95 : 0;
    D.Paux = veh ? veh.auxKW * 1e3 : 120e3;
    D.Shbu = 1.4 * D.Paux;
    D.Phwr = veh ? 0.04 * D.Pmc + (src === "acline" ? 0.015 * D.Pmc : 0) + 8e3 : 8e3;
    D.Pline = D.Pmc + D.Shbu + D.Phwr;
    D.motor = veh ? makeMotor(veh, vdc) : null;
    D.mcIr = D.motor ? D.motor.nm * D.motor.Ir : 1;

    // supply side
    if (src === "dcline") {
      const [spacing, rkm, Rss] = DC_LINES[D.collector][sup.id];
      D.line = { spacing, rkm, Rss };
      D.L = sup.Un <= 750 ? 2.5e-3 : sup.Un <= 1500 ? 6e-3 : 10e-3;
      D.RL = 0.01 + 0.02 * sup.Un / 3000;
      D.f0 = 1 / (2 * PI * Math.sqrt(D.L * D.C));
      D.Ilim = D.Pline / (0.9 * sup.Un);
      // trip setting: above the operating current limit and above the residual inrush after pre-charge
      D.Itrip = Math.max(1.6 * D.Ilim, 0.15 * sup.Un / Math.sqrt(D.L / D.C));
      D.brkName = "HSCB";
    } else if (src === "acline") {
      D.V2 = aux ? 400 : 1500;
      D.Rtr = aux ? 0.05 : 0.25;
      D.fg = sup.f;
      D.Plc = 1.15 * D.Pline;
      D.Itrip = 2.2 * SQ2 * D.Plc / D.V2;
      D.brkName = "VCB";
      if (!aux) {
        D.f2 = 2 * sup.f;
        D.C2 = 0.4 * D.C;
        D.L2 = 1 / ((2 * PI * D.f2) ** 2 * D.C2);
        D.R2 = 0.04 * Math.sqrt(D.L2 / D.C2);
      }
    } else if (src === "genset") {
      D.Peng = Math.round(1.2 * (D.Pmc + D.Paux) / 1e4) * 1e4;
      D.nIdle = 800; D.nMax = 1800; D.Vgen = 1300; D.Rgen = 1.5;
      D.Plc = D.Peng;
      D.Itrip = 3 * D.Peng / vdc;
      D.brkName = "Generator contactor";
      D.fuelCap = veh && veh.nm * veh.pm > 2000 ? 6000 : 1500;
    } else {
      D.brkName = "Battery main contactor";
      D.Itrip = 3 * D.Pline / vdc;
    }

    // energy storage
    const essMain = sys.ess === "main";
    D.essAddon = sys.ess === "optional" && cfg.ess;
    D.ess = essMain || D.essAddon;
    if (src === "battery") D.bat = { chem: "NMC", E: 450e3, Vn: 770, Pdis: 1.3e6, Pch: 0.7e6, R: 0.035 };
    else if (src === "fuelcell") D.bat = { chem: "LTO", E: 120e3, Vn: 650, Pdis: 0.5e6, Pch: 0.5e6, R: 0.03 };
    else if (D.essAddon) D.bat = { chem: "LTO", E: 100e3, Vn: 650, Pdis: 0.6e6, Pch: 0.6e6, R: 0.03 };
    if (D.bat) {
      const b = D.bat;
      b.cellV = b.chem === "NMC" ? 3.7 : 2.3;
      b.ns = Math.round(b.Vn / b.cellV);
      b.Ah = b.E / b.Vn;
      b.Pesc = Math.max(b.Pdis, b.Pch);
    }
    if (src === "fuelcell") D.fc_mod = { n: 2, cells: 440, area: 900, bop: 0.09, Pgross: 220e3, ramp: 25e3, tank: 180 };

    // VLU (brake chopper) and DC link protection thresholds
    D.vlu = !aux;
    if (src === "dcline") { D.Von = 1.03 * sup.Umax2; D.Vovp = 1.12 * sup.Umax2; D.Vuv = 0.85 * sup.Umin2; }
    else { D.Von = 1.12 * vdc; D.Vovp = 1.25 * vdc; D.Vuv = 0.6 * vdc; }
    D.Voff = D.Von - 0.02 * vdc;
    D.Pvlu = veh ? 1.0 * D.Pmc : 0;
    D.Rvlu = D.Pvlu ? (D.Von * D.Von) / D.Pvlu : 1e9;
    D.mcVmin = src === "dcline" ? 0.9 * sup.Umin2 : 0.75 * vdc;

    // thermal
    D.Rth_hs = 55 / Math.max(0.0165 * D.Pmc, 1);
    D.Cth_hs = 150 / D.Rth_hs;
    if (D.motor) { D.Rth_m = 110 / (0.053 * D.motor.P); D.Cth_m = 1200 / D.Rth_m; }
    D.Rth_v = 450 / Math.max(0.25 * D.Pvlu, 1); D.Cth_v = 90 / D.Rth_v;

    D.modules = moduleList(D);
    return D;
  }

  const kW = (w) => (Math.abs(w) >= 1e6 ? (w / 1e6).toFixed(2) + " MW" : (w / 1e3).toFixed(0) + " kW");

  function moduleList(D) {
    const L = [];
    const add = (id, name, detail) => L.push({ id, name, detail });
    if (D.src === "acline") add("LC", "Line converter (4QC)", `Single-phase AC → DC, ${kW(D.Plc)}, transformer secondary ${D.V2} V, unity power factor`);
    if (D.src === "genset") add("LC", "Line converter (active rectifier)", `3AC generator → DC, ${kW(D.Plc)}, diesel engine ${kW(D.Peng)}`);
    if (D.src === "dcline") add("HF", "Harmonic filter (line filter)", `L = ${(D.L * 1e3).toFixed(1)} mH with DC link C, resonance ${D.f0.toFixed(1)} Hz`);
    if (D.f2) add("HF", "Harmonic filter (2f resonant)", `Series LC tuned to ${D.f2.toFixed(1)} Hz, L2 = ${(D.L2 * 1e3).toFixed(2)} mH, C2 = ${(D.C2 * 1e3).toFixed(1)} mF`);
    add("DCL", "DC link", `${D.vdc} V nominal${D.dcFollowsLine ? " (follows line)" : " (regulated)"}, C = ${(D.C * 1e3).toFixed(1)} mF, pre-charge ${D.Rpre.toFixed(0)} Ω`);
    if (D.vlu) add("VLU", "Voltage limiting unit (brake chopper)", `On at ${D.Von.toFixed(0)} V, ${kW(D.Pvlu)}, R = ${D.Rvlu.toFixed(2)} Ω`);
    if (D.bat) add("ESC", "Energy storage converter", `Bidirectional DC/DC, ${D.bat.chem} ${(D.bat.E / 1e3).toFixed(0)} kWh, ${D.bat.Vn} V, ±${kW(D.bat.Pesc)}`);
    if (D.fc_mod) add("FCC", "Fuel cell converter", `DC/DC boost, ${D.fc_mod.n} × ${kW(D.fc_mod.Pgross)} PEM stacks, H₂ tank ${D.fc_mod.tank} kg`);
    add("HBU", "Auxiliary converter (HBU)", `3AC 400 V 50 Hz train bus, ${(D.Shbu / 1e3).toFixed(0)} kVA, sine filter`);
    add("HWR", "Auxiliary inverter (HWR)", `Variable V/f 20–50 Hz for cooling fans and pumps, ${kW(D.Phwr)}`);
    if (D.motor) add("MC", "Motor converter", `${D.levels === 3 ? "3-level NPC" : "2-level"}, ${D.igbt}, ${kW(D.Pmc)}, ${D.motor.nm} × ${kW(D.motor.P)} induction motors`);
    return L;
  }

  // =============================================================== state
  function newConfig() {
    return {
      system: "dc_ohl", supply: "DC3000", vehicle: "emu", levels: 2, pwm: "traction", ess: false,
      lineV: 3300, recept: 0.5, tAmb: 28, grade: 0, rail: "dry", target_kmh: 100, time_scale: 1, fswScale: 1,
    };
  }

  function newState(D) {
    return {
      t: 0, mode: "auto", phase: "OFF", pt: 0, stepIdx: 0, steps: [],
      col_cmd: false, col_pos: 0, brk: false, chct: false, ctl: false, lc: false, mc: false, hbu: false, hbu_out: false, hwr: false, esc: false,
      eng: "off", n_eng: 0, exc: 0, p_eng_avail: 0, fc: "off", fc_t: 0, p_fc_gross: 0, p_fc_dc: 0, h2_rate: 0, fuel_rate: 0,
      vdc: 0, vref: 0, iL: 0, i2: 0, v2f: 0, i2f: 0, th: 0, v_line: 0, i_line: 0, p_src: 0, p_mc: 0, p_hbu: 0, p_hwr: 0, p_vlu: 0, p_esc: 0, p_esc_cmd: 0,
      esc_pdis: 0, esc_pch: 0, v_bat: D.bat ? D.bat.Vn : 0, i_bat: 0, soc: D.src === "battery" ? 0.85 : 0.6,
      h2: D.fc_mod ? D.fc_mod.tank : 0, fuel: D.fuelCap || 0, vlu_on: false, vlu_duty: 1, p_load_avg: 0,
      flux: 0, fs: 0, fsl: 0, m: 0, V: 0, Is: 0, phi: 0, pf: 0, eta_m: 0, torque: 0, pulse: { mode: "off" }, pulseN: 0, p_loss_mc: 0,
      speed: 0, pos: 0, force: 0, force_mech: 0, f_adh: 0, limit: "", p_wheel: 0,
      throttle: 0, ctrl: "throttle", f_cmd: 0, m_cmd: 0.5, vf_auto: true,
      t_hs: 25, t_j: 25, t_mot: 25, t_vlu: 25, f_hwr: 0, p_air: 9.5, comp: false, uv_t: 0,
      faults: [], warned: {}, spark: 0, emergency: false, imax: 0,
      E: { src: 0, regen: 0, vlu: 0, aux: 0, trac: 0, brake: 0, batOut: 0, batIn: 0, h2: 0, fuel: 0, dist: 0 },
    };
  }

  // ============================================================ simulator
  class Simulator {
    constructor() {
      this.cfg = newConfig();
      this.events = [];
      this.seq = 0;
      this.TICK = 0.02;
      this.rebuild();
    }

    rebuild() {
      this.D = makeDesign(this.cfg);
      const keep = this.s ? { mode: this.s.mode, pos: this.s.pos } : null;
      this.s = newState(this.D);
      if (keep) { this.s.mode = keep.mode; this.s.pos = keep.pos; this.s.phase = keep.mode === "manual" ? "MANUAL" : "OFF"; }
      this.steps = buildSteps(this.D);
      this.s.steps = this.steps.map(() => 0);
      const nb = 400;
      this.buf = { v: new Float32Array(nb), s: new Float32Array(nb), i: new Float32Array(nb), k: 0, n: nb };
      const win = this.D.f2 ? Math.round(1 / (this.D.f2 * DT_SUB)) : 20;
      this.reg = { lc: makeReg(win), esc: makeReg(win) };
      this.curvesCache = null;
    }

    start() {
      if (this.timer) return;
      let last = performance.now(), acc = 0;
      this.timer = setInterval(() => {
        const now = performance.now();
        acc += Math.min(0.25, (now - last) / 1000);
        last = now;
        while (acc >= this.TICK) { this.step(this.TICK * this.cfg.time_scale); acc -= this.TICK; }
      }, 20);
    }

    log(msg, level = "info") {
      this.seq++;
      this.events.push({ id: this.seq, t: Math.round(this.s.t * 100) / 100, msg, level });
      if (this.events.length > 200) this.events.shift();
    }
    warnOnce(key, msg) { if (!this.s.warned[key]) { this.s.warned[key] = true; this.log(msg, "warn"); } }
    fault(msg) { if (!this.s.faults.includes(msg)) { this.s.faults.push(msg); this.log(msg, "fault"); } }
    goto(p) { this.s.phase = p; this.s.pt = 0; }
    prog(k, p) { this.s.steps[k] = clip(p, 0, 100); }

    // ------------------------------------------------------------ commands
    command(cmd, value) {
      const s = this.s, c = this.cfg;
      if (cmd === "start") {
        if (s.faults.length) { this.log("Acknowledge the faults (RESET) before starting", "warn"); return; }
        s.mode = "auto";
        if (["OFF", "MANUAL", "SHUTDOWN"].includes(s.phase)) { this.goto("START"); s.stepIdx = 0; s.steps = this.steps.map(() => 0); this.log("START — automatic sequence started"); }
        else if (s.phase === "BRAKING") this.goto("RUN");
      } else if (cmd === "stop") {
        if (s.mode === "auto" && !["OFF", "SHUTDOWN", "BRAKING"].includes(s.phase)) {
          this.goto(s.mc && s.speed > 0.05 ? "BRAKING" : "SHUTDOWN");
          this.log("STOP — braking and shutdown");
        } else if (s.mode === "manual") s.throttle = s.speed > 0.1 ? -1 : 0;
      } else if (cmd === "emergency") this.emergency();
      else if (cmd === "reset") this.reset();
      else if (cmd === "mode") {
        if (value === "manual" && s.mode !== "manual") {
          s.mode = "manual"; s.phase = "MANUAL"; s.throttle = 0; s.f_cmd = s.fs;
          this.log("MANUAL mode — operate the equipment by clicking the diagram");
        } else if (value === "auto" && s.mode !== "auto") {
          s.mode = "auto";
          const allOff = !(s.brk || s.col_cmd || s.mc || s.esc || s.eng !== "off" || s.fc !== "off");
          this.goto(s.mc && s.flux > 0.9 ? "RUN" : allOff ? "OFF" : "SHUTDOWN");
          this.log("AUTOMATIC mode");
        }
      } else if (cmd === "toggle") this.toggle(String(value));
      else if (cmd === "set") this.set(value || {});
      else if (cmd === "config") this.config(value || {});
    }

    set(kv) {
      const s = this.s, c = this.cfg, D = this.D;
      for (const [k, v] of Object.entries(kv)) {
        if (k === "throttle") s.throttle = clip(+v, -1, 1);
        else if (k === "f_cmd") s.f_cmd = clip(+v, 0, 250);
        else if (k === "m_cmd") s.m_cmd = clip(+v, 0, 1.27);
        else if (k === "vf_auto") s.vf_auto = !!v;
        else if (k === "ctrl" && (v === "throttle" || v === "freq")) { if (v === "freq") s.f_cmd = s.fs; s.ctrl = v; }
        else if (k === "target_kmh") c.target_kmh = clip(+v, 0, D.veh ? D.veh.vmax : 0);
        else if (k === "time_scale") c.time_scale = clip(+v, 0.25, 10);
        else if (k === "lineV" && D.sup) c.lineV = clip(+v, D.sup.Umin2 * 0.9, D.sup.Umax2 * 1.05);
        else if (k === "recept") c.recept = clip(+v, 0, 1);
        else if (k === "tAmb") c.tAmb = clip(+v, -30, 45);
        else if (k === "grade") c.grade = clip(+v, -40, 40);
        else if (k === "rail" && RAIL[v]) c.rail = v;
        else if (k === "fswScale") c.fswScale = clip(+v, 0.5, 1.6);
      }
    }

    config(kv) {
      const c = this.cfg;
      if (this.s.speed > 0.1 && (kv.system || kv.supply || kv.vehicle || kv.levels !== undefined || kv.ess !== undefined)) {
        this.log("Stop the train before changing the system configuration", "warn");
        return;
      }
      let rebuild = false;
      if (kv.system && SYSTEMS[kv.system] && kv.system !== c.system) {
        c.system = kv.system;
        const sys = SYSTEMS[c.system];
        if (sys.supplies.length) c.supply = sys.def;
        c.vehicle = defaultVehicle(c.system, c.supply);
        c.ess = false;
        rebuild = true;
      }
      if (kv.supply && SYSTEMS[c.system].supplies.includes(kv.supply) && kv.supply !== c.supply) {
        c.supply = kv.supply;
        if (c.system === "dc_ohl") c.vehicle = defaultVehicle(c.system, c.supply);
        rebuild = true;
      }
      if (kv.vehicle && SYSTEMS[c.system].vehicles.includes(kv.vehicle) && kv.vehicle !== c.vehicle) { c.vehicle = kv.vehicle; rebuild = true; }
      if (kv.levels !== undefined && [2, 3].includes(+kv.levels) && +kv.levels !== c.levels) { c.levels = +kv.levels; rebuild = true; }
      if (kv.ess !== undefined && SYSTEMS[c.system].ess === "optional" && !!kv.ess !== c.ess) { c.ess = !!kv.ess; rebuild = true; }
      if (kv.pwm === "traction" || kv.pwm === "svpwm") c.pwm = kv.pwm;
      if (rebuild) {
        const sup = SUPPLIES[c.supply];
        if (SYSTEMS[c.system].supplies.length) c.lineV = sup.kind === "DC" ? Math.round(1.1 * sup.Un) : sup.Un;
        if (c.vehicle) c.target_kmh = Math.min(c.target_kmh, VEHICLES[c.vehicle].vmax);
        this.rebuild();
        const D = this.D;
        this.log(`System: ${D.sys.label}${D.sup ? " " + D.sup.label : ""}${D.veh ? " · " + D.veh.label : ""}`);
      }
    }

    toggle(id) {
      const s = this.s, D = this.D;
      if (s.mode !== "manual") { this.log("Switch to MANUAL mode to operate the equipment", "warn"); return; }
      const on = (x) => (x ? "ON" : "OFF");
      switch (id) {
        case "col":
          s.col_cmd = !s.col_cmd;
          if (!s.col_cmd && s.brk && Math.abs(s.i_line) > 20) { this.log("Collector lifted under load — electric arc!", "warn"); s.spark = 1; }
          this.log((D.collector === "shoe" ? "Collector shoes " : "Pantograph ") + (s.col_cmd ? "raising" : "lowering"));
          break;
        case "brk":
          if (!s.brk && s.faults.length) { this.log(`${D.brkName} blocked: active faults (RESET)`, "warn"); return; }
          if (!s.brk && D.src === "genset" && s.eng !== "run") { this.log("Start the diesel engine first", "warn"); return; }
          s.brk = !s.brk; this.log(`${D.brkName} ${s.brk ? "CLOSED" : "OPEN"}`);
          if (!s.brk) { s.lc = false; s.iL = 0; }
          break;
        case "chct": s.chct = !s.chct; this.log(`ChCt (pre-charge) ${s.chct ? "CLOSED" : "OPEN"}`); break;
        case "ctl": s.ctl = !s.ctl; this.log(`CtL ${s.ctl ? "CLOSED" : "OPEN"}`); if (!s.ctl && D.src === "acline") s.lc = false; break;
        case "lc":
          if (!s.lc && !this.canStartLC()) { this.log("Line converter start requires a pre-charged DC link", "warn"); return; }
          s.lc = !s.lc; this.log(`Line converter ${on(s.lc)}`);
          if (s.lc) this.startReg(this.reg.lc);
          break;
        case "esc":
          if (!D.bat) return;
          if (!s.esc && D.src !== "dcline" && D.src !== "acline" && D.src !== "genset" && !s.brk) { this.log("Close the battery main contactor first", "warn"); return; }
          s.esc = !s.esc; this.log(`ESC ${on(s.esc)}`);
          if (s.esc) this.startReg(this.reg.esc);
          break;
        case "fc":
          if (!D.fc_mod) return;
          if (s.fc === "off") { s.fc = "start"; s.fc_t = 0; this.log("Fuel cell start-up (purge, air supply)"); }
          else { s.fc = "off"; this.log("Fuel cell OFF"); }
          break;
        case "eng":
          if (D.src !== "genset") return;
          if (s.eng === "off") { s.eng = "crank"; this.log("Diesel engine cranking"); }
          else { s.eng = "off"; this.log("Diesel engine stop"); }
          break;
        case "hbu": case "hwr":
          if (!s[id] && s.vdc < 0.6 * D.vdc) { this.log(`${id.toUpperCase()} start requires DC link ≥ 60 %`, "warn"); return; }
          s[id] = !s[id]; this.log(`${id.toUpperCase()} ${on(s[id])}`);
          if (id === "hbu") s.hbu_t = 0;
          break;
        case "mc":
          if (!D.motor) return;
          if (!s.mc && s.vdc < D.mcVmin) { this.log(`Motor converter blocked: DC link ${s.vdc.toFixed(0)} V`, "warn"); return; }
          s.mc = !s.mc; s.f_cmd = s.fs; this.log(`Motor converter ${s.mc ? "ENABLED (pulses released)" : "DISABLED"}`);
          break;
      }
    }

    canStartLC() {
      const s = this.s, D = this.D;
      if (D.src === "acline") return s.brk && s.ctl && s.col_pos >= 1 && s.vdc > 0.75 * SQ2 * D.V2;
      if (D.src === "genset") return s.brk && s.vdc > 0.5 * 1.35 * D.Vgen * D.nIdle / D.nMax;
      return false;
    }

    startReg(r) { r.buf.fill(this.s.vdc); r.sum = this.s.vdc * r.buf.length; r.int = 0; this.s.vref = Math.max(this.s.vdc, 1); }

    emergency() {
      const s = this.s;
      s.emergency = true;
      s.mc = s.lc = s.esc = s.ctl = s.chct = s.brk = s.hbu = s.hbu_out = s.hwr = false;
      s.col_cmd = false; s.throttle = 0;
      if (s.fc !== "off") s.fc = "off";
      if (s.eng !== "off") s.eng = "off";
      if (s.mode === "auto") s.phase = "EMERGENCY";
      this.fault("EMERGENCY — everything open, emergency brake applied");
    }

    reset() {
      if (this.s.speed > 0.1) { this.log("RESET is only possible with the train at standstill", "warn"); return; }
      const keep = { mode: this.s.mode, pos: this.s.pos, soc: this.s.soc, h2: this.s.h2, fuel: this.s.fuel, E: this.s.E };
      this.s = newState(this.D);
      Object.assign(this.s, keep);
      this.s.phase = keep.mode === "manual" ? "MANUAL" : "OFF";
      this.s.steps = this.steps.map(() => 0);
      this.log("RESET");
    }

    // ----------------------------------------------------------- sequence
    sequence(dt) {
      const s = this.s;
      s.pt += dt;
      if (s.phase === "START") {
        const st = this.steps[s.stepIdx];
        if (!st) { this.goto("RUN"); return; }
        s.st_t = (s.st_t || 0) + dt;
        if (st.fn(this, s.stepIdx, s.st_t)) {
          this.prog(s.stepIdx, 100);
          s.stepIdx++; s.st_t = 0;
          if (s.stepIdx >= this.steps.length) {
            this.goto("RUN");
            this.log(this.D.traction ? `Traction available — target ${this.cfg.target_kmh.toFixed(0)} km/h` : "Auxiliary supply available");
          }
        }
      } else if (s.phase === "RUN") {
        if (this.D.traction) {
          const want = clip((this.cfg.target_kmh - s.speed * 3.6) / 4, -0.7, 1);
          s.throttle += clip(want - s.throttle, -0.6 * dt, 0.6 * dt);
        }
      } else if (s.phase === "BRAKING") {
        s.throttle += clip(-0.8 - s.throttle, -0.6 * dt, 0.6 * dt);
        if (s.speed < 0.05) { s.throttle = 0; this.log("Train stopped"); this.goto("SHUTDOWN"); }
      } else if (s.phase === "SHUTDOWN") {
        const pt = s.pt;
        s.throttle = 0;
        if (s.mc) { s.mc = false; this.log("Motor converter pulses blocked"); }
        if (pt >= 0.4 && (s.hbu || s.hwr)) { s.hbu = s.hbu_out = s.hwr = false; this.log("Auxiliary converters OFF"); }
        if (pt >= 0.8 && s.fc !== "off") { s.fc = "off"; this.log("Fuel cell OFF"); }
        if (pt >= 0.8 && s.lc) { s.lc = false; this.log("Line converter OFF"); }
        if (pt >= 0.8 && s.esc && this.D.essAddon) { s.esc = false; this.log("ESC OFF"); }
        if (pt >= 1.2 && (s.ctl || s.chct)) { s.ctl = s.chct = false; this.log("CtL OPEN"); }
        if (pt >= 1.2 && s.esc) { s.esc = false; this.log("ESC OFF"); }
        if (pt >= 1.8 && s.brk) { s.brk = false; this.log(`${this.D.brkName} OPEN`); }
        if (pt >= 2.4) {
          if (s.col_cmd) s.col_cmd = false;
          if (s.eng !== "off") { s.eng = "off"; this.log("Diesel engine stop"); }
        }
        s.steps = s.steps.map(() => 0);
        if (pt >= 2.4 && s.col_pos <= 0 && s.n_eng < 1) { this.log("System OFF"); this.goto("OFF"); }
      }
    }

    // ------------------------------------------------------------- devices
    devices(dt) {
      const s = this.s, D = this.D;
      s.spark = Math.max(0, s.spark - dt * 2);
      if (D.collector) {
        const up = D.collector === "shoe" ? 0.8 : 3, down = D.collector === "shoe" ? 0.5 : 2;
        s.col_pos = s.col_cmd ? Math.min(1, s.col_pos + dt / up) : Math.max(0, s.col_pos - dt / down);
        if (!s.col_cmd && s.col_pos < 1 && s.col_pos > 0.9 && Math.abs(s.i_line) > 20) s.spark = 1;
      }
      if (s.hbu) { s.hbu_t = (s.hbu_t || 0) + dt; if (!s.hbu_out && s.hbu_t > 1) { s.hbu_out = true; this.log("HBU output contactor closed — 3AC 400 V train bus live"); } }
      else s.hbu_out = false;

      // diesel engine
      if (D.src === "genset") {
        if (s.eng === "crank") { s.n_eng = Math.min(D.nIdle, s.n_eng + 400 * dt); if (s.n_eng >= D.nIdle) { s.eng = "run"; this.log(`Engine running at idle (${D.nIdle} rpm)`); } }
        else if (s.eng === "run") {
          const pdem = Math.max(0, s.p_src + (s.mc ? Math.max(0, s.p_mc - s.p_src) : 0));
          const nRef = D.nIdle + (D.nMax - D.nIdle) * Math.pow(clip(pdem / D.Peng, 0, 1), 0.6);
          s.n_eng += clip(nRef - s.n_eng, -150 * dt, 250 * dt);
        } else s.n_eng = Math.max(0, s.n_eng - 300 * dt);
        s.exc = s.eng === "run" ? Math.min(1, s.exc + dt / 2) : Math.max(0, s.exc - dt);
        s.p_eng_avail = s.eng === "run" ? D.Peng * clip((s.n_eng - 500) / (D.nMax - 500), 0.1, 1) : 0;
        const pOut = Math.max(0, s.p_src) / 0.96;
        const p = pOut / D.Peng;
        const bsfc = 198 + 70 * (1 - p) ** 2;
        s.fuel_rate = s.eng === "off" && s.n_eng < 1 ? 0 : (pOut / 1e3) * bsfc / 3600 + 0.8 * (s.n_eng / D.nIdle) ** 2; // g/s
        s.fuel = Math.max(0, s.fuel - s.fuel_rate * dt / 835);
        s.E.fuel += s.fuel_rate * dt / 835;
        if (s.fuel <= 0 && s.eng === "run") { s.eng = "off"; this.fault("Fuel tank empty — engine stopped"); }
      }

      // fuel cell
      if (D.fc_mod) {
        const F = D.fc_mod;
        if (s.fc === "start") { s.fc_t += dt; if (s.fc_t >= 8) { s.fc = "run"; this.log("Fuel cell online — FC converter injecting power"); } }
        let pRef = 0;
        if (s.fc === "run") {
          const pmax = F.n * F.Pgross;
          pRef = clip(s.p_load_avg + 2 * pmax * (0.6 - s.soc), 0.05 * pmax, pmax);
          if (s.h2 <= 0) { pRef = 0; this.fault("Hydrogen tank empty"); s.fc = "off"; }
        }
        s.p_fc_gross += clip(pRef - s.p_fc_gross, -2 * F.ramp * F.n * dt, F.ramp * F.n * dt);
        if (s.fc === "off") s.p_fc_gross = 0;
        // per-module cell current from the polarization curve
        const pm = s.p_fc_gross / F.n;
        let a = 0, b = 1.35;
        for (let k = 0; k < 30; k++) { const i = (a + b) / 2; if (F.cells * F.area * i * FC_CELL(i) < pm) a = i; else b = i; }
        const icd = (a + b) / 2;
        s.fc_vcell = FC_CELL(icd);
        s.fc_vstack = F.cells * s.fc_vcell;
        s.fc_i = icd * F.area;
        s.h2_rate = F.n * F.cells * s.fc_i / (2 * 96485) * 2.016e-3 / 0.95; // kg/s
        if (s.fc !== "off") { s.h2 = Math.max(0, s.h2 - s.h2_rate * dt); s.E.h2 += s.h2_rate * dt; }
        s.p_fc_dc = s.fc === "run" ? Math.max(0, (s.p_fc_gross - F.bop * s.p_fc_gross - 2e3) * 0.975) : 0;
        s.fc_eta = s.h2_rate > 0 ? s.p_fc_dc / (s.h2_rate * 33.33e3 * 3600) : 0;
      }

      // battery power limits (SoC dependent)
      if (D.bat) {
        const b = D.bat, ocv = b.ns * OCV[b.chem](s.soc);
        const pmaxCell = 0.8 * ocv * ocv / (4 * b.R);
        s.esc_pdis = Math.min(b.Pdis, pmaxCell) * clip((s.soc - 0.08) / 0.07, 0, 1);
        s.esc_pch = b.Pch * clip((0.97 - s.soc) / 0.07, 0, 1);
      }
      s.p_load_avg += ((s.p_mc + s.p_hbu + s.p_hwr) - s.p_load_avg) * Math.min(1, dt / 20);
    }

    // available power at the DC link for traction (supply, line current limit, engine, battery)
    powerAvailable() {
      const s = this.s, D = this.D, c = this.cfg;
      let P;
      if (D.src === "dcline") P = D.Ilim * Math.max(0, s.v_line);
      else if (D.src === "acline") P = D.Plc * Math.min(1, c.lineV / (0.9 * D.sup.Un));
      else if (D.src === "genset") P = s.p_eng_avail * 0.96;
      else P = s.esc_pdis + s.p_fc_dc;
      const lineLost = !this.sourceConnected();
      if (D.essAddon && s.esc) P = (lineLost ? 0 : P) + s.esc_pdis;
      return Math.max(0, P - s.p_hbu - s.p_hwr);
    }

    sourceConnected() {
      const s = this.s, D = this.D;
      const col = D.collector ? s.col_pos >= 1 : true;
      if (D.src === "dcline") return col && s.brk && s.ctl;
      if (D.src === "acline") return col && s.brk && s.ctl && s.lc;
      if (D.src === "genset") return s.brk && s.lc;
      return s.brk && s.esc;
    }

    // ------------------------------------------------------------ pulse pattern
    pulsePattern(fs, m) {
      const s = this.s, D = this.D, c = this.cfg;
      const fc = D.fc * c.fswScale, dev = (f) => (D.levels === 3 ? f / 2 : f);
      if (!s.mc || fs <= 0) { s.pulseN = 0; return { mode: "off", fc: 0, fdev: 0 }; }
      if (c.pwm === "svpwm") { s.pulseN = 0; return { mode: "async", fc, fdev: dev(fc), label: `Async SVPWM ${fc.toFixed(0)} Hz` }; }
      if (m >= 1.22) { s.pulseN = -1; return { mode: "block", fc: fs, fdev: fs, label: "Block (six-step)" }; }
      if (fc / fs >= 21) { s.pulseN = 0; return { mode: "async", fc, fdev: dev(fc), label: `Async SVPWM ${fc.toFixed(0)} Hz` }; }
      const Ns = [21, 15, 9, 7, 5, 3];
      const fits = (N) => N * fs <= fc * 1.1;
      let N = s.pulseN > 0 ? s.pulseN : 0;
      if (!N || !fits(N) || (N * fs < 0.6 * fc && Ns.some((x) => x > N && fits(x)))) N = Ns.find(fits) || 3;
      s.pulseN = N;
      return { mode: "sync", N, fc: N * fs, fdev: dev(N * fs), label: `Synchronous ${N}-pulse` };
    }

    mcLoss(Itot, vdc, fdev) {
      const D = this.D, k = Itot / D.mcIr;
      return 0.0075 * D.Pmc * k * (0.35 + 0.65 * k) + 0.0075 * D.Pmc * (fdev / D.fswDev) * (vdc / D.vdc) * k + (this.s.mc ? 0.001 * D.Pmc : 0);
    }

    // ------------------------------------------------------------- traction
    traction(dt) {
      const s = this.s, D = this.D, c = this.cfg, M = D.motor;
      if (!M) { s.p_mc = 0; s.force = 0; return; }
      const veh = D.veh, v = s.speed, kmh = v * 3.6, fRot = M.fRot(v);
      s.flux = s.mc ? Math.min(1, s.flux + dt / 0.6) : Math.max(0, s.flux - dt / 0.2);
      const mmax = c.pwm === "traction" ? 4 / PI : 2 / SQ3;
      const mu = (0.161 + 7.5 / (kmh + 44)) * RAIL[c.rail];
      s.f_adh = mu * veh.mass * 1e3 * veh.adh * GRAV;
      const ok = s.mc && s.flux > 0.05 && s.vdc > 0.5 * D.mcVmin;
      const Ilim = 2.0 * M.Ir;
      const thermal = clip((135 - s.t_j) / 10, 0, 1) * clip((200 - s.t_mot) / 20, 0, 1);
      const pAvail = this.powerAvailable();
      s.motor_k_f = 0.7 * (s.motor_k_f ?? 1) + 0.3 * (s.motor_k ?? 1);
      const pWheelLim = Math.min(M.nm * M.P * M.etaG, pAvail * 0.95 * 0.93) * thermal * clip(s.motor_k_f, 0.05, 1);
      const regenDer = s.regen_k === undefined ? 1 : clip(s.regen_k_f = 0.7 * (s.regen_k_f ?? 1) + 0.3 * s.regen_k, 0.05, 1);

      let Fe = 0, Fm = 0, op = null, lim = "";
      const solveF = (F) => {
        const T = F >= 0 ? F * M.r / (M.nm * M.gear * M.etaG) : F * M.r * M.etaG / (M.nm * M.gear);
        const o = motorSolve(M, fRot, T, s.vdc, mmax, s.flux, Ilim);
        o.F = o.T >= 0 ? o.T * M.nm * M.gear * M.etaG / M.r : o.T * M.nm * M.gear / (M.r * M.etaG);
        return o;
      };

      if (s.emergency) Fm = -1.2 * veh.mass * 1e3;
      else if (s.mode === "manual" && s.ctrl === "freq") {
        if (ok) {
          s.fs += clip(s.f_cmd - s.fs, -10 * dt, 10 * dt);
          const V = s.vf_auto ? vfLaw(M, s.fs, s.vdc, mmax, s.flux) : Math.min(s.m_cmd, mmax) * s.vdc / (2 * SQ2) * s.flux;
          op = motorEval(M, s.fs, s.fs - fRot, V);
          op.F = op.T * M.nm * M.gear * (op.T >= 0 ? M.etaG : 1 / M.etaG) / M.r;
          op.limit = "";
          if (op.Is > 2.2 * M.Ir) { s.mc = false; this.fault(`Motor converter overcurrent (${(op.Is * M.nm).toFixed(0)} A) — slip too high`); }
          Fe = op.F;
          if (Math.abs(Fe) > s.f_adh) { this.warnOnce("slip" + Math.floor(s.t), "Wheel slip/slide — adhesion exceeded"); Fe = Math.sign(Fe) * s.f_adh; }
        } else s.fs = 0;
      } else {
        let thr = s.throttle;
        if (kmh >= veh.vmax && thr > 0) thr = 0;
        if (thr > 0 && ok) {
          const lims = [[veh.fmax * 1e3, "max effort"], [pWheelLim / Math.max(v, 0.5), "power"], [s.f_adh, "adhesion"]];
          let Fd = Infinity;
          for (const [f, n] of lims) if (f < Fd) { Fd = f; lim = n; }
          op = solveF(thr * Fd);
          Fe = op.F;
          if (op.limit) lim = op.limit;
          if (thr < 0.999) lim = "";
        } else if (thr < 0) {
          const Fd = -thr * veh.bmax * 1e3;
          const fade = clip((kmh - 2) / 4, 0, 1);
          let cap = ok ? Math.min(Fd, 1.15 * M.nm * M.P / Math.max(v, 0.5), s.f_adh) * fade * regenDer : 0;
          if (cap > 0) { op = solveF(-cap); Fe = op.F; }
          Fm = -(Fd - Math.abs(Fe));
        } else if (ok) op = solveF(0);
      }

      if (op && s.mc) {
        s.fs = op.fs; s.fsl = op.fsl; s.V = op.V; s.m = op.V * 2 * SQ2 / Math.max(s.vdc, 1);
        s.Is = op.Is * M.nm; s.phi = op.phi; s.pf = op.pf; s.torque = op.T;
        const pulse = this.pulsePattern(s.fs, s.m);
        s.pulse = pulse;
        s.p_loss_mc = this.mcLoss(s.Is, s.vdc, pulse.fdev);
        s.p_mc = M.nm * op.Pin + s.p_loss_mc;
        s.p_mot_loss = M.nm * (op.Pcu + op.Pfe) + 0.005 * Math.abs(Fe * v);
        s.eta_m = op.Pin > 0 ? (Fe * v / M.etaG) / (M.nm * op.Pin) : op.Pin < 0 ? (M.nm * op.Pin) / (Fe * v * M.etaG || -1) : 0;
      } else {
        s.fs = s.mc ? s.fs : 0; s.m = 0; s.Is = 0; s.torque = 0; s.pf = 0; s.p_loss_mc = s.mc ? 0.001 * D.Pmc : 0;
        s.p_mc = s.p_loss_mc; s.p_mot_loss = 0; s.pulse = s.mc ? s.pulse : { mode: "off" }; s.eta_m = 0;
        if (!s.mc) { s.pulseN = 0; s.pulse = { mode: "off" }; }
      }
      if (!s.mc) Fe = 0;
      s.limit = lim;
      s.force = Fe;
      s.force_mech = Fm;
      s.p_wheel = Fe * v;
    }

    // --------------------------------------------------------------- aux
    aux(dt) {
      const s = this.s, D = this.D, c = this.cfg;
      const P = D.Paux;
      // air system: compressor cycles between 8.5 and 10 bar
      const mechUse = Math.min(1, Math.abs(s.force_mech) / ((D.veh ? D.veh.bmax : 100) * 1e3));
      s.p_air -= (0.004 + 0.03 * mechUse) * dt;
      if (s.p_air < 8.5 && s.hbu_out) s.comp = true;
      if (s.p_air > 10 || !s.hbu_out) s.comp = false;
      if (s.comp) s.p_air += 0.08 * dt;
      s.p_air = clip(s.p_air, 0, 10.2);
      if (s.hbu && s.vdc > 0.5 * D.vdc) {
        const hvac = 0.55 * P * clip(0.35 + Math.abs(c.tAmb - 20) / 25, 0.35, 1.25);
        s.aux_loads = s.hbu_out ? { hvac, light: 0.12 * P, charger: 0.08 * P, comp: s.comp ? 0.18 * P : 0 } : { hvac: 0, light: 0, charger: 0, comp: 0 };
        const out = Object.values(s.aux_loads).reduce((a, b) => a + b, 0);
        s.p_hbu_out = out;
        s.p_hbu = out / 0.94 + 0.01 * D.Shbu;
      } else { s.p_hbu = 0; s.p_hbu_out = 0; s.aux_loads = { hvac: 0, light: 0, charger: 0, comp: 0 }; }
      if (s.hwr && s.vdc > 0.5 * D.vdc) {
        const demand = Math.max((s.t_hs - 35) / 30, (s.t_mot - 50) / 70, (s.t_vlu - 150) / 300, s.mc ? 0.15 : 0, s.lc ? 0.3 : 0);
        const fT = 20 + 30 * clip(demand, 0, 1);
        s.f_hwr += clip(fT - s.f_hwr, -5 * dt, 5 * dt);
        s.f_hwr = Math.max(s.f_hwr, 20);
        s.p_hwr = D.Phwr * (s.f_hwr / 50) ** 3 / 0.94;
      } else { s.f_hwr = Math.max(0, s.f_hwr - 10 * dt); s.p_hwr = 0; }
    }

    // ESS add-on energy management (power mode); grid-forming handled in the sub-steps
    ems() {
      const s = this.s, D = this.D;
      if (!D.essAddon || !s.esc) { s.p_esc_cmd = 0; return; }
      let P = 0;
      if (s.p_mc < 0) P = -Math.min(-s.p_mc, s.esc_pch);           // store braking energy
      else if (s.p_mc > 0.7 * D.Pmc) P = Math.min(s.p_mc - 0.7 * D.Pmc, s.esc_pdis); // peak shaving
      if (s.p_mc >= 0 && s.p_mc < 0.3 * D.Pmc && s.soc < 0.55) P = -0.15 * D.bat.Pch; // recharge when lightly loaded
      s.p_esc_cmd = P;
    }

    // ---------------------------------------------------- DC link sub-steps
    electrical(dt) {
      const s = this.s, D = this.D, c = this.cfg, C = D.C;
      const n = Math.max(1, Math.round(dt / DT_SUB)), h = dt / n;
      const pLoad = s.p_mc + s.p_hbu + s.p_hwr;
      const col = D.collector ? s.col_pos >= 1 : true;
      const lineConn = this.sourceConnected();
      const discharge = !s.brk && !s.esc && !s.mc && !s.hbu && (s.phase === "OFF" || s.mode === "manual" || s.phase === "EMERGENCY" || s.phase === "SHUTDOWN");
      const Imax = 3 * Math.max(D.Pline, 2e5) / D.vdc;
      const damp = D.src === "dcline" && s.mc, tauD = D.f0 ? 1 / (2 * PI * 0.25 * D.f0) : 0.02;
      if (!s.vlp) s.vlp = s.vdc;
      const vR1 = D.Von + 0.02 * D.vdc, vR2 = Math.min(D.Von + 0.06 * D.vdc, 0.98 * D.Vovp);
      let rk = 0, nr = 0, mk = 0, nm = 0;
      const vU1 = D.src === "dcline" ? 0.88 * D.sup.Umin2 : 0.8 * D.vdc, vU2 = D.src === "dcline" ? 0.98 * D.sup.Umin2 : 0.92 * D.vdc;
      let psrc = 0, pvlu = 0, pesc = 0, imax = 0, iline = 0, vline = 0, vmax = 0;
      const B = this.buf;
      for (let k = 0; k < n; k++) {
        const v = s.vdc;
        let iSrc = 0, vS = 0, iShow = 0, iEsc = 0;
        if (D.src === "dcline") {
          const Vnl = col ? c.lineV : 0;
          if (col && s.brk && (s.ctl || s.chct)) {
            const Rc = this.rCat(s.iL), R = Rc + D.RL + (s.ctl ? 0 : D.Rpre);
            const iInf = (Vnl - v) / R;
            s.iL = iInf + (s.iL - iInf) * Math.exp(-R * h / D.L);
          } else s.iL = 0;
          iSrc = s.iL; iShow = s.iL;
          vS = Vnl - (s.brk ? this.rCat(s.iL) * s.iL : 0);
          iline += s.iL; vline += vS;
        } else if (D.src === "acline") {
          s.th += 2 * PI * D.fg * h;
          const V2 = D.V2 * c.lineV / D.sup.Un;
          const v2 = col && s.brk ? SQ2 * V2 * Math.sin(s.th) : 0;
          vS = v2;
          if (s.lc && s.brk && s.ctl && col) {
            const P = this.regulate(this.reg.lc, v, h, -D.Plc, D.Plc * Math.min(1, c.lineV / (0.9 * D.sup.Un)), pLoad - (s.esc ? s.p_esc_cmd : 0));
            iSrc = P * (1 - Math.cos(2 * s.th)) / Math.max(v, 50);
            s.i2 = SQ2 * P / V2 * Math.sin(s.th);
            psrc += P;
          } else if (col && s.brk && (s.ctl || s.chct)) {
            iSrc = Math.max(0, Math.abs(v2) - v) / (s.ctl ? D.Rtr : D.Rpre);
            s.i2 = Math.sign(v2) * iSrc;
            psrc += iSrc * v;
          } else s.i2 = 0;
          iShow = s.i2;
          vline += c.lineV; iline += Math.abs(s.i2) * V2 / c.lineV * (PI / (2 * SQ2));
        } else if (D.src === "genset") {
          if (s.brk && s.exc > 0) {
            const E = D.Vgen * (s.n_eng / D.nMax) * s.exc;
            vS = 1.35 * E;
            if (s.lc) { const P = this.regulate(this.reg.lc, v, h, 0, s.p_eng_avail * 0.96, pLoad - (s.esc ? s.p_esc_cmd : 0)); iSrc = P / Math.max(v, 50); psrc += P; }
            else { iSrc = Math.max(0, vS - v) / D.Rgen; psrc += iSrc * v; }
          }
          iShow = iSrc; vline += vS; iline += iSrc;
        } else {
          if (s.esc && s.brk) {
            const P = this.regulate(this.reg.esc, v, h, -s.esc_pch, s.esc_pdis, pLoad - s.p_fc_dc);
            iEsc = P / Math.max(v, 50); pesc += P;
          }
          vS = s.v_bat; iShow = iEsc; vline += s.v_bat;
        }
        // ESS add-on: grid-forming when the main source is lost, otherwise power command
        if (D.essAddon && s.esc) {
          const P = lineConn ? clip(s.p_esc_cmd, -s.esc_pch, s.esc_pdis)
            : this.regulate(this.reg.esc, v, h, -s.esc_pch, s.esc_pdis, pLoad);
          iEsc = P / Math.max(v, 50); pesc += P;
        }
        const iFc = s.p_fc_dc / Math.max(v, 50);
        // VLU hysteresis chopper
        if (D.vlu && s.vlu_duty > 0) { if (v > D.Von) s.vlu_on = true; else if (v < D.Voff) s.vlu_on = false; } else s.vlu_on = false;
        const iV = s.vlu_on ? v / D.Rvlu * s.vlu_duty : 0;
        pvlu += iV * v;
        // 2f series-resonant filter (always connected to the DC link)
        let i2f = 0;
        if (D.f2) {
          s.i2f += (v - s.v2f - D.R2 * s.i2f) / D.L2 * h;
          s.v2f += s.i2f / D.C2 * h;
          i2f = s.i2f;
        }
        // active DC link stabilization: the motor converter behaves resistively at the filter resonance
        s.vlp += (v - s.vlp) * h / tauD;
        let pMc = damp ? s.p_mc * (v / Math.max(s.vlp, 1)) ** 2 : s.p_mc;
        // fast regenerative voltage limiter (inside the MC control loop)
        if (pMc < 0) { const kr = clip((vR2 - v) / (vR2 - vR1), 0, 1); pMc *= kr; rk += kr; nr++; }
        // undervoltage power limiter: traction reduced when the supply cannot hold the DC link
        else if (pMc > 0) { const km = clip((v - vU1) / (vU2 - vU1), 0, 1); pMc *= km; mk += km; nm++; }
        const iLoad = v > 30 ? Math.min((pMc + s.p_hbu + s.p_hwr) / v, Imax) : 0;
        const iDis = discharge ? v / (3 / C) : 0; // discharge resistor (tau = 3 s) when the converter is switched off
        s.vdc = Math.max(0, v + (iSrc + iEsc + iFc - iLoad - iV - i2f - iDis) * h / C);
        if (D.src === "dcline") psrc += iSrc * v;
        imax = Math.max(imax, Math.abs(D.src === "acline" ? s.i2 : iSrc));
        // fast breaker: opens within the sub-step when the trip current is exceeded
        if (s.brk && imax > D.Itrip && (D.src === "dcline" || D.src === "acline")) { s.trip_i = imax; s.brk = false; s.iL = 0; s.i2 = 0; }
        vmax = Math.max(vmax, s.vdc);
        B.v[B.k] = s.vdc; B.s[B.k] = vS; B.i[B.k] = iShow; B.k = (B.k + 1) % B.n;
      }
      s.p_src = psrc / n; s.p_vlu = pvlu / n; s.p_esc = pesc / n;
      s.regen_k = nr ? rk / nr : 1;
      if (nr) { s.p_mc *= s.regen_k; }
      s.motor_k = nm ? mk / nm : 1;
      if (nm) { s.p_mc *= s.motor_k; }
      s.i_line = iline / n; s.v_line = vline / n;
      s.imax = imax; s.vmax_tick = vmax;
      if (D.src === "acline") s.i_line = s.p_src / Math.max(c.lineV, 1);
    }

    regulate(r, v, h, Pmin, Pmax, Pff) {
      const s = this.s, D = this.D;
      r.sum += v - r.buf[r.idx]; r.buf[r.idx] = v; r.idx = (r.idx + 1) % r.buf.length;
      const vf = r.sum / r.buf.length;
      s.vref += clip(D.vdc - s.vref, -0.6 * D.vdc * h, 0.6 * D.vdc * h);
      const e = 0.5 * D.C * (s.vref * s.vref - vf * vf);
      let P = Pff + 40 * e + r.int;
      if (P > Pmax) { P = Pmax; if (e < 0) r.int += 400 * e * h; }
      else if (P < Pmin) { P = Pmin; if (e > 0) r.int += 400 * e * h; }
      else r.int += 400 * e * h;
      const lim = Math.max(Math.abs(Pmax), Math.abs(Pmin), 1e4);
      r.int = clip(r.int, -lim, lim);
      return P;
    }

    rCat(i) {
      const L = this.D.line, x = (this.s.pos / 1000) % L.spacing;
      const R = L.rkm * x * (L.spacing - x) / L.spacing + L.Rss;
      return i < 0 ? R / Math.max(this.cfg.recept, 0.01) : R;
    }

    // -------------------------------------------------------------- battery
    battery(dt) {
      const s = this.s, D = this.D, b = D.bat;
      if (!b) return;
      const P = s.p_esc > 0 ? s.p_esc / 0.98 : s.p_esc * 0.98;
      const ocv = b.ns * OCV[b.chem](s.soc);
      const disc = ocv * ocv - 4 * b.R * P;
      const I = disc > 0 ? (ocv - Math.sqrt(disc)) / (2 * b.R) : ocv / (2 * b.R);
      s.i_bat = I;
      s.v_bat = s.brk || D.essAddon ? ocv - b.R * I : ocv;
      s.soc = clip(s.soc - I * dt / (b.Ah * 3600), 0, 1);
      if (P > 0) s.E.batOut += P * dt; else s.E.batIn += -P * dt;
      if (s.soc <= 0.05 && s.esc && D.src === "battery") this.fault("Battery empty (SoC < 5 %) — ESC stopped");
    }

    // --------------------------------------------------------------- thermal
    thermal(dt) {
      const s = this.s, D = this.D, c = this.cfg;
      const fan = s.f_hwr / 50, cool = 0.25 + 0.75 * fan;
      const Tamb = c.tAmb;
      if (D.motor) {
        s.t_hs += ((s.p_loss_mc - (s.t_hs - Tamb) * cool / D.Rth_hs) / D.Cth_hs) * dt;
        s.t_j = s.t_hs + 22 * s.p_loss_mc / Math.max(0.0165 * D.Pmc, 1);
        s.t_mot += ((s.p_mot_loss || 0) / D.motor.nm - (s.t_mot - Tamb) * cool / D.Rth_m) / D.Cth_m * dt;
        if (s.t_j > 125) this.warnOnce("tj", "IGBT junction temperature > 125 °C — traction derated");
      }
      if (D.vlu) {
        s.t_vlu += ((s.p_vlu - (s.t_vlu - Tamb) / D.Rth_v) / D.Cth_v) * dt;
        s.vlu_duty = clip((650 - s.t_vlu) / 100, 0, 1);
        if (s.t_vlu > 550) this.warnOnce("vlu", "Brake resistor > 550 °C — VLU power reduced");
      }
    }

    // ---------------------------------------------------------- train motion
    dynamics(dt) {
      const s = this.s, D = this.D, c = this.cfg;
      if (!D.veh) return;
      const veh = D.veh, v = s.speed;
      const [A, Bd, Cd] = veh.davis;
      const res = v > 0.01 ? A + Bd * v + Cd * v * v : 0;
      const grade = veh.mass * 1e3 * GRAV * c.grade / 1000;
      const mEff = veh.mass * 1e3 * 1.08;
      let F = s.force + s.force_mech - res - grade;
      const hold = s.throttle <= 0 || !s.mc || s.emergency;
      if (v <= 0 && F < 0 && hold) F = 0;
      if (v <= 0 && F < 0 && !hold && s.force <= grade) F = 0;
      const vn = Math.max(0, v + F / mEff * dt);
      const ds = 0.5 * (v + vn) * dt;
      s.pos += ds; s.E.dist += ds;
      s.speed = vn;
      s.accel = (vn - v) / dt;
    }

    // ------------------------------------------------------------ protection
    protect(dt) {
      const s = this.s, D = this.D, c = this.cfg;
      if (s.trip_i || (s.brk && s.imax > D.Itrip)) {
        const what = D.src === "dcline" ? "HSCB" : D.src === "acline" ? "VCB" : D.brkName;
        s.imax = s.trip_i || s.imax; s.trip_i = 0;
        s.brk = false; s.ctl = false; s.chct = false; s.lc = false; s.iL = 0;
        this.fault(`${what} tripped — overcurrent ${s.imax.toFixed(0)} A (trip ${D.Itrip.toFixed(0)} A)`);
      }
      if (s.vmax_tick > D.Vovp) {
        s.mc = false; s.lc = false;
        if (D.src === "dcline" || D.src === "acline") { s.ctl = false; s.brk = false; }
        this.fault(`DC link overvoltage ${s.vmax_tick.toFixed(0)} V — converters blocked`);
      }
      if (s.mc && s.vdc < D.Vuv) { s.uv_t += dt; if (s.uv_t > 0.15) { s.mc = false; this.fault(`DC link undervoltage (${s.vdc.toFixed(0)} V) — motor converter blocked`); } }
      else s.uv_t = 0;
      if (D.sup && s.brk && (!D.collector || s.col_pos >= 1)) {
        if (c.lineV > D.sup.Umax2) this.warnOnce("umax2", `Line voltage ${c.lineV.toFixed(0)} V above Umax2 (${D.sup.Umax2} V, EN 50163)`);
        if (c.lineV < D.sup.Umin2) this.warnOnce("umin2", `Line voltage ${c.lineV.toFixed(0)} V below Umin2 (${D.sup.Umin2} V, EN 50163)`);
      }
    }

    energy(dt) {
      const s = this.s, E = s.E;
      const pin = D_src(this) ;
      if (pin > 0) E.src += pin * dt; else E.regen += -pin * dt;
      E.vlu += s.p_vlu * dt;
      E.aux += (s.p_hbu + s.p_hwr) * dt;
      if (s.p_wheel > 0) E.trac += s.p_wheel * dt; else E.brake += -s.p_wheel * dt;
    }

    step(dt) {
      const s = this.s;
      s.t += dt;
      if (s.mode === "auto") this.sequence(dt);
      this.devices(dt);
      this.traction(dt);
      this.aux(dt);
      this.ems();
      this.electrical(dt);
      this.battery(dt);
      this.thermal(dt);
      this.dynamics(dt);
      this.protect(dt);
      this.energy(dt);
      if (s.emergency && s.speed <= 0 && s.col_pos <= 0) s.emergency = false;
    }

    // ------------------------------------------------------------- snapshot
    snapshot(wave) {
      const s = this.s, D = this.D, c = this.cfg;
      const d = JSON.parse(JSON.stringify(s));
      d.step_names = this.steps.map((x) => x.name);
      d.speed_kmh = s.speed * 3.6;
      d.f_rotor = D.motor ? D.motor.fRot(s.speed) : 0;
      d.rpm = D.motor ? s.speed * D.motor.gear / D.motor.r * 60 / (2 * PI) : 0;
      d.cfg = { ...c };
      d.D = designSummary(D);
      d.events = this.events.slice(-40);
      d.dist_ss = D.line ? Math.min((s.pos / 1000) % D.line.spacing, D.line.spacing - (s.pos / 1000) % D.line.spacing) : null;
      d.lineConnected = this.sourceConnected();
      if (wave) { d.wave = this.waves(); d.zoom = this.zoom(); }
      return d;
    }

    zoom() {
      const B = this.buf, n = B.n, out = { t: [], v: [], s: [], i: [] };
      for (let k = 0; k < n; k++) {
        const j = (B.k + k) % n;
        out.t.push(+(k * DT_SUB * 1000).toFixed(2));
        out.v.push(Math.round(B.v[j])); out.s.push(Math.round(B.s[j])); out.i.push(Math.round(B.i[j] * 10) / 10);
      }
      return out;
    }

    // phase-leg PWM for three phases at angles th[] (rad), absolute time ta[] (s)
    modulate(th, ta, m, pulse) {
      const L = this.D.levels, n = th.length;
      const ref = [[], [], []], pole = [[], [], []], cu = [], cl = [];
      const tri = (x) => 1 - 4 * Math.abs(x - Math.floor(x) - 0.5);
      for (let i = 0; i < n; i++) {
        const r = [0, 1, 2].map((k) => m * Math.sin(th[i] - k * 2 * PI / 3));
        const z = -(Math.max(...r) + Math.min(...r)) / 2;
        let car = 0;
        if (pulse.mode === "sync") car = tri(pulse.N * th[i] / (2 * PI) + 0.5);
        else if (pulse.mode === "async") car = tri(pulse.fc * ta[i] + 0.37);
        cu.push(L === 3 ? (car + 1) / 2 : car); cl.push(L === 3 ? (car + 1) / 2 - 1 : null);
        for (let k = 0; k < 3; k++) {
          const x = clip(r[k] + z, -1.2, 1.2);
          ref[k].push(x);
          let p;
          if (pulse.mode === "block") { const sn = Math.sin(th[i] - k * 2 * PI / 3); p = L === 3 ? (Math.abs(sn) > 0.2588 ? Math.sign(sn) : 0) : (sn >= 0 ? 1 : -1); }
          else if (L === 3) { const u = (car + 1) / 2; p = x > u ? 1 : x < u - 1 ? -1 : 0; }
          else p = x > car ? 1 : -1;
          pole[k].push(p);
        }
      }
      return { ref, pole, cu, cl };
    }

    waves() {
      const s = this.s, D = this.D;
      if (!D.motor) return null;
      const V = s.vdc / 2, f = s.fs, n = 2000;
      const W = f < 1 ? 0.1 : clip(2 / f, 0.02, 0.1);
      const t = [], th = [], ta = [];
      for (let i = 0; i < n; i++) { const x = W * i / n; t.push(x); th.push(2 * PI * f * x); ta.push(s.t + x); }
      const on = s.mc && s.pulse.mode !== "off";
      const P = on ? this.modulate(th, ta, s.m, s.pulse) : null;
      const pole = on ? P.pole.map((a) => a.map((x) => x * V)) : [0, 1, 2].map(() => new Array(n).fill(0));
      const van = pole[0].map((x, i) => x - (x + pole[1][i] + pole[2][i]) / 3);
      const uab = pole[0].map((x, i) => x - pole[1][i]);
      const M = D.motor, Ls = (M.Lls + M.Llr) / M.nm, ipk = s.Is * SQ2, dtt = W / n;
      const cur = [0, 1, 2].map((k) => {
        const base = th.map((x) => ipk * Math.sin(x - k * 2 * PI / 3 - s.phi));
        if (!on) return base;
        const vk = pole[k].map((x, i) => x - (x + pole[(k + 1) % 3][i] + pole[(k + 2) % 3][i]) / 3);
        const rip = new Float64Array(n);
        let acc = 0;
        for (let i = 0; i < n; i++) { acc += (vk[i] - s.m * V * Math.sin(th[i] - k * 2 * PI / 3)) * dtt / Ls; rip[i] = acc; }
        // remove mean and linear drift
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = 0; i < n; i++) { sx += i; sy += rip[i]; sxx += i * i; sxy += i * rip[i]; }
        const bb = (n * sxy - sx * sy) / (n * sxx - sx * sx), aa = (sy - bb * sx) / n;
        return base.map((x, i) => x + rip[i] - (aa + bb * i));
      });
      const r1 = (a) => a.map((x) => Math.round(x * 10) / 10);
      const out = {
        t: t.map((x) => +(x * 1000).toFixed(3)), V,
        ref: on ? r1(P.ref[0].map((x) => x * V)) : new Array(n).fill(0),
        cu: on && s.pulse.mode !== "block" ? r1(P.cu.map((x) => x * V)) : new Array(n).fill(null),
        cl: on && D.levels === 3 && s.pulse.mode !== "block" ? r1(P.cl.map((x) => x * V)) : new Array(n).fill(null),
        pole: r1(pole[0]), van: r1(van), uab: r1(uab), ia: r1(cur[0]), ib: r1(cur[1]), ic: r1(cur[2]),
        spec: on && f >= 1 ? this.spectrum(V, f) : null,
      };
      return out;
    }

    spectrum(V, f) {
      const s = this.s, D = this.D;
      const periods = s.pulse.mode === "async" ? Math.max(1, Math.round(0.15 * f)) : 1;
      const T = periods / f, n = 8192;
      const th = [], ta = [];
      for (let i = 0; i < n; i++) { th.push(2 * PI * f * T * i / n); ta.push(T * i / n); }
      const P = this.modulate(th, ta, s.m, s.pulse);
      const uab = P.pole[0].map((x, i) => (x - P.pole[1][i]) * V);
      const X = rfftMag(uab);
      for (let i = 0; i < X.length; i++) X[i] *= 2 / n;
      const k = periods, fund = X[k];
      let s2 = 0;
      for (let i = 1; i < X.length; i++) s2 += X[i] * X[i];
      const thd = fund > 1e-6 ? Math.sqrt(Math.max(0, s2 - fund * fund)) / fund * 100 : null;
      // current THD: harmonic currents limited by the leakage inductance
      const M = D.motor, Ls = (M.Lls + M.Llr) / M.nm;
      let si = 0;
      for (let i = 1; i < X.length; i++) if (i !== k) { const ih = X[i] / SQ3 / (2 * PI * (i / T) * Ls); si += ih * ih; }
      const thdI = s.Is > 1 ? Math.sqrt(si) / (s.Is * SQ2) * 100 : null;
      const df = 1 / T, fmaxShow = Math.max(3.3 * (s.pulse.mode === "async" ? s.pulse.fc : s.pulse.fc || f * 9), 25 * f);
      const nb = Math.min(Math.floor(fmaxShow / df), X.length - 1);
      const fr = [], a = [];
      for (let i = 1; i < nb; i++) { fr.push(Math.round(i * df * 100) / 100); a.push(Math.round(X[i] * 10) / 10); }
      return { f: fr, a, thd_uab: thd, thd_i: thdI, fund_uab: fund };
    }

    // -------------------------------------------------- performance curves
    curves() {
      if (this.curvesCache) return this.curvesCache;
      const D = this.D, M = D.motor;
      if (!M) return null;
      const veh = D.veh, c = this.cfg;
      const mmax = c.pwm === "traction" ? 4 / PI : 2 / SQ3;
      const Ilim = 2.0 * M.Ir;
      const lineCases = D.src === "dcline" ? [["nominal", D.sup.Un], ["Umin1", D.sup.Umin1]] : D.src === "acline" ? [["nominal", D.sup.Un], ["Umin1", D.sup.Umin1]] : [["nominal", null]];
      const out = { v: [], trac: lineCases.map(() => []), brake: [], res: [], labels: lineCases.map((x) => x[0] === "nominal" ? (D.sup ? `Traction at ${D.sup.label}` : "Traction") : `Traction at Umin1 (${x[1]} V)`) };
      for (let kmh = 0; kmh <= veh.vmax + 0.01; kmh += veh.vmax / 80) {
        const v = kmh / 3.6, fRot = M.fRot(v);
        out.v.push(+kmh.toFixed(1));
        const fadh = (0.161 + 7.5 / (kmh + 44)) * veh.mass * 1e3 * veh.adh * GRAV;
        lineCases.forEach(([, U], j) => {
          let vdc = D.vdc, P = M.nm * M.P * M.etaG;
          if (D.src === "dcline") { vdc = U; P = Math.min(P, D.Ilim * U * 0.95 * 0.93 - D.Paux); }
          if (D.src === "acline") P = Math.min(P, D.Plc * Math.min(1, U / (0.9 * D.sup.Un)) * 0.95 * 0.93 - D.Paux);
          if (D.src === "genset") P = Math.min(P, (D.Peng * 0.96 - D.Paux) * 0.95 * 0.93);
          if (D.src === "battery" || D.src === "fuelcell") P = Math.min(P, (D.bat.Pdis + (D.fc_mod ? D.fc_mod.n * D.fc_mod.Pgross * 0.88 : 0) - D.Paux) * 0.95 * 0.93);
          const Fd = Math.min(veh.fmax * 1e3, P / Math.max(v, 0.5), fadh);
          const T = Fd * M.r / (M.nm * M.gear * M.etaG);
          const o = motorSolve(M, fRot, T, vdc, mmax, 1, Ilim);
          out.trac[j].push(Math.round(o.T * M.nm * M.gear * M.etaG / M.r / 100) / 10);
        });
        const Fb = Math.min(veh.bmax * 1e3, 1.15 * M.nm * M.P / Math.max(v, 0.5), fadh) * clip((kmh - 2) / 4, 0, 1);
        const ob = Fb > 0 ? motorSolve(M, fRot, -Fb * M.r * M.etaG / (M.nm * M.gear), D.vdc, mmax, 1, Ilim) : { T: 0 };
        out.brake.push(Math.round(-ob.T * M.nm * M.gear / (M.r * M.etaG) / 100) / 10);
        out.res.push(Math.round((veh.davis[0] + veh.davis[1] * v + veh.davis[2] * v * v) / 100) / 10);
      }
      this.curvesCache = out;
      return out;
    }
  }

  function D_src(sim) { return sim.s.p_src + (sim.D.src === "battery" || sim.D.src === "fuelcell" ? sim.s.p_esc : 0); }

  function makeReg(win) { return { buf: new Float64Array(Math.max(1, win)), idx: 0, sum: 0, int: 0 }; }

  function designSummary(D) {
    const o = {
      key: D.key, system: D.sys.label, sysCollector: D.collector, src: D.src, aux: D.aux, traction: D.traction, levels: D.levels,
      supply: D.sup ? { ...D.sup } : null, vehicle: D.veh ? { ...D.veh } : null,
      vdc: D.vdc, C: D.C, L: D.L || 0, f0: D.f0 || 0, Rpre: D.Rpre, igbt: D.igbt, fswDev: D.fswDev, fc: D.fc,
      Pmc: D.Pmc, Paux: D.Paux, Shbu: D.Shbu, Phwr: D.Phwr, Plc: D.Plc || 0, Peng: D.Peng || 0, Pvlu: D.Pvlu, Rvlu: D.Rvlu,
      Von: D.Von, Vovp: D.Vovp, Vuv: D.Vuv, Itrip: D.Itrip, Ilim: D.Ilim || 0, brkName: D.brkName, V2: D.V2 || 0, fg: D.fg || 0,
      f2: D.f2 || 0, line: D.line || null, bat: D.bat ? { ...D.bat } : null, fc_mod: D.fc_mod || null, ess: D.ess, essAddon: D.essAddon,
      vlu: D.vlu, modules: D.modules, nIdle: D.nIdle, nMax: D.nMax, fuelCap: D.fuelCap || 0,
    };
    if (D.motor) {
      const M = D.motor;
      o.motor = { nm: M.nm, P: M.P, VLL: M.VLL, Ir: M.Ir, Tr: M.Tr, fr: M.fr, gear: M.gear, vb: M.vb, p: M.p };
    }
    return o;
  }

  // ------------------------------------------------------- start sequences
  function buildSteps(D) {
    const S = [];
    const add = (name, fn) => S.push({ name, fn });
    const st = (sim) => sim.s;
    if (D.src === "dcline" || D.src === "acline") {
      if (D.collector === "shoe") add("Lower collector shoes — third rail voltage detected", (sim, k, t) => { st(sim).col_cmd = true; sim.prog(k, st(sim).col_pos * 100); return st(sim).col_pos >= 1 && t > 1; });
      else add("Raise pantograph", (sim, k, t) => { st(sim).col_cmd = true; sim.prog(k, st(sim).col_pos * 100); return st(sim).col_pos >= 1 && t > 3.2; });
      add(`Close ${D.brkName}${D.src === "acline" ? " — transformer energized" : ""}`, (sim, k, t) => {
        if (t > 1 && !st(sim).brk) { st(sim).brk = true; sim.log(`${D.brkName} CLOSED`); }
        sim.prog(k, Math.min(100, t * 60));
        return st(sim).brk && t > 1.6;
      });
      add(D.src === "acline" ? "Pre-charge DC link through LC diodes (ChCt + Rpre)" : "Pre-charge DC link (ChCt + Rpre)", (sim, k, t) => {
        const s = st(sim);
        if (!s.chct) { s.chct = true; sim.log(`ChCt CLOSED — pre-charge via Rpre = ${D.Rpre.toFixed(0)} Ω (τ = ${(D.Rpre * D.C).toFixed(2)} s)`); }
        const target = D.src === "dcline" ? sim.cfg.lineV : SQ2 * D.V2 * sim.cfg.lineV / D.sup.Un;
        sim.prog(k, s.vdc / (0.9 * target) * 100);
        if (t > 20 && s.vdc < 0.9 * target) sim.fault("Pre-charge timeout");
        if (s.vdc >= 0.9 * target && !s.pc_ok) { s.pc_ok = t; sim.log(`DC link pre-charged: ${s.vdc.toFixed(0)} V in ${t.toFixed(2)} s`); }
        return s.pc_ok && t - s.pc_ok > 0.4;
      });
      add("Close line contactor CtL / open ChCt", (sim, k, t) => {
        const s = st(sim);
        if (!s.ctl) { s.ctl = true; sim.log("CtL CLOSED"); }
        if (t > 0.6 && s.chct) { s.chct = false; s.pc_ok = 0; sim.log("ChCt OPEN — Rpre out of circuit"); }
        sim.prog(k, t / 1 * 100);
        return t > 1;
      });
      if (D.src === "acline") add("Line converter (4QC) start — DC link regulation", (sim, k, t) => {
        const s = st(sim);
        if (!s.lc) { s.lc = true; sim.startReg(sim.reg.lc); sim.log(`Line converter ON — regulating DC link at ${D.vdc} V`); }
        sim.prog(k, s.vdc / D.vdc * 100);
        return t > 1.5 && Math.abs(s.vdc - D.vdc) < 0.03 * D.vdc;
      });
      else add("DC link stabilization (line filter)", (sim, k, t) => { sim.prog(k, t / 1.2 * 100); return t > 1.2; });
    } else if (D.src === "genset") {
      add("Start diesel engine", (sim, k, t) => { const s = st(sim); if (s.eng === "off") { s.eng = "crank"; sim.log("Diesel engine cranking"); } sim.prog(k, s.n_eng / D.nIdle * 100); return s.eng === "run"; });
      add("Generator excitation", (sim, k, t) => { sim.prog(k, st(sim).exc * 100); return st(sim).exc >= 1; });
      add("Close generator contactor — passive DC link charge", (sim, k, t) => {
        const s = st(sim);
        if (!s.brk) { s.brk = true; sim.log("Generator contactor CLOSED"); }
        const target = 1.35 * D.Vgen * s.n_eng / D.nMax;
        sim.prog(k, s.vdc / (0.9 * target) * 100);
        return s.vdc >= 0.9 * target && t > 1;
      });
      add("Line converter (active rectifier) start", (sim, k, t) => {
        const s = st(sim);
        if (!s.lc) { s.lc = true; sim.startReg(sim.reg.lc); sim.log(`Line converter ON — boosting DC link to ${D.vdc} V`); }
        sim.prog(k, s.vdc / D.vdc * 100);
        return t > 1 && Math.abs(s.vdc - D.vdc) < 0.03 * D.vdc;
      });
    } else {
      add("Battery pre-charge", (sim, k, t) => { const s = st(sim); if (!s.chct) { s.chct = true; sim.log("Battery pre-charge contactor CLOSED"); } sim.prog(k, t / 1.5 * 100); return t > 1.5; });
      add("Close battery main contactor", (sim, k, t) => { const s = st(sim); if (!s.brk) { s.brk = true; s.chct = false; sim.log(`Battery main contactor CLOSED (${s.v_bat.toFixed(0)} V)`); } sim.prog(k, 100); return t > 0.5; });
      add("ESC start — DC link soft-start", (sim, k, t) => {
        const s = st(sim);
        if (!s.esc) { s.esc = true; sim.startReg(sim.reg.esc); sim.log(`ESC ON — DC link ramp to ${D.vdc} V`); }
        sim.prog(k, s.vdc / D.vdc * 100);
        return t > 1 && Math.abs(s.vdc - D.vdc) < 0.03 * D.vdc;
      });
      if (D.fc_mod) add("Fuel cell start-up (purge, air supply)", (sim, k, t) => {
        const s = st(sim);
        if (s.fc === "off") { s.fc = "start"; s.fc_t = 0; sim.log("Fuel cell start-up (purge, air supply)"); }
        sim.prog(k, s.fc_t / 8 * 100);
        return s.fc === "run";
      });
    }
    if (D.essAddon) add("ESS online (battery contactor + ESC)", (sim, k, t) => { const s = st(sim); if (!s.esc) { s.esc = true; sim.startReg(sim.reg.esc); sim.log(`ESC ON — ${D.bat.chem} ${(D.bat.E / 1e3).toFixed(0)} kWh battery connected`); } sim.prog(k, t * 100); return t > 1; });
    add("Start auxiliary converters (HBU, HWR)", (sim, k, t) => {
      const s = st(sim);
      if (!s.hbu) { s.hbu = true; s.hbu_t = 0; sim.log("HBU ON — 3AC 400 V 50 Hz"); }
      if (t > 0.5 && !s.hwr) { s.hwr = true; sim.log("HWR ON — cooling fans"); }
      sim.prog(k, t / 1.5 * 100);
      return t > 1.5 && s.hbu_out;
    });
    if (D.traction) {
      add("Motor converter: magnetize motors", (sim, k, t) => {
        const s = st(sim);
        if (!s.mc) { s.mc = true; sim.log("Motor converter ON — magnetizing"); }
        sim.prog(k, s.flux * 100);
        return s.flux >= 0.99;
      });
    }
    return S;
  }

  // radix-2 FFT magnitude (n power of two)
  function rfftMag(x) {
    const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
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

  global.TractionSim = { Simulator, SUPPLIES, SYSTEMS, VEHICLES, makeDesign, makeMotor, motorEval, motorSolve, rfftMag };
})(typeof window !== "undefined" ? window : globalThis);
