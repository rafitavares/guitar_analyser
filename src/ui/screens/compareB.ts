import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { listSessions } from "../../db/storage.ts";
import { drawRadarChart } from "../components/canvasChart.ts";
import type { RadarSeries } from "../components/canvasChart.ts";
import { downloadFile } from "../../db/exportImport.ts";
import type { ComparisonWeights, Session, NoteMeasurement } from "../../types/index.ts";

function getMedianTake(m: NoteMeasurement) {
  return m.medianTakeIndex !== null ? m.takes[m.medianTakeIndex] : null;
}

interface InstrumentMetrics {
  session: Session;
  label: string;
  t60Graves: number | null;
  t60Agudos: number | null;
  brightness: number | null;
  hnr: number | null;
  inharmonicity: number | null; // |B| médio, menor é melhor
  uniformity: number | null; // 0-1, maior é melhor
  wolfNoteCount: number | null;
}

function computeMetrics(session: Session): InstrumentMetrics {
  const label = `${session.instrumentSnapshot.nickname} (${new Date(session.createdAt).toLocaleDateString("pt-BR")})`;

  let t60Graves: number | null = null;
  let t60Agudos: number | null = null;
  let uniformity: number | null = null;

  if (session.tests.sustain) {
    const measurements = session.tests.sustain.measurements;
    const maxString = Math.max(...measurements.map((m) => m.stringNumber));
    const halfway = maxString / 2;
    const t60ByString = measurements
      .map((m) => ({ stringNumber: m.stringNumber, t60: getMedianTake(m)?.sustain?.t60EstimatedSec ?? null }))
      .filter((x): x is { stringNumber: number; t60: number } => x.t60 != null);

    const graves = t60ByString.filter((x) => x.stringNumber > halfway).map((x) => x.t60);
    const agudos = t60ByString.filter((x) => x.stringNumber <= halfway).map((x) => x.t60);
    t60Graves = graves.length ? avg(graves) : null;
    t60Agudos = agudos.length ? avg(agudos) : null;

    if (t60ByString.length >= 2) {
      const all = t60ByString.map((x) => x.t60);
      const mean = avg(all);
      const std = Math.sqrt(all.reduce((a, v) => a + (v - mean) ** 2, 0) / all.length);
      const cv = mean > 0 ? std / mean : 0;
      uniformity = 1 / (1 + cv);
    }
  }

  let brightness: number | null = null;
  if (session.tests.harmonicPortrait) {
    const values = session.tests.harmonicPortrait.measurements
      .map((m) => getMedianTake(m)?.portrait?.spectralCentroidHz)
      .filter((v): v is number => v != null);
    brightness = values.length ? avg(values) : null;
  }

  let hnr: number | null = null;
  if (session.tests.hnr) {
    const values = session.tests.hnr.measurements
      .map((m) => getMedianTake(m)?.hnr?.hnrDb)
      .filter((v): v is number => v != null);
    hnr = values.length ? avg(values) : null;
  }

  let inharmonicity: number | null = null;
  if (session.tests.inharmonicity) {
    const values = session.tests.inharmonicity.measurements
      .map((m) => getMedianTake(m)?.inharmonicity?.bCoefficient)
      .filter((v): v is number => v != null)
      .map((v) => Math.abs(v));
    inharmonicity = values.length ? avg(values) : null;
  }

  let wolfNoteCount: number | null = null;
  if (session.tests.semitoneSweep) {
    const values = session.tests.semitoneSweep.measurements
      .map((m) => getMedianTake(m)?.sustain?.t60EstimatedSec)
      .filter((v): v is number => v != null && v > 0);
    if (values.length >= 3) {
      const mean = avg(values);
      const std = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
      wolfNoteCount = std > 0 ? values.filter((v) => (mean - v) / std > 1.2).length : 0;
    }
  }

  return { session, label, t60Graves, t60Agudos, brightness, hnr, inharmonicity, uniformity, wolfNoteCount };
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function normalizeGroup(values: (number | null)[], higherIsBetter: boolean): number[] {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return values.map(() => 0);
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  return values.map((v) => {
    if (v == null) return 0;
    if (max === min) return 100;
    const frac = higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min);
    return Math.round(frac * 100);
  });
}

