import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { listSessions, deleteSession } from "../../db/storage.ts";
import { exportSessionJson, exportSessionCsv, parseSessionJsonFile } from "../../db/exportImport.ts";
import { saveSession, saveInstrument } from "../../db/storage.ts";

export async function renderSavedSessions(): Promise<void> {
  const sessions = await listSessions();

  const app = setApp(`
    ${renderHeader("Sessões salvas", "/")}
    <div class="screen">
      <div class="card">
        <label>Importar sessão (JSON)</label>
        <input id="import-input" type="file" accept="application/json" />
      </div>

      ${
        sessions.length === 0
          ? `<div class="card center-text"><p>Nenhuma sessão salva ainda.</p></div>`
          : sessions
              .map(
                (s) => `<div class="card" data-session="${s.id}">
                  <strong>${s.instrumentSnapshot.nickname}</strong>
                  <p style="margin:4px 0">${new Date(s.createdAt).toLocaleString("pt-BR")} · ${Object.keys(s.tests).length} teste(s)</p>
                  <div class="btn-row">
                    <button class="btn" data-json="${s.id}" style="flex:1">JSON</button>
                    <button class="btn" data-csv="${s.id}" style="flex:1">CSV</button>
                    <button class="btn btn-danger" data-delete="${s.id}" style="flex:1">Excluir</button>
                  </div>
                </div>`
              )
              .join("")
      }
    </div>
  `);

  attachHeaderEvents(app);

  app.querySelectorAll<HTMLButtonElement>("[data-json]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = sessions.find((x) => x.id === btn.dataset.json);
      if (s) exportSessionJson(s);
    });
  });
  app.querySelectorAll<HTMLButtonElement>("[data-csv]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = sessions.find((x) => x.id === btn.dataset.csv);
      if (s) exportSessionCsv(s);
    });
  });
  app.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir esta sessão salva? Esta ação não pode ser desfeita.")) return;
      await deleteSession(btn.dataset.delete!);
      renderSavedSessions();
    });
  });

  const importInput = app.querySelector<HTMLInputElement>("#import-input")!;
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const session = await parseSessionJsonFile(file);
      await saveInstrument(session.instrumentSnapshot);
      await saveSession(session);
      renderSavedSessions();
    } catch (err) {
      alert(`Falha ao importar: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
