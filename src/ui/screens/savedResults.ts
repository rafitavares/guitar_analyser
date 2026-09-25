import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { listResults, deleteResult } from "../../db/storage.ts";
import { exportResultJson, exportResultCsv } from "../../db/exportImport.ts";
import type { SavedTestResult, TestKind } from "../../types/index.ts";

const KIND_LABELS: Record<TestKind, string> = {
  sustain: "Sustentação",
  volume: "Volume",
  harmonics: "Harmônicos",
};

function summarize(r: SavedTestResult): string {
  if (r.testKind === "sustain" && r.sustain) return `T60 ≈ ${r.sustain.t60EstimatedSec.toFixed(2)}s`;
  if (r.testKind === "volume" && r.volume) {
    return r.volume.channels.map((c) => `${c.channelLabel}: pico ${c.peakDb.toFixed(1)}dB`).join(" · ");
  }
  if (r.testKind === "harmonics" && r.harmonics) {
    return `${r.harmonics.noteLabel || "sem rótulo"} · ${r.harmonics.peaks.length} harmônicos`;
  }
  return "";
}

export async function renderSavedResults(): Promise<void> {
  const results = await listResults();

  const app = setApp(`
    ${renderHeader("Resultados salvos", "/")}
    <div class="screen">
      ${
        results.length === 0
          ? `<div class="card center-text"><p>Nenhum resultado salvo ainda.</p></div>`
          : results
              .map(
                (r) => `<div class="card" data-result="${r.id}">
                  <div class="tag">${KIND_LABELS[r.testKind]}</div>
                  <strong style="display:block; margin-top:6px">${r.instrumentName || "(sem nome)"}</strong>
                  <p style="margin:4px 0">${new Date(r.createdAt).toLocaleString("pt-BR")}</p>
                  <p style="margin:0 0 8px 0; color:var(--text-dim); font-size:0.9rem">${summarize(r)}</p>
                  <div class="btn-row">
                    <button class="btn" data-json="${r.id}" style="flex:1">JSON</button>
                    <button class="btn" data-csv="${r.id}" style="flex:1">CSV</button>
                    <button class="btn btn-danger" data-delete="${r.id}" style="flex:1">Excluir</button>
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
      const r = results.find((x) => x.id === btn.dataset.json);
      if (r) exportResultJson(r);
    });
  });
  app.querySelectorAll<HTMLButtonElement>("[data-csv]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = results.find((x) => x.id === btn.dataset.csv);
      if (r) exportResultCsv(r);
    });
  });
  app.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Excluir este resultado salvo? Esta ação não pode ser desfeita.")) return;
      await deleteResult(btn.dataset.delete!);
      renderSavedResults();
    });
  });
}
