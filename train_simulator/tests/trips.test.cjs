// Trip Lab regression tests: every catalog fault is detected with the expected class and reaction.
// Run with:  node --test tests/*.test.cjs
// Author: Rafael Tavares
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path");
require("vm").runInThisContext(fs.readFileSync(path.join(__dirname, "../static/js/engine.js"), "utf8"));
const { Simulator, TRIPS } = globalThis.TractionSim;

// class reactions are tested with the protective shutdown switched off
const make = (cfg) => { const m = new Simulator(); m.labShutdown = false; m.command("config", cfg); return m; };
const DT = +(process.env.DT || 0.02);
const run = (m, T, until) => { for (let i = 0; i < T / DT; i++) { m.step(DT); if (until && until(m)) return true; } return false; };
const ready = (m) => { m.command("start"); assert.ok(run(m, 60, (x) => x.s.phase === "RUN"), "reaches RUN"); run(m, 6); };
const fault = (m, code) => m.s.faults.find((f) => f.code === code);
const expectTrip = (m, code, cls, T = 30) => {
  assert.ok(run(m, T, (x) => fault(x, code)), `${code} detected (faults: ${m.s.faults.map((f) => f.code).join(", ") || "none"})`);
  assert.strictEqual(fault(m, code).cls, cls);
  return fault(m, code);
};

test("catalog: every entry has a valid class, triggers and alternatives", () => {
  const { TRIP_CLASSES, TRIGGERS } = globalThis.TractionSim;
  for (const t of TRIPS) {
    assert.ok(TRIP_CLASSES[t.cls], t.id);
    for (const a of t.alt) assert.ok(TRIP_CLASSES[a], `${t.id} alt ${a}`);
    for (const g of t.trig) assert.ok(TRIGGERS[g], `${t.id} trigger ${g}`);
  }
});

// ---------------------------------------------------------------- ESS connection box
test("CtPos does not close → OFF_SYS_2 during pre-charge, system shuts down", () => {
  const m = make({ system: "battery" });
  m.command("inject", { id: "ctpos_noclose" }); m.command("start");
  const f = expectTrip(m, "ctpos_noclose", "OFF_SYS_2", 10);
  assert.match(f.state, /Connecting/);
  assert.ok(run(m, 20, (x) => x.s.phase === "OFF"), "controlled shutdown to OFF");
  assert.strictEqual(m.s.eb.st, "Idle");
});

test("CtNeg does not close → OFF_SYS_2", () => {
  const m = make({ system: "battery" });
  m.command("inject", { id: "ctneg_noclose" }); m.command("start");
  expectTrip(m, "ctneg_noclose", "OFF_SYS_2", 10);
});

test("CtPos does not open → Trip_SYS_1 on disconnection", () => {
  const m = make({ system: "battery" }); ready(m);
  m.command("inject", { id: "ctpos_noopen" }); m.command("stop");
  const f = expectTrip(m, "ctpos_noopen", "Trip_SYS_1", 120);
  assert.match(f.state, /Disconnecting/);
});

test("CtNeg does not open → Trip_SYS_1 on disconnection", () => {
  const m = make({ system: "battery" }); ready(m);
  m.command("inject", { id: "ctneg_noopen" }); m.command("stop");
  expectTrip(m, "ctneg_noopen", "Trip_SYS_1", 120);
});

test("CtCh closes unexpectedly while connected → OFF_SYS_2", () => {
  const m = make({ system: "dc_ohl", ess: true }); ready(m);
  m.command("inject", { id: "ctch_unexp_close" });
  expectTrip(m, "ctch_unexp_close", "OFF_SYS_2", 2);
});

test("CtCh opens unexpectedly during pre-charge → OFF_SYS_2 (or Trip_SYS_1 when chosen)", () => {
  const m = make({ system: "battery" });
  m.command("inject", { id: "ctch_unexp_open", trig: "ess:chclosed" }); m.command("start");
  expectTrip(m, "ctch_unexp_open", "OFF_SYS_2", 10);
  const n = make({ system: "battery" });
  n.command("inject", { id: "ctch_unexp_open", cls: "Trip_SYS_1" }); n.command("start");
  expectTrip(n, "ctch_unexp_open", "Trip_SYS_1", 10);
  assert.strictEqual(n.s.eb.st, "Trip");
});

test("welded CtPos is found by the voltage check after opening → Trip_SYS_1", () => {
  const m = make({ system: "battery" }); ready(m);
  m.command("inject", { id: "welded" }); m.command("stop");
  const f = expectTrip(m, "welded", "Trip_SYS_1", 120);
  assert.match(f.msg, /Welded contactor CtPos/);
  run(m, 0.5);
  assert.ok(!m.s.eb.c.neg.act, "CtNeg opened to isolate the battery");
});

