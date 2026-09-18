// Consolida uma captura crua (RawTakeCapture) em um NoteTakeResult completo,
// calculando todas as métricas derivadas (sustain, retrato harmônico,
// inarmonicidade, batimento, HNR) de uma só vez.

import type { RawTakeCapture } from "./noteCapture.ts";
import { analyzeSustain } from "./sustainAnalysis.ts";
import { extractHarmonicPeaks, computeSpectralCentroid, fitInharmonicityCoefficient } from "./harmonicPeaks.ts";
import { analyzeBeating } from "./beatingAnalysis.ts";
import { analyzeHnr } from "./hnrAnalysis.ts";
import type { NoteTakeResult } from "../types/index.ts";

export function analyzeTake(
  raw: RawTakeCapture,
  takeIndex: number,
  a4Hz: number,
  noiseFloorDb: number
): NoteTakeResult {
  if (!raw.valid) {
    return {
      takeIndex,
      valid: false,
      discardReason: raw.discardReason,
      detectedFundamentalHz: raw.detectedFundamentalHz,
      peakAmplitude: raw.peakAmplitudeLinear,
    };
  }

  const nyquist = raw.sampleRate / 2;
  const fundamentalHz = raw.detectedFundamentalHz || raw.expectedFundamentalHz;

  const sustain = analyzeSustain(raw.envelope, noiseFloorDb);

  let portrait: NoteTakeResult["portrait"];
  let inharmonicity: NoteTakeResult["inharmonicity"];
  if (raw.highResSpectrum) {
    const peaks = extractHarmonicPeaks(raw.highResSpectrum, fundamentalHz, a4Hz, nyquist);
    const spectralCentroidHz = computeSpectralCentroid(raw.highResSpectrum);
    portrait = {
      fundamentalHz,
      spectralCentroidHz,
      peaks,
      spectrumSnapshot: raw.highResSpectrum
        .filter((p) => p.freqHz <= 5000)
        .map((p) => ({ freqHz: p.freqHz, db: 20 * Math.log10(Math.max(p.magnitude, 1e-9)) })),
    };
    const bCoefficient = fitInharmonicityCoefficient(peaks, fundamentalHz);
    inharmonicity = { peaks, bCoefficient };
  }

  const beating = analyzeBeating(raw.envelope, fundamentalHz);
  const hnr = analyzeHnr(raw.envelope);
  const rawEnvelope = raw.envelope.map((f) => ({ timeSec: f.timeSec, db: f.combEnergyDb }));

  return {
    takeIndex,
    valid: true,
    detectedFundamentalHz: fundamentalHz,
    peakAmplitude: raw.peakAmplitudeLinear,
    rawEnvelope,
    sustain,
    portrait,
    inharmonicity,
    beating,
    hnr,
  };
}

/** Seleciona a tomada mediana entre as válidas, usando T60 como critério de ordenação. */
export function selectMedianTakeIndex(takes: NoteTakeResult[]): number | null {
  const validIndices = takes
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.valid && t.sustain);
  if (validIndices.length === 0) return null;
  if (validIndices.length === 1) return validIndices[0]!.i;

  const sorted = [...validIndices].sort(
    (a, b) => (a.t.sustain?.t60EstimatedSec ?? 0) - (b.t.sustain?.t60EstimatedSec ?? 0)
  );
  const medianEntry = sorted[Math.floor((sorted.length - 1) / 2)]!;
  return medianEntry.i;
}
