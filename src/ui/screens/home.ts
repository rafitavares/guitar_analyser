import { navigate } from "../../state/router.ts";
import { setApp } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";

export function renderHome(): void {
  appState.stopCapture();
  const app = setApp(`
    <div class="screen">
      <div style="padding-top: 24px; text-align:center;">
        <h1>🎸 Analisador Acústico</h1>
        <p>3 ferramentas independentes de medição do violão, direto do microfone do celular.</p>
      </div>

      <div class="card">
        <button class="btn btn-primary" data-action="sustain" style="width:100%">🎵 Sustentação</button>
        <p style="margin:6px 0 0 0; font-size:0.85rem">Gráfico de decaimento do som até sumir</p>
      </div>
      <div class="card">
        <button class="btn btn-primary" data-action="volume" style="width:100%">🔊 Volume</button>
        <p style="margin:6px 0 0 0; font-size:0.85rem">Medidor de volume por canal, com pico máximo</p>
      </div>
      <div class="card">
        <button class="btn btn-primary" data-action="harmonics" style="width:100%">🎸 Harmônicos</button>
        <p style="margin:6px 0 0 0; font-size:0.85rem">Espectro da nota com envelope de pico fixo</p>
      </div>

      <div class="card">
        <button class="btn" data-action="results" style="width:100%">Ver resultados salvos</button>
      </div>

      <div class="spacer"></div>
      <button class="link-btn center-text" data-action="about">Sobre este app / limitações</button>
    </div>
  `);

  app.querySelector("[data-action='sustain']")?.addEventListener("click", () => navigate("/test/sustain"));
  app.querySelector("[data-action='volume']")?.addEventListener("click", () => navigate("/test/volume"));
  app.querySelector("[data-action='harmonics']")?.addEventListener("click", () => navigate("/test/harmonics"));
  app.querySelector("[data-action='results']")?.addEventListener("click", () => navigate("/results"));
  app.querySelector("[data-action='about']")?.addEventListener("click", () => navigate("/about"));
}
