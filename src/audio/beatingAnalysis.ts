// Detecção de batimento (beating): procura modulação periódica lenta
// (0,5-15 Hz) no envelope de amplitude da nota.

import { computeSpectrum } from "./fft.ts";
import type { EnvelopeFrame } from "./noteCapture.ts";
import type { BeatingResult } from "../types/index.ts";

const MIN_BEAT_HZ = 0.5;
const MAX_BEAT_HZ = 15;
const MIN_DEPTH_DB = 0.8; // profundidade mínima para considerar batimento real

export function analyzeBeating(envelope: EnvelopeFrame[], fundamentalHz: number): BeatingResult {
  if (envelope.length < 16) {
    return { detected: false, modulationFreqHz: null, depthDb: null, involvedFreqsHz: null };
  }

  // Reamostra o envelope (irregularmente espaçado) para um grid uniforme.
  const duration = envelope[envelope.length - 1]!.timeSec;
  if (duration < 0.6) {
    return { detected: false, modulationFreqHz: null, depthDb: null, involvedFreqsHz: null };
  }
  const gridRate = 50; // Hz de reamostragem do envelope
  const gridSize = Math.max(16, Math.floor(duration * gridRate));
  const grid = new Float64Array(gridSize);
  let envIdx = 0;
  for (let i = 0; i < gridSize; i++) {
    const t = i / gridRate;
    while (envIdx < envelope.length - 2 && envelope[envIdx + 1]!.timeSec < t) envIdx++;
    const a = envelope[envIdx]!;
    const b = envelope[Math.min(envIdx + 1, envelope.length - 1)]!;
    const span = b.timeSec - a.timeSec;
    const frac = span > 0 ? (t - a.timeSec) / span : 0;
    grid[i] = a.combEnergyDb + (b.combEnergyDb - a.combEnergyDb) * Math.max(0, Math.min(1, frac));
  }

  // Remove a tendência (decaimento geral) com uma regressão linear simples,
  // deixando apenas a oscilação em torno da reta de decaimento.
  const n = grid.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += grid[i]!;
    sumXY += i * grid[i]!;
    sumXX += i * i;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slope = denom === 0 ? 0 : (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  const detrended = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    detrended[i] = grid[i]! - (slope * i + intercept);
  }

  const fftSize = nextPow2(n);
  const padded = new Float64Array(fftSize);
  padded.set(detrended);
  const spectrum = computeSpectrum(padded, gridRate);

  // Procura o pico dominante na faixa de batimento (0.5-15Hz).
  let bestBin = -1;
  let bestMag = -Infinity;
  const lowBin = Math.max(1, Math.floor(MIN_BEAT_HZ / spectrum.binHz));
  const highBin = Math.min(
    spectrum.magnitudes.length - 1,
    Math.ceil(MAX_BEAT_HZ / spectrum.binHz)
  );
  for (let bin = lowBin; bin <= highBin; bin++) {
    const m = spectrum.magnitudes[bin]!;
    if (m > bestMag) {
      bestMag = m;
      bestBin = bin;
    }
  }

  if (bestBin < 0) {
    return { detected: false, modulationFreqHz: null, depthDb: null, involvedFreqsHz: null };
  }

  const modulationFreqHz = bestBin * spectrum.binHz;
  // Profundidade aproximada: pico a pico do sinal detrended.
  let maxV = -Infinity;
  let minV = Infinity;
  for (let i = 0; i < n; i++) {
    if (detrended[i]! > maxV) maxV = detrended[i]!;
    if (detrended[i]! < minV) minV = detrended[i]!;
  }
  const depthDb = maxV - minV;

  const detected = depthDb >= MIN_DEPTH_DB;
  const involvedFreqsHz: [number, number] | null = detected
    ? [fundamentalHz - modulationFreqHz / 2, fundamentalHz + modulationFreqHz / 2]
    : null;

  return {
    detected,
    modulationFreqHz: detected ? modulationFreqHz : null,
    depthDb: detected ? depthDb : null,
    involvedFreqsHz,
  };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
