// Engine regression tests — run with:  node --test tests/*.test.cjs
// Author: Rafael Tavares
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path");
require("vm").runInThisContext(fs.readFileSync(path.join(__dirname, "../static/js/engine.js"), "utf8"));
const { Simulator, SUPPLIES, motorSolve, makeMotor, VEHICLES } = globalThis.TractionSim;
const { run } = require("./run_scenario.cjs");

const CASES = [
  { system: "dc_ohl", supply: "DC600" }, { system: "dc_ohl", supply: "DC750" }, { system: "dc_ohl", supply: "DC1500" },
  { system: "dc_ohl", supply: "DC3000" }, { system: "dc_ohl", supply: "DC3000", vehicle: "loco" }, { system: "dc_ohl", supply: "DC3000", ess: true },
  { system: "dc_3rail", supply: "DC600" }, { system: "dc_3rail", supply: "DC750" },
  { system: "ac_ohl", supply: "AC15" }, { system: "ac_ohl", supply: "AC25" }, { system: "ac_ohl", supply: "AC25", vehicle: "loco", levels: 3 },
  { system: "diesel" }, { system: "battery" }, { system: "hydrogen" }, { system: "aux", supply: "AC15" }, { system: "aux", supply: "DC3000" },
];

for (const cfg of CASES) {
  test(`full cycle without faults: ${JSON.stringify(cfg)}`, () => {
    const r = run(cfg, { T: 90 });
    assert.deepStrictEqual(r.faults, [], r.faults.map((f) => f.cls + " " + f.msg).join("; "));
    assert.ok(r.phases.some((p) => p.includes(" RUN ")), "reaches RUN");
    assert.ok(r.phases[r.phases.length - 1].includes(" OFF"), "shuts down to OFF");
    if (cfg.system !== "aux") assert.ok(r.run.kmh > 40, `accelerates (${r.run.kmh} km/h)`);
  });
}

test("DC link is regulated by the line converter on AC", () => {
  const r = run({ system: "ac_ohl", supply: "AC25" }, { T: 60 });
  assert.ok(Math.abs(r.run.vdc - 3000) < 90, `vdc ${r.run.vdc}`);
});

test("closing CtL without pre-charge trips the breaker", () => {
  const m = new Simulator();
  m.command("mode", "manual");
  m.command("toggle", "col");
  for (let i = 0; i < 200; i++) m.step(0.02);
  m.command("toggle", "brk"); m.step(0.02); m.command("toggle", "ctl");
  for (let i = 0; i < 20; i++) m.step(0.02);
  assert.ok(m.s.faults.some((f) => f.msg.includes("HSCB tripped")));
});

test("non-receptive DC line sends braking energy to the VLU", () => {
  const r = run({ system: "dc_ohl", supply: "DC600" }, { T: 90, set: { recept: 0 } });
  assert.ok(parseFloat(r.energy_kWh.vlu) > 1, `vlu ${r.energy_kWh.vlu}`);
});

test("ESS keeps the train running when the pantograph is lowered", () => {
  const e = new Simulator();
  e.command("config", { system: "dc_ohl", ess: true }); e.command("start");
  for (let i = 0; i < 40 / 0.02; i++) e.step(0.02);
  e.command("mode", "manual"); e.command("set", { throttle: 0.6 }); e.command("toggle", "col");
  for (let i = 0; i < 15 / 0.02; i++) e.step(0.02);
  assert.ok(e.s.mc && Math.abs(e.s.vdc - 3000) < 100 && e.s.p_esc > 1e5);
});

test("motor model: rated torque reached with plausible slip and current", () => {
  const M = makeMotor(VEHICLES.emu, 3000);
  const op = motorSolve(M, M.fRot(M.vb), M.Tr, 3000, 4 / Math.PI, 1, 2 * M.Ir);
  assert.ok(Math.abs(op.T - M.Tr) / M.Tr < 0.02);
  assert.ok(op.fsl > 0.2 && op.fsl < 3, `slip ${op.fsl}`);
  assert.ok(op.Is > 0.8 * M.Ir && op.Is < 1.3 * M.Ir, `Is ${op.Is} vs Ir ${M.Ir}`);
});

test("EN 50163 table is consistent", () => {
  for (const s of Object.values(SUPPLIES)) assert.ok(s.Umin2 <= s.Umin1 && s.Umin1 < s.Un && s.Un < s.Umax1 && s.Umax1 < s.Umax2, s.id);
});

for (const cfg of [{ system: "dc_ohl", supply: "DC3000" }, { system: "ac_ohl", supply: "AC15" }, { system: "diesel" }, { system: "hydrogen" }]) {
  test(`runs with all optional modules removed: ${cfg.system}`, () => {
    const r = run({ ...cfg, mods: { hf: false, vlu: false, hbu: false, hwr: false } }, { T: 90 });
    assert.deepStrictEqual(r.faults, [], r.faults.map((f) => f.cls + " " + f.msg).join("; "));
    assert.ok(r.run.kmh > 40);
    assert.strictEqual(parseFloat(r.energy_kWh.vlu), 0);
  });
}

test("2f filter reduces the DC link ripple on 15 kV 16.7 Hz", () => {
  const ripple = (hf) => {
    const s = new Simulator();
    s.command("config", { system: "ac_ohl", supply: "AC15", mods: { hf } }); s.command("start");
    for (let i = 0; i < 45 / 0.02; i++) s.step(0.02);
    const z = s.zoom();
    return Math.max(...z.v) - Math.min(...z.v);
  };
  assert.ok(ripple(false) > 4 * ripple(true));
});

test("diesel without VLU cannot brake electrically (no regeneration path)", () => {
  const a = run({ system: "diesel" }, { T: 90 }), b = run({ system: "diesel", mods: { vlu: false } }, { T: 90 });
  // only the auxiliaries (HBU, HWR) can absorb braking energy
  assert.ok(parseFloat(b.energy_kWh.brake) < 0.4 * parseFloat(a.energy_kWh.brake));
});