const DEFAULT_WEIGHTS: ComparisonWeights = {
  sustain: { weight: 3, direction: "more" },
  brightness: { weight: 3, direction: "more" },
  balance: { weight: 2, direction: "more" },
  hnr: { weight: 3 },
  inharmonicity: { weight: 3 },
  uniformity: { weight: 2 },
  wolfNotes: { weight: 3 },
};

export async function renderCompareB(): Promise<void> {
  const sessions = await listSessions();

  const app = setApp(`
    ${renderHeader("Comparar instrumentos", "/")}
    <div class="screen">
      <div class="card">
        <p>Selecione 2 ou mais sessões (de instrumentos diferentes, ou duas unidades do mesmo modelo) para comparar.</p>
        <div id="session-checks">
          ${sessions
            .map(
              (s) => `<div class="checklist-item">
                <input type="checkbox" id="s-${s.id}" value="${s.id}" />
                <label for="s-${s.id}" style="margin:0; color:var(--text)">${s.instrumentSnapshot.nickname} — ${new Date(s.createdAt).toLocaleDateString("pt-BR")} (${Object.keys(s.tests).length} testes)</label>
              </div>`
            )
            .join("")}
        </div>
        <button id="next-btn" class="btn btn-primary" style="width:100%; margin-top:10px" disabled>Definir preferências →</button>
      </div>
      <div id="prefs-area"></div>
      <div id="result-area"></div>
    </div>
  `);
  attachHeaderEvents(app);

  const checks = app.querySelectorAll<HTMLInputElement>("#session-checks input");
  const nextBtn = app.querySelector<HTMLButtonElement>("#next-btn")!;
  const prefsArea = app.querySelector<HTMLDivElement>("#prefs-area")!;
  const resultArea = app.querySelector<HTMLDivElement>("#result-area")!;

  checks.forEach((c) =>
    c.addEventListener("change", () => {
      nextBtn.disabled = Array.from(checks).filter((x) => x.checked).length < 2;
    })
  );

  nextBtn.addEventListener("click", () => {
    const selectedIds = Array.from(checks)
      .filter((c) => c.checked)
      .map((c) => c.value);
    const selectedSessions = sessions.filter((s) => selectedIds.includes(s.id));
    renderPreferences(prefsArea, resultArea, selectedSessions);
  });
}

function weightRow(id: string, label: string, weight: number, direction?: "more" | "less"): string {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="field-row" style="align-items:center">
        <input type="range" id="w-${id}" min="0" max="5" value="${weight}" style="flex:2" />
        ${
          direction
            ? `<select id="d-${id}" style="flex:1">
                <option value="more" ${direction === "more" ? "selected" : ""}>prefiro mais</option>
                <option value="less" ${direction === "less" ? "selected" : ""}>prefiro menos</option>
              </select>`
            : `<span class="tag" style="flex:1; text-align:center">fixo</span>`
        }
      </div>
    </div>
  `;
}

function renderPreferences(prefsArea: HTMLElement, resultArea: HTMLElement, sessions: Session[]): void {
  prefsArea.innerHTML = `
    <div class="card">
      <h3>Preferências de comparação</h3>
      <p>Sustain, brilho e balanço são preferência pessoal, não qualidade objetiva — ajuste o peso (0-5) e a direção. Os demais parâmetros têm direção objetiva fixa.</p>
      ${weightRow("sustain", "Sustain (T60)", DEFAULT_WEIGHTS.sustain.weight, DEFAULT_WEIGHTS.sustain.direction)}
      ${weightRow("brightness", "Brilho (centroide)", DEFAULT_WEIGHTS.brightness.weight, DEFAULT_WEIGHTS.brightness.direction)}
      ${weightRow("balance", "Balanço grave/agudo", DEFAULT_WEIGHTS.balance.weight, DEFAULT_WEIGHTS.balance.direction)}
      ${weightRow("hnr", "Limpeza (HNR) — maior é melhor", DEFAULT_WEIGHTS.hnr.weight)}
      ${weightRow("inharmonicity", "Inarmonicidade — menor é melhor", DEFAULT_WEIGHTS.inharmonicity.weight)}
      ${weightRow("uniformity", "Uniformidade entre cordas — maior é melhor", DEFAULT_WEIGHTS.uniformity.weight)}
      ${weightRow("wolfNotes", "Wolf notes — menos é melhor", DEFAULT_WEIGHTS.wolfNotes.weight)}
      <button id="calc-btn" class="btn btn-primary" style="width:100%; margin-top:10px">Calcular comparação</button>
    </div>
  `;

  prefsArea.querySelector("#calc-btn")?.addEventListener("click", () => {
    const getW = (id: string) => parseInt((prefsArea.querySelector(`#w-${id}`) as HTMLInputElement).value, 10);
    const getD = (id: string) => (prefsArea.querySelector(`#d-${id}`) as HTMLSelectElement).value as "more" | "less";
    const weights: ComparisonWeights = {
      sustain: { weight: getW("sustain"), direction: getD("sustain") },
      brightness: { weight: getW("brightness"), direction: getD("brightness") },
      balance: { weight: getW("balance"), direction: getD("balance") },
      hnr: { weight: getW("hnr") },
      inharmonicity: { weight: getW("inharmonicity") },
      uniformity: { weight: getW("uniformity") },
      wolfNotes: { weight: getW("wolfNotes") },
    };
    renderResults(resultArea, sessions, weights);
  });
}

