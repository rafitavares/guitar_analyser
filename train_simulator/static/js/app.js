// Main application: runs the simulation engine in the browser and renders it.
// Author: Rafael Tavares
const PHASES = {
  OFF: ["OFF", ""], START: ["STARTING", "seq"], RUN: ["READY", "run"], BRAKING: ["BRAKING", "seq"],
  SHUTDOWN: ["SHUTTING DOWN", "seq"], MANUAL: ["MANUAL", "man"], EMERGENCY: ["EMERGENCY", "bad"], TRIPPED: ["TRIPPED", "bad"],
};
const TS = [1, 2, 3, 5, 8, 10];

const SIM = new TractionSim.Simulator();
SIM.start();
const cmd = (c, v) => SIM.command(c, v);

const scene = new TrainScene($("#scene"));
const schem = new Schematic($("#schem"), (id) => cmd("toggle", id));
const charts = makeCharts();
const data = initData(SIM);
const lab = new TripLab(SIM);
let G = {};
const hDC = new History(5, 60);
const hTrain = new History(5, 120);
let S = null, lastEvent = 0, lastFrame = performance.now(), cfgKey = "";

// ------------------------------------------------------------ configuration
function fillSelect(sel, items, value) {
  sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  sel.value = value;
}

function buildConfigUI(s) {
  const D = s.D, c = s.cfg, sys = TractionSim.SYSTEMS[c.system];
  fillSelect($("#sel-system"), Object.entries(TractionSim.SYSTEMS).map(([k, v]) => [k, v.label]), c.system);
  $("#lbl-supply").hidden = !sys.supplies.length;
  if (sys.supplies.length) fillSelect($("#sel-supply"), sys.supplies.map((k) => [k, TractionSim.SUPPLIES[k].label]), c.supply);
  $("#sel-supply").title = D.supply ? `Used in: ${D.supply.where}` : "";
  $("#supply-where").textContent = D.supply ? D.supply.where : "";
  $("#lbl-vehicle").hidden = !sys.vehicles.length;
  if (sys.vehicles.length) fillSelect($("#sel-vehicle"), sys.vehicles.map((k) => [k, TractionSim.VEHICLES[k].label]), c.vehicle);
  $("#sel-levels").value = String(c.levels);
  $("#lbl-ess").hidden = sys.ess !== "optional";
  $$(".mods [data-mod]").forEach((el) => { el.checked = c.mods[el.dataset.mod]; });
  $("#lbl-hf").hidden = !(D.src === "dcline" || (D.src === "acline" && !D.aux));
  $("#lbl-vlu").hidden = D.aux;
  $("#in-ess").checked = c.ess;
  // line voltage slider follows EN 50163
  const sup = D.supply;
  $("#row-linev").hidden = !sup;
  $("#row-recept").hidden = !(sup && sup.kind === "DC");
  if (sup) {
    const el = $("#in-linev");
    el.min = Math.round(sup.Umin2 * 0.9); el.max = Math.round(sup.Umax2 * 1.05); el.step = sup.kind === "AC" ? 100 : 10; el.value = c.lineV;
    $("#linev-scale").innerHTML = `<em>Umin2 ${sup.Umin2}</em><em>Un ${sup.Un}</em><em>Umax2 ${sup.Umax2}</em>`;
  }
  $("#in-target").max = D.vehicle ? D.vehicle.vmax : 0;
  $("#in-target").value = c.target_kmh;
  $("#v-target").textContent = c.target_kmh + " km/h";
  // gauges scaled to the system
  const vmax = D.vehicle ? Math.ceil(D.vehicle.vmax / 20) * 20 : 100;
  const pmax = Math.max(0.5, Math.ceil((D.Pmc || D.Paux * 2) / 2.5e5) / 4);
  const vg = Math.ceil(D.Vovp * 1.05 / 500) * 500;
  G = {
    speed: new Gauge($("#g-speed"), { min: 0, max: vmax, label: "Speed", unit: "km/h", color: COL.ok, zones: [[D.vehicle ? D.vehicle.vmax : vmax, vmax, COL.bad]] }),
    freq: new Gauge($("#g-freq"), { min: 0, max: D.motor ? Math.ceil(D.motor.fr * 3.4 / 20) * 20 : 100, label: "Motor frequency", unit: "Hz", digits: 1, color: COL.ac }),
    vdc: new Gauge($("#g-vdc"), { min: 0, max: vg, label: "DC link voltage", unit: "V", color: COL.dc, zones: [[D.Von, vg, COL.bad]], mark: D.vdc }),
    power: new Gauge($("#g-power"), { min: -pmax, max: pmax, label: "MC power (traction / regen)", unit: "MW", digits: 2, color: COL.line, bipolar: true }),
  };
  buildSteps(s.step_names);
  hDC.clear(); hTrain.clear();
}

