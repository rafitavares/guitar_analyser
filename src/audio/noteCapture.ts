// Orquestra a captura de "uma tocada" de uma corda/nota: espera o ataque
// (via casamento com o pente harmônico esperado), rastreia o envelope de
// decaimento, e captura um snapshot de alta resolução para análise espectral.

import { computeSpectrum, parabolicPeakInterpolation } from "./fft.ts";
import { buildHarmonicComb, energyInComb, energyInRange, energyOutsideComb } from "./harmonicComb.ts";
import type { HarmonicBand } from "./harmonicComb.ts";
import type { CaptureHandle } from "./capture.ts";
import type { NoiseFloorProfile } from "../types/index.ts";

export type CaptureStatus = "aguardando" | "detectado" | "medindo" | "concluido" | "descartado";

export interface EnvelopeFrame {
  timeSec: number;
  combEnergyDb: number;
  outsideEnergyDb: number;
}

export interface RawTakeCapture {
  valid: boolean;
  discardReason?: string;
  detectedFundamentalHz: number;
  expectedFundamentalHz: number;
  peakAmplitudeLinear: number;
  envelope: EnvelopeFrame[];
  highResSpectrum: { freqHz: number; magnitude: number }[] | null;
  sampleRate: number;
  comb: HarmonicBand[];
}

export interface NoteCaptureOptions {
  expectedFundamentalHz: number;
  a4Hz: number;
  sampleRate: number;
  capture: CaptureHandle;
  noiseFloor: NoiseFloorProfile;
  onStatusChange?: (status: CaptureStatus) => void;
  onEnvelopeUpdate?: (frame: EnvelopeFrame) => void;
  /** Espectro ao vivo (resolução moderada) emitido durante espera/medição, para visualização. */
  onLiveSpectrum?: (spectrum: { freqHz: number; magnitude: number }[]) => void;
  /** Timeout esperando o ataque, em ms */
  attackTimeoutMs?: number;
  /** Duração máxima de rastreamento do decaimento, em ms */
  maxDecayMs?: number;
}

const ENVELOPE_FFT_SIZE = 8192;
const HIGH_RES_FFT_SIZE = 32768;
const POLL_INTERVAL_MS = 45;
const ATTACK_MARGIN_DB = 12; // margem acima do piso de ruído para considerar ataque
const USEFUL_BAND_LOW_HZ = 60;
const USEFUL_BAND_HIGH_HZ = 8000;
// Razão mínima entre energia dentro do pente harmônico esperado e energia
// fora dele para aceitar a tomada como "a corda certa foi tocada". Não
// exige afinação exata (o pente já tem ±3% de tolerância por banda) —
// só exige que a energia predominante esteja mesmo nos parciais da nota
// esperada, não num pico isolado de ruído/ressonância.
const MIN_HARMONIC_MATCH_RATIO = 1.0;
const CLIPPING_AMPLITUDE = 0.98;
const MIN_VALID_PEAK_DB_ABOVE_FLOOR = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateNoiseFloorCombEnergy(
  noiseFloor: NoiseFloorProfile,
  comb: HarmonicBand[]
): number {
  // Reconstroi um "espectro" a partir do perfil de ruído salvo para medir
  // a energia esperada de ruído dentro do pente harmônico daquela nota.
  const spectrum = {
    magnitudes: new Float64Array(noiseFloor.spectrum),
    binHz: noiseFloor.sampleRate / noiseFloor.fftSize,
    sampleRate: noiseFloor.sampleRate,
    fftSize: noiseFloor.fftSize,
  };
  return energyInComb(spectrum, comb);
}

