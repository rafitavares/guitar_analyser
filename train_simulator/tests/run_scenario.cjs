// Runs one system through start-up, traction and shutdown; prints a JSON report.
const fs = require("fs"), path = require("path");
require("vm").runInThisContext(fs.readFileSync(path.join(__dirname, "../static/js/engine.js"), "utf8"));
const { Simulator } = globalThis.TractionSim;

function run(cfg, opts = {}) {
  const sim = new Simulator();
  sim.command("config", cfg);
  if (opts.set) sim.command("set", opts.set);
  sim.command("start");
  const log = [];
  let last = "", maxV = 0, minVrun = 1e9, tRun = null;
  const T = opts.T || 120;
  for (let i = 0; i < T / 0.02; i++) {
    sim.step(0.02);
    const s = sim.s;
    if (s.phase !== last) { last = s.phase; log.push(`${s.t.toFixed(1)} ${s.phase} vdc=${s.vdc.toFixed(0)}`); if (s.phase === "RUN") tRun = s.t; }
    maxV = Math.max(maxV, s.vdc);
    if (s.phase === "RUN" && s.t > tRun + 2) minVrun = Math.min(minVrun, s.vdc);
  }
  const s = sim.s, snap = sim.snapshot(true);
  const run = { kmh: +(s.speed * 3.6).toFixed(1), vdc: Math.round(s.vdc), fs: +s.fs.toFixed(1), m: +s.m.toFixed(3), pulse: s.pulse.label,
    F_kN: +(s.force / 1e3).toFixed(1), Pmc_kW: Math.round(s.p_mc / 1e3), Psrc_kW: Math.round(s.p_src / 1e3), Is: Math.round(s.Is), pf: +s.pf.toFixed(2),
    eta_m: +s.eta_m.toFixed(3), tj: +s.t_j.toFixed(1), soc: +s.soc.toFixed(3), lim: s.limit, thd: snap.wave && snap.wave.spec ? +snap.wave.spec.thd_uab.toFixed(1) : null,
    aux_kW: Math.round((s.p_hbu + s.p_hwr) / 1e3), vlu_kW: Math.round(s.p_vlu / 1e3), fhwr: +s.f_hwr.toFixed(1) };
  sim.command("stop");
  let tStop = null;
  for (let i = 0; i < 400 / 0.02; i++) {
    sim.step(0.02);
    if (sim.s.phase !== last) { last = sim.s.phase; log.push(`${sim.s.t.toFixed(1)} ${sim.s.phase} v=${(sim.s.speed * 3.6).toFixed(1)} vdc=${sim.s.vdc.toFixed(0)} vlu=${(sim.s.p_vlu/1e3).toFixed(0)}kW`); }
    if (last === "OFF") break;
  }
  const E = sim.s.E;
  return { cfg, phases: log, maxVdc: Math.round(maxV), minVdcRun: Math.round(minVrun), run, faults: sim.s.faults,
    energy_kWh: Object.fromEntries(Object.entries(E).map(([k, v]) => [k, k === "dist" ? +(v / 1000).toFixed(2) + " km" : k === "h2" ? +v.toFixed(2) + " kg" : k === "fuel" ? +v.toFixed(1) + " l" : +(v / 3.6e6).toFixed(2)])),
    warnings: sim.events.filter((e) => e.level !== "info").map((e) => e.msg) };
}
module.exports = { run };
if (require.main === module) {
  const cfg = JSON.parse(process.argv[2] || "{}");
  const opts = JSON.parse(process.argv[3] || "{}");
  console.log(JSON.stringify(run(cfg, opts), null, 1));
}