function bindControls() {
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tabpane").forEach((p) => { p.hidden = p.id !== "tab-" + b.dataset.tab; });
    window.dispatchEvent(new Event("resize"));
  }));
  $$("#mode-seg button").forEach((b) => b.addEventListener("click", () => cmd("mode", b.dataset.mode)));
  $("#btn-start").onclick = () => cmd("start");
  $("#btn-stop").onclick = () => cmd("stop");
  $("#btn-emerg").onclick = () => cmd("emergency");
  $("#btn-reset").onclick = () => cmd("reset");
  $("#btn-ack").onclick = () => cmd("reset");
  $("#sel-system").onchange = (e) => cmd("config", { system: e.target.value });
  $("#sel-supply").onchange = (e) => cmd("config", { supply: e.target.value });
  $("#sel-vehicle").onchange = (e) => cmd("config", { vehicle: e.target.value });
  $("#sel-levels").onchange = (e) => cmd("config", { levels: +e.target.value });
  $("#in-ess").onchange = (e) => cmd("config", { ess: e.target.checked });
  $$(".mods [data-mod]").forEach((el) => (el.onchange = () => {
    cmd("config", { mods: { [el.dataset.mod]: el.checked } });
    el.checked = SIM.cfg.mods[el.dataset.mod]; // refused while moving
  }));
  $("#sel-rail").onchange = (e) => cmd("set", { rail: e.target.value });

  const slide = (id, out, f, send) => {
    const el = $(id);
    el.addEventListener("input", () => { $(out).textContent = f(+el.value); send(+el.value); });
  };
  slide("#in-target", "#v-target", (v) => v + " km/h", (v) => cmd("set", { target_kmh: v }));
  slide("#in-ts", "#v-ts", (v) => TS[v] + "×", (v) => cmd("set", { time_scale: TS[v] }));
  slide("#in-fsw", "#v-fsw", (v) => v + " %", (v) => cmd("set", { fswScale: v / 100 }));
  slide("#in-thr", "#v-thr", (v) => (v > 0 ? "+" : "") + v + " %", (v) => cmd("set", { throttle: v / 100 }));
  slide("#in-fcmd", "#v-fcmd", (v) => v.toFixed(1) + " Hz", (v) => cmd("set", { f_cmd: v }));
  slide("#in-mcmd", "#v-mcmd", (v) => v.toFixed(2), (v) => cmd("set", { m_cmd: v }));
  slide("#in-linev", "#v-linev", (v) => fmtV(v), (v) => cmd("set", { lineV: v }));
  slide("#in-recept", "#v-recept", (v) => v + " %", (v) => cmd("set", { recept: v / 100 }));
  slide("#in-grade", "#v-grade", (v) => (v > 0 ? "+" : "") + v + " ‰", (v) => cmd("set", { grade: v }));
  slide("#in-tamb", "#v-tamb", (v) => v + " °C", (v) => cmd("set", { tAmb: v }));
  $("#in-vf").onchange = (e) => cmd("set", { vf_auto: e.target.checked });
  $("#btn-thr0").onclick = () => { $("#in-thr").value = 0; $("#v-thr").textContent = "0 %"; cmd("set", { throttle: 0 }); };
  $$("#ctrl-seg button").forEach((b) => b.addEventListener("click", () => cmd("set", { ctrl: b.dataset.ctrl })));
  window.addEventListener("keydown", (e) => {
    if (!S || S.mode !== "manual" || ["INPUT", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const el = $("#in-thr");
      el.value = +el.value + (e.key === "ArrowUp" ? 10 : -10);
      el.dispatchEvent(new Event("input"));
      e.preventDefault();
    }
  });
}

