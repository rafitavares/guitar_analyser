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
  const rows: string[][] = [
    ["corda", "nota", "T60 (s)", "centroide (Hz)", "HNR (dB)", "inarmonicidade B", "batimento (Hz)"],
  ];

  const sustainByNote = new Map<string, number>();
  session.tests.sustain?.measurements.forEach((m) => {
    const take = m.takes[m.medianTakeIndex ?? -1];
    if (take?.sustain) sustainByNote.set(`${m.stringNumber}-${m.fret}`, take.sustain.t60EstimatedSec);
  });

  const centroidByNote = new Map<string, number>();
  session.tests.harmonicPortrait?.measurements.forEach((m) => {
    const take = m.takes[m.medianTakeIndex ?? -1];
    if (take?.portrait) centroidByNote.set(`${m.stringNumber}-${m.fret}`, take.portrait.spectralCentroidHz);
  });

  const hnrByNote = new Map<string, number>();
  session.tests.hnr?.measurements.forEach((m) => {
    const take = m.takes[m.medianTakeIndex ?? -1];
    if (take?.hnr) hnrByNote.set(`${m.stringNumber}-${m.fret}`, take.hnr.hnrDb);
  });

  const inharmByNote = new Map<string, number | null>();
  session.tests.inharmonicity?.measurements.forEach((m) => {
    const take = m.takes[m.medianTakeIndex ?? -1];
    if (take?.inharmonicity) inharmByNote.set(`${m.stringNumber}-${m.fret}`, take.inharmonicity.bCoefficient);
  });

  const beatingByNote = new Map<string, number | null>();
  session.tests.beating?.measurements.forEach((m) => {
    const take = m.takes[m.medianTakeIndex ?? -1];
    if (take?.beating) beatingByNote.set(`${m.stringNumber}-${m.fret}`, take.beating.modulationFreqHz);
  });

  const allKeys = new Set<string>([
    ...sustainByNote.keys(),
    ...centroidByNote.keys(),
    ...hnrByNote.keys(),
    ...inharmByNote.keys(),
    ...beatingByNote.keys(),
  ]);

  const measurementsIndex = new Map<string, { stringNumber: number; noteName: string }>();
  for (const test of Object.values(session.tests)) {
    test?.measurements.forEach((m) => {
      measurementsIndex.set(`${m.stringNumber}-${m.fret}`, {
        stringNumber: m.stringNumber,
        noteName: m.noteName,
      });
    });
  }

  const sortedKeys = Array.from(allKeys).sort((a, b) => {
    const ma = measurementsIndex.get(a);
    const mb = measurementsIndex.get(b);
    return (ma?.stringNumber ?? 0) - (mb?.stringNumber ?? 0);
  });

  for (const key of sortedKeys) {
    const info = measurementsIndex.get(key);
    rows.push([
      String(info?.stringNumber ?? ""),
      info?.noteName ?? "",
      sustainByNote.has(key) ? sustainByNote.get(key)!.toFixed(2) : "",
      centroidByNote.has(key) ? centroidByNote.get(key)!.toFixed(0) : "",
      hnrByNote.has(key) ? hnrByNote.get(key)!.toFixed(1) : "",
      inharmByNote.get(key) != null ? inharmByNote.get(key)!.toExponential(2) : "",
      beatingByNote.get(key) != null ? beatingByNote.get(key)!.toFixed(2) : "",
    ]);
  }

  const csv = rows.map((r) => r.map((c) => csvEscape(c)).join(",")).join("\n");
  const filename = `${session.instrumentSnapshot.nickname}_${session.createdAt.slice(0, 10)}.csv`;
  downloadFile(filename, csv, "text/csv");
}
