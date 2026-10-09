// Active trips and warnings, shared by the simulator tab and the Trip Lab. Author: Rafael Tavares
const TRIP_BADGE = {
  Trip_SYS_0: "c0", Trip_SYS_1: "c1", Trip_SYS_2: "c2", Trip_SYS_3: "c3", EMERGENCY: "c0",
  OFF_SYS_1: "coff", OFF_SYS_2: "coff", OFF_FU: "coff", Trip_ESS: "cu", Trip_AUX: "cu", Trip_MC: "cu", Trip_LC: "cu", Warning: "cw",
};
const EXTRA_NAMES = {
  line_oc: "Line overcurrent", emergency: "Emergency", fuel_empty: "Fuel tank empty", h2_empty: "Hydrogen tank empty", bat_empty: "Battery empty",
  ctpos_unexp_open: "CtPos opens unexpectedly", ctpos_unexp_close: "CtPos closes unexpectedly", ctneg_unexp_open: "CtNeg opens unexpectedly",
  ctneg_unexp_close: "CtNeg closes unexpectedly", ctch_noclose: "CtCh does not close", ctch_noopen: "CtCh does not open",
};
const TRIP_INDEX = Object.fromEntries(TractionSim.TRIPS.map((t) => [t.id, t]));

const clsLabel = (cls, D) => (cls === "Trip_LC" && D && D.src === "genset" ? "Trip_GC" : cls);
const tripName = (code) => (TRIP_INDEX[code] ? TRIP_INDEX[code].name : EXTRA_NAMES[code] || code);
const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function resetHint(f, s) {
  if (f.cls === "Trip_SYS_3") {
    const ok = s.sys3 ? s.sys3.okT : 0;
    return ok > 0 ? `auto-restart in ${Math.max(0, 2 - ok).toFixed(1)} s` : "auto-restart when the condition clears";
  }
  if (f.cls === "EMERGENCY") return "RESET at standstill";
  const p = (TractionSim.TRIP_CLASSES[f.cls] || {}).reset;
  return p === "standstill" ? "RESET at standstill" : p === "reset" ? "RESET restarts the unit" : "";
}

function renderAlarms(el, s) {
  const D = s.D, rows = [];
  const faults = [...s.faults].sort((a, b) => ((TractionSim.TRIP_CLASSES[a.cls] || { sev: 0 }).sev - (TractionSim.TRIP_CLASSES[b.cls] || { sev: 0 }).sev));
  for (const f of faults) {
    rows.push(`<div class="al-row"><span class="badge ${TRIP_BADGE[f.cls] || "c2"}">${clsLabel(f.cls, D)}</span>
      <div class="al-txt"><b>${esc(tripName(f.code))}</b><small>${esc(f.msg)}</small></div>
      <div class="al-meta mono">${f.t.toFixed(2)} s<span>${esc(f.state)}</span></div>
      <div class="al-hint">${resetHint(f, s)}</div></div>`);
  }
  for (const w of Object.values(s.warns)) {
    rows.push(`<div class="al-row warn"><span class="badge cw">Warning</span>
      <div class="al-txt"><small>${esc(w.msg)}</small></div>
      <div class="al-meta mono">${w.t.toFixed(2)} s</div><div class="al-hint"></div></div>`);
  }
  el.innerHTML = rows.length ? rows.join("") : `<div class="al-ok">● No active trips or warnings</div>`;
  return { trips: faults.length, warns: Object.keys(s.warns).length };
}

// live value of an injected fault against its trip threshold (frac 1 = trip)
function labMeasure(id, s) {
  const D = s.D, f0 = (x) => x.toFixed(0), f2 = (x) => x.toFixed(2);
  const r = (v, lim, u, fmt = f0) => ({ frac: v / lim, txt: `${fmt(v)} / ${fmt(lim)} ${u}` });
  switch (id) {
    case "mc_oc": return r(s.i_mc_meas, D.Imc_trip, "A");
    case "earth_fault": return r(s.i_earth, 2, "A", f2);
    case "dcl_ov": return r(s.vdc, D.Vovp, "V");
    case "dcl_uv": return { frac: Math.max(0, (D.vdc - s.vdc) / Math.max(1, D.vdc - D.Vuv)), txt: `${f0(s.vdc)} V → limit ${f0(D.Vuv)} V` };
    case "aux_ovl": return { frac: s.aux_i2t / 2.5, txt: `load ${f0(s.aux_pu * 100)} % · curve ${f0(s.aux_i2t / 2.5 * 100)} %` };
    case "aux_ot": return r(s.t_aux, 95, "°C");
    case "fan_fail": return { frac: s.fan_t / 2, txt: `${s.f_hwr.toFixed(1)} / ${s.f_hwr_cmd.toFixed(1)} Hz` };
    case "precharge_timeout": case "voltage_no_rise": return { frac: 0, txt: "latent — detected at the next pre-charge" };
    case "ctpos_noclose": case "ctneg_noclose": return { frac: 0, txt: "latent — detected at the next close command" };
    case "ctpos_noopen": case "ctneg_noopen": case "welded": return { frac: 0, txt: "latent — detected at the next opening" };
    default: return null;
  }
}
