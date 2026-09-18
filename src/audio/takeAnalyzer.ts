// Consolida uma captura crua (RawTakeCapture) num NoteTakeResult: sustain
// (T60 via Schroeder) + HNR (limpeza). Retrato harmônico/inarmonicidade
// foram removidos do escopo simplificado do app — o foco agora é
// sustentação e ressonância entre harmônicos.

import type { RawTakeCapture } from "./noteCapture.ts";
import { analyzeSustain } from "./sustainAnalysis.ts";
import { analyzeHnr } from "./hnrAnalysis.ts";
import type { NoteTakeResult } from "../types/index.ts";

export function analyzeTake(raw: RawTakeCapture, takeIndex: number, noiseFloorDb: number): NoteTakeResult {
  const capturedAt = new Date().toISOString();

  if (!raw.valid) {
    return {
      takeIndex,
      valid: false,
      discardReason: raw.discardReason,
      detectedFundamentalHz: raw.detectedFundamentalHz,
      peakAmplitude: raw.peakAmplitudeLinear,
      capturedAt,
    };
  }

  const sustain = analyzeSustain(raw.envelope, noiseFloorDb);
  const hnr = analyzeHnr(raw.envelope);

  return {
    takeIndex,
    valid: true,
    detectedFundamentalHz: raw.detectedFundamentalHz,
    peakAmplitude: raw.peakAmplitudeLinear,
    capturedAt,
    sustain,
    hnr,
  };
}

/** Seleciona a tomada mediana entre as válidas, usando T60 como critério de ordenação. */
export function selectMedianTakeIndex(takes: NoteTakeResult[]): number | null {
  const validIndices = takes.map((t, i) => ({ t, i })).filter(({ t }) => t.valid && t.sustain);
  if (validIndices.length === 0) return null;
  if (validIndices.length === 1) return validIndices[0]!.i;

  const sorted = [...validIndices].sort(
    (a, b) => (a.t.sustain?.t60EstimatedSec ?? 0) - (b.t.sustain?.t60EstimatedSec ?? 0)
  );
  const medianEntry = sorted[Math.floor((sorted.length - 1) / 2)]!;
  return medianEntry.i;
}