for (const [cfg, unit] of [[{ system: "battery" }, "ess"], [{ system: "dc_ohl" }, "pre"], [{ system: "ac_ohl", supply: "AC25" }, "pre"]]) {
  test(`precharge timeout and voltage does not rise: ${cfg.system} (${unit})`, () => {
    const a = make(cfg);
    a.command("inject", { id: "precharge_timeout", unit }); a.command("start");
    expectTrip(a, "precharge_timeout", "OFF_SYS_2", 30);
    assert.ok(!fault(a, "voltage_no_rise"));
    const b = make(cfg);
    b.command("inject", { id: "voltage_no_rise", unit }); b.command("start");
    expectTrip(b, "voltage_no_rise", "OFF_SYS_2", 15);
  });
}

test("ESS tripline open → Trip_ESS, the train keeps running on the line", () => {
  const m = make({ system: "dc_ohl", ess: true }); ready(m);
  m.command("inject", { id: "ess_tripline" });
  expectTrip(m, "ess_tripline", "Trip_ESS", 1);
  run(m, 3);
  assert.strictEqual(m.s.eb.st, "Trip");
  assert.ok(!m.s.esc && m.s.mc && m.s.brk, "ESS isolated, traction on");
  m.command("clear_inj", "all"); m.command("reset");
  assert.ok(run(m, 5, (x) => x.s.esc), "unit-level RESET reconnects the ESS");
});

test("BMS critical fault → Trip_ESS", () => {
  const m = make({ system: "hydrogen" }); ready(m);
  m.command("inject", { id: "bms_fault" });
  expectTrip(m, "bms_fault", "Trip_ESS", 1);
});

// ---------------------------------------------------------------- converters
test("MC overcurrent (step) → Trip_SYS_2 opens the HSCB", () => {
  const m = make({ system: "dc_ohl" }); ready(m);
  m.command("inject", { id: "mc_oc" });
  expectTrip(m, "mc_oc", "Trip_SYS_2", 1);
  assert.ok(!m.s.brk && !m.s.mc && m.s.phase === "TRIPPED");
});

test("MC overcurrent (ramp) warns before tripping; class can be changed to Trip_MC", () => {
  const m = make({ system: "dc_ohl" }); ready(m);
  m.command("inject", { id: "mc_oc", form: "ramp", cls: "Trip_MC" });
  let warned = false;
  assert.ok(run(m, 30, (x) => { warned ||= !!x.s.warns.mc_oc_w; return fault(x, "mc_oc"); }));
  assert.ok(warned, "warning before the trip");
  assert.strictEqual(fault(m, "mc_oc").cls, "Trip_MC");
  assert.ok(m.s.brk && !m.s.mc, "only the motor converter is blocked");
});

test("intermittent overcurrent: filtered transients, trip after 3 in 30 s", () => {
  const m = make({ system: "dc_ohl" }); ready(m);
  m.command("inject", { id: "mc_oc", form: "intermittent" });
  run(m, 2.5);
  assert.ok(!fault(m, "mc_oc") && m.s.warns.mc_oc_tr, "first burst only warns");
  const f = expectTrip(m, "mc_oc", "Trip_SYS_2", 10);
  assert.match(f.msg, /3 transients/);
});

test("IGBT desaturation: class follows the converter (MC → Trip_SYS_2, HBU → Trip_AUX)", () => {
  const a = make({ system: "dc_ohl" }); ready(a);
  a.command("inject", { id: "igbt_desat", unit: "mc" });
  expectTrip(a, "igbt_desat", "Trip_SYS_2", 1);
  const b = make({ system: "dc_ohl" }); ready(b);
  b.command("inject", { id: "igbt_desat", unit: "hbu" });
  expectTrip(b, "igbt_desat", "Trip_AUX", 1);
  assert.ok(b.s.mc && !b.s.hbu);
});

test("earth fault (ramp): insulation warning, then Trip_SYS_2", () => {
  const m = make({ system: "dc_ohl", supply: "DC1500" }); ready(m);
  m.command("inject", { id: "earth_fault", form: "ramp" });
  let warned = false;
  assert.ok(run(m, 30, (x) => { warned ||= !!x.s.warns.earth_fault_w; return fault(x, "earth_fault"); }));
  assert.ok(warned);
  assert.strictEqual(fault(m, "earth_fault").cls, "Trip_SYS_2");
});

