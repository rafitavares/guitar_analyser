// Pente harmônico esperado: dado um f0 esperado, calcula as bandas estreitas
// em torno de cada parcial e mede energia apenas nelas. Isso é o mecanismo
// central de rejeição de ruído/voz: sinais de banda larga (fala, ruído de loja)
// não concentram energia nesses bins estreitos.

import type { SpectrumResult } from "./fft.ts";

export interface HarmonicBand {
  partialNumber: number;
  centerHz: number;
  lowHz: number;
  highHz: number;
  lowBin: number;
  highBin: number;
}

const BAND_TOLERANCE = 0.03; // ±3%
const MAX_PARTIALS = 8;

export function buildHarmonicComb(
  f0Hz: number,
  binHz: number,
  nyquistHz: number,
  maxPartials = MAX_PARTIALS
): HarmonicBand[] {
  const bands: HarmonicBand[] = [];
  for (let p = 1; p <= maxPartials; p++) {
    const centerHz = f0Hz * p;
    if (centerHz >= nyquistHz) break;
    const lowHz = centerHz * (1 - BAND_TOLERANCE);
    const highHz = centerHz * (1 + BAND_TOLERANCE);
    bands.push({
      partialNumber: p,
      centerHz,
      lowHz,
      highHz,
      lowBin: Math.max(0, Math.floor(lowHz / binHz)),
      highBin: Math.ceil(highHz / binHz),
    });
  }
  return bands;
}

/** Energia (soma de magnitude²) dentro das bandas do pente harmônico. */
export function energyInComb(spectrum: SpectrumResult, comb: HarmonicBand[]): number {
  const { magnitudes } = spectrum;
  let energy = 0;
  for (const band of comb) {
    const hi = Math.min(band.highBin, magnitudes.length - 1);
    for (let bin = band.lowBin; bin <= hi; bin++) {
      const m = magnitudes[bin]!;
      energy += m * m;
    }
  }
  return energy;
}

/** Energia total do espectro (banda útil, ex.: 60Hz a 8kHz). */
export function energyInRange(
  spectrum: SpectrumResult,
  lowHz: number,
  highHz: number
): number {
  const { magnitudes, binHz } = spectrum;
  const lowBin = Math.max(0, Math.floor(lowHz / binHz));
  const highBin = Math.min(magnitudes.length - 1, Math.ceil(highHz / binHz));
  let energy = 0;
  for (let bin = lowBin; bin <= highBin; bin++) {
    const m = magnitudes[bin]!;
    energy += m * m;
  }
  return energy;
}

/** Energia fora do pente harmônico, mas dentro da banda útil (para HNR). */
export function energyOutsideComb(
  spectrum: SpectrumResult,
  comb: HarmonicBand[],
  lowHz: number,
  highHz: number
): number {
  const total = energyInRange(spectrum, lowHz, highHz);
  const inComb = energyInComb(spectrum, comb);
  return Math.max(0, total - inComb);
}

/**
 * Encontra o pico de magnitude refinado dentro de uma banda harmônica.
 * Retorna null se não houver energia significativa acima do piso de ruído.
 */
export function findPeakInBand(
  spectrum: SpectrumResult,
  band: HarmonicBand,
  noiseFloorLinear: number
): { bin: number; magnitude: number } | null {
  const { magnitudes } = spectrum;
  let bestBin = -1;
  let bestMag = -Infinity;
  const hi = Math.min(band.highBin, magnitudes.length - 1);
  for (let bin = band.lowBin; bin <= hi; bin++) {
    const m = magnitudes[bin]!;
    if (m > bestMag) {
      bestMag = m;
      bestBin = bin;
    }
  }
  if (bestBin < 0 || bestMag < noiseFloorLinear * 2) return null;
  return { bin: bestBin, magnitude: bestMag };
}
