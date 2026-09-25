import { renderHeader, attachHeaderEvents, setApp } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { startVolumeMonitoring } from "../../audio/volumeRun.ts";
import type { VolumeChannelLiveState, VolumeRunController } from "../../audio/volumeRun.ts";
import { drawChart } from "../components/canvasChart.ts";
import { saveResult, generateId, getLastInstrumentName, setLastInstrumentName } from "../../db/storage.ts";
import { exportResultJson, exportResultCsv } from "../../db/exportImport.ts";
import { PROTOCOL_VERSION } from "../../types/index.ts";
import type { SavedTestResult } from "../../types/index.ts";

const MIN_DB = -90;
const CHANNEL_LABELS = ["Canal 1 (esquerdo)", "Canal 2 (direito)"];

export function renderVolumeTest(): void {
  const app = setApp(`
    ${renderHeader("Volume", "/")}
    <div class="screen">
      <div class="card">
        <h3>O que mede</h3>
        <p>Mostra o volume atual de cada canal do microfone em tempo real, num gráfico de barras. A maioria dos celulares tem microfone mono (os dois canais ficam iguais); se o aparelho tiver microfone estéreo de verdade, os canais aparecem separados. Uma marca fica travada no volume máximo já alcançado em cada canal.</p>
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
          <canvas id="live-canvas" height="260"></canvas>
        </div>
        <div class="card">
          <div id="readout-area" class="grid-2"></div>
        </div>
        <div class="btn-row">
          <button id="reset-btn" class="btn" style="flex:1">🔁 Reiniciar pico</button>
          <button id="stop-btn" class="btn btn-primary" style="flex:1">✓ Concluir</button>
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
  const liveCanvas = app.querySelector<HTMLCanvasElement>("#live-canvas")!;
  const readoutArea = app.querySelector<HTMLDivElement>("#readout-area")!;
  const resetBtn = app.querySelector<HTMLButtonElement>("#reset-btn")!;
  const stopBtn = app.querySelector<HTMLButtonElement>("#stop-btn")!;
  const resultArea = app.querySelector<HTMLDivElement>("#result-area")!;

  let controller: VolumeRunController | null = null;

  function renderChannels(channels: VolumeChannelLiveState[]) {
    const n = Math.max(1, channels.length);
    const chartWidth = liveCanvas.clientWidth || 320;
    const barWidthPx = Math.max(20, (chartWidth - 56) / n - 20);

    drawChart(liveCanvas, {
      xMin: 0,
      xMax: n,
      yMin: MIN_DB,
      yMax: 0,
      series: [
        {
          points: channels.map((c, i) => ({ x: i + 0.5, y: c.currentDb })),
          color: "#4fd1c5",
          style: "bars",
        },
      ],
      markers: channels.map((c, i) => ({
        x: i + 0.5,
        y: c.peakDb,
        color: "#f87171",
        label: `${c.peakDb.toFixed(1)}dB`,
        tickWidthPx: barWidthPx,
      })),
      xLabel: channels.map((_, i) => CHANNEL_LABELS[i] ?? `Canal ${i + 1}`).join("   "),
      yLabel: "dB",
      heightPx: 260,
    });

    readoutArea.innerHTML = channels
      .map(
        (c, i) => `<div class="card" style="padding:10px">
          <div class="big-number" style="font-size:1.4rem">${c.currentDb.toFixed(1)}dB</div>
          <div class="big-number-label">${CHANNEL_LABELS[i] ?? `Canal ${i + 1}`} · pico ${c.peakDb.toFixed(1)}dB</div>
        </div>`
      )
      .join("");
  }

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Iniciando…";
    const capture = await appState.ensureCapture();

    startCard.style.display = "none";
    liveArea.style.display = "flex";

    controller = startVolumeMonitoring({
      capture,
      onUpdate: (channels) => renderChannels(channels),
    });
  });

  resetBtn.addEventListener("click", () => controller?.reset());

  stopBtn.addEventListener("click", () => {
    if (!controller) return;
    const channels = controller.getState();
    const elapsedSec = controller.getElapsedSec();
    controller.stop();

    const savedResult: SavedTestResult = {
      id: generateId(),
      testKind: "volume",
      instrumentName: instrumentInput.value.trim(),
      sampleRate: appState.capture?.sampleRate ?? 44100,
      noiseFloorDb: MIN_DB,
      createdAt: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      volume: {
        durationSec: elapsedSec,
        channels: channels.map((c) => ({
          channelIndex: c.channelIndex,
          channelLabel: CHANNEL_LABELS[c.channelIndex] ?? `Canal ${c.channelIndex + 1}`,
          peakDb: c.peakDb,
          finalDb: c.currentDb,
        })),
      },
    };

    resultArea.innerHTML = `
      <div class="card">
        <h3>Resultado</h3>
        ${channels
          .map(
            (c) =>
              `<p><strong>${CHANNEL_LABELS[c.channelIndex] ?? `Canal ${c.channelIndex + 1}`}:</strong> pico de ${c.peakDb.toFixed(1)}dB</p>`
          )
          .join("")}
        <div class="btn-row" style="margin-top:10px">
          <button id="save-btn" class="btn btn-primary" style="flex:1">💾 Salvar</button>
          <button id="restart-btn" class="btn" style="flex:1">🔁 Nova medição</button>
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button id="export-json-btn" class="btn" style="flex:1">Exportar JSON</button>
          <button id="export-csv-btn" class="btn" style="flex:1">Exportar CSV</button>
        </div>
      </div>
    `;

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
    resultArea.querySelector("#restart-btn")?.addEventListener("click", () => {
      startCard.style.display = "flex";
      liveArea.style.display = "none";
      resultArea.innerHTML = "";
      startBtn.disabled = false;
      startBtn.textContent = "🎙️ Iniciar";
    });
    resultArea.querySelector("#export-json-btn")?.addEventListener("click", () => exportResultJson(savedResult));
    resultArea.querySelector("#export-csv-btn")?.addEventListener("click", () => exportResultCsv(savedResult));
  });
}
