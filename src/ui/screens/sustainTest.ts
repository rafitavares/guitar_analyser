import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { runSustainMeasurement } from "../../audio/sustainRun.ts";
import type { SustainRunStatus } from "../../audio/sustainRun.ts";
import type { RawEnvelopePoint } from "../../audio/sustainAnalysis.ts";
import { drawChart } from "../components/canvasChart.ts";
import { saveResult, generateId, getLastInstrumentName, setLastInstrumentName } from "../../db/storage.ts";
import { exportResultJson, exportResultCsv } from "../../db/exportImport.ts";
import { PROTOCOL_VERSION } from "../../types/index.ts";
import type { SavedTestResult, SustainRunResult } from "../../types/index.ts";

const STATUS_LABELS: Record<SustainRunStatus, string> = {
  calibrando: "Lendo ruído ambiente… fique em silêncio",
  aguardando: "Aguardando som acima do limiar…",
  medindo: "Medindo…",
  concluido: "Concluído",
};

const THRESHOLD_DB = 10;

export function renderSustainTest(): void {
  const app = setApp(`
    ${renderHeader("Sustentação", "/")}
    <div class="screen">
      <div class="card">
        <h3>O que mede</h3>
        <p>Mostra o gráfico de decaimento do som (envelope) do instante em que ele ultrapassa <strong>${THRESHOLD_DB}dB</strong> acima do ruído ambiente até desaparecer por completo. Antes de cada medição o app lê o ruído do ambiente por 2 segundos para ignorar som externo.</p>
      </div>

      <div class="card" id="start-card">
        <div class="field">
          <label>Instrumento (opcional)</label>
          <input id="instrument-name" value="${getLastInstrumentName()}" placeholder="ex.: Giannini clássico" />
        </div>
        <button id="start-btn" class="btn btn-primary" style="width:100%">🎙️ Iniciar</button>
      </div>

      <div id="live-area" style="display:none; flex-direction:column; gap:16px;">
        <div class="card">
          <div id="status-area" class="status-pill waiting">${STATUS_LABELS.calibrando}</div>
          <canvas id="live-canvas" height="220" style="margin-top:8px"></canvas>
        </div>
        <div id="result-area"></div>
      </div>
    </div>
  `);
  attachHeaderEvents(app);

  const startCard = app.querySelector<HTMLDivElement>("#start-card")!;
  const instrumentInput = app.querySelector<HTMLInputElement>("#instrument-name")!;
  const startBtn = app.querySelector<HTMLButtonElement>("#start-btn")!;
  const liveArea = app.querySelector<HTMLDivElement>("#live-area")!;
  const statusArea = app.querySelector<HTMLDivElement>("#status-area")!;
  const liveCanvas = app.querySelector<HTMLCanvasElement>("#live-canvas")!;
  const resultArea = app.querySelector<HTMLDivElement>("#result-area")!;

  let envelopeBuffer: RawEnvelopePoint[] = [];

  function drawLiveEnvelope() {
    drawChart(liveCanvas, {
      xMin: 0,
      xMax: Math.max(1, envelopeBuffer[envelopeBuffer.length - 1]?.timeSec ?? 1),
      yMin: -60,
      yMax: 5,
      series: [{ points: envelopeBuffer.map((p) => ({ x: p.timeSec, y: p.db })), color: "#4fd1c5" }],
      xLabel: "tempo (s)",
      yLabel: "dB",
    });
  }

  function renderResult(result: SustainRunResult, noiseFloorDb: number) {
    drawChart(liveCanvas, {
      xMin: 0,
      xMax: Math.max(1, result.decayCurve[result.decayCurve.length - 1]?.timeSec ?? 1),
      yMin: -60,
      yMax: 5,
      series: [{ points: result.decayCurve.map((p) => ({ x: p.timeSec, y: p.db })), color: "#4fd1c5" }],
      refLines: [
        { axis: "y", value: -5, color: "#fbbf24", dashed: true, label: "-5dB" },
        { axis: "y", value: -25, color: "#fbbf24", dashed: true, label: "-25dB" },
        { axis: "y", value: -35, color: "#fbbf24", dashed: true, label: "-35dB" },
      ],
      xLabel: "tempo (s)",
      yLabel: "dB",
    });

    resultArea.innerHTML = `
      <div class="card">
        <div class="big-number">${result.t60EstimatedSec.toFixed(2)}s</div>
        <div class="big-number-label">T60 estimado (${result.method}, ruído ambiente ${noiseFloorDb.toFixed(1)}dB)</div>
        <div class="btn-row" style="margin-top:14px">
          <button id="save-btn" class="btn btn-primary" style="flex:1">💾 Salvar</button>
          <button id="restart-btn" class="btn" style="flex:1">🔁 Nova medição</button>
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button id="export-json-btn" class="btn" style="flex:1">Exportar JSON</button>
          <button id="export-csv-btn" class="btn" style="flex:1">Exportar CSV</button>
        </div>
      </div>
    `;

    const savedResult: SavedTestResult = {
      id: generateId(),
      testKind: "sustain",
      instrumentName: instrumentInput.value.trim(),
      sampleRate: appState.capture?.sampleRate ?? 44100,
      noiseFloorDb,
      createdAt: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      sustain: result,
    };

    resultArea.querySelector("#save-btn")?.addEventListener("click", async () => {
      const btn = resultArea.querySelector<HTMLButtonElement>("#save-btn")!;
      btn.disabled = true;
      btn.textContent = "Salvando…";
      setLastInstrumentName(instrumentInput.value.trim());
      try {
        await saveResult(savedResult);
        btn.textContent = "✓ Salvo";
      } catch (err) {
        btn.textContent = "Erro ao salvar";
        btn.disabled = false;
        console.error(err);
      }
    });
    resultArea.querySelector("#restart-btn")?.addEventListener("click", () => startMeasurement());
    resultArea.querySelector("#export-json-btn")?.addEventListener("click", () => exportResultJson(savedResult));
    resultArea.querySelector("#export-csv-btn")?.addEventListener("click", () => exportResultCsv(savedResult));
  }

  async function startMeasurement() {
    startCard.style.display = "none";
    liveArea.style.display = "flex";
    resultArea.innerHTML = "";
    envelopeBuffer = [];
    statusArea.className = "status-pill waiting";
    statusArea.textContent = STATUS_LABELS.calibrando;

    const capture = await appState.ensureCapture();
    try {
      const { noiseFloor, result } = await runSustainMeasurement({
        capture,
        thresholdDb: THRESHOLD_DB,
        onStatusChange: (status) => {
          statusArea.textContent = STATUS_LABELS[status];
          statusArea.className = `status-pill ${status === "medindo" ? "measuring" : status === "concluido" ? "valid" : "waiting"}`;
        },
        onEnvelopeUpdate: (point) => {
          envelopeBuffer.push(point);
          drawLiveEnvelope();
        },
      });
      renderResult(result, noiseFloor.dbLevel);
    } catch (err) {
      statusArea.className = "status-pill discarded";
      statusArea.textContent = "Erro na medição";
      console.error(err);
    }
  }

  startBtn.addEventListener("click", () => {
    void startMeasurement();
  });
}
