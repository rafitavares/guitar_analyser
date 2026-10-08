// uPlot charts (fast enough to update at ~10 Hz). Author: Rafael Tavares
const COL = {
  dc: "#3D85FF", line: "#FF7300", ac: "#FFD800", ok: "#1EC337", bad: "#F03040", ess: "#1EC337",
  grid: "#2c2c2c", axis: "#a6a6a6", dim: "#707070", ia: "#FF6B6B", ib: "#1EC337", ic: "#8AB4FF", force: "#FF9A40",
};

const axisX = (label) => ({ stroke: COL.axis, grid: { stroke: COL.grid, width: 1 }, ticks: { stroke: COL.grid }, label, labelSize: 18, size: 36 });
const axisY = (label, scale, side = 3, extra = {}) => ({
  scale, side, label, stroke: COL.axis, labelSize: 18, size: 56,
  grid: { show: side === 3, stroke: COL.grid, width: 1 }, ticks: { stroke: COL.grid }, ...extra,
});
const val = (unit, d = 0) => (u, v) => (v == null ? "—" : v.toFixed(d) + " " + unit);

class Chart {
  constructor(el, opts, nSeries) {
    this.el = el;
    const w = Math.max(300, el.clientWidth);
    this.u = new uPlot({ width: w, height: opts.height || 230, cursor: { drag: { x: true, y: false } }, legend: { live: true }, ...opts },
      Array.from({ length: nSeries }, () => []), el);
    new ResizeObserver(() => {
      const w2 = Math.max(300, el.clientWidth);
      if (Math.abs(w2 - this.u.width) > 2) this.u.setSize({ width: w2, height: this.u.height });
    }).observe(el);
  }
  set(data, resetScales = true) { this.u.setData(data, resetScales); }
}

function makeCharts() {
  const C = {};
  C.dc = new Chart($("#c-dc"), {
    scales: { x: { time: false }, V: { auto: true, range: (u, a, b) => [0, Math.max(b * 1.08, 100)] }, A: { auto: true } },
    axes: [axisX("t [s]"), axisY("V", "V"), axisY("A", "A", 1)],
    series: [{ label: "t", value: val("s", 1) },
      { label: "Vdc", stroke: COL.dc, width: 2, scale: "V", fill: "rgba(61,133,255,.08)", value: val("V") },
      { label: "Supply V", stroke: COL.line, width: 1.5, dash: [6, 4], scale: "V", value: val("V") },
      { label: "Supply I", stroke: COL.ia, width: 1.5, scale: "A", value: val("A") },
      { label: "MC I (DC)", stroke: COL.ac, width: 1.2, scale: "A", value: val("A") }],
  }, 5);

  C.pwm = new Chart($("#c-pwm"), {
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("t [ms]"), axisY("V", "y")],
    series: [{ label: "t" },
      { label: "Pole voltage", stroke: COL.ac, width: 1.4, fill: "rgba(255,216,0,.15)", paths: uPlot.paths.stepped({ align: 1 }) },
      { label: "Reference (SVPWM)", stroke: COL.line, width: 2 },
      { label: "Carrier", stroke: "#7a7a7a", width: 1 },
      { label: "Carrier (lower)", stroke: "#5c5c5c", width: 1 }],
  }, 5);

  C.mot = new Chart($("#c-mot"), {
    scales: { x: { time: false }, V: { auto: true }, A: { auto: true } },
    axes: [axisX("t [ms]"), axisY("V", "V"), axisY("A", "A", 1)],
    series: [{ label: "t" },
      { label: "Voltage", stroke: "rgba(61,133,255,.6)", width: 1, scale: "V", paths: uPlot.paths.stepped({ align: 1 }) },
      { label: "iU", stroke: COL.ia, width: 2, scale: "A" },
      { label: "iV", stroke: COL.ib, width: 2, scale: "A" },
      { label: "iW", stroke: COL.ic, width: 2, scale: "A" }],
  }, 5);

  C.spec = new Chart($("#c-spec"), {
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("f [Hz]"), axisY("V (peak)", "y")],
    series: [{ label: "f", value: val("Hz", 1) },
      { label: "|U–V|", stroke: COL.dc, fill: "rgba(61,133,255,.65)", width: 0, paths: uPlot.paths.bars({ size: [1, 3] }), points: { show: false }, value: val("V") }],
  }, 2);

  C.train = new Chart($("#c-train"), {
    scales: { x: { time: false }, v: { range: (u, a, b) => [0, Math.max(40, b * 1.1)] }, F: { auto: true }, P: { auto: true } },
    axes: [axisX("t [s]"), axisY("km/h", "v"), axisY("kN", "F", 1), axisY("MW", "P", 1, { size: 44 })],
    series: [{ label: "t", value: val("s", 1) },
      { label: "Speed", stroke: COL.ok, width: 2.5, scale: "v", value: val("km/h", 1) },
      { label: "Electric effort", stroke: COL.force, width: 1.5, scale: "F", value: val("kN", 1) },
      { label: "Mech. brake", stroke: COL.bad, width: 1.2, scale: "F", dash: [3, 3], value: val("kN", 1) },
      { label: "MC power", stroke: COL.ac, width: 1.5, scale: "P", dash: [5, 3], value: val("MW", 2) }],
  }, 5);

  C.zoom = new Chart($("#c-zoom"), {
    scales: { x: { time: false }, V: { auto: true }, A: { auto: true } },
    axes: [axisX("t [ms]"), axisY("V", "V"), axisY("A", "A", 1)],
    series: [{ label: "t" },
      { label: "Vdc", stroke: COL.dc, width: 1.8, scale: "V" },
      { label: "Supply voltage", stroke: COL.line, width: 1.2, scale: "V" },
      { label: "Supply current", stroke: COL.ia, width: 1.4, scale: "A" }],
  }, 4);
  return C;
}

// Rolling buffer for the histories
class History {
  constructor(n, window) { this.n = n; this.window = window; this.cols = Array.from({ length: n }, () => []); }
  push(row) {
    const t = row[0], x = this.cols[0];
    if (x.length && t < x[x.length - 1]) this.clear();
    row.forEach((v, i) => this.cols[i].push(v));
    while (x.length && x[0] < t - this.window) this.cols.forEach((c) => c.shift());
  }
  clear() { this.cols.forEach((c) => (c.length = 0)); }
}
