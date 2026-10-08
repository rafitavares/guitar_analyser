// Animated single-line diagram, assembled from the modules present in each system.
// Rebuilt when the configuration changes. Author: Rafael Tavares
class Schematic {
  constructor(svg, onToggle) {
    this.svg = svg;
    this.onToggle = onToggle;
    this.key = "";
    this.rotor = 0;
    this.fan = 0;
  }

  build(D) {
    if (D.key === this.key) return;
    this.key = D.key;
    const svg = this.svg;
    svg.innerHTML = "";
    this.w = {}; this.sw = {}; this.t = {}; this.box = {};
    const YP = 170, YN = 340, BY0 = 205, BY1 = 305;
    const g = svgEl("g", {}, svg);
    const defs = svgEl("defs", {}, svg);
    defs.innerHTML = `<linearGradient id="capgrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1F5FD6"/><stop offset="1" stop-color="#8AB4FF"/></linearGradient>
      <linearGradient id="batgrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#0CA919"/><stop offset="1" stop-color="#6BE07A"/></linearGradient>`;
    const text = (x, y, s, cls = "", anchor = "middle", parent = g) => { const e = svgEl("text", { x, y, class: cls, "text-anchor": anchor }, parent); e.textContent = s; return e; };
    const wire = (id, d) => {
      const base = svgEl("path", { d, class: "wire" }, g);
      const flow = svgEl("path", { d, class: "flow" }, g);
      (this.w[id] ||= []).push({ base, flow });
    };
    const clickable = (id, el) => { el.classList.add("clickable"); el.dataset.id = id; el.addEventListener("click", () => this.onToggle(id)); return el; };
    const sw = (id, x, y, label, sub, below) => {
      const grp = clickable(id, svgEl("g", { class: "sw" }, g));
      svgEl("rect", { x: x - 12, y: y - 34, width: 80, height: 52, rx: 8, class: "hit" }, grp);
      svgEl("circle", { cx: x, cy: y, r: 4, class: "term" }, grp);
      svgEl("circle", { cx: x + 56, cy: y, r: 4, class: "term" }, grp);
      const lev = svgEl("line", { x1: x, y1: y, x2: x + 54, y2: y, class: "lever" }, grp);
      lev.style.transformOrigin = `${x}px ${y}px`;
      text(x + 28, below ? y + 24 : y - 22, label, "ttl", "middle", grp);
      if (sub) text(x + 28, y + (below ? 38 : 24), sub, "small", "middle", grp);
      this.sw[id] = { grp, lev };
    };
    // converter box: diagonal + symbols (sa top-left, sb bottom-right)
    const conv = (id, x, y, w, h, title, sa, sb, toggleId) => {
      const grp = svgEl("g", {}, g);
      if (toggleId) clickable(toggleId, grp);
      const r = svgEl("rect", { x, y, width: w, height: h, rx: 6, class: "box" }, grp);
      svgEl("line", { x1: x, y1: y + h, x2: x + w, y2: y, class: "sym", "stroke-width": 1.2 }, grp);
      text(x + 14, y + 22, sa, "symt", "middle", grp);
      text(x + w - 14, y + h - 10, sb, "symt", "middle", grp);
      text(x + w / 2, y - 8, title, "ttl", "middle", grp);
      this.box[id] = r;
      return grp;
    };
    const ground = (x, y) => svgEl("path", { d: `M${x - 14},${y} L${x + 14},${y} M${x - 9},${y + 6} L${x + 9},${y + 6} M${x - 4},${y + 12} L${x + 4},${y + 12}`, class: "sym" }, g);
    const coil = (x, y, n = 4, r = 9) => { let d = `M${x},${y} `; for (let i = 0; i < n; i++) d += `a${r},${r} 0 0 1 ${2 * r},0 `; return d; };
    const vcoil = (x, y, n = 3, r = 7) => { let d = `M${x},${y} `; for (let i = 0; i < n; i++) d += `a${r},${r} 0 0 1 0,${2 * r} `; return d; };
    const resistor = (x, y) => `M${x},${y} l3,-7 l6,14 l6,-14 l6,14 l6,-14 l6,14 l3,-7`; // 36 px long

    // ------------------------------------------------------------ source chain
    let busX0 = 470, negX0 = 470;
    const src = D.src;
    if (src === "dcline" || src === "acline") {
      const shoe = D.sysCollector === "shoe";
      if (shoe) {
        svgEl("rect", { x: 14, y: 58, width: 150, height: 9, rx: 2, fill: "#5a5a5a", stroke: "#8a8a8a" }, g);
        text(14, 50, `Third rail ${D.supply.label}`, "ttl", "start");
        const pg = clickable("col", svgEl("g", {}, g));
        svgEl("rect", { x: 40, y: 64, width: 70, height: 60, rx: 8, class: "hit" }, pg);
        this.shoe = svgEl("rect", { x: 60, y: 67, width: 30, height: 7, rx: 2, fill: "#dedede" }, pg);
        this.shoeStem = svgEl("line", { x1: 75, y1: 74, x2: 75, y2: 110, class: "sym" }, pg);
        text(118, 86, "Collector shoe", "ttl", "start");
        this.t.col = text(118, 101, "", "small", "start");
        wire("col", `M75,110 L75,${YP} L110,${YP}`);
        wire("cat", "M14,62 L164,62");
      } else {
        wire("cat", "M14,36 L290,36");
        text(290, 26, `Catenary ${D.supply.label}`, "ttl", "end");
        const pg = clickable("col", svgEl("g", {}, g));
        svgEl("rect", { x: 34, y: 34, width: 76, height: 86, rx: 8, class: "hit" }, pg);
        this.pantoArm = svgEl("path", { class: "sym", "stroke-width": 3 }, pg);
        this.pantoHead = svgEl("path", { class: "sym", "stroke-width": 3.5 }, pg);
        svgEl("line", { x1: 52, y1: 114, x2: 92, y2: 114, class: "sym", "stroke-width": 4 }, pg);
        text(118, 98, "Pantograph", "ttl", "start");
        this.t.col = text(118, 113, "", "small", "start");
        wire("col", `M72,116 L72,${YP} L110,${YP}`);
      }
      this.t.vline = text(14, shoe ? 34 : 26, "", "val", "start");
      sw("brk", 110, YP, D.brkName, src === "dcline" ? "high-speed breaker" : "vacuum breaker");
      this.t.iline = text(138, YP + 48, "", "val");
      let x = 166;
      if (src === "dcline") {
        wire("filt", `M166,${YP} L186,${YP} ${coil(186, YP)} L262,${YP}`);
        text(222, YP - 22, "Line filter L", "ttl");
        text(222, YP + 24, `${(D.L * 1e3).toFixed(1)} mH · HF`, "small");
        x = 262;
        if (!shoe) { wire("ret", `M72,${YN} L470,${YN}`); ground(72, YN); text(72, YN + 32, "rail return"); }
        else { wire("ret", `M75,${YN} L470,${YN}`); ground(75, YN); text(75, YN + 32, "running rails"); }
      } else {
        wire("pri", `M166,${YP} L186,${YP}`);
        svgEl("circle", { cx: 206, cy: YP, r: 20, class: "sym" }, g);
        svgEl("circle", { cx: 232, cy: YP, r: 20, class: "sym" }, g);
        text(219, YP - 30, "Transformer", "ttl");
        text(219, YP + 36, `${(D.supply.Un / 1e3).toFixed(0)} kV / ${D.V2} V`, "small");
        wire("pri_ret", `M206,${YP + 20} L206,${YN + 40}`); ground(206, YN + 40);
        wire("sec", `M252,${YP} L262,${YP}`);
        wire("sec2", `M232,${YP + 20} L232,${YN - 50} L380,${YN - 50}`);
        x = 262;
      }
      // pre-charge branch and line contactor
      wire("node", `M${x},${YP} L290,${YP}`);
      sw("ctl", 290, YP, "CtL", "line contactor");
      wire("ctl", `M346,${YP} L380,${YP}`);
      wire("pre1", `M${x + 8},${YP} L${x + 8},250 L280,250`);
      sw("chct", 280, 250, "ChCt", "", true);
      wire("pre2", `M336,250 L340,250 ${resistor(340, 250)} L380,250 L380,${YP}`);
      text(358, 280, "Rpre", "small");
      this.t.rpre = text(358, 294, "", "val");
      if (src === "acline") {
        wire("ac_in", `M380,${YP} L400,${YP}`);
        conv("lc", 400, YP - 10, 70, 190, "Line converter (4QC)", "~", "=", "lc");
        busX0 = 470; negX0 = 470;
        wire("sec3", `M380,${YN - 50} L400,${YN - 50}`);
      } else {
        wire("ac_in", `M380,${YP} L470,${YP}`);
      }
    } else if (src === "genset") {
      const eg = clickable("eng", svgEl("g", {}, g));
      this.box.eng = svgEl("rect", { x: 14, y: 200, width: 110, height: 80, rx: 8, class: "box" }, eg);
      text(69, 232, "Diesel engine", "ttl", "middle", eg);
      this.t.eng = text(69, 252, "", "val", "middle", eg);
      text(69, 268, `${(D.Peng / 1e3).toFixed(0)} kW`, "small", "middle", eg);
      svgEl("line", { x1: 124, y1: 240, x2: 150, y2: 240, class: "sym", "stroke-width": 4 }, g);
      svgEl("circle", { cx: 180, cy: 240, r: 28, class: "box" }, g);
      text(180, 238, "G", "ttl"); text(180, 254, "3~", "small");
      text(180, 196, "Generator", "ttl");
      this.t.gen = text(180, 290, "", "val");
      wire("gen", `M208,240 L250,240`);
      sw("brk", 250, 240, "Gen. contactor", "", true);
      wire("gen2", `M306,240 L400,240`);
      conv("lc", 400, YP - 10, 70, 190, "Line converter", "~", "=", "lc");
    } else {
      // battery (main ESS) feeding the DC link through the ESC
      this.batFill = this.battery(g, 26, 200, "bat");
      text(70, 190, D.bat.chem + " battery", "ttl");
      text(14, 318, `${(D.bat.E / 1e3).toFixed(0)} kWh · ${D.bat.Vn} V`, "small", "start");
      this.t.bat = text(14, 334, "", "val", "start");
      wire("bat", `M70,200 L70,${YP} L170,${YP}`);
      sw("brk", 170, YP, "Battery contactor", "", false);
      wire("bat2", `M226,${YP} L400,${YP}`);
      wire("pre1", `M150,${YP} L150,250 L170,250`);
      sw("chct", 170, 250, "Pre-charge", "", true);
      wire("pre2", `M226,250 L230,250 ${resistor(230, 250)} L270,250 L270,${YP}`);
      wire("bat_ret", `M70,290 L70,${YN} L400,${YN}`);
      conv("esc", 400, YP - 10, 70, 190, "ESC", "=", "=", "esc");
    }

    // --------------------------------------------------------------- DC bus
    const mods = [];
    if (D.f2) mods.push("hf");
    mods.push("dcl");
    if (D.vlu) mods.push("vlu");
    if (D.essAddon) mods.push("esc");
    if (D.fc_mod) mods.push("fcc");
    mods.push("hbu", "hwr");
    if (D.traction) mods.push("mc");
    const slot = 128, x0 = 488;
    const xs = {};
    mods.forEach((m, i) => (xs[m] = x0 + i * slot));
    const busEnd = xs[mods[mods.length - 1]] + 70;
    wire("busp", `M${busX0},${YP} L${busEnd},${YP}`);
    wire("busn", `M${negX0},${YN} L${busEnd},${YN}`);
    const leg = (id, x) => wire(id, `M${x},${YP} L${x},${BY0} M${x},${BY1} L${x},${YN}`);

    for (const m of mods) {
      const x = xs[m], cx = x + 35;
      if (m === "hf") {
        wire("hf", `M${cx},${YP} L${cx},${BY0} ${vcoil(cx, BY0)} L${cx},262 M${cx},274 L${cx},${YN}`);
        svgEl("line", { x1: cx - 16, y1: 262, x2: cx + 16, y2: 262, class: "sym", "stroke-width": 3 }, g);
        svgEl("line", { x1: cx - 16, y1: 274, x2: cx + 16, y2: 274, class: "sym", "stroke-width": 3 }, g);
        text(cx, BY0 - 8, "Harmonic filter", "ttl");
        text(cx, YN + 20, `2f · ${D.f2.toFixed(1)} Hz`, "small");
        this.t.hf = text(cx, YN + 36, "", "val");
      } else if (m === "dcl") {
        if (D.levels === 3) {
          wire("cap", `M${cx},${YP} L${cx},220 M${cx},230 L${cx},280 M${cx},290 L${cx},${YN}`);
          for (const y of [220, 230, 280, 290]) svgEl("line", { x1: cx - 18, y1: y, x2: cx + 18, y2: y, class: "sym", "stroke-width": 3 }, g);
          svgEl("circle", { cx, cy: 255, r: 3, fill: "#dedede" }, g);
          text(cx - 22, 259, "NP", "small", "end");
        } else {
          wire("cap", `M${cx},${YP} L${cx},248 M${cx},262 L${cx},${YN}`);
          for (const y of [248, 262]) svgEl("line", { x1: cx - 20, y1: y, x2: cx + 20, y2: y, class: "sym", "stroke-width": 3 }, g);
        }
        svgEl("rect", { x: cx + 26, y: 210, width: 10, height: 92, rx: 3, fill: "#1a1a1a", stroke: "#444" }, g);
        this.capFill = svgEl("rect", { x: cx + 26, y: 302, width: 10, height: 0, rx: 3, fill: "url(#capgrad)", class: "capfill" }, g);
        text(cx, BY0 - 8, "DC link", "ttl");
        text(cx, YN + 20, `${(D.C * 1e3).toFixed(1)} mF`, "small");
      } else if (m === "vlu") {
        leg("vlu", cx);
        const grp = svgEl("g", {}, g);
        this.box.vlu = svgEl("rect", { x, y: BY0, width: 70, height: BY1 - BY0, rx: 6, class: "box" }, grp);
        svgEl("path", { d: `M${cx},${BY0 + 12} l-8,5 l16,10 l-16,10 l16,10 l-16,10 l16,10 l-8,5`, class: "sym" }, grp);
        text(cx, BY1 - 12, "chopper", "small", "middle", grp);
        text(cx, BY0 - 8, "VLU", "ttl");
        text(cx, YN + 20, `${(D.Pvlu / 1e6).toFixed(2)} MW`, "small");
        this.t.vlu = text(cx, YN + 36, "", "val");
      } else {
        const meta = {
          esc: ["ESC", "=", "=", "esc"], fcc: ["FC converter", "=", "=", "fc"], hbu: ["HBU", "=", "~", "hbu"], hwr: ["HWR", "=", "~", "hwr"], mc: ["Motor converter", "=", "~", "mc"],
        }[m];
        leg(m, cx);
        conv(m, x, BY0, 70, BY1 - BY0, meta[0], meta[1], meta[2], meta[3]);
        if (m === "mc") text(cx, BY1 + 18, D.levels === 3 ? "3L NPC" : "2L", "small");
      }
    }

    // ------------------------------------------------------------- outputs
    const yOut = 420;
    if (xs.esc) {
      const cx = xs.esc + 35;
      wire("esc_out", `M${cx},${BY1} L${cx},${yOut - 58}`);
      this.batFill = this.battery(g, cx - 22, yOut - 52, "bat");
      text(cx, yOut + 52, `${D.bat.chem} ${(D.bat.E / 1e3).toFixed(0)} kWh`, "small");
      this.t.bat = text(cx, yOut + 68, "", "val");
    }
    if (xs.fcc) {
      const cx = xs.fcc + 35;
      wire("fc_out", `M${cx},${BY1} L${cx},${yOut - 50}`);
      const fg = clickable("fc", svgEl("g", {}, g));
      this.box.fcs = svgEl("rect", { x: cx - 33, y: yOut - 50, width: 66, height: 60, rx: 6, class: "box" }, fg);
      for (let i = 0; i < 6; i++) svgEl("line", { x1: cx - 25 + i * 10, y1: yOut - 44, x2: cx - 25 + i * 10, y2: yOut + 4, class: "sym", "stroke-width": 1 }, fg);
      text(cx, yOut + 26, "PEM fuel cell", "small");
      this.t.fc = text(cx, yOut + 42, "", "val");
    }
    if (xs.hbu) {
      const cx = xs.hbu + 35;
      wire("hbu_out", `M${cx + 20},${BY1} L${cx + 20},${yOut - 40} ${coil(cx + 20, yOut - 40, 2, 6)} L${cx + 60},${yOut - 40}`);
      text(cx + 42, yOut - 54, "sine filter", "small");
      wire("tb", `M${cx + 60},${yOut - 40} L${cx + 60},${yOut + 4} M${cx - 40},${yOut + 4} L${cx + 100},${yOut + 4}`);
      text(cx + 30, yOut + 22, "3AC 400 V 50 Hz train bus", "small");
      this.t.hbu = text(cx + 30, yOut + 38, "", "val");
      this.t.hbuLoads = text(cx + 30, yOut + 54, "", "small");
    }
    if (xs.hwr) {
      const cx = xs.hwr + 35;
      wire("hwr_out", `M${cx + 20},${BY1} L${cx + 20},${yOut - 30} L${cx + 40},${yOut - 30}`);
      svgEl("circle", { cx: cx + 62, cy: yOut - 30, r: 20, class: "box" }, g);
      this.fanG = svgEl("g", { transform: `translate(${cx + 62},${yOut - 30})` }, g);
      for (let k = 0; k < 3; k++) svgEl("path", { d: "M0,0 C6,-6 6,-14 0,-16 C-4,-12 -4,-6 0,0", fill: "#9a9a9a", transform: `rotate(${k * 120})` }, this.fanG);
      text(cx + 62, yOut + 8, "cooling fans", "small");
      this.t.hwr = text(cx + 62, yOut + 24, "", "val");
    }
    if (xs.mc) {
      const x = xs.mc + 70, nm = D.motor.nm;
      const cols = nm > 2 ? 2 : 1, rows = Math.ceil(nm / cols);
      const ys = [], mxs = [];
      for (let i = 0; i < nm; i++) { mxs.push(x + 60 + (i % cols) * 64); ys.push(220 + Math.floor(i / cols) * 70 - (rows - 1) * 0); }
      wire("mot", `M${x},235 L${x + 20},235 M${x},255 L${x + 20},255 M${x},275 L${x + 20},275 M${x + 20},235 L${x + 20},${ys[ys.length - 1]} `);
      this.rotors = [];
      for (let i = 0; i < nm; i++) {
        wire("mot", `M${x + 20},${ys[i]} L${mxs[i] - 24},${ys[i]}`);
        svgEl("circle", { cx: mxs[i], cy: ys[i], r: 24, class: "box" }, g);
        const rg = svgEl("g", { transform: `translate(${mxs[i]},${ys[i]})` }, g);
        for (let k = 0; k < 3; k++) svgEl("line", { x1: 0, y1: 0, x2: 0, y2: -18, class: "rotor", transform: `rotate(${k * 120})`, opacity: 0.35 }, rg);
        text(mxs[i], ys[i] + 5, "M", "ttl");
        this.rotors.push(rg);
      }
      text(x + 60 + (cols - 1) * 32, 188, `${nm} × traction motor`, "ttl");
      this.t.mot = text(x + 60 + (cols - 1) * 32, ys[ys.length - 1] + 44, "", "val");
      this.t.mot2 = text(x + 60 + (cols - 1) * 32, ys[ys.length - 1] + 60, "", "val");
      this.t.mc = text(xs.mc + 35, YN + 36, "", "val");
    }
    this.t.vdc = text(xs.dcl + 35, YN + 38, "", "val big");
    // fit the view box to the drawing so it uses the full card width
    const bb = g.getBBox();
    svg.setAttribute("viewBox", `${bb.x - 10} ${bb.y - 10} ${bb.width + 150} ${bb.height + 40}`);
  }

