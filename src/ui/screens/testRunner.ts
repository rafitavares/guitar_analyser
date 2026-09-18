import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents, progressBar, statusPill } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { captureNoteTake } from "../../audio/noteCapture.ts";
import type { CaptureStatus, EnvelopeFrame } from "../../audio/noteCapture.ts";
import { analyzeTake, selectMedianTakeIndex } from "../../audio/takeAnalyzer.ts";
import { drawChart } from "../components/canvasChart.ts";
import type { ChartConfig } from "../components/canvasChart.ts";
import type { NoteMeasurement, NoteTakeResult, Session, StringTuning, TestId, TestRunResult } from "../../types/index.ts";

interface TargetNote {
  stringNumber: number;
  noteName: string;
  fret: number;
  expectedFrequencyHz: number;
}

interface TestConfig {
  id: TestId;
  title: string;
  what: string;
  why: string;
  instruction: (note: TargetNote) => string;
  liveChart: "envelope" | "spectrum";
  drawNoteDetail: (container: HTMLElement, measurement: NoteMeasurement) => void;
  summaryColumns: string[];
  summaryRow: (measurement: NoteMeasurement) => string[];
  summaryHighlight?: (measurement: NoteMeasurement) => "good" | "bad" | null;
}

function getMedianTake(measurement: NoteMeasurement): NoteTakeResult | null {
  if (measurement.medianTakeIndex === null) return null;
  return measurement.takes[measurement.medianTakeIndex] ?? null;
}

function notesFromInstrumentStrings(session: Session): TargetNote[] {
  return session.instrumentSnapshot.tuning.map((t: StringTuning) => ({
    stringNumber: t.stringNumber,
    noteName: t.noteName,
    fret: 0,
    expectedFrequencyHz: t.frequencyHz,
  }));
}

// ---------- Configurações específicas de cada teste ----------

function sustainConfig(): TestConfig {
  return {
    id: "sustain",
    title: "1. Sustentação (T60)",
    what: "Mede quanto tempo cada nota permanece soando.",
    why: "Conforme o violão assenta, o sustain dos graves costuma crescer.",
    instruction: (n) => `Toque a corda ${n.stringNumber} solta — ${n.noteName}, ~${n.expectedFrequencyHz.toFixed(1)} Hz. Deixe soar até sumir, não abafe.`,
    liveChart: "envelope",
    drawNoteDetail: (container, measurement) => {
      const take = getMedianTake(measurement);
      if (!take?.sustain) return;
      const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;
      const curve = take.sustain.decayCurve;
      const cfg: ChartConfig = {
        xMin: 0,
        xMax: Math.max(1, curve[curve.length - 1]?.timeSec ?? 1),
        yMin: -60,
        yMax: 5,
        series: [{ points: curve.map((p) => ({ x: p.timeSec, y: p.db })), color: "#4fd1c5" }],
        refLines: [
          { axis: "y", value: -5, color: "#fbbf24", dashed: true, label: "-5dB" },
          { axis: "y", value: -25, color: "#fbbf24", dashed: true, label: "-25dB" },
          { axis: "y", value: -35, color: "#fbbf24", dashed: true, label: "-35dB" },
          { axis: "y", value: take.sustain.noiseFloorDb, color: "#f87171", dashed: true, label: "piso de ruído" },
        ],
        xLabel: "tempo (s)",
        yLabel: "energia (dB)",
      };
      drawChart(canvas, cfg);
      container.querySelector(".detail-number")!.textContent = `T60 estimado ≈ ${take.sustain.t60EstimatedSec.toFixed(2)}s`;
    },
    summaryColumns: ["Corda", "Nota", "T60 (s)"],
    summaryRow: (m) => {
      const take = getMedianTake(m);
      return [String(m.stringNumber), m.noteName, take?.sustain ? take.sustain.t60EstimatedSec.toFixed(2) : "—"];
    },
  };
}

