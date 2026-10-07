// Aba "Laboratório Excel": cada cartão chama a API que reproduz uma aba da planilha
function initLab() {
  const L = {};
  L.pwm = new Chart($("#lc-pwm"), {
    height: 260,
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("t [s]"), axisY("V", "y")],
    series: [{ label: "A (t)" },
      { label: "D — PWM", stroke: COL.ac, width: 1.5, fill: "rgba(167,139,250,.2)", paths: uPlot.paths.stepped({ align: 1 }) },
      { label: "B — senoide", stroke: COL.line, width: 2 },
      { label: "C — portadora", stroke: "#64748b", width: 1 }],
  }, 4);
  L.pre = new Chart($("#lc-pre"), {
    height: 260,
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("Time [s]"), axisY("Voltage (V)", "y")],
    series: [{ label: "A (t)", value: (u, v) => v == null ? "—" : v.toFixed(2) + " s" },
      { label: "B — tensão", stroke: COL.dc, width: 2.5, fill: "rgba(34,211,238,.08)" },
      { label: "E2 — alvo", stroke: COL.line, width: 1.5, dash: [6, 4] },
      { label: "D2 — instante", stroke: COL.bad, width: 0, points: { show: true, size: 10, fill: COL.bad } }],
  }, 4);
  L.rip = new Chart($("#lc-rip"), {
    height: 260,
    scales: { x: { time: false }, y: { auto: true } },
    axes: [axisX("Tempo [s]"), axisY("V", "y")],
    series: [{ label: "A (t)", value: (u, v) => v == null ? "—" : (v * 1000).toFixed(2) + " ms" },
      { label: "E — curva final", stroke: COL.dc, width: 2.5 },
      { label: "B — retificada", stroke: "rgba(245,165,36,.45)", width: 1 },
      { label: "C — carga RC", stroke: COL.ok, width: 1, dash: [5, 4] }],
  }, 4);

  let level = 2;
  const bind = (id, out, f, cb) => {
    const el = $(id);
    const h = () => { $(out).textContent = f(+el.value); cb(); };
    el.addEventListener("input", h);
    $(out).textContent = f(+el.value);
  };

  const runPwm = debounce(async () => {
    const q = new URLSearchParams({ level, freq: $("#li-freq").value, amp: $("#li-amp").value, fc: $("#li-fc").value, carrier_amp: $("#li-ca").value });
    const d = await apiGet("/api/lab/pwm?" + q);
    L.pwm.set([d.t, d.pwm, d.ref, d.carrier]);
    const g = { speed: $("#li-freq").value * 4 / 100, power: $("#li-amp").value / 1500 };
    $("#lf-pwm").innerHTML = (level === 2
      ? `D = IF(B>0, IF(|B|>|C|, <b>1500</b>, 0), IF(|B|>|C|, <b>−1500</b>, 0))`
      : `D = IF(B>0, IF(B≥750, IF(|B|>|C|,<b>1500</b>,<b>750</b>), IF(|B|>|C|,<b>750</b>,0)),\n        IF(|B|≥750, IF(|B|>|C|,<b>−1500</b>,<b>−750</b>), IF(|B|>|C|,<b>−750</b>,0)))`)
      + `\nB = Amp·sin(2π·f·t)   C = E2·(1 − 2·|frac(t·fc) − 0.5|)   passo 0.0001 s, 1001 linhas`
      + `\nIndicadores da aba principal:  Speed = B2·4/100 = <b>${g.speed.toFixed(2)}</b>   Power = C2/1500 = <b>${g.power.toFixed(2)}</b>`;
  }, 60);

  const runPre = debounce(async () => {
    const vmax = +$("#li-pvmax").value, r = +$("#li-pr").value, c = $("#li-pc").value / 1000, pct = +$("#li-pp").value;
    const d = await apiGet("/api/lab/precharge?" + new URLSearchParams({ vmax, r, c, percent: pct }));
    const tgt = d.t.map(() => d.target_v);
    const mark = d.t.map(() => null);
    let k = d.t.findIndex((t) => t >= d.target_t);
    if (k >= 0) mark[k] = d.target_v;
    L.pre.set([d.t, d.v, tgt, mark]);
    $("#lf-pre").innerHTML = `B = ROUND(H1·(1 − e^(−t/(H2·H3))), 0)     τ = R·C = <b>${d.tau.toFixed(3)} s</b>`
      + `\nD2 = IF(E2=H1, 8.5, −R·C·ln(1 − E2/H1))  →  tempo para ${pct}% (${d.target_v.toFixed(0)} V) = <b>${d.target_t.toFixed(3)} s</b>`
      + `\nNo simulador o CtL fecha quando o DC link atinge o limiar de pré-carga (95 % por padrão).`;
  }, 60);

  const runRip = debounce(async () => {
    const q = { r: $("#li-rr").value, c_step: $("#li-rc").value, vmax: $("#li-rv").value, dt_step: $("#li-rd").value };
    const d = await apiGet("/api/lab/ripple?" + new URLSearchParams(q));
    L.rip.set([d.t, d.final, d.rect, d.charge]);
    $("#lf-rip").innerHTML = `B = G4·|sin(2π·100·t)|   C = G4·(1 − e^(−t/(G2·G3)))   D = IF(B>C, C, D₋₁·e^(−Δt/(G2·G3)))`
      + `\nE = IF(B>C, C, IF(B&lt;D, D, B))      C = <b>${(d.C * 1e6).toFixed(0)} µF</b>   τ = <b>${(d.tau * 1000).toFixed(2)} ms</b>   passo 10 µs, 5000 linhas`;
  }, 60);

  bind("#li-freq", "#lv-freq", (v) => v + " Hz", runPwm);
  bind("#li-amp", "#lv-amp", (v) => v + " V", runPwm);
  bind("#li-fc", "#lv-fc", (v) => v + " Hz", runPwm);
  bind("#li-ca", "#lv-ca", (v) => v + " V", runPwm);
  bind("#li-pvmax", "#lv-pvmax", (v) => v + " V", runPre);
  bind("#li-pr", "#lv-pr", (v) => v + " Ω", runPre);
  bind("#li-pc", "#lv-pc", (v) => v.toFixed(1) + " mF", runPre);
  bind("#li-pp", "#lv-pp", (v) => v + " %", runPre);
  bind("#li-rr", "#lv-rr", (v) => v + " Ω", runRip);
  bind("#li-rc", "#lv-rc", (v) => v + "  (" + v * 10 + " µF)", runRip);
  bind("#li-rv", "#lv-rv", (v) => v + " V", runRip);
  bind("#li-rd", "#lv-rd", (v) => v + "  (" + (v / 10).toFixed(1) + " µs)", runRip);

  $$("#lab-level button").forEach((b) => b.addEventListener("click", () => {
    level = +b.dataset.l;
    $$("#lab-level button").forEach((x) => x.classList.toggle("on", x === b));
    $("#li-fc").value = level === 2 ? 400 : 600;
    $("#lv-fc").textContent = $("#li-fc").value + " Hz";
    runPwm();
  }));

  L.refresh = () => { runPwm(); runPre(); runRip(); };
  return L;
}
