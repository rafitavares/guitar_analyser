import type { Session } from "../types/index.ts";

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportSessionJson(session: Session): void {
  const filename = `${session.instrumentSnapshot.nickname}_${session.createdAt.slice(0, 10)}.json`;
  downloadFile(filename, JSON.stringify(session, null, 2), "application/json");
}

export async function parseSessionJsonFile(file: File): Promise<Session> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Session;
  if (!parsed.id || !parsed.instrumentSnapshot) {
    throw new Error("Arquivo JSON não parece ser uma sessão válida.");
  }
  return parsed;
}

function csvEscape(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportSessionCsv(session: Session): void {
  const blocks: string[][][] = [];

  if (session.tests.sustain) {
    const sustainRows: string[][] = [["corda", "nota", "T60 (s)", "HNR (dB)", "tomadas válidas"]];
    for (const m of [...session.tests.sustain.strings].sort((a, b) => b.stringNumber - a.stringNumber)) {
      const take = m.medianTakeIndex !== null ? m.takes[m.medianTakeIndex] : null;
      sustainRows.push([
        String(m.stringNumber),
        m.noteName,
        take?.sustain ? take.sustain.t60EstimatedSec.toFixed(2) : "",
        take?.hnr ? take.hnr.hnrDb.toFixed(1) : "",
        String(m.takes.filter((t) => t.valid).length),
      ]);
    }
    blocks.push(sustainRows);
  }

  if (session.tests.resonance) {
    const r = session.tests.resonance;
    const resonanceRows: string[][] = [["harmônicos detectados (Hz)", "nota", "cents", "amplitude (dB)"]];
    for (const p of r.peaks) {
      resonanceRows.push([p.freqHz.toFixed(1), p.noteName, p.centsDeviation.toFixed(0), p.amplitudeDb.toFixed(1)]);
    }
    resonanceRows.push([]);
    resonanceRows.push(["veredito", r.verdict === "sobreposto" ? "harmônicos se sobrepondo" : "harmônicos bem separados"]);
    blocks.push(resonanceRows);
  }

  const csv = blocks
    .map((rows) => rows.map((r) => r.map((c) => csvEscape(c)).join(",")).join("\n"))
    .join("\n\n");
  const filename = `${session.instrumentSnapshot.nickname}_${session.createdAt.slice(0, 10)}.csv`;
  downloadFile(filename, csv, "text/csv");
}
