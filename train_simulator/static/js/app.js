// Main application: polls the simulation state and renders it
// Author: Rafael Tavares
const PHASES = {
  OFF: ["OFF", ""], RAISE_PANTO: ["RAISING PANTOGRAPH", "seq"], CLOSE_MCB: ["CLOSING MCB", "seq"],
  PRECHARGE: ["DC LINK PRE-CHARGE", "seq"], CLOSE_CTL: ["CLOSING CtL", "seq"], STABILIZE: ["STABILIZING", "seq"],
  INVERTER: ["MAGNETIZING", "seq"], TRACTION: ["TRACTION", "run"], BRAKING: ["BRAKING", "seq"],
  SHUTDOWN: ["SHUTTING DOWN", "seq"], MANUAL: ["MANUAL", "man"], EMERGENCY: ["EMERGENCY", "bad"],
};
const TS = [1, 2, 3, 5, 8, 10];

const scene = new TrainScene($("#scene"));
const schem = new Schematic($("#schem"), (id) => apiCmd("toggle", id));
const charts = makeCharts();
const lab = initLab();
const G = {
  speed: new Gauge($("#g-speed"), { min: 0, max: 160, label: "Speed", unit: "km/h", color: COL.ok, zones: [[140, 160, COL.bad]] }),
  freq: new Gauge($("#g-freq"), { min: 0, max: 160, label: "Motor frequency", unit: "Hz", digits: 1, color: COL.ac }),
  vdc: new Gauge($("#g-vdc"), { min: 0, max: 4000, label: "DC link voltage", unit: "V", color: COL.dc, zones: [[3510, 4000, COL.bad]], mark: 3000 }),
  power: new Gauge($("#g-power"), { min: -1.5, max: 1.5, label: "Power (traction / regen)", unit: "MW", digits: 2, color: COL.line, bipolar: true }),
};
const hDC = new History(5, 60);
const hTrain = new History(4, 120);

let S = null, tState = 0, lastEvent = 0, lastFrame = performance.now(), online = true;

// ------------------------------------------------------------------ controls
function bindControls() {
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
    $("#tab-sim").hidden = b.dataset.tab !== "sim";
    $("#tab-lab").hidden = b.dataset.tab !== "lab";
    if (b.dataset.tab === "lab") lab.refresh();
    window.dispatchEvent(new Event("resize"));
  }));
  $$("#mode-seg button").forEach((b) => b.addEventListener("click", () => apiCmd("mode", b.dataset.mode)));
  $("#btn-start").onclick = () => apiCmd("start");
  $("#btn-stop").onclick = () => apiCmd("stop");
  $("#btn-emerg").onclick = () => apiCmd("emergency");
  $("#btn-reset").onclick = () => { apiCmd("reset"); };
  $("#sel-supply").onchange = (e) => { hDC.clear(); apiCmd("config", { supply: e.target.value }); };
  $("#sel-levels").onchange = (e) => apiCmd("config", { levels: +e.target.value });
  $("#sel-pwm").onchange = (e) => apiCmd("config", { pwm_method: e.target.value });

  const slide = (id, out, f, send) => {
    const el = $(id);
    const sendD = debounce(send, 40);
    el.addEventListener("input", () => { $(out).textContent = f(+el.value); sendD(+el.value); });
  };
  slide("#in-target", "#v-target", (v) => v + " km/h", (v) => apiCmd("set", { target_kmh: v }));
  slide("#in-ts", "#v-ts", (v) => TS[v] + "×", (v) => apiCmd("set", { time_scale: TS[v] }));
  slide("#in-ts2", "#v-ts2", (v) => TS[v] + "×", (v) => apiCmd("set", { time_scale: TS[v] }));
  slide("#in-thr", "#v-thr", (v) => (v > 0 ? "+" : "") + v + " %", (v) => apiCmd("set", { throttle: v / 100 }));
  slide("#in-fcmd", "#v-fcmd", (v) => v.toFixed(1) + " Hz", (v) => apiCmd("set", { f_cmd: v }));
  slide("#in-mcmd", "#v-mcmd", (v) => v.toFixed(2), (v) => apiCmd("set", { m_cmd: v }));
  slide("#in-fc", "#v-fc", (v) => v + " Hz", (v) => apiCmd("config", { [S && S.cfg.levels === 3 ? "fc_3l" : "fc_2l"]: v }));
  $("#in-vf").onchange = (e) => apiCmd("set", { vf_auto: e.target.checked });
  $("#btn-thr0").onclick = () => { $("#in-thr").value = 0; $("#v-thr").textContent = "0 %"; apiCmd("set", { throttle: 0 }); };
  $$("#ctrl-seg button").forEach((b) => b.addEventListener("click", () => apiCmd("set", { ctrl: b.dataset.ctrl })));

  // keyboard shortcuts (manual mode): ↑/↓ master controller
  window.addEventListener("keydown", (e) => {
    if (!S || S.mode !== "manual" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    const el = $("#in-thr");
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      el.value = +el.value + (e.key === "ArrowUp" ? 10 : -10);
      el.dispatchEvent(new Event("input"));
      e.preventDefault();
    }
  });
}

