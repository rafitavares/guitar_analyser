// Gráficos com uPlot (rápido o bastante para atualizar a ~10 Hz)
const COL = {
  dc: "#22d3ee", line: "#f5a524", ac: "#a78bfa", ok: "#34d399", bad: "#f43f5e",
  grid: "#1a2540", axis: "#8b97ad", dim: "#56627a", ia: "#fb7185", ib: "#4ade80", ic: "#60a5fa", force: "#fb923c",
};

const axisX = (label) => ({ stroke: COL.axis, grid: { stroke: COL.grid, width: 1 }, ticks: { stroke: COL.grid }, label, labelSize: 18, size: 36 });
const axisY = (label, scale, side = 3, extra = {}) => ({
  scale, side, label, stroke: COL.axis, labelSize: 18, size: 56,
  grid: { show: side === 3, stroke: COL.grid, width: 1 }, ticks: { stroke: COL.grid }, ...extra,
});

class Chart {
  constructor(el, opts, nSeries) {
    this.el = el;
    const w = Math.max(300, el.clientWidth);
    this.u = new uPlot({
      width: w, height: opts.height || 230,
      cursor: { drag: { x: true, y: false } },
      legend: { live: true },
      ...opts,
    }, Array.from({ length: nSeries }, () => []), el);
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
    scales: { x: { time: false }, V: { range: (u, a, b) => [0, Math.max(3600, b * 1.05)] }, A: { auto: true } },
    axes: [axisX("t [s]"), axisY("V", "V"), axisY("A", "A", 1)],
    series: [{ label: "t", value: (u, v) => v == null ? "—" : v.toFixed(1) + " s" },
      { label: "Vdc", stroke: COL.dc, width: 2, scale: "V", fill: "rgba(34,211,238,.08)", value: (u, v) => v == null ? "—" : v.toFixed(0) + " V" },
      { label: "V fonte", stroke: COL.line, width: 1.5, dash: [6, 4], scale: "V", value: (u, v) => v == null ? "—" : v.toFixed(0) + " V" },
      { label: "Limiar pré-carga", stroke: COL.dim, width: 1, dash: [3, 4], scale: "V", value: (u, v) => v == null ? "—" : v.toFixed(0) + " V" },
      { label: "I DC", stroke: COL.ia, width: 1.5, scale: "A", value: (u, v) => v == null ? "—" : v.toFixed(0) + " A" }],
  }, 5);

  C.pwm = new Chart($("#c-pwm"), {
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("t [ms]"), axisY("V", "y")],
    series: [{ label: "t" },
      { label: "PWM", stroke: COL.ac, width: 1.5, fill: "rgba(167,139,250,.18)", paths: uPlot.paths.stepped({ align: 1 }) },
      { label: "Referência", stroke: COL.line, width: 2 },
      { label: "Portadora", stroke: "#64748b", width: 1 },
      { label: "−Portadora", stroke: "#475569", width: 1 }],
  }, 5);

  C.uab = new Chart($("#c-uab"), {
    scales: { x: { time: false }, V: { auto: true }, A: { auto: true } },
    axes: [axisX("t [ms]"), axisY("V", "V"), axisY("A", "A", 1)],
    series: [{ label: "t" },
      { label: "U–V", stroke: "rgba(34,211,238,.55)", width: 1, scale: "V", paths: uPlot.paths.stepped({ align: 1 }) },
      { label: "iU", stroke: COL.ia, width: 2, scale: "A" },
      { label: "iV", stroke: COL.ib, width: 2, scale: "A" },
      { label: "iW", stroke: COL.ic, width: 2, scale: "A" }],
  }, 5);

  C.spec = new Chart($("#c-spec"), {
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("f [Hz]"), axisY("V (pico)", "y")],
    series: [{ label: "f", value: (u, v) => v == null ? "—" : v.toFixed(1) + " Hz" },
      { label: "|U–V|", stroke: COL.dc, fill: "rgba(34,211,238,.6)", width: 0, paths: uPlot.paths.bars({ size: [1, 3] }), points: { show: false },
        value: (u, v) => v == null ? "—" : v.toFixed(0) + " V" }],
  }, 2);

  C.train = new Chart($("#c-train"), {
    scales: { x: { time: false }, v: { range: (u, a, b) => [0, Math.max(40, b * 1.1)] }, F: { auto: true }, P: { auto: true } },
    axes: [axisX("t [s]"), axisY("km/h", "v"), axisY("kN", "F", 1), axisY("MW", "P", 1, { size: 44 })],
    series: [{ label: "t", value: (u, v) => v == null ? "—" : v.toFixed(1) + " s" },
      { label: "Velocidade", stroke: COL.ok, width: 2.5, scale: "v", value: (u, v) => v == null ? "—" : v.toFixed(1) + " km/h" },
      { label: "Esforço elétrico", stroke: COL.force, width: 1.5, scale: "F", value: (u, v) => v == null ? "—" : v.toFixed(1) + " kN" },
      { label: "Potência DC", stroke: COL.ac, width: 1.5, scale: "P", dash: [5, 3], value: (u, v) => v == null ? "—" : v.toFixed(2) + " MW" }],
  }, 4);

  C.zoom = new Chart($("#c-zoom"), {
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("t [ms]"), axisY("V", "y")],
    series: [{ label: "t" }, { label: "Vdc", stroke: COL.dc, width: 1.8, fill: "rgba(34,211,238,.06)" }],
  }, 2);
  return C;
}

// Buffer circular simples para os históricos
class History {
  constructor(n, window) { this.n = n; this.window = window; this.cols = Array.from({ length: n }, () => []); }
  push(row) {
    const t = row[0], x = this.cols[0];
    if (x.length && t < x[x.length - 1]) this.clear(); // reset da simulação
    row.forEach((v, i) => this.cols[i].push(v));
    while (x.length && x[0] < t - this.window) this.cols.forEach((c) => c.shift());
  }
  clear() { this.cols.forEach((c) => (c.length = 0)); }
}
