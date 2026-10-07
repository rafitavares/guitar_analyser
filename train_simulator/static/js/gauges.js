// Mostradores circulares em SVG (arco de 240°)
class Gauge {
  constructor(svg, { min, max, label, unit, digits = 0, color = "#22d3ee", zones = [], bipolar = false, mark }) {
    Object.assign(this, { svg, min, max, label, unit, digits, color, bipolar });
    svg.setAttribute("viewBox", "0 0 200 150");
    this.cx = 100; this.cy = 92; this.r = 70;
    this.a0 = -210; this.a1 = 30;
    const track = svgEl("path", { d: this.arc(min, max), stroke: "#1d2940", "stroke-width": 12, fill: "none", "stroke-linecap": "round" }, svg);
    for (const z of zones) svgEl("path", { d: this.arc(z[0], z[1], this.r + 10), stroke: z[2], "stroke-width": 3, fill: "none", opacity: 0.9 }, svg);
    // marcações
    for (let i = 0; i <= 10; i++) {
      const v = min + (max - min) * i / 10, a = this.ang(v) * Math.PI / 180;
      const r1 = this.r - 12, r2 = this.r - (i % 5 === 0 ? 20 : 16);
      svgEl("line", { x1: this.cx + r1 * Math.cos(a), y1: this.cy + r1 * Math.sin(a), x2: this.cx + r2 * Math.cos(a), y2: this.cy + r2 * Math.sin(a), stroke: "#3a4966", "stroke-width": 1.5 }, svg);
      if (i % 5 === 0) {
        const t = svgEl("text", { x: this.cx + (this.r - 30) * Math.cos(a), y: this.cy + (this.r - 30) * Math.sin(a) + 3, "text-anchor": "middle", fill: "#56627a", "font-size": 9, "font-family": "ui-monospace,monospace" }, svg);
        t.textContent = Math.abs(v) >= 1000 ? (v / 1000) + "k" : v;
      }
    }
    if (mark !== undefined) {
      const a = this.ang(mark) * Math.PI / 180;
      svgEl("line", { x1: this.cx + (this.r + 8) * Math.cos(a), y1: this.cy + (this.r + 8) * Math.sin(a), x2: this.cx + (this.r - 8) * Math.cos(a), y2: this.cy + (this.r - 8) * Math.sin(a), stroke: "#e6ecf5", "stroke-width": 2 }, svg);
    }
    this.val = svgEl("path", { stroke: color, "stroke-width": 12, fill: "none", "stroke-linecap": "round" }, svg);
    this.glow = svgEl("circle", { r: 5, fill: "#fff" }, svg);
    this.txt = svgEl("text", { x: 100, y: 98, "text-anchor": "middle", fill: "#e6ecf5", "font-size": 26, "font-weight": 700, "font-family": "ui-monospace,monospace" }, svg);
    const u = svgEl("text", { x: 100, y: 116, "text-anchor": "middle", fill: "#8b97ad", "font-size": 11 }, svg); u.textContent = unit;
    const l = svgEl("text", { x: 100, y: 143, "text-anchor": "middle", fill: "#cfd8e6", "font-size": 12, "font-weight": 600 }, svg); l.textContent = label;
    this.shown = bipolar ? 0 : min;
    this.set(this.shown);
  }
  ang(v) { return this.a0 + (this.a1 - this.a0) * (clamp(v, this.min, this.max) - this.min) / (this.max - this.min); }
  arc(v0, v1, r = this.r) {
    const p = (v) => { const a = this.ang(v) * Math.PI / 180; return [this.cx + r * Math.cos(a), this.cy + r * Math.sin(a)]; };
    const [x0, y0] = p(v0), [x1, y1] = p(v1);
    const large = Math.abs(this.ang(v1) - this.ang(v0)) > 180 ? 1 : 0;
    const sweep = this.ang(v1) > this.ang(v0) ? 1 : 0;
    return `M${x0},${y0} A${r},${r} 0 ${large} ${sweep} ${x1},${y1}`;
  }
  set(v, color) {
    this.shown += (v - this.shown) * 0.35; // suavização visual
    const from = this.bipolar ? 0 : this.min;
    const s = this.shown;
    this.val.setAttribute("d", Math.abs(s - from) < 1e-9 ? "" : (s >= from ? this.arc(from, s) : this.arc(s, from)));
    if (color) this.val.setAttribute("stroke", color);
    const a = this.ang(s) * Math.PI / 180;
    this.glow.setAttribute("cx", this.cx + this.r * Math.cos(a));
    this.glow.setAttribute("cy", this.cy + this.r * Math.sin(a));
    this.txt.textContent = fmt(v, this.digits);
  }
}
