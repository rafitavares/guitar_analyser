// Runs a scenario on the JS engine and prints JSON (used by test_js_port.py)
const fs = require("fs"), path = require("path");
require("vm").runInThisContext(fs.readFileSync(path.join(__dirname, "../static/js/engine.js"), "utf8"));
const { Simulator, makeLocalApi } = globalThis.TractionSim;
const [supply, levels, method] = process.argv.slice(2);
const sim = new Simulator(), api = makeLocalApi(sim);
sim.command("config", { supply, levels: +levels, pwm_method: method });
sim.command("start");
const out = { snaps: [] };
for (let i = 1; i <= 4000; i++) {
  sim.step(0.02);
  if (i % 1000 === 0) out.snaps.push(sim.snapshot(true));
}
sim.command("stop");
for (let i = 0; i < 6000; i++) sim.step(0.02);
out.snaps.push(sim.snapshot(true));
out.lab = {
  pwm2: api.get("/api/lab/pwm?level=2&freq=18&amp=1200"),
  pwm3: api.get("/api/lab/pwm?level=3"),
  pre: api.get("/api/lab/precharge?percent=90"),
  rip: api.get("/api/lab/ripple?r=500&c_step=6"),
};
process.stdout.write(JSON.stringify(out));
