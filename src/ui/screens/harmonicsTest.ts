import { renderHeader, attachHeaderEvents, setApp } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { startHarmonicsListening } from "../../audio/harmonicsRun.ts";
import type { HarmonicsRunController, HarmonicsSnapshot } from "../../audio/harmonicsRun.ts";
import { drawChart } from "../components/canvasChart.ts";
import { saveResult, generateId, getLastInstrumentName, setLastInstrumentName } from "../../db/storage.ts";
import { exportResultJson, exportResultCsv } from "../../db/exportImport.ts";
import { PROTOCOL_VERSION } from "../../types/index.ts";
import type { SavedTestResult } from "../../types/index.ts";

const PRESET_NOTES = ["E2", "A2", "D3", "G3", "B3", "E4"];
const A4_HZ = 440;

export function renderHarmonicsTest(): void {
  const app = setApp(`
    ${renderHeader("Harmônicos", "/")}
    <div class="screen">
      <div class="card">
        <h3>O que mede</h3>
        <p>Selecione a corda/nota que vai tocar, depois inicie e toque. O gráfico mostra o espectro ao vivo e trava uma linha no volume máximo já alcançado em cada frequência (peak-hold) — essa linha fixa é o "retrato" dos harmônicos da nota.</p>
      </div>

      <div class="card" id="start-card">
        <label>Corda / nota</label>
        <div class="btn-row" style="flex-wrap:wrap; gap:8px">
          ${PRESET_NOTES.map((n) => `<button class="btn note-btn" data-note="${n}" style="flex:1 1 30%">${n}</button>`).join("")}
        </div>
        <div class="field" style="margin-top:10px">
          <label>Ou rótulo livre</label>
          <input id="custom-note" placeholder="ex.: harmônico natural casa 12" />
        </div>
        <div class="field">
          <label>Instrumento (opcional)</label>
          <input id="instrument-name" value="${getLastInstrumentName()}" placeholder="ex.: Giannini clássico" />
        </div>
        <button id="start-btn" class="btn btn-primary" style="width:100%" disabled>🎙️ Iniciar</button>
      </div>

      <div id="live-area" style="display:none; flex-direction:column; gap:16px;">
        <div class="card">
          <div id="note-label" class="tag"></div>
          <canvas id="live-canvas" height="220" style="margin-top:8px"></canvas>
        </div>
        <div class="card">
          <h3>Harmônicos detectados (pico fixo)</h3>
          <div id="peaks-table"></div>
        </div>
        <div class="btn-row">
          <button id="reset-btn" class="btn" style="flex:1">🔁 Reiniciar</button>
          <button id="stop-btn" class="btn btn-primary" style="flex:1">✓ Concluir</button>
        </div>
        <div id="result-area"></div>
      </div>
    </div>
  `);
  attachHeaderEvents(app);

  const startCard = app.querySelector<HTMLDivElement>("#start-card")!;
  const noteButtons = app.querySelectorAll<HTMLButtonElement>(".note-btn");
  const customNoteInput = app.querySelector<HTMLInputElement>("#custom-note")!;
  const instrumentInput = app.querySelector<HTMLInputElement>("#instrument-name")!;
  const startBtn = app.querySelector<HTMLButtonElement>("#start-btn")!;
  const liveArea = app.querySelector<HTMLDivElement>("#live-area")!;
  const noteLabelEl = app.querySelector<HTMLDivElement>("#note-label")!;
  const liveCanvas = app.querySelector<HTMLCanvasElement>("#live-canvas")!;
  const peaksTable = app.querySelector<HTMLDivElement>("#peaks-table")!;
  const resetBtn = app.querySelector<HTMLButtonElement>("#reset-btn")!;
  const stopBtn = app.querySelector<HTMLButtonElement>("#stop-btn")!;
  const resultArea = app.querySelector<HTMLDivElement>("#result-area")!;

  let selectedNote = "";
  let controller: HarmonicsRunController | null = null;
  let lastSnapshot: HarmonicsSnapshot | null = null;

  function selectNote(note: string) {
    selectedNote = note;
    noteButtons.forEach((b) => b.classList.toggle("btn-primary", b.dataset.note === note));
    if (note) customNoteInput.value = "";
    startBtn.disabled = !selectedNote && !customNoteInput.value.trim();
  }

  noteButtons.forEach((b) => b.addEventListener("click", () => selectNote(b.dataset.note!)));
  customNoteInput.addEventListener("input", () => {
    if (customNoteInput.value.trim()) {
      selectedNote = "";
      noteButtons.forEach((b) => b.classList.remove("btn-primary"));
    }
    startBtn.disabled = !selectedNote && !customNoteInput.value.trim();
  });

  function renderSnapshot(snapshot: HarmonicsSnapshot) {
    lastSnapshot = snapshot;
    drawChart(liveCanvas, {
      xMin: 60,
      xMax: 4000,
      xLogScale: true,
      yMin: -90,
      yMax: 0,
      series: [
        { points: snapshot.liveSpectrum.map((p) => ({ x: p.freqHz, y: p.db })), color: "#2a5f5a", lineWidth: 1 },
        { points: snapshot.peakHoldSpectrum.map((p) => ({ x: p.freqHz, y: p.db })), color: "#4fd1c5", lineWidth: 1.5 },
      ],
      markers: snapshot.peaks.map((p) => ({ x: p.freqHz, y: p.amplitudeDb, color: "#fbbf24", label: p.noteName })),
      xLabel: "Hz (log) — linha clara = ao vivo, linha forte = pico fixo",
      yLabel: "dB",
    });

    peaksTable.innerHTML = `
      <table>
        <thead><tr><th>Hz</th><th>Nota</th><th>Cents</th><th>Amplitude</th></tr></thead>
        <tbody>
          ${snapshot.peaks
            .map(
              (p) =>
                `<tr><td>${p.freqHz.toFixed(1)}</td><td>${p.noteName}</td><td>${p.centsDeviation >= 0 ? "+" : ""}${p.centsDeviation.toFixed(0)}</td><td>${p.amplitudeDb.toFixed(1)}dB</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  startBtn.addEventListener("click", async () => {
    const label = selectedNote || customNoteInput.value.trim();
    startBtn.disabled = true;
    startBtn.textContent = "Iniciando…";
    const capture = await appState.ensureCapture();

    startCard.style.display = "none";
    liveArea.style.display = "flex";
    noteLabelEl.textContent = label;
    resultArea.innerHTML = "";

    controller = startHarmonicsListening({
      a4Hz: A4_HZ,
      sampleRate: capture.sampleRate,
      capture,
      onUpdate: renderSnapshot,
    });
  });

  resetBtn.addEventListener("click", () => controller?.reset());

  stopBtn.addEventListener("click", () => {
    if (!controller || !lastSnapshot) return;
    const elapsedSec = controller.getElapsedSec();
    controller.stop();

    const label = selectedNote || customNoteInput.value.trim();
    const savedResult: SavedTestResult = {
      id: generateId(),
      testKind: "harmonics",
      instrumentName: instrumentInput.value.trim(),
      sampleRate: appState.capture?.sampleRate ?? 44100,
      noiseFloorDb: 0,
      createdAt: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      harmonics: {
        noteLabel: label,
        a4ReferenceHz: A4_HZ,
        peakHoldSpectrum: lastSnapshot.peakHoldSpectrum,
        peaks: lastSnapshot.peaks,
        durationSec: elapsedSec,
      },
    };

    resultArea.innerHTML = `
      <div class="card">
        <div class="btn-row">
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