  battery(g, x, y, id) {
    const grp = svgEl("g", {}, g);
    svgEl("rect", { x, y, width: 44, height: 90, rx: 5, class: "box" }, grp);
    svgEl("rect", { x: x + 14, y: y - 6, width: 16, height: 6, rx: 2, fill: "#666" }, grp);
    const fill = svgEl("rect", { x: x + 5, y: y + 85, width: 34, height: 0, rx: 3, fill: "url(#batgrad)", class: "capfill" }, grp);
    fill._y = y + 5; fill._h = 80;
    return fill;
  }

  setWire(id, cls, flow = 0, rev = false) {
    for (const { base, flow: f } of this.w[id] || []) {
      base.setAttribute("class", "wire " + (cls || ""));
      f.classList.toggle("on", flow > 0);
      f.classList.toggle("rev", rev);
      if (flow > 0) f.style.animationDuration = clamp(1.6 - Math.log10(1 + flow) / 2.4, 0.25, 1.6) + "s";
    }
  }

  setSwitch(id, closed) {
    const s = this.sw[id];
    if (!s) return;
    s.grp.classList.toggle("closed", closed);
    s.lev.style.transform = closed ? "rotate(0deg)" : "rotate(-28deg)";
  }

  setBox(id, cls) { if (this.box[id]) this.box[id].setAttribute("class", "box" + (cls ? " " + cls : "")); }