const fmtV = (v) => (v >= 10000 ? (v / 1000).toFixed(1) + " kV" : v.toFixed(0) + " V");
const syncInput = (el, v) => { if (document.activeElement !== el && +el.value !== v) el.value = v; };

// ------------------------------------------------------------------ render
function buildSteps(names) {
  $("#steps").innerHTML = names.map((n) => `<li><span class="lbl">${n}</span><span class="pct">0%</span><span class="bar"><i></i></span></li>`).join("");
}

function tiles(s) {
  const D = s.D, T = [];
  if (D.traction) {
    T.push(["Tractive effort", `${(s.force / 1e3).toFixed(1)} kN`, s.limit ? `limit: ${s.limit}` : `adhesion ${(s.f_adh / 1e3).toFixed(0)} kN`]);
    T.push(["Converter output current", `${s.Is.toFixed(0)} A rms`, s.mc ? `m = ${s.m.toFixed(3)}` : ""]);
    T.push(["Pulse pattern", s.pulse.label || "—", s.mc ? `${(s.pulse.fdev || 0).toFixed(0)} Hz device switching` : ""]);
    T.push(["THD U–V / current", s.wave && s.wave.spec && s.wave.spec.thd_uab != null ? `${s.wave.spec.thd_uab.toFixed(1)} %` : "—", s.wave && s.wave.spec && s.wave.spec.thd_i != null ? `current THD ${s.wave.spec.thd_i.toFixed(1)} %` : ""]);
    T.push(["Motor PF · efficiency", s.mc && s.Is > 1 ? `${s.pf.toFixed(2)} · ${(Math.min(Math.abs(s.eta_m), 0.99) * 100).toFixed(1)} %` : "—", `${s.rpm.toFixed(0)} rpm`]);
    T.push(["IGBT junction · motor", `${s.t_j.toFixed(0)} °C · ${s.t_mot.toFixed(0)} °C`, `heatsink ${s.t_hs.toFixed(0)} °C, fans ${s.f_hwr.toFixed(0)} Hz`]);
  }
  if (D.src === "dcline") T.push(["Line current", `${s.i_line.toFixed(0)} A`, `limit ${D.Ilim.toFixed(0)} A · ${s.dist_ss != null ? s.dist_ss.toFixed(1) + " km to substation" : ""}`]);
  if (D.src === "acline") T.push(["Line current (primary)", `${s.i_line.toFixed(1)} A`, `power factor ≈ 1.00 (4QC)`]);
  if (D.src === "genset") T.push(["Diesel engine", `${s.n_eng.toFixed(0)} rpm`, `${(s.fuel_rate * 3.6 / 0.835).toFixed(1)} l/h · tank ${s.fuel.toFixed(0)} l`]);
  if (D.bat) T.push(["Battery", `SoC ${(s.soc * 100).toFixed(1)} %`, `${s.v_bat.toFixed(0)} V · ${s.i_bat.toFixed(0)} A`]);
  if (D.fc_mod) T.push(["Fuel cell", fmtSI(s.p_fc_dc, "W"), `H₂ ${s.h2.toFixed(1)} kg · η ${(s.fc_eta * 100).toFixed(0)} %`]);
  T.push(["Auxiliaries", fmtSI(s.p_hbu + s.p_hwr, "W"), `HVAC ${fmtSI((s.aux_loads || {}).hvac || 0, "W")} · air ${s.p_air.toFixed(1)} bar`]);
  if (D.vlu) T.push(["VLU (brake chopper)", fmtSI(s.p_vlu, "W"), `resistor ${s.t_vlu.toFixed(0)} °C`]);
  $("#tiles").innerHTML = T.map(([a, b, c]) => `<div class="tile"><span>${a}</span><b class="mono">${b}</b><small>${c || ""}</small></div>`).join("");
}

