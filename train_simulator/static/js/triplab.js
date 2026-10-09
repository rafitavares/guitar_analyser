// Trip Lab panel below the electrical diagram: force a fault, follow it in the diagram until it trips.
// Author: Rafael Tavares
const LAB_GROUPS = { ess: "Pre-charge / ESS connection box", conv: "Traction converter — MC / LC / GC", aux: "Auxiliary converter — AUX" };
const LAB_FORMS = { step: "Step", ramp: "Ramp (slow rise)", intermittent: "Intermittent bursts" };

class TripLab {
  constructor(sim) {
    this.sim = sim;
    this.key = "";
    this.recVer = -1;
    this.histSig = "";
    this.chart = new Chart($("#c-rec"), {
      height: 240,
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
    const C = TractionSim.TRIP_CLASSES, rs = { standstill: "RESET at standstill", reset: "RESET (unit restarts)", auto: "automatic" };
    $("#lab-classes").innerHTML = "<tr><th>Class</th><th>Typical condition</th><th>Reaction (protective shutdown off)</th><th>Reset</th></tr>" +
      Object.entries(C).map(([k, c]) => `<tr><td><span class="badge ${TRIP_BADGE[k]}">${k === "Trip_LC" ? "Trip_LC / GC" : k}</span></td><td>${c.cond}</td><td>${c.react}</td><td>${rs[c.reset]}</td></tr>`).join("");
    $("#lab-trip").onchange = () => this.fill();
    $("#lab-unit").onchange = () => { if ($("#lab-trip").value === "igbt_desat") $("#lab-cls").value = TractionSim.UNIT_CLS[$("#lab-unit").value]; };
    $("#lab-go").onclick = () => {
      const id = $("#lab-trip").value, T = TRIP_INDEX[id];
      this.sim.command("inject", { id, unit: T.units ? $("#lab-unit").value : undefined, form: T.forms ? $("#lab-form").value : undefined, trig: $("#lab-trig").value, cls: $("#lab-cls").value });
    };
    $("#lab-clear").onclick = () => this.sim.command("clear_inj", "all");
    $("#lab-shut").onchange = (e) => this.sim.command("lab_shutdown", e.target.checked);
  }

  // only the faults that exist in the selected configuration are offered
  build(S) {
    if (S.D.key === this.key) return;
    this.key = S.D.key;
    const D = this.sim.D, prev = $("#lab-trip").value;
    const ok = TractionSim.TRIPS.filter((t) => !t.need(D));
    $("#lab-trip").innerHTML = Object.entries(LAB_GROUPS).map(([g, title]) => {
      const items = ok.filter((t) => t.group === g);
      return items.length ? `<optgroup label="${title}">${items.map((t) => `<option value="${t.id}">${t.top ? "★ " : ""}${t.name}</option>`).join("")}</optgroup>` : "";
    }).join("");
    if (ok.some((t) => t.id === prev)) $("#lab-trip").value = prev;
    $("#lab-count").textContent = `${ok.length} faults possible in this configuration`;
    this.fill();
  }

  fill() {
    const D = this.sim.D, T = TRIP_INDEX[$("#lab-trip").value];
    if (!T) return;
    const opt = (pairs, v) => pairs.map(([k, t]) => `<option value="${k}"${k === v ? " selected" : ""}>${t}</option>`).join("");
    const units = T.units ? T.units(D) : null;
    $("#lab-unit-l").hidden = !units;
    if (units) $("#lab-unit").innerHTML = opt(units);
    $("#lab-form-l").hidden = !T.forms;
    if (T.forms) $("#lab-form").innerHTML = opt(T.forms.map((f) => [f, LAB_FORMS[f]]));
    $("#lab-trig").innerHTML = opt(T.trig.map((t) => [t, TractionSim.TRIGGERS[t]]));
    const cls0 = T.id === "igbt_desat" && units ? TractionSim.UNIT_CLS[units[0][0]] : T.cls;
    const lc = (k) => (k === "Trip_LC" && D.src === "genset" ? "Trip_GC" : k);
    $("#lab-cls").innerHTML = opt([...new Set([cls0, T.cls, ...T.alt])].map((c) => [c, lc(c) + (c === cls0 ? " (default)" : "")]), cls0);
    $("#lab-desc").innerHTML = `<b>${T.name}</b> — ${T.cond}. <span class="dim">Typical state: ${T.states}.${T.kind === "latent" ? " Latent defect: it shows up at the next command (START, STOP or ESS disconnect)." : ""}</span>`;
  }

  update(S) {
    this.build(S);
    const shut = $("#lab-shut");
    if (document.activeElement !== shut) shut.checked = S.labShutdown;
    // active and armed faults with their value against the trip threshold
    $("#lab-active").innerHTML = S.inj.map((j) => {
      const m = j.st === "active" ? labMeasure(j.id, S) : null;
      const tf = S.faults.find((f) => f.code === j.id), tripped = !!tf;
      const frac = tripped ? 1 : m ? Math.max(0, Math.min(1, m.frac)) : 0;
      const st = tripped ? `TRIPPED · ${clsLabel(tf.cls, S.D)}` : j.st === "armed" ? `armed · ${TractionSim.TRIGGERS[j.trig].toLowerCase()}` : "active";
      return `<div class="lab-inj ${tripped ? "trip" : j.st}"><b>⚡ ${tripName(j.id)}</b><span class="mono st">${st}</span>
        <div class="lvbar ${frac > 0.85 ? "hot" : ""}"><i style="width:${(frac * 100).toFixed(0)}%"></i><em style="left:100%"></em></div>
        <span class="mono val">${tripped ? (S.protShut ? "system shut down" : "class reaction") : m ? m.txt : j.st === "active" ? "event" : ""}</span>
        <button class="btn ghost small" data-rm="${j.id}">Remove</button></div>`;
    }).join("");
    $$("#lab-active [data-rm]").forEach((b) => (b.onclick = () => this.sim.command("clear_inj", b.dataset.rm)));
    // history and recorder (inside the collapsible section)
    const sig = S.hist.length + ":" + (S.hist.length ? S.hist[S.hist.length - 1].t : "");
    if (sig !== this.histSig) {
      this.histSig = sig;
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
      } else { this.chart.set([[], [], [], [], [], []]); $("#rec-note").textContent = "waiting for a trip — 4 s before and 2 s after are frozen"; }
    }
  }
}