function harmonicPortraitConfig(): TestConfig {
  return {
    id: "harmonicPortrait",
    title: "2. Retrato Harmônico",
    what: "Mostra a fundamental e os harmônicos ativados, com força relativa.",
    why: "É o 'retrato' sonoro da nota — compare no tempo para ver harmônicos ganhando ou perdendo força.",
    instruction: (n) => `Toque a corda ${n.stringNumber} solta — ${n.noteName}. O espectro será congelado automaticamente logo após o ataque.`,
    liveChart: "spectrum",
    drawNoteDetail: (container, measurement) => {
      const take = getMedianTake(measurement);
      if (!take?.portrait) return;
      const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;
      const snapshot = take.portrait.spectrumSnapshot;
      const cfg: ChartConfig = {
        xMin: 60,
        xMax: 5000,
        xLogScale: true,
        yMin: -80,
        yMax: 0,
        series: [{ points: snapshot.map((p) => ({ x: Math.max(p.freqHz, 1), y: p.db })), color: "#4fd1c5", lineWidth: 1 }],
        markers: take.portrait.peaks.map((p) => ({
          x: p.measuredHz,
          y: p.amplitudeDb,
          color: "#fbbf24",
          label: `${p.noteName} ${p.centsDeviation >= 0 ? "+" : ""}${p.centsDeviation.toFixed(0)}¢`,
        })),
        xLabel: "Hz (log)",
        yLabel: "dB",
      };
      drawChart(canvas, cfg);
      container.querySelector(".detail-number")!.textContent = `Centroide espectral ≈ ${take.portrait.spectralCentroidHz.toFixed(0)} Hz`;

      const table = container.querySelector(".peaks-table")!;
      table.innerHTML = `<table><thead><tr><th>#</th><th>Hz</th><th>Nota</th><th>Cents</th><th>Amp.</th></tr></thead><tbody>
        ${take.portrait.peaks
          .map(
            (p) =>
              `<tr><td>${p.partialNumber}</td><td>${p.measuredHz.toFixed(1)}</td><td>${p.noteName}</td><td>${p.centsDeviation >= 0 ? "+" : ""}${p.centsDeviation.toFixed(0)}</td><td>${p.amplitudeDb.toFixed(1)}dB</td></tr>`
          )
          .join("")}
      </tbody></table>`;
    },
    summaryColumns: ["Corda", "Nota", "Centroide (Hz)", "Nº harmônicos"],
    summaryRow: (m) => {
      const take = getMedianTake(m);
      return [
        String(m.stringNumber),
        m.noteName,
        take?.portrait ? take.portrait.spectralCentroidHz.toFixed(0) : "—",
        take?.portrait ? String(take.portrait.peaks.length) : "—",
      ];
    },
  };
}

function inharmonicityConfig(): TestConfig {
  return {
    id: "inharmonicity",
    title: "3. Inarmonicidade",
    what: "Verifica se os harmônicos caem em múltiplos exatos da fundamental.",
    why: "Em cordas de aço um desvio crescente é normal (rigidez); desvio muito grande pode indicar corda velha.",
    instruction: (n) => `Toque a corda ${n.stringNumber} solta — ${n.noteName} — e deixe soar.`,
    liveChart: "spectrum",
    drawNoteDetail: (container, measurement) => {
      const take = getMedianTake(measurement);
      if (!take?.inharmonicity) return;
      const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;
      const peaks = take.inharmonicity.peaks.filter((p) => p.partialNumber >= 1);
      const maxCents = Math.max(10, ...peaks.map((p) => Math.abs(p.inharmonicityCents)));
      const cfg: ChartConfig = {
        xMin: 0,
        xMax: Math.max(8, peaks.length + 1),
        yMin: -maxCents * 1.2,
        yMax: maxCents * 1.2,
        series: [
          {
            points: peaks.map((p) => ({ x: p.partialNumber, y: p.inharmonicityCents })),
            color: "#fbbf24",
            style: "points",
            pointRadius: 5,
          },
        ],
        refLines: [{ axis: "y", value: 0, color: "#4fd1c5", label: "harmônico perfeito" }],
        xLabel: "parcial (n)",
        yLabel: "desvio (cents)",
      };
      drawChart(canvas, cfg);
      const b = take.inharmonicity.bCoefficient;
      container.querySelector(".detail-number")!.textContent = b != null ? `B ≈ ${b.toExponential(2)}` : "B indeterminado";
    },
    summaryColumns: ["Corda", "Nota", "Coef. B"],
    summaryRow: (m) => {
      const take = getMedianTake(m);
      const b = take?.inharmonicity?.bCoefficient;
      return [String(m.stringNumber), m.noteName, b != null ? b.toExponential(2) : "—"];
    },
  };
}

