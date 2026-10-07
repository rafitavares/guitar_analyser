// Animated side view: train, catenary, pantograph and parallax landscape
class TrainScene {
  constructor(svg) {
    this.svg = svg;
    this.PX = 10; // pixels per meter (track layer)
    const d = svgEl("defs", {}, svg);
    d.innerHTML = `
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#070b16"/><stop offset=".65" stop-color="#132341"/><stop offset="1" stop-color="#2a3557"/>
      </linearGradient>
      <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e9eef6"/><stop offset=".55" stop-color="#c3ccda"/><stop offset="1" stop-color="#8a95a8"/>
      </linearGradient>
      <radialGradient id="beam" cx="0" cy=".5" r="1">
        <stop offset="0" stop-color="#fff7d6" stop-opacity=".55"/><stop offset="1" stop-color="#fff7d6" stop-opacity="0"/>
      </radialGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    svgEl("rect", { width: 1200, height: 190, fill: "url(#sky)" }, svg);
    // stars
    const stars = svgEl("g", { opacity: 0.7 }, svg);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) svgEl("circle", { cx: rnd() * 1200, cy: rnd() * 90, r: rnd() * 1.1 + 0.2, fill: "#cfe1ff" }, stars);
    svgEl("circle", { cx: 1060, cy: 40, r: 14, fill: "#f4f1de", opacity: 0.85, filter: "url(#glow)" }, svg);
    // mountains (slow parallax)
    this.far = this.layer(svg, (x) => `M${x},150 L${x + 80},110 L${x + 170},135 L${x + 260},95 L${x + 380},140 L${x + 470},105 L${x + 600},150 L${x + 700},118 L${x + 830},140 L${x + 950},100 L${x + 1080},138 L${x + 1200},150 Z`, "#1a2744");
    this.near = this.layer(svg, (x) => {
      let p = `M${x},165 `;
      for (let i = 0; i <= 24; i++) p += `Q${x + i * 50 + 25},${150 - (i * 37 % 13)} ${x + (i + 1) * 50},${160 - (i * 53 % 9)} `;
      return p + `L${x + 1200},170 L${x},170 Z`;
    }, "#121c33");
    // catenary masts + wire
    this.masts = svgEl("g", {}, svg);
    for (let i = 0; i < 10; i++) {
      const x = i * 150;
      svgEl("rect", { x: x, y: 6, width: 5, height: 160, fill: "#3b4762" }, this.masts);
      svgEl("rect", { x: x - 2, y: 8, width: 70, height: 3, fill: "#3b4762" }, this.masts);
      for (let k = 1; k < 5; k++) svgEl("line", { x1: x + k * 30, y1: 12, x2: x + k * 30, y2: 26, stroke: "#4a5878", "stroke-width": 1 }, this.masts);
    }
    svgEl("line", { x1: 0, y1: 12, x2: 1200, y2: 12, stroke: "#4a5878", "stroke-width": 1.2 }, svg);
    this.wire = svgEl("line", { x1: 0, y1: 26, x2: 1200, y2: 26, stroke: "#b08a3e", "stroke-width": 2 }, svg);
    // track
    svgEl("rect", { x: 0, y: 168, width: 1200, height: 22, fill: "#1b2233" }, svg);
    this.sleepers = svgEl("g", {}, svg);
    for (let i = 0; i < 52; i++) svgEl("rect", { x: i * 24, y: 166, width: 12, height: 6, fill: "#3a3226" }, this.sleepers);
    svgEl("rect", { x: 0, y: 163, width: 1200, height: 3, fill: "#9aa6ba" }, svg);

    // headlight beam (behind the train)
    this.beam = svgEl("path", { d: "M902,128 L1200,96 L1200,165 Z", fill: "url(#beam)", opacity: 0 }, svg);
    // train
    const tr = svgEl("g", {}, svg);
    svgEl("path", { d: "M300,82 Q300,76 306,76 L840,76 Q872,76 892,100 L906,124 Q910,146 896,148 L306,148 Q300,148 300,142 Z", fill: "url(#body)", stroke: "#5b6780", "stroke-width": 1.5 }, tr);
    svgEl("path", { d: "M852,84 Q874,86 888,104 L896,118 L856,118 Z", fill: "#0d1526", stroke: "#5b6780" }, tr); // windshield
    svgEl("rect", { x: 300, y: 126, width: 600, height: 6, fill: "#0891b2" }, tr);
    svgEl("rect", { x: 300, y: 134, width: 604, height: 2, fill: "#f43f5e" }, tr);
    this.windows = [];
    for (let x = 330; x < 830; x += 46) {
      if (x > 520 && x < 560) { svgEl("rect", { x: x + 4, y: 88, width: 22, height: 54, rx: 2, fill: "#9aa6ba", stroke: "#5b6780" }, tr); continue; }
      this.windows.push(svgEl("rect", { x, y: 90, width: 34, height: 22, rx: 3, fill: "#1b2438" }, tr));
    }
    svgEl("rect", { x: 520, y: 70, width: 130, height: 7, rx: 2, fill: "#6b778f" }, tr); // roof equipment
    this.headlight = svgEl("circle", { cx: 899, cy: 130, r: 3.5, fill: "#3a4256" }, tr);
    this.tail = svgEl("circle", { cx: 303, cy: 130, r: 3, fill: "#3a1a22" }, tr);
    this.wheels = [];
    for (const bx of [370, 430, 770, 830]) {
      const g = svgEl("g", { transform: `translate(${bx},156)` }, tr);
      svgEl("circle", { r: 11, fill: "#20283a", stroke: "#8a95a8", "stroke-width": 2 }, g);
      const sp = svgEl("g", {}, g);
      svgEl("line", { x1: -9, y1: 0, x2: 9, y2: 0, stroke: "#8a95a8", "stroke-width": 2 }, sp);
      svgEl("line", { x1: 0, y1: -9, x2: 0, y2: 9, stroke: "#8a95a8", "stroke-width": 2 }, sp);
      this.wheels.push(sp);
    }
    for (const bx of [400, 800]) svgEl("rect", { x: bx - 46, y: 146, width: 92, height: 8, rx: 3, fill: "#2b3448" }, tr);
    // pantograph
    this.panto = svgEl("g", {}, svg);
    this.pArm = svgEl("path", { fill: "none", stroke: "#cfd8e6", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }, this.panto);
    this.pHead = svgEl("path", { fill: "none", stroke: "#e6ecf5", "stroke-width": 3.5, "stroke-linecap": "round" }, this.panto);
    svgEl("rect", { x: 562, y: 72, width: 46, height: 5, rx: 2, fill: "#3b4762" }, this.panto);
    this.spark = svgEl("g", { filter: "url(#glow)", opacity: 0 }, svg);
    for (let i = 0; i < 6; i++) svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 0, stroke: "#bfe9ff", "stroke-width": 1.6 }, this.spark);
    this.setPanto(0);
  }

  layer(svg, pathFn, fill) {
    const g = svgEl("g", {}, svg);
    svgEl("path", { d: pathFn(0), fill }, g);
    svgEl("path", { d: pathFn(1200), fill }, g);
    return g;
  }

  setPanto(p) {
    // p = 0 (lowered) .. 1 (touching the contact wire, y = 26)
    const base = 72, yh = 64 - 36 * p;
    const knee = [622 - 10 * p, (base + yh) / 2 + 4];
    this.pArm.setAttribute("d", `M572,${base} L${knee[0]},${knee[1]} L585,${yh + 2}`);
    this.pHead.setAttribute("d", `M556,${yh - 3} Q560,${yh} 566,${yh} L604,${yh} Q610,${yh} 614,${yh - 3}`);
    this.headY = yh;
  }

  update(s, pos) {
    const W = 1200;
    const mod = (a, b) => ((a % b) + b) % b;
    this.far.setAttribute("transform", `translate(${-mod(pos * 0.6, W)},0)`);
    this.near.setAttribute("transform", `translate(${-mod(pos * 2.2, W)},0)`);
    this.masts.setAttribute("transform", `translate(${-mod(pos * this.PX, 150)},0)`);
    this.sleepers.setAttribute("transform", `translate(${-mod(pos * this.PX, 24)},0)`);
    const ang = (pos / 0.46) * 180 / Math.PI;
    for (const w of this.wheels) w.setAttribute("transform", `rotate(${ang % 360})`);
    this.setPanto(s.panto_pos);

    const vnom = s.cfg.vnom;
    const aux = s.vdc > 0.5 * vnom;
    for (const w of this.windows) w.setAttribute("fill", aux ? "#f6dd9a" : "#1b2438");
    this.headlight.setAttribute("fill", aux ? "#fffbe6" : "#3a4256");
    this.tail.setAttribute("fill", aux ? "#ff3b5c" : "#3a1a22");
    this.beam.setAttribute("opacity", aux ? 0.9 : 0);
    const live = s.panto_pos >= 1;
    this.wire.setAttribute("stroke", live && s.mcb ? "#f5a524" : "#b08a3e");

    // sparks at the contact: arc when lowered under load, or flicker proportional to current
    const iRatio = Math.abs(s.i_src) / 600;
    const flick = s.spark > 0 ? s.spark : (live && Math.random() < iRatio * 0.25 ? 0.7 : 0);
    this.spark.setAttribute("opacity", flick);
    if (flick > 0) {
      const lines = this.spark.children;
      for (const l of lines) {
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 9;
        l.setAttribute("x1", 585); l.setAttribute("y1", this.headY);
        l.setAttribute("x2", 585 + r * Math.cos(a)); l.setAttribute("y2", this.headY + r * Math.sin(a));
      }
    }
  }
}