function syncInput(el, v) {
  if (document.activeElement !== el && +el.value !== v) el.value = v;
}

// ------------------------------------------------------------------ render
function buildSteps(names) {
  $("#steps").innerHTML = names.map((n) => `<li><span class="lbl">${n}</span><span class="pct">0%</span><span class="bar"><i></i></span></li>`).join("");
}

function renderState(s) {
  const c = s.cfg;
  // header
  const [ptxt, pcls] = PHASES[s.phase] || [s.phase, ""];
  const pill = $("#phase-pill");
  pill.textContent = s.faults.length ? "FAULT" : ptxt;
  pill.className = "pill " + (s.faults.length ? "bad" : pcls);
  $("#clock").textContent = `t = ${s.t.toFixed(1)} s`;
  $("#topo-label").textContent = (c.supply === "AC" ? "25 kV 50 Hz AC · transformer + 4QC" : "3 kV DC")
    + ` · ${c.levels === 3 ? "3-level NPC" : "2-level"} inverter · ${c.pwm_method === "excel" ? "Excel" : "classic"} PWM`;

  // mode and panels
  $$("#mode-seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === s.mode));
  $("#drive-auto").hidden = s.mode !== "auto";
  $("#drive-manual").hidden = s.mode !== "manual";
  $("#btn-start").disabled = s.mode !== "auto";
  $("#schem-hint").textContent = s.mode === "manual" ? "Click the contactors, pantograph, 4QC and inverter" : "Automatic mode";
  $$("#ctrl-seg button").forEach((b) => b.classList.toggle("on", b.dataset.ctrl === s.ctrl));
  $("#ctrl-throttle").hidden = s.ctrl !== "throttle";
  $("#ctrl-freq").hidden = s.ctrl !== "freq";
  if (document.activeElement !== $("#sel-supply")) $("#sel-supply").value = c.supply;
  if (document.activeElement !== $("#sel-levels")) $("#sel-levels").value = String(c.levels);
  if (document.activeElement !== $("#sel-pwm")) $("#sel-pwm").value = c.pwm_method;
  syncInput($("#in-fc"), c.fc); $("#v-fc").textContent = c.fc + " Hz";
  if (s.mode === "manual" && s.ctrl === "freq") {
    if (document.activeElement !== $("#in-mcmd") && s.vf_auto) { $("#in-mcmd").value = s.m; $("#v-mcmd").textContent = s.m.toFixed(2); }
    $("#in-mcmd").disabled = s.vf_auto;
    $("#in-vf").checked = s.vf_auto;
  }
  if (s.mode === "manual" && s.ctrl === "throttle") {
    syncInput($("#in-thr"), Math.round(s.throttle * 100));
    $("#v-thr").textContent = (s.throttle > 0 ? "+" : "") + Math.round(s.throttle * 100) + " %";
  }

  // sequence
  if (!$("#steps").children.length) buildSteps(s.step_names);
  const lis = $("#steps").children;
  let activeSet = false;
  s.steps.forEach((p, i) => {
    const li = lis[i];
    li.querySelector("i").style.width = p + "%";
    li.querySelector(".pct").textContent = Math.round(p) + "%";
    li.classList.toggle("done", p >= 100);
    const act = !activeSet && p < 100 && s.mode === "auto" && !["OFF", "EMERGENCY"].includes(s.phase);
    li.classList.toggle("active", act);
    if (act) activeSet = true;
  });

  // KPIs
  $("#k-force").textContent = `${(s.force / 1e3).toFixed(1)} kN`;
  $("#k-iph").textContent = `${s.i_phase.toFixed(0)} A rms`;
  $("#k-idc").textContent = `${s.i_dc.toFixed(0)} A`;
  $("#k-m").textContent = s.m.toFixed(2);
  $("#k-mech").textContent = `${(-s.force_mech / 1e3).toFixed(1)} kN`;
  const sp = s.wave && s.wave.spec;
  $("#k-thd").textContent = sp && sp.thd_uab != null ? `${sp.thd_uab.toFixed(1)} %` : "—";
  $("#hud-dist").textContent = `${(s.pos / 1000).toFixed(2)} km · ${PHASES[s.phase]?.[0] || s.phase}`;

  // faults
  const fb = $("#fault-banner");
  fb.hidden = !s.faults.length;
  if (s.faults.length) fb.innerHTML = s.faults.map((f) => "⚠ " + f).join("<br>") + "<br><small>Press RESET with the train at standstill.</small>";

  // log
  const newEv = s.events.filter((e) => e.id > lastEvent);
  if (s.events.length && s.events[s.events.length - 1].id < lastEvent) { $("#log").innerHTML = ""; lastEvent = 0; }
  for (const e of newEv) {
    const li = document.createElement("li");
    li.className = e.level;
    li.innerHTML = `<span>${e.t.toFixed(2)} s</span>${e.msg}`;
    $("#log").prepend(li);
    lastEvent = e.id;
  }
  while ($("#log").children.length > 150) $("#log").lastChild.remove();

  // histories
  hDC.push([s.t, s.vdc, s.v_src, s.v_src > 0 ? s.v_src * c.precharge_pct / 100 : null, s.i_dc]);
  hTrain.push([s.t, s.speed_kmh, (s.force + s.force_mech) / 1e3, s.p_elec / 1e6]);
  charts.dc.set(hDC.cols);
  charts.train.set(hTrain.cols);

  // waveforms computed by the engine
  const w = s.wave;
  if (w) {
    const V = s.vdc / 2;
    let up = w.carrier, lo;
    if (c.pwm_method === "excel") lo = w.carrier.map((x) => -x);
    else if (c.levels === 2) { up = w.carrier.map((x) => 2 * x - V); lo = w.t.map(() => null); }
    else lo = w.carrier.map((x) => x - V);
    charts.pwm.set([w.t, w.pwm, w.ref, up, lo]);
    $("#pwm-note").textContent = `${c.pwm_method === "excel" ? "Excel" : "classic"} · ${c.levels}L · carrier ${c.fc} Hz · f = ${s.f_s.toFixed(1)} Hz · m = ${s.m.toFixed(2)}`;
    charts.uab.set([w.t, w.uab, w.ia, w.ib, w.ic]);
    if (w.spec) {
      charts.spec.set([w.spec.f, w.spec.a]);
      $("#spec-note").textContent = `fundamental ${w.spec.fund_uab.toFixed(0)} V · THD U–V ${w.spec.thd_uab.toFixed(1)} % · THD phase ${w.spec.thd_pwm.toFixed(1)} %`;
    } else {
      charts.spec.set([[], []]);
      $("#spec-note").textContent = "inverter stopped";
    }
    charts.zoom.set([w.dct, w.dcv]);
    const mn = Math.min(...w.dcv), mx = Math.max(...w.dcv);
    $("#rip-note").textContent = `peak-to-peak ripple ${(mx - mn).toFixed(0)} V` + (c.supply === "AC" ? " · 100 Hz (2× grid)" : "");
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (S) {
    const ts = S.cfg.time_scale;
    const pos = S.pos + S.speed * Math.min(0.3, (now - tState) / 1000) * ts; // extrapolate between samples
    scene.update(S, pos);
    schem.update(S, dt * ts);
    $("#hud-speed").textContent = S.speed_kmh.toFixed(0);
    G.speed.set(S.speed_kmh);
    G.freq.set(S.f_s);
    G.vdc.set(S.vdc);
    G.power.set(S.p_elec / 1e6, S.p_elec < 0 ? "#1EC337" : COL.line);
  }
  requestAnimationFrame(frame);
}

async function poll() {
  try {
    const s = await apiGet("/api/state?wave=1");
    S = s; tState = performance.now();
    if (!online) { online = true; $("#fault-banner").hidden = true; }
    renderState(s);
  } catch (e) {
    online = false;
    const fb = $("#fault-banner");
    fb.hidden = false;
    fb.textContent = "No connection to the Python server (app.py). Is it running?";
  }
  setTimeout(poll, 90);
}

bindControls();
requestAnimationFrame(frame);
poll();