function beatingConfig(): TestConfig {
  return {
    id: "beating",
    title: "4. Batimento",
    what: "Detecta duas frequências quase iguais que 'brigam', produzindo uma oscilação lenta no volume (uáu-uáu).",
    why: "Muitas vezes é o 'som sujo' que você sente mas não identifica.",
    instruction: (n) => `Toque a corda ${n.stringNumber} solta — ${n.noteName} — e deixe soar.`,
    liveChart: "envelope",
    drawNoteDetail: (container, measurement) => {
      const take = getMedianTake(measurement);
      if (!take?.rawEnvelope) return;
      const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;
      const curve = take.rawEnvelope;
      const cfg: ChartConfig = {
        xMin: 0,
        xMax: Math.max(1, curve[curve.length - 1]?.timeSec ?? 1),
        yMin: -60,
        yMax: 5,
        series: [{ points: curve.map((p) => ({ x: p.timeSec, y: p.db })), color: "#4fd1c5", lineWidth: 1.5 }],
        xLabel: "tempo (s)",
        yLabel: "energia bruta (dB)",
      };
      drawChart(canvas, cfg);
      const beating = take.beating;
      container.querySelector(".detail-number")!.textContent = beating?.detected
        ? `Batimento ≈ ${beating.modulationFreqHz?.toFixed(2)} Hz (prof. ${beating.depthDb?.toFixed(1)}dB)`
        : "Nenhum batimento significativo detectado";
    },
    summaryColumns: ["Corda", "Nota", "Batimento (Hz)", "Profundidade (dB)"],
    summaryRow: (m) => {
      const take = getMedianTake(m);
      const b = take?.beating;
      return [
        String(m.stringNumber),
        m.noteName,
        b?.detected ? b.modulationFreqHz!.toFixed(2) : "—",
        b?.detected ? b.depthDb!.toFixed(1) : "—",
      ];
    },
  };
}

function hnrConfig(): TestConfig {
  return {
    id: "hnr",
    title: "5. Limpeza / Ruído (HNR)",
    what: "Mede a limpeza da nota — quanto é som harmônico útil vs. ruído (traste raspando, buzz, ferragem).",
    why: "Uma queda entre medições indica que algo soltou ou começou a trastejar.",
    instruction: (n) => `Toque a corda ${n.stringNumber} solta — ${n.noteName}.`,
    liveChart: "envelope",
    drawNoteDetail: (container, measurement) => {
      const take = getMedianTake(measurement);
      if (!take?.hnr) return;
      const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;
      const cfg: ChartConfig = {
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: Math.max(30, take.hnr.hnrDb * 1.2),
        series: [{ points: [{ x: 0.5, y: take.hnr.hnrDb }], color: take.hnr.isClean ? "#4ade80" : "#f87171", style: "bars" }],
        refLines: [{ axis: "y", value: 10, color: "#fbbf24", dashed: true, label: "limiar limpo" }],
        xLabel: "",
        yLabel: "HNR (dB)",
      };
      drawChart(canvas, cfg);
      container.querySelector(".detail-number")!.textContent = `HNR ≈ ${take.hnr.hnrDb.toFixed(1)} dB ${take.hnr.isClean ? "(limpo)" : "(atenção)"}`;
    },
    summaryColumns: ["Corda", "Nota", "HNR (dB)"],
    summaryRow: (m) => {
      const take = getMedianTake(m);
      return [String(m.stringNumber), m.noteName, take?.hnr ? take.hnr.hnrDb.toFixed(1) : "—"];
    },
    summaryHighlight: (m) => {
      const take = getMedianTake(m);
      if (!take?.hnr) return null;
      return take.hnr.isClean ? "good" : "bad";
    },
  };
}

const CONFIG_BUILDERS: Partial<Record<TestId, () => TestConfig>> = {
  sustain: sustainConfig,
  harmonicPortrait: harmonicPortraitConfig,
  inharmonicity: inharmonicityConfig,
  beating: beatingConfig,
  hnr: hnrConfig,
};

// ---------- Controlador genérico do fluxo guiado ----------

const TAKES_PER_NOTE = 3;
const MAX_ATTEMPTS_PER_NOTE = 8;

