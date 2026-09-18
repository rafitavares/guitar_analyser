// Orquestra a captura de "uma tocada": espera o ataque de QUALQUER uma das
// cordas conhecidas do instrumento (casamento com pente harmônico), rastreia
// o envelope de decaimento até o som realmente sumir, e captura um snapshot
// de alta resolução para confirmar qual corda foi tocada. Feito para ser
// chamado repetidamente em loop (sessão de escuta contínua) sem exigir um
// botão por tomada — o usuário só toca livremente.

import { computeSpectrum, parabolicPeakInterpolation } from "./fft.ts";
import { buildHarmonicComb, energyInComb, energyOutsideComb } from "./harmonicComb.ts";
import type { HarmonicBand } from "./harmonicComb.ts";
import type { CaptureHandle } from "./capture.ts";
import type { NoiseFloorProfile } from "../types/index.ts";

export type CaptureStatus = "aguardando" | "detectado" | "medindo" | "concluido" | "descartado";

export interface EnvelopeFrame {
  timeSec: number;
  combEnergyDb: number;
  outsideEnergyDb: number;
}

export interface CaptureTarget {
  stringNumber: number;
  noteName: string;
  frequencyHz: number;
}

/** Token simples de cancelamento — setar `aborted = true` interrompe a escuta em andamento. */
export interface CaptureCancelToken {
  aborted: boolean;
}

export interface RawTakeCapture {
  valid: boolean;
  aborted?: boolean;
  discardReason?: string;
  matchedTarget: CaptureTarget | null;
  detectedFundamentalHz: number;
  peakAmplitudeLinear: number;
  envelope: EnvelopeFrame[];
  highResSpectrum: { freqHz: number; magnitude: number }[] | null;
  sampleRate: number;
}

export interface NoteCaptureOptions {
  /** Cordas/notas candidatas — a primeira cujo pente harmônico "bater" é escolhida. */
  targets: CaptureTarget[];
  sampleRate: number;
  capture: CaptureHandle;
  noiseFloor: NoiseFloorProfile;
  onStatusChange?: (status: CaptureStatus) => void;
  onEnvelopeUpdate?: (frame: EnvelopeFrame) => void;
  /** Espectro ao vivo (resolução moderada) emitido durante espera/medição, para visualização. */
  onLiveSpectrum?: (spectrum: { freqHz: number; magnitude: number }[]) => void;
  /** Timeout esperando o ataque, em ms. Bem generoso por padrão — o usuário toca no próprio ritmo. */
  attackTimeoutMs?: number;
  /** Duração máxima de rastreamento do decaimento, em ms. */
  maxDecayMs?: number;
  cancelToken?: CaptureCancelToken;
}

const ENVELOPE_FFT_SIZE = 8192;
const HIGH_RES_FFT_SIZE = 32768;
const POLL_INTERVAL_MS = 45;
const ATTACK_MARGIN_DB = 12; // margem acima do piso de ruído para considerar ataque
const USEFUL_BAND_LOW_HZ = 60;
const USEFUL_BAND_HIGH_HZ = 8000;
// Razão mínima entre energia dentro do pente harmônico e energia fora dele
// para aceitar a tomada como "essa foi a corda tocada". Não exige afinação
// exata (o pente já tem ±3% de tolerância por banda) — só exige que a
// energia predominante esteja mesmo nos parciais daquela nota, não num
// pico isolado de ruído/ressonância.
const MIN_HARMONIC_MATCH_RATIO = 1.0;
const CLIPPING_AMPLITUDE = 0.98;
const MIN_VALID_PEAK_DB_ABOVE_FLOOR = 6;
// Quão perto do piso de ruído a energia precisa chegar, e por quantos ciclos
// consecutivos, antes de considerarmos que o som realmente sumiu. Mais
// conservador que uma simples margem única evita cortar a medição enquanto
// a nota ainda está audível (a prioridade aqui é medir até o fim de verdade,
// mesmo que isso demore mais alguns segundos).
const QUIET_ENERGY_MARGIN = 1.05;
const QUIET_CONFIRM_CYCLES = 4;
const MIN_DECAY_TRACK_SEC = 0.3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TargetCombInfo {
  target: CaptureTarget;
  comb: HarmonicBand[];
  noiseCombEnergy: number;
  attackThresholdEnergy: number;
}

function estimateNoiseFloorCombEnergy(noiseFloor: NoiseFloorProfile, comb: HarmonicBand[]): number {
  const spectrum = {
    magnitudes: new Float64Array(noiseFloor.spectrum),
    binHz: noiseFloor.sampleRate / noiseFloor.fftSize,
    sampleRate: noiseFloor.sampleRate,
    fftSize: noiseFloor.fftSize,
  };
  return energyInComb(spectrum, comb);
}