export async function captureNoteTake(options: NoteCaptureOptions): Promise<RawTakeCapture> {
  const {
    expectedFundamentalHz,
    capture,
    noiseFloor,
    sampleRate,
    onStatusChange,
    onEnvelopeUpdate,
    attackTimeoutMs = 8000,
    maxDecayMs = 9000,
  } = options;

  // O AudioContext pode ter sido suspenso pelo navegador desde a última
  // tomada (comum em mobile ao trocar de tela, bloquear e desbloquear o
  // aparelho, etc.). Sem isso, o processamento fica silenciosamente parado
  // e nenhum ataque jamais é detectado, mesmo tocando normalmente.
  await capture.ensureRunning();

  const nyquist = sampleRate / 2;
  const envelopeBinHz = sampleRate / ENVELOPE_FFT_SIZE;
  const comb = buildHarmonicComb(expectedFundamentalHz, envelopeBinHz, nyquist);

  const noiseCombEnergy = Math.max(estimateNoiseFloorCombEnergy(noiseFloor, comb), 1e-12);
  const attackThresholdEnergy = noiseCombEnergy * Math.pow(10, ATTACK_MARGIN_DB / 10);

  onStatusChange?.("aguardando");

  // --- Fase 1: aguardar ataque ---
  const attackDeadline = performance.now() + attackTimeoutMs;
  let attackEnergy = -1;
  let attackSpectrumSamples: Float64Array | null = null;

  while (performance.now() < attackDeadline) {
    const samples = capture.getLatestSamples(ENVELOPE_FFT_SIZE);
    const spectrum = computeSpectrum(samples, sampleRate);
    if (options.onLiveSpectrum) {
      options.onLiveSpectrum(
        Array.from(spectrum.magnitudes).map((magnitude, i) => ({ freqHz: i * spectrum.binHz, magnitude }))
      );
    }
    const combEnergy = energyInComb(spectrum, comb);
    if (combEnergy > attackThresholdEnergy) {
      attackEnergy = combEnergy;
      attackSpectrumSamples = samples;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (attackEnergy < 0 || !attackSpectrumSamples) {
    onStatusChange?.("descartado");
    return {
      valid: false,
      discardReason: "Nenhum ataque detectado. Toque a nota com mais firmeza.",
      detectedFundamentalHz: 0,
      expectedFundamentalHz,
      peakAmplitudeLinear: 0,
      envelope: [],
      highResSpectrum: null,
      sampleRate,
      comb,
    };
  }

  onStatusChange?.("detectado");

  const peakAmplitudeLinear = Math.max(...attackSpectrumSamples.map((v) => Math.abs(v)));

  if (peakAmplitudeLinear >= CLIPPING_AMPLITUDE) {
    onStatusChange?.("descartado");
    return {
      valid: false,
      discardReason: "Sinal saturado (muito alto/distorcido). Toque um pouco mais suave.",
      detectedFundamentalHz: 0,
      expectedFundamentalHz,
      peakAmplitudeLinear,
      envelope: [],
      highResSpectrum: null,
      sampleRate,
      comb,
    };
  }

  const attackDbAboveFloor = 10 * Math.log10(attackEnergy / noiseCombEnergy);
  if (attackDbAboveFloor < MIN_VALID_PEAK_DB_ABOVE_FLOOR) {
    onStatusChange?.("descartado");
    return {
      valid: false,
      discardReason: "Toque fraco demais para uma medição confiável. Toque com mais força.",
      detectedFundamentalHz: 0,
      expectedFundamentalHz,
      peakAmplitudeLinear,
      envelope: [],
      highResSpectrum: null,
      sampleRate,
      comb,
    };
  }

  onStatusChange?.("medindo");

  // --- Fase 2: capturar snapshot de alta resolução (~250ms após o ataque,
  // trecho estável) para análise espectral detalhada (Testes 2 e 3) ---
  await sleep(220);
  const highResSamples = capture.getLatestSamples(Math.min(HIGH_RES_FFT_SIZE, sampleRate * 2));
  const highResPadded = new Float64Array(nextPow2(highResSamples.length));
  // Centraliza as amostras reais no buffer para que o pico da janela de Hann
  // (que tapera para 0 nas bordas) recaia sobre o sinal real, não sobre zeros.
  const padOffset = Math.floor((highResPadded.length - highResSamples.length) / 2);
  highResPadded.set(highResSamples, padOffset);
  const highResSpectrumResult = computeSpectrum(highResPadded, sampleRate);
  const highResSpectrum = Array.from(highResSpectrumResult.magnitudes).map((magnitude, i) => ({
    freqHz: i * highResSpectrumResult.binHz,
    magnitude,
  }));
  options.onLiveSpectrum?.(highResSpectrum);

  // Valida se a corda certa foi tocada usando o MESMO mecanismo de pente
  // harmônico que já rejeita ruído/voz, em vez de procurar "o pico mais
  // alto numa janela larga" e comparar com a frequência esperada. Um
  // único bin de ruído/ressonância isolado pode facilmente vencer essa
  // busca ingênua (foi o que causava rejeições de tomadas boas) — mas
  // ruído de banda estreita nunca tem energia concentrada simultaneamente
  // em TODOS os parciais esperados (f0, 2·f0, 3·f0...) como uma nota real
  // tem. Isso também não exige afinação perfeita: pequenos desvios não
  // tiram a energia das bandas do pente (±3% por banda).
  const highResBinHz = highResSpectrumResult.binHz;
  const highResComb = buildHarmonicComb(expectedFundamentalHz, highResBinHz, nyquist);
  const expectedCombEnergy = energyInComb(highResSpectrumResult, highResComb);
  const expectedOutsideEnergy = Math.max(
    energyOutsideComb(highResSpectrumResult, highResComb, USEFUL_BAND_LOW_HZ, USEFUL_BAND_HIGH_HZ),
    1e-12
  );
  const harmonicMatchRatio = expectedCombEnergy / expectedOutsideEnergy;

  // Pico refinado perto da fundamental esperada, só para exibição e para
  // alimentar o retrato harmônico/inarmonicidade — não decide mais se a
  // tomada é aceita.
  const fundamentalBand = highResComb[0]!;
  let bestBin = -1;
  let bestMag = -Infinity;
  const loSearch = Math.max(0, Math.floor((fundamentalBand.centerHz * 0.7) / highResBinHz));
  const hiSearch = Math.min(
    highResSpectrumResult.magnitudes.length - 1,
    Math.ceil((fundamentalBand.centerHz * 1.4) / highResBinHz)
  );
  for (let bin = loSearch; bin <= hiSearch; bin++) {
    const m = highResSpectrumResult.magnitudes[bin]!;
    if (m > bestMag) {
      bestMag = m;
      bestBin = bin;
    }
  }
  const detectedFundamentalHz =
    bestBin >= 0
      ? parabolicPeakInterpolation(highResSpectrumResult.magnitudes, bestBin, highResBinHz).freqHz
      : expectedFundamentalHz;

  if (harmonicMatchRatio < MIN_HARMONIC_MATCH_RATIO) {
    onStatusChange?.("descartado");
    return {
      valid: false,
      discardReason: `Não encontrei energia harmônica concentrada na frequência esperada (${expectedFundamentalHz.toFixed(
        1
      )}Hz). Verifique se tocou a corda certa ou se há muito ruído no ambiente.`,
      detectedFundamentalHz,
      expectedFundamentalHz,
      peakAmplitudeLinear,
      envelope: [],
      highResSpectrum: null,
      sampleRate,
      comb,
    };
  }

  // --- Fase 3: rastrear envelope de decaimento até atingir o piso de ruído ---
  const startTime = performance.now();
  const envelope: EnvelopeFrame[] = [];
  const peakRefEnergy = attackEnergy;
  const decayDeadline = startTime + maxDecayMs;
  const usefulOutsideNoiseEnergy = Math.max(
    estimateNoiseFloorOutsideEnergy(noiseFloor, comb),
    1e-12
  );

  while (performance.now() < decayDeadline) {
    const samples = capture.getLatestSamples(ENVELOPE_FFT_SIZE);
    const spectrum = computeSpectrum(samples, sampleRate);
    if (options.onLiveSpectrum) {
      options.onLiveSpectrum(
        Array.from(spectrum.magnitudes).map((magnitude, i) => ({ freqHz: i * spectrum.binHz, magnitude }))
      );
    }
    const combEnergy = Math.max(energyInComb(spectrum, comb), 1e-12);
    const outsideEnergy = Math.max(
      energyOutsideComb(spectrum, comb, USEFUL_BAND_LOW_HZ, USEFUL_BAND_HIGH_HZ),
      1e-12
    );
    const timeSec = (performance.now() - startTime) / 1000;
    const combEnergyDb = 10 * Math.log10(combEnergy / peakRefEnergy);
    const outsideEnergyDb = 10 * Math.log10(outsideEnergy / usefulOutsideNoiseEnergy);
    const frame: EnvelopeFrame = { timeSec, combEnergyDb, outsideEnergyDb };
    envelope.push(frame);
    onEnvelopeUpdate?.(frame);

    if (combEnergy < noiseCombEnergy * 1.15 && timeSec > 0.3) {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  onStatusChange?.("concluido");

  return {
    valid: true,
    detectedFundamentalHz,
    expectedFundamentalHz,
    peakAmplitudeLinear,
    envelope,
    highResSpectrum,
    sampleRate,
    comb,
  };
}

function estimateNoiseFloorOutsideEnergy(
  noiseFloor: NoiseFloorProfile,
  comb: HarmonicBand[]
): number {
  const spectrum = {
    magnitudes: new Float64Array(noiseFloor.spectrum),
    binHz: noiseFloor.sampleRate / noiseFloor.fftSize,
    sampleRate: noiseFloor.sampleRate,
    fftSize: noiseFloor.fftSize,
  };
  return energyOutsideComb(spectrum, comb, USEFUL_BAND_LOW_HZ, USEFUL_BAND_HIGH_HZ);
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export { energyInRange };
