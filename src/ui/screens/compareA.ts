import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { listInstruments, listSessionsForInstrument } from "../../db/storage.ts";
import { drawChart } from "../components/canvasChart.ts";
import type { Session, NoteMeasurement } from "../../types/index.ts";

function getMedianTake(m: NoteMeasurement) {
  return m.medianTakeIndex !== null ? m.takes[m.medianTakeIndex] : null;
}

function deltaHtml(oldVal: number, newVal: number, higherIsBetter: boolean, unit = "", decimals = 2): string {
  const delta = newVal - oldVal;
  const pct = oldVal !== 0 ? (delta / Math.abs(oldVal)) * 100 : 0;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  const cls = Math.abs(pct) < 1 ? "delta-neutral" : improved ? "delta-good" : "delta-bad";
  const sign = delta >= 0 ? "+" : "";
  return `<span class="${cls}">${sign}${delta.toFixed(decimals)}${unit} (${sign}${pct.toFixed(0)}%)</span>`;
}

export async function renderCompareA(): Promise<void> {
  const instruments = await listInstruments();

  const app = setApp(`
    ${renderHeader("Comparar no tempo", "/")}
    <div class="screen">
      <div class="card">
        <p>Compare duas sessões do mesmo instrumento para ver se ele "abriu", estabilizou, melhorou ou piorou.</p>
        <div class="field">
          <label>Instrumento</label>
          <select id="instrument-select">
            <option value="">Selecione…</option>
            ${instruments.map((i) => `<option value="${i.id}">${i.nickname}</option>`).join("")}
          </select>
        </div>
        <div id="session-selects"></div>
        <button id="compare-btn" class="btn btn-primary" style="width:100%; margin-top:10px" disabled>Comparar</button>
      </div>
      <div id="result-area"></div>
    </div>
  `);
  attachHeaderEvents(app);

  const instrumentSelect = app.querySelector<HTMLSelectElement>("#instrument-select")!;
  const sessionSelectsArea = app.querySelector<HTMLDivElement>("#session-selects")!;
  const compareBtn = app.querySelector<HTMLButtonElement>("#compare-btn")!;
  const resultArea = app.querySelector<HTMLDivElement>("#result-area")!;

  instrumentSelect.addEventListener("change", async () => {
    resultArea.innerHTML = "";
    compareBtn.disabled = true;
    const instrumentId = instrumentSelect.value;
    if (!instrumentId) {
      sessionSelectsArea.innerHTML = "";
      return;
    }
    const sessions = await listSessionsForInstrument(instrumentId);
    if (sessions.length < 2) {
      sessionSelectsArea.innerHTML = `<div class="notice notice-warn" style="margin-top:10px">Este instrumento tem menos de 2 sessões salvas. Meça-o novamente em outra data para comparar.</div>`;
      return;
    }
    const options = sessions
      .map((s) => `<option value="${s.id}">${new Date(s.createdAt).toLocaleDateString("pt-BR")} — ${Object.keys(s.tests).length} teste(s)</option>`)
      .join("");
    sessionSelectsArea.innerHTML = `
      <div class="field-row" style="margin-top:10px">
        <div class="field">
          <label>Sessão A (mais antiga)</label>
          <select id="session-a">${options}</select>
        </div>
        <div class="field">
          <label>Sessão B (mais recente)</label>
          <select id="session-b">${options}</select>
        </div>
      </div>
    `;
    const sessionBSelect = sessionSelectsArea.querySelector<HTMLSelectElement>("#session-b")!;
    sessionBSelect.selectedIndex = Math.max(0, sessions.length - 1);
    compareBtn.disabled = false;

    compareBtn.onclick = () => {
      const sessionAId = sessionSelectsArea.querySelector<HTMLSelectElement>("#session-a")!.value;
      const sessionBId = sessionSelectsArea.querySelector<HTMLSelectElement>("#session-b")!.value;
      const sessionA = sessions.find((s) => s.id === sessionAId)!;
      const sessionB = sessions.find((s) => s.id === sessionBId)!;
      resultArea.innerHTML = buildComparisonHtml(sessionA, sessionB);
      requestAnimationFrame(() => drawOverlayCharts(resultArea, sessionA, sessionB));
    };
  });
}

