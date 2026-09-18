// Teste 6 — Varredura de Sustentação por Semitom: detecta uma nota grave
// cujo comportamento destoa das vizinhas (wolf note / ressonância do corpo).

import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents, progressBar, statusPill } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { captureNoteTake } from "../../audio/noteCapture.ts";
import type { CaptureStatus, EnvelopeFrame } from "../../audio/noteCapture.ts";
import { analyzeTake, selectMedianTakeIndex } from "../../audio/takeAnalyzer.ts";
import { drawChart } from "../components/canvasChart.ts";
import { transposeNote } from "../../audio/noteUtils.ts";
import type { NoteMeasurement, NoteTakeResult, Session, TestRunResult } from "../../types/index.ts";
import { waitForClick } from "./testRunner.ts";

const FRET_COUNT = 7; // casas 0 a 7
const TAKES_PER_NOTE = 3;
const MAX_ATTEMPTS_PER_NOTE = 8;

export async function runSemitoneSweep(session: Session): Promise<void> {
  const bassString = session.instrumentSnapshot.tuning.reduce((max, t) =>
    t.stringNumber > max.stringNumber ? t : max
  );
  const a4Hz = session.instrumentSnapshot.a4ReferenceHz;

  const notes = Array.from({ length: FRET_COUNT + 1 }).map((_, fret) => {
    const freq = bassString.frequencyHz * Math.pow(2, fret / 12);
    const noteName = transposeNote(bassString.noteName, fret, a4Hz);
    return { stringNumber: bassString.stringNumber, noteName, fret, expectedFrequencyHz: freq };
  });

  const measurements: NoteMeasurement[] = [];

  for (let idx = 0; idx < notes.length; idx++) {
    const note = notes[idx]!;
    const takes: NoteTakeResult[] = [];
    let attempts = 0;

    while (takes.filter((t) => t.valid).length < TAKES_PER_NOTE && attempts < MAX_ATTEMPTS_PER_NOTE) {
      attempts++;
      const validCount = takes.filter((t) => t.valid).length;

      const app = setApp(`
        ${renderHeader("6. Varredura por semitom", "/tests")}
        <div class="screen">
          ${progressBar(idx, notes.length, `Nota ${idx + 1} de ${notes.length}`)}
          <div class="card">
            <h3>O que mede</h3>
            <p>Detecta uma nota grave cujo comportamento destoa das vizinhas — sinal de ressonância do corpo "roubando" energia dela (wolf note).</p>
            <hr />
            <p><strong>Toque, na corda ${note.stringNumber}, a casa ${note.fret} (${note.noteName}, ~${note.expectedFrequencyHz.toFixed(1)}Hz).</strong></p>
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
      const capture = await appState.ensureCapture();
      const raw = await captureNoteTake({
        expectedFundamentalHz: note.expectedFrequencyHz,
        a4Hz,
        sampleRate: capture.sampleRate,
        capture,
        noiseFloor: session.noiseFloor!,
        onStatusChange: (status: CaptureStatus) => {
          statusArea.innerHTML = statusPill(status);
        },
        onEnvelopeUpdate: (frame) => {
          envelopeBuffer.push(frame);
          drawChart(liveCanvas, {
            xMin: 0,
            xMax: Math.max(1, frame.timeSec),
            yMin: -60,
            yMax: 5,
            series: [{ points: envelopeBuffer.map((f) => ({ x: f.timeSec, y: f.combEnergyDb })), color: "#4fd1c5" }],
            xLabel: "tempo (s)",
            yLabel: "dB",
          });
        },
      });

      const noiseFloorDb = session.noiseFloor?.dbLevel ?? -60;
      const takeResult = analyzeTake(raw, takes.length, a4Hz, noiseFloorDb);
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
        const remaining = TAKES_PER_NOTE - (validCount + 1);
        okCard.innerHTML = `
          <div class="notice notice-info">✓ T60 ≈ ${takeResult.sustain?.t60EstimatedSec.toFixed(2)}s</div>
          <button id="next-take-btn" class="btn btn-primary" style="width:100%; margin-top:10px">${
            remaining > 0 ? "Próxima tomada" : "Próxima nota"
          }</button>
        `;
        app.querySelector(".screen")!.appendChild(okCard);
        await waitForClick(okCard.querySelector("#next-take-btn")!);
      }
    }

    const medianTakeIndex = selectMedianTakeIndex(takes);
    measurements.push({
      stringNumber: note.stringNumber,
      noteName: note.noteName,
      fret: note.fret,
      expectedFrequencyHz: note.expectedFrequencyHz,
      takes,
      medianTakeIndex,
    });
  }

  const result: TestRunResult = { testId: "semitoneSweep", measurements, completedAt: new Date().toISOString() };
  session.tests.semitoneSweep = result;
  session.updatedAt = new Date().toISOString();

  renderSweepSummary(measurements);
}

function renderSweepSummary(measurements: NoteMeasurement[]): void {
  const points = measurements.map((m) => {
    const take = m.medianTakeIndex !== null ? m.takes[m.medianTakeIndex] : null;
    return { note: m.noteName, fret: m.fret, t60: take?.sustain?.t60EstimatedSec ?? 0, beating: take?.beating };
  });

  const t60Values = points.map((p) => p.t60).filter((v) => v > 0);
  const meanT60 = t60Values.reduce((a, b) => a + b, 0) / Math.max(1, t60Values.length);
  const std = Math.sqrt(t60Values.reduce((a, b) => a + (b - meanT60) ** 2, 0) / Math.max(1, t60Values.length));

  let suspectIdx = -1;
  let worstZ = 0;
  points.forEach((p, i) => {
    const z = std > 0 ? (meanT60 - p.t60) / std : 0; // z alto = T60 muito abaixo da média
    if (p.t60 > 0 && z > worstZ && z > 1.2) {
      worstZ = z;
      suspectIdx = i;
    }
  });

  const app = setApp(`
    ${renderHeader("6. Varredura por semitom", "/tests")}
    <div class="screen">
      <div class="card">
        <h2>Resumo — Varredura por semitom</h2>
        <canvas id="sweep-canvas" height="220"></canvas>
        ${
          suspectIdx >= 0
            ? `<div class="notice notice-warn" style="margin-top:10px">⚠ Possível ressonância problemática em <strong>${points[suspectIdx]!.note}</strong> (casa ${points[suspectIdx]!.fret}) — sustain visivelmente menor que as notas vizinhas.</div>`
            : `<div class="notice notice-info" style="margin-top:10px">Nenhuma nota destoante detectada nesta varredura.</div>`
        }
        <table style="margin-top:10px">
          <thead><tr><th>Casa</th><th>Nota</th><th>T60 (s)</th><th>Batimento</th></tr></thead>
          <tbody>
            ${points
              .map(
                (p, i) =>
                  `<tr class="${i === suspectIdx ? "delta-bad" : ""}"><td>${p.fret}</td><td>${p.note}</td><td>${p.t60.toFixed(2)}</td><td>${p.beating?.detected ? p.beating.modulationFreqHz!.toFixed(1) + "Hz" : "—"}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <button id="menu-btn" class="btn btn-primary" style="width:100%">Voltar ao menu de testes</button>
    </div>
  `);
  attachHeaderEvents(app);

  const canvas = app.querySelector<HTMLCanvasElement>("#sweep-canvas")!;
  requestAnimationFrame(() => {
    drawChart(canvas, {
      xMin: 0,
      xMax: points.length - 1,
      yMin: 0,
      yMax: Math.max(1, ...points.map((p) => p.t60)) * 1.2,
      series: [{ points: points.map((p, i) => ({ x: i, y: p.t60 })), color: "#4fd1c5", style: "points", pointRadius: 4 }],
      markers:
        suspectIdx >= 0
          ? [{ x: suspectIdx, y: points[suspectIdx]!.t60, color: "#f87171", label: "suspeita" }]
          : [],
      xLabel: "casa (semitom)",
      yLabel: "T60 (s)",
    });
  });

  app.querySelector("#menu-btn")?.addEventListener("click", () => navigate("/tests"));
}
