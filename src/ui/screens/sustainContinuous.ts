import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents, statusPill } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { startContinuousSustainSession } from "../../audio/continuousSustainSession.ts";
import type { ContinuousSustainController } from "../../audio/continuousSustainSession.ts";
import { drawChart } from "../components/canvasChart.ts";
import type { StringSustainMeasurement } from "../../types/index.ts";

function getMedianTake(m: StringSustainMeasurement) {
  return m.medianTakeIndex !== null ? m.takes[m.medianTakeIndex] : null;
}

export async function renderSustainContinuous(): Promise<void> {
  if (!appState.draft?.session || !appState.draft.noiseFloor) {
    navigate("/tests");
    return;
  }
  const session = appState.draft.session;
  const targets = session.instrumentSnapshot.tuning;

  const app = setApp(`
    ${renderHeader("Sustentação (T60)", "/tests")}
    <div class="screen">
      <div class="card">
        <h3>O que mede</h3>
        <p>Quanto tempo cada corda permanece soando. Toque as cordas livremente, em qualquer ordem, quantas vezes quiser — o app escuta continuamente e mede sozinho. <strong>Deixe cada nota soar até sumir por completo</strong>, não abafe.</p>
      </div>

      <div class="card" id="start-card">
        <button id="start-btn" class="btn btn-primary" style="width:100%">🎙️ Começar a escutar</button>
      </div>

      <div id="live-area" style="display:none; flex-direction:column; gap:16px;">
        <div class="card">
          <div id="status-area">${statusPill("aguardando")}</div>
          <canvas id="live-canvas" height="160" style="margin-top:8px"></canvas>
          <div id="discard-notice"></div>
        </div>
        <div class="card">
          <h3>Resultados (ao vivo)</h3>
          <table>
            <thead><tr><th>Corda</th><th>Nota</th><th>T60 (s)</th><th>Tomadas</th></tr></thead>
            <tbody id="results-body"></tbody>
          </table>
        </div>
        <button id="stop-btn" class="btn btn-primary" style="width:100%">✓ Concluir</button>
      </div>
    </div>
  `);
  attachHeaderEvents(app);

  const startCard = app.querySelector<HTMLDivElement>("#start-card")!;
  const startBtn = app.querySelector<HTMLButtonElement>("#start-btn")!;
  const liveArea = app.querySelector<HTMLDivElement>("#live-area")!;
  const statusArea = app.querySelector<HTMLDivElement>("#status-area")!;
  const liveCanvas = app.querySelector<HTMLCanvasElement>("#live-canvas")!;
  const discardNotice = app.querySelector<HTMLDivElement>("#discard-notice")!;
  const resultsBody = app.querySelector<HTMLTableSectionElement>("#results-body")!;
  const stopBtn = app.querySelector<HTMLButtonElement>("#stop-btn")!;

  function renderResultsRow(m: StringSustainMeasurement): string {
    const take = getMedianTake(m);
    const t60 = take?.sustain ? take.sustain.t60EstimatedSec.toFixed(2) : "—";
    const count = m.takes.filter((t) => t.valid).length;
    const badge = count >= 3 ? "var(--good)" : count >= 1 ? "var(--text)" : "var(--text-faint)";
    return `<tr id="row-${m.stringNumber}">
      <td>${m.stringNumber}</td>
      <td>${m.noteName}</td>
      <td>${t60}</td>
      <td style="color:${badge}">${count}${count >= 3 ? " ✓" : ""}</td>
    </tr>`;
  }

  function renderAllRows(measurements: StringSustainMeasurement[]) {
    resultsBody.innerHTML = measurements
      .slice()
      .sort((a, b) => b.stringNumber - a.stringNumber)
      .map(renderResultsRow)
      .join("");
  }

  // Linhas iniciais vazias, uma por corda, para o usuário ver o quadro completo desde já.
  renderAllRows(
    targets.map((t) => ({
      stringNumber: t.stringNumber,
      noteName: t.noteName,
      expectedFrequencyHz: t.frequencyHz,
      takes: [],
      medianTakeIndex: null,
    }))
  );

  let envelopeBuffer: { timeSec: number; combEnergyDb: number }[] = [];
  let controller: ContinuousSustainController | null = null;

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Iniciando…";
    const capture = await appState.ensureCapture();

    startCard.style.display = "none";
    liveArea.style.display = "flex";

    controller = startContinuousSustainSession(targets, capture.sampleRate, capture, session.noiseFloor!, {
      onStatusChange: (status) => {
        statusArea.innerHTML = statusPill(status);
        if (status === "aguardando") {
          envelopeBuffer = [];
        }
        if (status === "concluido" || status === "descartado") {
          discardNotice.innerHTML = "";
        }
      },
      onEnvelopeUpdate: (frame) => {
        envelopeBuffer.push({ timeSec: frame.timeSec, combEnergyDb: frame.combEnergyDb });
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
      onTakeCompleted: (_stringNumber, _take, measurement) => {
        const row = document.getElementById(`row-${measurement.stringNumber}`);
        if (row) {
          row.outerHTML = renderResultsRow(measurement);
        }
      },
      onDiscarded: (reason) => {
        discardNotice.innerHTML = `<div class="notice notice-warn" style="margin-top:8px">${reason}</div>`;
      },
    });
  });

  stopBtn.addEventListener("click", () => {
    if (!controller) return;
    controller.stop();
    const measurements = controller.getMeasurements();
    session.tests.sustain = { strings: measurements, completedAt: new Date().toISOString() };
    session.updatedAt = new Date().toISOString();
    navigate("/summary");
  });
}
