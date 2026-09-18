import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { startResonanceListening } from "../../audio/resonanceAnalysis.ts";
import type { ResonanceController, ResonanceSnapshot, ResonanceState } from "../../audio/resonanceAnalysis.ts";
import { drawChart } from "../components/canvasChart.ts";

const STATE_LABELS: Record<ResonanceState, string> = {
  aguardando: "Aguardando som (toque uma nota ou arpejo)…",
  capturando: "Capturando (3s)…",
  congelado: "Congelado — toque novamente para nova medição",
};

export async function renderResonanceContinuous(): Promise<void> {
  if (!appState.draft?.session) {
    navigate("/tests");
    return;
  }
  const session = appState.draft.session;

  const app = setApp(`
    ${renderHeader("Ressonância harmônica", "/tests")}
    <div class="screen">
      <div class="card">
        <h3>O que mede</h3>
        <p>Toque uma nota isolada ou um arpejo com várias cordas juntas. O app mostra ao vivo quais harmônicos mais se destacam e avalia se eles estão bem separados ou "colando" (se sobrepondo, o que costuma soar como aspereza/batimento).</p>
      </div>

      <div class="card" id="start-card">
        <button id="start-btn" class="btn btn-primary" style="width:100%">🎙️ Começar a escutar</button>
      </div>

      <div id="live-area" style="display:none; flex-direction:column; gap:16px;">
        <div class="card">
          <div id="state-area" class="status-pill waiting">${STATE_LABELS.aguardando}</div>
          <canvas id="live-canvas" height="200" style="margin-top:8px"></canvas>
        </div>
        <div class="card">
          <div id="verdict-area"></div>
        </div>
        <div class="card">
          <h3>Harmônicos detectados</h3>
          <div id="peaks-table"></div>
        </div>
        <button id="stop-btn" class="btn btn-primary" style="width:100%">✓ Concluir</button>
      </div>
    </div>
  `);
  attachHeaderEvents(app);

  const startCard = app.querySelector<HTMLDivElement>("#start-card")!;
  const startBtn = app.querySelector<HTMLButtonElement>("#start-btn")!;
  const liveArea = app.querySelector<HTMLDivElement>("#live-area")!;
  const stateArea = app.querySelector<HTMLDivElement>("#state-area")!;
  const liveCanvas = app.querySelector<HTMLCanvasElement>("#live-canvas")!;
  const verdictArea = app.querySelector<HTMLDivElement>("#verdict-area")!;
  const peaksTable = app.querySelector<HTMLDivElement>("#peaks-table")!;
  const stopBtn = app.querySelector<HTMLButtonElement>("#stop-btn")!;

  let controller: ResonanceController | null = null;

  function renderSnapshot(snapshot: ResonanceSnapshot) {
    drawChart(liveCanvas, {
      xMin: 70,
      xMax: 4000,
      xLogScale: true,
      yMin: -90,
      yMax: 0,
      series: [{ points: snapshot.displaySpectrum.map((p) => ({ x: p.freqHz, y: p.db })), color: "#4fd1c5", lineWidth: 1 }],
      markers: snapshot.peaks.map((p) => ({
        x: p.freqHz,
        y: p.rawDb,
        color: "#fbbf24",
        label: p.noteName,
      })),
      xLabel: "Hz (log)",
      yLabel: "dB",
    });

    const overlapFreqs = new Set<number>();
    for (const ov of snapshot.overlaps) {
      overlapFreqs.add(ov.peakAIndex);
      overlapFreqs.add(ov.peakBIndex);
    }

    if (snapshot.peaks.length === 0) {
      verdictArea.innerHTML = `<div class="notice notice-info">Aguardando som…</div>`;
    } else if (snapshot.verdict === "sobreposto") {
      const pairs = snapshot.overlaps
        .map((ov) => `${snapshot.peaks[ov.peakAIndex]!.noteName} e ${snapshot.peaks[ov.peakBIndex]!.noteName} (${ov.centsApart.toFixed(0)}¢ de distância)`)
        .join("; ");
      verdictArea.innerHTML = `<div class="notice notice-warn">⚠ Harmônicos se sobrepondo: ${pairs}</div>`;
    } else {
      verdictArea.innerHTML = `<div class="notice notice-info" style="color:var(--good); border-color:var(--good)">✓ Harmônicos bem separados</div>`;
    }

    peaksTable.innerHTML = `
      <table>
        <thead><tr><th>Hz</th><th>Nota</th><th>Cents</th><th>Amplitude</th></tr></thead>
        <tbody>
          ${snapshot.peaks
            .map(
              (p, i) =>
                `<tr class="${overlapFreqs.has(i) ? "delta-bad" : ""}"><td>${p.freqHz.toFixed(1)}</td><td>${p.noteName}</td><td>${p.centsDeviation >= 0 ? "+" : ""}${p.centsDeviation.toFixed(0)}</td><td>${p.amplitudeDb.toFixed(1)}dB</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Iniciando…";
    const capture = await appState.ensureCapture();

    startCard.style.display = "none";
    liveArea.style.display = "flex";

    controller = startResonanceListening({
      a4Hz: session.instrumentSnapshot.a4ReferenceHz,
      sampleRate: capture.sampleRate,
      capture,
      noiseFloor: session.noiseFloor!,
      onStateChange: (state) => {
        stateArea.textContent = STATE_LABELS[state];
        stateArea.className = `status-pill ${state === "capturando" ? "measuring" : state === "congelado" ? "valid" : "waiting"}`;
      },
      onUpdate: renderSnapshot,
    });
  });

  stopBtn.addEventListener("click", () => {
    if (!controller) return;
    controller.stop();
    const best = controller.getBestSnapshot();
    if (best) {
      session.tests.resonance = {
        capturedAt: new Date().toISOString(),
        peaks: best.peaks.map(({ freqHz, noteName, centsDeviation, amplitudeDb }) => ({
          freqHz,
          noteName,
          centsDeviation,
          amplitudeDb,
        })),
        overlaps: best.overlaps,
        verdict: best.verdict,
      };
      session.updatedAt = new Date().toISOString();
    }
    navigate("/summary");
  });
}