export async function renderTestRunner(testId: TestId): Promise<void> {
  if (!appState.draft?.session) {
    navigate("/tests");
    return;
  }
  const session = appState.draft.session;

  if (testId === "semitoneSweep") {
    const { runSemitoneSweep } = await import("./semitoneSweep.ts");
    await runSemitoneSweep(session);
    return;
  }

  const buildConfig = CONFIG_BUILDERS[testId];
  if (!buildConfig) {
    navigate("/tests");
    return;
  }
  const config = buildConfig();
  const notes = notesFromInstrumentStrings(session);
  const measurements: NoteMeasurement[] = [];

  for (let noteIdx = 0; noteIdx < notes.length; noteIdx++) {
    const note = notes[noteIdx]!;
    const measurement = await runNoteCapture(config, note, noteIdx, notes.length, session);
    measurements.push(measurement);
  }

  const result: TestRunResult = { testId: config.id, measurements, completedAt: new Date().toISOString() };
  session.tests[config.id] = result;
  session.updatedAt = new Date().toISOString();

  renderTestSummary(config, result);
}

function waitForClick(el: Element): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      el.removeEventListener("click", handler);
      resolve();
    };
    el.addEventListener("click", handler);
  });
}

async function runNoteCapture(
  config: TestConfig,
  note: TargetNote,
  noteIdx: number,
  totalNotes: number,
  session: Session
): Promise<NoteMeasurement> {
  const takes: NoteTakeResult[] = [];
  let attempts = 0;

  while (takes.filter((t) => t.valid).length < TAKES_PER_NOTE && attempts < MAX_ATTEMPTS_PER_NOTE) {
    attempts++;
    const validCount = takes.filter((t) => t.valid).length;

    const app = setApp(`
      ${renderHeader(config.title, "/tests")}
      <div class="screen">
        ${progressBar(noteIdx, totalNotes, `Corda ${noteIdx + 1} de ${totalNotes}`)}
        <div class="card">
          <h3>O que mede</h3>
          <p>${config.what}</p>
          <h3>Por quê</h3>
          <p>${config.why}</p>
          <hr />
          <p><strong>${config.instruction(note)}</strong></p>
        </div>
        <div class="card">
          <div class="progress-label">Tomada ${validCount + 1} de ${TAKES_PER_NOTE}</div>
          <div id="status-area" style="margin: 8px 0">${statusPill("aguardando")}</div>
          <canvas id="live-canvas" height="180"></canvas>
          <button id="arm-btn" class="btn btn-primary" style="width:100%; margin-top:12px">🎙️ Tocar agora</button>
        </div>
      </div>
    `);
    attachHeaderEvents(app);

    const armBtn = app.querySelector<HTMLButtonElement>("#arm-btn")!;
    const statusArea = app.querySelector<HTMLDivElement>("#status-area")!;
    const liveCanvas = app.querySelector<HTMLCanvasElement>("#live-canvas")!;

    await waitForClick(armBtn);
    armBtn.disabled = true;
    armBtn.textContent = "Ouvindo…";

    const envelopeBuffer: EnvelopeFrame[] = [];
    let liveSpectrum: { freqHz: number; magnitude: number }[] = [];

    const capture = await appState.ensureCapture();
    const raw = await captureNoteTake({
      expectedFundamentalHz: note.expectedFrequencyHz,
      a4Hz: session.instrumentSnapshot.a4ReferenceHz,
      sampleRate: capture.sampleRate,
      capture,
      noiseFloor: session.noiseFloor!,
      onStatusChange: (status: CaptureStatus) => {
        statusArea.innerHTML = statusPill(status);
      },
      onEnvelopeUpdate: (frame) => {
        envelopeBuffer.push(frame);
        if (config.liveChart === "envelope") {
          drawChart(liveCanvas, {
            xMin: 0,
            xMax: Math.max(1, frame.timeSec),
            yMin: -60,
            yMax: 5,
            series: [{ points: envelopeBuffer.map((f) => ({ x: f.timeSec, y: f.combEnergyDb })), color: "#4fd1c5" }],
            xLabel: "tempo (s)",
            yLabel: "dB",
          });
        }
      },
      onLiveSpectrum: (spectrum) => {
        liveSpectrum = spectrum;
        if (config.liveChart === "spectrum") {
          drawChart(liveCanvas, {
            xMin: 60,
            xMax: 5000,
            xLogScale: true,
            yMin: -80,
            yMax: 0,
            series: [{ points: liveSpectrum.filter((p) => p.freqHz >= 40).map((p) => ({ x: p.freqHz, y: 20 * Math.log10(Math.max(p.magnitude, 1e-9)) })), color: "#4fd1c5", lineWidth: 1 }],
            xLabel: "Hz (log)",
            yLabel: "dB",
          });
        }
      },
    });

    const noiseFloorDb = session.noiseFloor?.dbLevel ?? -60;
    const takeResult = analyzeTake(raw, takes.length, session.instrumentSnapshot.a4ReferenceHz, noiseFloorDb);
    takes.push(takeResult);

    if (!takeResult.valid) {
      statusArea.innerHTML = statusPill("descartado");
      const retryCard = document.createElement("div");
      retryCard.className = "card";
      retryCard.innerHTML = `
        <div class="notice notice-warn">${takeResult.discardReason ?? "Tomada inválida."}</div>
        <button id="retry-btn" class="btn btn-primary" style="width:100%; margin-top:10px">Tentar novamente</button>
      `;
      app.querySelector(".screen")!.appendChild(retryCard);
      await waitForClick(retryCard.querySelector("#retry-btn")!);
    } else {
      statusArea.innerHTML = statusPill("concluido");
      const okCard = document.createElement("div");
      okCard.className = "card";
      const quickText =
        takeResult.sustain != null
          ? `T60 ≈ ${takeResult.sustain.t60EstimatedSec.toFixed(2)}s`
          : takeResult.portrait != null
            ? `Centroide ≈ ${takeResult.portrait.spectralCentroidHz.toFixed(0)}Hz`
            : "Tomada registrada";
      const remaining = TAKES_PER_NOTE - (validCount + 1);
      okCard.innerHTML = `
        <div class="notice notice-info">✓ ${quickText}</div>
        <button id="next-take-btn" class="btn btn-primary" style="width:100%; margin-top:10px">${
          remaining > 0 ? "Próxima tomada" : "Ver resultado da corda"
        }</button>
      `;
      app.querySelector(".screen")!.appendChild(okCard);
      await waitForClick(okCard.querySelector("#next-take-btn")!);
    }
  }

  const medianTakeIndex = selectMedianTakeIndex(takes);
  const measurement: NoteMeasurement = {
    stringNumber: note.stringNumber,
    noteName: note.noteName,
    fret: note.fret,
    expectedFrequencyHz: note.expectedFrequencyHz,
    takes,
    medianTakeIndex,
  };

  await renderNoteSummary(config, measurement, noteIdx, totalNotes);
  return measurement;
}

