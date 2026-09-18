// Teste de Ressonância harmônica: escuta contínua e livre — o usuário pode
// tocar uma nota isolada ou um arpejo com várias cordas juntas. O app
// detecta os harmônicos que mais se destacam no espectro (sem depender de
// nenhuma fundamental esperada) e avalia se algum par está muito próximo
// em frequência (soando "colado"/sobreposto, o que costuma ser percebido
// como aspereza/batimento) ou se estão claramente separados.

import { computeSpectrum, parabolicPeakInterpolation } from "./fft.ts";
import { frequencyToNote } from "./noteUtils.ts";
import { waitForLoudOnset } from "./loudnessGate.ts";
import type { CaptureHandle } from "./capture.ts";
import type { NoiseFloorProfile, ResonanceOverlapPair, ResonancePeak } from "../types/index.ts";

/** Pico com o dB bruto (não normalizado) também disponível, útil só para
 * posicionar o marcador no gráfico ao vivo — o que é salvo na sessão usa
 * apenas os campos de ResonancePeak (amplitude relativa ao pico mais forte). */
export interface LiveResonancePeak extends ResonancePeak {
  rawDb: number;
}

export interface ResonanceSnapshot {
  peaks: LiveResonancePeak[];
  overlaps: ResonanceOverlapPair[];
  verdict: "separado" | "sobreposto";
  totalEnergy: number;
  /** Espectro (já reduzido para poucos pontos) para desenhar o gráfico ao vivo. */
  displaySpectrum: { freqHz: number; db: number }[];
}

export type ResonanceState = "aguardando" | "capturando" | "congelado";

export interface ResonanceListenOptions {
  a4Hz: number;
  sampleRate: number;
  capture: CaptureHandle;
  noiseFloor: NoiseFloorProfile;
  onStateChange?: (state: ResonanceState) => void;
  onUpdate?: (snapshot: ResonanceSnapshot) => void;
}

export interface ResonanceController {
  stop: () => void;
  getBestSnapshot: () => ResonanceSnapshot | null;
}

