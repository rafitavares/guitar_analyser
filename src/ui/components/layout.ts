import { navigate } from "../../state/router.ts";

export function renderHeader(title: string, backPath: string | null): string {
  return `
    <div class="header-bar">
      ${backPath ? `<button class="link-btn" data-back="${backPath}">‹ Voltar</button>` : "<span></span>"}
      <strong>${title}</strong>
      <span style="width:48px"></span>
    </div>
  `;
}

export function attachHeaderEvents(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.back!));
  });
}

export function progressBar(current: number, total: number, label: string): string {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return `
    <div class="progress-label">${label}</div>
    <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
  `;
}

export function statusPill(status: string): string {
  const map: Record<string, { cls: string; text: string }> = {
    aguardando: { cls: "waiting", text: "Aguardando toque…" },
    detectado: { cls: "detected", text: "Toque detectado" },
    medindo: { cls: "measuring", text: "Medindo…" },
    concluido: { cls: "valid", text: "Tomada válida ✓" },
    descartado: { cls: "discarded", text: "Tomada descartada ✗" },
  };
  const info = map[status] ?? { cls: "waiting", text: status };
  return `<span class="status-pill ${info.cls}">${info.text}</span>`;
}

export function setApp(html: string): HTMLElement {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.innerHTML = html;
  return app;
}