function buildComparisonHtml(a: Session, b: Session): string {
  const conditionsMismatch =
    Math.abs(a.conditions.distanceCm - b.conditions.distanceCm) > 5 ||
    a.instrumentSnapshot.a4ReferenceHz !== b.instrumentSnapshot.a4ReferenceHz ||
    a.sampleRate !== b.sampleRate;

  let html = `
    <div class="card">
      <h3>${new Date(a.createdAt).toLocaleDateString("pt-BR")} → ${new Date(b.createdAt).toLocaleDateString("pt-BR")}</h3>
      ${
        conditionsMismatch
          ? `<div class="notice notice-warn">Condições de captura diferentes entre as sessões (distância do mic, A4 de referência ou taxa de amostragem) — a comparação pode não ser justa.</div>`
          : ""
      }
    </div>
  `;

  if (a.tests.sustain && b.tests.sustain) {
    html += `<div class="card"><h3>Sustentação (T60)</h3><table><thead><tr><th>Corda</th><th>Nota</th><th>A</th><th>B</th><th>Δ</th></tr></thead><tbody>`;
    for (const mb of b.tests.sustain.measurements) {
      const ma = a.tests.sustain.measurements.find((m) => m.stringNumber === mb.stringNumber);
      const ta = ma ? getMedianTake(ma) : null;
      const tb = getMedianTake(mb);
      if (!ta?.sustain || !tb?.sustain) continue;
      html += `<tr><td>${mb.stringNumber}</td><td>${mb.noteName}</td><td>${ta.sustain.t60EstimatedSec.toFixed(2)}s</td><td>${tb.sustain.t60EstimatedSec.toFixed(2)}s</td><td>${deltaHtml(ta.sustain.t60EstimatedSec, tb.sustain.t60EstimatedSec, true, "s")}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  if (a.tests.harmonicPortrait && b.tests.harmonicPortrait) {
    html += `<div class="card"><h3>Centroide espectral (brilho)</h3><table><thead><tr><th>Corda</th><th>Nota</th><th>A</th><th>B</th><th>Δ</th></tr></thead><tbody>`;
    for (const mb of b.tests.harmonicPortrait.measurements) {
      const ma = a.tests.harmonicPortrait.measurements.find((m) => m.stringNumber === mb.stringNumber);
      const ta = ma ? getMedianTake(ma) : null;
      const tb = getMedianTake(mb);
      if (!ta?.portrait || !tb?.portrait) continue;
      html += `<tr><td>${mb.stringNumber}</td><td>${mb.noteName}</td><td>${ta.portrait.spectralCentroidHz.toFixed(0)}Hz</td><td>${tb.portrait.spectralCentroidHz.toFixed(0)}Hz</td><td>${deltaHtml(ta.portrait.spectralCentroidHz, tb.portrait.spectralCentroidHz, true, "Hz", 0)}</td></tr>`;
    }
    html += `</tbody></table><canvas id="overlay-decay-canvas" height="200" style="margin-top:10px"></canvas></div>`;
  }

  if (a.tests.hnr && b.tests.hnr) {
    html += `<div class="card"><h3>Limpeza (HNR)</h3><table><thead><tr><th>Corda</th><th>Nota</th><th>A</th><th>B</th><th>Δ</th></tr></thead><tbody>`;
    for (const mb of b.tests.hnr.measurements) {
      const ma = a.tests.hnr.measurements.find((m) => m.stringNumber === mb.stringNumber);
      const ta = ma ? getMedianTake(ma) : null;
      const tb = getMedianTake(mb);
      if (!ta?.hnr || !tb?.hnr) continue;
      html += `<tr><td>${mb.stringNumber}</td><td>${mb.noteName}</td><td>${ta.hnr.hnrDb.toFixed(1)}dB</td><td>${tb.hnr.hnrDb.toFixed(1)}dB</td><td>${deltaHtml(ta.hnr.hnrDb, tb.hnr.hnrDb, true, "dB", 1)}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  if (!a.tests.sustain && !a.tests.harmonicPortrait && !a.tests.hnr) {
    html += `<div class="card"><p>Nenhum teste em comum entre as duas sessões para comparar.</p></div>`;
  }

  return html;
}

function drawOverlayCharts(container: HTMLElement, a: Session, b: Session): void {
  const canvas = container.querySelector<HTMLCanvasElement>("#overlay-decay-canvas");
  if (!canvas || !a.tests.sustain || !b.tests.sustain) return;

  const commonString = b.tests.sustain.measurements.find((mb) =>
    a.tests.sustain!.measurements.some((ma) => ma.stringNumber === mb.stringNumber)
  );
  if (!commonString) return;
  const ma = a.tests.sustain.measurements.find((m) => m.stringNumber === commonString.stringNumber)!;
  const ta = getMedianTake(ma);
  const tb = getMedianTake(commonString);
  if (!ta?.sustain || !tb?.sustain) return;

  const maxX = Math.max(
    ta.sustain.decayCurve[ta.sustain.decayCurve.length - 1]?.timeSec ?? 1,
    tb.sustain.decayCurve[tb.sustain.decayCurve.length - 1]?.timeSec ?? 1
  );

  drawChart(canvas, {
    xMin: 0,
    xMax: Math.max(1, maxX),
    yMin: -60,
    yMax: 5,
    series: [
      { points: ta.sustain.decayCurve.map((p) => ({ x: p.timeSec, y: p.db })), color: "#f87171" },
      { points: tb.sustain.decayCurve.map((p) => ({ x: p.timeSec, y: p.db })), color: "#4fd1c5" },
    ],
    xLabel: `tempo (s) — corda ${commonString.stringNumber} · vermelho=A azul=B`,
    yLabel: "dB",
  });
}
