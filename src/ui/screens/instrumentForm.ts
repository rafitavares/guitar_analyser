import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { generateId, listInstruments } from "../../db/storage.ts";
import { noteToFrequency } from "../../audio/noteUtils.ts";
import type { Instrument, StringTuning } from "../../types/index.ts";
import { appState } from "../../state/appState.ts";

const DEFAULT_TUNING = ["E2", "A2", "D3", "G3", "B3", "E4"]; // corda 6 -> corda 1

function buildTuning(noteNames: string[], a4Hz: number): StringTuning[] {
  return noteNames.map((noteName, idx) => ({
    stringNumber: noteNames.length - idx,
    noteName,
    frequencyHz: noteToFrequency(noteName, a4Hz),
  }));
}

export async function renderInstrumentForm(): Promise<void> {
  const existing = await listInstruments();

  const app = setApp(`
    ${renderHeader("Ficha do instrumento", "/")}
    <div class="screen">
      ${
        existing.length > 0
          ? `<div class="card">
              <label>Instrumento já cadastrado (opcional)</label>
              <select id="existing-instrument">
                <option value="">— Novo instrumento —</option>
                ${existing
                  .map((i) => `<option value="${i.id}">${i.nickname} (${i.type === "nylon" ? "Nylon" : "Aço"})</option>`)
                  .join("")}
              </select>
            </div>`
          : ""
      }

      <form id="instrument-form" class="card">
        <div class="field">
          <label>Nome/apelido do instrumento</label>
          <input name="nickname" required placeholder="ex.: Giannini clássico 2019" />
        </div>

        <div class="field">
          <label>Tipo</label>
          <select name="type">
            <option value="nylon">Nylon (clássico)</option>
            <option value="aco">Aço</option>
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Madeira do tampo</label>
            <input name="topWood" placeholder="ex.: Cedro" />
          </div>
          <div class="field">
            <label>Madeira do fundo/laterais</label>
            <input name="backSidesWood" placeholder="ex.: Jacarandá" />
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Madeira do braço</label>
            <input name="neckWood" placeholder="ex.: Mogno" />
          </div>
          <div class="field">
            <label>Madeira da escala</label>
            <input name="fretboardWood" placeholder="ex.: Ébano" />
          </div>
        </div>

        <div class="field">
          <label>Número de cordas</label>
          <input name="stringCount" type="number" min="4" max="12" value="6" />
        </div>

        <div class="field">
          <label>Afinação (corda mais grave → mais aguda)</label>
          <div id="tuning-inputs" class="grid-2"></div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Marca das cordas</label>
            <input name="stringBrand" placeholder="ex.: D'Addario" />
          </div>
          <div class="field">
            <label>Calibre</label>
            <input name="stringGauge" placeholder="ex.: Normal tension" />
          </div>
        </div>

        <div class="field">
          <label>Data da troca das cordas</label>
          <input name="stringChangeDate" type="date" />
        </div>

        <div class="field">
          <label>Afinação de referência A4 (Hz)</label>
          <input name="a4ReferenceHz" type="number" value="440" step="1" />
        </div>

        <div class="field-row">
          <div class="field">
            <label>Temperatura da sala (°C)</label>
            <input name="temperatureC" type="number" step="0.1" />
          </div>
          <div class="field">
            <label>Umidade relativa (%)</label>
            <input name="humidityPct" type="number" step="1" />
          </div>
        </div>

        <div class="field">
          <label>Observações</label>
          <textarea name="notes" rows="3" placeholder="Observações livres"></textarea>
        </div>

        <button type="submit" class="btn btn-primary" style="width:100%">Continuar → Calibração de ambiente</button>
      </form>
    </div>
  `);

  attachHeaderEvents(app);

  const form = app.querySelector<HTMLFormElement>("#instrument-form")!;
  const stringCountInput = form.elements.namedItem("stringCount") as HTMLInputElement;
  const a4Input = form.elements.namedItem("a4ReferenceHz") as HTMLInputElement;
  const tuningContainer = app.querySelector<HTMLDivElement>("#tuning-inputs")!;

  function renderTuningInputs(noteNames: string[]) {
    const count = noteNames.length;
    tuningContainer.innerHTML = Array.from({ length: count })
      .map((_, idx) => {
        const stringNumber = count - idx;
        const value = noteNames[idx] ?? "";
        return `<div class="field">
          <label>Corda ${stringNumber}</label>
          <input data-tuning-idx="${idx}" value="${value}" placeholder="ex.: E2" />
        </div>`;
      })
      .join("");
  }

  function getCurrentTuningNames(): string[] {
    return Array.from(tuningContainer.querySelectorAll<HTMLInputElement>("[data-tuning-idx]")).map(
      (i) => i.value.trim()
    );
  }

  renderTuningInputs(DEFAULT_TUNING);

  stringCountInput.addEventListener("input", () => {
    const n = Math.max(4, Math.min(12, parseInt(stringCountInput.value, 10) || 6));
    const current = getCurrentTuningNames();
    const next = Array.from({ length: n }).map((_, idx) => current[idx] ?? DEFAULT_TUNING[idx] ?? "E2");
    renderTuningInputs(next);
  });

  const existingSelect = app.querySelector<HTMLSelectElement>("#existing-instrument");
  let selectedExistingId = "";
  existingSelect?.addEventListener("change", () => {
    selectedExistingId = existingSelect.value;
    const instrument = existing.find((i) => i.id === selectedExistingId);
    if (!instrument) return;
    (form.elements.namedItem("nickname") as HTMLInputElement).value = instrument.nickname;
    (form.elements.namedItem("type") as HTMLSelectElement).value = instrument.type;
    (form.elements.namedItem("topWood") as HTMLInputElement).value = instrument.topWood;
    (form.elements.namedItem("backSidesWood") as HTMLInputElement).value = instrument.backSidesWood;
    (form.elements.namedItem("neckWood") as HTMLInputElement).value = instrument.neckWood;
    (form.elements.namedItem("fretboardWood") as HTMLInputElement).value = instrument.fretboardWood;
    stringCountInput.value = String(instrument.stringCount);
    renderTuningInputs(instrument.tuning.map((t) => t.noteName));
    (form.elements.namedItem("stringBrand") as HTMLInputElement).value = instrument.stringBrand;
    (form.elements.namedItem("stringGauge") as HTMLInputElement).value = instrument.stringGauge;
    (form.elements.namedItem("stringChangeDate") as HTMLInputElement).value = instrument.stringChangeDate;
    a4Input.value = String(instrument.a4ReferenceHz);
    (form.elements.namedItem("notes") as HTMLTextAreaElement).value = instrument.notes;
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const a4Hz = parseFloat(String(fd.get("a4ReferenceHz"))) || 440;
    const tuningNames = getCurrentTuningNames();

    const instrument: Instrument = {
      id: selectedExistingId || generateId(),
      nickname: String(fd.get("nickname") || "").trim() || "Violão sem nome",
      type: (String(fd.get("type")) as Instrument["type"]) || "nylon",
      topWood: String(fd.get("topWood") || ""),
      backSidesWood: String(fd.get("backSidesWood") || ""),
      neckWood: String(fd.get("neckWood") || ""),
      fretboardWood: String(fd.get("fretboardWood") || ""),
      stringCount: tuningNames.length,
      tuning: buildTuning(tuningNames, a4Hz),
      stringBrand: String(fd.get("stringBrand") || ""),
      stringGauge: String(fd.get("stringGauge") || ""),
      stringChangeDate: String(fd.get("stringChangeDate") || ""),
      a4ReferenceHz: a4Hz,
      notes: String(fd.get("notes") || ""),
      createdAt: new Date().toISOString(),
    };

    appState.draft = {
      instrument,
      conditions: {
        distanceCm: 30,
        roomDescription: "",
        temperatureC: fd.get("temperatureC") ? parseFloat(String(fd.get("temperatureC"))) : null,
        humidityPct: fd.get("humidityPct") ? parseFloat(String(fd.get("humidityPct"))) : null,
        measurementDate: new Date().toISOString(),
      },
      noiseFloor: appState.draft?.noiseFloor ?? null,
      session: appState.draft?.session ?? null,
    };

    navigate("/protocol");
  });
}
