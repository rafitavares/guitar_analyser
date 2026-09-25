// Motor do Teste 3 (Harmônicos): espectro ao vivo enquanto a nota selecionada
// é tocada, mantendo um envelope de "peak-hold" — o valor máximo já
// observado em cada bin de frequência — que fica fixo no gráfico como uma
// linha, igual a um medidor de pico de analisador de espectro. Os
// harmônicos detectados vêm desse envelope fixo, não do instante ao vivo.

import { computeSpectrum, parabolicPeakInterpolation } from "./fft.ts";
import { frequencyToNote } from "./noteUtils.ts";
import type { CaptureHandle } from "./capture.ts";
import type { HarmonicPeakResult } from "../types/index.ts";

export interface HarmonicsSnapshot {
  liveSpectrum: { freqHz: number; db: number }[];
  peakHoldSpectrum: { freqHz: number; db: number }[];
  peaks: HarmonicPeakResult[];
}

export interface HarmonicsRunOptions {
  a4Hz: number;
  sampleRate: number;
  capture: CaptureHandle;
  onUpdate?: (snapshot: HarmonicsSnapshot) => void;
  pollIntervalMs?: number;
}

export interface HarmonicsRunController {
  stop: () => void;
  reset: () => void;
  getElapsedSec: () => number;
}

const FFT_SIZE = 32768;
const POLL_INTERVAL_MS = 150;
const MIN_FREQ_HZ = 60;
const MAX_FREQ_HZ = 4000;
const MAX_PEAKS = 12;
const PEAK_MIN_SEPARATION_HZ = 15;
const PEAK_ABOVE_FLOOR_FACTOR = 6;
const MIN_RELATIVE_TO_STRONGEST = 0.02; // -34dB aprox.
const DISPLAY_POINTS = 400;
const FLOOR_MAGNITUDE = 1e-9;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectPeaks(magnitudes: Float64Array, binHz: number, a4Hz: number): HarmonicPeakResult[] {
  const lowBin = Math.max(1, Math.floor(MIN_FREQ_HZ / binHz));
  const highBin = Math.min(magnitudes.length - 2, Math.ceil(MAX_FREQ_HZ / binHz));

  const sortedMagnitudes = Float64Array.from(magnitudes.subarray(lowBin, highBin)).sort();
  const medianMag = sortedMagnitudes[Math.floor(sortedMagnitudes.length / 2)] ?? 1e-12;
  const floorThreshold = medianMag * PEAK_ABOVE_FLOOR_FACTOR;

  const candidates: { bin: number; mag: number }[] = [];
  for (let bin = lowBin; bin <= highBin; bin++) {
    const m = magnitudes[bin]!;
    if (m < floorThreshold) continue;
    if (m > magnitudes[bin - 1]! && m > magnitudes[bin + 1]!) {
      candidates.push({ bin, mag: m });
    }
  }
  candidates.sort((a, b) => b.mag - a.mag);

  const selected: { bin: number; mag: number }[] = [];
  for (const c of candidates) {
    if (selected.length >= MAX_PEAKS) break;
    const freqHz = c.bin * binHz;
    const tooClose = selected.some((s) => Math.abs(s.bin * binHz - freqHz) < PEAK_MIN_SEPARATION_HZ);
    if (!tooClose) selected.push(c);
  }

  const strongestMag = selected.length > 0 ? Math.max(...selected.map((s) => s.mag)) : 1e-12;

  return selected
    .map((s) => {
      const refined = parabolicPeakInterpolation(magnitudes, s.bin, binHz);
      const note = frequencyToNote(refined.freqHz, a4Hz);
      const amplitudeDb = 20 * Math.log10(Math.max(refined.magnitude, 1e-12) / strongestMag);
      return { freqHz: refined.freqHz, noteName: note.noteName, centsDeviation: note.centsDeviation, amplitudeDb, magnitude: refined.magnitude };
    })
    .filter((p) => p.magnitude / strongestMag >= MIN_RELATIVE_TO_STRONGEST)
    .sort((a, b) => a.freqHz - b.freqHz)
    .map(({ magnitude: _magnitude, ...rest }) => rest);
}

function toDisplaySpectrum(
  magnitudes: Float64Array,
  binHz: number,
  lowBin: number,
  highBin: number
): { freqHz: number; db: number }[] {
  const step = Math.max(1, Math.floor((highBin - lowBin) / DISPLAY_POINTS));
  const out: { freqHz: number; db: number }[] = [];
  for (let bin = lowBin; bin <= highBin; bin += step) {
    out.push({ freqHz: bin * binHz, db: 20 * Math.log10(Math.max(magnitudes[bin]!, 1e-9)) });
  }
  return out;
}

export function startHarmonicsListening(options: HarmonicsRunOptions): HarmonicsRunController {
  const { a4Hz, sampleRate, capture, onUpdate, pollIntervalMs = POLL_INTERVAL_MS } = options;
  let aborted = false;
  const startTime0 = performance.now();
  let startTime = startTime0;
  const binHz = sampleRate / FFT_SIZE;
  const lowBin = Math.max(1, Math.floor(MIN_FREQ_HZ / binHz));
  const highBin = Math.min(FFT_SIZE / 2 - 2, Math.ceil(MAX_FREQ_HZ / binHz));
  let peakHold = new Float64Array(FFT_SIZE / 2).fill(FLOOR_MAGNITUDE);

  async function loop() {
    await capture.ensureRunning();
    while (!aborted) {
      const samples = capture.getLatestSamples(FFT_SIZE);
      const spectrum = computeSpectrum(samples, sampleRate);
      for (let i = 0; i < spectrum.magnitudes.length; i++) {
        if (spectrum.magnitudes[i]! > peakHold[i]!) peakHold[i] = spectrum.magnitudes[i]!;
      }
      const peaks = detectPeaks(peakHold, binHz, a4Hz);
      onUpdate?.({
        liveSpectrum: toDisplaySpectrum(spectrum.magnitudes, binHz, lowBin, highBin),
        peakHoldSpectrum: toDisplaySpectrum(peakHold, binHz, lowBin, highBin),
        peaks,
      });
      await sleep(pollIntervalMs);
    }
  }

  void loop();

  return {
    stop: () => {
      aborted = true;
    },
    reset: () => {
      peakHold = new Float64Array(FFT_SIZE / 2).fill(FLOOR_MAGNITUDE);
      startTime = performance.now();
    },
    getElapsedSec: () => (performance.now() - startTime) / 1000,
  };
}
