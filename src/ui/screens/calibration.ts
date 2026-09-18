import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { measureNoiseFloor, isEnvironmentNoisy } from "../../audio/calibration.ts";

export function renderCalibration(): void {
  if (!appState.draft) {
    navigate("/instrument");
    return;
  }

  const app = setApp(`
    ${renderHeader("Calibração de ambiente", "/protocol")}
    <div class="screen">
      <div class="card">
        <h2>Medir ruído de fundo</h2>
        <p>Fique em silêncio por 3 segundos. O app vai medir o piso de ruído do ambiente para calibrar a detecção das notas e rejeitar ruído externo.</p>
        <button id="measure-btn" class="btn btn-primary" style="width:100%">Medir ruído de fundo</button>
        <div id="status" style="margin-top:12px"></div>
      </div>
      <div id="result-card" class="card" style="display:none">
        <div class="big-number" id="noise-db">—</div>
        <div class="big-number-label">dB relativo (piso de ruído)</div>
        <div id="noise-warning"></div>
        <button id="continue-btn" class="btn btn-primary" style="width:100%; margin-top:12px">Continuar → Menu de testes</button>
        <button id="remeasure-btn" class="btn" style="width:100%; margin-top:8px">Medir novamente</button>
      </div>
    </div>
  `);

  attachHeaderEvents(app);

  const measureBtn = app.querySelector<HTMLButtonElement>("#measure-btn")!;
  const statusEl = app.querySelector<HTMLDivElement>("#status")!;
  const resultCard = app.querySelector<HTMLDivElement>("#result-card")!;
  const noiseDbEl = app.querySelector<HTMLDivElement>("#noise-db")!;
  const warningEl = app.querySelector<HTMLDivElement>("#noise-warning")!;

  async function runMeasurement() {
    measureBtn.disabled = true;
    statusEl.innerHTML = `<span class="status-pill measuring">Medindo… fique em silêncio</span>`;
    try {
      const capture = await appState.ensureCapture();
      const profile = await measureNoiseFloor(capture);
      if (!appState.draft) return;
      appState.draft.noiseFloor = profile;
      noiseDbEl.textContent = `${profile.dbLevel.toFixed(1)} dB`;
      warningEl.innerHTML = isEnvironmentNoisy(profile)
        ? `<div class="notice notice-warn">Ambiente ruidoso — a precisão pode cair. Procure um lugar mais silencioso se possível.</div>`
        : `<div class="notice notice-info">Ambiente adequado para medição.</div>`;
      resultCard.style.display = "flex";
      resultCard.style.flexDirection = "column";
      statusEl.innerHTML = "";
    } catch (err) {
      statusEl.innerHTML = `<div class="notice notice-warn">Erro ao acessar o microfone: ${
        err instanceof Error ? err.message : String(err)
      }. Verifique as permissões do navegador.</div>`;
    } finally {
      measureBtn.disabled = false;
    }
  }

  measureBtn.addEventListener("click", runMeasurement);
  app.querySelector("#remeasure-btn")?.addEventListener("click", runMeasurement);
  app.querySelector("#continue-btn")?.addEventListener("click", () => navigate("/tests"));
}
