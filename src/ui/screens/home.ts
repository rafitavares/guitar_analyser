import { navigate } from "../../state/router.ts";
import { setApp } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";

export function renderHome(): void {
  appState.reset();
  const app = setApp(`
    <div class="screen">
      <div style="padding-top: 24px; text-align:center;">
        <h1>🎸 Analisador Acústico</h1>
        <p>Meça e compare a acústica do seu violão ao longo do tempo, usando apenas o microfone do celular.</p>
      </div>

      <div class="card">
        <button class="btn btn-primary" data-action="new-session" style="width:100%">Nova sessão</button>
      </div>
      <div class="card">
        <button class="btn" data-action="saved-sessions" style="width:100%">Ver sessões salvas</button>
      </div>
      <div class="card">
        <button class="btn" data-action="compare-a" style="width:100%">Comparar mesmo instrumento no tempo</button>
      </div>
      <div class="card">
        <button class="btn" data-action="compare-b" style="width:100%">Comparar instrumentos diferentes</button>
      </div>

      <div class="spacer"></div>
      <button class="link-btn center-text" data-action="about">Sobre este app / limitações</button>
    </div>
  `);

  app.querySelector("[data-action='new-session']")?.addEventListener("click", () => navigate("/instrument"));
  app.querySelector("[data-action='saved-sessions']")?.addEventListener("click", () => navigate("/sessions"));
  app.querySelector("[data-action='compare-a']")?.addEventListener("click", () => navigate("/compare-a"));
  app.querySelector("[data-action='compare-b']")?.addEventListener("click", () => navigate("/compare-b"));
  app.querySelector("[data-action='about']")?.addEventListener("click", () => navigate("/about"));
}
