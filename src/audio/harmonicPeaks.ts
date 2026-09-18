// Extrai picos harmônicos de um snapshot espectral de alta resolução,
// usando o pente esperado como guia e interpolação parabólica para refinar
// cada frequência.

import { parabolicPeakInterpolation } from "./fft.ts";
import { frequencyToNote, amplitudeToDb } from "./noteUtils.ts";
import type { HarmonicPeak } from "../types/index.ts";

const MAX_PARTIALS = 8;
const SEARCH_TOLERANCE = 0.05; // ±5% ao redor de n*f0 esperado

export function extractHarmonicPeaks(
  highResSpectrum: { freqHz: number; magnitude: number }[],
  fundamentalHz: number,
  a4Hz: number,
  nyquistHz: number
): HarmonicPeak[] {
  if (highResSpectrum.length < 3) return [];
  const binHz = highResSpectrum[1]!.freqHz - highResSpectrum[0]!.freqHz;
  const magnitudes = new Float64Array(highResSpectrum.map((p) => p.magnitude));

  // Estimativa robusta do piso de ruído espectral (mediana): a maioria dos
  // bins não contém energia harmônica real, então a mediana aproxima bem o
  // piso. Só aceitamos um "pico" de parcial se ele se destacar claramente
  // deste piso — caso contrário é apenas ruído de fundo sendo confundido
  // com um harmônico que na verdade não soou.
  const sortedMagnitudes = Float64Array.from(magnitudes).sort();
  const noiseFloorEstimate = sortedMagnitudes[Math.floor(sortedMagnitudes.length / 2)] ?? 1e-12;
  const PEAK_ABOVE_FLOOR_FACTOR = 5; // ~+14dB acima da mediana
  // Além do piso de ruído, um parcial só é aceito como real se tiver amplitude
  // relevante frente à fundamental — rejeita vazamento espectral (sidelobes
  // da janela de Hann) de harmônicos fortes sendo confundido com parciais
  // que na verdade não soaram.
  const MIN_RELATIVE_TO_FUNDAMENTAL = 0.003;

  const peaks: HarmonicPeak[] = [];

  function findBestBinInRange(lowBin: number, highBin: number): { bin: number; mag: number } {
    let bestBin = -1;
    let bestMag = -Infinity;
    for (let bin = lowBin; bin <= highBin; bin++) {
      const m = magnitudes[bin]!;
      if (m > bestMag) {
        bestMag = m;
        bestBin = bin;
      }
    }
    return { bin: bestBin, mag: bestMag };
  }

  function searchRangeFor(expectedHz: number): { lowBin: number; highBin: number } {
    const searchLowHz = expectedHz * (1 - SEARCH_TOLERANCE);
    const searchHighHz = expectedHz * (1 + SEARCH_TOLERANCE);
    return {
      lowBin: Math.max(0, Math.floor(searchLowHz / binHz)),
      highBin: Math.min(magnitudes.length - 1, Math.ceil(searchHighHz / binHz)),
    };
  }

  const fundamentalRange = searchRangeFor(fundamentalHz);
  const fundamentalBest = findBestBinInRange(fundamentalRange.lowBin, fundamentalRange.highBin);
  const fundamentalAmplitude = Math.max(fundamentalBest.mag, 1e-12);
  const minAcceptableMagnitude = Math.max(
    noiseFloorEstimate * PEAK_ABOVE_FLOOR_FACTOR,
    fundamentalAmplitude * MIN_RELATIVE_TO_FUNDAMENTAL
  );

  for (let partial = 1; partial <= MAX_PARTIALS; partial++) {
    const expectedHz = fundamentalHz * partial;
    if (expectedHz >= nyquistHz) break;
    const { lowBin, highBin } = searchRangeFor(expectedHz);
    const { bin: bestBin, mag: bestMag } = findBestBinInRange(lowBin, highBin);
    if (bestBin < 0) continue;
    if (bestMag < minAcceptableMagnitude) continue;

    const refined = parabolicPeakInterpolation(magnitudes, bestBin, binHz);

    const note = frequencyToNote(refined.freqHz, a4Hz);
    const inharmonicityCents = 1200 * Math.log2(refined.freqHz / expectedHz);

    peaks.push({
      partialNumber: partial,
      expectedHz,
      measuredHz: refined.freqHz,
      amplitudeDb: amplitudeToDb(refined.magnitude, fundamentalAmplitude),
      noteName: note.noteName,
      centsDeviation: note.centsDeviation,
      inharmonicityCents,
    });
  }

  return peaks;
}

export function computeSpectralCentroid(
  highResSpectrum: { freqHz: number; magnitude: number }[],
  lowHz = 60,
  highHz = 8000
): number {
  let weightedSum = 0;
  let magSum = 0;
  for (const bin of highResSpectrum) {
    if (bin.freqHz < lowHz || bin.freqHz > highHz) continue;
    weightedSum += bin.freqHz * bin.magnitude;
    magSum += bin.magnitude;
  }
  return magSum > 0 ? weightedSum / magSum : 0;
}

/**
 * Ajusta o coeficiente de inarmonicidade B do modelo de corda rígida
 * f_n = n*f0*sqrt(1 + B*n²), via busca em grade + refinamento simples
 * sobre os picos medidos.
 */
export function fitInharmonicityCoefficient(
  peaks: HarmonicPeak[],
  fundamentalHz: number
): number | null {
  const usablePeaks = peaks.filter((p) => p.partialNumber >= 2);
  if (usablePeaks.length < 2) return null;

  let bestB = 0;
  let bestError = Infinity;

  // Busca em grade log-espaçada seguida de refinamento local.
  const candidates: number[] = [];
  for (let exp = -7; exp <= -2; exp += 0.05) {
    candidates.push(Math.pow(10, exp));
  }
  candidates.unshift(0);

  for (const B of candidates) {
    let error = 0;
    for (const p of usablePeaks) {
      const predicted = p.partialNumber * fundamentalHz * Math.sqrt(1 + B * p.partialNumber ** 2);
      error += (predicted - p.measuredHz) ** 2;
    }
    if (error < bestError) {
      bestError = error;
      bestB = B;
    }
  }

  return bestB;
}