const FFT_SIZE = 32768;
const POLL_INTERVAL_MS = 200;
const ONSET_WINDOW_SIZE = 4096;
/** Cada medição dura 3s e depois congela na tela, até o próximo toque acima do piso de volume. */
const CAPTURE_DURATION_MS = 3000;
const MAX_PEAKS = 10;
const MIN_FREQ_HZ = 70;
const MAX_FREQ_HZ = 4000;
const PEAK_MIN_SEPARATION_HZ = 15;
const OVERLAP_THRESHOLD_CENTS = 60; // menos de meio-tom entre picos vizinhos = "colando"
const PEAK_ABOVE_FLOOR_FACTOR = 6;
const MIN_RELATIVE_TO_STRONGEST = 0.02; // -34dB aprox.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractResonanceSnapshot(
  magnitudes: Float64Array,
  binHz: number,
  a4Hz: number
): ResonanceSnapshot {
  const lowBin = Math.max(1, Math.floor(MIN_FREQ_HZ / binHz));
  const highBin = Math.min(magnitudes.length - 2, Math.ceil(MAX_FREQ_HZ / binHz));

  const sortedMagnitudes = Float64Array.from(magnitudes.subarray(lowBin, highBin)).sort();
  const medianMag = sortedMagnitudes[Math.floor(sortedMagnitudes.length / 2)] ?? 1e-12;
  const floorThreshold = medianMag * PEAK_ABOVE_FLOOR_FACTOR;

  // Coleta todos os máximos locais acima do piso.
  const candidates: { bin: number; mag: number }[] = [];
  for (let bin = lowBin; bin <= highBin; bin++) {
    const m = magnitudes[bin]!;
    if (m < floorThreshold) continue;
    if (m > magnitudes[bin - 1]! && m > magnitudes[bin + 1]!) {
      candidates.push({ bin, mag: m });
    }
  }
  candidates.sort((a, b) => b.mag - a.mag);

  // Seleção gulosa respeitando separação mínima, para não pegar vários
  // bins do mesmo lóbulo espectral como "picos" diferentes.
  const selected: { bin: number; mag: number }[] = [];
  for (const c of candidates) {
    if (selected.length >= MAX_PEAKS) break;
    const freqHz = c.bin * binHz;
    const tooClose = selected.some((s) => Math.abs(s.bin * binHz - freqHz) < PEAK_MIN_SEPARATION_HZ);
    if (!tooClose) selected.push(c);
  }

  const strongestMag = selected.length > 0 ? Math.max(...selected.map((s) => s.mag)) : 1e-12;

  const peaks: LiveResonancePeak[] = selected
    .map((s) => {
      const refined = parabolicPeakInterpolation(magnitudes, s.bin, binHz);
      const note = frequencyToNote(refined.freqHz, a4Hz);
      const amplitudeDb = 20 * Math.log10(Math.max(refined.magnitude, 1e-12) / strongestMag);
      const rawDb = 20 * Math.log10(Math.max(refined.magnitude, 1e-12));
      return {
        freqHz: refined.freqHz,
        noteName: note.noteName,
        centsDeviation: note.centsDeviation,
        amplitudeDb,
        rawDb,
        magnitude: refined.magnitude,
      };
    })
    .filter((p) => p.magnitude / strongestMag >= MIN_RELATIVE_TO_STRONGEST)
    .sort((a, b) => a.freqHz - b.freqHz)
    .map(({ magnitude: _magnitude, ...rest }) => rest);

  const overlaps: ResonanceOverlapPair[] = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    const centsApart = 1200 * Math.log2(peaks[i + 1]!.freqHz / peaks[i]!.freqHz);
    if (centsApart < OVERLAP_THRESHOLD_CENTS) {
      overlaps.push({ peakAIndex: i, peakBIndex: i + 1, centsApart });
    }
  }

  const totalEnergy = selected.reduce((acc, s) => acc + s.mag * s.mag, 0);

  const DISPLAY_POINTS = 400;
  const step = Math.max(1, Math.floor((highBin - lowBin) / DISPLAY_POINTS));
  const displaySpectrum: { freqHz: number; db: number }[] = [];
  for (let bin = lowBin; bin <= highBin; bin += step) {
    displaySpectrum.push({ freqHz: bin * binHz, db: 20 * Math.log10(Math.max(magnitudes[bin]!, 1e-9)) });
  }

  return {
    peaks,
    overlaps,
    verdict: overlaps.length > 0 ? "sobreposto" : "separado",
    totalEnergy,
    displaySpectrum,
  };
}

/**
 * Ciclo automático: espera o som ficar claramente acima do piso de ruído
 * (+5dB), captura e analisa por 3 segundos, depois CONGELA o resultado na
 * tela — e assim que o usuário tocar de novo acima do piso, inicia sozinho
 * uma nova medição, substituindo a anterior. Nenhum botão precisa ser
 * apertado entre medições.
 */
export function startResonanceListening(options: ResonanceListenOptions): ResonanceController {
  const { a4Hz, sampleRate, capture, noiseFloor, onStateChange, onUpdate } = options;
  let aborted = false;
  let lastSnapshot: ResonanceSnapshot | null = null;

  async function loop() {
    await capture.ensureRunning();
    while (!aborted) {
      onStateChange?.("aguardando");
      const onsetDetected = await waitForLoudOnset(capture, noiseFloor, ONSET_WINDOW_SIZE, () => aborted);
      if (aborted || !onsetDetected) break;

      onStateChange?.("capturando");
      const deadline = performance.now() + CAPTURE_DURATION_MS;
      let windowBest: ResonanceSnapshot | null = null;

      while (!aborted && performance.now() < deadline) {
        const samples = capture.getLatestSamples(FFT_SIZE);
        const spectrum = computeSpectrum(samples, sampleRate);
        const snapshot = extractResonanceSnapshot(spectrum.magnitudes, spectrum.binHz, a4Hz);
        onUpdate?.(snapshot);
        if (snapshot.peaks.length > 0 && (!windowBest || snapshot.totalEnergy > windowBest.totalEnergy)) {
          windowBest = snapshot;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (aborted) break;

      if (windowBest) {
        lastSnapshot = windowBest;
        onUpdate?.(windowBest);
      }
      onStateChange?.("congelado");
      // Volta ao topo do laço e espera o próximo toque — sem exigir clique.
    }
  }

  void loop();

  return {
    stop: () => {
      aborted = true;
    },
    getBestSnapshot: () => lastSnapshot,
  };
}
