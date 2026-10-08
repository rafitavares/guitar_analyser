// Trip Lab: fault injection, live protection status, trip recorder and history. Author: Rafael Tavares
const LAB_GROUPS = { ess: "ESS / connection box", conv: "Traction converter — MC / LC / GC", aux: "Auxiliary converter — AUX" };
const LAB_FORMS = { step: "Step", ramp: "Ramp (slow rise)", intermittent: "Intermittent bursts" };

class TripLab {
  constructor(sim) {
    this.sim = sim;
    this.key = "";
    this.recVer = -1;
    this.histN = -1;
    this.rows = {};
    this.chart = new Chart($("#c-rec"), {
      height: 260,
      scales: { x: { time: false }, V: { auto: true }, A: { auto: true }, E: { auto: true, range: (u, a, b) => [0, Math.max(3, b * 1.1)] } },
      axes: [axisX("time from trip [s]"), axisY("V", "V"), axisY("A", "A", 1), axisY("earth A", "E", 1, { size: 50 })],
      series: [{ label: "t", value: val("s", 2) },
        { label: "Vdc", stroke: COL.dc, width: 2, scale: "V", value: val("V") },
        { label: "ESC input", stroke: COL.ess, width: 1.5, scale: "V", value: val("V") },
        { label: "Supply / battery I", stroke: COL.line, width: 1.5, scale: "A", value: val("A") },
        { label: "MC current", stroke: COL.ac, width: 1.5, scale: "A", value: val("A") },
        { label: "Earth current", stroke: COL.bad, width: 1.5, dash: [4, 3], scale: "E", value: val("A", 2) }],
      hooks: { draw: [(u) => {
        const x = u.valToPos(0, "x", true);
        if (!Number.isFinite(x)) return;
        const c = u.ctx;
        c.save(); c.strokeStyle = "#F03040"; c.setLineDash([6, 4]); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, u.bbox.top); c.lineTo(x, u.bbox.top + u.bbox.height); c.stroke(); c.restore();
      }] },
    }, 6);
    this.classTable();
    const cmd = (c, v) => this.sim.command(c, v);
    $("#lab-start").onclick = () => cmd("start");
    $("#lab-stop").onclick = () => cmd("stop");
    $("#lab-reset").onclick = () => cmd("reset");
    $("#lab-ess-on").onclick = () => cmd("ess", true);
    $("#lab-ess-off").onclick = () => cmd("ess", false);
    $("#lab-clear").onclick = () => cmd("clear_inj", "all");
  }

  classTable() {
    const C = TractionSim.TRIP_CLASSES;
    const rs = { standstill: "RESET at standstill", reset: "RESET (unit restarts)", auto: "automatic" };
    $("#lab-classes").innerHTML = "<tr><th>Class</th><th>Typical condition</th><th>Reaction</th><th>Reset</th></tr>" +
      Object.entries(C).map(([k, c]) => `<tr><td><span class="badge ${TRIP_BADGE[k]}">${k === "Trip_LC" ? "Trip_LC / GC" : k}</span></td><td>${c.cond}</td><td>${c.react}</td><td>${rs[c.reset]}</td></tr>`).join("");
  }

  // catalog of injectable faults for the current system
  build(S) {
    const D = S.D;
    if (D.key === this.key) return;
    this.key = D.key;
    const Dfull = this.sim.D;
    const root = $("#lab-cat");
    root.innerHTML = "";
    this.rows = {};
    for (const [g, title] of Object.entries(LAB_GROUPS)) {
      const card = document.createElement("div");
      card.className = "card lab-group";
      card.innerHTML = `<div class="card-head"><h2>${title}</h2></div>`;
      for (const T of TractionSim.TRIPS.filter((x) => x.group === g)) card.appendChild(this.row(T, Dfull));
      root.appendChild(card);
    }
    $("#lab-sys").textContent = `System: ${D.system}${D.supply ? " " + D.supply.label : ""}${D.ess ? " · ESS" : ""}.`;
  }

  row(T, D) {
    const why = T.need(D);
    const el = document.createElement("div");
    el.className = "lab-row" + (why ? " off" : "");
    const opt = (pairs, v) => pairs.map(([k, t]) => `<option value="${k}"${k === v ? " selected" : ""}>${t}</option>`).join("");
    const units = T.units ? T.units(D) : null;
    const cls0 = T.id === "igbt_desat" && units && units.length ? TractionSim.UNIT_CLS[units[0][0]] : T.cls;
    const clsList = [...new Set([cls0, T.cls, ...T.alt])];
    const lc = (k) => (k === "Trip_LC" && D.src === "genset" ? "Trip_GC" : k);
    el.innerHTML = `
      <div class="lab-info">
        <b>${T.name}${T.top ? ' <span class="star" title="Most common in projects">★</span>' : ""}</b>
        <small>${T.cond}</small>
        <small class="dim">Typical state: ${T.states}${T.kind === "latent" ? " · latent defect, detected at the next command" : ""}</small>
        ${why ? `<small class="why">Not available: ${why}</small>` : ""}
      </div>
      <div class="lab-opts">
        ${units ? `<label>Converter / circuit<select data-k="unit">${opt(units)}</select></label>` : ""}
        ${T.forms ? `<label>Form<select data-k="form">${opt(T.forms.map((f) => [f, LAB_FORMS[f]]))}</select></label>` : ""}
        <label>When<select data-k="trig">${opt(T.trig.map((t) => [t, TractionSim.TRIGGERS[t]]))}</select></label>
        <label>Trip class<select data-k="cls">${opt(clsList.map((c) => [c, lc(c) + (c === cls0 ? " (default)" : "")]), cls0)}</select></label>
      </div>
      <div class="lab-act">
        <button class="btn small inject"${why ? " disabled" : ""}>Inject</button>
        <span class="lab-st mono"></span>
        <button class="btn ghost small clear" hidden>Remove</button>
      </div>`;
    const get = (k) => { const s = el.querySelector(`[data-k=${k}]`); return s ? s.value : undefined; };
    if (T.id === "igbt_desat") {
      const u = el.querySelector("[data-k=unit]");
      if (u) u.onchange = () => { el.querySelector("[data-k=cls]").value = TractionSim.UNIT_CLS[u.value]; };
    }
    el.querySelector(".inject").onclick = () => this.sim.command("inject", { id: T.id, unit: get("unit"), form: get("form"), trig: get("trig"), cls: get("cls") });
    el.querySelector(".clear").onclick = () => this.sim.command("clear_inj", T.id);
    this.rows[T.id] = { el, st: el.querySelector(".lab-st"), clear: el.querySelector(".clear") };
    return el;
  }

  live(S) {
    const D = S.D, s = S, out = [];
    const bar = (label, v, max, txt, marks = [], cls = "") => {
      const pct = (x) => Math.max(0, Math.min(100, (x / max) * 100));
      out.push(`<div class="lv"><span>${label}</span><div class="lvbar ${cls}"><i style="width:${pct(v)}%"></i>${marks.map(([m, t]) => `<em style="left:${pct(m)}%" title="${t}"></em>`).join("")}</div><b class="mono">${txt}</b></div>`);
    };
    out.push(`<div class="lv-state"><span>Operating state</span><b>${S.sysState}</b></div>`);
    bar("DC link", s.vdc, D.Vovp * 1.1, `${s.vdc.toFixed(0)} V`, [[D.Vuv, "undervoltage"], [D.Von, "VLU on"], [D.Vovp, "overvoltage trip"]], s.vdc > D.Von ? "hot" : "");
    if (D.motor) bar("MC current", s.i_mc_meas, D.Imc_trip * 1.3, `${s.i_mc_meas.toFixed(0)} A`, [[0.85 * D.Imc_trip, "warning"], [D.Imc_trip, "trip"]], s.i_mc_meas > 0.85 * D.Imc_trip ? "hot" : "");
    bar("Earth current", s.i_earth, 3, `${s.i_earth.toFixed(2)} A`, [[0.5, "warning"], [2, "trip"]], s.i_earth > 0.5 ? "hot" : "");
    if (D.hasHBU) bar("AUX load", s.aux_pu * 100, 200, `${(s.aux_pu * 100).toFixed(0)} %`, [[100, "rated"]], s.aux_pu > 1 ? "hot" : "");
    if (D.hasHBU || D.hasHWR) bar("AUX temperature", s.t_aux, 110, `${s.t_aux.toFixed(0)} °C`, [[85, "warning"], [95, "trip"]], s.t_aux > 85 ? "hot" : "");
    if (D.hasHWR) bar("Fan speed", s.f_hwr, 55, `${s.f_hwr.toFixed(1)} / ${s.f_hwr_cmd.toFixed(1)} Hz`, [[s.f_hwr_cmd * 0.5, "50 % of command"]], s.hwr && s.f_hwr < 0.5 * s.f_hwr_cmd ? "hot" : "");
    if (D.bat) {
      const b = s.eb, led = (on, bad) => `<i class="led${on ? " on" : ""}${bad ? " bad" : ""}"></i>`;
      const rows = ["neg", "ch", "pos"].map((k) => {
        const c = b.c[k], bad = c.cmd !== c.fb || c.act !== c.fb;
        return `<tr><td>${{ pos: "CtPos", neg: "CtNeg", ch: "CtCh" }[k]}</td><td>${led(c.cmd)}</td><td>${led(c.fb, bad)}</td><td>${led(c.act, c.act !== c.fb)}</td></tr>`;
      }).join("");
      out.push(`<div class="lv-box"><div class="lv-state"><span>ESS connection box</span><b class="ebst ${b.st === "Trip" ? "bad" : b.st === "Connected" ? "ok" : ""}">${b.st}${b.lock ? " · locked" : ""}</b></div>
        <table class="ct"><tr><th></th><th>command</th><th>feedback</th><th>contacts</th></tr>${rows}</table>
        <div class="lv-state"><span>ESC input / battery</span><b class="mono">${b.vec.toFixed(0)} V / ${s.v_bat.toFixed(0)} V</b></div></div>`);
    }
    $("#lab-live").innerHTML = out.join("");
  }

  update(S) {
    this.build(S);
    const [ptxt, pcls] = PHASES[S.phase] || [S.phase, ""];
    const pill = $("#lab-phase");
    pill.textContent = S.faults.length ? "FAULT" : ptxt;
    pill.className = "pill " + (S.faults.length ? "bad" : pcls);
    $("#lab-start").disabled = S.mode !== "auto";
    $("#lab-ess-on").hidden = $("#lab-ess-off").hidden = !S.D.bat;
    const inj = Object.fromEntries(S.inj.map((j) => [j.id, j]));
    for (const [id, r] of Object.entries(this.rows)) {
      const j = inj[id];
      r.el.classList.toggle("armed", !!j && j.st === "armed");
      r.el.classList.toggle("active", !!j && j.st === "active");
      r.clear.hidden = !j;
      r.st.textContent = !j ? "" : j.st === "armed" ? `armed · ${TractionSim.TRIGGERS[j.trig].toLowerCase()}` : `active since ${j.ta.toFixed(1)} s → ${clsLabel(j.cls, S.D)}`;
    }
    this.live(S);
    renderAlarms($("#lab-alarms"), S);
    if (S.hist.length !== this.histN || (S.hist.length && S.hist[S.hist.length - 1].t !== this.histT)) {
      this.histN = S.hist.length; this.histT = S.hist.length ? S.hist[S.hist.length - 1].t : null;
      $("#lab-hist").innerHTML = "<tr><th>t [s]</th><th>Class</th><th>Fault</th><th>Message</th><th>State</th></tr>" +
        (S.hist.length ? [...S.hist].reverse().map((h) => `<tr><td class="mono">${h.t.toFixed(2)}</td><td><span class="badge ${TRIP_BADGE[h.cls] || "c2"}">${clsLabel(h.cls, S.D)}</span></td><td>${esc(h.name)}</td><td>${esc(h.msg)}</td><td>${esc(h.state)}</td></tr>`).join("")
          : `<tr><td colspan="5" class="dim">No trips yet</td></tr>`);
    }
    if (S.recVer !== this.recVer) {
      this.recVer = S.recVer;
      const R = this.sim.recorder().frozen;
      if (R) {
        this.chart.set(R.cols);
        $("#rec-note").textContent = `${clsLabel(R.f.cls, S.D)} · ${tripName(R.f.code)} at t = ${R.f.t.toFixed(2)} s (${R.f.state}) — red line = trip`;
      } else { this.chart.set([[], [], [], [], [], []]); }
    }
  }
}