  update(s, dt) {
    const D = s.D, c = s.cfg;
    this.build(D);
    this.svg.classList.toggle("manual", s.mode === "manual");
    const col = D.sysCollector ? s.col_pos >= 1 : true;
    const live = col && s.brk;
    const iL = Math.abs(s.i_line), dc = s.vdc > 50 ? "dc" : "";
    const P = (w) => Math.abs(w) / 1e3; // kW -> flow speed

    if (this.pantoArm) {
      const yh = 80 - 42 * s.col_pos;
      this.pantoArm.setAttribute("d", `M58,114 L92,${(114 + yh) / 2} L68,${yh + 2}`);
      this.pantoHead.setAttribute("d", `M50,${yh} L94,${yh}`);
    }
    if (this.shoe) { this.shoe.setAttribute("y", 81 - 14 * s.col_pos); this.shoeStem.setAttribute("y1", 88 - 14 * s.col_pos); }
    if (this.t.col) this.t.col.textContent = s.col_pos >= 1 ? "in contact" : s.col_cmd ? "moving…" : s.col_pos > 0 ? "moving…" : "lowered";

    this.setWire("cat", "line");
    this.setWire("col", col ? "line" : "", live ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("filt", live ? "line" : "", live ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("pri", live ? "line" : "", live ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("pri_ret", live ? "line" : "");
    this.setWire("sec", live ? "line" : "", live ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("sec2", live ? "line" : ""); this.setWire("sec3", live ? "line" : "");
    this.setWire("node", live ? "line" : "", live && s.ctl ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("ctl", live && s.ctl ? "line" : "", live && s.ctl ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("pre1", live ? "line" : "", live && s.chct && !s.ctl ? P(s.p_src) : 0);
    this.setWire("pre2", live && s.chct ? "line" : "", live && s.chct && !s.ctl ? P(s.p_src) : 0);
    this.setWire("ac_in", live && (s.ctl || s.chct) ? "line" : "", live && (s.ctl || s.chct) ? P(s.p_src) : 0, s.p_src < 0);
    this.setWire("ret", s.vdc > 50 ? "dc" : "");
    // genset
    const genOn = s.n_eng > 50 && s.exc > 0;
    this.setWire("gen", genOn ? "ac" : "", genOn && s.brk ? P(s.p_src) : 0);
    this.setWire("gen2", genOn && s.brk ? "ac" : "", genOn && s.brk ? P(s.p_src) : 0);
    // battery source
    const batLive = !!D.bat;
    this.setWire("bat", batLive ? "ess" : "", s.brk ? P(s.p_esc) : 0, s.p_esc < 0);
    this.setWire("bat2", s.brk ? "ess" : "", s.brk ? P(s.p_esc) : 0, s.p_esc < 0);
    this.setWire("bat_ret", batLive ? "ess" : "");
    // bus and modules
    const busFlow = Math.max(P(s.p_mc), P(s.p_src), P(s.p_esc));
    this.setWire("busp", dc, busFlow, s.p_mc < 0);
    this.setWire("busn", dc);
    this.setWire("cap", dc); this.setWire("hf", dc, D.f2 ? Math.abs(s.i2f) : 0);
    this.setWire("vlu", s.p_vlu > 0 ? "dc" : dc, P(s.p_vlu));
    this.setWire("esc", dc, s.esc ? P(s.p_esc) : 0, s.p_esc > 0);
    this.setWire("esc_out", s.esc ? "ess" : "", s.esc ? P(s.p_esc) : 0, s.p_esc > 0);
    this.setWire("fcc", dc, P(s.p_fc_dc), true);
    this.setWire("fc_out", s.fc === "run" ? "ess" : "", P(s.p_fc_dc));
    this.setWire("hbu", dc, s.hbu ? P(s.p_hbu) : 0);
    this.setWire("hbu_out", s.hbu_out ? "ac" : "", s.hbu_out ? P(s.p_hbu_out) : 0);
    this.setWire("tb", s.hbu_out ? "ac" : "", s.hbu_out ? P(s.p_hbu_out) : 0);
    this.setWire("hwr", dc, s.hwr ? P(s.p_hwr) : 0);
    this.setWire("hwr_out", s.hwr && s.f_hwr > 1 ? "ac" : "", s.hwr ? P(s.p_hwr) : 0);
    this.setWire("mc", dc, s.mc ? P(s.p_mc) : 0, s.p_mc < 0);
    this.setWire("mot", s.mc ? "ac" : "", s.mc ? Math.max(P(s.p_mc), 5) : 0, s.p_mc < 0);

    this.setSwitch("brk", s.brk); this.setSwitch("ctl", s.ctl); this.setSwitch("chct", s.chct);
    this.setBox("lc", s.lc ? "live" : "");
    this.setBox("esc", s.esc ? "liveg" : "");
    this.setBox("fcc", s.fc === "run" ? "liveg" : s.fc === "start" ? "warm" : "");
    this.setBox("fcs", s.fc === "run" ? "liveg" : s.fc === "start" ? "warm" : "");
    this.setBox("hbu", s.hbu_out ? "livea" : s.hbu ? "warm" : "");
    this.setBox("hwr", s.hwr ? "livea" : "");
    this.setBox("mc", s.mc ? "livea" : "");
    this.setBox("vlu", s.p_vlu > 1000 ? "hot" : "");
    this.setBox("eng", s.eng === "run" ? "live" : s.eng === "crank" ? "warm" : "");

    // values
    const sup = D.supply;
    if (this.t.vline) this.t.vline.textContent = sup ? (sup.kind === "AC" ? `U = ${(c.lineV / 1e3).toFixed(1)} kV ~` : `U = ${fmt(col && s.brk ? s.v_line : c.lineV)} V`) : "";
    if (this.t.iline) this.t.iline.textContent = live ? `I = ${fmt(s.i_line)} A` : "";
    if (this.t.rpre) this.t.rpre.textContent = `${fmt(D.Rpre)} Ω`;
    this.t.vdc.textContent = `Vdc ${fmt(s.vdc)} V`;
    if (this.capFill) { const h = clamp(s.vdc / (1.25 * D.vdc), 0, 1) * 92; this.capFill.setAttribute("y", 302 - h); this.capFill.setAttribute("height", h); }
    if (this.batFill) { const h = s.soc * this.batFill._h; this.batFill.setAttribute("y", this.batFill._y + this.batFill._h - h); this.batFill.setAttribute("height", h); }
    if (this.t.bat) this.t.bat.textContent = `SoC ${(s.soc * 100).toFixed(1)} % · ${fmtSI(s.p_esc, "W")}`;
    if (this.t.vlu) this.t.vlu.textContent = s.p_vlu > 1000 ? `${fmtSI(s.p_vlu, "W")} · ${s.t_vlu.toFixed(0)} °C` : `${s.t_vlu.toFixed(0)} °C`;
    if (this.t.hf) this.t.hf.textContent = `${Math.abs(s.i2f).toFixed(0)} A`;
    if (this.t.fc) this.t.fc.textContent = s.fc === "run" ? `${fmtSI(s.p_fc_dc, "W")} · H₂ ${s.h2.toFixed(1)} kg` : s.fc === "start" ? "start-up…" : `H₂ ${s.h2.toFixed(1)} kg`;
    if (this.t.hbu) this.t.hbu.textContent = s.hbu_out ? `${fmtSI(s.p_hbu_out, "W")}` : "off";
    if (this.t.hbuLoads) { const L = s.aux_loads || {}; this.t.hbuLoads.textContent = s.hbu_out ? `HVAC ${fmtSI(L.hvac || 0, "W")} · comp. ${L.comp ? "on" : "off"} · ${s.p_air.toFixed(1)} bar` : ""; }
    if (this.t.hwr) this.t.hwr.textContent = s.hwr ? `${s.f_hwr.toFixed(1)} Hz · ${fmtSI(s.p_hwr, "W")}` : "off";
    if (this.t.eng) this.t.eng.textContent = `${s.n_eng.toFixed(0)} rpm`;
    if (this.t.gen) this.t.gen.textContent = s.n_eng > 50 ? `${(1300 * s.n_eng / 1800 * s.exc).toFixed(0)} V` : "";
    if (this.t.idc) this.t.idc.textContent = "";
    if (this.t.mc) this.t.mc.textContent = s.mc ? `${fmt(s.Is)} A` : "";
    if (this.t.mot) {
      this.t.mot.textContent = s.mc ? `${fmt(s.fs, 1)} Hz · ${s.pulse.label || ""}` : "stopped";
      this.t.mot2.textContent = `${fmt(s.rpm)} rpm · ${(s.torque / 1e3).toFixed(2)} kN·m`;
    }
    this.rotor = (this.rotor + 360 * (s.rpm / 60) * dt * 0.05) % 360;
    if (this.rotors) for (const r of this.rotors) r.setAttribute("transform", r.getAttribute("transform").replace(/rotate\([^)]*\)|$/, ` rotate(${this.rotor})`).trim());
    this.fan = (this.fan + 360 * s.f_hwr * dt * 0.05) % 360;
    if (this.fanG) this.fanG.setAttribute("transform", this.fanG.getAttribute("transform").replace(/rotate\([^)]*\)|$/, ` rotate(${this.fan})`).trim());
  }
}
