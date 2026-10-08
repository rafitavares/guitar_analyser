// "System data" tab: configuration, modules, EN 50163 table, effort curves and energy meters.
// Author: Rafael Tavares
function initData(sim) {
  const fv = new Chart($("#c-fv"), {
    height: 300,
    scales: { x: { time: false }, F: { auto: true } },
    axes: [axisX("speed [km/h]"), axisY("kN", "F")],
    series: [{ label: "v", value: val("km/h", 1) },
      { label: "Traction (nominal)", stroke: COL.ok, width: 2.5, scale: "F", value: val("kN", 1) },
      { label: "Traction (Umin1)", stroke: COL.ok, width: 1.5, dash: [6, 4], scale: "F", value: val("kN", 1) },
      { label: "Electric brake", stroke: COL.bad, width: 2, scale: "F", value: val("kN", 1) },
      { label: "Running resistance", stroke: "#a6a6a6", width: 1.2, dash: [3, 3], scale: "F", value: val("kN", 1) },
      { label: "Operating point", stroke: COL.ac, width: 0, scale: "F", points: { show: true, size: 11, fill: COL.ac }, value: val("kN", 1) }],
  }, 6);
  let key = "";
  const row = (cells, head) => `<tr>${cells.map((c) => (head ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`;

  function refreshStatic(s) {
    const D = s.D, M = D.motor;
    const lines = [
      ["System", D.system + (D.supply ? ` · ${D.supply.label}` : "")],
      ["DC link", `${D.vdc} V ${D.src === "dcline" ? "(follows the line)" : "(regulated)"} · C = ${(D.C * 1e3).toFixed(1)} mF`],
      ["Semiconductors", `${D.igbt}, ${D.levels === 3 ? "3-level NPC" : "2-level"}, device switching ≈ ${D.fswDev} Hz`],
    ];
    if (D.src === "dcline") lines.push(["Line feeding", `substations every ${D.line.spacing} km, ${D.line.rkm} Ω/km, line filter ${(D.L * 1e3).toFixed(1)} mH (f0 = ${D.f0.toFixed(1)} Hz)`],
      ["Protection", `${D.brkName} trip ${D.Itrip.toFixed(0)} A, line current limit ${D.Ilim.toFixed(0)} A`]);
    if (D.src === "acline") lines.push(["Transformer", `${(D.supply.Un / 1e3).toFixed(0)} kV / ${D.V2} V, ${D.supply.f} Hz`], ["Line converter", `4QC ${(D.Plc / 1e6).toFixed(2)} MW, unity power factor`]);
    if (D.src === "genset") lines.push(["Diesel generator set", `${(D.Peng / 1e3).toFixed(0)} kW, ${D.nIdle}–${D.nMax} rpm, fuel tank ${D.fuelCap} l`]);
    if (D.bat) lines.push(["Energy storage", `${D.bat.chem} ${(D.bat.E / 1e3).toFixed(0)} kWh, ${D.bat.Vn} V, discharge ${(D.bat.Pdis / 1e3).toFixed(0)} kW, charge ${(D.bat.Pch / 1e3).toFixed(0)} kW`]);
    if (D.fc_mod) lines.push(["Fuel cell", `${D.fc_mod.n} × ${(D.fc_mod.Pgross / 1e3).toFixed(0)} kW PEM, ${D.fc_mod.cells} cells × ${D.fc_mod.area} cm², H₂ ${D.fc_mod.tank} kg`]);
    if (D.vehicle) {
      const v = D.vehicle;
      lines.push(["Vehicle", `${v.label}: ${v.mass} t, max effort ${v.fmax} kN, max speed ${v.vmax} km/h`]);
      lines.push(["Traction motors", `${M.nm} × ${(M.P / 1e3).toFixed(0)} kW induction, ${M.VLL.toFixed(0)} V, ${M.Ir.toFixed(0)} A, rated ${M.fr.toFixed(1)} Hz, gear ${M.gear.toFixed(2)}`]);
    }
    lines.push(["VLU", D.vlu ? `${(D.Pvlu / 1e6).toFixed(2)} MW, on at ${D.Von.toFixed(0)} V, overvoltage trip ${D.Vovp.toFixed(0)} V` : "not fitted"]);
    $("#d-summary").innerHTML = lines.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
    $("#d-modules").innerHTML = row(["Module", "Function / rating"], true) + D.modules.map((m) => row([`<b>${m.id}</b> ${m.name}`, m.detail])).join("");
    const sup = TractionSim.SUPPLIES;
    $("#d-supplies").innerHTML = row(["System", "Umin2", "Umin1", "Un", "Umax1", "Umax2", "Used in"], true) +
      Object.values(sup).map((x) => `<tr class="${D.supply && D.supply.id === x.id ? "sel" : ""}"><td><b>${x.label}</b></td><td>${x.Umin2}</td><td>${x.Umin1}</td><td>${x.Un}</td><td>${x.Umax1}</td><td>${x.Umax2}</td><td>${x.where}</td></tr>`).join("");
    const cv = sim.curves();
    if (cv) {
      fv.u.series[1].label = cv.labels[0];
      if (cv.labels[1]) fv.u.series[2].label = cv.labels[1];
      fv.u.setSeries(2, { show: !!cv.trac[1] });
      fv.cv = cv;
    }
    $("#c-fv").closest(".card").hidden = !cv;
  }

  return {
    update(s) {
      if (s.D.key !== key) { key = s.D.key; refreshStatic(s); }
      const cv = fv.cv;
      if (cv && !$("#tab-data").hidden) {
        const op = cv.v.map(() => null);
        const k = cv.v.findIndex((v) => v >= s.speed_kmh);
        if (k >= 0) op[k] = Math.abs(s.force) / 1e3;
        fv.set([cv.v, cv.trac[0], cv.trac[1] || cv.v.map(() => null), cv.brake, cv.res, op]);
      }
      const E = s.E, kwh = (j) => (j / 3.6e6).toFixed(2) + " kWh";
      const rows = [
        ["Distance", (E.dist / 1000).toFixed(2) + " km"],
        ["Energy from supply", kwh(E.src)],
        ["Regenerated to supply", kwh(E.regen)],
        ["Dissipated in VLU", kwh(E.vlu)],
        ["Auxiliaries (HBU + HWR)", kwh(E.aux)],
        ["At the wheel — traction", kwh(E.trac)],
        ["At the wheel — electric braking", kwh(E.brake)],
      ];
      if (s.D.bat) rows.push(["Battery discharged / charged", `${kwh(E.batOut)} / ${kwh(E.batIn)}`]);
      if (s.D.fc_mod) rows.push(["Hydrogen consumed", E.h2.toFixed(2) + " kg"]);
      if (s.D.src === "genset") rows.push(["Diesel consumed", E.fuel.toFixed(1) + " l"]);
      if (E.dist > 100) rows.push(["Specific consumption", ((E.src + (s.D.bat ? E.batOut - E.batIn : 0) - E.regen) / 3.6e6 / (E.dist / 1000)).toFixed(2) + " kWh/km"]);
      $("#d-energy").innerHTML = row(["Meter", "Value"], true) + rows.map((r) => row(r)).join("");
    },
  };
}
