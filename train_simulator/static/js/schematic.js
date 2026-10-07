// Esquema unifilar animado. Reconstruído quando a topologia muda (DC/AC, 2L/3L).
class Schematic {
  constructor(svg, onToggle) {
    this.svg = svg;
    this.onToggle = onToggle;
    this.key = "";
    this.rotor = 0;
  }

  build(supply, levels) {
    const key = supply + levels;
    if (key === this.key) return;
    this.key = key;
    const svg = this.svg;
    svg.innerHTML = "";
    this.w = {};
    this.sw = {};
    this.t = {};
    const AC = supply === "AC";
    const YP = 190, YN = 330;

    const g = svgEl("g", {}, svg);
    const text = (x, y, s, cls = "", anchor = "middle") => {
      const e = svgEl("text", { x, y, class: cls, "text-anchor": anchor }, g);
      e.textContent = s; return e;
    };
    const wire = (id, d) => {
      const base = svgEl("path", { d, class: "wire" }, g);
      const flow = svgEl("path", { d, class: "flow" }, g);
      (this.w[id] ||= []).push({ base, flow });
    };
    const sw = (id, x, y, label, sub) => {
      const grp = svgEl("g", { class: "sw clickable", "data-id": id }, g);
      svgEl("rect", { x: x - 12, y: y - 34, width: 80, height: 50, rx: 8, class: "hit" }, grp);
      svgEl("circle", { cx: x, cy: y, r: 4, class: "term" }, grp);
      svgEl("circle", { cx: x + 56, cy: y, r: 4, class: "term" }, grp);
      const lev = svgEl("line", { x1: x, y1: y, x2: x + 54, y2: y, class: "lever" }, grp);
      lev.style.transformOrigin = `${x}px ${y}px`;
      const l = svgEl("text", { x: x + 28, y: sub === "" ? y + 24 : y - 22, class: "ttl", "text-anchor": "middle" }, grp); l.textContent = label;
      if (sub) { const s2 = svgEl("text", { x: x + 28, y: y + 26, "text-anchor": "middle", "font-size": 10 }, grp); s2.textContent = sub; }
      grp.addEventListener("click", () => this.onToggle(id));
      this.sw[id] = { grp, lev };
    };

    // catenária / fonte
    wire("cat", "M20,36 L250,36");
    text(250, 26, AC ? "Catenária 25 kV 50 Hz" : "Catenária 3 kV DC", "ttl", "end");
    this.t.vline = text(20, 26, "", "val", "start");

    // pantógrafo (símbolo)
    const pg = svgEl("g", { class: "clickable", "data-id": "panto" }, g);
    svgEl("rect", { x: 40, y: 34, width: 80, height: 84, rx: 8, class: "hit" }, pg);
        this.pantoArm = svgEl("path", { class: "sym", "stroke-width": 3 }, pg);
    this.pantoHead = svgEl("path", { class: "sym", "stroke-width": 3.5 }, pg);
    svgEl("line", { x1: 60, y1: 112, x2: 100, y2: 112, class: "sym", "stroke-width": 4 }, pg);
    pg.addEventListener("click", () => this.onToggle("panto"));
    text(130, 100, "Pantógrafo", "ttl", "start");
    this.t.panto = text(130, 116, "", "", "start");
    wire("panto", `M80,114 L80,${YP} L140,${YP}`);

    sw("mcb", 140, YP, "MCB", "disjuntor principal");
    this.t.isrc = text(168, YP + 44, "", "val");

    if (!AC) {
      wire("mcb", `M196,${YP} L222,${YP} a10,10 0 0 1 20,0 a10,10 0 0 1 20,0 a10,10 0 0 1 20,0 a10,10 0 0 1 20,0 L330,${YP}`);
      text(262, YP - 22, "Filtro L", "ttl");
    } else {
      wire("mcb", `M196,${YP} L232,${YP}`);
      svgEl("circle", { cx: 252, cy: YP, r: 20, class: "sym" }, g);
      svgEl("circle", { cx: 278, cy: YP, r: 20, class: "sym" }, g);
      text(265, YP - 30, "Trafo T1", "ttl");
      wire("pri", `M252,${YP + 20} L252,${YN}`);
      wire("sec", `M298,${YP} L330,${YP}`);
      wire("sec2", `M278,${YP + 20} L278,295 L560,295`);
    }
    // contator de linha e ramo de pré-carga
    wire("node", `M330,${YP} L380,${YP}`);
    sw("ctl", 380, YP, "CtL", "contator de linha (K110)");
    wire("ctl", `M436,${YP} L520,${YP}`);
    wire("pre1", `M330,${YP} L330,262 L360,262`);
    sw("chct", 360, 262, "ChCt", "");
    wire("pre2", `M416,262 L430,262 l5,-8 l10,16 l10,-16 l10,16 l10,-16 l10,16 l5,-8 L520,262 L520,${YP}`);
    text(465, 292, "Rpre (K111)", "", "middle");
    this.t.rpre = text(465, 306, "", "val");

    let xDC0 = 520;
    if (AC) {
      wire("ac2", `M520,${YP} L560,${YP}`);
      const qg = svgEl("g", { class: "clickable", "data-id": "qc" }, g);
      this.qcBox = svgEl("rect", { x: 560, y: 170, width: 80, height: 140, rx: 6, class: "box" }, qg);
      svgEl("line", { x1: 560, y1: 310, x2: 640, y2: 170, class: "sym", "stroke-width": 1.5 }, qg);
      const a = svgEl("text", { x: 578, y: 200, "font-size": 22, fill: "#cfd8e6" }, qg); a.textContent = "~";
      const b = svgEl("text", { x: 606, y: 296, "font-size": 22, fill: "#cfd8e6" }, qg); b.textContent = "=";
      const l = svgEl("text", { x: 600, y: 160, class: "ttl", "text-anchor": "middle" }, qg); l.textContent = "4QC (AC/DC)";
      qg.addEventListener("click", () => this.onToggle("qc"));
      xDC0 = 640;
      wire("dcn", `M640,${YN} L860,${YN}`);
    } else {
      wire("dcn", `M80,${YN} L860,${YN}`);
      // retorno pelo trilho
      svgEl("path", { d: `M66,${YN} L94,${YN} M71,${YN + 6} L89,${YN + 6} M76,${YN + 12} L84,${YN + 12}`, class: "sym" }, g);
      text(80, YN + 30, "trilho (retorno)");
    }
    wire("dcp", `M${xDC0},${YP} L860,${YP}`);

    // DC link (1 ou 2 capacitores)
    const cx = 700;
    if (levels === 3) {
      wire("cap", `M${cx},${YP} L${cx},226 M${cx},238 L${cx},292 M${cx},304 L${cx},${YN}`);
      for (const y of [226, 238, 292, 304]) svgEl("line", { x1: cx - 18, y1: y, x2: cx + 18, y2: y, class: "sym", "stroke-width": 3 }, g);
      wire("np", `M${cx},265 L860,265`);
      text(838, 258, "NP", "", "middle");
    } else {
      wire("cap", `M${cx},${YP} L${cx},254 M${cx},266 L${cx},${YN}`);
      for (const y of [254, 266]) svgEl("line", { x1: cx - 20, y1: y, x2: cx + 20, y2: y, class: "sym", "stroke-width": 3 }, g);
    }
    text(cx - 30, 212, "DC link", "ttl", "end");
    svgEl("rect", { x: cx + 28, y: 200, width: 10, height: 120, rx: 3, fill: "#0e1626", stroke: "#2b3956" }, g);
    this.capFill = svgEl("rect", { x: cx + 28, y: 320, width: 10, height: 0, rx: 3, fill: "url(#capgrad)", class: "capfill" }, g);
    const defs = svgEl("defs", {}, svg);
    defs.innerHTML = `<linearGradient id="capgrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#0e7490"/><stop offset="1" stop-color="#67e8f9"/></linearGradient>`;
    this.t.vdc = text(cx, YN + 30, "", "val");

    // VLU (chopper de frenagem)
    const vx = 795;
    wire("vlu", `M${vx},${YP} L${vx},214 M${vx},258 L${vx},${YN}`);
    this.vluR = svgEl("rect", { x: vx - 8, y: 214, width: 16, height: 44, rx: 2, class: "sym" }, g);
    text(vx, YN + 30, "VLU");

    // inversor
    const ig = svgEl("g", { class: "clickable", "data-id": "inv" }, g);
    this.invBox = svgEl("rect", { x: 860, y: 170, width: 90, height: 180, rx: 6, class: "box" }, ig);
    svgEl("line", { x1: 860, y1: 350, x2: 950, y2: 170, class: "sym", "stroke-width": 1.5 }, ig);
    const e1 = svgEl("text", { x: 874, y: 206, "font-size": 22, fill: "#cfd8e6" }, ig); e1.textContent = "=";
    const e2 = svgEl("text", { x: 918, y: 334, "font-size": 22, fill: "#cfd8e6" }, ig); e2.textContent = "~";
    const il = svgEl("text", { x: 905, y: 160, class: "ttl", "text-anchor": "middle" }, ig);
    il.textContent = levels === 3 ? "Inversor 3L NPC" : "Inversor 2L";
    ig.addEventListener("click", () => this.onToggle("inv"));
    this.t.idc = text(775, YP - 12, "", "val");

    // motor
    wire("mot", "M950,230 L1009,230 M950,260 L1006,260 M950,290 L1009,290");
    svgEl("circle", { cx: 1040, cy: 260, r: 34, class: "box" }, g);
    this.rotorG = svgEl("g", { transform: "translate(1040,260)" }, g);
    for (let k = 0; k < 3; k++) svgEl("line", { x1: 0, y1: 0, x2: 0, y2: -26, class: "rotor", transform: `rotate(${k * 120})`, opacity: 0.35 }, this.rotorG);
    const mt = svgEl("text", { x: 1040, y: 265, "text-anchor": "middle", class: "ttl", "font-size": 15 }, g); mt.textContent = "M 3~";
    text(1040, 212, "Motor de tração", "ttl");
    this.t.mot = text(1040, 316, "", "val");
    this.t.mot2 = text(1040, 332, "", "val");
  }

