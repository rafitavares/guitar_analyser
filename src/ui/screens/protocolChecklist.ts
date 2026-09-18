import { navigate } from "../../state/router.ts";
import { setApp, renderHeader, attachHeaderEvents } from "../components/layout.ts";
import { appState } from "../../state/appState.ts";

const CHECKLIST_ITEMS = [
  "Distância do celular à boca do violão fixada em ~30cm (considere marcar com fita)",
  "Sala o mais 'morta' possível (pouco eco)",
  "Mesma corda / calibre / idade relativa usada em medições anteriores deste instrumento",
  "Você tocará com força consistente em todas as tomadas",
];

export function renderProtocolChecklist(): void {
  if (!appState.draft) {
    navigate("/instrument");
    return;
  }

  const app = setApp(`
    ${renderHeader("Protocolo de captura", "/instrument")}
    <div class="screen">
      <div class="notice notice-info">
        A comparação no tempo só funciona se a captura for consistente entre sessões. Siga o checklist abaixo.
      </div>

      <div class="card">
        ${CHECKLIST_ITEMS.map(
          (item, i) => `<div class="checklist-item">
            <input type="checkbox" id="chk-${i}" />
            <label for="chk-${i}" style="margin:0; color:var(--text)">${item}</label>
          </div>`
        ).join("")}
      </div>

      <div class="card">
        <div class="field">
          <label>Distância do microfone (cm)</label>
          <input id="distance" type="number" value="30" />
        </div>
        <div class="field">
          <label>Descrição da sala</label>
          <input id="room" placeholder="ex.: quarto pequeno, sofá e cortinas" />
        </div>
      </div>

      <button id="continue-btn" class="btn btn-primary" style="width:100%" disabled>Continuar → Calibração</button>
    </div>
  `);

  attachHeaderEvents(app);

  const checkboxes = app.querySelectorAll<HTMLInputElement>(".checklist-item input");
  const continueBtn = app.querySelector<HTMLButtonElement>("#continue-btn")!;

  function updateState() {
    const allChecked = Array.from(checkboxes).every((c) => c.checked);
    continueBtn.disabled = !allChecked;
  }
  checkboxes.forEach((c) => c.addEventListener("change", updateState));

  continueBtn.addEventListener("click", () => {
    if (!appState.draft) return;
    appState.draft.conditions.distanceCm =
      parseFloat((app.querySelector("#distance") as HTMLInputElement).value) || 30;
    appState.draft.conditions.roomDescription = (app.querySelector("#room") as HTMLInputElement).value;
    navigate("/calibration");
  });
}