async function renderNoteSummary(
  config: TestConfig,
  measurement: NoteMeasurement,
  noteIdx: number,
  totalNotes: number
): Promise<void> {
  const isLast = noteIdx === totalNotes - 1;
  const app = setApp(`
    ${renderHeader(config.title, "/tests")}
    <div class="screen">
      ${progressBar(noteIdx + 1, totalNotes, `Corda ${noteIdx + 1} de ${totalNotes} — resultado`)}
      <div class="card">
        <h3>Corda ${measurement.stringNumber} — ${measurement.noteName}</h3>
        <canvas class="detail-canvas" height="200"></canvas>
        <div class="detail-number big-number" style="margin-top:10px; font-size:1.3rem"></div>
        <div class="peaks-table" style="margin-top:8px"></div>
      </div>
      <button id="next-note-btn" class="btn btn-primary" style="width:100%">${
        isLast ? "Ver resumo do teste" : "Próxima corda →"
      }</button>
    </div>
  `);
  attachHeaderEvents(app);

  const detailContainer = app.querySelector<HTMLDivElement>(".card")!;
  // Ajusta o canvas ao container antes de desenhar.
  requestAnimationFrame(() => config.drawNoteDetail(detailContainer, measurement));

  await waitForClick(app.querySelector("#next-note-btn")!);
}

function renderTestSummary(config: TestConfig, result: TestRunResult): void {
  const app = setApp(`
    ${renderHeader(config.title, "/tests")}
    <div class="screen">
      <div class="card">
        <h2>Resumo — ${config.title}</h2>
        <table>
          <thead><tr>${config.summaryColumns.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
          <tbody>
            ${result.measurements
              .map((m) => {
                const highlight = config.summaryHighlight?.(m) ?? null;
                const cls = highlight === "good" ? "delta-good" : highlight === "bad" ? "delta-bad" : "";
                return `<tr class="${cls}">${config.summaryRow(m).map((v) => `<td>${v}</td>`).join("")}</tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
      <button id="menu-btn" class="btn btn-primary" style="width:100%">Próximo teste →</button>
    </div>
  `);
  attachHeaderEvents(app);
  app.querySelector("#menu-btn")?.addEventListener("click", () => navigate("/tests"));
}

export type { TestConfig, TargetNote };
export { notesFromInstrumentStrings, getMedianTake, waitForClick };