  setWire(id, cls, flow = 0, rev = false) {
    for (const { base, flow: f } of this.w[id] || []) {
      base.setAttribute("class", "wire " + (cls || ""));
      f.classList.toggle("on", flow > 0);
      f.classList.toggle("rev", rev);
      if (flow > 0) f.style.animationDuration = clamp(1.6 - flow / 300, 0.22, 1.6) + "s";
    }
  }

  setSwitch(id, closed) {
    const s = this.sw[id];
    if (!s) return;
    s.grp.classList.toggle("closed", closed);
    s.lev.style.transform = closed ? "rotate(0deg)" : "rotate(-28deg)";
  }

  update(s, dt) {
    const c = s.cfg, AC = c.supply === "AC";
    this.build(c.supply, c.levels);
    this.svg.classList.toggle("manual", s.mode === "manual");

    // pantógrafo
    const yh = 78 - 40 * s.panto_pos;
    this.pantoArm.setAttribute("d", `M66,112 L100,${(112 + yh) / 2} L76,${yh + 2}`);
    this.pantoHead.setAttribute("d", `M58,${yh} L102,${yh}`);
    this.t.panto.textContent = s.panto_pos >= 1 ? "em contato" : s.panto_cmd ? "subindo…" : s.panto_pos > 0 ? "descendo…" : "abaixado";

    const pUp = s.panto_pos >= 1, up = pUp && s.mcb;
    const iS = Math.abs(s.i_src), iD = Math.abs(s.i_dc);
    const dcCls = s.vdc > 50 ? "dc" : "";
    this.setWire("cat", "line");
    this.setWire("panto", pUp ? "line" : "", up ? iS : 0, s.i_src < 0);
    this.setWire("mcb", up ? "line" : "", up ? iS : 0, s.i_src < 0);
    this.setWire("pri", up ? "line" : "");
    this.setWire("sec", up ? "line" : "", up ? iS : 0);
    this.setWire("sec2", up ? "line" : "");
    this.setWire("node", up ? "line" : "", up && s.ctl ? iS : 0, s.i_src < 0);
    this.setWire("ctl", up && s.ctl ? "line" : "", up && s.ctl ? iS : 0, s.i_src < 0);
    this.setWire("pre1", up ? "line" : "", up && s.chct && !s.ctl ? iS : 0);
    this.setWire("pre2", up && s.chct ? "line" : "", up && s.chct && !s.ctl ? iS : 0);
    this.setWire("ac2", up && (s.ctl || s.chct) ? "line" : "", up ? iS : 0);
    const iBus = AC ? iD : Math.max(iS, iD);
    this.setWire("dcp", dcCls, iBus > 1 ? iBus : 0, s.i_dc < 0 && iS < 1);
    this.setWire("dcn", dcCls);
    this.setWire("cap", dcCls);
    this.setWire("np", dcCls);
    this.setWire("vlu", s.p_vlu > 0 ? "dc" : dcCls, s.i_vlu);
    this.setWire("mot", s.inv_on ? "ac" : "", s.inv_on ? s.i_phase : 0, s.force < 0);

    this.setSwitch("mcb", s.mcb);
    this.setSwitch("ctl", s.ctl);
    this.setSwitch("chct", s.chct);
    if (this.qcBox) this.qcBox.setAttribute("class", "box" + (s.qc_on ? " live" : ""));
    this.invBox.setAttribute("class", "box" + (s.inv_on ? " livea" : ""));
    this.vluR.setAttribute("class", "sym" + (s.p_vlu > 0 ? " vlu-on" : ""));

    const h = clamp(s.vdc / (1.2 * c.vnom), 0, 1) * 120;
    this.capFill.setAttribute("y", 320 - h);
    this.capFill.setAttribute("height", h);

    this.t.vline.textContent = AC ? "U = 25 kV ~" : `U = ${fmt(c.v_cat_dc)} V`;
    this.t.isrc.textContent = up ? `I = ${fmt(s.i_src)} A` : "";
    this.t.rpre.textContent = `${fmt(c.r_pre)} Ω`;
    this.t.vdc.textContent = `${fmt(s.vdc)} V`;
    this.t.idc.textContent = s.inv_on ? `${fmt(s.i_dc)} A` : "";
    const rpm = s.f_rotor / c.pole_pairs * 60;
    this.t.mot.textContent = s.inv_on ? `${fmt(s.f_s, 1)} Hz` : "parado";
    this.t.mot2.textContent = `${fmt(rpm)} rpm`;
    this.rotor = (this.rotor + 360 * (s.f_rotor / c.pole_pairs) * dt * 0.25) % 360; // 1/4 da rotação real p/ ser visível
    this.rotorG.setAttribute("transform", `translate(1040,260) rotate(${this.rotor})`);
  }
}
