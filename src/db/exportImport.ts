import type { SavedTestResult } from "../types/index.ts";

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

export function exportResultJson(result: SavedTestResult): void {
  const filename = `${result.instrumentName || "instrumento"}_${result.testKind}_${result.createdAt.slice(0, 10)}.json`;
  downloadFile(filename, JSON.stringify(result, null, 2), "application/json");
}

function csvEscape(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportResultCsv(result: SavedTestResult): void {
  const rows: string[][] = [];

  if (result.testKind === "sustain" && result.sustain) {
    rows.push(["tempo (s)", "dB"]);
    for (const p of result.sustain.decayCurve) rows.push([p.timeSec.toFixed(3), p.db.toFixed(2)]);
    rows.push([]);
    rows.push(["T60 estimado (s)", result.sustain.t60EstimatedSec.toFixed(2)]);
    rows.push(["método", result.sustain.method]);
  }

  if (result.testKind === "volume" && result.volume) {
    rows.push(["canal", "pico (dB)", "final (dB)"]);
    for (const c of result.volume.channels) rows.push([c.channelLabel, c.peakDb.toFixed(1), c.finalDb.toFixed(1)]);
  }

  if (result.testKind === "harmonics" && result.harmonics) {
    rows.push(["harmônico (Hz)", "nota", "cents", "amplitude (dB)"]);
    for (const p of result.harmonics.peaks) {
      rows.push([p.freqHz.toFixed(1), p.noteName, p.centsDeviation.toFixed(0), p.amplitudeDb.toFixed(1)]);
    }
  }

  const csv = rows.map((r) => r.map((c) => csvEscape(c)).join(",")).join("\n");
  const filename = `${result.instrumentName || "instrumento"}_${result.testKind}_${result.createdAt.slice(0, 10)}.csv`;
  downloadFile(filename, csv, "text/csv");
}
