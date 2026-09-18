import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";
import { saveInstrument, saveSession } from "../../db/storage.ts";
import { exportSessionJson, exportSessionCsv } from "../../db/exportImport.ts";

const TEST_LABELS: Record<string, string> = {
  sustain: "Sustentação (T60)",
  harmonicPortrait: "Retrato Harmônico",
  inharmonicity: "Inarmonicidade",
  beating: "Batimento",
  hnr: "Limpeza (HNR)",
  semitoneSweep: "Varredura por semitom",
};

export function renderSessionSummary(): void {
  const draft = appState.draft;
  if (!draft || !draft.session) {
    navigate("/");
    return;
  }
  const session = draft.session;
  const testsCompleted = Object.keys(session.tests);

  const app = setApp(`
    ${renderHeader("Resumo da sessão", "/tests")}
    <div class="screen">
      <div class="card">
        <h2>${session.instrumentSnapshot.nickname}</h2>
        <p>${new Date(session.createdAt).toLocaleString("pt-BR")}</p>
        <div class="tag">${session.sampleRate} Hz</div>
        <div class="tag">Protocolo v${session.protocolVersion}</div>
      </div>

      <div class="card">
        <h3>Testes realizados (${testsCompleted.length}/6)</h3>
        ${
          testsCompleted.length === 0
            ? "<p>Nenhum teste realizado ainda.</p>"
            : `<ul style="margin:0; padding-left:18px; color:var(--text-dim)">${testsCompleted
                .map((t) => `<li>${TEST_LABELS[t] ?? t}</li>`)
                .join("")}</ul>`
        }
      </div>

      <button id="save-btn" class="btn btn-primary" style="width:100%">💾 Salvar sessão</button>
      <div class="btn-row">
        <button id="export-json-btn" class="btn" style="flex:1">Exportar JSON</button>
        <button id="export-csv-btn" class="btn" style="flex:1">Exportar CSV</button>
      </div>
      <button id="more-tests-btn" class="btn" style="width:100%">Voltar e fazer mais testes</button>
      <button id="home-btn" class="btn btn-secondary" style="width:100%">Finalizar e ir para o início</button>
    </div>
  `);

  attachHeaderEvents(app);

  app.querySelector("#save-btn")?.addEventListener("click", async () => {
    const btn = app.querySelector<HTMLButtonElement>("#save-btn")!;
    btn.disabled = true;
    btn.textContent = "Salvando…";
    try {
      await saveInstrument(draft.instrument);
      await saveSession(session);
      btn.textContent = "✓ Sessão salva";
    } catch (err) {
      btn.textContent = "Erro ao salvar";
      btn.disabled = false;
      console.error(err);
    }
  });

  app.querySelector("#export-json-btn")?.addEventListener("click", () => exportSessionJson(session));
  app.querySelector("#export-csv-btn")?.addEventListener("click", () => exportSessionCsv(session));
  app.querySelector("#more-tests-btn")?.addEventListener("click", () => navigate("/tests"));
  app.querySelector("#home-btn")?.addEventListener("click", () => {
    appState.stopCapture();
    navigate("/");
  });
}