for (const cfg of [{ system: "dc_ohl" }, { system: "ac_ohl", supply: "AC15" }, { system: "battery" }, { system: "diesel" }]) {
  test(`DC-link overvoltage (step): ${cfg.system}`, () => {
    const m = make(cfg); ready(m);
    m.command("inject", { id: "dcl_ov" });
    expectTrip(m, "dcl_ov", "Trip_SYS_2", 5);
    assert.ok(!m.s.mc && !m.s.lc);
  });
}

test("DC-link undervoltage → Trip_SYS_3 with automatic restart", () => {
  const m = make({ system: "dc_ohl", supply: "DC750" }); ready(m);
  m.command("inject", { id: "dcl_uv" });
  expectTrip(m, "dcl_uv", "Trip_SYS_3", 3);
  assert.ok(!m.s.mc && m.s.brk, "pulses blocked, breaker closed");
  m.command("clear_inj", "dcl_uv");
  assert.ok(run(m, 6, (x) => x.s.mc && !x.s.faults.length), "restarts by itself");
});

for (const cfg of [{ system: "dc_ohl" }, { system: "battery" }]) {
  test(`DC-link short circuit → Trip_SYS_0: ${cfg.system}`, () => {
    const m = make(cfg); ready(m);
    m.command("inject", { id: "dcl_short" });
    expectTrip(m, "dcl_short", "Trip_SYS_0", 1);
    run(m, 0.3);
    assert.ok(!m.s.col_cmd && !m.s.brk && !m.s.mc && !m.s.esc);
  });
}

test("motor converter fault → Trip_MC; line / generator converter fault → Trip_LC", () => {
  const a = make({ system: "dc_ohl" }); ready(a);
  a.command("inject", { id: "mc_fault" });
  expectTrip(a, "mc_fault", "Trip_MC", 1);
  assert.ok(a.s.brk && a.s.hbu);
  for (const cfg of [{ system: "ac_ohl" }, { system: "diesel" }]) {
    const b = make(cfg); ready(b);
    b.command("inject", { id: "lc_fault" });
    expectTrip(b, "lc_fault", "Trip_LC", 1);
    assert.ok(!b.s.lc);
  }
});

// ---------------------------------------------------------------- auxiliaries
test("AUX overload (step) → Trip_AUX after the I²t curve; RESET restarts the HBU", () => {
  const m = make({ system: "dc_ohl" }); ready(m);
  m.command("inject", { id: "aux_ovl" });
  const f = expectTrip(m, "aux_ovl", "Trip_AUX", 10);
  assert.ok(f.t > 0, "delayed by the overload curve");
  assert.ok(m.s.mc && !m.s.hbu, "traction continues");
  m.command("clear_inj", "all"); m.command("reset");
  assert.ok(m.s.hbu && !m.s.faults.length);
});

test("AUX overtemperature and fan failure → Trip_AUX", () => {
  const a = make({ system: "dc_ohl" }); ready(a);
  a.command("inject", { id: "aux_ot" });
  expectTrip(a, "aux_ot", "Trip_AUX", 40);
  const b = make({ system: "dc_ohl" }); ready(b);
  b.command("inject", { id: "fan_fail" });
  expectTrip(b, "fan_fail", "Trip_AUX", 10);
});

test("unavailable scenarios are refused", () => {
  const m = make({ system: "dc_ohl" });
  m.command("inject", { id: "ess_tripline" });
  assert.strictEqual(Object.keys(m.inj).length, 0);
});

test("trip recorder freezes 4 s before and 2 s after the first trip", () => {
  const m = make({ system: "dc_ohl" }); ready(m);
  m.command("inject", { id: "dcl_short" });
  run(m, 3);
  const r = m.recorder();
  assert.ok(r.frozen);
  assert.strictEqual(r.frozen.f.code, "dcl_short");
  const t = r.frozen.cols[0];
  assert.ok(t[0] < -3.5 && t[t.length - 1] > 1.9);
});

test("protective shutdown (default): any trip switches the whole system off", () => {
  const m = new Simulator(); m.command("config", { system: "dc_ohl", ess: true }); ready(m);
  m.command("inject", { id: "aux_ovl" });
  expectTrip(m, "aux_ovl", "Trip_AUX", 10);
  run(m, 0.5);
  assert.ok(!m.s.mc && !m.s.brk && !m.s.col_cmd && !m.s.esc && m.s.phase === "TRIPPED");
  assert.ok(run(m, 60, (x) => x.s.speed < 0.01), "train brought to standstill");
  m.command("clear_inj", "all"); m.command("reset");
  assert.strictEqual(m.s.faults.length, 0);
  m.command("start");
  assert.ok(run(m, 60, (x) => x.s.phase === "RUN"), "restarts after RESET");
});
