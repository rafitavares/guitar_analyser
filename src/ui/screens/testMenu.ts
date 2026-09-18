import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { generateId } from "../../db/storage.ts";
import { PROTOCOL_VERSION } from "../../types/index.ts";
import type { Session } from "../../types/index.ts";

const TESTS: { id: "sustain" | "resonance"; title: string; description: string }[] = [
  { id: "sustain", title: "🎵 Sustentação", description: "Quanto tempo cada corda permanece soando" },
  { id: "resonance", title: "🎸 Ressonância harmônica", description: "Quais harmônicos se destacam e se estão colando" },
];

export function renderTestMenu(): void {
  if (!appState.draft || !appState.draft.noiseFloor) {
    navigate("/instrument");
    return;
  }

  if (!appState.draft.session) {
    const session: Session = {
      id: generateId(),
      instrumentId: appState.draft.instrument.id,
      instrumentSnapshot: appState.draft.instrument,
      conditions: appState.draft.conditions,
      noiseFloor: appState.draft.noiseFloor,
      sampleRate: appState.capture?.sampleRate ?? 44100,
      protocolVersion: PROTOCOL_VERSION,
      tests: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appState.draft.session = session;
  }

  const session = appState.draft.session;

  const app = setApp(`
    ${renderHeader("Menu de testes", "/calibration")}
    <div class="screen">
      <div class="card">
        <strong>${session.instrumentSnapshot.nickname}</strong>
        <p style="margin-top:4px">Escolha um teste. Os dois são de escuta contínua — toque livremente, sem precisar apertar botão a cada nota.</p>
      </div>

      ${TESTS.map((t) => {
        const done = Boolean(session.tests[t.id]);
        return `<div class="card" data-test="${t.id}" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
          <div>
            <strong>${t.title}</strong>
            <p style="margin:2px 0 0 0; font-size:0.85rem">${t.description}</p>
          </div>
          <span class="tag" style="${done ? "color:var(--good); border-color:var(--good)" : ""}">${done ? "✓ feito" : "→"}</span>
        </div>`;
      }).join("")}

      <button id="finish-btn" class="btn btn-primary" style="width:100%">Finalizar sessão / Ver resumo</button>
    </div>
  `);

  attachHeaderEvents(app);

  app.querySelectorAll<HTMLDivElement>("[data-test]").forEach((card) => {
    card.addEventListener("click", () => navigate(`/test/${card.dataset.test}`));
  });

  app.querySelector("#finish-btn")?.addEventListener("click", () => navigate("/summary"));
}