function estimateNoiseFloorOutsideEnergy(noiseFloor: NoiseFloorProfile, comb: HarmonicBand[]): number {
  const spectrum = {
    magnitudes: new Float64Array(noiseFloor.spectrum),
    binHz: noiseFloor.sampleRate / noiseFloor.fftSize,
    sampleRate: noiseFloor.sampleRate,
    fftSize: noiseFloor.fftSize,
  };
  return energyOutsideComb(spectrum, comb, USEFUL_BAND_LOW_HZ, USEFUL_BAND_HIGH_HZ);
}

function emptyResult(sampleRate: number, discardReason?: string, aborted = false): RawTakeCapture {
  return {
    valid: false,
    aborted,
    discardReason,
    matchedTarget: null,
    detectedFundamentalHz: 0,
    peakAmplitudeLinear: 0,
    envelope: [],
    highResSpectrum: null,
    sampleRate,
  };
}

export async function captureNoteTake(options: NoteCaptureOptions): Promise<RawTakeCapture> {
  const {
    targets,
    capture,
    noiseFloor,
    sampleRate,
    onStatusChange,
    onEnvelopeUpdate,
    attackTimeoutMs = 300000,
    maxDecayMs = 20000,
    cancelToken,
  } = options;

  // O AudioContext pode ter sido suspenso pelo navegador desde a última
  // tomada (comum em mobile ao trocar de tela, bloquear e desbloquear o
  // aparelho, etc.). Sem isso, o processamento fica silenciosamente parado
  // e nenhum ataque jamais é detectado, mesmo tocando normalmente.
  await capture.ensureRunning();

  const nyquist = sampleRate / 2;
  const envelopeBinHz = sampleRate / ENVELOPE_FFT_SIZE;

  const targetInfos: TargetCombInfo[] = targets.map((target) => {
    const comb = buildHarmonicComb(target.frequencyHz, envelopeBinHz, nyquist);
    const noiseCombEnergy = Math.max(estimateNoiseFloorCombEnergy(noiseFloor, comb), 1e-12);
    return {
      target,
      comb,
      noiseCombEnergy,
      attackThresholdEnergy: noiseCombEnergy * Math.pow(10, ATTACK_MARGIN_DB / 10),
    };
  });

  onStatusChange?.("aguardando");

  // --- Fase 1: aguardar ataque de QUALQUER uma das cordas candidatas ---
  const attackDeadline = performance.now() + attackTimeoutMs;
  let attackEnergy = -1;
  let attackSpectrumSamples: Float64Array | null = null;
  let candidate: TargetCombInfo | null = null;

  while (!cancelToken?.aborted && performance.now() < attackDeadline) {
    const samples = capture.getLatestSamples(ENVELOPE_FFT_SIZE);
    const spectrum = computeSpectrum(samples, sampleRate);
    if (options.onLiveSpectrum) {
      options.onLiveSpectrum(
        Array.from(spectrum.magnitudes).map((magnitude, i) => ({ freqHz: i * spectrum.binHz, magnitude }))
      );
    }

    let bestExcess = 0;
    let bestInfo: TargetCombInfo | null = null;
    let bestEnergy = 0;
    for (const info of targetInfos) {
      const combEnergy = energyInComb(spectrum, info.comb);
      const excess = combEnergy / info.attackThresholdEnergy;
      if (excess > 1 && excess > bestExcess) {
        bestExcess = excess;
        bestInfo = info;
        bestEnergy = combEnergy;
      }
    }

    if (bestInfo) {
      attackEnergy = bestEnergy;
      attackSpectrumSamples = samples;
      candidate = bestInfo;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (cancelToken?.aborted) {
    return emptyResult(sampleRate, undefined, true);
  }

  if (attackEnergy < 0 || !attackSpectrumSamples || !candidate) {
    onStatusChange?.("descartado");
    return emptyResult(sampleRate, "Nenhum ataque detectado.");
  }

  onStatusChange?.("detectado");

  const peakAmplitudeLinear = Math.max(...attackSpectrumSamples.map((v) => Math.abs(v)));

  if (peakAmplitudeLinear >= CLIPPING_AMPLITUDE) {
    onStatusChange?.("descartado");
    return emptyResult(sampleRate, "Sinal saturado (muito alto/distorcido). Toque um pouco mais suave.");
  }

  const attackDbAboveFloor = 10 * Math.log10(attackEnergy / candidate.noiseCombEnergy);
  if (attackDbAboveFloor < MIN_VALID_PEAK_DB_ABOVE_FLOOR) {
    onStatusChange?.("descartado");
    return emptyResult(sampleRate, "Toque fraco demais para uma medição confiável.");
  }

  onStatusChange?.("medindo");

  // --- Fase 2: capturar snapshot de alta resolução (~220ms após o ataque,
  // trecho já assentado, sem o transiente do toque) para confirmar qual
  // corda foi tocada com muito mais precisão que no instante do ataque. ---
  await sleep(220);
  const highResSamples = capture.getLatestSamples(Math.min(HIGH_RES_FFT_SIZE, sampleRate * 2));
  const highResPadded = new Float64Array(nextPow2(highResSamples.length));
  const padOffset = Math.floor((highResPadded.length - highResSamples.length) / 2);
  highResPadded.set(highResSamples, padOffset);
  const highResSpectrumResult = computeSpectrum(highResPadded, sampleRate);
  const highResSpectrum = Array.from(highResSpectrumResult.magnitudes).map((magnitude, i) => ({
    freqHz: i * highResSpectrumResult.binHz,
    magnitude,
  }));
  options.onLiveSpectrum?.(highResSpectrum);

  const highResBinHz = highResSpectrumResult.binHz;

  // Testa o pente harmônico de CADA corda candidata contra o espectro
  // assentado e fica com a que teve a maior concentração de energia nos
  // seus parciais — muito mais robusto que comparar um único pico com uma
  // frequência esperada (um ruído pontual pode facilmente vencer essa
  // busca ingênua mesmo com a nota certa tocada).
  let bestMatch: { target: CaptureTarget; comb: HarmonicBand[]; ratio: number } | null = null;
  for (const info of targetInfos) {
    const highResComb = buildHarmonicComb(info.target.frequencyHz, highResBinHz, nyquist);
    const combEnergy = energyInComb(highResSpectrumResult, highResComb);
    const outsideEnergy = Math.max(
      energyOutsideComb(highResSpectrumResult, highResComb, USEFUL_BAND_LOW_HZ, USEFUL_BAND_HIGH_HZ),
      1e-12
    );
    const ratio = combEnergy / outsideEnergy;
    if (!bestMatch || ratio > bestMatch.ratio) {
      bestMatch = { target: info.target, comb: highResComb, ratio };
    }
  }

  if (!bestMatch || bestMatch.ratio < MIN_HARMONIC_MATCH_RATIO) {
    onStatusChange?.("descartado");
    return emptyResult(
      sampleRate,
      "Não encontrei energia harmônica concentrada em nenhuma corda conhecida. Verifique se o ambiente está muito ruidoso."
    );
  }

  const matchedTarget = bestMatch.target;
  const matchedComb = bestMatch.comb;

  // Pico refinado perto da fundamental da corda identificada, só para
  // exibição — não decide mais se a tomada é aceita.
  const fundamentalBand = matchedComb[0]!;
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
      : matchedTarget.frequencyHz;

  // --- Fase 3: rastrear envelope de decaimento até o som realmente sumir ---
  // (ou até o tempo máximo de segurança, para violões com sustain muito longo)
  const matchedNoiseCombEnergy = Math.max(estimateNoiseFloorCombEnergy(noiseFloor, matchedComb), 1e-12);
  const usefulOutsideNoiseEnergy = Math.max(estimateNoiseFloorOutsideEnergy(noiseFloor, matchedComb), 1e-12);

  const startTime = performance.now();
  const envelope: EnvelopeFrame[] = [];
  const peakRefEnergy = attackEnergy;
  const decayDeadline = startTime + maxDecayMs;
  let quietStreak = 0;

  while (!cancelToken?.aborted && performance.now() < decayDeadline) {
    const samples = capture.getLatestSamples(ENVELOPE_FFT_SIZE);
    const spectrum = computeSpectrum(samples, sampleRate);
    if (options.onLiveSpectrum) {
      options.onLiveSpectrum(
        Array.from(spectrum.magnitudes).map((magnitude, i) => ({ freqHz: i * spectrum.binHz, magnitude }))
      );
    }
    const combEnergy = Math.max(energyInComb(spectrum, matchedComb), 1e-12);
    const outsideEnergy = Math.max(
      energyOutsideComb(spectrum, matchedComb, USEFUL_BAND_LOW_HZ, USEFUL_BAND_HIGH_HZ),
      1e-12
    );
    const timeSec = (performance.now() - startTime) / 1000;
    const combEnergyDb = 10 * Math.log10(combEnergy / peakRefEnergy);
    const outsideEnergyDb = 10 * Math.log10(outsideEnergy / usefulOutsideNoiseEnergy);
    const frame: EnvelopeFrame = { timeSec, combEnergyDb, outsideEnergyDb };
    envelope.push(frame);
    onEnvelopeUpdate?.(frame);

    if (combEnergy < matchedNoiseCombEnergy * QUIET_ENERGY_MARGIN) {
      quietStreak++;
    } else {
      quietStreak = 0;
    }
    if (quietStreak >= QUIET_CONFIRM_CYCLES && timeSec > MIN_DECAY_TRACK_SEC) {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  onStatusChange?.("concluido");

  return {
    valid: true,
    matchedTarget,
    detectedFundamentalHz,
    peakAmplitudeLinear,
    envelope,
    highResSpectrum,
    sampleRate,
  };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