function flow(s) {
  const D = s.D;
  const items = [];
  if (D.src === "dcline" || D.src === "acline") items.push(["Line", s.p_src]);
  if (D.src === "genset") items.push(["Generator", s.p_src]);
  if (D.fc_mod) items.push(["Fuel cell", s.p_fc_dc]);
  if (D.bat) items.push(["Battery (ESC)", s.p_esc]);
  if (D.traction) items.push(["Motor converter", -s.p_mc]);
  items.push(["Auxiliaries", -(s.p_hbu + s.p_hwr)]);
  if (D.vlu) items.push(["VLU", -s.p_vlu]);
  const max = Math.max(1e5, ...items.map(([, p]) => Math.abs(p)));
  $("#flow").innerHTML = items.map(([n, p]) => {
    const w = Math.abs(p) / max * 50;
    const cls = p >= 0 ? "in" : "out";
    return `<div class="fl"><span>${n}</span><div class="fbar"><i class="${cls}" style="${p >= 0 ? `left:50%` : `right:50%`};width:${w}%"></i></div><b class="mono">${fmtSI(p, "W")}</b></div>`;
  }).join("") + `<p class="note">Right: power into the DC link · left: power out of it</p>`;
}

function renderState(s) {
  const c = s.cfg, D = s.D;
  if (D.key !== cfgKey) { cfgKey = D.key; buildConfigUI(s); }
  const [ptxt, pcls] = PHASES[s.phase] || [s.phase, ""];
  const pill = $("#phase-pill");
  pill.textContent = s.faults.length ? "FAULT" : ptxt;
  pill.className = "pill " + (s.faults.length ? "bad" : pcls);
  $("#clock").textContent = `t = ${s.t.toFixed(1)} s`;
  $("#topo-label").textContent = `${D.system}${D.supply ? " " + D.supply.label : ""}${D.vehicle ? " · " + D.vehicle.label : ""}`;

  $$("#mode-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === s.mode));
  $("#drive-auto").hidden = s.mode !== "auto" || !D.traction;
  $("#drive-manual").hidden = s.mode !== "manual" || !D.traction;
  $("#btn-start").disabled = s.mode !== "auto";
  $("#schem-hint").textContent = s.mode === "manual" ? "Click breakers, contactors and converters" : "Automatic mode";
  $$("#ctrl-seg button").forEach((b) => b.classList.toggle("on", b.dataset.ctrl === s.ctrl));
  $("#ctrl-throttle").hidden = s.ctrl !== "throttle";
  $("#ctrl-freq").hidden = s.ctrl !== "freq";
  if (s.mode === "manual" && s.ctrl === "throttle") {
    syncInput($("#in-thr"), Math.round(s.throttle * 100));
    $("#v-thr").textContent = (s.throttle > 0 ? "+" : "") + Math.round(s.throttle * 100) + " %";
  }
  if (s.mode === "manual" && s.ctrl === "freq") { $("#in-mcmd").disabled = s.vf_auto; if (s.vf_auto) { $("#in-mcmd").value = s.m; $("#v-mcmd").textContent = s.m.toFixed(2); } }
  if (D.supply) $("#v-linev").textContent = fmtV(c.lineV) + (c.lineV > D.supply.Umax2 || c.lineV < D.supply.Umin2 ? " ⚠ outside EN 50163" : "");

  // sequence
  const lis = $("#steps").children;
  let activeSet = false;
  s.steps.forEach((p, i) => {
    const li = lis[i];
    if (!li) return;
    li.querySelector("i").style.width = p + "%";
    li.querySelector(".pct").textContent = Math.round(p) + "%";
    li.classList.toggle("done", p >= 100);
    const act = !activeSet && p < 100 && s.phase === "START";
    li.classList.toggle("active", act);
    if (act) activeSet = true;
  });

  tiles(s);
  flow(s);
  $("#hud-dist").textContent = `${(s.pos / 1000).toFixed(2)} km · ${PHASES[s.phase]?.[0] || s.phase}${s.grade ? "" : ""}`;

  const n = renderAlarms($("#alarms"), s);
  $("#al-count").textContent = n.trips || n.warns ? `${n.trips} trip${n.trips === 1 ? "" : "s"} · ${n.warns} warning${n.warns === 1 ? "" : "s"}` : "";
  $("#btn-ack").disabled = !n.trips;

  if (s.events.length && s.events[s.events.length - 1].id < lastEvent) { $("#log").innerHTML = ""; lastEvent = 0; }
  for (const e of s.events.filter((e) => e.id > lastEvent)) {
    const li = document.createElement("li");
    li.className = e.level;
    li.innerHTML = `<span>${e.t.toFixed(2)} s</span>${e.msg}`;
    $("#log").prepend(li);
    lastEvent = e.id;
  }
  while ($("#log").children.length > 150) $("#log").lastChild.remove();

  const vS = D.src === "acline" ? c.lineV / 10 : s.v_line;
  hDC.push([s.t, s.vdc, vS, s.i_line, s.mc ? s.p_mc / Math.max(s.vdc, 1) : 0]);
  charts.dc.u.series[2].label = D.src === "acline" ? "Line kV×100" : D.src === "genset" ? "Generator Vd0" : D.bat && !D.supply ? "Battery V" : "Line V";
  charts.dc.set(hDC.cols);
  hTrain.push([s.t, s.speed_kmh, s.force / 1e3, s.force_mech / 1e3, s.p_mc / 1e6]);
  charts.train.set(hTrain.cols);

  const w = s.wave;
  if (w) {
    charts.pwm.set([w.t, w.pole, w.ref, w.cu, w.cl]);
    $("#pwm-note").textContent = s.mc ? `${D.levels}L · ${s.pulse.label} · f = ${s.fs.toFixed(1)} Hz · m = ${s.m.toFixed(3)}` : "pulses blocked";
    charts.mot.set([w.t, w.pole, w.ia, w.ib, w.ic]);
    charts.uv.set([w.t, w.uab]);
    $("#mot-note").textContent = (D.levels === 3 ? "Leg U–0: 3 levels (±Vdc/2, 0) · Line U–V: 5 levels (±Vdc, ±Vdc/2, 0)" : "Leg U–0: 2 levels (±Vdc/2) · Line U–V: 3 levels (±Vdc, 0)") + (s.mc ? ` · ${s.Is.toFixed(0)} A rms` : "");
    if (w.spec && w.spec.thd_uab != null) {
      charts.spec.set([w.spec.f, w.spec.a]);
      $("#spec-note").textContent = `fundamental ${w.spec.fund_uab.toFixed(0)} V · THD ${w.spec.thd_uab.toFixed(1)} %` + (w.spec.thd_i != null ? ` · current THD ${w.spec.thd_i.toFixed(1)} %` : "");
    } else { charts.spec.set([[], []]); $("#spec-note").textContent = "inverter stopped"; }
  } else if (!D.traction) {
    $("#pwm-note").textContent = $("#mot-note").textContent = $("#spec-note").textContent = "no motor converter in this system";
  }
  const z = s.zoom;
  if (z) {
    charts.zoom.set([z.t, z.v, z.s, z.i]);
    const vmin = Math.min(...z.v), vmax = Math.max(...z.v);
    $("#zoom-note").textContent = `simulated at 0.25 ms · DC link ripple ${(vmax - vmin).toFixed(0)} V p-p` + (D.f2 ? ` · 2f = ${D.f2.toFixed(1)} Hz` : D.f0 ? ` · line filter f0 = ${D.f0.toFixed(1)} Hz` : "");
  }
  data.update(s);
  if (!$("#tab-lab").hidden) lab.update(s);
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (S) {
    const live = SIM.s, ts = S.cfg.time_scale;
    const view = { ...S, pos: live.pos, col_pos: live.col_pos, rpm: S.rpm };
    scene.update(view, live.pos);
    schem.update(S, dt * ts);
    $("#hud-speed").textContent = (live.speed * 3.6).toFixed(0);
    G.speed.set(live.speed * 3.6);
    G.freq.set(live.fs);
    G.vdc.set(live.vdc);
    G.power.set(live.p_mc / 1e6, live.p_mc < 0 ? COL.ok : COL.line);
  }
  requestAnimationFrame(frame);
}

function poll() {
  try {
    S = SIM.snapshot(true);
    renderState(S);
  } catch (e) { console.error(e); }
  setTimeout(poll, 100);
}

bindControls();
requestAnimationFrame(frame);
poll();