function renderResults(resultArea: HTMLElement, sessions: Session[], weights: ComparisonWeights): void {
  const metrics = sessions.map(computeMetrics);

  const conditionsSpread =
    new Set(sessions.map((s) => Math.round(s.conditions.distanceCm / 5))).size > 1 ||
    new Set(sessions.map((s) => s.instrumentSnapshot.a4ReferenceHz)).size > 1;

  const sustainAvg = metrics.map((m) => (m.t60Graves != null && m.t60Agudos != null ? (m.t60Graves + m.t60Agudos) / 2 : null));
  const balanceRatio = metrics.map((m) => (m.t60Graves != null && m.t60Agudos && m.t60Agudos > 0 ? m.t60Graves / m.t60Agudos : null));

  const normSustain = normalizeGroup(sustainAvg, weights.sustain.direction === "more");
  const normBrightness = normalizeGroup(metrics.map((m) => m.brightness), weights.brightness.direction === "more");
  const normBalance = normalizeGroup(balanceRatio, weights.balance.direction === "more");
  const normHnr = normalizeGroup(metrics.map((m) => m.hnr), true);
  const normInharm = normalizeGroup(metrics.map((m) => m.inharmonicity), false);
  const normUniformity = normalizeGroup(metrics.map((m) => m.uniformity), true);
  const normWolf = normalizeGroup(metrics.map((m) => m.wolfNoteCount), false);

  const axisData = [
    { key: "sustain", label: "Sustain", norm: normSustain, weight: weights.sustain.weight },
    { key: "brightness", label: "Brilho", norm: normBrightness, weight: weights.brightness.weight },
    { key: "balance", label: "Balanço grave/agudo", norm: normBalance, weight: weights.balance.weight },
    { key: "hnr", label: "Limpeza (HNR)", norm: normHnr, weight: weights.hnr.weight },
    { key: "inharmonicity", label: "Inarmonicidade", norm: normInharm, weight: weights.inharmonicity.weight },
    { key: "uniformity", label: "Uniformidade", norm: normUniformity, weight: weights.uniformity.weight },
    { key: "wolfNotes", label: "Ausência de wolf notes", norm: normWolf, weight: weights.wolfNotes.weight },
  ];

  const totalWeight = axisData.reduce((a, ax) => a + ax.weight, 0) || 1;
  const scores = metrics.map((_, i) => {
    const weighted = axisData.reduce((a, ax) => a + ax.norm[i]! * ax.weight, 0);
    return weighted / totalWeight;
  });

  const ranking = metrics
    .map((m, i) => ({ m, score: scores[i]! }))
    .sort((a, b) => b.score - a.score);

  function winsAndLoses(idx: number): { wins: string[]; loses: string[] } {
    const wins: string[] = [];
    const loses: string[] = [];
    for (const ax of axisData) {
      const values = ax.norm;
      const maxV = Math.max(...values);
      const minV = Math.min(...values);
      if (values[idx] === maxV && maxV > minV) wins.push(ax.label);
      if (values[idx] === minV && maxV > minV) loses.push(ax.label);
    }
    return { wins, loses };
  }

  const radarSeries: RadarSeries[] = metrics.map((m, i) => ({
    label: m.label,
    color: ["#4fd1c5", "#f87171", "#fbbf24", "#a78bfa", "#34d399"][i % 5]!,
    values: axisData.map((ax) => ax.norm[i]!),
  }));

  resultArea.innerHTML = `
    ${conditionsSpread ? `<div class="notice notice-warn">Condições de captura diferentes entre as sessões — a comparação pode não ser justa.</div>` : ""}

    <div class="card">
      <h3>Ranking (nota reflete os pesos/preferências configurados acima — não é qualidade absoluta)</h3>
      ${ranking
        .map(
          ({ m, score }, pos) => {
            const idx = metrics.indexOf(m);
            const { wins, loses } = winsAndLoses(idx);
            return `<div style="margin-bottom:10px">
              <strong>${pos + 1}º — ${m.label}</strong> · <span class="big-number" style="font-size:1.3rem">${score.toFixed(0)}</span>/100
              <div style="font-size:0.8rem; color:var(--text-dim)">
                ${wins.length ? `Vence em: ${wins.join(", ")}` : ""}
                ${loses.length ? `<br/>Perde em: ${loses.join(", ")}` : ""}
              </div>
            </div>`;
          }
        )
        .join("<hr/>")}
    </div>

    <div class="card">
      <h3>Perfil comparado</h3>
      <canvas id="radar-canvas" height="300"></canvas>
    </div>

    <div class="card" style="overflow-x:auto">
      <h3>Tabela comparativa</h3>
      <table>
        <thead><tr><th>Parâmetro</th>${metrics.map((m) => `<th>${m.label}</th>`).join("")}</tr></thead>
        <tbody>
          <tr><td>T60 graves (s)</td>${metrics.map((m) => `<td>${m.t60Graves?.toFixed(2) ?? "—"}</td>`).join("")}</tr>
          <tr><td>T60 agudos (s)</td>${metrics.map((m) => `<td>${m.t60Agudos?.toFixed(2) ?? "—"}</td>`).join("")}</tr>
          <tr><td>Centroide (Hz)</td>${metrics.map((m) => `<td>${m.brightness?.toFixed(0) ?? "—"}</td>`).join("")}</tr>
          <tr><td>HNR (dB)</td>${metrics.map((m) => `<td>${m.hnr?.toFixed(1) ?? "—"}</td>`).join("")}</tr>
          <tr><td>|B| inarmonicidade</td>${metrics.map((m) => `<td>${m.inharmonicity != null ? m.inharmonicity.toExponential(1) : "—"}</td>`).join("")}</tr>
          <tr><td>Uniformidade (0-1)</td>${metrics.map((m) => `<td>${m.uniformity?.toFixed(2) ?? "—"}</td>`).join("")}</tr>
          <tr><td>Wolf notes detectadas</td>${metrics.map((m) => `<td>${m.wolfNoteCount ?? "—"}</td>`).join("")}</tr>
        </tbody>
      </table>
    </div>

    <button id="export-compare-btn" class="btn" style="width:100%">Exportar comparação (JSON)</button>
  `;

  requestAnimationFrame(() => {
    const radarCanvas = resultArea.querySelector<HTMLCanvasElement>("#radar-canvas")!;
    drawRadarChart(radarCanvas, axisData.map((a) => a.label), radarSeries);
  });

  resultArea.querySelector("#export-compare-btn")?.addEventListener("click", () => {
    const payload = {
      sessions: sessions.map((s) => ({ id: s.id, nickname: s.instrumentSnapshot.nickname, date: s.createdAt })),
      weights,
      metrics,
      scores: metrics.map((m, i) => ({ label: m.label, score: scores[i] })),
    };
    downloadFile("comparacao_instrumentos.json", JSON.stringify(payload, null, 2), "application/json");
  });
}
